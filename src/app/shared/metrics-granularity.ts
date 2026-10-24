import { MetricGranularity } from '@app/shared/types';

export const METRIC_GRANULARITIES: readonly MetricGranularity[] = ['minute', 'hour', 'day'];

interface MetricGranularitySpec {
  stepSeconds: number;
  // How many closed periods one window covers — also the depth of the history request
  // and the capacity of a series' ring buffer, which must all stay equal.
  periods: number;
}

export const METRIC_GRANULARITY_SPECS: Record<MetricGranularity, MetricGranularitySpec> = {
  minute: { stepSeconds: 60, periods: 24 * 60 },
  hour: { stepSeconds: 60 * 60, periods: 30 * 24 },
  day: { stepSeconds: 24 * 60 * 60, periods: 365 },
};

export interface MetricWindow {
  startBucket: number;
  endBucket: number;
}

// The chart's time axis is a function of granularity and the current moment only — never of
// the data, so every card of one granularity shows the same axis, and a metric that went
// quiet shows a visible gap up to "now" instead of squeezing the axis to itself.
//
// endBucket is the start of the current, still-open period, startBucket is exactly `periods`
// steps before it: the window's closed buckets are the last `periods` ones, and the open
// period on the right is empty until it closes. That one period of slack also keeps a fresh
// point from falling off the right edge when the ticking clock lags or drifts from the server's.
//
// Day buckets are UTC-aligned (flooring epoch seconds by the step), same as the backend's.
export function metricWindowAt(granularity: MetricGranularity, nowSeconds: number): MetricWindow {
  const { stepSeconds, periods } = METRIC_GRANULARITY_SPECS[granularity];
  const endBucket = Math.floor(nowSeconds / stepSeconds) * stepSeconds;
  return { startBucket: endBucket - periods * stepSeconds, endBucket };
}

export function isSameMetricWindow(left: MetricWindow, right: MetricWindow): boolean {
  return left.startBucket === right.startBucket && left.endBucket === right.endBucket;
}
