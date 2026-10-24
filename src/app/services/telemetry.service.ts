import { HttpClient } from '@angular/common/http';
import { afterNextRender, ErrorHandler, Injectable, Injector, inject, untracked } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { DeviceInfoService } from '@app/services/device-info.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { IngestEvent, IngestRequest, IngestResponse, TelemetryEvent } from '@app/shared/types';

type TelemetryAttributes = Record<string, string | number | boolean>;

interface TelemetryQueue {
  events: TelemetryEvent[];
  dropped: number;
  nextSequence: number;
}

interface ConnectionInformationLike {
  effectiveType?: string;
  rtt?: number;
}

const STORAGE_KEY = 'telemetry_queue';
const MAX_QUEUE_BYTES = 1024 * 1024;
const BATCH_WINDOW_MS = 60 * 1000;
const PERSIST_DELAY_MS = 1000;
const ERROR_RATE_LIMIT_WINDOW_MS = 10 * 1000;
// The `telemetry` source of the backend's event intake (backend plan 42).
const EVENTS_ENDPOINT = '/api/ingest/telemetry';
// The intake's own per-request limits (half of the global 1 MiB body limit, so a chunk that fits here is
// never turned into a 413 by the body-size middleware first). Measured on the finished request body.
const MAX_CHUNK_BYTES = 512 * 1024;
const MAX_CHUNK_EVENTS = 1000;
// the JSON around the events: {"events":[],"dropped":<number>}
const REQUEST_OVERHEAD_BYTES = 64;
const FALLBACK_STREAM = 'misc';
const STREAM_PATTERN = /^[a-z0-9._-]{1,64}$/;

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly http = inject(HttpClient);
  private readonly deviceInfoService = inject(DeviceInfoService);
  private readonly localStorageService = inject(LocalStorageService);
  // Lazy, not `inject(Router)`: eager here re-enters this ctor via the initial route's guards (NG0200).
  private readonly injector = inject(Injector);

  private queue: TelemetryQueue = this.readQueue();
  private readonly sessionId = crypto.randomUUID();
  private persistTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private cycleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private nextCycleAllowedAt = 0;
  private sending = false;
  private routeStarts = new Map<number, number>();
  private readonly suppressedErrorCounts = new Map<string, number>();
  private readonly errorSignatureLastSentAt = new Map<string, number>();

  public constructor() {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.flushOnUnload);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);

    // Deferred: enqueue/maybeStartCycle can send synchronously, and AuthInterceptor -> AuthService is not safe to construct this early (NG0200).
    afterNextRender(() => {
      this.router.events.subscribe((event) => this.handleRouterEvent(event));
      this.observeBrowserPerformance();
      if (this.queue.events.length > 0) this.maybeStartCycle();
    });
  }

  private get router(): Router {
    return this.injector.get(Router);
  }

  public measure<T>(operation: string, work: () => T, attributes?: (result: T) => TelemetryAttributes): T {
    const startedAt = performance.now();
    try {
      const result = work();
      untracked(() => this.record(operation, performance.now() - startedAt, attributes?.(result)));
      return result;
    } catch (error) {
      untracked(() => this.record(operation, performance.now() - startedAt, undefined, 'error'));
      throw error;
    }
  }

  public async measureAsync<T>(
    operation: string,
    work: () => Promise<T>,
    attributes?: (result: T) => TelemetryAttributes,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await work();
      untracked(() => this.record(operation, performance.now() - startedAt, attributes?.(result)));
      return result;
    } catch (error) {
      untracked(() => this.record(operation, performance.now() - startedAt, undefined, 'error'));
      throw error;
    }
  }

  public record(
    operation: string,
    elapsedMs: number,
    attributes?: TelemetryAttributes,
    outcome: TelemetryEvent['outcome'] = 'success',
    renderMs?: number,
  ): void {
    this.enqueue({
      eventId: `${this.sessionId}:${this.queue.nextSequence++}`,
      timestampMs: Date.now(),
      sessionId: this.sessionId,
      operation,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      ...(renderMs === undefined ? {} : { renderMs: Math.max(0, Math.round(renderMs)) }),
      route: this.router.url,
      outcome,
      ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
      device: this.deviceContext(),
    });
  }

  public async recordAfterPaint(
    operation: string,
    startedAt: number,
    attributes?: TelemetryAttributes,
    outcome: TelemetryEvent['outcome'] = 'success',
  ): Promise<void> {
    const beforePaint = performance.now();
    await this.nextPaint();
    this.record(operation, performance.now() - startedAt, attributes, outcome, performance.now() - beforePaint);
  }

  /** Manual entry point for places with an existing try/catch that want to attach context. */
  public logError(error: unknown, context?: TelemetryAttributes): void {
    this.recordError('error.manual', error, context);
  }

  /** Reserved structured-log primitive: no call sites yet, kept as a namespace for future use. */
  public log(name: string, message: string, attributes?: TelemetryAttributes): void {
    this.enqueue({
      eventId: `${this.sessionId}:${this.queue.nextSequence++}`,
      timestampMs: Date.now(),
      sessionId: this.sessionId,
      operation: `log.${name}`,
      route: this.router.url,
      message,
      ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
      device: this.deviceContext(),
    });
  }

  /** @internal wired up from ErrorHandler/unhandledrejection below, not called directly by app code. */
  public recordError(operation: string, error: unknown, context?: TelemetryAttributes): void {
    const message = errorMessage(error);
    const stack = errorStack(error);
    const signature = `${message}:${(stack ?? '').split('\n')[0]}`;
    const now = Date.now();
    const lastSentAt = this.errorSignatureLastSentAt.get(signature);
    if (lastSentAt !== undefined && now - lastSentAt < ERROR_RATE_LIMIT_WINDOW_MS) {
      this.suppressedErrorCounts.set(signature, (this.suppressedErrorCounts.get(signature) ?? 0) + 1);
      return;
    }
    this.errorSignatureLastSentAt.set(signature, now);
    const suppressed = this.suppressedErrorCounts.get(signature);
    this.suppressedErrorCounts.delete(signature);

    this.enqueue({
      eventId: `${this.sessionId}:${this.queue.nextSequence++}`,
      timestampMs: now,
      sessionId: this.sessionId,
      operation,
      route: this.router.url,
      outcome: 'error',
      message,
      stack,
      ...((context && Object.keys(context).length > 0) || suppressed
        ? { attributes: { ...context, ...(suppressed ? { suppressedRepeats: suppressed } : {}) } }
        : {}),
      device: this.deviceContext(),
    });
  }

  private enqueue(event: TelemetryEvent): void {
    this.queue.events.push(event);
    this.trimQueue();
    this.schedulePersist();
    this.maybeStartCycle();
  }

  /** Starts a send cycle at most once per BATCH_WINDOW_MS: the first event into an empty queue
   *  fires it immediately (synchronously — no reason to defer a send that's already allowed),
   *  everything else within that window just accumulates. A cycle that is already scheduled or
   *  running is left alone — this only ever arms one timer at a time. */
  private maybeStartCycle(): void {
    if (this.cycleTimeoutId !== null || this.sending) return;
    const delay = Math.max(0, this.nextCycleAllowedAt - Date.now());
    if (delay === 0) {
      this.nextCycleAllowedAt = Date.now() + BATCH_WINDOW_MS;
      this.trySend();
      return;
    }
    this.cycleTimeoutId = setTimeout(() => {
      this.cycleTimeoutId = null;
      this.nextCycleAllowedAt = Date.now() + BATCH_WINDOW_MS;
      this.trySend();
    }, delay);
  }

  /** Sends one chunk of the queue (see buildChunk) rather than the whole thing — a chunk is a
   *  snapshot array, never the live queue.events reference, so events recorded while this request
   *  is in flight can't be mistaken for ones the server already has. */
  private trySend(): void {
    if (this.sending || this.queue.events.length === 0) return;

    const chunk = this.buildChunk();
    const dropped = this.queue.dropped;
    this.sending = true;

    this.http.post<IngestResponse | null>(EVENTS_ENDPOINT, toIngestRequest(chunk, dropped)).subscribe({
      next: (response) => {
        warnAboutRejected(response);
        this.onChunkSettled(chunk, dropped, true);
      },
      error: (error) => this.onChunkSettled(chunk, dropped, isClientErrorStatus(error)),
    });
  }

  /** Takes events off the front of the queue up to the intake's per-request limits, measured on the
   *  request body that will actually be sent. Always includes at least one event, even if it alone
   *  exceeds MAX_CHUNK_BYTES, so a single oversized event (e.g. a huge stack trace) can never stall
   *  the queue forever. */
  private buildChunk(): TelemetryEvent[] {
    const chunk: TelemetryEvent[] = [];
    let bytes = REQUEST_OVERHEAD_BYTES;
    for (const event of this.queue.events) {
      const eventBytes = byteLength(JSON.stringify(toIngestEvent(event))) + 1; // + the comma between events
      if (chunk.length > 0) {
        if (chunk.length >= MAX_CHUNK_EVENTS) break;
        if (bytes + eventBytes > MAX_CHUNK_BYTES) break;
      }
      chunk.push(event);
      bytes += eventBytes;
    }
    return chunk;
  }

  /** A 2xx/4xx response means this chunk is done — either processed by the intake (stored, or rejected
   *  event by event, which a retry would not change) or malformed and not worth retrying — so it's
   *  removed and, if more remains, the next chunk goes out right away: draining
   *  a backlog is not something to throttle. A network failure or 5xx stops the drain entirely;
   *  the next attempt only happens once BATCH_WINDOW_MS has passed since this cycle started,
   *  never immediately, so a persistent server error can't turn into a retry storm. */
  private onChunkSettled(sentEvents: TelemetryEvent[], sentDropped: number, done: boolean): void {
    this.sending = false;
    if (!done) {
      if (this.queue.events.length > 0) this.maybeStartCycle();
      return;
    }

    const sentIds = new Set(sentEvents.map((event) => event.eventId));
    this.queue.events = this.queue.events.filter((event) => !sentIds.has(event.eventId));
    this.queue.dropped = Math.max(0, this.queue.dropped - sentDropped);
    this.flushQueue();
    if (this.queue.events.length > 0) this.trySend();
  }

  private handleRouterEvent(event: unknown): void {
    if (event instanceof NavigationStart) {
      this.routeStarts.set(event.id, performance.now());
      return;
    }
    if (event instanceof NavigationEnd) {
      const startedAt = this.routeStarts.get(event.id);
      this.routeStarts.delete(event.id);
      if (startedAt !== undefined)
        void this.recordAfterPaint('app.route_ready', startedAt, { route: event.urlAfterRedirects });
      return;
    }
    if (event instanceof NavigationCancel || event instanceof NavigationError) {
      this.routeStarts.delete(event.id);
    }
  }

  private observeBrowserPerformance(): void {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation) {
      this.record('app.navigation_timing', navigation.duration, {
        domContentLoadedMs: Math.round((navigation as PerformanceNavigationTiming).domContentLoadedEventEnd),
        loadMs: Math.round((navigation as PerformanceNavigationTiming).loadEventEnd),
      });
    }

    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') {
            this.record('app.long_task', entry.duration, { startMs: Math.round(entry.startTime) });
          }
          if (entry.entryType === 'event' && entry.duration >= 40) {
            this.record('app.interaction_delay', entry.duration, { name: entry.name });
          }
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      observer.observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit & {
        durationThreshold: number;
      });
    } catch {
      // Safari and older browsers expose neither longtask nor event timing.
    }
  }

  private readonly onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    this.recordError('error.unhandled_rejection', event.reason);
  };

  private trimQueue(): void {
    while (this.queue.events.length > 0 && JSON.stringify(this.queue).length > MAX_QUEUE_BYTES) {
      this.queue.events.shift();
      this.queue.dropped += 1;
    }
  }

  private readQueue(): TelemetryQueue {
    const saved = this.localStorageService.getUserScoped<Partial<TelemetryQueue>>(STORAGE_KEY);
    return {
      events: Array.isArray(saved?.events) ? saved.events : [],
      dropped: Number.isFinite(saved?.dropped) ? saved!.dropped! : 0,
      nextSequence: Number.isFinite(saved?.nextSequence) ? saved!.nextSequence! : 1,
    };
  }

  private schedulePersist(): void {
    if (this.persistTimeoutId !== null) return;
    this.persistTimeoutId = setTimeout(() => {
      this.persistTimeoutId = null;
      this.flushQueue();
    }, PERSIST_DELAY_MS);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      if (this.queue.events.length > 0) this.maybeStartCycle();
    } else {
      this.flushQueue();
    }
  };

  /** pagehide: the page is closing, no time left for the batching window — send whatever is
   *  queued via sendBeacon, which survives page teardown unlike a normal fetch/XHR. */
  private readonly flushOnUnload = (): void => {
    this.flushQueue();
    if (this.queue.events.length === 0) return;
    // the beacon can't carry headers (no X-Client-ID) and its answer is never seen: the queue is left as it
    // is, and whatever the intake stored comes again with the same ids on the next regular send
    const request = toIngestRequest(this.buildChunk(), this.queue.dropped);
    navigator.sendBeacon(EVENTS_ENDPOINT, new Blob([JSON.stringify(request)], { type: 'application/json' }));
  };

  private readonly flushQueue = (): void => {
    if (this.persistTimeoutId !== null) {
      clearTimeout(this.persistTimeoutId);
      this.persistTimeoutId = null;
    }
    this.localStorageService.setUserScoped(STORAGE_KEY, this.queue);
  };

  private deviceContext(): TelemetryEvent['device'] {
    const connection = (navigator as Navigator & { connection?: ConnectionInformationLike }).connection;
    return {
      platform: this.deviceInfoService.getDevicePlatform(),
      mobileDevice: this.deviceInfoService.isMobileDevice$$(),
      mobileScreen: this.deviceInfoService.isMobileScreen$$(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      dpr: window.devicePixelRatio,
      touchPoints: navigator.maxTouchPoints,
      ...(navigator.hardwareConcurrency ? { hardwareConcurrency: navigator.hardwareConcurrency } : {}),
      ...((navigator as Navigator & { deviceMemory?: number }).deviceMemory
        ? { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory }
        : {}),
      ...(connection?.effectiveType ? { connectionType: connection.effectiveType } : {}),
      ...(connection?.rtt ? { connectionRtt: connection.rtt } : {}),
      userAgent: navigator.userAgent,
    };
  }

  private nextPaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }
}

