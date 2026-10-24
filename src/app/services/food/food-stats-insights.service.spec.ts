import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FoodStatsSummary, FoodStatsTopProduct, StatsChartData } from '@app/shared/types';
import { FoodStatsInsightsService } from './food-stats-insights.service';
import { FoodStatsService } from './food-stats.service';

function chartData(overrides: Partial<StatsChartData> = {}): StatsChartData {
  return {
    dates: [],
    weights: [],
    weightsAvg: [],
    kcalsFactual: [],
    kcalsSelected: [],
    kcalsTarget: [],
    hasNoData: [],
    ...overrides,
  };
}

const EMPTY_SUMMARY: FoodStatsSummary = {
  daysInDiary: 0,
  minWeight: null,
  maxWeight: null,
  mostCaloricDay: null,
  leastCaloricDay: null,
  weightChangeSinceStartKg: null,
  yearAgo: null,
};

// Builds a `days`-day statsChartData$$-shaped fixture: kcalsFactual[i] vs kcalsTarget[i] decide the
// day's food-day-band (see food-day-band.spec.ts for exact thresholds), hasNoData[i] marks a
// skipped day. The last day is always "today" and is excluded from streak/ribbon (see
// completedDays$$ in the service).
function buildDays(bands: Array<'under' | 'normal' | 'over' | 'noData'>): StatsChartData {
  const dates = bands.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const targetKcal = 2000;
  const kcalsFactual = bands.map((band) => {
    if (band === 'noData') return 0;
    if (band === 'under') return 500; // 25% of target
    if (band === 'over') return 3000; // 150% of target
    return 2000; // 100% of target -> normal
  });
  const hasNoData = bands.map((band) => band === 'noData');
  return chartData({ dates, kcalsFactual, kcalsTarget: bands.map(() => targetKcal), hasNoData });
}

function setup(input: {
  statsChartData?: StatsChartData;
  topProductsByKcal?: FoodStatsTopProduct[];
  topProductsByWeight?: FoodStatsTopProduct[];
  topProductsWindowTotalKcal?: number;
  topProductsWindowTotalWeight?: number;
  summary?: FoodStatsSummary;
  totalEntries?: number;
}): FoodStatsInsightsService {
  const foodStatsServiceFake = {
    totalEntries$$: signal(input.totalEntries ?? 0),
    statsChartData$$: signal(input.statsChartData ?? chartData()),
    topProductsByKcal$$: signal(input.topProductsByKcal ?? []),
    topProductsByWeight$$: signal(input.topProductsByWeight ?? []),
    topProductsWindowTotalKcal$$: signal(input.topProductsWindowTotalKcal ?? 0),
    topProductsWindowTotalWeight$$: signal(input.topProductsWindowTotalWeight ?? 0),
    summary$$: signal(input.summary ?? EMPTY_SUMMARY),
  };

  TestBed.configureTestingModule({
    providers: [{ provide: FoodStatsService, useValue: foodStatsServiceFake }],
  });
  return TestBed.inject(FoodStatsInsightsService);
}

describe('FoodStatsInsightsService.streak$$', () => {
  it('excludes today (the last day) from both current and record streak', () => {
    // Only 1 day, which is always "today" -> completedDays$$ is empty.
    const service = setup({ statsChartData: buildDays(['normal']) });
    expect(service.streak$$()).toEqual({ current: 0, record: 0 });
  });

  it('counts a current streak of consecutive success days ending right before today', () => {
    const service = setup({ statsChartData: buildDays(['over', 'normal', 'normal', 'under', 'normal']) });
    // completed days (today excluded): over, normal, normal, under -> trailing success streak = 3
    expect(service.streak$$().current).toBe(3);
  });

  it('breaks the current streak on the first failure day scanning backward from the end', () => {
    const service = setup({ statsChartData: buildDays(['normal', 'over', 'normal', 'normal']) });
    // completed: normal, over, normal -> trailing streak stops at 'over' (record scan) -> current=1
    expect(service.streak$$().current).toBe(1);
  });

  it('treats a no-data day as a streak failure, not a skip', () => {
    const service = setup({ statsChartData: buildDays(['normal', 'noData', 'normal']) });
    // completed: normal, noData -> current streak = 0 (last completed day is noData -> failure)
    expect(service.streak$$().current).toBe(0);
  });

  it('finds the longest historical streak (record), independent of the current trailing streak', () => {
    const service = setup({
      statsChartData: buildDays(['normal', 'normal', 'normal', 'over', 'normal', 'normal', 'normal']),
    });
    // completed (today excluded): normal,normal,normal,over,normal,normal -> longest run = 3
    expect(service.streak$$().record).toBe(3);
  });
});

describe('FoodStatsInsightsService.ribbon30$$', () => {
  it('excludes today and caps at the last 30 completed days', () => {
    const bands = Array.from({ length: 35 }, () => 'normal' as const);
    const service = setup({ statsChartData: buildDays(bands) });
    expect(service.ribbon30$$().length).toBe(30);
  });
});

describe('FoodStatsInsightsService.topProductsByKcalWithShare$$/topProductsByWeightWithShare$$', () => {
  it('computes each product share as a percent of the window total, rounded to whole percent', () => {
    const service = setup({
      topProductsByKcal: [
        { catalogueId: 1, name: 'A', kcal: 300, weight: 100 },
        { catalogueId: 2, name: 'B', kcal: 200, weight: 50 },
      ],
      topProductsWindowTotalKcal: 1000,
    });
    expect(service.topProductsByKcalWithShare$$()).toEqual([
      { catalogueId: 1, name: 'A', kcal: 300, weight: 100, sharePercent: 30 },
      { catalogueId: 2, name: 'B', kcal: 200, weight: 50, sharePercent: 20 },
    ]);
  });

  it('returns 0% share for every product when the window total is 0 or negative', () => {
    const service = setup({
      topProductsByWeight: [{ catalogueId: 1, name: 'A', kcal: 300, weight: 100 }],
      topProductsWindowTotalWeight: 0,
    });
    expect(service.topProductsByWeightWithShare$$()).toEqual([
      { catalogueId: 1, name: 'A', kcal: 300, weight: 100, sharePercent: 0 },
    ]);
  });
});

describe('FoodStatsInsightsService.milestones$$', () => {
  it('combines the backend summary with totalEntries as a single pass-through object', () => {
    const summary: FoodStatsSummary = { ...EMPTY_SUMMARY, daysInDiary: 42 };
    const service = setup({ summary, totalEntries: 777 });
    expect(service.milestones$$()).toEqual({ ...summary, totalEntries: 777 });
  });
});
