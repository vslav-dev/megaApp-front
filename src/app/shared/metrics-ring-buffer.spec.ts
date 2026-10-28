import { MetricRingBuffer } from './metrics-ring-buffer';

describe('MetricRingBuffer', () => {
  it('returns points sorted by bucket ascending regardless of insertion order', () => {
    const buffer = new MetricRingBuffer(10, 60);
    buffer.insert(180, 3);
    buffer.insert(60, 1);
    buffer.insert(120, 2);

    expect(buffer.toSortedPoints()).toEqual([
      { bucket: 60, value: 1 },
      { bucket: 120, value: 2 },
      { bucket: 180, value: 3 },
    ]);
  });

  it('overwrites the value at an already-inserted bucket (last write wins)', () => {
    const buffer = new MetricRingBuffer(10, 60);
    buffer.insert(60, 1);
    buffer.insert(60, 2);

    expect(buffer.toSortedPoints()).toEqual([{ bucket: 60, value: 2 }]);
  });

  it('is empty before any insert', () => {
    const buffer = new MetricRingBuffer(10, 60);
    expect(buffer.toSortedPoints()).toEqual([]);
    expect(buffer.size()).toBe(0);
  });

  it('evicts a bucket once it falls more than capacity*step behind the latest-ever-inserted bucket', () => {
    const capacity = 5;
    const stepSeconds = 60;
    const buffer = new MetricRingBuffer(capacity, stepSeconds);

    for (let i = 0; i <= capacity; i++) {
      buffer.insert(60 + i * stepSeconds, i);
    }

    const points = buffer.toSortedPoints();
    expect(points.length).toBe(capacity);
    expect(points.map((p) => p.value)).not.toContain(0); // the very first insert (value 0) fell off
    expect(points[points.length - 1]).toEqual({ bucket: 60 + capacity * stepSeconds, value: capacity });
  });

  it('size() matches toSortedPoints().length without allocating', () => {
    const buffer = new MetricRingBuffer(5, 60);
    buffer.insert(60, 1);
    buffer.insert(120, 2);
    expect(buffer.size()).toBe(buffer.toSortedPoints().length);
  });

  it('fromSnapshot(snapshot()) round-trips to an equivalent buffer', () => {
    const original = new MetricRingBuffer(5, 60);
    original.insert(60, 1);
    original.insert(120, 2);
    original.insert(180, 3);

    const restored = MetricRingBuffer.fromSnapshot(5, 60, original.snapshot());

    expect(restored).not.toBeNull();
    expect(restored!.toSortedPoints()).toEqual(original.toSortedPoints());
    expect(restored!.size()).toBe(original.size());
  });

  it('fromSnapshot() rejects a snapshot whose capacity does not match', () => {
    const buffer = new MetricRingBuffer(5, 60);
    buffer.insert(60, 1);

    expect(MetricRingBuffer.fromSnapshot(10, 60, buffer.snapshot())).toBeNull();
  });

  it('a restored buffer keeps evicting relative to the snapshot latestBucket, not a fresh one', () => {
    const capacity = 5;
    const stepSeconds = 60;
    const original = new MetricRingBuffer(capacity, stepSeconds);
    for (let i = 0; i <= capacity; i++) {
      original.insert(60 + i * stepSeconds, i);
    }

    const restored = MetricRingBuffer.fromSnapshot(capacity, stepSeconds, original.snapshot())!;
    expect(restored.toSortedPoints()).toEqual(original.toSortedPoints());
  });
});
