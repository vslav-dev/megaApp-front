import { METRIC_GRANULARITIES, METRIC_GRANULARITY_SPECS } from '@app/shared/metrics-granularity';
import { MetricGranularity, MetricsScopeEntry } from '@app/shared/types';

export type MetricsHistoryWatermarks = Record<MetricGranularity, number>;

export function emptyMetricsHistoryWatermarks(): MetricsHistoryWatermarks {
  return { minute: 0, hour: 0, day: 0 };
}

export function parseMetricsHistoryWatermarks(value: unknown): MetricsHistoryWatermarks {
  const watermarks = emptyMetricsHistoryWatermarks();
  if (typeof value === 'number' && Number.isFinite(value)) {
    watermarks.minute = value;
    return watermarks;
  }
  if (!value || typeof value !== 'object') return watermarks;

  const stored = value as Partial<MetricsHistoryWatermarks>;
  for (const granularity of METRIC_GRANULARITIES) {
    const watermark = stored[granularity];
    if (typeof watermark === 'number' && Number.isFinite(watermark)) {
      watermarks[granularity] = watermark;
    }
  }
  return watermarks;
}

export function latestClosedHistoryBucket(granularity: MetricGranularity, latestMinuteBucket: number): number {
  if (granularity === 'minute') return latestMinuteBucket;
  const step = METRIC_GRANULARITY_SPECS[granularity].stepSeconds;
  return Math.max(0, Math.floor(latestMinuteBucket / step) * step - step);
}

export function earliestHistoryBucket(granularity: MetricGranularity, latestBucket: number): number {
  const { stepSeconds, periods } = METRIC_GRANULARITY_SPECS[granularity];
  return latestBucket - (periods - 1) * stepSeconds;
}

// Per-metric cursor replaces bucket-scanning entirely (not a per-service patch
// of it) — see megaapp-front/plans/32-metrics-mobile-custom-only-mode.implementation-plan.md
// §4.3. No gap-checking is needed: a confirmed REST response is always
// authoritative for the exact range it was asked for, so "checked through X"
// can be trusted outright. Returns latestBucket+step (nothing to fetch) once
// the cursor has caught up.
//
// Never reaches back past the window start: a cursor that went stale (persisted
// in IndexedDB, then not advanced for days because the fetch kept failing) would
// otherwise ask for everything Flatline retains — far more than the series
// buffer can hold, and enough to trip the server's per-request point cap.
export function nextHistorySinceBucket(
  granularity: MetricGranularity,
  checkedThrough: number,
  latestBucket: number,
): number {
  const windowStart = earliestHistoryBucket(granularity, latestBucket);
  if (checkedThrough <= 0) return windowStart;
  return Math.max(windowStart, checkedThrough + METRIC_GRANULARITY_SPECS[granularity].stepSeconds);
}

// Cursor is on the (service, metric) pair, not the view — a metric shown in
// two places (e.g. dashboard + its own service panel) shares one cursor, so
// switching between those views never re-fetches what the other already has.
// JSON-encoded rather than plain-concatenated so a delimiter character inside
// either name can never collide two distinct pairs onto the same key.
export function metricCursorKey(service: string, name: string): string {
  return JSON.stringify([service, name]);
}

// One history request's size is bounded by metric count, not by scope size: Flatline's
// cost per request grows with the number of series it reads, and it refuses outright
// past 250k points per service. A fresh metric carries at most 2525 points (1440 minute
// + 720 hour + 365 day), so 40 metrics stay near 100k — well under that cap and a
// couple of seconds of server time, however large the whole scope is.
export const HISTORY_BATCH_MAX_METRICS = 40;

export function splitScopeIntoBatches(
  scope: MetricsScopeEntry[],
  maxMetrics = HISTORY_BATCH_MAX_METRICS,
): MetricsScopeEntry[][] {
  const batches: MetricsScopeEntry[][] = [];
  let batch: MetricsScopeEntry[] = [];
  let batchMetrics = 0;
  for (const entry of scope) {
    let start = 0;
    while (start < entry.metricNames.length) {
      const names = entry.metricNames.slice(start, start + maxMetrics - batchMetrics);
      batch.push({ service: entry.service, metricNames: names });
      batchMetrics += names.length;
      start += names.length;
      if (batchMetrics === maxMetrics) {
        batches.push(batch);
        batch = [];
        batchMetrics = 0;
      }
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

export type MetricsCursorMap = Record<string, MetricsHistoryWatermarks>;

export function emptyMetricsCursorMap(): MetricsCursorMap {
  return {};
}

// A cache written before this cursor shape existed (single number/triple, not
// keyed by metric) simply has no keys shaped like metricCursorKey() output —
// every entry here parses fine, nothing to migrate, missing metrics just
// fetch fresh once. See §4.4 of the plan referenced above.
export function parseMetricsCursorMap(value: unknown): MetricsCursorMap {
  const cursors = emptyMetricsCursorMap();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cursors;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    cursors[key] = parseMetricsHistoryWatermarks(raw);
  }
  return cursors;
}
