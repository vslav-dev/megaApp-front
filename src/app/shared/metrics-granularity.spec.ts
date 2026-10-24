import {
  isSameMetricWindow,
  METRIC_GRANULARITIES,
  METRIC_GRANULARITY_SPECS,
  metricWindowAt,
} from '@app/shared/metrics-granularity';
import { earliestHistoryBucket } from '@app/shared/metrics-history-range';

// 2026-09-26T15:30:45Z
const NOW_SECONDS = Date.UTC(2026, 8, 26, 15, 30, 45) / 1000;

describe('metricWindowAt', () => {
  it.each(METRIC_GRANULARITIES)(
    '%s: ends at the open period start and spans exactly `periods` steps',
    (granularity) => {
      const { stepSeconds, periods } = METRIC_GRANULARITY_SPECS[granularity];
      const window = metricWindowAt(granularity, NOW_SECONDS);

      expect(window.endBucket % stepSeconds).toBe(0);
      expect(window.endBucket).toBeLessThanOrEqual(NOW_SECONDS);
      expect(NOW_SECONDS - window.endBucket).toBeLessThan(stepSeconds);
      expect(window.endBucket - window.startBucket).toBe(periods * stepSeconds);
    },
  );

  it('minute: covers exactly the last 24 hours of whole minutes', () => {
    const window = metricWindowAt('minute', NOW_SECONDS);

    expect(window.endBucket).toBe(Date.UTC(2026, 8, 26, 15, 30) / 1000);
    expect(window.startBucket).toBe(Date.UTC(2026, 8, 25, 15, 30) / 1000);
  });

  it('day: buckets are aligned to UTC midnight and cover 365 days', () => {
    const window = metricWindowAt('day', NOW_SECONDS);

    expect(window.endBucket).toBe(Date.UTC(2026, 8, 26) / 1000);
    expect(window.startBucket).toBe(Date.UTC(2025, 8, 26) / 1000);
  });

  it('stays put for every moment inside one period and moves on the next boundary', () => {
    const periodStart = metricWindowAt('minute', NOW_SECONDS).endBucket;

    expect(metricWindowAt('minute', periodStart)).toEqual(metricWindowAt('minute', periodStart + 59));
    expect(metricWindowAt('minute', periodStart + 60).endBucket).toBe(periodStart + 60);
  });

  it.each(METRIC_GRANULARITIES)(
    '%s: starts exactly where a history request for the last closed bucket starts',
    (granularity) => {
      const { stepSeconds } = METRIC_GRANULARITY_SPECS[granularity];
      const window = metricWindowAt(granularity, NOW_SECONDS);
      const lastClosedBucket = window.endBucket - stepSeconds;

      expect(earliestHistoryBucket(granularity, lastClosedBucket)).toBe(window.startBucket);
    },
  );
});

describe('isSameMetricWindow', () => {
  it('is true only when both boundaries match', () => {
    const window = { startBucket: 100, endBucket: 200 };

    expect(isSameMetricWindow(window, { startBucket: 100, endBucket: 200 })).toBe(true);
    expect(isSameMetricWindow(window, { startBucket: 100, endBucket: 260 })).toBe(false);
    expect(isSameMetricWindow(window, { startBucket: 40, endBucket: 200 })).toBe(false);
  });
});
