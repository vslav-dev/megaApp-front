import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { SyncEngineService } from '@app/services/sync-engine.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { DayStats, FoodStatsResponse, Stats } from '@app/shared/types';
import { createTelemetryFake } from '@app/testing/telemetry.fake';
import { Subject } from 'rxjs';
import { FoodDiaryService } from './food-diary.service';
import { FoodProductHistoryStateService } from './food-product-history-state.service';
import { FoodSettingsService } from './food-settings.service';
import { FoodStatsService } from './food-stats.service';

function dayStats(overrides: Partial<DayStats> = {}): DayStats {
  return { weight: 70, weightAvg: 70, consumedKcal: 2000, targetKcal: 2200, hasNoData: false, ...overrides };
}

// Builds `count` consecutive daily entries starting at startDateIso (UTC-safe, ISO date-only math).
function buildDailyStats(count: number, startDateIso: string): Stats {
  const [y, m, d] = startDateIso.split('-').map(Number);
  const stats: Stats = {};
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    stats[iso] = dayStats();
  }
  return stats;
}

function setup(response: FoodStatsResponse, selectedKcalByDate = new Map<string, number>()): FoodStatsService {
  const localStorageFake: Pick<LocalStorageService, 'getUserScoped' | 'setUserScoped'> = {
    getUserScoped: <T>() => response as unknown as T,
    setUserScoped: () => {},
  };
  const diaryServiceFake: Pick<FoodDiaryService, 'diary$$' | 'mutationApplied$'> = {
    diary$$: signal({}),
    mutationApplied$: new Subject<string>(),
  };
  const settingsServiceFake: Pick<FoodSettingsService, 'statsDateRange$$' | 'ready'> = {
    statsDateRange$$: signal(null),
    // Never resolves -> applyDateRangeOnLoad() (triggered from the constructor) stalls right after
    // its synchronous tryRestoreSavedDateRange() no-op and never reaches its setTimeout/clipDateRange
    // tail, so selectedDateIdxStart$$/End$$ stay exactly what the test sets, deterministically.
    ready: () => new Promise<void>(() => {}),
  };
  const authServiceFake: Pick<AuthService, 'sessionState$$'> = {
    sessionState$$: signal(AuthSessionState.Authenticated),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: HttpClient, useValue: {} },
      { provide: LocalStorageService, useValue: localStorageFake },
      { provide: NetworkService, useValue: {} },
      { provide: SyncEngineService, useValue: {} },
      { provide: FoodDiaryService, useValue: diaryServiceFake },
      { provide: FoodSettingsService, useValue: settingsServiceFake },
      { provide: AuthService, useValue: authServiceFake },
      { provide: FoodProductHistoryStateService, useValue: { selectedKcalByDate$$: signal(selectedKcalByDate) } },
      { provide: TelemetryService, useValue: createTelemetryFake() },
    ],
  });
  return TestBed.inject(FoodStatsService);
}

function emptyResponse(): FoodStatsResponse {
  return {
    days: {},
    topProductsByKcal: [],
    topProductsByWeight: [],
    topProductsWindowTotalKcal: 0,
    topProductsWindowTotalWeight: 0,
    totalEntries: 0,
  };
}

