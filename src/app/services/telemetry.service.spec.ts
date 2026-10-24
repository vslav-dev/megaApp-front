import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DeviceInfoService } from '@app/services/device-info.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { Subject } from 'rxjs';
import { TelemetryService } from './telemetry.service';

const EVENTS_URL = '/api/ingest/telemetry';
const BATCH_WINDOW_MS = 60 * 1000;
// what the intake answers when it has stored everything; the service only needs the status
const ANSWER_STORED_ALL = { received: 1, stored: 1, rejected: [] };

// `savedQueue` — what the user's local storage already holds from an earlier visit
function setup(savedQueue: unknown = null) {
  const routerFake: Pick<Router, 'url' | 'events'> = { url: '/money', events: new Subject() };
  const deviceInfoFake: Pick<DeviceInfoService, 'getDevicePlatform' | 'isMobileDevice$$' | 'isMobileScreen$$'> = {
    getDevicePlatform: () => 'desktop',
    isMobileDevice$$: (() => false) as DeviceInfoService['isMobileDevice$$'],
    isMobileScreen$$: (() => false) as DeviceInfoService['isMobileScreen$$'],
  };
  const localStorageFake: Pick<LocalStorageService, 'getUserScoped' | 'setUserScoped'> = {
    getUserScoped: (() => savedQueue) as LocalStorageService['getUserScoped'],
    setUserScoped: vi.fn(),
  };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withXhr()),
      provideHttpClientTesting(),
      { provide: Router, useValue: routerFake },
      { provide: DeviceInfoService, useValue: deviceInfoFake },
      { provide: LocalStorageService, useValue: localStorageFake },
    ],
  });

  return {
    service: TestBed.inject(TelemetryService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

interface RequestBody {
  events: {
    id: string;
    stream: string;
    at: number;
    data: { operation: string; message?: string; attributes?: Record<string, unknown>; [field: string]: unknown };
  }[];
  dropped: number;
}

describe('TelemetryService — batching window', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the first event into an empty queue immediately, as its own batch', () => {
    const { service, httpMock } = setup();

    service.record('app.route_ready', 12);

    const request = httpMock.expectOne(EVENTS_URL);
    const body = request.request.body as RequestBody;
    expect(body.events).toHaveLength(1);
    expect(body.events[0].data.operation).toBe('app.route_ready');
    request.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it('accumulates further events during the window and flushes them together when it closes', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();

    service.record('app.a', 1);
    httpMock.expectOne(EVENTS_URL).flush(ANSWER_STORED_ALL);

    service.record('app.b', 2);
    service.record('app.c', 3);
    httpMock.expectNone(EVENTS_URL);

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    const request = httpMock.expectOne(EVENTS_URL);
    const body = request.request.body as RequestBody;
    expect(body.events.map((event) => event.data.operation)).toEqual(['app.b', 'app.c']);
    request.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it('keeps a batch queued and retries it after the window on a 5xx response', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();

    service.record('app.a', 1);
    httpMock.expectOne(EVENTS_URL).flush(null, { status: 500, statusText: 'Server Error' });

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    const retry = httpMock.expectOne(EVENTS_URL);
    expect((retry.request.body as RequestBody).events).toHaveLength(1);
    retry.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it('drops a batch without retrying it after a 4xx response', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();

    service.record('app.a', 1);
    httpMock.expectOne(EVENTS_URL).flush(null, { status: 400, statusText: 'Bad Request' });

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    httpMock.expectNone(EVENTS_URL);
  });

  it('drains an oversized backlog across chunks, sending the next chunk right after the previous succeeds', () => {
    const { service, httpMock } = setup();
    // ~220 KB attribute string per event: two fit under the 512 KB chunk cap, a third pushes it over.
    const pad = 'x'.repeat(220_000);

    // 'a' is the trigger event, sent alone and immediately — that's unavoidable and not what's
    // under test here. What matters is how the backlog queued behind it gets chunked.
    service.record('app.a', 0, {});
    const first = httpMock.expectOne(EVENTS_URL);
    expect((first.request.body as RequestBody).events).toHaveLength(1);

    // Queued while the first request is still in flight.
    service.record('app.b', 1, { pad });
    service.record('app.c', 2, { pad });
    service.record('app.d', 3, { pad });
    httpMock.expectNone(EVENTS_URL);

    first.flush(ANSWER_STORED_ALL);

    // Draining continues immediately (no waiting for the window) — chunked to stay under the cap.
    const second = httpMock.expectOne(EVENTS_URL);
    expect((second.request.body as RequestBody).events.map((event) => event.data.operation)).toEqual([
      'app.b',
      'app.c',
    ]);
    second.flush(ANSWER_STORED_ALL);

    const third = httpMock.expectOne(EVENTS_URL);
    expect((third.request.body as RequestBody).events.map((event) => event.data.operation)).toEqual(['app.d']);
    third.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it('stops draining on a mid-backlog 5xx and waits the full window before retrying, instead of looping', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();
    const pad = 'x'.repeat(220_000);

    service.record('app.a', 0, {});
    const first = httpMock.expectOne(EVENTS_URL);
    service.record('app.b', 1, { pad });
    service.record('app.c', 2, { pad });
    first.flush(ANSWER_STORED_ALL);

    const second = httpMock.expectOne(EVENTS_URL);
    expect((second.request.body as RequestBody).events.map((event) => event.data.operation)).toEqual([
      'app.b',
      'app.c',
    ]);
    second.flush(null, { status: 500, statusText: 'Server Error' });

    // No immediate re-attempt right after the failure.
    httpMock.expectNone(EVENTS_URL);

    // Still nothing just before the window elapses.
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS - 1000);
    httpMock.expectNone(EVENTS_URL);

    await vi.advanceTimersByTimeAsync(1000);
    const retry = httpMock.expectOne(EVENTS_URL);
    expect((retry.request.body as RequestBody).events.map((event) => event.data.operation)).toEqual(['app.b', 'app.c']);
    retry.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });
});

describe('TelemetryService — error rate limiting', () => {
  afterEach(() => vi.useRealTimers());

  it('suppresses an identical repeated error and reports the suppressed count once the limit passes', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();

    service.logError(new Error('boom'));
    const first = httpMock.expectOne(EVENTS_URL);
    expect((first.request.body as RequestBody).events).toHaveLength(1);
    first.flush(ANSWER_STORED_ALL);

    // Same signature, well within the 10s rate-limit window: suppressed, not sent.
    service.logError(new Error('boom'));
    httpMock.expectNone(EVENTS_URL);

    // Past the rate-limit window: goes through again, carrying the suppressed count.
    await vi.advanceTimersByTimeAsync(11 * 1000);
    service.logError(new Error('boom'));

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    const request = httpMock.expectOne(EVENTS_URL);
    const body = request.request.body as RequestBody;
    expect(body.events[0].data.attributes?.['suppressedRepeats']).toBe(1);
    request.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });
});

describe('TelemetryService — the intake envelope', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('wraps an event as id / stream / at / data, keeping the rest of the event inside data', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    const { service, httpMock } = setup();

    service.record('money.chart_render', 12, { points: 3 });

    const request = httpMock.expectOne(EVENTS_URL);
    const body = request.request.body as RequestBody;
    const [event] = body.events;
    expect(event.id).toMatch(/:1$/);
    expect(event.stream).toBe('money');
    expect(event.at).toBe(1_790_000_000_000);
    expect(event.data.operation).toBe('money.chart_render');
    expect(event.data.attributes).toEqual({ points: 3 });
    expect(event.data).not.toHaveProperty('eventId');
    expect(event.data).not.toHaveProperty('timestampMs');
    expect(body.dropped).toBe(0);
    request.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it.each([
    ['app.route_ready', 'app'],
    ['food.screen_ready', 'food'],
    ['metrics.dashboard_model', 'metrics'],
    ['error.window', 'error'],
    ['log.sync', 'log'],
    ['plain', 'plain'],
    ['Weird Name.x', 'misc'],
    ['', 'misc'],
  ])('puts the operation %j into the stream %j', (operation, stream) => {
    const { service, httpMock } = setup();

    service.record(operation, 1);

    const request = httpMock.expectOne(EVENTS_URL);
    expect((request.request.body as RequestBody).events[0].stream).toBe(stream);
    request.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it('sends events queued before the move, and the lost count, in the new form', () => {
    const queuedBefore = {
      eventId: 'old-session:7',
      timestampMs: 1_700_000_000_000,
      sessionId: 'old-session',
      operation: 'food.screen_ready',
      route: '/food',
      device: {},
    };
    const { service, httpMock } = setup({ events: [queuedBefore], dropped: 5, nextSequence: 8 });

    service.record('app.a', 1);

    const request = httpMock.expectOne(EVENTS_URL);
    const body = request.request.body as RequestBody;
    expect(body.dropped).toBe(5);
    expect(body.events.map((event) => [event.id, event.stream, event.at])).toEqual([
      ['old-session:7', 'food', 1_700_000_000_000],
      [expect.stringMatching(/:8$/), 'app', expect.any(Number)],
    ]);
    request.flush(ANSWER_STORED_ALL);
    httpMock.verify();
  });

  it('warns about events the intake rejected and does not retry them', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service, httpMock } = setup();

    service.record('app.a', 1);
    httpMock
      .expectOne(EVENTS_URL)
      .flush({ received: 1, stored: 0, rejected: [{ index: 0, code: 'bad_data', message: 'data must be an object' }] });

    expect(warn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    httpMock.expectNone(EVENTS_URL);
  });

  it('closes a chunk on a 404 too: a source the backend no longer serves must not keep the queue growing', async () => {
    vi.useFakeTimers();
    const { service, httpMock } = setup();

    service.record('app.a', 1);
    httpMock.expectOne(EVENTS_URL).flush(null, { status: 404, statusText: 'Not Found' });

    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    httpMock.expectNone(EVENTS_URL);
  });

  it('sends the same envelope with sendBeacon when the page is hidden for good', async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    const { service, httpMock } = setup();

    service.record('app.beacon_probe', 1); // sent at once; its answer has not come yet
    window.dispatchEvent(new Event('pagehide'));

    const sent = sendBeacon.mock.calls.filter(([url]) => url === EVENTS_URL);
    expect(sent.length).toBeGreaterThan(0);
    const bodies = await Promise.all(sent.map(([, blob]) => readBlob(blob as Blob)));
    const mine = bodies
      .map((text) => JSON.parse(text) as RequestBody)
      .filter((body) => body.events.some((event) => event.data.operation === 'app.beacon_probe'));
    expect(mine).toHaveLength(1);
    expect(mine[0].events[0]).toMatchObject({ stream: 'app', data: { operation: 'app.beacon_probe' } });

    httpMock.expectOne(EVENTS_URL).flush(ANSWER_STORED_ALL);
    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
