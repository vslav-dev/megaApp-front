import { computed, effect, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { exhaustRequest } from '@app/shared/decorators/exhaust-request.decorator';
import {
  aggregateChartData,
  AggregatedChartData,
  createEmptyChartData,
  sliceAggregatedChartData,
  sliceChartData,
} from '@app/shared/stats-chart-data';
import { FoodStatsResponse, FoodStatsSummary, FoodStatsTopProduct, Stats, StatsChartData } from '@app/shared/types';
import { firstValueFrom } from 'rxjs';
import { dateToIsoNoTimeNoTZ, formatDateTicks, isoDaysBefore } from '../../shared/utils';
import { TelemetryService } from '../telemetry.service';
import { BaseFoodService } from './food-base.service';
import { FoodDiaryService } from './food-diary.service';
import { FoodProductHistoryStateService } from './food-product-history-state.service';
import { FoodSettingsService } from './food-settings.service';

const LIVE_WINDOW_DAYS = 3;

// Fallback for a stale pre-migration localStorage cache / an older server build's response, neither
// of which carries `summary` yet — same reasoning as the `?? []` fallbacks in applyResponse().
const EMPTY_STATS_SUMMARY: FoodStatsSummary = {
  daysInDiary: 0,
  minWeight: null,
  maxWeight: null,
  mostCaloricDay: null,
  leastCaloricDay: null,
  weightChangeSinceStartKg: null,
  yearAgo: null,
};

// Must match the backend's defaultStatsWindowDays (megaapp-back/internal/food/service.go) — the
// number of recent days GET /api/food/stats returns without the ?from=all opt-in. Used to decide
// whether a requested clip can be satisfied by the default window or needs ensureFullHistoryLoaded().
const DEFAULT_STATS_WINDOW_DAYS = 90;

@Service()
export class FoodStatsService extends BaseFoodService {
  private static readonly DAYS_IN_YEAR = 365;
  private static readonly GRANULARITY_WEEK_SWITCH_DAYS = 370;
  private static readonly GRANULARITY_MONTH_SWITCH_YEARS = 4;
  private static readonly GRANULARITY_MONTH_SWITCH_DAYS =
    FoodStatsService.GRANULARITY_MONTH_SWITCH_YEARS * FoodStatsService.DAYS_IN_YEAR;

  private readonly STATS_STORAGE_KEY = 'food_stats';

  protected getStorageKey(): string {
    return this.STATS_STORAGE_KEY;
  }

  private readonly foodSettingsService = inject(FoodSettingsService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly productHistoryState = inject(FoodProductHistoryStateService);

  private readonly stats$$: WritableSignal<Stats> = signal({});
  private readonly summarySignal$$: WritableSignal<FoodStatsSummary> = signal(EMPTY_STATS_SUMMARY);
  public readonly summary$$: Signal<FoodStatsSummary> = this.summarySignal$$.asReadonly();
  private readonly topProductsByKcalSignal$$: WritableSignal<FoodStatsTopProduct[]> = signal([]);
  private readonly topProductsByWeightSignal$$: WritableSignal<FoodStatsTopProduct[]> = signal([]);
  private readonly topProductsWindowTotalKcalSignal$$: WritableSignal<number> = signal(0);
  private readonly topProductsWindowTotalWeightSignal$$: WritableSignal<number> = signal(0);
  private readonly totalEntriesSignal$$: WritableSignal<number> = signal(0);
  public readonly topProductsByKcal$$: Signal<FoodStatsTopProduct[]> = this.topProductsByKcalSignal$$.asReadonly();
  public readonly topProductsByWeight$$: Signal<FoodStatsTopProduct[]> = this.topProductsByWeightSignal$$.asReadonly();
  public readonly topProductsWindowTotalKcal$$: Signal<number> = this.topProductsWindowTotalKcalSignal$$.asReadonly();
  public readonly topProductsWindowTotalWeight$$: Signal<number> =
    this.topProductsWindowTotalWeightSignal$$.asReadonly();
  public readonly totalEntries$$: Signal<number> = this.totalEntriesSignal$$.asReadonly();

  // The last LIVE_WINDOW_DAYS calendar days (today included) are shown live-derived from the
  // diary instead of the stored/cached value (§2.3 of plan 28) — the diary already has both kcal
  // sum and bodyWeight per day (DiaryDay.totals), and its own first segment always covers this
  // window, so this needs no extra request and no manual patch on every diary mutation. A day
  // outside the window keeps the stored value as-is; see foodDiaryService.mutationApplied$
  // subscription below for how that value eventually catches up.
  //
  // targetKcal/weightAvg are NOT re-derived here even for in-window days — they come from
  // settings/a smoothing window wider than one day, not from diary entries, so the stored value
  // is authoritative for them regardless of the live window.
  private readonly displayStats$$: Signal<Stats> = computed(() => {
    const stored = this.stats$$();
    const diary = this.foodDiaryService.diary$$();
    const merged: Stats = { ...stored };

    for (const dateISO of this.liveWindowDates()) {
      const day = diary[dateISO];
      if (!day) continue;
      const existing = stored[dateISO];
      merged[dateISO] = {
        weight: day.totals.bodyWeight ?? existing?.weight ?? Number.NaN,
        weightAvg: existing?.weightAvg ?? Number.NaN,
        consumedKcal: day.totals.kcalsConsumed,
        targetKcal: existing?.targetKcal ?? Number.NaN,
        hasNoData: existing ? existing.hasNoData && day.food.length === 0 : day.food.length === 0,
      };
    }

    return merged;
  });

  // Chronologically sorted dates actually loaded into stats$$/displayStats$$ — i.e. the real
  // fetched window (90 days by default, or the full account history once ensureFullHistoryLoaded()
  // has resolved), *not* padded with the placeholder days prepareChartData() adds below. Public so
  // callers that need "how many days did we really fetch" (e.g. telemetry) don't have to read
  // statsChartData$$().dates, which is always padded to the account's full daysInDiary.
  public readonly loadedDates$$: Signal<string[]> = computed(() => Object.keys(this.displayStats$$()).sort());

  public readonly statsChartData$$: Signal<StatsChartData> = computed(() =>
    this.telemetry.measure(
      'food.stats_base_model',
      () => this.prepareChartData(),
      (result) => ({ days: result.dates.length }),
    ),
  );
  public readonly statsChartDataClipped$$: Signal<StatsChartData> = computed(() =>
    this.telemetry.measure(
      'food.stats_clipped_model',
      () => this.prepareChartDataClipped(),
      (result) => ({ days: result.dates.length }),
    ),
  );

  private readonly weeklyAggregated$$: Signal<AggregatedChartData> = computed(() =>
    this.telemetry.measure(
      'food.stats_aggregate_week',
      () => aggregateChartData(this.statsChartData$$(), 'week'),
      (result) => ({ periods: result.data.dates.length }),
    ),
  );
  private readonly monthlyAggregated$$: Signal<AggregatedChartData> = computed(() =>
    this.telemetry.measure(
      'food.stats_aggregate_month',
      () => aggregateChartData(this.statsChartData$$(), 'month'),
      (result) => ({ periods: result.data.dates.length }),
    ),
  );

  public readonly selectedDateIdxStart$$: WritableSignal<number> = signal(0);
  public readonly selectedDateIdxEnd$$: WritableSignal<number> = signal(0);

  private readonly authService = inject(AuthService);
  private readonly telemetry = inject(TelemetryService);

  // Once true, every getStats() call (from anywhere — the reconnect coordinator included) fetches
  // full history instead of the default recent window, so a user who has explicitly widened their
  // view never sees it silently regress back to the last 90 days on a routine background refresh.
  // Monotonic for the session — never set back to false except by reset(). This is the *desired*
  // completeness, set as soon as ensureFullHistoryLoaded() is called — not proof that full data has
  // actually landed yet (see fullHistoryApplied below for that).
  private hasFullHistoryLoaded = false;

  // True once a full-history response has actually been applied. Separate from
  // hasFullHistoryLoaded (desire) on purpose: fetchAndApply() uses this, not the desire flag, to
  // decide whether a windowed response may still be applied — a windowed request that resolves
  // while the full-history request is still in flight is happily shown (partial-but-correct beats
  // a blank screen if the full request is slow or fails); only once full history has actually
  // landed does a later, slower windowed response get discarded instead of regressing the view.
  private fullHistoryApplied = false;

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  constructor() {
    super();
    this.loadStatsFromLocalStorageOnInit();
    // Refetch after every diary/weight mutation, live-window dates included — milestones (summary$$)
    // only ever come from a real server response (see summary$$ below), so a live-window edit that
    // skipped this would leave "Вехи" showing the pre-edit snapshot for the rest of the session even
    // though the chart (fed from displayStats$$, which does merge local edits live) already moved on.
    // Cheap: the backend invalidates its stats cache on every write, so this is a normal fresh fetch,
    // not a redundant one.
    this.foodDiaryService.mutationApplied$.subscribe(() => {
      void this.getStats();
    });
  }

  public reset(): void {
    this.stats$$.set({});
    this.summarySignal$$.set(EMPTY_STATS_SUMMARY);
    this.topProductsByKcalSignal$$.set([]);
    this.topProductsByWeightSignal$$.set([]);
    this.topProductsWindowTotalKcalSignal$$.set(0);
    this.topProductsWindowTotalWeightSignal$$.set(0);
    this.totalEntriesSignal$$.set(0);
    this.selectedDateIdxStart$$.set(0);
    this.selectedDateIdxEnd$$.set(0);
    this.hasFullHistoryLoaded = false;
    this.fullHistoryApplied = false;
  }

  private liveWindowDates(): string[] {
    const today = new Date();
    const dates: string[] = [];
    for (let offset = 0; offset < LIVE_WINDOW_DAYS; offset++) {
      const date = new Date(today);
      date.setDate(date.getDate() - offset);
      dates.push(dateToIsoNoTimeNoTZ(date));
    }
    return dates;
  }

  // getStats() and loadFullHistoryNow() are two separately-@exhaustRequest()-decorated methods —
  // each decorator instance tracks its own in-flight promise, independently of the other — instead
  // of one shared method branching on hasFullHistoryLoaded. That used to let a windowed getStats()
  // call already in flight silently satisfy a concurrent ensureFullHistoryLoaded() with 90-day
  // data: the flag flipped true, but the actual network request stayed whatever the earlier caller
  // had already started, and ensureFullHistoryLoaded() never found out (see plan 28, "Находки в
  // эксплуатации 18.08.2026"). Splitting the methods makes that collision structurally impossible.
  // Once hasFullHistoryLoaded is true, getStats() delegates to loadFullHistoryNow() rather than
  // fetching '?from=all' itself — a reconnect-triggered getStats() and an in-flight
  // ensureFullHistoryLoaded() then share loadFullHistoryNow()'s single @exhaustRequest() promise
  // instead of firing two concurrent full-history requests.
  @exhaustRequest()
  public async getStats(): Promise<void> {
    if (this.hasFullHistoryLoaded) {
      await this.loadFullHistoryNow();
      return;
    }
    await this.fetchAndApply('/api/food/stats', false);
  }

  // Fetches the full account history once (see hasFullHistoryLoaded) — the deliberate wide, rare
  // request the backend keeps as an explicit opt-in (§2.1 of plan 28) instead of the default
  // recent window.
  public async ensureFullHistoryLoaded(): Promise<void> {
    if (this.hasFullHistoryLoaded) return;
    this.hasFullHistoryLoaded = true;
    await this.loadFullHistoryNow();
  }

  @exhaustRequest()
  private async loadFullHistoryNow(): Promise<void> {
    await this.fetchAndApply('/api/food/stats?from=all', true);
  }

  private async fetchAndApply(url: string, isFullHistoryRequest: boolean): Promise<void> {
    const startedAt = performance.now();
    const cachedResponse = this.loadStatsFromLocalStorage();
    if (cachedResponse && Object.keys(cachedResponse.days).length > 0) {
      this.applyResponse(cachedResponse);
    }

    try {
      const serverResponse = await firstValueFrom(this.http.get<FoodStatsResponse>(url));

      // Once full history has actually landed, a slower/stale windowed response that started
      // before it must not regress stats$$ back down to 90 days. Before that point, a windowed
      // response is still applied even if full history is desired/pending — showing correct-but-
      // partial data beats showing nothing while a slow or failed full-history request is in flight.
      if (!isFullHistoryRequest && this.fullHistoryApplied) return;

      const isLocalStatsEmpty = Object.keys(this.stats$$()).length === 0;

      this.applyResponse(serverResponse);
      if (isFullHistoryRequest) this.fullHistoryApplied = true;
      this.saveStatsToLocalStorage();

      void this.applyDateRangeOnLoad(isLocalStatsEmpty);
      void this.telemetry.recordAfterPaint('food.stats_response_apply', startedAt, {
        cache: cachedResponse ? 'hit' : 'miss',
        days: Object.keys(serverResponse.days).length,
        topProducts: (serverResponse.topProductsByKcal ?? []).length,
      });
    } catch (error) {
      console.error('Failed fetching stats from server:', error);
      this.telemetry.record('food.stats_response_apply', performance.now() - startedAt, undefined, 'error');
    }
  }

  // response.topProducts*/summary may be missing on a stale pre-migration localStorage cache — the
  // ?? [] / ?? 0 / ?? EMPTY_STATS_SUMMARY fallbacks keep loadStatsFromLocalStorageOnInit() from
  // setting signals to undefined.
  //
  // response.days is merged into stats$$, never used to replace it outright: every page load's
  // mandatory bootstrap getStats() (FoodSyncCoordinatorService.loadInitialFoodData()) is windowed
  // (90 days) regardless of what's already cached — a hard .set() here let that response instantly
  // shrink stats$$ back down to 90 days even when a wider range (full history, from a previous
  // session's cache or this session's ensureFullHistoryLoaded()) was already loaded, visible as the
  // chart snapping narrower right after paint and then widening again ~500ms later once the
  // full-history follow-up resolved — and, via saveStatsToLocalStorage() right after, silently
  // regressing the persisted cache down to those same 90 days too. Merging means a response only
  // ever adds/refreshes days, never discards ones already known.
  private applyResponse(response: FoodStatsResponse): void {
    this.stats$$.update((current) => ({ ...current, ...response.days }));
    this.summarySignal$$.set(response.summary ?? EMPTY_STATS_SUMMARY);
    this.topProductsByKcalSignal$$.set(response.topProductsByKcal ?? []);
    this.topProductsByWeightSignal$$.set(response.topProductsByWeight ?? []);
    this.topProductsWindowTotalKcalSignal$$.set(response.topProductsWindowTotalKcal ?? 0);
    this.topProductsWindowTotalWeightSignal$$.set(response.topProductsWindowTotalWeight ?? 0);
    this.totalEntriesSignal$$.set(response.totalEntries);
  }

  // statsDateRange$$ is backed by NamespaceSettingsStore, which seeds its state synchronously from
  // localStorage in its own constructor — so the saved range is already available here without
  // waiting for anything. Restoring it immediately, before the await below, is what keeps the
  // slider/labels from ever rendering at their selectedDateIdxStart$$/End$$ default (0/0): without
  // this line the first paint always showed the oldest day twice ("От"/"До" both the earliest
  // cached date) until the settings GET below resolved and snapped the slider into place.
  //
  // statsDateRange$$ is still a separate namespace store with its own independent GET though, so
  // the awaited call below stays: it re-confirms against the server (covering a stale/missing
  // local cache, e.g. first login on a new device) regardless of which of the two requests (this
  // one, or /api/food/stats above) happens to answer first.
  private async applyDateRangeOnLoad(useDefaultIfNoSaved: boolean): Promise<void> {
    this.tryRestoreSavedDateRange();

    await this.foodSettingsService.ready();
    const saved = this.foodSettingsService.statsDateRange$$();
    if (saved && this.savedRangeNeedsFullHistory(saved.start)) {
      await this.ensureFullHistoryLoaded();
    }
    setTimeout(() => {
      if (this.tryRestoreSavedDateRange()) return;
      if (!useDefaultIfNoSaved) return;
      const total = this.statsChartData$$().dates.length;
      if (total === 0) return;
      this.selectedDateIdxEnd$$.set(total - 1);
      this.clipDateRange(90);
    }, 1);
  }

  // 'first' always needs the full history; an explicit saved date needs it only if it falls
  // before whatever's actually fetched (the default window) — deliberately loadedDates$$, not
  // statsChartData$$().dates, since the latter is padded out to the account's full scale (see
  // buildFullDateAxis) and would make this comparison never trigger for any concrete saved date.
  private savedRangeNeedsFullHistory(savedStart: string): boolean {
    if (savedStart === 'first') return true;
    const loadedDates = this.loadedDates$$();
    return loadedDates.length > 0 && savedStart < loadedDates[0];
  }

  public saveDateRange(startIdx: number, endIdx: number): void {
    const dates = this.statsChartData$$().dates;
    const maxIdx = dates.length - 1;
    if (maxIdx < 0) return;
    const startVal = startIdx === 0 ? 'first' : (dates[startIdx] ?? 'first');
    const endVal = endIdx >= maxIdx ? 'last' : (dates[endIdx] ?? 'last');
    this.foodSettingsService.setStatsDateRange({ start: startVal, end: endVal });
  }

  private tryRestoreSavedDateRange(): boolean {
    const saved = this.foodSettingsService.statsDateRange$$();
    if (!saved) return false;
    const dates = this.statsChartData$$().dates;
    const maxIdx = dates.length - 1;
    if (maxIdx < 0) return false;
    const startIdx = saved.start === 'first' ? 0 : Math.max(0, dates.indexOf(saved.start));
    const rawEndIdx = saved.end === 'last' ? maxIdx : dates.indexOf(saved.end);
    const endIdx = rawEndIdx === -1 ? maxIdx : rawEndIdx;
    if (startIdx >= endIdx) return false;
    this.selectedDateIdxStart$$.set(startIdx);
    this.selectedDateIdxEnd$$.set(endIdx);
    return true;
  }

  // Builds the axis over the account's *full* date range — daysInDiary days ending at the last
  // loaded date — not just whatever's currently in stats$$. Days older than the loaded window
  // (default 90, until ensureFullHistoryLoaded() resolves) get NaN placeholders instead of being
  // left out of the array entirely.
  //
  // This exists so the slider (whose track/max value is sized off this array's length, see
  // FoodStatsCharts) is at the account's true scale from the very first, cheap, windowed response —
  // not just whatever happened to be loaded — and, critically, so that scale never changes size
  // once ensureFullHistoryLoaded() later fills the placeholders in with real data. Before this,
  // the array length jumped from 90 to the full history size at that point, which reshuffled every
  // index-based position on the slider and made it visibly jump/flicker on load.
  private buildFullDateAxis(loadedDates: string[]): string[] {
    if (loadedDates.length === 0) return loadedDates;
    const paddingCount = Math.max(0, this.summarySignal$$().daysInDiary - loadedDates.length);
    if (paddingCount === 0) return loadedDates;

    const padding: string[] = [];
    for (let offset = paddingCount; offset >= 1; offset--) {
      padding.push(isoDaysBefore(loadedDates[0], offset));
    }
    return [...padding, ...loadedDates];
  }

  private prepareChartData(): StatsChartData {
    const stats = this.displayStats$$() || {};
    const selectedKcalByDate = this.productHistoryState.selectedKcalByDate$$();
    const dates = this.buildFullDateAxis(this.loadedDates$$());
    const result = createEmptyChartData();

    dates.forEach((date) => {
      const dayStats = stats[date];
      result.dates.push(date);
      if (!dayStats) {
        // Not fetched yet (older than the loaded window) — a gap in every series until
        // ensureFullHistoryLoaded() resolves and this slot gets real values.
        result.weights.push(Number.NaN);
        result.weightsAvg.push(Number.NaN);
        result.kcalsFactual.push(Number.NaN);
        result.kcalsSelected.push(Number.NaN);
        result.kcalsTarget.push(Number.NaN);
        result.hasNoData.push(true);
        return;
      }
      const { weight, weightAvg, consumedKcal, targetKcal, hasNoData } = dayStats;
      const hasKcal = consumedKcal !== undefined && consumedKcal !== null;
      result.weights.push(weight);
      result.weightsAvg.push(weightAvg);
      result.kcalsFactual.push(!hasKcal ? Number.NaN : consumedKcal);
      // A loaded day on which no tracked product was eaten is a real zero, not a gap.
      result.kcalsSelected.push(!hasKcal ? Number.NaN : (selectedKcalByDate.get(date) ?? 0));
      result.kcalsTarget.push(targetKcal);
      result.hasNoData.push(hasNoData);
    });

    return result;
  }

  private prepareChartDataClipped(): StatsChartData {
    const data = this.statsChartData$$();
    const start = this.selectedDateIdxStart$$();
    const end = this.selectedDateIdxEnd$$();

    const granularity = this.resolveGranularity(Math.min(end + 1, data.dates.length) - start);

    if (granularity === 'week') {
      return sliceAggregatedChartData(this.weeklyAggregated$$(), start, end);
    }

    if (granularity === 'month') {
      return sliceAggregatedChartData(this.monthlyAggregated$$(), start, end);
    }

    const days = sliceChartData(data, start, end + 1);
    return { ...days, dates: days.dates.map(formatDateTicks) };
  }

  private resolveGranularity(daysCount: number): 'day' | 'week' | 'month' {
    if (daysCount > FoodStatsService.GRANULARITY_MONTH_SWITCH_DAYS) return 'month';
    if (daysCount > FoodStatsService.GRANULARITY_WEEK_SWITCH_DAYS - 7) return 'week';
    return 'day';
  }

  // Sets the range instantly from whatever's currently loaded — used only for the "no saved
  // range yet" default (applyDateRangeOnLoad below). Animated user-triggered clips go through
  // animateClipDateRange() in the chart component instead, which resolves clipNeedsFullHistory()
  // itself before computing the animation's target range.
  private clipDateRange(daysAmtToShow: number): void {
    if (this.clipNeedsFullHistory(daysAmtToShow)) {
      void this.ensureFullHistoryLoaded().then(() => this.applyClip(daysAmtToShow));
      return;
    }
    this.applyClip(daysAmtToShow);
  }

  private applyClip(daysAmtToShow: number): void {
    const [start, end] = this.getClipRange(daysAmtToShow);
    this.selectedDateIdxStart$$.set(start);
    this.selectedDateIdxEnd$$.set(end);
  }

  // True when daysAmtToShow asks for more days than the default server window provides — callers
  // must await ensureFullHistoryLoaded() first, otherwise getClipRange() below clamps to whatever
  // partial window is currently loaded instead of the true requested range. Compared against the
  // fixed window size, not against however many days happen to be loaded right now, so the
  // routine default-window clip (90) never triggers an unnecessary full-history fetch on its own.
  public clipNeedsFullHistory(daysAmtToShow: number): boolean {
    return daysAmtToShow === -1 || daysAmtToShow > DEFAULT_STATS_WINDOW_DAYS;
  }

  // Same gap as clipNeedsFullHistory() guards for the range-clip buttons, but index-based: a live
  // slider drag can pull the start thumb into statsChartData$$().dates' NaN-padded region (days
  // older than loadedDates$$()) without ever going through getClipRange()/animateClipDateRange(),
  // since onRangeChange() applies the dragged indices directly. Compared against the padding
  // count, not the fixed 90-day window, so it stays correct once daysInDiary/loadedDates$$ change.
  public rangeNeedsFullHistory(startIdx: number): boolean {
    if (this.hasFullHistoryLoaded) return false;
    const paddingCount = this.statsChartData$$().dates.length - this.loadedDates$$().length;
    return startIdx < paddingCount;
  }

  public getClipRange(daysAmtToShow: number): [number, number] {
    const totalDaysAvailable = this.statsChartData$$().dates.length;
    const isShowAllDays = daysAmtToShow === -1;
    const hasEnoughDaysForDisplay = totalDaysAvailable > daysAmtToShow;
    const lastDayIndex = totalDaysAvailable - 1;

    if (totalDaysAvailable === 0) {
      return [0, 0];
    }

    if (isShowAllDays || !hasEnoughDaysForDisplay) {
      return [0, lastDayIndex];
    }

    const currentEnd = this.selectedDateIdxEnd$$();
    const boundedEnd = currentEnd < 0 || currentEnd > lastDayIndex ? lastDayIndex : currentEnd;
    const desiredLength = daysAmtToShow;
    const desiredStart = boundedEnd - desiredLength + 1;

    if (desiredStart >= 0) {
      return [desiredStart, boundedEnd];
    }

    const missingLeft = Math.abs(desiredStart);
    const shiftedEnd = Math.min(lastDayIndex, boundedEnd + missingLeft);
    return [0, shiftedEnd];
  }

  private saveStatsToLocalStorage(): void {
    const response: FoodStatsResponse = {
      days: this.stats$$(),
      summary: this.summarySignal$$(),
      topProductsByKcal: this.topProductsByKcalSignal$$(),
      topProductsByWeight: this.topProductsByWeightSignal$$(),
      topProductsWindowTotalKcal: this.topProductsWindowTotalKcalSignal$$(),
      topProductsWindowTotalWeight: this.topProductsWindowTotalWeightSignal$$(),
      totalEntries: this.totalEntriesSignal$$(),
    };
    this.saveToLocalStorage(response);
  }

  private loadStatsFromLocalStorage(): FoodStatsResponse | null {
    const saved = this.loadFromLocalStorage<FoodStatsResponse>();
    // Stale cache from before the {days, topProducts, totalEntries} envelope was introduced —
    // saved.days would be undefined and crash Object.keys() downstream. Treat as no cache.
    if (!saved || typeof saved.days !== 'object' || saved.days === null) return null;
    return saved;
  }

  private loadStatsFromLocalStorageOnInit(): void {
    const savedResponse = this.loadStatsFromLocalStorage();
    if (savedResponse && Object.keys(savedResponse.days).length > 0) {
      this.applyResponse(savedResponse);
      void this.applyDateRangeOnLoad(true);
    }
  }
}
