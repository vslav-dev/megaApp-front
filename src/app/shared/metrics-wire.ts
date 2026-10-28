import { MetricGranularity, MetricPoint, MetricsLatestSnapshot, ServiceLatest } from '@app/shared/types';

// Decodes the compact binary layout shared with Flatline's
// /api/metrics/history and /api/metrics/since (proxied through megaapp-back
// unread) and with the METRICS_UPDATE/METRICS_LATEST WS frames megaapp-back
// encodes on the same format — see
// megaapp-back/internal/metrics/wire/wire.go, whose byte layout this mirrors
// exactly (kept in sync by hand across the three repos, not by shared code).
//
// Layout (all integers little-endian):
//
//   byte    formatVersion
//   uint32  seriesCount
//   uint32  totalPoints
//   -- seriesCount series headers --
//     uint16 serviceLen;    byte[serviceLen]    service (utf8)
//     uint16 metricNameLen; byte[metricNameLen] metricName (utf8)
//     byte   granularity
//     uint32 pointCount
//   -- padding to the next 8-byte boundary --
//   -- totalPoints int64 bucket timestamps, grouped by series in header order --
//   -- totalPoints float64 values, grouped by series in header order --

const FORMAT_VERSION = 1;
const GRANULARITY_BY_WIRE_BYTE: MetricGranularity[] = ['minute', 'hour', 'day'];

export interface WireSeries {
  service: string;
  metricName: string;
  granularity: MetricGranularity;
  points: { bucket: number; value: number }[];
}

function align8(offset: number): number {
  const remainder = offset % 8;
  return remainder === 0 ? offset : offset + (8 - remainder);
}

// Decodes the wire payload into per-series points — the shape closest to
// the byte layout, used internally by the two flatter decoders below.
export function decodeMetricsWireSeries(buffer: ArrayBuffer): WireSeries[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 9) {
    throw new Error('malformed metrics wire payload: too short');
  }
  if (view.getUint8(0) !== FORMAT_VERSION) {
    throw new Error(`malformed metrics wire payload: unsupported version ${view.getUint8(0)}`);
  }
  const seriesCount = view.getUint32(1, true);
  const totalPoints = view.getUint32(5, true);

  const decoder = new TextDecoder('utf-8');
  const headers: { service: string; metricName: string; granularity: MetricGranularity; pointCount: number }[] = [];
  let offset = 9;
  for (let i = 0; i < seriesCount; i++) {
    const serviceLen = view.getUint16(offset, true);
    offset += 2;
    const service = decoder.decode(new Uint8Array(buffer, offset, serviceLen));
    offset += serviceLen;

    const metricNameLen = view.getUint16(offset, true);
    offset += 2;
    const metricName = decoder.decode(new Uint8Array(buffer, offset, metricNameLen));
    offset += metricNameLen;

    const granularityByte = view.getUint8(offset);
    offset += 1;
    const granularity = GRANULARITY_BY_WIRE_BYTE[granularityByte] ?? 'minute';
    const pointCount = view.getUint32(offset, true);
    offset += 4;

    headers.push({ service, metricName, granularity, pointCount });
  }

  const bucketsStart = align8(offset);
  const valuesStart = bucketsStart + totalPoints * 8;
  if (valuesStart + totalPoints * 8 > buffer.byteLength) {
    throw new Error('malformed metrics wire payload: truncated point data');
  }

  const series: WireSeries[] = [];
  let pointIndex = 0;
  for (const header of headers) {
    const points: { bucket: number; value: number }[] = new Array(header.pointCount);
    for (let i = 0; i < header.pointCount; i++) {
      const bucket = Number(view.getBigInt64(bucketsStart + pointIndex * 8, true));
      const value = view.getFloat64(valuesStart + pointIndex * 8, true);
      points[i] = { bucket, value };
      pointIndex++;
    }
    series.push({ service: header.service, metricName: header.metricName, granularity: header.granularity, points });
  }
  return series;
}

// Flattens the wire payload directly into the point-per-row shape the rest
// of the app already works with (metrics.service.ts's ring buffers,
// metrics-series.ts, metric-chart-card.ts) — used for /api/metrics/history
// and the METRICS_UPDATE WS frame.
export function decodeMetricsWireToPoints(buffer: ArrayBuffer): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const series of decodeMetricsWireSeries(buffer)) {
    for (const point of series.points) {
      points.push({ service: series.service, name: series.metricName, granularity: series.granularity, ...point });
    }
  }
  return points;
}

// Regroups the wire payload back into MetricsLatestSnapshot's per-service
// shape — used for the METRICS_LATEST WS frame, whose points are always
// single-point series (see megaapp-back's Realtime.encodeLatestSnapshot).
// Granularity is meaningless here (a placeholder on the encoder side) and is
// ignored.
export function decodeMetricsWireToLatestSnapshot(buffer: ArrayBuffer): MetricsLatestSnapshot {
  const byService = new Map<string, ServiceLatest>();
  for (const series of decodeMetricsWireSeries(buffer)) {
    const point = series.points[0];
    if (!point) continue;
    let service = byService.get(series.service);
    if (!service) {
      service = { service: series.service, lastBucket: point.bucket, metrics: {} };
      byService.set(series.service, service);
    }
    service.lastBucket = Math.max(service.lastBucket, point.bucket);
    service.metrics[series.metricName] = point.value;
  }
  return { services: Array.from(byService.values()) };
}
