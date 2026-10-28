// Raw internal state of a MetricRingBuffer, for IndexedDB persistence
// (megaapp-front/plans/35-metrics-dashboard-viewport-rendering.implementation-plan.md
// §2.4) — typed arrays go into IndexedDB as-is (structured clone handles them
// natively, no JSON involved), one record per series.
export interface MetricRingBufferSnapshot {
  buckets: Float64Array;
  values: Float64Array;
  latestBucket: number;
}

// Fixed-capacity, bucket-addressed ring buffer for one (service, metricName,
// granularity) series — replaces the session-wide Map + age-based full-scan
// pruning in metrics.service.ts. O(1) insert with automatic eviction: a slot
// is simply overwritten by whichever bucket next hashes to it, and a slot
// older than `capacity` periods behind the buffer's own latest bucket reads
// back as empty, never surfacing a stale value left over from a previous
// trip around the ring. See
// megaapp-front/plans/33-metrics-flow-tstorage-migration.implementation-plan.md §2.1.
export class MetricRingBuffer {
  private readonly buckets: Float64Array;
  private readonly values: Float64Array;
  private latestBucket = Number.NEGATIVE_INFINITY;

  public constructor(
    private readonly capacity: number,
    private readonly stepSeconds: number,
  ) {
    this.buckets = new Float64Array(capacity).fill(NaN);
    this.values = new Float64Array(capacity);
  }

  public insert(bucket: number, value: number): void {
    const slot = this.slotFor(bucket);
    this.buckets[slot] = bucket;
    this.values[slot] = value;
    if (bucket > this.latestBucket) this.latestBucket = bucket;
  }

  // Ascending by bucket. Slots holding a bucket more than `capacity` periods
  // behind the latest-ever-inserted bucket are stale leftovers from an
  // earlier trip around the ring and are skipped, not returned as data.
  public toSortedPoints(): { bucket: number; value: number }[] {
    if (!Number.isFinite(this.latestBucket)) return [];

    const maxAge = this.capacity * this.stepSeconds;
    const points: { bucket: number; value: number }[] = [];
    for (let i = 0; i < this.capacity; i++) {
      const bucket = this.buckets[i];
      if (Number.isNaN(bucket) || this.latestBucket - bucket >= maxAge) continue;
      points.push({ bucket, value: this.values[i] });
    }
    return points.sort((a, b) => a.bucket - b.bucket);
  }

  // Cheap activity gauge for telemetry — counts live (non-stale) slots
  // without allocating/sorting, unlike toSortedPoints().
  public size(): number {
    if (!Number.isFinite(this.latestBucket)) return 0;

    const maxAge = this.capacity * this.stepSeconds;
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!Number.isNaN(this.buckets[i]) && this.latestBucket - this.buckets[i] < maxAge) count++;
    }
    return count;
  }

  // Copies (not views) of the internal typed arrays — safe to hand to a
  // caller that will hold onto this past the buffer's next insert().
  public snapshot(): MetricRingBufferSnapshot {
    return { buckets: this.buckets.slice(), values: this.values.slice(), latestBucket: this.latestBucket };
  }

  // Rebuilds a buffer from a persisted snapshot. Returns null instead of
  // restoring a mismatched-capacity snapshot (e.g. a granularity's `periods` in
  // metrics-granularity.ts changed between deploys) — the caller simply starts that series empty and
  // re-backfills from REST/WS, same as any other cold cache miss.
  public static fromSnapshot(
    capacity: number,
    stepSeconds: number,
    snapshot: MetricRingBufferSnapshot,
  ): MetricRingBuffer | null {
    if (snapshot.buckets.length !== capacity || snapshot.values.length !== capacity) return null;
    const buffer = new MetricRingBuffer(capacity, stepSeconds);
    buffer.buckets.set(snapshot.buckets);
    buffer.values.set(snapshot.values);
    buffer.latestBucket = snapshot.latestBucket;
    return buffer;
  }

  private slotFor(bucket: number): number {
    const period = Math.floor(bucket / this.stepSeconds);
    return ((period % this.capacity) + this.capacity) % this.capacity;
  }
}
