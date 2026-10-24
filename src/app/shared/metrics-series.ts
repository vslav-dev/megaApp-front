import { aggregateMetricValues, MetricAggregation } from '@app/shared/metrics-aggregation';
import { MetricWindow } from '@app/shared/metrics-granularity';
import { MetricGranularity, MetricPoint } from '@app/shared/types';

export interface MetricSeriesPoint {
  bucket: number;
  value: number | null;
}

interface CollapsedBucketState {
  values: number[];
}

interface MinuteCollapseCacheEntry {
  aggregation: MetricAggregation;
  integerValued: boolean;
  bucketSizeSeconds: number;
  rawPoints: MetricPoint[];
  bucketStates: Map<number, CollapsedBucketState>;
  collapsedPoints: MetricPoint[];
}

export function metricPointsIndexKey(service: string, name: string): string {
  return `${service}:${name}`;
}

export function buildSparseBarSeriesFromPoints(points: MetricPoint[]): MetricSeriesPoint[] {
  return points.map((point) => ({
    bucket: point.bucket,
    value: point.value,
  }));
}

// A gap is "real" (worth visually breaking the line for) once more than one
// normal step has passed without a point — threshold must match whatever
// granularity's step the series is actually sampled at, never a flat 60s,
// or hour/day series (step 3600/86400) would show a gap after every point.
export function buildSparseLineSeriesFromPoints(
  sorted: MetricPoint[],
  gapThresholdSeconds: number,
): MetricSeriesPoint[] {
  const series: MetricSeriesPoint[] = [];
  sorted.forEach((point, index) => {
    series.push({ bucket: point.bucket, value: point.value });
    const next = sorted[index + 1];
    if (next && next.bucket - point.bucket > gapThresholdSeconds) {
      series.push({ bucket: point.bucket + gapThresholdSeconds, value: null });
    }
  });
  return series;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatMetricBucketLabel(bucketSeconds: number, granularity: MetricGranularity = 'minute'): string {
  const date = new Date(bucketSeconds * 1000);
  const datePart = `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
  if (granularity === 'day') return datePart;
  const timePart = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return granularity === 'hour' ? `${datePart} ${timePart}` : timePart;
}

// On the hour granularity, ticks sit days apart — showing the time alongside the
// date is both unnecessary and, at 5 ticks across a narrow chart, wide enough to
// overlap — so the axis only shows the date, same as the day granularity already
// does. On other granularities, a tick landing exactly on local midnight already
// tells you the time (00:00), so the date alone is enough there too.
export function formatMetricTickLabel(bucketSeconds: number, granularity: MetricGranularity = 'minute'): string {
  const date = new Date(bucketSeconds * 1000);
  if (granularity === 'hour' || (date.getHours() === 0 && date.getMinutes() === 0)) {
    return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
  }
  return formatMetricBucketLabel(bucketSeconds, granularity);
}

// Every bucket in [windowStartBucket, windowEndBucket] that lands exactly on an
// interval boundary (e.g. 3600 for round hours) — unlike buildPaddedTickBuckets,
// tick count varies with window length instead of being fixed.
export function buildRoundTickBuckets(
  windowStartBucket: number,
  windowEndBucket: number,
  intervalSeconds: number,
): number[] {
  const firstTick = Math.ceil(windowStartBucket / intervalSeconds) * intervalSeconds;
  const buckets: number[] = [];
  for (let bucket = firstTick; bucket <= windowEndBucket; bucket += intervalSeconds) {
    buckets.push(bucket);
  }
  return buckets;
}

// LOAD-BEARING: the backend aggregates "day" buckets strictly at UTC midnight
// ((t/86400)*86400 — see flatline's rollup job), and that can't be changed to the
// user's local midnight without re-aggregating history, which is only possible for the
// last ~60 days (hourly source data, which day buckets are built from, isn't kept
// longer). This flag only controls how the CHART RENDERS that already-fixed UTC day
// boundary — it does not change what a "day" actually means on the backend.
//   true  -> tick is drawn at UTC midnight, exactly where each day's data point sits.
//            Tick and point line up pixel-perfect, but the tick no longer sits on the
//            viewer's own local midnight.
//   false -> tick is drawn at the viewer's local midnight. Matches the viewer's own
//            wall clock, but visibly drifts away from the data point by the viewer's
//            UTC offset (e.g. ~5-6h for Asia/Almaty) — the two draw as separate lines.
const ALIGN_DAY_TICKS_TO_UTC_BUCKET = true;

// LOAD-BEARING: Every midnight (00:00, UTC or local per ALIGN_DAY_TICKS_TO_UTC_BUCKET above) in
// [windowStartBucket, windowEndBucket] — steps by calendar day via Date instead of a
// flat 86400s stride, so a DST transition inside the window can't drift a later tick.
export function buildRoundDayTickBuckets(windowStartBucket: number, windowEndBucket: number): number[] {
  const cursor = new Date(windowStartBucket * 1000);
  const setMidnight = ALIGN_DAY_TICKS_TO_UTC_BUCKET
    ? () => cursor.setUTCHours(0, 0, 0, 0)
    : () => cursor.setHours(0, 0, 0, 0);
  const stepDay = ALIGN_DAY_TICKS_TO_UTC_BUCKET
    ? () => cursor.setUTCDate(cursor.getUTCDate() + 1)
    : () => cursor.setDate(cursor.getDate() + 1);

  setMidnight();
  if (cursor.getTime() < windowStartBucket * 1000) {
    stepDay();
  }

  const buckets: number[] = [];
  while (cursor.getTime() <= windowEndBucket * 1000) {
    buckets.push(Math.floor(cursor.getTime() / 1000));
    stepDay();
  }
  return buckets;
}

// `segments + 1` buckets, evenly spaced from start to end (both included).
function buildEvenTickBuckets(startBucket: number, endBucket: number, segments: number): number[] {
  const span = endBucket - startBucket;
  const buckets: number[] = [];
  for (let index = 0; index <= segments; index++) {
    buckets.push(Math.round(startBucket + (span * index) / segments));
  }
  return buckets;
}

// Fraction of the window trimmed off each side before placing ticks — keeps the
// outer ticks a bit inset from the window edges instead of sitting exactly on them.
const TICK_EDGE_PADDING_FRACTION = 2 / 24;
const TICK_COUNT = 5;

export function buildPaddedTickBuckets(windowStartBucket: number, windowEndBucket: number): number[] {
  const span = windowEndBucket - windowStartBucket;
  const edgePadding = span * TICK_EDGE_PADDING_FRACTION;
  return buildEvenTickBuckets(windowStartBucket + edgePadding, windowEndBucket - edgePadding, TICK_COUNT - 1);
}

// Binary search: series is always bucket-sorted ascending (builders above guarantee it).
export function findNearestSeriesPoint(series: MetricSeriesPoint[], targetBucket: number): MetricSeriesPoint | null {
  if (series.length === 0) {
    return null;
  }

  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid].bucket < targetBucket) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const candidate = series[low];
  const previous = series[low - 1];
  if (!previous) {
    return candidate;
  }
  return Math.abs(previous.bucket - targetBucket) <= Math.abs(candidate.bucket - targetBucket) ? previous : candidate;
}

export function alignBucketDown(bucketSeconds: number, stepSeconds: number): number {
  return Math.floor(bucketSeconds / stepSeconds) * stepSeconds;
}

export function buildCollapsedMetricWindow(window: MetricWindow, stepSeconds: number): MetricWindow {
  const startBucket = alignBucketDown(window.startBucket, stepSeconds);
  const endBucket = alignBucketDown(window.endBucket, stepSeconds);
  return { startBucket, endBucket };
}

export function filterMetricPointsByWindow(
  points: MetricPoint[],
  windowStartBucket: number,
  windowEndBucket: number,
): MetricPoint[] {
  return points.filter((point) => point.bucket >= windowStartBucket && point.bucket <= windowEndBucket);
}

export interface ValueCorridor {
  min: number;
  max: number;
}

// Chart Y-axis clamp, not a data filter — the underlying series is never
// touched, only the visible corridor. `percent` is how much of the value mass
// must fit inside [min, max]: trim the same fraction of points off each tail
// (e.g. 95% kept → 2.5% trimmed low, 2.5% trimmed high) and take the corridor
// from what's left. One sort, two index reads — nothing fancier than that on
// purpose, this tab already does plenty of math per card.
export function valueCorridor(values: number[], percent: number): ValueCorridor | null {
  if (values.length === 0) return null;

  const sorted = values.slice().sort((left, right) => left - right);
  const tailFraction = (1 - percent / 100) / 2;
  const lowIndex = Math.floor(tailFraction * (sorted.length - 1));
  const highIndex = Math.ceil((1 - tailFraction) * (sorted.length - 1));
  return { min: sorted[lowIndex], max: sorted[highIndex] };
}

// A metric's own value never needs more precision than hundredths for tick-rounding purposes —
// matches the two decimal places money/ratio/duration formatting already caps out at (see
// formatMetricUnitValue in metric-units.ts) — so the search never goes finer than this.
const FINEST_STEP_EXPONENT = -2;

// How far a tick may drift from its ideal evenly-spaced position, as a fraction of the axis span.
// 0 means no drift at all (locked to the ideal position, i.e. the exact midpoint for a single
// intermediate tick); 0.5 already lets it drift the full half-span in either direction, which
// reaches the axis's own min/max — there's nothing beyond that left to reach, so this is the
// designed ceiling for the ratio, not an accident of the window check below. Exported so
// MetricsSettingsService can clamp its 0–50% user-facing knob to the same number instead of
// duplicating it. See MetricsSettingsService.yTickSnapTolerancePercent$$.
export const MAX_SNAP_TOLERANCE_RATIO = 0.5;

// The largest multiple of `step` that lies strictly inside (lo, hi), picking whichever multiple
// is closest to idealValue when the window is wide enough to fit more than one — null if the
// window is empty or too narrow to fit any multiple of `step` at all.
function nearestStepMultipleInWindow(idealValue: number, step: number, lo: number, hi: number): number | null {
  if (lo >= hi) return null;
  const minMultiplier = Math.floor(lo / step) + 1;
  const maxMultiplier = Math.ceil(hi / step) - 1;
  if (minMultiplier > maxMultiplier) return null;

  const idealMultiplier = Math.round(idealValue / step);
  const multiplier = Math.min(Math.max(idealMultiplier, minMultiplier), maxMultiplier);
  return multiplier * step;
}

// Finds the roundest tick value inside the corridor `idealValue ± span×snapToleranceRatio`
// (capped at MAX_SNAP_TOLERANCE_RATIO, clamped to the axis's open (previous, max) window): builds
// the corridor once up front, then searches power-of-ten steps coarsest-first (nearest thousand,
// then hundred, then ten, …) so the roundest value that actually fits the corridor always wins —
// unlike guessing a candidate first and only checking the window afterwards, which either misses
// a valid coarser candidate that isn't the single nearest guess, or throws away all rounding the
// moment that guess falls outside the window. Falls back to the unsnapped idealValue only when
// even the finest step (hundredths) has no multiple inside the corridor, which happens only once
// snapToleranceRatio is at or near 0.
function snapYTickValue(
  idealValue: number,
  span: number,
  snapToleranceRatio: number,
  previous: number,
  max: number,
): number {
  const halfWidth = span * Math.min(snapToleranceRatio, MAX_SNAP_TOLERANCE_RATIO);
  const windowLo = Math.max(idealValue - halfWidth, previous);
  const windowHi = Math.min(idealValue + halfWidth, max);

  const magnitude = Math.max(Math.abs(idealValue), span);
  const topExponent = Math.max(Math.ceil(Math.log10(magnitude)) + 1, FINEST_STEP_EXPONENT);

  for (let exponent = topExponent; exponent >= FINEST_STEP_EXPONENT; exponent--) {
    const step = 10 ** exponent;
    const candidate = nearestStepMultipleInWindow(idealValue, step, windowLo, windowHi);
    if (candidate !== null) {
      // Cleans float dust (e.g. 1470.0000000000002 from step=0.1 arithmetic) — done once, only
      // for the winning candidate, not on every rejected step of the search above.
      return Number(candidate.toFixed(Math.max(0, -exponent)));
    }
  }
  return idealValue;
}

// Y-axis ticks between the corridor's min and max (exclusive): `count` values spaced
// evenly across the span, each snapped to the nearest "nice" round number that stays
// close to its ideal position (see snapYTickValue). snapYTickValue itself guards against
// a snap collapsing into a neighboring tick (or min/max), falling back to the unsnapped
// ideal value only once no round-enough candidate fits the window at all.
export function buildIntermediateYTicks(min: number, max: number, count: number, snapToleranceRatio: number): number[] {
  const span = max - min;
  if (span <= 0 || count <= 0) {
    return [];
  }

  const segments = count + 1;
  const ticks: number[] = [];
  let previous = min;
  for (let index = 1; index <= count; index++) {
    const idealValue = min + (span * index) / segments;
    const value = snapYTickValue(idealValue, span, snapToleranceRatio, previous, max);
    ticks.push(value);
    previous = value;
  }
  return ticks;
}

export class MinuteMetricCollapseCache {
  private readonly cache = new Map<string, MinuteCollapseCacheEntry>();

  public collapse(
    cacheKey: string,
    points: MetricPoint[],
    aggregation: MetricAggregation,
    integerValued: boolean,
    bucketSizeSeconds: number,
  ): MetricPoint[] {
    const cached = this.cache.get(cacheKey);
    if (
      !cached ||
      cached.aggregation !== aggregation ||
      cached.integerValued !== integerValued ||
      cached.bucketSizeSeconds !== bucketSizeSeconds
    ) {
      const rebuilt = this.rebuild(points, aggregation, integerValued, bucketSizeSeconds);
      this.cache.set(cacheKey, rebuilt);
      return rebuilt.collapsedPoints;
    }

    if (!this.canIncrementallyUpdate(cached.rawPoints, points)) {
      const rebuilt = this.rebuild(points, aggregation, integerValued, bucketSizeSeconds);
      this.cache.set(cacheKey, rebuilt);
      return rebuilt.collapsedPoints;
    }

    const currentStartBucket = points[0]?.bucket ?? Number.POSITIVE_INFINITY;
    let removedCount = 0;
    while (removedCount < cached.rawPoints.length && cached.rawPoints[removedCount].bucket < currentStartBucket) {
      this.removePoint(cached, cached.rawPoints[removedCount]);
      removedCount++;
    }

    let overlapCount = 0;
    const previousLastBucket = cached.rawPoints[cached.rawPoints.length - 1]?.bucket ?? Number.NEGATIVE_INFINITY;
    while (overlapCount < points.length && points[overlapCount].bucket <= previousLastBucket) {
      overlapCount++;
    }
    for (const point of points.slice(overlapCount)) {
      this.addPoint(cached, point);
    }

    cached.rawPoints = points.slice();
    cached.collapsedPoints = this.buildCollapsedPoints(cached, points);
    return cached.collapsedPoints;
  }

  private rebuild(
    points: MetricPoint[],
    aggregation: MetricAggregation,
    integerValued: boolean,
    bucketSizeSeconds: number,
  ): MinuteCollapseCacheEntry {
    const entry: MinuteCollapseCacheEntry = {
      aggregation,
      integerValued,
      bucketSizeSeconds,
      rawPoints: points.slice(),
      bucketStates: new Map<number, CollapsedBucketState>(),
      collapsedPoints: [],
    };
    for (const point of points) {
      this.addPoint(entry, point);
    }
    entry.collapsedPoints = this.buildCollapsedPoints(entry, points);
    return entry;
  }

  private canIncrementallyUpdate(previous: MetricPoint[], current: MetricPoint[]): boolean {
    if (previous.length === 0 || current.length === 0) {
      return (
        previous.length === 0 ||
        current.length === 0 ||
        current[current.length - 1].bucket >= previous[previous.length - 1].bucket
      );
    }
    if (
      current[0].bucket < previous[0].bucket ||
      current[current.length - 1].bucket < previous[previous.length - 1].bucket
    ) {
      return false;
    }

    let previousStartIndex = 0;
    while (previousStartIndex < previous.length && previous[previousStartIndex].bucket < current[0].bucket) {
      previousStartIndex++;
    }

    let currentOverlapLength = 0;
    while (
      currentOverlapLength < current.length &&
      current[currentOverlapLength].bucket <= previous[previous.length - 1].bucket
    ) {
      currentOverlapLength++;
    }

    const previousOverlapLength = previous.length - previousStartIndex;
    if (previousOverlapLength !== currentOverlapLength) {
      return false;
    }

    for (let index = 0; index < previousOverlapLength; index++) {
      const previousPoint = previous[previousStartIndex + index];
      const currentPoint = current[index];
      if (previousPoint.bucket !== currentPoint.bucket || previousPoint.value !== currentPoint.value) {
        return false;
      }
    }
    return true;
  }

  private addPoint(entry: MinuteCollapseCacheEntry, point: MetricPoint): void {
    const collapsedBucket = alignBucketDown(point.bucket, entry.bucketSizeSeconds);
    const state = entry.bucketStates.get(collapsedBucket);
    if (state) {
      state.values.push(point.value);
      return;
    }
    entry.bucketStates.set(collapsedBucket, { values: [point.value] });
  }

  private removePoint(entry: MinuteCollapseCacheEntry, point: MetricPoint): void {
    const collapsedBucket = alignBucketDown(point.bucket, entry.bucketSizeSeconds);
    const state = entry.bucketStates.get(collapsedBucket);
    if (!state) {
      return;
    }
    state.values.shift();
    if (state.values.length === 0) {
      entry.bucketStates.delete(collapsedBucket);
    }
  }

  private buildCollapsedPoints(entry: MinuteCollapseCacheEntry, points: MetricPoint[]): MetricPoint[] {
    if (points.length === 0) {
      return [];
    }

    return Array.from(entry.bucketStates.entries())
      .sort(([leftBucket], [rightBucket]) => leftBucket - rightBucket)
      .map(([bucket, state]) => ({
        service: points[0].service,
        name: points[0].name,
        granularity: points[0].granularity,
        bucket,
        value: aggregateMetricValues(entry.aggregation, state.values, entry.integerValued),
      }));
  }
}
