import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { IndexedDbCacheService } from '@app/services/indexed-db-cache.service';
import {
  BodyWeightInterface,
  BodyWeightToUpdate,
  DayTotals,
  DeletedDiaryDaySnapshot,
  Diary,
  DiaryDay,
  DiaryDayRestoreRequest,
  DiaryDayToDelete,
  DiaryEntry,
  DiaryEntryToCreate,
  DiaryEntryToDelete,
  DiaryEntryToEdit,
  DiaryEntryToRestore,
  DiaryEntryToUpdate,
  DiaryEntryWithFullData,
  DiarySegment,
  HistoryEntry,
  IncomingWsMessage,
  NutrientDelta,
  ServerResponseWithDiaryEntries,
  ServerResponseWithDiaryId,
  UnifiedDiary,
  WebSocketMessageType,
} from '@app/shared/types';
import { calculateTodayIsoWithUserTimeShift, dateToIsoNoTimeNoTZ } from '@app/shared/utils';
import { firstValueFrom, Subject } from 'rxjs';
import { LocalStorageService } from '../local-storage.service';
import { NetworkService } from '../network.service';
import { NotificationService } from '../notification.service';
import { SyncEngineService, SyncOperationMode, SyncOperationType } from '../sync-engine.service';
import { TelemetryService } from '../telemetry.service';
import { BaseFoodService } from './food-base.service';
import { FoodCatalogueService } from './food-catalogue.service';
import { FoodPersonalKcalsService } from './food-personal-kcals.service';
import { FoodSettingsService } from './food-settings.service';

const DEFAULT_NUTRIENTS = {
  targetKcals: 2000,
  targetProtein: 0,
  targetFat: 0,
  targetCarbs: 0,
  targetFiber: 0,
  consumedKcals: 0,
  consumedProtein: 0,
  consumedFat: 0,
  consumedCarbs: 0,
  consumedFiber: 0,
};

@Injectable({
  providedIn: 'root',
})
export class FoodDiaryService extends BaseFoodService {
  private readonly diaryRaw$$: WritableSignal<Diary> = signal({});
  private readonly deletedDaySnapshot$$: WritableSignal<DeletedDiaryDaySnapshot | null> = signal(null);

  public readonly diary$$: Signal<UnifiedDiary> = computed(() =>
    this.telemetry.measure(
      'food.diary_unified_model',
      () => this.prepUnifiedDiary(),
      (result) => ({
        days: Object.keys(result).length,
        entries: Object.values(result).reduce((total, day) => total + day.food.length, 0),
      }),
    ),
  );

  public readonly selectedDayIso$$: WritableSignal<string> = signal(calculateTodayIsoWithUserTimeShift());
  public readonly selectedDayDeletedSnapshot$$: Signal<DeletedDiaryDaySnapshot | null> = computed(() => {
    const snapshot = this.deletedDaySnapshot$$();
    const selectedDay = this.selectedDayIso$$();

    if (!snapshot || snapshot.dateISO !== selectedDay) {
      return null;
    }

    return snapshot;
  });
  public readonly selectedDayTotals$$: Signal<DayTotals> = computed(() => this.extractSelectedDayTotals());

  // The single in-progress, unsubmitted weight edit across the whole diary (add-form or one
  // edit-form row) — null when nothing is being edited. selectedDayTotals$$ folds it in so every
  // consumer (top bar, nutrition-summary, per-row progress ring) reads the exact same projected
  // percent, computed with the same rounding rule the server applies on save — the live preview
  // and the post-save value can never disagree.
  private readonly draftEntryWeight$$: WritableSignal<{
    dateISO: string;
    diaryId: number | null; // null = a new, not-yet-created entry (add-form)
    foodCatalogueId: number;
    weight: number;
  } | null> = signal(null);

  // The share of the day's norm that the entry being edited would have with its unsaved draft
  // weight, so that entry's own row fill follows the edit live (the entry itself stays unchanged
  // until saved). Null for a new entry (add-form) — it has no row yet.
  public readonly draftEntryPercent$$: Signal<{ diaryId: number; percent: number } | null> = computed(() => {
    const draft = this.draftEntryWeight$$();
    if (!draft || draft.diaryId === null) return null;

    const totals = this.diary$$()[draft.dateISO]?.totals;
    if (!totals) return null;

    const kcals = this.estimateEntryKcalsNow(draft.foodCatalogueId, draft.weight);
    return { diaryId: draft.diaryId, percent: this.calculatePercentage(kcals, totals.targetKcals) };
  });

  public readonly diaryEntryFocusId$$: WritableSignal<number | null> = signal(null);
  public readonly diaryEntryResetId$$: WritableSignal<number | null> = signal(null);

  // Fires with a dateISO whenever diaryRaw$$ changes for that date — own mutation applied, or a
  // realtime update from another device. FoodStatsService listens to decide whether a day outside
  // its live window needs a background stats refetch (§2.3) — kept as an event instead of a direct
  // dependency so this service never has to know FoodStatsService exists.
  public readonly mutationApplied$ = new Subject<string>();

  public readonly height$$: Signal<number | null> = computed(() => this.foodSettingsService.height$$());

  private readonly DIARY_STORAGE_KEY = 'food_diary';
  private readonly DELETED_DAY_SNAPSHOT_STORAGE_KEY = 'food_diary_deleted_day_snapshot';

  // Batch size for a segment (a contiguous range of dates confirmed with the server this
  // session): the very first segment of the session is small (the common case — just today's
  // neighbourhood), every subsequent one (paging further out or a calendar jump) is large, so a
  // long run of day-to-day navigation away from today doesn't need a request per step.
  private readonly FIRST_SEGMENT_OFFSET_DAYS = 7;
  private readonly NEXT_SEGMENT_OFFSET_DAYS = 30;
  private readonly EDGE_THRESHOLD_DAYS = 3;

  // In-memory only — reset on every page load. A date inside one of these ranges is trusted as
  // fetched-and-confirmed for this session (even if it has zero entries); a date outside all of
  // them hasn't been asked about yet and triggers a new segment fetch.
  private segments: DiarySegment[] = [];

  // Windows currently in flight (request sent, response not back yet). Coverage checks treat
  // these the same as confirmed segments — otherwise a date selected while a fetch is still
  // pending reads as "not covered" and fires another, overlapping request on every navigation
  // step until the first one finally lands (request-chain bug on slow networks). Moved into
  // `segments` on success; dropped (not confirmed) on failure so the date is retried later.
  private pendingSegments: DiarySegment[] = [];

  // Entry IDs with an edit/delete sitting in the sync queue, not yet confirmed or rolled back.
  // A background refetch (SYNC_STATUS reload, periodic reload) can legitimately return
  // pre-commit data for these IDs while the write is still queued/in flight — the fix is to
  // keep our own optimistic state for them instead of letting the refetch response win.
  private readonly pendingDiaryEntryIds = new Set<number>();

