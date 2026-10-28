import {
  aggregateChartData,
  createEmptyChartData,
  sliceAggregatedChartData,
  sliceChartData,
  splitKcalsBySelection,
} from '@app/shared/stats-chart-data';
import { STATS_CHART_SERIES, StatsChartData, StatsChartSeries } from '@app/shared/types';

function isoDay(offset: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// `count` consecutive days from 2026-01-01; a series without a builder is a constant 1.
function buildDaily(
  count: number,
  builders: Partial<Record<StatsChartSeries, (index: number) => number>> = {},
): StatsChartData {
  const data = createEmptyChartData();
  for (let index = 0; index < count; index++) {
    data.dates.push(isoDay(index));
    data.hasNoData.push(false);
    for (const series of STATS_CHART_SERIES) {
      data[series].push(builders[series]?.(index) ?? 1);
    }
  }
  return data;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Week and month boundaries depend on the machine's time zone (see getWeekStartIso), so these
// tests check each merged period against its own day span instead of hard-coded calendar dates.
describe('aggregateChartData', () => {
  it('averages every series over the days of a period', () => {
    const daily = buildDaily(40, {
      kcalsFactual: () => 2000,
      kcalsSelected: (index) => (index % 3) * 100,
      kcalsTarget: () => 2200,
    });

    const { data, periodStartIdx, periodEndIdx } = aggregateChartData(daily, 'week');

    expect(data.dates.length).toBeGreaterThanOrEqual(4);
    data.dates.forEach((_, i) => {
      const span = (series: StatsChartSeries) => daily[series].slice(periodStartIdx[i], periodEndIdx[i] + 1);
      expect(data.kcalsFactual[i]).toBe(2000);
      expect(data.kcalsSelected[i]).toBeCloseTo(mean(span('kcalsSelected')), 10);
      expect(data.kcalsTarget[i]).toBe(2200);
    });
  });

  it('keeps the selected part a consistent share of the total at month granularity', () => {
    const daily = buildDaily(100, {
      kcalsFactual: (index) => 1500 + (index % 7) * 100,
      kcalsSelected: (index) => (index % 5) * 50,
    });

    const { data, periodStartIdx, periodEndIdx } = aggregateChartData(daily, 'month');

    expect(data.dates.length).toBeGreaterThanOrEqual(2);
    data.dates.forEach((_, i) => {
      const span = (series: StatsChartSeries) => daily[series].slice(periodStartIdx[i], periodEndIdx[i] + 1);
      expect(span('kcalsFactual').length).toBeGreaterThanOrEqual(28);
      expect(data.kcalsFactual[i]).toBeCloseTo(mean(span('kcalsFactual')), 10);
      expect(data.kcalsSelected[i]).toBeCloseTo(mean(span('kcalsSelected')), 10);
    });
  });

  it('drops a period that is not complete in any series', () => {
    const daily = buildDaily(20);

    const { periodStartIdx, periodEndIdx } = aggregateChartData(daily, 'week');

    expect(periodStartIdx.length).toBeGreaterThanOrEqual(2);
    periodStartIdx.forEach((start, i) => expect(periodEndIdx[i] - start + 1).toBe(7));
  });

  it('leaves only the incomplete series empty when a day of it has no value', () => {
    const missingDay = 10;
    const daily = buildDaily(20, { kcalsSelected: (index) => (index === missingDay ? Number.NaN : 100) });

    const { data, periodStartIdx, periodEndIdx } = aggregateChartData(daily, 'week');

    const gapPeriod = periodStartIdx.findIndex((start, i) => start <= missingDay && missingDay <= periodEndIdx[i]);
    expect(gapPeriod).toBeGreaterThanOrEqual(0);
    expect(data.kcalsSelected[gapPeriod]).toBeNaN();
    expect(data.kcalsFactual[gapPeriod]).toBe(1);
    data.kcalsSelected.forEach((value, i) => {
      if (i !== gapPeriod) expect(value).toBe(100);
    });
  });

  it('returns nothing for no days', () => {
    expect(aggregateChartData(createEmptyChartData(), 'month').data.dates).toEqual([]);
  });
});

describe('sliceAggregatedChartData', () => {
  it('takes the periods inside the day range and hides the weights', () => {
    const daily = buildDaily(40, { weights: () => 70 });
    const aggregated = aggregateChartData(daily, 'week');

    const all = sliceAggregatedChartData(aggregated, 0, 39);
    const first = sliceAggregatedChartData(aggregated, aggregated.periodStartIdx[0], aggregated.periodEndIdx[0]);

    expect(all.dates).toEqual(aggregated.data.dates);
    expect(first.dates).toEqual([aggregated.data.dates[0]]);
    expect(all.weights.every((weight) => Number.isNaN(weight))).toBe(true);
    expect(all.kcalsSelected).toEqual(aggregated.data.kcalsSelected);
  });

  it('returns an empty set when no period fits the day range', () => {
    const aggregated = aggregateChartData(buildDaily(40), 'week');

    const result = sliceAggregatedChartData(
      aggregated,
      aggregated.periodStartIdx[0] + 1,
      aggregated.periodEndIdx[0] - 1,
    );

    expect(result.dates).toEqual([]);
  });
});

describe('splitKcalsBySelection', () => {
  it('puts the tracked part at the base and the remainder above it', () => {
    const { selected, rest } = splitKcalsBySelection([2000, 1500], [600, 250]);

    expect(selected).toEqual([600, 250]);
    expect(rest).toEqual([1400, 1250]);
  });

  it('turns a day without tracked products into a gap in the selected part, not a zero-height bar', () => {
    const { selected, rest } = splitKcalsBySelection([2000], [0]);

    expect(selected).toEqual([Number.NaN]);
    expect(rest).toEqual([2000]);
  });

  it('never lets the rest go below zero when the tracked part exceeds the day total', () => {
    const { selected, rest } = splitKcalsBySelection([300], [305]);

    expect(selected).toEqual([305]);
    expect(rest).toEqual([0]);
  });

  it('keeps a day without calories data a gap in both parts', () => {
    const { selected, rest } = splitKcalsBySelection([Number.NaN], [Number.NaN]);

    expect(selected).toEqual([Number.NaN]);
    expect(rest).toEqual([Number.NaN]);
  });
});

describe('sliceChartData', () => {
  it('slices every series with the bounds of Array.slice', () => {
    const daily = buildDaily(10, { kcalsSelected: (index) => index });

    const result = sliceChartData(daily, 2, 5);

    expect(result.dates).toEqual([isoDay(2), isoDay(3), isoDay(4)]);
    expect(result.kcalsSelected).toEqual([2, 3, 4]);
    expect(result.hasNoData).toHaveLength(3);
    STATS_CHART_SERIES.forEach((series) => expect(result[series]).toHaveLength(3));
  });
});
