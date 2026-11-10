import { MetricGranularity } from '@app/shared/types';

export const METRIC_GRANULARITIES: readonly MetricGranularity[] = ['minute', 'hour', 'day'];

interface MetricGranularitySpec {
  stepSeconds: number;
  // How many closed periods one window covers — also the depth of the history request.
  // A series' ring buffer holds a few more (see metricBufferCapacity).
  periods: number;
}

// Extra periods a series' ring buffer keeps beyond what one window spans. The window follows the
// (ticking, possibly skewed) clock, a series' buffer follows its own newest point, so right after
// a fresh point lands the window is still one or a few periods behind. Without the slack that
// point would evict the window's left-edge bucket from this series only, and a sum over several
// series would then show the left-edge bucket of the others alone. Reads are always cut to the
// window, so the extra periods are never displayed.
const BUFFER_SLACK_PERIODS = 5;

export function metricBufferCapacity(granularity: MetricGranularity): number {
  return METRIC_GRANULARITY_SPECS[granularity].periods + BUFFER_SLACK_PERIODS;
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
