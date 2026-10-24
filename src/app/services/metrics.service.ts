import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { effect, inject, Service, Signal, signal, untracked, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { IndexedDbCacheService } from '@app/services/indexed-db-cache.service';
import { MetricsBinaryFrameType, NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { METRIC_GRANULARITIES, METRIC_GRANULARITY_SPECS } from '@app/shared/metrics-granularity';
import {
  emptyMetricsCursorMap,
  emptyMetricsHistoryWatermarks,
  latestClosedHistoryBucket,
  metricCursorKey,
  MetricsCursorMap,
  MetricsHistoryWatermarks,
  nextHistorySinceBucket,
  parseMetricsCursorMap,
  splitScopeIntoBatches,
} from '@app/shared/metrics-history-range';
import { MetricRingBuffer, MetricRingBufferSnapshot } from '@app/shared/metrics-ring-buffer';
import { decodeMetricsWireToPoints } from '@app/shared/metrics-wire';
import { MetricGranularity, MetricPoint, MetricsScopeEntry, WebSocketMessageType } from '@app/shared/types';
import { concatMap, from, map, Observable, reduce } from 'rxjs';

const CURSORS_STORAGE_KEY = 'metrics_history_cursors';
const CACHE_WRITE_DELAY_MS = 1_000;
const HISTORY_HEARTBEAT_INTERVAL_MS = 60_000;
const REFRESH_RETRY_DELAY_MS = 60_000;

interface MetricsHistoryRequestBody {
  minuteSince: number;
  hourSince: number;
  daySince: number;
  scope: MetricsScopeEntry[];
}

interface MetricsHistoryRequest {
  since: MetricsHistoryWatermarks;
  targets: MetricsHistoryWatermarks;
  scope: MetricsScopeEntry[];
}

// One persisted IndexedDB record per series — see
// plans/35-metrics-dashboard-viewport-rendering.implementation-plan.md §2.4.
interface MetricSeriesRecord {
  service: string;
  name: string;
  granularity: MetricGranularity;
  snapshot: MetricRingBufferSnapshot;
}

interface SeriesBuffer {
  service: string;
  name: string;
  granularity: MetricGranularity;
  buffer: MetricRingBuffer;
  pointsSignal: WritableSignal<MetricPoint[]>;
  readonlyPointsSignal: Signal<MetricPoint[]>;
}

@Service()
export class MetricsService {
  public readonly isRefreshing$$ = signal(false);

  // Every service name any series has ever been buffered under — the runtime-discovered
  // half of "which services exist" (the other half is the static catalog). Updates only
  // when a genuinely new service's first point arrives, not on every tick. Replaces the
  // old points$$()-scanning fallback in metrics-dashboard.ts's serviceOptions$$.
  public readonly knownServices$$ = signal<ReadonlySet<string>>(new Set());

  // null = no view with charts open right now (e.g. Settings, or nothing has
  // mounted yet). Replaced wholesale on every view change, never merged — see
  // plans/32-metrics-mobile-custom-only-mode.implementation-plan.md §4.5.
  private readonly currentScope$$ = signal<MetricsScopeEntry[] | null>(null);

  private readonly networkService = inject(NetworkService);
  private readonly notificationService = inject(NotificationService);
  private readonly http = inject(HttpClient);
  private readonly indexedDbCache = inject(IndexedDbCacheService);
  private readonly telemetry = inject(TelemetryService);
  private readonly authService = inject(AuthService);

  // One fixed-capacity ring buffer + one reactive points signal per (granularity,
  // service, name) series — each series is its own independent signal, so a merge
  // touching a handful of series only invalidates computeds that actually read those
  // series, not every card on the page. Replaces the old single points$$ signal,
  // which was rebuilt and fully re-sorted from every buffer on every merge. See
  // plans/35-metrics-dashboard-viewport-rendering.implementation-plan.md §2.3.
  private readonly buffers = new Map<string, SeriesBuffer>();
  private readonly knownServicesInternal = new Set<string>();

  // Series touched since the last debounced IndexedDB write — accumulated across
  // however many merges land inside one CACHE_WRITE_DELAY_MS window, drained (and
  // only those series re-persisted) when the write actually fires.
  private readonly pendingPersistKeys = new Set<string>();

  private isCacheLoaded = false;
  private latestRealtimeMinuteBucket = 0;
  private historyCheckedThrough = emptyMetricsCursorMap();
  private retryAfterMs = 0;
  private hasNotifiedHistoryError = false;
  private hasPendingHistoryRefresh = false;
  private cacheWriteTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private historyHeartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private pendingRefreshNotificationId: string | null = null;

  // Single reactive source of truth for both the WS subscription and the REST
  // history heartbeat — reacts to connection state and scope together, so
  // first load, reconnect and view switches all go through this one path
  // instead of separate imperative call sites. See §4.5 and the "Рефакторинг
  // после ревью" section of the plan referenced above for the full scenario
  // table and the reasoning behind folding the heartbeat in here too.
  //
  // The REST heartbeat's only real precondition is "is there a scope to fetch" —
  // /api/metrics/history is a plain authenticated HTTP endpoint, unrelated to the
  // WS transport. Gating it on isConnected too meant metrics silently went stale
  // for as long as the socket stayed disconnected (reconnect backoff, a hidden
  // tab whose WS never got a chance to open, a brief network hiccup) with no
  // catch-up path until the socket happened to reconnect. sendMessage() already
  // no-ops safely while disconnected, so the WS subscribe/unsubscribe call below
  // stays unconditional too — isConnected is only read to make this effect
  // re-fire (and resend the declarative subscription) on reconnect.
  private readonly subscriptionEffect = effect(() => {
    this.networkService.isConnected$$();
    const scope = this.currentScope$$();
    untracked(() => {
      if (scope) {
        this.networkService.sendMessage({ type: WebSocketMessageType.METRICS_SUBSCRIBE, payload: { scope } });
      } else {
        this.networkService.sendMessage({ type: WebSocketMessageType.METRICS_UNSUBSCRIBE });
      }
      this.syncHistoryHeartbeat(scope !== null);
    });
  });

  // Mirrors food-diary.service.ts's resetOnAuthLossEffect$$ — series data is as
  // personal as the food diary, and the dedicated metricSeries IndexedDB store
  // carries no per-user key suffix (unlike the old metrics_detail blob), so it
  // must be wiped explicitly on logout rather than relying on key-scoping.
  private readonly resetOnAuthLossEffect = effect(() => {
    if (this.authService.sessionState$$() !== AuthSessionState.Guest) return;
    this.resetAllState();
  });

  constructor() {
    const cacheStartedAt = performance.now();
    void Promise.all([
      this.indexedDbCache.get<MetricsCursorMap>(CURSORS_STORAGE_KEY),
      this.indexedDbCache.getAllMetricSeries<MetricSeriesRecord>(),
    ]).then(([cursors, records]) => {
      if (cursors) {
        this.historyCheckedThrough = parseMetricsCursorMap(cursors);
      }
      for (const record of records) {
        this.hydrateSeries(record);
      }
      this.isCacheLoaded = true;
      this.syncHistoryHeartbeat(this.currentScope$$() !== null);
      this.telemetry.record('metrics.cache_hydrate', performance.now() - cacheStartedAt, {
        cache: records.length > 0 ? 'hit' : 'miss',
        points: this.totalBufferedPointCount(),
      });
    });

    this.networkService.metricsBinaryFrames$.subscribe((frame) => {
      if (frame.frameType === MetricsBinaryFrameType.Update) {
        const points = decodeMetricsWireToPoints(frame.payload);
        this.telemetry.measure(
          'metrics.realtime_batch',
          () => this.mergePoints(points, true),
          () => ({
            inputPoints: points.length,
            retainedPoints: this.totalBufferedPointCount(),
          }),
        );
        return;
      }
      if (frame.frameType === MetricsBinaryFrameType.Latest) {
        for (const point of decodeMetricsWireToPoints(frame.payload)) {
          this.latestRealtimeMinuteBucket = Math.max(this.latestRealtimeMinuteBucket, point.bucket);
        }
      }
    });
  }

  // The reactive series for one (service, metricName, granularity) — created lazily on
  // first access from either side (a consumer asking before any data exists yet, or a
  // point actually arriving first), so identity is always shared: whichever call happens
  // first "wins" the entry, and every later caller — consumer or insertPoint — gets that
  // same signal. Read-only: callers subscribe, only MetricsService itself ever writes.
  public seriesFor(service: string, name: string, granularity: MetricGranularity): Signal<MetricPoint[]> {
    return this.entryFor(service, name, granularity).readonlyPointsSignal;
  }

  // Called whenever the open view's set of visible metrics changes (view
  // switch, dashboard selection edit, first mount). Empty scope means "no
  // charts on screen" and is normalized to null (unsubscribed), same as never
  // having set one.
  public setScope(scope: MetricsScopeEntry[]): void {
    this.currentScope$$.set(scope.length > 0 ? scope : null);
  }

  // Leaving the /metrics route entirely — distinct from switching views while
  // still on it, which goes through setScope() instead. Stops the heartbeat
  // immediately rather than waiting for the effect's async reaction to the
  // scope write below — same defensive-immediacy reasoning as before.
  public unsubscribe(): void {
    this.currentScope$$.set(null);
    this.syncHistoryHeartbeat(false);
  }

  public forceRefresh(): void {
    this.refreshHistory(true);
  }

  public clearCache(): void {
    this.resetAllState();
  }

  // Resets every existing entry in place rather than buffers.clear() — a card already
  // rendered on screen holds a computed() whose only dependency is that entry's
  // pointsSignal instance (see regularCardLive/compositeCardLive in
  // metrics-dashboard.ts). Discarding the Map entry would silently orphan that
  // computed: entryFor() would hand out a brand-new signal to future callers, but the
  // already-subscribed computed keeps pointing at the old, now-dead one and is never
  // marked stale again, so the chart would keep showing pre-clear data forever (until
  // the component itself is destroyed and recreated). Writing an empty snapshot through
  // the SAME signal instance notifies that computed correctly.
  private resetAllState(): void {
    for (const entry of this.buffers.values()) {
      entry.buffer = this.createBuffer(entry.granularity);
      entry.pointsSignal.set([]);
    }
    this.knownServicesInternal.clear();
    this.knownServices$$.set(new Set());
    this.pendingPersistKeys.clear();
    this.historyCheckedThrough = emptyMetricsCursorMap();
    if (this.cacheWriteTimeoutId !== null) {
      clearTimeout(this.cacheWriteTimeoutId);
      this.cacheWriteTimeoutId = null;
    }
    void Promise.all([this.indexedDbCache.remove(CURSORS_STORAGE_KEY), this.indexedDbCache.clearMetricSeries()]);
  }

  private refreshHistory(showNotification = false): void {
    if (this.isRefreshing$$()) {
      // A view/service switch (or another automatic trigger) landed while a
      // request for the previous scope was still in flight — don't drop it,
      // note it and re-check once that request settles (consumePendingHistoryRefresh),
      // instead of leaving the new scope stale until the next heartbeat tick.
      if (!showNotification) this.hasPendingHistoryRefresh = true;
      return;
    }
    // Automatic path only — a manual click should never be blocked by a
    // backoff set from an earlier automatic failure.
    if (!showNotification && Date.now() < this.retryAfterMs) return;

    const scope = this.currentScope$$();
    if (!scope) return;

    // One request per batch of metrics, each floored by its own neediest metric — a request's
    // cost on the server is bounded by the batch, not by the scope (see splitScopeIntoBatches).
    // Cursors advance batch by batch, so a failure part-way keeps everything already fetched
    // and the next attempt resumes at the batch that failed.
    const requests = splitScopeIntoBatches(scope)
      .map((batch) => this.buildHistoryRequest(batch, showNotification))
      .filter((request): request is MetricsHistoryRequest => request !== null);
    if (requests.length === 0) return;

    this.isRefreshing$$.set(true);
    if (showNotification) {
      this.retryAfterMs = 0;
      // Shown immediately, not after the usual pending-feedback delay (see SyncEngineService) —
      // that delay exists to skip the flash for requests that usually resolve fast, but a manual
      // history refresh is known to be slow, so the spinner should show right away.
      this.pendingRefreshNotificationId = this.notificationService.addNotification('warning', 'Refreshing metrics…', {
        persistent: true,
      });
    }

    const startedAt = performance.now();
    const refresh$ = from(requests).pipe(
      concatMap((request) => this.fetchHistoryBatch(request)),
      reduce((total, batchPoints) => total + batchPoints, 0),
    );
    refresh$.subscribe({
      next: (pointCount) => {
        this.retryAfterMs = 0;
        this.hasNotifiedHistoryError = false;
        this.isRefreshing$$.set(false);
        void this.telemetry.recordAfterPaint('metrics.history_refresh', startedAt, {
          trigger: showNotification ? 'manual' : 'automatic',
          points: pointCount,
          batches: requests.length,
          retainedPoints: this.totalBufferedPointCount(),
        });
        if (showNotification) {
          this.resolvePendingRefreshNotification();
          this.notificationService.addNotification('success', 'Metrics refreshed');
        }
        this.consumePendingHistoryRefresh();
      },
      error: (error: HttpErrorResponse) => {
        this.retryAfterMs = Date.now() + REFRESH_RETRY_DELAY_MS;
        this.isRefreshing$$.set(false);
        if (showNotification) {
          this.resolvePendingRefreshNotification();
          this.notificationService.addNotification('error', 'Failed to refresh metrics');
        } else if (error.status >= 400 && error.status < 500 && !this.hasNotifiedHistoryError) {
          // A 4xx is a client/config problem, not a transient blip — worth telling the
          // user about once per failure streak, unlike a 5xx/network error which keeps
          // retrying silently on the next heartbeat tick (see plan §"Рефакторинг после
          // ревью", находка 3).
          this.hasNotifiedHistoryError = true;
          this.notificationService.addNotification('error', 'Failed to refresh metrics');
        }
        this.telemetry.record(
          'metrics.history_refresh',
          performance.now() - startedAt,
          {
            trigger: showNotification ? 'manual' : 'automatic',
          },
          'error',
        );
        this.consumePendingHistoryRefresh();
      },
    });
  }

  // Resolves with the number of points the batch carried. Merging and cursor advance happen
  // here, per batch, so progress survives a later batch failing.
  private fetchHistoryBatch(request: MetricsHistoryRequest): Observable<number> {
    const body: MetricsHistoryRequestBody = {
      minuteSince: request.since.minute,
      hourSince: request.since.hour,
      daySince: request.since.day,
      scope: request.scope,
    };
    return this.http.post('/api/metrics/history', body, { responseType: 'arraybuffer' }).pipe(
      map((response) => {
        const points = decodeMetricsWireToPoints(response);
        this.mergePoints(points, false, false);
        // Advance every metric the request named, not only ones that appeared in the
        // response — Flatline's response is authoritative for the whole requested
        // range, so a metric absent from it genuinely had no points there, not "we
        // didn't check". See §4.3 of the plan referenced above (safety condition).
        for (const entry of request.scope) {
          for (const name of entry.metricNames) {
            const key = metricCursorKey(entry.service, name);
            const cursor = this.historyCheckedThrough[key] ?? emptyMetricsHistoryWatermarks();
            const next = { ...cursor };
            for (const granularity of METRIC_GRANULARITIES) {
              next[granularity] = Math.max(next[granularity], request.targets[granularity]);
            }
            this.historyCheckedThrough[key] = next;
          }
        }
        this.scheduleCacheWrite();
        return points.length;
      }),
    );
  }

  // A refresh requested while the previous one was still in flight
  // (refreshHistory's isRefreshing$$ guard) gets exactly one follow-up
  // attempt right after that one settles — it will read whatever scope is
  // current at that point, so a rapid A→B→C switch still ends up fetching
  // for C, not stuck showing B's data until the next heartbeat tick.
  private consumePendingHistoryRefresh(): void {
    if (!this.hasPendingHistoryRefresh) return;
    this.hasPendingHistoryRefresh = false;
    this.refreshHistory();
  }

  private mergePoints(newPoints: MetricPoint[] | null, isRealtime: boolean, shouldSave = true): void {
    if (!newPoints || newPoints.length === 0) return;

    const touchedKeys = new Set<string>();
    for (const point of newPoints) {
      this.insertPoint(point, isRealtime, touchedKeys);
    }
    this.publishTouchedSeries(touchedKeys, shouldSave);
  }

  private insertPoint(point: MetricPoint, isRealtime: boolean, touchedKeys: Set<string>): void {
    if (
      !point?.service ||
      !point.name ||
      !this.isValidGranularity(point.granularity) ||
      !Number.isFinite(point.bucket) ||
      !Number.isFinite(point.value)
    ) {
      return;
    }

    const entry = this.entryFor(point.service, point.name, point.granularity);
    entry.buffer.insert(point.bucket, point.value);
    touchedKeys.add(this.seriesKey(point.service, point.name, point.granularity));
    // Real data, not a speculative read — safe to register here (insertPoint is never
    // called from inside a computed). entryFor() itself must stay side-effect-free: it's
    // also called from seriesFor(), which UI code calls from inside computed()s to read a
    // series that may have no data yet — writing a signal there throws NG0600.
    this.registerKnownService(point.service);

    if (point.granularity === 'minute' && isRealtime) {
      this.latestRealtimeMinuteBucket = Math.max(this.latestRealtimeMinuteBucket, point.bucket);
    }
  }

  private entryFor(service: string, name: string, granularity: MetricGranularity): SeriesBuffer {
    const key = this.seriesKey(service, name, granularity);
    let entry = this.buffers.get(key);
    if (!entry) {
      const buffer = this.createBuffer(granularity);
      const pointsSignal = signal<MetricPoint[]>([]);
      entry = { service, name, granularity, buffer, pointsSignal, readonlyPointsSignal: pointsSignal.asReadonly() };
      this.buffers.set(key, entry);
    }
    return entry;
  }

  private createBuffer(granularity: MetricGranularity): MetricRingBuffer {
    const { periods, stepSeconds } = METRIC_GRANULARITY_SPECS[granularity];
    return new MetricRingBuffer(periods, stepSeconds);
  }

  // Reuses entryFor() rather than building its own SeriesBuffer — hydration runs async
  // (after the constructor's IndexedDB reads resolve), so a card's computed may have
  // already called seriesFor() for this exact key before this runs, subscribing to
  // whatever (empty) pointsSignal entryFor() handed out at that point. Swapping in a
  // brand-new SeriesBuffer here — as an earlier version of this method did — would
  // orphan that signal: already-subscribed computeds keep pointing at the old, now-
  // dead one and never see the hydrated data. Updating the existing entry's buffer and
  // writing through its existing pointsSignal keeps that identity intact instead.
  private hydrateSeries(record: MetricSeriesRecord): void {
    if (!this.isValidGranularity(record.granularity)) return;
    const { periods, stepSeconds } = METRIC_GRANULARITY_SPECS[record.granularity];
    const buffer = MetricRingBuffer.fromSnapshot(periods, stepSeconds, record.snapshot);
    if (!buffer) return;

    const entry = this.entryFor(record.service, record.name, record.granularity);
    entry.buffer = buffer;
    this.registerKnownService(record.service);
    entry.pointsSignal.set(this.pointsFor(entry));
  }

  private registerKnownService(service: string): void {
    if (this.knownServicesInternal.has(service)) return;
    this.knownServicesInternal.add(service);
    this.knownServices$$.set(new Set(this.knownServicesInternal));
  }

  private publishTouchedSeries(touchedKeys: ReadonlySet<string>, shouldSave: boolean): void {
    if (touchedKeys.size === 0) return;
    for (const key of touchedKeys) {
      const entry = this.buffers.get(key);
      if (!entry) continue;
      entry.pointsSignal.set(this.pointsFor(entry));
      this.pendingPersistKeys.add(key);
    }
    if (shouldSave) {
      this.scheduleCacheWrite();
    }
  }

  private pointsFor(entry: SeriesBuffer): MetricPoint[] {
    return entry.buffer.toSortedPoints().map(({ bucket, value }) => ({
      service: entry.service,
      name: entry.name,
      granularity: entry.granularity,
      bucket,
      value,
    }));
  }

  // One heartbeat, one owner (subscriptionEffect) — replaces the old
  // self-rescheduling setTimeout chain, which quietly died the moment a tick
  // found nothing to do or hit an error, with no way back short of a scope
  // change or reconnect. A plain interval can't die like that: every tick
  // calls refreshHistory(), which is already a safe no-op when there's
  // nothing to fetch, a refresh is in flight, or the retry backoff hasn't
  // elapsed yet.
  //
  // Two separate concerns live here, deliberately not merged into one guard:
  // "is the interval running" (idempotent — created once, torn down once) and
  // "check now" (must happen every single time this is called with
  // active=true, since every call means something just changed — first mount,
  // WS (re)connect, or a view/service switch — and each of those deserves its
  // own immediate check rather than waiting up to HISTORY_HEARTBEAT_INTERVAL_MS
  // for the next tick). refreshHistory() itself is what makes calling it
  // "for free" safe to do this often — see needsRefresh in buildHistoryRequest.
  // active = "there's a scope to fetch", deliberately independent of WS
  // connection state (see subscriptionEffect) — the REST heartbeat must keep
  // running on its own even while the socket is reconnecting or never opened.
  private syncHistoryHeartbeat(active: boolean): void {
    const shouldRun = active && this.isCacheLoaded;
    if (!shouldRun) {
      if (this.historyHeartbeatIntervalId !== null) {
        clearInterval(this.historyHeartbeatIntervalId);
        this.historyHeartbeatIntervalId = null;
      }
      return;
    }
    this.refreshHistory();
    if (this.historyHeartbeatIntervalId === null) {
      this.historyHeartbeatIntervalId = setInterval(() => this.refreshHistory(), HISTORY_HEARTBEAT_INTERVAL_MS);
    }
  }

  // One request per call, floored per granularity by the neediest metric in
  // scope — not one request per metric. A metric already caught up just gets
  // some already-known points back (harmless, deduped by key in insertPoint),
  // never under-fetches. See §4.2-4.3 of the plan referenced above.
  private buildHistoryRequest(scope: MetricsScopeEntry[], force: boolean): MetricsHistoryRequest | null {
    const latestMinuteBucket =
      this.latestRealtimeMinuteBucket > 0 ? this.latestRealtimeMinuteBucket : Math.floor(Date.now() / 60_000) * 60 - 60;

    const since = emptyMetricsHistoryWatermarks();
    const targets = emptyMetricsHistoryWatermarks();
    for (const granularity of METRIC_GRANULARITIES) {
      const target = latestClosedHistoryBucket(granularity, latestMinuteBucket);
      targets[granularity] = target;
      // Sentinel > target: narrowed below by any metric that still needs catching up;
      // if none do, this granularity contributes nothing and stays "not needed".
      since[granularity] = target + 1;
    }

    for (const entry of scope) {
      for (const name of entry.metricNames) {
        const cursor = force ? undefined : this.historyCheckedThrough[metricCursorKey(entry.service, name)];
        for (const granularity of METRIC_GRANULARITIES) {
          const requiredSince = nextHistorySinceBucket(granularity, cursor?.[granularity] ?? 0, targets[granularity]);
          since[granularity] = Math.min(since[granularity], requiredSince);
        }
      }
    }

    const needsRefresh = METRIC_GRANULARITIES.some((granularity) => since[granularity] <= targets[granularity]);
    if (!needsRefresh) return null;
    return { since, targets, scope };
  }

  // Writes only the series touched since the last write (pendingPersistKeys), plus the
  // (small, always-whole) history cursor map — not a single combined blob of everything
  // ever buffered. Each series goes into its own IndexedDB record (metricSeries store),
  // the same bucket-addressed shape the live ring buffer already holds, via structured
  // clone — no JSON.stringify involved. See plan §2.4.
  private scheduleCacheWrite(): void {
    if (this.cacheWriteTimeoutId !== null) return;
    this.cacheWriteTimeoutId = setTimeout(() => {
      this.cacheWriteTimeoutId = null;
      const startedAt = performance.now();
      const keysToWrite = Array.from(this.pendingPersistKeys);
      this.pendingPersistKeys.clear();

      const seriesWrites = keysToWrite.map((key) => {
        const entry = this.buffers.get(key);
        if (!entry) return Promise.resolve();
        const record: MetricSeriesRecord = {
          service: entry.service,
          name: entry.name,
          granularity: entry.granularity,
          snapshot: entry.buffer.snapshot(),
        };
        return this.indexedDbCache.setMetricSeries(key, record);
      });
      const cursorWrite = this.indexedDbCache.set<MetricsCursorMap>(CURSORS_STORAGE_KEY, {
        ...this.historyCheckedThrough,
      });

      void Promise.all([...seriesWrites, cursorWrite]).then(() =>
        this.telemetry.record('metrics.cache_persist', performance.now() - startedAt, {
          seriesWritten: keysToWrite.length,
          points: this.totalBufferedPointCount(),
        }),
      );
    }, CACHE_WRITE_DELAY_MS);
  }

  private resolvePendingRefreshNotification(): void {
    if (this.pendingRefreshNotificationId === null) return;
    this.notificationService.removeNotification(this.pendingRefreshNotificationId);
    this.pendingRefreshNotificationId = null;
  }

  private isValidGranularity(value: unknown): value is MetricGranularity {
    return value === 'minute' || value === 'hour' || value === 'day';
  }

  private seriesKey(service: string, name: string, granularity: MetricGranularity): string {
    return `${granularity}:${service}:${name}`;
  }

  public totalBufferedPointCount(): number {
    let count = 0;
    for (const { buffer } of this.buffers.values()) {
      count += buffer.size();
    }
    return count;
  }
}
