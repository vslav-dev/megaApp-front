import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { IndexedDbCacheService } from '@app/services/indexed-db-cache.service';
import { MetricsBinaryFrame, MetricsBinaryFrameType, NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { METRIC_GRANULARITY_SPECS } from '@app/shared/metrics-granularity';
import { MetricRingBuffer } from '@app/shared/metrics-ring-buffer';
import { MetricPoint } from '@app/shared/types';
import { encodeMetricsWireFixture } from '@app/testing/metrics-wire.fake';
import { createTelemetryFake } from '@app/testing/telemetry.fake';
import { Subject } from 'rxjs';
import { MetricsService } from './metrics.service';

function metricPoint(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return { service: 'api', name: 'requests', granularity: 'minute', bucket: 1_000_000, value: 1, ...overrides };
}

function setup(options: { persistedSeries?: unknown[] } = {}) {
  const metricsBinaryFrames$ = new Subject<MetricsBinaryFrame>();
  const isConnected$$ = signal(false);
  const networkServiceFake: Pick<NetworkService, 'metricsBinaryFrames$' | 'isConnected$$' | 'sendMessage'> = {
    metricsBinaryFrames$,
    isConnected$$,
    sendMessage: vi.fn(() => true),
  };
  const notificationServiceFake: Pick<NotificationService, 'addNotification' | 'removeNotification'> = {
    addNotification: vi.fn(() => 'notification-id'),
    removeNotification: vi.fn(),
  };
  const indexedDbCacheFake: Pick<
    IndexedDbCacheService,
    'get' | 'set' | 'remove' | 'getAllMetricSeries' | 'setMetricSeries' | 'clearMetricSeries'
  > = {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    getAllMetricSeries: vi.fn(() =>
      Promise.resolve(options.persistedSeries ?? []),
    ) as IndexedDbCacheService['getAllMetricSeries'],
    setMetricSeries: vi.fn(() => Promise.resolve()),
    clearMetricSeries: vi.fn(() => Promise.resolve()),
  };
  // Unknown (never Guest) — MetricsService wipes all state on a confirmed guest
  // session (resetOnAuthLossEffect), which these tests don't want mid-run.
  const authServiceFake: Pick<AuthService, 'sessionState$$'> = {
    sessionState$$: signal<AuthSessionState>(AuthSessionState.Unknown),
  };

  const telemetryFake = createTelemetryFake();
  vi.spyOn(telemetryFake, 'recordAfterPaint');

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withXhr()),
      provideHttpClientTesting(),
      { provide: NetworkService, useValue: networkServiceFake },
      { provide: NotificationService, useValue: notificationServiceFake },
      { provide: IndexedDbCacheService, useValue: indexedDbCacheFake },
      { provide: TelemetryService, useValue: telemetryFake },
      { provide: AuthService, useValue: authServiceFake },
    ],
  });

  return {
    service: TestBed.inject(MetricsService),
    httpMock: TestBed.inject(HttpTestingController),
    metricsBinaryFrames$,
    isConnected$$,
    appRef: TestBed.inject(ApplicationRef),
    indexedDbCacheFake,
    telemetryFake,
  };
}

// Lets the constructor's async IndexedDB cache-load .then() run (isCacheLoaded
// becomes true) before a test drives the connection/scope signals — the
// heartbeat only starts once the cache load has settled.
async function flushCacheLoad(): Promise<void> {
  await Promise.resolve();
}

function pushUpdate(metricsBinaryFrames$: Subject<MetricsBinaryFrame>, points: MetricPoint[]): void {
  const payload = encodeMetricsWireFixture(
    points.map((point) => ({
      service: point.service,
      metricName: point.name,
      granularity: point.granularity,
      points: [{ bucket: point.bucket, value: point.value }],
    })),
  );
  metricsBinaryFrames$.next({ frameType: MetricsBinaryFrameType.Update, payload });
}

