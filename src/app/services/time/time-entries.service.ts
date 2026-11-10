import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { SyncEngineService, SyncOperationMode, SyncOperationType } from '@app/services/sync-engine.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { TimeEntry, TimeEntryCreateInput, TimeEntrySelectionInput, TimeEntryTimeInput } from '@app/shared/time-types';
import { firstValueFrom } from 'rxjs';

interface DataResponse<T> {
  success: boolean;
  data: T;
}

const ENTRIES_STORAGE_KEY = 'time_entries';
const TAIL_REFRESH_DAYS = 14;

export interface TimeDayLanes {
  primary: TimeEntry[];
  secondary: TimeEntry[];
}

@Service()
export class TimeEntriesService {
  private readonly http = inject(HttpClient);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly syncEngine = inject(SyncEngineService);
  private readonly authService = inject(AuthService);
  private readonly telemetry = inject(TelemetryService);

  public readonly entries$$: WritableSignal<TimeEntry[]> = signal([]);
  public readonly isLoaded$$: WritableSignal<boolean> = signal(false);

  // One computed index, recomputed only when entries$$ changes — rendering a
  // day-row looks this up in O(1) instead of filtering the whole array.
  public readonly entriesByDay$$: Signal<Map<string, TimeDayLanes>> = computed(() => this.buildDayIndex());

  // Entry id (temp ids of unconfirmed creates included) → number of its writes sitting in the sync
  // queue. Re-entering the screen refetches entries, and the server can legitimately still return
  // the pre-write state for them — mergeWithPending() keeps our own state for these ids instead.
  // A count, not a set: a drag and a selection edit of one entry can be queued at once.
  private readonly pendingWritesByEntryId = new Map<number, number>();

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  public reset(): void {
    this.entries$$.set([]);
    this.isLoaded$$.set(false);
    this.pendingWritesByEntryId.clear();
  }

  //                                                            ~~~ BOOTSTRAP ~~~

  // Called on every entry to the screen: shows the cached entries at once, then refreshes only
  // the recent tail from the server (or everything, when there is no cache yet).
  public loadData(): void {
    const cached = this.localStorageService.getUserScoped<TimeEntry[]>(ENTRIES_STORAGE_KEY);
    if (!cached) {
      void this.fetchEntries(null);
      return;
    }

    this.telemetry.measure(
      'time.entries_apply',
      () => this.applyEntries(cached),
      () => ({ source: 'cache', entries: cached.length }),
    );
    void this.fetchEntries(this.buildTailCutoff());
  }

  private async fetchEntries(tailCutoff: string | null): Promise<void> {
    const startedAt = performance.now();
    const query = tailCutoff === null ? '' : `?start=${encodeURIComponent(tailCutoff)}`;
    try {
      const response = await firstValueFrom(this.http.get<DataResponse<TimeEntry[]>>(`/api/time/entries${query}`));
      const olderEntries = tailCutoff === null ? [] : this.entries$$().filter((entry) => entry.startAt < tailCutoff);
      this.applyEntries(this.mergeWithPending([...olderEntries, ...response.data]));
      this.writeCache();
      void this.telemetry.recordAfterPaint('time.entries_apply', startedAt, {
        source: tailCutoff === null ? 'server' : 'server_tail',
        entries: response.data.length,
      });
    } catch (error) {
      console.error('Failed loading time entries:', error);
      this.isLoaded$$.set(true);
    }
  }

  private applyEntries(entries: TimeEntry[]): void {
    this.entries$$.set(entries);
    this.isLoaded$$.set(true);
  }

  private mergeWithPending(incoming: TimeEntry[]): TimeEntry[] {
    if (this.pendingWritesByEntryId.size === 0) return incoming;

    const merged = incoming.filter((entry) => !this.pendingWritesByEntryId.has(entry.id));
    const currentById = new Map(this.entries$$().map((entry) => [entry.id, entry]));
    for (const id of this.pendingWritesByEntryId.keys()) {
      const current = currentById.get(id);
      if (current) merged.push(current);
    }
    return merged;
  }