  // Vestigial: diary data moved to IndexedDB (per-day records), saveToLocalStorage/
  // loadFromLocalStorage are no longer called. Kept only to satisfy BaseFoodService's abstract
  // contract.
  protected getStorageKey(): string {
    return this.DIARY_STORAGE_KEY;
  }

  private readonly catalogueService = inject(FoodCatalogueService);
  private readonly personalKcalsService = inject(FoodPersonalKcalsService);
  private readonly foodSettingsService = inject(FoodSettingsService);
  private readonly authService = inject(AuthService);
  private readonly notificationService = inject(NotificationService);
  private readonly telemetry = inject(TelemetryService);
  private readonly indexedDbCache = inject(IndexedDbCacheService);

  private readonly ensureDiarySegmentEffect$$ = effect(() => {
    if (this.authService.sessionState$$() !== AuthSessionState.Authenticated) return;
    const dateISO = this.selectedDayIso$$();
    this.hydrateDayFromIndexedDb(dateISO);
    void this.ensureSegmentCoverage(dateISO);
  });

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
      void this.indexedDbCache.clearDays();
    }
  });

  constructor(
    http: HttpClient,
    localStorageService: LocalStorageService,
    networkService: NetworkService,
    syncEngine: SyncEngineService,
  ) {
    super(http, localStorageService, networkService, syncEngine);
    this.loadDeletedDaySnapshotFromLocalStorage();
    this.subscribe();
  }

  public reset(): void {
    this.diaryRaw$$.set({});
    this.deletedDaySnapshot$$.set(null);
    this.selectedDayIso$$.set(calculateTodayIsoWithUserTimeShift());
    this.diaryEntryFocusId$$.set(null);
    this.diaryEntryResetId$$.set(null);
    this.draftEntryWeight$$.set(null);
    this.segments = [];
    this.pendingSegments = [];
    this.pendingDiaryEntryIds.clear();
    this.foodSettingsService.reset();
  }

  public setHeight(height: number | null): void {
    this.foodSettingsService.setHeight(height);
  }

  // diaryId: the entry being edited, or null while adding a not-yet-created one.
  public setDraftEntryWeight(dateISO: string, diaryId: number | null, foodCatalogueId: number, weight: number): void {
    this.draftEntryWeight$$.set({ dateISO, diaryId, foodCatalogueId, weight });
  }

  // No-ops unless diaryId still owns the current draft — safe to call from any form on
  // reset/submit/destroy without risking clearing another row's still-active draft.
  public clearDraftEntryWeight(diaryId: number | null): void {
    if (this.draftEntryWeight$$()?.diaryId === diaryId) {
      this.draftEntryWeight$$.set(null);
    }
  }

  // Used only for the unsaved/unconfirmed window where the server hasn't computed entry.kcals
  // yet: optimistic create/edit before the response arrives, and the live add/edit-form preview
  // (selectedDayTotals$$, via draftEntryWeight$$) — same rounding rule as the server, so the
  // preview and the post-save value are guaranteed to match.
  private estimateEntryKcalsNow(foodCatalogueId: number, foodWeight: number): number {
    const personalKcalsPer100g =
      this.personalKcalsService.personalKcals$$()[foodCatalogueId] ??
      this.catalogueService.catalogue$$()[foodCatalogueId]?.kcals ??
      0;
    return Math.round((foodWeight / 100) * personalKcalsPer100g);
  }

  public focusDiaryEntry(diaryEntryId: number): void {
    this.diaryEntryFocusId$$.set(diaryEntryId);
    setTimeout(() => this.diaryEntryFocusId$$.set(null), 100); // clearing the signal after a short delay
  }

  public resetDiaryEntryForm(diaryEntryId: number): void {
    this.diaryEntryResetId$$.set(diaryEntryId);
    setTimeout(() => this.diaryEntryResetId$$.set(null), 100); // clearing the signal after a short delay
  }

  public async getFoodDiaryFullUpdateRange(dateIso?: string, offset?: number): Promise<Diary> {
    const startedAt = performance.now();
    const date = dateIso ?? calculateTodayIsoWithUserTimeShift();
    const paramsStr = `date=${date}&offset=${offset ?? this.FIRST_SEGMENT_OFFSET_DAYS}`;

    const response = await firstValueFrom(this.http.get<Diary>(`/api/food/diary-full-update?${paramsStr}`));

    this.diaryRaw$$.update((diary) => this.mergeServerDiaryResponse(diary, response));
    Object.keys(response).forEach((responseDateIso) => this.persistDay(responseDateIso));
    void this.telemetry.recordAfterPaint('food.diary_segment_load', startedAt, {
      offsetDays: offset ?? this.FIRST_SEGMENT_OFFSET_DAYS,
      days: Object.keys(response).length,
      entries: Object.values(response).reduce((total, day) => total + Object.keys(day.food).length, 0),
    });
    return response;
  }

  public async createDiaryEntry(diaryEntry: DiaryEntry): Promise<{ result: boolean; diaryId: number }> {
    if (!this.checkNetworkAvailability()) {
      console.error('Network not available for creating diary entry');
      this.notificationService.addNotification('error', 'Нет соединения — запись не сохранена');
      return { result: false, diaryId: 0 };
    }

    const startedAt = performance.now();
    const tempId = Date.now();
    const originalDiary = { ...this.diaryRaw$$() };

    const kcalsDelta = this.estimateEntryKcalsNow(diaryEntry.foodCatalogueId, diaryEntry.foodWeight);
    const selectedDay = this.selectedDayIso$$();
    const nutrientsDelta = this.calculateEntryNutrients(diaryEntry);

    const entryWithTempId = { ...diaryEntry, id: tempId, kcals: kcalsDelta };

    this.updateDiaryEntryWithNewValues(entryWithTempId);
    this.updateNutrientsOptimistically(selectedDay, nutrientsDelta, kcalsDelta);
    this.persistDay(selectedDay);
    void this.telemetry.recordAfterPaint('food.diary_mutation', startedAt, { mutationType: 'create' });

    const successCallback = (response: ServerResponseWithDiaryId) => {
      if (response.result && response.diaryId) {
        this.reconcileCreatedDiaryEntry(tempId, response.diaryId, response.kcals, response.version);
      }
      this.mutationApplied$.next(selectedDay);
    };

    const rollbackFunction = () => {
      this.diaryRaw$$.set(originalDiary);
      this.persistDay(selectedDay);
    };

    this.addSyncOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.CREATE,
      endpoint: '/api/food/diary/',
      data: diaryEntry,
      successCallback: successCallback,
      rollbackCallback: rollbackFunction,
      feedback: {
        successMessage: 'Запись добавлена',
        errorMessage: 'Не удалось сохранить запись',
        pendingMessage: 'Сохраняю запись...',
      },
    });

    return { result: true, diaryId: tempId };
  }

  public async editDiaryEntry(diaryEntry: DiaryEntry): Promise<boolean> {
    if (!this.checkNetworkAvailability()) {
      console.error('Network not available for editing diary entry');
      this.notificationService.addNotification('error', 'Нет соединения — изменения не сохранены');
      return false;
    }

    const startedAt = performance.now();
    const originalDiary = { ...this.diaryRaw$$() };
    const selectedDay = this.selectedDayIso$$();
    const originalEntry = originalDiary[selectedDay]?.food[diaryEntry.id];

    if (!originalEntry) {
      console.error('Cannot edit diary entry: entry not found');
      this.notificationService.addNotification('error', 'Не удалось найти запись для редактирования');
      return false;
    }

    const originalKcals = originalEntry.kcals;
    const newKcals = this.estimateEntryKcalsNow(diaryEntry.foodCatalogueId, diaryEntry.foodWeight);
    const kcalsDelta = newKcals - originalKcals;

    const originalNutrients = this.calculateEntryNutrients(originalEntry);
    const newNutrients = this.calculateEntryNutrients(diaryEntry);
    const nutrientsDelta: NutrientDelta = {
      protein: newNutrients.protein - originalNutrients.protein,
      fat: newNutrients.fat - originalNutrients.fat,
      carbs: newNutrients.carbs - originalNutrients.carbs,
      fiber: newNutrients.fiber - originalNutrients.fiber,
    };

    const optimisticHistoryIndex = originalEntry.history.length;

    this.updateDiaryEntryWithNewValues({ ...diaryEntry, kcals: newKcals });
    this.updateNutrientsOptimistically(selectedDay, nutrientsDelta, kcalsDelta);
    this.persistDay(selectedDay);
    void this.telemetry.recordAfterPaint('food.diary_mutation', startedAt, { mutationType: 'edit' });

    this.pendingDiaryEntryIds.add(diaryEntry.id);

    const rollbackFunction = () => {
      this.pendingDiaryEntryIds.delete(diaryEntry.id);
      this.diaryRaw$$.set(originalDiary);
      this.persistDay(selectedDay);
    };

    const successCallback = (response: ServerResponseWithDiaryId) => {
      this.pendingDiaryEntryIds.delete(diaryEntry.id);
      if (response.result) {
        this.reconcileEditedDiaryEntry(
          diaryEntry.id,
          response.kcals,
          response.version,
          optimisticHistoryIndex,
          response.appliedHistoryEntry ?? null,
        );
      }
      this.mutationApplied$.next(selectedDay);
    };

    const editRequest: DiaryEntryToEdit = {
      id: diaryEntry.id,
      foodCatalogueId: diaryEntry.foodCatalogueId,
      foodWeight: diaryEntry.foodWeight,
      historyAction: diaryEntry.history[0].action,
    };

    this.addSyncOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.UPDATE,
      endpoint: '/api/food/diary',
      data: editRequest,
      successCallback: successCallback,
      rollbackCallback: rollbackFunction,
      feedback: {
        successMessage: 'Изменения сохранены',
        errorMessage: 'Не удалось сохранить изменения',
        pendingMessage: 'Сохраняю изменения...',
      },
    });

    return true;
  }

  public async deleteDiaryEntry(diaryEntryId: number): Promise<boolean> {
    if (!this.checkNetworkAvailability()) {
      console.error('Network not available for deleting diary entry');
      this.notificationService.addNotification('error', 'Нет соединения — запись не удалена');
      return false;
    }

    const startedAt = performance.now();
    const selectedDay = this.selectedDayIso$$();
    const originalDiary = { ...this.diaryRaw$$() };
    const deletedEntry = originalDiary[selectedDay]?.food[diaryEntryId];

    if (!deletedEntry) {
      console.error('Cannot delete diary entry: entry not found');
      this.notificationService.addNotification('error', 'Не удалось найти запись для удаления');
      return false;
    }

    const kcalsDelta = -deletedEntry.kcals;

    const deletedNutrients = this.calculateEntryNutrients(deletedEntry);
    const nutrientsDelta: NutrientDelta = {
      protein: -deletedNutrients.protein,
      fat: -deletedNutrients.fat,
      carbs: -deletedNutrients.carbs,
      fiber: -deletedNutrients.fiber,
    };

    this.removeDiaryEntry(diaryEntryId);
    this.updateNutrientsOptimistically(selectedDay, nutrientsDelta, kcalsDelta);
    this.persistDay(selectedDay);
    void this.telemetry.recordAfterPaint('food.diary_mutation', startedAt, { mutationType: 'delete' });

    this.pendingDiaryEntryIds.add(diaryEntryId);

    const rollbackFunction = () => {
      this.pendingDiaryEntryIds.delete(diaryEntryId);
      this.diaryRaw$$.set(originalDiary);
      this.persistDay(selectedDay);
    };

    this.addSyncOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.DELETE,
      endpoint: `/api/food/diary/${diaryEntryId}`,
      data: {},
      successCallback: () => {
        this.pendingDiaryEntryIds.delete(diaryEntryId);
        this.mutationApplied$.next(selectedDay);
      },
      rollbackCallback: rollbackFunction,
      feedback: {
        successMessage: 'Запись удалена',
        errorMessage: 'Не удалось удалить запись',
        pendingMessage: 'Удаляю запись...',
      },
    });

    return true;
  }

  public async deleteSelectedDayEntries(): Promise<boolean> {
    if (!this.checkNetworkAvailability()) {
      console.error('Network not available for deleting diary day entries');
      this.notificationService.addNotification('error', 'Нет соединения — записи не удалены');
      return false;
    }

    const startedAt = performance.now();
    const selectedDay = this.selectedDayIso$$();
    const originalDiary = { ...this.diaryRaw$$() };
    const deletedEntries = Object.values(originalDiary[selectedDay]?.food || {});

    if (!deletedEntries.length) {
      console.error('Cannot delete diary day entries: day is empty');
      return false;
    }

    const { kcalsDelta, nutrientsDelta } = this.calculateRemovedEntriesDelta(deletedEntries);
    const deletedDaySnapshot = this.createDeletedDaySnapshot(selectedDay, deletedEntries);

    this.saveDeletedDaySnapshot(deletedDaySnapshot);
    this.clearDiaryEntriesForDay(selectedDay);
    this.updateNutrientsOptimistically(selectedDay, nutrientsDelta, kcalsDelta);
    this.persistDay(selectedDay);
    void this.telemetry.recordAfterPaint('food.diary_mutation', startedAt, { mutationType: 'delete_day' });

    const rollbackFunction = () => {
      this.diaryRaw$$.set(originalDiary);
      this.persistDay(selectedDay);
      this.clearDeletedDaySnapshot();
    };

    this.addSyncOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.DELETE,
      endpoint: `/api/food/diary/day/${selectedDay}`,
      data: {},
      successCallback: () => this.mutationApplied$.next(selectedDay),
      rollbackCallback: rollbackFunction,
      feedback: {
        successMessage: 'Записи за день удалены',
        errorMessage: 'Не удалось удалить записи за день',
        pendingMessage: 'Удаляю записи за день...',
      },
    });

    return true;
  }

  public async restoreSelectedDayEntries(): Promise<boolean> {
    if (!this.checkNetworkAvailability()) {
      console.error('Network not available for restoring diary day entries');
      this.notificationService.addNotification('error', 'Нет соединения — день не восстановлен');
      return false;
    }

    const snapshot = this.selectedDayDeletedSnapshot$$();

    if (!snapshot?.entries.length) {
      console.error('Cannot restore diary day entries: snapshot not found');
      return false;
    }

    const startedAt = performance.now();
    const originalDiary = { ...this.diaryRaw$$() };
    const restoredEntries = this.cloneDiaryEntries(snapshot.entries);
    const tempEntries = restoredEntries.map((entry, index) => ({
      ...entry,
      id: Date.now() + index,
      dateISO: snapshot.dateISO,
    }));
    const { kcalsDelta, nutrientsDelta } = this.calculateAddedEntriesDelta(restoredEntries);

    this.clearDeletedDaySnapshot();
    this.addDiaryEntriesForDay(snapshot.dateISO, tempEntries);
    this.updateNutrientsOptimistically(snapshot.dateISO, nutrientsDelta, kcalsDelta);
    this.persistDay(snapshot.dateISO);
    void this.telemetry.recordAfterPaint('food.diary_mutation', startedAt, { mutationType: 'restore_day' });

    const successCallback = (response: ServerResponseWithDiaryEntries) => {
      if (response.result && response.diaryEntries?.length) {
        this.replaceDiaryEntriesForDay(snapshot.dateISO, tempEntries, response.diaryEntries);
      }
      this.mutationApplied$.next(snapshot.dateISO);
    };

    const rollbackFunction = () => {
      this.diaryRaw$$.set(originalDiary);
      this.persistDay(snapshot.dateISO);
      this.saveDeletedDaySnapshot(snapshot);
    };

    this.addSyncOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.CREATE,
      endpoint: `/api/food/diary/day/${snapshot.dateISO}/restore`,
      data: this.createDiaryDayRestoreRequest(restoredEntries),
      successCallback: successCallback,
      rollbackCallback: rollbackFunction,
      feedback: {
        successMessage: 'День восстановлен',
        errorMessage: 'Не удалось восстановить записи за день',
        pendingMessage: 'Восстанавливаю день...',
      },
    });

    return true;
  }

  private calculateEntryNutrients(entry: DiaryEntry): NutrientDelta {
    const portionMultiplier = entry.foodWeight / 100;
    const product = this.catalogueService.catalogue$$()[entry.foodCatalogueId];

    return {
      protein: Math.round((product?.protein || 0) * portionMultiplier),
      fat: Math.round((product?.fat || 0) * portionMultiplier),
      carbs: Math.round((product?.carbs || 0) * portionMultiplier),
      fiber: Math.round((product?.fiber || 0) * portionMultiplier),
    };
  }

  public async setUserBodyWeight(bodyWeight: BodyWeightInterface): Promise<boolean> {
    if (!this.checkNetworkAvailability()) {
      console.error('Network not available for setting body weight');
      this.notificationService.addNotification('error', 'Нет соединения — вес не сохранён');
      return false;
    }

    const startedAt = performance.now();
    const originalDiary = { ...this.diaryRaw$$() };
    const dateISO = bodyWeight.dateISO;

    const newWeight = Number(bodyWeight.bodyWeight);

    this.diaryRaw$$.update((diary) => {
      return {
        ...diary,
        [dateISO]: {
          ...diary[dateISO],
          bodyWeight: newWeight,
        },
      };
    });
    this.persistDay(dateISO);
    void this.telemetry.recordAfterPaint('food.diary_mutation', startedAt, { mutationType: 'body_weight' });

    const rollbackFunction = () => {
      this.diaryRaw$$.set(originalDiary);
      this.persistDay(dateISO);
    };

    this.addSyncOperation({
      mode: SyncOperationMode.Optimistic,
      type: SyncOperationType.CREATE,
      endpoint: '/api/food/body-weight',
      data: bodyWeight,
      successCallback: () => this.mutationApplied$.next(dateISO),
      rollbackCallback: rollbackFunction,
      feedback: {
        successMessage: 'Вес сохранён',
        errorMessage: 'Не удалось сохранить вес',
        pendingMessage: 'Сохраняю вес...',
      },
    });

    return true;
  }

  private subscribe(): void {
    this.subscribeToRealtimeUpdates();
  }

  private prepUnifiedDiary(): UnifiedDiary {
    const rawDiary = this.diaryRaw$$();
    const catalogue = this.catalogueService.catalogue$$();
    const result: UnifiedDiary = {};

    for (const [dateISO, day] of Object.entries(rawDiary)) {
      const foodEntries: DiaryEntryWithFullData[] = [];

      const targetKcals = day.nutrients?.targetKcals || 2000;
      // Diary entries are the source of truth for the daily calories. This keeps the
      // summary synchronized with an entry updated by another device or reconciled by the server.
      const consumedKcals = Object.values(day.food).reduce((total, entry) => total + entry.kcals, 0);
      const kcalsPercent = this.calculatePercentage(consumedKcals, targetKcals);

      for (const [id, entry] of Object.entries(day.food)) {
        const kcals = entry.kcals;
        const percentage = this.calculatePercentage(kcals, targetKcals);

        const formattedEntry: DiaryEntryWithFullData = {
          ...entry,
          foodName: catalogue[entry.foodCatalogueId]?.name || '',
          isFoodArchived: Boolean(catalogue[entry.foodCatalogueId]?.archived),
          foodKcals: kcals,
          foodPercent: this.formatPercentage(percentage),
          foodKcalPercentageOfDaysNorm: percentage,
        };

        foodEntries.push(formattedEntry);
      }

      result[dateISO] = {
        food: foodEntries,
        totals: {
          kcalsConsumed: consumedKcals,
          kcalsPercent,
          bodyWeight: day.bodyWeight,
          targetKcals,
          targetProtein: day.nutrients?.targetProtein || 0,
          targetFat: day.nutrients?.targetFat || 0,
          targetCarbs: day.nutrients?.targetCarbs || 0,
          targetFiber: day.nutrients?.targetFiber || 0,
          consumedProtein: day.nutrients?.consumedProtein || 0,
          consumedFat: day.nutrients?.consumedFat || 0,
          consumedCarbs: day.nutrients?.consumedCarbs || 0,
          consumedFiber: day.nutrients?.consumedFiber || 0,
        },
      };
    }

    return result;
  }

  private formatPercentage(percent: number): string {
    return Math.floor(percent) < 100 ? percent.toFixed(1) : Math.round(percent).toString();
  }

  private calculatePercentage(kcals: number, targetKcals: number): number {
    if (targetKcals === 0) return 0;
    return (kcals / targetKcals) * 100;
  }

  private extractSelectedDayTotals(): DayTotals {
    const selectedDay = this.selectedDayIso$$();
    const defaultTotals: DayTotals = {
      kcalsConsumed: 0,
      kcalsPercent: 0,
      bodyWeight: null,
      targetKcals: 2000,
      targetProtein: 0,
      targetFat: 0,
      targetCarbs: 0,
      targetFiber: 0,
      consumedProtein: 0,
      consumedFat: 0,
      consumedCarbs: 0,
      consumedFiber: 0,
    };

    const totals = this.diary$$()[selectedDay]?.totals || defaultTotals;

    const draft = this.draftEntryWeight$$();
    if (!draft || draft.dateISO !== selectedDay) return totals;

    const previousKcals =
      draft.diaryId !== null ? (this.diaryRaw$$()[selectedDay]?.food[draft.diaryId]?.kcals ?? 0) : 0;
    const projectedKcals = this.estimateEntryKcalsNow(draft.foodCatalogueId, draft.weight);
    const kcalsConsumed = totals.kcalsConsumed - previousKcals + projectedKcals;

    return {
      ...totals,
      kcalsConsumed,
      kcalsPercent: this.calculatePercentage(kcalsConsumed, totals.targetKcals),
    };
  }

  private updateNutrientsOptimistically(dateISO: string, nutrientsDelta: NutrientDelta, kcalsDelta: number): void {
    this.diaryRaw$$.update((diary) => {
      const updatedDiary = { ...diary };
      const dayData = updatedDiary[dateISO];

      if (dayData) {
        const currentNutrients = dayData.nutrients || DEFAULT_NUTRIENTS;

        updatedDiary[dateISO] = {
          ...dayData,
          nutrients: {
            ...currentNutrients,
            consumedKcals: (currentNutrients.consumedKcals || 0) + kcalsDelta,
            consumedProtein: (currentNutrients.consumedProtein || 0) + nutrientsDelta.protein,
            consumedFat: (currentNutrients.consumedFat || 0) + nutrientsDelta.fat,
            consumedCarbs: (currentNutrients.consumedCarbs || 0) + nutrientsDelta.carbs,
            consumedFiber: (currentNutrients.consumedFiber || 0) + nutrientsDelta.fiber,
          },
        };
      }

      return updatedDiary;
    });
  }

  private calculateRemovedEntriesDelta(entries: DiaryEntry[]): { kcalsDelta: number; nutrientsDelta: NutrientDelta } {
    return entries.reduce(
      (acc, entry) => {
        const entryNutrients = this.calculateEntryNutrients(entry);

        acc.kcalsDelta -= entry.kcals;
        acc.nutrientsDelta.protein -= entryNutrients.protein;
        acc.nutrientsDelta.fat -= entryNutrients.fat;
        acc.nutrientsDelta.carbs -= entryNutrients.carbs;
        acc.nutrientsDelta.fiber -= entryNutrients.fiber;

        return acc;
      },
      {
        kcalsDelta: 0,
        nutrientsDelta: {
          protein: 0,
          fat: 0,
          carbs: 0,
          fiber: 0,
        },
      },
    );
  }

  private calculateAddedEntriesDelta(entries: DiaryEntry[]): { kcalsDelta: number; nutrientsDelta: NutrientDelta } {
    return entries.reduce(
      (acc, entry) => {
        const entryNutrients = this.calculateEntryNutrients(entry);

        acc.kcalsDelta += entry.kcals;
        acc.nutrientsDelta.protein += entryNutrients.protein;
        acc.nutrientsDelta.fat += entryNutrients.fat;
        acc.nutrientsDelta.carbs += entryNutrients.carbs;
        acc.nutrientsDelta.fiber += entryNutrients.fiber;

        return acc;
      },
      {
        kcalsDelta: 0,
        nutrientsDelta: {
          protein: 0,
          fat: 0,
          carbs: 0,
          fiber: 0,
        },
      },
    );
  }

  private updateDiaryEntryWithNewValues(updatedDiaryEntry: DiaryEntry): void {
    this.diaryRaw$$.update((oldDiary) => {
      const selectedDay = this.selectedDayIso$$();
      const updatedDiary = { ...oldDiary };
      const updatedDay = { ...updatedDiary[selectedDay] };
      const updatedFood = { ...updatedDay.food };

      if (!updatedFood[updatedDiaryEntry.id]) {
        updatedFood[updatedDiaryEntry.id] = {
          id: updatedDiaryEntry.id,
          dateISO: selectedDay,
          foodCatalogueId: updatedDiaryEntry.foodCatalogueId,
          foodWeight: updatedDiaryEntry.foodWeight,
          kcals: updatedDiaryEntry.kcals,
          history: [],
        };
      }

      updatedFood[updatedDiaryEntry.id] = {
        ...updatedFood[updatedDiaryEntry.id],
        foodWeight: updatedDiaryEntry.foodWeight,
        kcals: updatedDiaryEntry.kcals,
        history: [...updatedFood[updatedDiaryEntry.id].history, ...updatedDiaryEntry.history],
      };

      updatedDay.food = updatedFood;
      updatedDiary[selectedDay] = updatedDay;
      return updatedDiary;
    });
  }

  private addDiaryEntriesForDay(dateISO: string, diaryEntries: DiaryEntry[]): void {
    this.diaryRaw$$.update((oldDiary) => {
      const updatedDiary = { ...oldDiary };
      const updatedDay = updatedDiary[dateISO]
        ? { ...updatedDiary[dateISO] }
        : {
            food: {},
            bodyWeight: null,
            nutrients: DEFAULT_NUTRIENTS,
          };
      const updatedFood = { ...updatedDay.food };

      diaryEntries.forEach((diaryEntry) => {
        updatedFood[diaryEntry.id] = {
          ...diaryEntry,
          dateISO,
          history: [...diaryEntry.history],
        };
      });

      updatedDay.food = updatedFood;
      updatedDiary[dateISO] = updatedDay;
      return updatedDiary;
    });
  }

  private removeDiaryEntry(diaryEntryId: number): void {
    this.diaryRaw$$.update((oldDiary) => {
      const selectedDay = this.selectedDayIso$$();
      const updatedDiary = { ...oldDiary };
      const updatedDay = { ...updatedDiary[selectedDay] };
      const updatedFood = { ...updatedDay.food };

      delete updatedFood[diaryEntryId];

      updatedDay.food = updatedFood;
      updatedDiary[selectedDay] = updatedDay;
      return updatedDiary;
    });
  }

  private replaceDiaryEntriesForDay(dateISO: string, tempEntries: DiaryEntry[], diaryEntries: DiaryEntry[]): void {
    this.diaryRaw$$.update((oldDiary) => {
      const updatedDiary = { ...oldDiary };
      const updatedDay = updatedDiary[dateISO] ? { ...updatedDiary[dateISO] } : null;

      if (!updatedDay) {
        return updatedDiary;
      }

      const updatedFood = { ...updatedDay.food };

      tempEntries.forEach((tempEntry, index) => {
        const restoredEntry = diaryEntries[index];

        if (!restoredEntry) {
          return;
        }

        delete updatedFood[tempEntry.id];
        updatedFood[restoredEntry.id] = restoredEntry;
      });

      updatedDay.food = updatedFood;
      updatedDiary[dateISO] = updatedDay;
      return updatedDiary;
    });

    this.persistDay(dateISO);
  }

  private clearDiaryEntriesForDay(dateISO: string): void {
    this.diaryRaw$$.update((oldDiary) => {
      const updatedDiary = { ...oldDiary };
      const updatedDay = updatedDiary[dateISO];

      if (!updatedDay) {
        return updatedDiary;
      }

      updatedDiary[dateISO] = {
        ...updatedDay,
        food: {},
      };

      return updatedDiary;
    });
  }

  private reconcileCreatedDiaryEntry(tempId: number, realId: number, kcals: number, version: number): void {
    this.diaryRaw$$.update((oldDiary) => {
      const selectedDay = this.selectedDayIso$$();
      const updatedDiary = { ...oldDiary };
      const updatedDay = { ...updatedDiary[selectedDay] };
      const updatedFood = { ...updatedDay.food };

      if (updatedFood[tempId]) {
        const entry = { ...updatedFood[tempId], id: realId, kcals, version };
        updatedFood[realId] = entry;
        delete updatedFood[tempId];
      }

      updatedDay.food = updatedFood;
      updatedDiary[selectedDay] = updatedDay;
      return updatedDiary;
    });
    this.persistDay(this.selectedDayIso$$());
  }

  private reconcileEditedDiaryEntry(
    diaryEntryId: number,
    kcals: number,
    version: number,
    optimisticHistoryIndex: number,
    appliedHistoryEntry: HistoryEntry | null,
  ): void {
    this.diaryRaw$$.update((oldDiary) => {
      const selectedDay = this.selectedDayIso$$();
      const updatedDiary = { ...oldDiary };
      const updatedDay = { ...updatedDiary[selectedDay] };
      const updatedFood = { ...updatedDay.food };
      const entry = updatedFood[diaryEntryId];

      if (entry) {
        const history = [
          ...entry.history.slice(0, optimisticHistoryIndex),
          ...entry.history.slice(optimisticHistoryIndex + 1),
        ];
        if (appliedHistoryEntry) {
          history.splice(optimisticHistoryIndex, 0, appliedHistoryEntry);
        }
        updatedFood[diaryEntryId] = { ...entry, kcals, version, history };
      }

      updatedDay.food = updatedFood;
      updatedDiary[selectedDay] = updatedDay;
      return updatedDiary;
    });
    this.persistDay(this.selectedDayIso$$());
  }

  private loadDeletedDaySnapshotFromLocalStorage(): void {
    const snapshot = this.localStorageService.getUserScoped<DeletedDiaryDaySnapshot>(
      this.DELETED_DAY_SNAPSHOT_STORAGE_KEY,
    );

    if (snapshot?.dateISO && Array.isArray(snapshot.entries)) {
      this.deletedDaySnapshot$$.set(snapshot);
    }
  }

  private saveDeletedDaySnapshot(snapshot: DeletedDiaryDaySnapshot): void {
    this.deletedDaySnapshot$$.set(snapshot);
    this.localStorageService.setUserScoped(this.DELETED_DAY_SNAPSHOT_STORAGE_KEY, snapshot);
  }

  private clearDeletedDaySnapshot(): void {
    this.deletedDaySnapshot$$.set(null);
    this.localStorageService.removeUserScoped(this.DELETED_DAY_SNAPSHOT_STORAGE_KEY);
  }

  private createDeletedDaySnapshot(dateISO: string, entries: DiaryEntry[]): DeletedDiaryDaySnapshot {
    return {
      dateISO,
      entries: this.cloneDiaryEntries(entries),
    };
  }

  private createDiaryDayRestoreRequest(entries: DiaryEntry[]): DiaryDayRestoreRequest {
    return {
      entries: entries.map((entry): DiaryEntryToRestore => ({
        foodCatalogueId: entry.foodCatalogueId,
        foodWeight: entry.foodWeight,
        history: [...entry.history],
      })),
    };
  }

  private cloneDiaryEntries(entries: DiaryEntry[]): DiaryEntry[] {
    return entries.map((entry) => ({
      ...entry,
      history: [...entry.history],
    }));
  }

  private addDaysToIso(dateISO: string, days: number): string {
    const date = new Date(dateISO);
    date.setDate(date.getDate() + days);
    return dateToIsoNoTimeNoTZ(date);
  }

  private daysBetween(fromIso: string, toIso: string): number {
    return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24));
  }

  // Confirmed segments plus windows still being fetched — see field comment on pendingSegments
  // for why an in-flight window counts as covered too.
  private allKnownSegments(): DiarySegment[] {
    return [...this.segments, ...this.pendingSegments];
  }

  private isDateCovered(dateISO: string): boolean {
    return this.allKnownSegments().some((segment) => dateISO >= segment.start && dateISO <= segment.end);
  }

  private findContainingSegment(dateISO: string): DiarySegment | undefined {
    return this.allKnownSegments().find((segment) => dateISO >= segment.start && dateISO <= segment.end);
  }

  // Segments touch or overlap once neither one's start is more than a day past the other's end.
  private segmentsTouch(a: DiarySegment, b: DiarySegment): boolean {
    return a.start <= this.addDaysToIso(b.end, 1) && b.start <= this.addDaysToIso(a.end, 1);
  }

  private addSegment(newSegment: DiarySegment): void {
    const merged: DiarySegment[] = [];
    let current = { ...newSegment };

    for (const segment of this.segments) {
      if (this.segmentsTouch(current, segment)) {
        current = {
          start: current.start < segment.start ? current.start : segment.start,
          end: current.end > segment.end ? current.end : segment.end,
        };
      } else {
        merged.push(segment);
      }
    }

    merged.push(current);
    this.segments = merged;
  }

  // Single entry point for both "just landed on a date nowhere near anything loaded" (calendar
  // jump) and "walking day by day, approaching the edge of what's already loaded" — both reduce
  // to the same question: is this date, or the next one just past it, covered by a segment yet.
  // Returns once every fetch this call kicked off (there can be up to two, one per edge) settles —
  // used by ensureTodaySegmentLoaded() so the reconnect coordinator can await the initial paint.
  private async ensureSegmentCoverage(dateISO: string): Promise<void> {
    const containingSegment = this.findContainingSegment(dateISO);
    const pending: Promise<void>[] = [];

    if (!containingSegment) {
      pending.push(this.fetchSegmentAround(dateISO));
    } else {
      const daysToStart = this.daysBetween(containingSegment.start, dateISO);
      const daysToEnd = this.daysBetween(dateISO, containingSegment.end);

      if (daysToStart <= this.EDGE_THRESHOLD_DAYS) {
        const beyondStart = this.addDaysToIso(containingSegment.start, -1);
        if (!this.isDateCovered(beyondStart)) pending.push(this.fetchSegmentAround(beyondStart));
      }

      if (daysToEnd <= this.EDGE_THRESHOLD_DAYS) {
        const beyondEnd = this.addDaysToIso(containingSegment.end, 1);
        if (!this.isDateCovered(beyondEnd)) pending.push(this.fetchSegmentAround(beyondEnd));
      }
    }

    await Promise.all(pending);
  }

  // Diary's own share of the reconnect coordinator's initial-load sequence (§2.4) — piggybacks on
  // the same segment-coverage/dedup logic the reactive selectedDayIso$$ effect already uses (see
  // ensureDiarySegmentEffect$$), so calling this never double-fetches even if that effect already
  // kicked off the same first segment moments earlier.
  public ensureTodaySegmentLoaded(): Promise<void> {
    return this.ensureSegmentCoverage(calculateTodayIsoWithUserTimeShift());
  }

  // First segment of the session is small (the common case), every subsequent one is large (see
  // field comment on NEXT_SEGMENT_OFFSET_DAYS) — sized off "is this the first segment", not off
  // distance from today. "First" means first fetch kicked off this session, confirmed or still
  // pending — a second navigation landing while the first fetch is still in flight is not a
  // first segment either.
  private fetchSegmentAround(centerDate: string): Promise<void> {
    if (this.isDateCovered(centerDate)) return Promise.resolve();

    const isFirstFetchOfSession = this.segments.length === 0 && this.pendingSegments.length === 0;
    const offsetDays = isFirstFetchOfSession ? this.FIRST_SEGMENT_OFFSET_DAYS : this.NEXT_SEGMENT_OFFSET_DAYS;
    const window: DiarySegment = {
      start: this.addDaysToIso(centerDate, -offsetDays),
      end: this.addDaysToIso(centerDate, offsetDays),
    };

    this.pendingSegments.push(window);

    return this.getFoodDiaryFullUpdateRange(centerDate, offsetDays)
      .then(() => this.addSegment(window))
      .catch((error) => console.error('Failed fetching diary segment:', error))
      .finally(() => {
        this.pendingSegments = this.pendingSegments.filter((segment) => segment !== window);
      });
  }

  private persistDay(dateISO: string): void {
    const day = this.diaryRaw$$()[dateISO];
    if (day) void this.indexedDbCache.setDay(dateISO, day);
  }

  // A full-reload response can legitimately reflect not-yet-committed server state for an
  // entry we have a pending edit/delete queued for (see pendingDiaryEntryIds). For those
  // entries specifically, keep our own state instead of accepting the response's.
  private mergeServerDiaryResponse(current: Diary, response: Diary): Diary {
    if (this.pendingDiaryEntryIds.size === 0) {
      return { ...current, ...response };
    }

    const merged: Diary = { ...current, ...response };

    for (const dateISO of Object.keys(response)) {
      const currentDay = current[dateISO];
      if (!currentDay) continue;

      const food = { ...response[dateISO].food };
      for (const pendingId of this.pendingDiaryEntryIds) {
        if (currentDay.food[pendingId]) {
          food[pendingId] = currentDay.food[pendingId];
        } else {
          delete food[pendingId];
        }
      }

      merged[dateISO] = { ...response[dateISO], food };
    }

    return merged;
  }

  // Local-only, no network — instant paint for whichever day was just selected, from a prior
  // session's cache if any. Runs before ensureSegmentCoverage (which does hit the network) on
  // every selectedDayIso$$ change, not just at startup. Skipped if the day is already in memory
  // — either from an earlier hydration or because a segment fetch already resolved it, in which
  // case that data is at least as fresh as IndexedDB's, so touching it here would only risk
  // clobbering it with a stale copy the moment the async read completes.
  private hydrateDayFromIndexedDb(dateISO: string): void {
    if (this.diaryRaw$$()[dateISO]) return;

    this.indexedDbCache.getDay<DiaryDay>(dateISO).then((day) => {
      if (!day) return;
      this.diaryRaw$$.update((diary) => (diary[dateISO] ? diary : { ...diary, [dateISO]: day }));
    });
  }

  private subscribeToRealtimeUpdates(): void {
    this.networkService.wsMessages$.subscribe((message: IncomingWsMessage) => {
      if (!message?.type) return;

      switch (message.type) {
        case WebSocketMessageType.DIARY_ENTRY_CREATED:
          if (this.isValidNewDiaryEntryPayload(message.payload)) {
            this.handleDiaryEntryCreated(message.payload);
          }
          break;

        case WebSocketMessageType.DIARY_ENTRY_UPDATED:
          if (this.isValidUpdatedDiaryEntryPayload(message.payload)) {
            this.handleDiaryEntryUpdated(message.payload);
          }
          break;

        case WebSocketMessageType.DIARY_ENTRY_DELETED:
          if (this.isValidDeletedDiaryEntryPayload(message.payload)) {
            this.handleDiaryEntryDeleted(message.payload.deletedDiaryEntryId);
          }
          break;

        case WebSocketMessageType.DIARY_DAY_DELETED:
          if (this.isValidDeletedDiaryDayPayload(message.payload)) {
            this.handleDiaryDayDeleted(message.payload.dateISO);
          }
          break;

        case WebSocketMessageType.BODY_WEIGHT_UPDATED:
          if (this.isValidBodyWeightUpdatePayload(message.payload)) {
            this.handleBodyWeightUpdated(message.payload);
          }
          break;
      }
    });
  }

  private isValidNewDiaryEntryPayload(payload: DiaryEntryToCreate): payload is DiaryEntryToCreate {
    return (
      payload &&
      typeof payload.id === 'number' &&
      typeof payload.dateISO === 'string' &&
      typeof payload.foodCatalogueId === 'number' &&
      typeof payload.foodWeight === 'number' &&
      typeof payload.kcals === 'number' &&
      Array.isArray(payload.history)
    );
  }

  private handleDiaryEntryCreated(diaryEntry: DiaryEntryToCreate): void {
    const dateISO = diaryEntry.dateISO;

    this.diaryRaw$$.update((diary) => {
      const updatedDiary = { ...diary };
      const dayData = updatedDiary[dateISO] || {
        food: {},
        bodyWeight: null,
        nutrients: DEFAULT_NUTRIENTS,
      };

      updatedDiary[dateISO] = {
        ...dayData,
        food: {
          ...dayData.food,
          [diaryEntry.id]: diaryEntry,
        },
      };

      return updatedDiary;
    });

    this.persistDay(dateISO);

    const kcalsDelta = diaryEntry.kcals;
    const nutrientsDelta = this.calculateEntryNutrients(diaryEntry);

    this.updateNutrientsOptimistically(dateISO, nutrientsDelta, kcalsDelta);
    this.mutationApplied$.next(dateISO);
  }

  private isValidUpdatedDiaryEntryPayload(payload: DiaryEntryToUpdate): payload is DiaryEntryToUpdate {
    return (
      payload &&
      typeof payload.id === 'number' &&
      typeof payload.newFoodWeight === 'number' &&
      typeof payload.newKcals === 'number' &&
      typeof payload.version === 'number' &&
      this.isValidHistoryEntry(payload.newHistoryEntry)
    );
  }

  private isValidHistoryEntry(historyEntry: HistoryEntry): historyEntry is HistoryEntry {
    return historyEntry && typeof historyEntry.action === 'string' && typeof historyEntry.value === 'number';
  }

  private handleDiaryEntryUpdated(updatedDiaryEntry: DiaryEntryToUpdate): void {
    const originalDiary = this.diaryRaw$$();
    let originalEntry: DiaryEntry | null = null;
    let dateISO: string | null = null;

    for (const [date, dayData] of Object.entries(originalDiary)) {
      if (dayData.food[updatedDiaryEntry.id]) {
        originalEntry = dayData.food[updatedDiaryEntry.id];
        dateISO = date;
        break;
      }
    }

    if (!originalEntry || !dateISO) {
      console.warn('Cannot update diary entry: original entry not found', updatedDiaryEntry.id);
      return;
    }

    // A realtime update can arrive out of order relative to what we've already applied
    // (e.g. from another tab/device) — discard it if it's not newer than what we have.
    if (typeof originalEntry.version === 'number' && updatedDiaryEntry.version <= originalEntry.version) {
      return;
    }

    const originalKcals = originalEntry.kcals;

    const updatedEntry: DiaryEntry = {
      ...originalEntry,
      foodWeight: updatedDiaryEntry.newFoodWeight,
      kcals: updatedDiaryEntry.newKcals,
      history: [...originalEntry.history, updatedDiaryEntry.newHistoryEntry],
      version: updatedDiaryEntry.version,
    };

    this.diaryRaw$$.update((diary) => {
      const updatedDiary = { ...diary };
      const dayData = updatedDiary[dateISO!];

      if (dayData) {
        updatedDiary[dateISO!] = {
          ...dayData,
          food: {
            ...dayData.food,
            [updatedDiaryEntry.id]: updatedEntry,
          },
        };
      }

      return updatedDiary;
    });

    this.persistDay(dateISO);

    const newKcals = updatedDiaryEntry.newKcals;
    const kcalsDelta = newKcals - originalKcals;
    const originalNutrients = this.calculateEntryNutrients(originalEntry);
    const updatedNutrients = this.calculateEntryNutrients(updatedEntry);
    const nutrientsDelta: NutrientDelta = {
      protein: updatedNutrients.protein - originalNutrients.protein,
      fat: updatedNutrients.fat - originalNutrients.fat,
      carbs: updatedNutrients.carbs - originalNutrients.carbs,
      fiber: updatedNutrients.fiber - originalNutrients.fiber,
    };

    this.updateNutrientsOptimistically(dateISO, nutrientsDelta, kcalsDelta);
    this.mutationApplied$.next(dateISO);
  }

  private isValidDeletedDiaryEntryPayload(payload: DiaryEntryToDelete): payload is DiaryEntryToDelete {
    return payload && typeof payload.deletedDiaryEntryId === 'number';
  }

  private isValidDeletedDiaryDayPayload(payload: DiaryDayToDelete): payload is DiaryDayToDelete {
    return payload && typeof payload.dateISO === 'string';
  }

  private handleDiaryEntryDeleted(deletedDiaryEntryId: number): void {
    const originalDiary = this.diaryRaw$$();
    let deletedEntry: DiaryEntry | null = null;
    let dateISO: string | null = null;

    for (const [date, dayData] of Object.entries(originalDiary)) {
      if (dayData.food[deletedDiaryEntryId]) {
        deletedEntry = dayData.food[deletedDiaryEntryId];
        dateISO = date;
        break;
      }
    }

    if (!deletedEntry || !dateISO) {
      console.warn('Cannot delete diary entry: entry not found', deletedDiaryEntryId);
      return;
    }

    const { kcalsDelta, nutrientsDelta } = this.calculateRemovedEntriesDelta([deletedEntry]);

    this.diaryRaw$$.update((diary) => {
      const updatedDiary = { ...diary };
      const dayData = updatedDiary[dateISO!];

      if (dayData) {
        const updatedFood = { ...dayData.food };
        delete updatedFood[deletedDiaryEntryId];

        updatedDiary[dateISO!] = {
          ...dayData,
          food: updatedFood,
        };
      }

      return updatedDiary;
    });

    this.persistDay(dateISO);
    this.updateNutrientsOptimistically(dateISO, nutrientsDelta, kcalsDelta);
    this.mutationApplied$.next(dateISO);
  }

  private handleDiaryDayDeleted(dateISO: string): void {
    const deletedEntries = Object.values(this.diaryRaw$$()[dateISO]?.food || {});

    if (!deletedEntries.length) {
      return;
    }

    const { kcalsDelta, nutrientsDelta } = this.calculateRemovedEntriesDelta(deletedEntries);

    this.clearDiaryEntriesForDay(dateISO);
    this.updateNutrientsOptimistically(dateISO, nutrientsDelta, kcalsDelta);
    this.persistDay(dateISO);
    this.mutationApplied$.next(dateISO);
  }

  private isValidBodyWeightUpdatePayload(payload: BodyWeightToUpdate): payload is BodyWeightToUpdate {
    return payload && typeof payload.dateISO === 'string' && typeof payload.newBodyWeight === 'number';
  }

  private handleBodyWeightUpdated(bodyWeightToUpdate: BodyWeightToUpdate): void {
    this.diaryRaw$$.update((diary) => {
      const updatedDiary = { ...diary };
      const dayData = updatedDiary[bodyWeightToUpdate.dateISO] || {
        food: {},
        bodyWeight: null,
        nutrients: DEFAULT_NUTRIENTS,
      };

      updatedDiary[bodyWeightToUpdate.dateISO] = {
        ...dayData,
        bodyWeight: bodyWeightToUpdate.newBodyWeight,
      };

      return updatedDiary;
    });

    this.persistDay(bodyWeightToUpdate.dateISO);
    this.mutationApplied$.next(bodyWeightToUpdate.dateISO);
  }
}