describe('MetricsService — point dedup (bufferFor/insertPoint)', () => {
  it('keeps only the latest value for points sharing the same service/name/granularity/bucket key', () => {
    const { service, metricsBinaryFrames$ } = setup();
    pushUpdate(metricsBinaryFrames$, [metricPoint({ value: 10 })]);
    pushUpdate(metricsBinaryFrames$, [metricPoint({ value: 20 })]);
    expect(service.seriesFor('api', 'requests', 'minute')()).toEqual([metricPoint({ value: 20 })]);
  });

  it('drops a point with a non-finite value or an unrecognized granularity instead of throwing', () => {
    const { service, metricsBinaryFrames$ } = setup();
    pushUpdate(metricsBinaryFrames$, [metricPoint({ value: NaN })]);
    // A wire-decoded granularity byte outside 0/1/2 already falls back to
    // 'minute' at the decoder (see GRANULARITY_BY_WIRE_BYTE), so the
    // unrecognized-granularity half of this guard can't be exercised through
    // pushUpdate anymore — it stays as defense-in-depth for any other caller
    // of insertPoint (e.g. cache hydration reading an older/foreign format).
    expect(service.seriesFor('api', 'requests', 'minute')()).toEqual([]);
  });
});

describe('MetricsService — ring buffer capacity eviction (MetricRingBuffer)', () => {
  it('evicts the oldest point of a series once more than the granularity capacity of newer buckets have arrived', () => {
    const { service, metricsBinaryFrames$ } = setup();
    const capacity = METRIC_GRANULARITY_SPECS.minute.periods; // 1440
    const stepSeconds = 60;
    const firstBucket = 60;

    pushUpdate(metricsBinaryFrames$, [metricPoint({ bucket: firstBucket })]);
    // One point per bucket beyond capacity — the ring must have wrapped past
    // the very first bucket by the time this loop ends.
    for (let i = 1; i <= capacity; i++) {
      pushUpdate(metricsBinaryFrames$, [metricPoint({ bucket: firstBucket + i * stepSeconds })]);
    }

    const buckets = service
      .seriesFor('api', 'requests', 'minute')()
      .map((point) => point.bucket);
    expect(buckets).not.toContain(firstBucket);
    expect(buckets.length).toBe(capacity);
  });
});