describe('FoodStatsService.getClipRange', () => {
  it('returns [0, 0] when there are no loaded days', () => {
    const service = setup(emptyResponse());
    expect(service.getClipRange(90)).toEqual([0, 0]);
  });

  it('returns the full range when fewer days are loaded than requested', () => {
    const days = buildDailyStats(10, '2026-01-01');
    const service = setup({ ...emptyResponse(), days });
    expect(service.getClipRange(90)).toEqual([0, 9]);
  });

  it('returns the full range when daysAmtToShow is -1 (show all)', () => {
    const days = buildDailyStats(30, '2026-01-01');
    const service = setup({ ...emptyResponse(), days });
    expect(service.getClipRange(-1)).toEqual([0, 29]);
  });

  it('windows the last N days ending at selectedDateIdxEnd$$ when enough days are loaded', () => {
    const days = buildDailyStats(30, '2026-01-01');
    const service = setup({ ...emptyResponse(), days });
    service.selectedDateIdxEnd$$.set(29);
    expect(service.getClipRange(10)).toEqual([20, 29]);
  });

  it('shifts the window right when the desired length would run past day 0', () => {
    const days = buildDailyStats(30, '2026-01-01');
    const service = setup({ ...emptyResponse(), days });
    service.selectedDateIdxEnd$$.set(5);
    // desiredStart = 5 - 10 + 1 = -4 -> shift end forward by 4 (capped at lastDayIndex)
    expect(service.getClipRange(10)).toEqual([0, 9]);
  });

  it('clamps an out-of-range selectedDateIdxEnd$$ to the last available day', () => {
    const days = buildDailyStats(30, '2026-01-01');
    const service = setup({ ...emptyResponse(), days });
    service.selectedDateIdxEnd$$.set(999);
    expect(service.getClipRange(10)).toEqual([20, 29]);
  });
});

describe('FoodStatsService.statsChartDataClipped$$', () => {
  it('slices dates/values to the selected window at day granularity', () => {
    const days = buildDailyStats(10, '2026-01-01');
    const service = setup({ ...emptyResponse(), days });
    service.selectedDateIdxStart$$.set(2);
    service.selectedDateIdxEnd$$.set(4);
    const result = service.statsChartDataClipped$$();
    expect(result.dates).toEqual(['03.01.2026', '04.01.2026', '05.01.2026']);
    expect(result.kcalsFactual).toEqual([2000, 2000, 2000]);
  });

  it('switches to weekly aggregation once the selected window exceeds the day-granularity threshold', () => {
    // GRANULARITY_WEEK_SWITCH_DAYS - 7 = 363 -> need > 363 selected days to force 'week'
    const days = buildDailyStats(365, '2025-01-01');
    const service = setup({ ...emptyResponse(), days });
    service.selectedDateIdxStart$$.set(0);
    service.selectedDateIdxEnd$$.set(364);
    const result = service.statsChartDataClipped$$();
    // Aggregated into ~52 weekly buckets, far fewer than 365 raw days.
    expect(result.dates.length).toBeGreaterThan(0);
    expect(result.dates.length).toBeLessThan(365);
    // hideWeights=true is applied for aggregated granularities.
    expect(result.weights.every((w) => Number.isNaN(w))).toBe(true);
    // Every complete week averages the same constant daily kcal value.
    expect(result.kcalsFactual.filter((v) => !Number.isNaN(v)).every((v) => v === 2000)).toBe(true);
  });

  it('carries the calories of the tracked products per day, zero on a day without them', () => {
    const days = buildDailyStats(5, '2026-01-01');
    const service = setup({ ...emptyResponse(), days }, new Map([['2026-01-02', 600]]));
    service.selectedDateIdxStart$$.set(0);
    service.selectedDateIdxEnd$$.set(4);

    expect(service.statsChartDataClipped$$().kcalsSelected).toEqual([0, 600, 0, 0, 0]);
  });

  it('averages the tracked calories the same way as the total when days are merged into weeks', () => {
    const days = buildDailyStats(365, '2025-01-01');
    // 700 kcal of the tracked products on every day: any complete week must average exactly that.
    const selected = new Map(Object.keys(days).map((date) => [date, 700] as const));
    const service = setup({ ...emptyResponse(), days }, selected);
    service.selectedDateIdxStart$$.set(0);
    service.selectedDateIdxEnd$$.set(364);

    const result = service.statsChartDataClipped$$();

    expect(result.dates.length).toBeLessThan(365);
    expect(result.kcalsSelected.filter((v) => !Number.isNaN(v)).every((v) => v === 700)).toBe(true);
    expect(result.kcalsFactual.filter((v) => !Number.isNaN(v)).every((v) => v === 2000)).toBe(true);
  });
});
