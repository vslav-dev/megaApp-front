import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Signal, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { SyncEngineService, SyncOperationMode, SyncOperationType } from '@app/services/sync-engine.service';
import { SETTINGS_AUTO_SAVE_DEBOUNCE_MS } from '@app/shared/const';
import { IncomingWsMessage, WebSocketMessageType } from '@app/shared/types';
import { isDeepEqual } from '@app/shared/utils';
import { firstValueFrom } from 'rxjs';

// One generic mechanism backing every server-synced settings namespace (core/food/money/metrics),
// on top of the existing PUT /api/settings/{namespace}. Two save modes share the same state:
//
// - auto-save: set(key, value) — an immediate optimistic PUT of that one field via SyncEngineService
//   (retry/backoff/rollback already built there), used by core/food/money.
// - batched explicit-save: stage(key, value) only updates in-memory state; saveNow() PUTs the
//   whole current snapshot at once. Used only by metrics, whose explicit "Save" button predates
//   this refactor (plan 11) and must keep working exactly the same.
//
// `key` is always a namespace object's top-level field — its value can be arbitrarily nested
// (e.g. cardSize), but is always replaced as one opaque unit, never merged deeper.
export class NamespaceSettingsStore<T extends object> {
  private readonly http = inject(HttpClient);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly networkService = inject(NetworkService);
  private readonly notificationService = inject(NotificationService);
  private readonly syncEngine = inject(SyncEngineService);
  private readonly authService = inject(AuthService);

  private readonly storageKey: string;
  private readonly state$$: WritableSignal<T>;
  // Last value known to match the server — equal to state$$ at all times in auto-save mode
  // (every set() is immediately optimistic-applied), and only in sync with it in batched mode
  // right after load or saveNow(). Backs isDirty$$ and gates incoming broadcasts.
  private readonly confirmed$$: WritableSignal<T>;

  public readonly value$$: Signal<T>;
  public readonly isDirty$$: Signal<boolean>;
  public readonly isSaving$$: WritableSignal<boolean> = signal(false);

  // Resolves once the load triggered by the current authenticated session settles.
  private readyPromise: Promise<void> = Promise.resolve();

  // AuthService.sessionGeneration$$ value this store last loaded for, or -1 if it never has.
  // Lets syncWithSession() be called both reactively (the effect below) and synchronously
  // on-demand from ready() without ever issuing two loads for the same session.
  private loadedForGeneration = -1;

  // updatedAt of the last broadcast actually applied. Two quick PUTs from the same user race their
  // own async goroutines to the socket on the backend, so a later broadcast can arrive before an
  // earlier one — this drops anything older than what's already applied instead of regressing.
  private lastAppliedBroadcastAt = 0;