@Injectable()
export class TelemetryErrorHandler implements ErrorHandler {
  // Lazy, not `inject(TelemetryService)`: ErrorHandler resolves before the component tree exists.
  private readonly injector = inject(Injector);

  public handleError(error: unknown): void {
    this.injector.get(TelemetryService).recordError('error.angular_handler', error);
    console.error(error);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function isClientErrorStatus(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status !== undefined && status >= 400 && status < 500;
}

/** The stream is the operation's namespace (`app`, `money`, `error`, `log`, ...): the same convention the
 *  operations already follow, and a label the intake can filter by without opening the data. */
function streamOf(operation: string): string {
  const namespace = operation.split('.')[0];
  return STREAM_PATTERN.test(namespace) ? namespace : FALLBACK_STREAM;
}

/** The intake's envelope around a queued event. The queue keeps its own shape; the conversion happens only
 *  here, when a request is built, so events queued before the move to the intake go out in the new form too. */
function toIngestEvent(event: TelemetryEvent): IngestEvent {
  const { eventId, timestampMs, ...data } = event;
  return { id: eventId, stream: streamOf(event.operation), at: timestampMs, data };
}

function toIngestRequest(events: TelemetryEvent[], dropped: number): IngestRequest {
  return { events: events.map(toIngestEvent), dropped };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A rejected event means the event itself breaks the contract — a bug on this side, which retrying cannot fix. */
function warnAboutRejected(response: IngestResponse | null): void {
  if (!response?.rejected?.length) return;
  console.warn(`Telemetry intake rejected ${response.rejected.length} event(s):`, response.rejected);
}
