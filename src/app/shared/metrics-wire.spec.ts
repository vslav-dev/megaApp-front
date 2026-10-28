import { encodeMetricsWireFixture } from '@app/testing/metrics-wire.fake';
import { decodeMetricsWireSeries, decodeMetricsWireToLatestSnapshot, decodeMetricsWireToPoints } from './metrics-wire';

describe('decodeMetricsWireSeries', () => {
  it('round-trips service/metricName/granularity/points through encode+decode', () => {
    const series = [
      {
        service: 'bot-a',
        metricName: 'heartbeat',
        granularity: 'minute' as const,
        points: [
          { bucket: 60, value: 1 },
          { bucket: 120, value: 0 },
        ],
      },
      {
        service: 'bot-b',
        metricName: 'cost_usd',
        granularity: 'hour' as const,
        points: [{ bucket: 3600, value: 0.42 }],
      },
      {
        service: 'empty-service',
        metricName: 'no_points',
        granularity: 'day' as const,
        points: [],
      },
    ];

    const decoded = decodeMetricsWireSeries(encodeMetricsWireFixture(series));

    expect(decoded).toEqual(series);
  });

  it('decodes an empty series list', () => {
    expect(decodeMetricsWireSeries(encodeMetricsWireFixture([]))).toEqual([]);
  });

  it('throws on an unsupported format version', () => {
    const buffer = encodeMetricsWireFixture([]);
    new DataView(buffer).setUint8(0, 99);
    expect(() => decodeMetricsWireSeries(buffer)).toThrow();
  });

  it('throws on a truncated payload', () => {
    const buffer = encodeMetricsWireFixture([
      { service: 'a', metricName: 'b', granularity: 'minute', points: [{ bucket: 1, value: 2 }] },
    ]);
    expect(() => decodeMetricsWireSeries(buffer.slice(0, buffer.byteLength - 4))).toThrow();
  });
});

describe('decodeMetricsWireToPoints', () => {
  it('flattens every series into one row per point', () => {
    const buffer = encodeMetricsWireFixture([
      {
        service: 'a',
        metricName: 'x',
        granularity: 'minute',
        points: [
          { bucket: 60, value: 1 },
          { bucket: 120, value: 2 },
        ],
      },
      { service: 'b', metricName: 'y', granularity: 'hour', points: [{ bucket: 3600, value: 3 }] },
    ]);

    expect(decodeMetricsWireToPoints(buffer)).toEqual([
      { service: 'a', name: 'x', granularity: 'minute', bucket: 60, value: 1 },
      { service: 'a', name: 'x', granularity: 'minute', bucket: 120, value: 2 },
      { service: 'b', name: 'y', granularity: 'hour', bucket: 3600, value: 3 },
    ]);
  });
});

describe('decodeMetricsWireToLatestSnapshot', () => {
  it('regroups single-point series back into one ServiceLatest per service', () => {
    const buffer = encodeMetricsWireFixture([
      { service: 'api', metricName: 'requests', granularity: 'minute', points: [{ bucket: 120, value: 5 }] },
      { service: 'api', metricName: 'errors', granularity: 'minute', points: [{ bucket: 180, value: 1 }] },
      { service: 'worker', metricName: 'jobs', granularity: 'minute', points: [{ bucket: 60, value: 9 }] },
    ]);

    const snapshot = decodeMetricsWireToLatestSnapshot(buffer);

    expect(snapshot.services).toEqual([
      { service: 'api', lastBucket: 180, metrics: { requests: 5, errors: 1 } },
      { service: 'worker', lastBucket: 60, metrics: { jobs: 9 } },
    ]);
  });
});