  // Buffers set() calls within a quiet window so a burst (e.g. dragging a range slider) becomes
  // one PUT instead of one per intermediate value. The optimistic apply to state$$ still happens
  // synchronously on every call — only the network write is debounced.
  private pendingFields: Partial<T> = {};
  private pendingPrevious: Partial<T> = {};
  private readonly pendingRollbacks = new Map<keyof T, (previousValue: unknown) => void>();
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly namespace: string,
    private readonly defaults: T,
  ) {
    this.storageKey = `settings_${namespace}`;
    const initial = { ...defaults, ...(this.readCache() ?? {}) };
    this.state$$ = signal(initial);
    this.confirmed$$ = signal(initial);
    this.value$$ = this.state$$.asReadonly();
    this.isDirty$$ = computed(() => !isDeepEqual(this.state$$(), this.confirmed$$()));

    // Reactive background sync, for components that read value$$ without ever calling ready()
    // (e.g. after a logout while the store is still in memory). effect() only *runs* asynchronously
    // though — it never fires synchronously with the sessionState$$ write above it, so it can't be
    // the only trigger (see syncWithSession() for why ready() also calls it directly).
    effect(() => {
      this.authService.sessionState$$();
      this.syncWithSession();
    });

    this.networkService.wsMessages$.subscribe((message) => this.handleIncoming(message));
  }

  // Called both reactively (the effect above) and synchronously from ready(). The synchronous path
  // matters: every guard that awaits ready() (settingsReadyGuard, isChapterSelected, ...) only runs
  // after authGuard has already resolved sessionState$$ to a settled value, i.e. strictly after the
  // signal write — but Angular's effect() is never guaranteed to have flushed by then (it schedules
  // its first/next run asynchronously, tied to change-detection timing, not to the write itself).
  // A guard calling ready() before that flush would read the stale pre-login readyPromise and
  // proceed on cached/default data — e.g. reloading on /food landing on /settings because
  // selectedChapterFood read back as the default false. Deciding synchronously here, keyed off
  // sessionGeneration$$ so it never double-loads for the same session, removes that race entirely;
  // the effect becomes a no-op confirmation on any tick where this already ran.
  private syncWithSession(): void {
    const state = this.authService.sessionState$$();

    if (state === AuthSessionState.Authenticated) {
      const generation = this.authService.sessionGeneration$$();
      if (this.loadedForGeneration !== generation) {
        this.loadedForGeneration = generation;
        this.readyPromise = this.loadFromServer();
      }
    } else if (state === AuthSessionState.Guest) {
      if (this.loadedForGeneration !== -1) {
        this.loadedForGeneration = -1;
        this.reset();
        this.readyPromise = Promise.resolve();
      }
    }
  }

  public async ready(): Promise<void> {
    await this.authService.ensureBootstrapped();
    this.syncWithSession();
    await this.readyPromise;
  }

  public get<K extends keyof T>(key: K): T[K] {
    return this.state$$()[key];
  }

  // onRollback, if given, fires with the restored value right when a failed set() reverts —
  // e.g. so a caller can re-animate a theme switch back instead of just snapping it, which the
  // generic mechanism here has no reason to know about.
  //
  // The optimistic apply (state$$/localStorage/confirmed$$) happens synchronously on every call, so
  // the UI never waits. The actual PUT is debounced: a burst of set() calls (dragging a slider fires
  // one per intermediate value) collapses into a single request carrying only the latest value per
  // key, sent SETTINGS_AUTO_SAVE_DEBOUNCE_MS after the last call in the burst. "Previous" for
  // rollback purposes is the value from before the *whole* burst, not before each individual call —
  // intermediate values were never sent, so there's nothing server-side to unwind them from.
  public set<K extends keyof T>(key: K, value: T[K], onRollback?: (previousValue: T[K]) => void): void {
    if (!(key in this.pendingFields)) {
      this.pendingPrevious[key] = this.state$$()[key];
    }

    this.applyState({ [key]: value } as unknown as Partial<T>);
    this.commitLocal();

    this.pendingFields[key] = value;
    if (onRollback) {
      this.pendingRollbacks.set(key, onRollback as (previousValue: unknown) => void);
    } else {
      this.pendingRollbacks.delete(key);
    }

    if (this.pendingFlushTimer !== null) clearTimeout(this.pendingFlushTimer);
    this.pendingFlushTimer = setTimeout(() => this.flushPendingSet(), SETTINGS_AUTO_SAVE_DEBOUNCE_MS);
  }

  private flushPendingSet(): void {
    this.pendingFlushTimer = null;

    const fields = this.pendingFields;
    const previous = this.pendingPrevious;
    const rollbacks = this.pendingRollbacks.size > 0 ? new Map(this.pendingRollbacks) : null;
    this.pendingFields = {};
    this.pendingPrevious = {};
    this.pendingRollbacks.clear();

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.UPDATE,
      endpoint: `/api/settings/${this.namespace}`,
      data: fields,
      rollbackCallback: () => {
        this.applyState(previous);
        this.commitLocal();
        this.notificationService.showSyncError('Failed to save settings');
        rollbacks?.forEach((callback, key) => callback(previous[key]));
      },
    });
  }

  public stage<K extends keyof T>(key: K, value: T[K]): void {
    this.applyState({ [key]: value } as unknown as Partial<T>);
  }

  public async saveNow(): Promise<void> {
    const snapshot = this.state$$();
    this.isSaving$$.set(true);
    try {
      await firstValueFrom(
        this.http.put(`/api/settings/${this.namespace}`, { ...snapshot, operationId: crypto.randomUUID() }),
      );
      this.writeCache(snapshot);
      this.confirmed$$.set(snapshot);
    } catch (error) {
      console.error(`Failed to save ${this.namespace} settings:`, error);
      this.notificationService.showSyncError('Failed to save settings');
    } finally {
      this.isSaving$$.set(false);
    }
  }

  public reset(): void {
    // Drop any not-yet-sent debounced write — it captured pre-reset values, and letting it fire
    // later (e.g. after logout) would reapply them straight over the just-reset defaults.
    if (this.pendingFlushTimer !== null) clearTimeout(this.pendingFlushTimer);
    this.pendingFlushTimer = null;
    this.pendingFields = {};
    this.pendingPrevious = {};
    this.pendingRollbacks.clear();

    this.state$$.set(this.defaults);
    this.confirmed$$.set(this.defaults);
  }

  private async loadFromServer(): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.get<Partial<T>>(`/api/settings/${this.namespace}`));
      // pendingFields last: a set() the user made while this GET was still in flight hasn't
      // reached the server yet (still sitting in the debounce buffer), so the server's answer for
      // those specific keys is stale by definition — keep the newer local value, let the pending
      // flush reconcile it with the server for real once it fires.
      const merged = { ...this.defaults, ...response, ...this.pendingFields } as T;
      this.state$$.set(merged);
      this.writeCache(merged);
      this.confirmed$$.set(merged);
    } catch (error) {
      console.error(`Failed to fetch ${this.namespace} settings from server:`, error);
    }
  }

  // Applies a broadcast from another tab/device for this namespace. In batched mode (isDirty$$
  // true means there are unsaved local edits — see metrics), the incoming update is dropped
  // rather than silently overwriting what the user hasn't saved yet; auto-save namespaces are
  // never dirty, so this guard is a no-op for them and every broadcast applies immediately.
  private handleIncoming(message: IncomingWsMessage): void {
    if (message.type !== WebSocketMessageType.SETTINGS_UPDATED) return;
    if (message.payload.namespace !== this.namespace) return;
    if (this.isDirty$$()) return;
    if (message.payload.updatedAt <= this.lastAppliedBroadcastAt) return;

    const merged = { ...this.state$$(), ...(message.payload.fields as Partial<T>) };
    this.state$$.set(merged);
    this.writeCache(merged);
    this.confirmed$$.set(merged);
    this.lastAppliedBroadcastAt = message.payload.updatedAt;
  }

  private applyState(patch: Partial<T>): void {
    this.state$$.update((current) => ({ ...current, ...patch }));
  }

  // Auto-save's "apply + persist + treat as confirmed" triplet, used both on the optimistic set()
  // and on its rollback.
  private commitLocal(): void {
    const current = this.state$$();
    this.writeCache(current);
    this.confirmed$$.set(current);
  }

  private writeCache(value: T): void {
    this.localStorageService.setUserScoped(this.storageKey, value);
  }

  private readCache(): Partial<T> | null {
    return this.localStorageService.getUserScoped<Partial<T>>(this.storageKey);
  }
}
