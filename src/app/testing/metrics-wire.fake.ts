import { WireSeries } from '@app/shared/metrics-wire';

// Test-only encoder for the metrics wire format — production code only ever
// decodes it (megaapp-back/Flatline are the only real encoders), so this
// mirrors megaapp-back's wire.Encode purely to build fixtures for tests that
// exercise the decoder or anything downstream of it (WS binary frames,
// /api/metrics/history responses). See
// megaapp-back/internal/metrics/wire/wire.go for the byte layout this
// produces.
const GRANULARITY_WIRE_BYTE: Record<WireSeries['granularity'], number> = { minute: 0, hour: 1, day: 2 };

export function encodeMetricsWireFixture(series: WireSeries[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const encodedNames = series.map((s) => ({
    service: encoder.encode(s.service),
    metricName: encoder.encode(s.metricName),
  }));

  let headerLen = 1 + 4 + 4;
  let totalPoints = 0;
  for (let i = 0; i < series.length; i++) {
    headerLen += 2 + encodedNames[i].service.length + 2 + encodedNames[i].metricName.length + 1 + 4;
    totalPoints += series[i].points.length;
  }
  const dataStart = align8(headerLen);
  const bucketsStart = dataStart;
  const valuesStart = bucketsStart + totalPoints * 8;
  const buffer = new ArrayBuffer(valuesStart + totalPoints * 8);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint8(0, 1);
  view.setUint32(1, series.length, true);
  view.setUint32(5, totalPoints, true);

  let offset = 9;
  let bucketOffset = bucketsStart;
  let valueOffset = valuesStart;
  for (let i = 0; i < series.length; i++) {
    const { service, metricName } = encodedNames[i];
    view.setUint16(offset, service.length, true);
    offset += 2;
    bytes.set(service, offset);
    offset += service.length;

    view.setUint16(offset, metricName.length, true);
    offset += 2;
    bytes.set(metricName, offset);
    offset += metricName.length;

    view.setUint8(offset, GRANULARITY_WIRE_BYTE[series[i].granularity]);
    offset += 1;
    view.setUint32(offset, series[i].points.length, true);
    offset += 4;

    for (const point of series[i].points) {
      view.setBigInt64(bucketOffset, BigInt(point.bucket), true);
      bucketOffset += 8;
      view.setFloat64(valueOffset, point.value, true);
      valueOffset += 8;
    }
  }

  return buffer;
}

function align8(offset: number): number {
  const remainder = offset % 8;
  return remainder === 0 ? offset : offset + (8 - remainder);
}