  private buildTailCutoff(): string {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - TAIL_REFRESH_DAYS);
    const isoDate = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
    return `${isoDate}T00:00:00`;
  }

  private buildDayIndex(): Map<string, TimeDayLanes> {
    const index = new Map<string, TimeDayLanes>();
    for (const entry of this.entries$$()) {
      const dayIso = entry.startAt.slice(0, 10);
      let lanes = index.get(dayIso);
      if (!lanes) {
        lanes = { primary: [], secondary: [] };
        index.set(dayIso, lanes);
      }
      lanes[entry.track].push(entry);
    }
    return index;
  }

  private markPending(entryId: number): void {
    this.pendingWritesByEntryId.set(entryId, (this.pendingWritesByEntryId.get(entryId) ?? 0) + 1);
  }

  private clearPending(entryId: number): void {
    const remaining = (this.pendingWritesByEntryId.get(entryId) ?? 0) - 1;
    if (remaining > 0) {
      this.pendingWritesByEntryId.set(entryId, remaining);
    } else {
      this.pendingWritesByEntryId.delete(entryId);
    }
  }

  private writeCache(): void {
    this.localStorageService.setUserScoped(ENTRIES_STORAGE_KEY, this.entries$$());
  }

  //                                                            ~~~ MUTATIONS ~~~

  // Optimistic: local state changes at once and the sync engine confirms or rolls back later,
  // so there is nothing for a caller to wait for.
  public createEntry(input: TimeEntryCreateInput): void {
    const tempId = -Date.now();
    const now = new Date().toISOString();
    this.entries$$.update((entries) => [...entries, { ...input, id: tempId, createdAt: now, updatedAt: now }]);
    this.writeCache();
    this.markPending(tempId);

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.CREATE,
      endpoint: '/api/time/entries',
      data: input,
      successCallback: (response: DataResponse<{ id: number }>) => {
        this.clearPending(tempId);
        this.entries$$.update((entries) =>
          entries.map((entry) => (entry.id === tempId ? { ...entry, id: response.data.id } : entry)),
        );
        this.writeCache();
      },
      rollbackCallback: () => {
        this.clearPending(tempId);
        this.entries$$.update((entries) => entries.filter((entry) => entry.id !== tempId));
        this.writeCache();
      },
      feedback: {
        successMessage: 'Entry saved',
        errorMessage: 'Failed to save entry',
        pendingMessage: 'Saving entry...',
      },
    });
  }

  // Drag/resize/move — touches only track/startAt/endAt. Rollback restores
  // just those fields on this one entry by id, so a queued selection
  // update on the same entry (see updateEntrySelection) is never clobbered.
  public updateEntryTime(entryId: number, input: TimeEntryTimeInput): void {
    const previous = this.entries$$().find((entry) => entry.id === entryId);
    if (!previous || !isConfirmedEntry(previous)) return;
    const previousTime: TimeEntryTimeInput = {
      track: previous.track,
      startAt: previous.startAt,
      endAt: previous.endAt,
    };

    this.patchEntry(entryId, input, previousTime, `/api/time/entries/${entryId}/time`);
  }

  // Picker edit — touches only activityKindId/options. Rollback restores
  // just those fields, leaving track/startAt/endAt (possibly since
  // moved by a queued drag) untouched.
  public updateEntrySelection(entryId: number, input: TimeEntrySelectionInput): void {
    const previous = this.entries$$().find((entry) => entry.id === entryId);
    if (!previous || !isConfirmedEntry(previous)) return;
    const previousSelection: TimeEntrySelectionInput = {
      activityKindId: previous.activityKindId,
      options: previous.options,
    };

    this.patchEntry(entryId, input, previousSelection, `/api/time/entries/${entryId}/selection`);
  }

  public deleteEntry(entryId: number): void {
    const previous = this.entries$$().find((entry) => entry.id === entryId);
    if (!previous || !isConfirmedEntry(previous)) return;

    this.entries$$.update((entries) => entries.filter((entry) => entry.id !== entryId));
    this.writeCache();
    this.markPending(entryId);

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.DELETE,
      endpoint: `/api/time/entries/${entryId}`,
      data: {},
      successCallback: () => {
        this.clearPending(entryId);
      },
      rollbackCallback: () => {
        this.clearPending(entryId);
        this.entries$$.update((entries) =>
          entries.some((entry) => entry.id === entryId) ? entries : [...entries, previous],
        );
        this.writeCache();
      },
      feedback: {
        successMessage: 'Entry deleted',
        errorMessage: 'Failed to delete entry',
        pendingMessage: 'Deleting entry...',
      },
    });
  }

  private patchEntry<T extends TimeEntryTimeInput | TimeEntrySelectionInput>(
    entryId: number,
    input: T,
    previousFields: T,
    endpoint: string,
  ): void {
    this.entries$$.update((entries) =>
      entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...input, updatedAt: new Date().toISOString() } : entry,
      ),
    );
    this.writeCache();
    this.markPending(entryId);

    this.syncEngine.addOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.PATCH,
      endpoint,
      data: input,
      successCallback: () => {
        this.clearPending(entryId);
      },
      rollbackCallback: () => {
        this.clearPending(entryId);
        this.entries$$.update((entries) =>
          entries.map((entry) => (entry.id === entryId ? { ...entry, ...previousFields } : entry)),
        );
        this.writeCache();
      },
      feedback: {
        successMessage: 'Changes saved',
        errorMessage: 'Failed to save changes',
        pendingMessage: 'Saving changes...',
      },
    });
  }
}

// Optimistic creates get a negative temp id until the server answers with the real one; such an
// entry has no server address yet, so it can't be patched or deleted.
export function isConfirmedEntry(entry: TimeEntry): boolean {
  return entry.id > 0;
}
