import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MetricsSettingsService } from '@app/services/metrics-settings.service';
import { MetricsBinaryFrame, MetricsBinaryFrameType, NetworkService } from '@app/services/network.service';
import { WireSeries } from '@app/shared/metrics-wire';
import { ServiceLatest } from '@app/shared/types';
import { encodeMetricsWireFixture } from '@app/testing/metrics-wire.fake';
import { Subject } from 'rxjs';
import { MetricsHealthService } from './metrics-health.service';

const NOW_TICK_INTERVAL_MS = 30_000;
const BASE_TIME_ISO = '2026-01-01T00:00:00.000Z';

function service(overrides: Partial<ServiceLatest> = {}): ServiceLatest {
  return { service: 'api', lastBucket: 0, metrics: { heartbeat: 1 }, ...overrides };
}

function setup() {
  const metricsBinaryFrames$ = new Subject<MetricsBinaryFrame>();
  const networkServiceFake: Pick<NetworkService, 'metricsBinaryFrames$'> = { metricsBinaryFrames$ };
  const settingsServiceFake: Pick<
    MetricsSettingsService,
    'severityThresholdOverrides$$' | 'setSeverityThresholdOverrides'
  > = {
    severityThresholdOverrides$$: signal({}),
    setSeverityThresholdOverrides: () => {},
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: NetworkService, useValue: networkServiceFake },
      { provide: MetricsSettingsService, useValue: settingsServiceFake },
    ],
  });
  const healthService = TestBed.inject(MetricsHealthService);

  // Mirrors megaapp-back's Realtime.encodeLatestSnapshot: one single-point
  // series per (service, metricName) pair, granularity irrelevant. Every
  // fixture service carries at least one metric (see service() above) — a
  // service with zero metrics never appears in a real snapshot at all (see
  // megaapp-back's Poller.latest, always populated together with its first
  // point), so the wire format has no representation for that case.
  function pushLatest(services: ServiceLatest[]): void {
    const series: WireSeries[] = services.flatMap((svc) =>
      Object.entries(svc.metrics).map(([metricName, value]) => ({
        service: svc.service,
        metricName,
        granularity: 'minute' as const,
        points: [{ bucket: svc.lastBucket, value }],
      })),
    );
    metricsBinaryFrames$.next({ frameType: MetricsBinaryFrameType.Latest, payload: encodeMetricsWireFixture(series) });
  }

  return { healthService, pushLatest };
}

describe('MetricsHealthService.services$$', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BASE_TIME_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is empty until a METRICS_LATEST message arrives over the socket', () => {
    const { healthService } = setup();
    expect(healthService.services$$()).toEqual([]);
    expect(healthService.overallSeverity$$()).toBeNull();
  });

  it('is ok when the service reported within warnAfterSeconds (default 150s)', () => {
    const { healthService, pushLatest } = setup();
    const nowSeconds = Math.floor(Date.now() / 1000);
    pushLatest([service({ lastBucket: nowSeconds - 100 })]);
    expect(healthService.services$$()).toEqual([{ service: 'api', severity: 'ok' }]);
  });

  it('is warn once age exceeds warnAfterSeconds but stays within errorAfterSeconds (default 300s)', () => {
    const { healthService, pushLatest } = setup();
    const nowSeconds = Math.floor(Date.now() / 1000);
    pushLatest([service({ lastBucket: nowSeconds - 200 })]);
    expect(healthService.services$$()).toEqual([{ service: 'api', severity: 'warn' }]);
  });

  it('is error once age exceeds errorAfterSeconds (default 300s)', () => {
    const { healthService, pushLatest } = setup();
    const nowSeconds = Math.floor(Date.now() / 1000);
    pushLatest([service({ lastBucket: nowSeconds - 400 })]);
    expect(healthService.services$$()).toEqual([{ service: 'api', severity: 'error' }]);
  });

  // Only the non-positive case is exercised here — NaN can't actually reach
  // this service anymore: Go's int64 has no NaN, so a wire-decoded lastBucket
  // is always a finite number (severityFromLatest's NaN guard stays as cheap
  // defense-in-depth, just no longer reachable via a realistic fixture).
  it('is error for a non-positive lastBucket, regardless of age', () => {
    const { healthService, pushLatest } = setup();
    pushLatest([service({ lastBucket: 0 })]);
    expect(healthService.services$$()).toEqual([{ service: 'api', severity: 'error' }]);
  });

  it('re-derives severity purely from the passage of time via the periodic tick, with no new message', () => {
    const { healthService, pushLatest } = setup();
    const nowSeconds = Math.floor(Date.now() / 1000);
    pushLatest([service({ lastBucket: nowSeconds - 100 })]);
    expect(healthService.services$$()[0].severity).toBe('ok');

    vi.advanceTimersByTime(NOW_TICK_INTERVAL_MS * 20); // 600s of ticks -> well past errorAfterSeconds
    expect(healthService.services$$()[0].severity).toBe('error');
  });
});

describe('MetricsHealthService.overallSeverity$$', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BASE_TIME_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the worst severity across every reported service', () => {
    const { healthService, pushLatest } = setup();
    const nowSeconds = Math.floor(Date.now() / 1000);
    pushLatest([
      service({ service: 'ok-svc', lastBucket: nowSeconds - 10 }),
      service({ service: 'warn-svc', lastBucket: nowSeconds - 200 }),
      service({ service: 'error-svc', lastBucket: nowSeconds - 400 }),
    ]);
    expect(healthService.overallSeverity$$()).toBe('error');
  });
});

describe('MetricsHealthService.severityThresholds/setSeverityThresholds', () => {
  it('falls back to the default thresholds when no override is set for the service', () => {
    const { healthService } = setup();
    expect(healthService.severityThresholds('api')).toEqual({ warnAfterSeconds: 150, errorAfterSeconds: 300 });
  });
});
