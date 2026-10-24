import { STATS_CHART_SERIES, StatsChartData, StatsChartSeries } from '@app/shared/types';
import { dateToIsoNoTimeNoTZ, formatDateTicks } from '@app/shared/utils';

export type AggregationPeriod = 'week' | 'month';

// Days merged into weeks/months, plus the first and last day index (into the daily data the
// aggregation was built from) each merged period covers — the slider works in day indices.
export interface AggregatedChartData {
  data: StatsChartData;
  periodStartIdx: number[];
  periodEndIdx: number[];
}

interface PeriodAccumulator {
  startIso: string;
  startIdx: number;
  endIdx: number;
  expectedDays: number;
  sums: Record<StatsChartSeries, number>;
  counts: Record<StatsChartSeries, number>;
}

function mapSeries<T>(build: (series: StatsChartSeries) => T): Record<StatsChartSeries, T> {
  return Object.fromEntries(STATS_CHART_SERIES.map((series) => [series, build(series)])) as Record<StatsChartSeries, T>;
}

export function createEmptyChartData(): StatsChartData {
  return { dates: [], hasNoData: [], ...mapSeries((): number[] => []) };
}

// Same bounds as Array.prototype.slice: [start, endExclusive).
export function sliceChartData(data: StatsChartData, start: number, endExclusive: number): StatsChartData {
  return {
    dates: data.dates.slice(start, endExclusive),
    hasNoData: data.hasNoData.slice(start, endExclusive),
    ...mapSeries((series) => data[series].slice(start, endExclusive)),
  };
}

// Merges days into weeks or months. Each series becomes its per-day average over the period, which
// is linear: the average of a part plus the average of the rest is the average of the whole, so
// kcalsSelected stays a consistent share of kcalsFactual at any granularity.
//
// A series gets a value for a period only when every day of the period has one (a NaN day is
// "not fetched yet", see FoodStatsService.buildFullDateAxis — it is skipped, not counted); a period
// where no series is complete is dropped.
export function aggregateChartData(data: StatsChartData, period: AggregationPeriod): AggregatedChartData {
  const periodStartIso = period === 'week' ? getWeekStartIso : getMonthStartIso;
  const periods: PeriodAccumulator[] = [];

  data.dates.forEach((dateIso, index) => {
    const startIso = periodStartIso(dateIso);
    let current = periods[periods.length - 1];
    if (current?.startIso !== startIso) {
      current = {
        startIso,
        startIdx: index,
        endIdx: index,
        expectedDays: period === 'week' ? 7 : getMonthDaysCount(startIso),
        sums: mapSeries(() => 0),
        counts: mapSeries(() => 0),
      };
      periods.push(current);
    }
    current.endIdx = index;

    for (const series of STATS_CHART_SERIES) {
      const value = data[series][index];
      if (!Number.isFinite(value)) continue;
      current.sums[series] += value;
      current.counts[series] += 1;
    }
  });

  const aggregated = createEmptyChartData();
  const periodStartIdx: number[] = [];
  const periodEndIdx: number[] = [];

  for (const merged of periods) {
    const isComplete = mapSeries((series) => merged.counts[series] === merged.expectedDays);
    if (!STATS_CHART_SERIES.some((series) => isComplete[series])) continue;

    aggregated.dates.push(formatDateTicks(merged.startIso));
    // Not meaningful at week/month granularity — only the daily series feeds the streak calendar.
    aggregated.hasNoData.push(false);
    for (const series of STATS_CHART_SERIES) {
      aggregated[series].push(isComplete[series] ? merged.sums[series] / merged.counts[series] : Number.NaN);
    }
    periodStartIdx.push(merged.startIdx);
    periodEndIdx.push(merged.endIdx);
  }

  return { data: aggregated, periodStartIdx, periodEndIdx };
}

// The periods fully inside the day range [startDayIdx, endDayIdx]. Weights stay a day-level series:
// a weekly or monthly average of them is not shown.
export function sliceAggregatedChartData(
  aggregated: AggregatedChartData,
  startDayIdx: number,
  endDayIdx: number,
): StatsChartData {
  const startPeriodIdx = findFirstIndexGte(aggregated.periodStartIdx, startDayIdx);
  const endPeriodIdx = findLastIndexLte(aggregated.periodEndIdx, endDayIdx);

  if (startPeriodIdx > endPeriodIdx) return createEmptyChartData();

  const sliced = sliceChartData(aggregated.data, startPeriodIdx, endPeriodIdx + 1);
  return { ...sliced, weights: sliced.weights.map(() => Number.NaN) };
}

// Splits each calories bar into the tracked products' part (the base of the stack) and the rest
// above it. Selected is NaN on a day without tracked products, not 0: a zero-height segment would
// still draw its 1px border along the base of the stack. Rest never goes below zero, which also
// absorbs the small gap between the diary's live calories and the history's per-entry rounding.
// A day without calories data (NaN) stays a gap in both.
export function splitKcalsBySelection(factual: number[], selected: number[]): { selected: number[]; rest: number[] } {
  return {
    selected: selected.map((kcal) => (kcal > 0 ? kcal : Number.NaN)),
    rest: factual.map((kcal, index) => Math.max(kcal - (selected[index] || 0), 0)),
  };
}

function findFirstIndexGte(arr: number[], value: number): number {
  let left = 0;
  let right = arr.length - 1;
  let result = arr.length;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] >= value) {
      result = mid;
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  return result;
}

function findLastIndexLte(arr: number[], value: number): number {
  let left = 0;
  let right = arr.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] <= value) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}

function getWeekStartIso(dateIso: string): string {
  const date = new Date(dateIso);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - diff);
  return dateToIsoNoTimeNoTZ(weekStart);
}

function getMonthStartIso(dateIso: string): string {
  const date = new Date(dateIso);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  return dateToIsoNoTimeNoTZ(monthStart);
}

function getMonthDaysCount(periodStartIso: string): number {
  const date = new Date(periodStartIso);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