describe('MetricsService — per-series IndexedDB persistence (scheduleCacheWrite)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes only the series touched since the last write, not every buffered series', async () => {
    const { indexedDbCacheFake, metricsBinaryFrames$ } = setup();
    pushUpdate(metricsBinaryFrames$, [metricPoint({ service: 'api', name: 'requests' })]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(indexedDbCacheFake.setMetricSeries).toHaveBeenCalledTimes(1);
    expect(indexedDbCacheFake.setMetricSeries).toHaveBeenCalledWith(
      'minute:api:requests',
      expect.objectContaining({ service: 'api', name: 'requests', granularity: 'minute' }),
    );

    vi.mocked(indexedDbCacheFake.setMetricSeries).mockClear();
    // A second, unrelated series ticks — only its own record should be written,
    // not 'requests' again (see MetricsService.pendingPersistKeys/publishTouchedSeries).
    pushUpdate(metricsBinaryFrames$, [metricPoint({ service: 'api', name: 'errors' })]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(indexedDbCacheFake.setMetricSeries).toHaveBeenCalledTimes(1);
    expect(indexedDbCacheFake.setMetricSeries).toHaveBeenCalledWith('minute:api:errors', expect.anything());
  });

  it('coalesces several merges inside one debounce window into a single write per touched series', async () => {
    const { indexedDbCacheFake, metricsBinaryFrames$ } = setup();
    pushUpdate(metricsBinaryFrames$, [metricPoint({ bucket: 1_000_000, value: 1 })]);
    pushUpdate(metricsBinaryFrames$, [metricPoint({ bucket: 1_000_060, value: 2 })]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(indexedDbCacheFake.setMetricSeries).toHaveBeenCalledTimes(1);
  });
});

describe('MetricsService — hydration from persisted series (constructor)', () => {
  it('rebuilds a series from a persisted MetricRingBuffer snapshot and exposes it via seriesFor', async () => {
    const capacity = METRIC_GRANULARITY_SPECS.minute.periods;
    const seedBuffer = new MetricRingBuffer(capacity, 60);
    seedBuffer.insert(1_000_000, 42);
    const record = {
      service: 'api',
      name: 'requests',
      granularity: 'minute' as const,
      snapshot: seedBuffer.snapshot(),
    };

    const { service } = setup({ persistedSeries: [record] });
    await flushCacheLoad();

    expect(service.seriesFor('api', 'requests', 'minute')()).toEqual([metricPoint({ bucket: 1_000_000, value: 42 })]);
  });
});

describe('MetricsService.forceRefresh — refreshHistory (binary /api/metrics/history response)', () => {
  it('decodes a wire history response into points and applies the same dedup rules', () => {
    const { service, httpMock } = setup();
    service.setScope([{ service: 'api', metricNames: ['requests'] }]);
    service.forceRefresh();

    const req = httpMock.expectOne((r) => r.url === '/api/metrics/history' && r.method === 'POST');
    expect(req.request.responseType).toBe('arraybuffer');
    req.flush(
      encodeMetricsWireFixture([
        { service: 'api', metricName: 'requests', granularity: 'minute', points: [{ bucket: 1_000_000, value: 42 }] },
      ]),
    );

    expect(service.seriesFor('api', 'requests', 'minute')()).toEqual([metricPoint({ bucket: 1_000_000, value: 42 })]);
    httpMock.verify();
  });

  it('reports how far the server lagged behind the request target and the client clock skew in telemetry', () => {
    vi.useFakeTimers();
    try {
      const now = Date.UTC(2026, 0, 1, 12, 0, 30);
      vi.setSystemTime(now);
      const targetMinute = Math.floor(now / 60_000) * 60 - 60;
      const { service, httpMock, telemetryFake } = setup();
      service.setScope([{ service: 'api', metricNames: ['requests'] }]);
      service.forceRefresh();

      httpMock.expectOne('/api/metrics/history').flush(
        encodeMetricsWireFixture([
          {
            service: 'api',
            metricName: 'requests',
            granularity: 'minute',
            points: [{ bucket: targetMinute - 120, value: 1 }],
          },
        ]),
        { headers: { Date: new Date(now - 5_000).toUTCString() } },
      );

      expect(telemetryFake.recordAfterPaint).toHaveBeenCalledWith(
        'metrics.history_refresh',
        expect.any(Number),
        expect.objectContaining({ minuteLagSeconds: 120, clockSkewSeconds: 5 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits the lag and skew attributes when the response has no minute points and no Date header', () => {
    const { service, httpMock, telemetryFake } = setup();
    service.setScope([{ service: 'api', metricNames: ['requests'] }]);
    service.forceRefresh();

    httpMock.expectOne('/api/metrics/history').flush(encodeMetricsWireFixture([]));

    const attributes = vi.mocked(telemetryFake.recordAfterPaint).mock.calls[0][2];
    expect(attributes).not.toHaveProperty('minuteLagSeconds');
    expect(attributes).not.toHaveProperty('clockSkewSeconds');
  });

  it('does nothing without a scope — no view has charts open, nothing to fetch', () => {
    const { service, httpMock } = setup();
    service.forceRefresh();
    httpMock.expectNone('/api/metrics/history');
  });

  it('sends the current scope in the request body', () => {
    const { service, httpMock } = setup();
    service.setScope([{ service: 'api', metricNames: ['requests'] }]);
    service.forceRefresh();

    const req = httpMock.expectOne((r) => r.url === '/api/metrics/history');
    expect(req.request.body.scope).toEqual([{ service: 'api', metricNames: ['requests'] }]);
    req.flush(encodeMetricsWireFixture([]));
  });
});

describe('MetricsService.forceRefresh — batched history requests', () => {
  const bigScope = [{ service: 'api', metricNames: Array.from({ length: 95 }, (_, index) => `m${index}`) }];

  it('fetches a large scope as sequential bounded requests that together cover every metric once', () => {
    const { service, httpMock } = setup();
    service.setScope(bigScope);
    service.forceRefresh();

    const requested: string[] = [];
    for (const expectedSize of [40, 40, 15]) {
      const req = httpMock.expectOne((r) => r.url === '/api/metrics/history');
      const names = req.request.body.scope.flatMap((entry: { metricNames: string[] }) => entry.metricNames);
      expect(names).toHaveLength(expectedSize);
      requested.push(...names);
      req.flush(encodeMetricsWireFixture([]));
    }

    expect(requested).toEqual(bigScope[0].metricNames);
    httpMock.expectNone('/api/metrics/history');
    expect(service.isRefreshing$$()).toBe(false);
  });

  it('keeps the batches already fetched when a later batch fails and stops the chain', () => {
    const { service, httpMock } = setup();
    service.setScope(bigScope);
    service.forceRefresh();

    httpMock
      .expectOne((r) => r.url === '/api/metrics/history')
      .flush(
        encodeMetricsWireFixture([
          { service: 'api', metricName: 'm0', granularity: 'minute', points: [{ bucket: 1_000_000, value: 7 }] },
        ]),
      );
    httpMock
      .expectOne((r) => r.url === '/api/metrics/history')
      .error(new ProgressEvent('error'), { status: 502, statusText: 'Bad Gateway' });

    // The failing batch stops the chain: the third batch is never sent.
    httpMock.expectNone('/api/metrics/history');
    expect(service.isRefreshing$$()).toBe(false);
    expect(service.seriesFor('api', 'm0', 'minute')()).toEqual([metricPoint({ name: 'm0', value: 7 })]);
  });
});

describe('MetricsService — history heartbeat (subscriptionEffect/syncHistoryHeartbeat)', () => {
  it('fires an immediate history request as soon as connected with a scope, without waiting for the interval', async () => {
    const { service, httpMock, isConnected$$, appRef } = setup();
    await flushCacheLoad();
    service.setScope([{ service: 'api', metricNames: ['requests'] }]);
    isConnected$$.set(true);
    appRef.tick();

    const req = httpMock.expectOne((r) => r.url === '/api/metrics/history');
    req.flush(encodeMetricsWireFixture([]));
    httpMock.verify();
  });

  it('fires a fresh immediate request on every scope change, not just on first activation', async () => {
    const { service, httpMock, isConnected$$, appRef } = setup();
    await flushCacheLoad();
    service.setScope([{ service: 'api', metricNames: ['requests'] }]);
    isConnected$$.set(true);
    appRef.tick();
    httpMock.expectOne((r) => r.url === '/api/metrics/history').flush(encodeMetricsWireFixture([]));

    // The heartbeat interval is already running at this point — before the fix, the
    // "already running" guard also blocked this immediate check, so switching services
    // would silently wait up to a full interval period instead of fetching right away.
    service.setScope([{ service: 'other', metricNames: ['errors'] }]);
    appRef.tick();

    const secondRequest = httpMock.expectOne((r) => r.url === '/api/metrics/history');
    expect(secondRequest.request.body.scope).toEqual([{ service: 'other', metricNames: ['errors'] }]);
    secondRequest.flush(encodeMetricsWireFixture([]));
    httpMock.verify();
  });

  it('catches up on re-entering the view after time has passed, even though live frames stopped while it was closed', async () => {
    vi.useFakeTimers();
    try {
      const { service, httpMock, appRef, metricsBinaryFrames$ } = setup();
      await flushCacheLoad();
      const scope = [{ service: 'api', metricNames: ['requests'] }];
      service.setScope(scope);
      appRef.tick();
      httpMock.expectOne((r) => r.url === '/api/metrics/history').flush(encodeMetricsWireFixture([]));
      pushUpdate(metricsBinaryFrames$, [metricPoint({ bucket: Math.floor(Date.now() / 60_000) * 60 })]);

      service.unsubscribe();
      appRef.tick();
      vi.advanceTimersByTime(10 * 60_000);

      service.setScope(scope);
      appRef.tick();
      httpMock.expectOne((r) => r.url === '/api/metrics/history').flush(encodeMetricsWireFixture([]));
      httpMock.verify();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not drop a scope change that arrives while a request is in flight — a follow-up request picks up the new scope once the first settles', async () => {
    const { service, httpMock, isConnected$$, appRef } = setup();
    await flushCacheLoad();
    service.setScope([{ service: 'api', metricNames: ['requests'] }]);
    isConnected$$.set(true);
    appRef.tick();
    const firstRequest = httpMock.expectOne((r) => r.url === '/api/metrics/history');

    // Scope changes again before the first request resolves — must not be lost.
    service.setScope([{ service: 'other', metricNames: ['errors'] }]);
    appRef.tick();
    httpMock.expectNone('/api/metrics/history');

    firstRequest.flush(encodeMetricsWireFixture([]));

    const secondRequest = httpMock.expectOne((r) => r.url === '/api/metrics/history');
    expect(secondRequest.request.body.scope).toEqual([{ service: 'other', metricNames: ['errors'] }]);
    secondRequest.flush(encodeMetricsWireFixture([]));
    httpMock.verify();
  });
});
