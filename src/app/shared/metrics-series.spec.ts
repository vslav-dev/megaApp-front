import {
  buildCollapsedMetricWindow,
  buildSparseBarSeriesFromPoints,
  buildSparseLineSeriesFromPoints,
  filterMetricPointsByWindow,
  MinuteMetricCollapseCache,
} from '@app/shared/metrics-series';
import { MetricPoint } from '@app/shared/types';

function point(bucket: number, value = 1): MetricPoint {
  return { service: 'api', name: 'requests', granularity: 'minute', bucket, value };
}

describe('filterMetricPointsByWindow', () => {
  it('keeps points on and between both boundaries and drops the ones outside', () => {
    const points = [point(60), point(120), point(180), point(240)];

    expect(filterMetricPointsByWindow(points, 120, 180).map((p) => p.bucket)).toEqual([120, 180]);
  });

  it('returns nothing when every point predates the window', () => {
    expect(filterMetricPointsByWindow([point(60), point(120)], 600, 660)).toEqual([]);
  });
});

describe('buildCollapsedMetricWindow', () => {
  it('aligns both boundaries down to the collapse step', () => {
    expect(buildCollapsedMetricWindow({ startBucket: 130, endBucket: 910 }, 300)).toEqual({
      startBucket: 0,
      endBucket: 900,
    });
  });
});

describe('sparse series builders', () => {
  it('line: inserts a null break after a point followed by a gap longer than one step', () => {
    const series = buildSparseLineSeriesFromPoints([point(60, 1), point(120, 2), point(300, 3)], 60);

    expect(series).toEqual([
      { bucket: 60, value: 1 },
      { bucket: 120, value: 2 },
      { bucket: 180, value: null },
      { bucket: 300, value: 3 },
    ]);
  });

  it('line: does not break a contiguous series', () => {
    expect(buildSparseLineSeriesFromPoints([point(60, 1), point(120, 2)], 60)).toEqual([
      { bucket: 60, value: 1 },
      { bucket: 120, value: 2 },
    ]);
  });

  it('bar: maps points one to one', () => {
    expect(buildSparseBarSeriesFromPoints([point(60, 5)])).toEqual([{ bucket: 60, value: 5 }]);
  });
});

describe('MinuteMetricCollapseCache over a sliding window', () => {
  it('stays inside the aligned window and matches a fresh rebuild after the window start moves forward', () => {
    const cache = new MinuteMetricCollapseCache();
    const step = 300;
    const first = Array.from({ length: 10 }, (_, index) => point(index * 60, index));
    const slid = Array.from({ length: 10 }, (_, index) => point((index + 1) * 60, index + 1));

    cache.collapse('k', first, 'avg', false, step);
    const incremental = cache.collapse('k', slid, 'avg', false, step);
    const fresh = new MinuteMetricCollapseCache().collapse('k', slid, 'avg', false, step);

    expect(incremental).toEqual(fresh);
    const window = buildCollapsedMetricWindow({ startBucket: 60, endBucket: 600 }, step);
    expect(incremental.every((p) => p.bucket >= window.startBucket && p.bucket <= window.endBucket)).toBe(true);
  });
});
