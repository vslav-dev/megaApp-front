import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { OptimisticSyncOperation, SyncEngineService, SyncOperationType } from '@app/services/sync-engine.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { TimeEntry, TimeTrack } from '@app/shared/time-types';
import { createTelemetryFake } from '@app/testing/telemetry.fake';
import { TimeEntriesService } from './time-entries.service';

function entry(id: number, startAt: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id,
    activityKindId: 1,
    track: TimeTrack.Primary,
    startAt,
    endAt: startAt.replace(/T\d\d/, 'T23'),
    options: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function setup(cached: TimeEntry[] | null = null) {
  const storage = new Map<string, unknown>(cached ? [['time_entries', cached]] : []);
  const operations: OptimisticSyncOperation<unknown>[] = [];
  const sessionState$$ = signal<AuthSessionState>(AuthSessionState.Authenticated);

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: LocalStorageService,
        useValue: {
          getUserScoped: (key: string) => storage.get(key) ?? null,
          setUserScoped: (key: string, value: unknown) => storage.set(key, value),
        },
      },
      {
        provide: SyncEngineService,
        useValue: { addOperation: (operation: OptimisticSyncOperation<unknown>) => operations.push(operation) },
      },
      { provide: AuthService, useValue: { sessionState$$ } },
      { provide: TelemetryService, useValue: createTelemetryFake() },
    ],
  });

  return {
    service: TestBed.inject(TimeEntriesService),
    httpMock: TestBed.inject(HttpTestingController),
    operations,
    storage,
    sessionState$$,
  };
}

function lastOperation(operations: OptimisticSyncOperation<unknown>[]): OptimisticSyncOperation<unknown> {
  const operation = operations.at(-1);
  if (!operation) throw new Error('No sync operation was queued');
  return operation;
}

async function flushEntries(httpMock: HttpTestingController, entries: TimeEntry[]): Promise<void> {
  httpMock.expectOne((request) => request.url.startsWith('/api/time/entries')).flush({ success: true, data: entries });
  await Promise.resolve();
}

describe('TimeEntriesService.loadData', () => {
  it('loads every entry when nothing is cached', async () => {
    const { service, httpMock, storage } = setup();
    const serverEntries = [entry(1, '2026-01-05T10:00:00')];

    service.loadData();
    expect(service.isLoaded$$()).toBe(false);

    httpMock.expectOne('/api/time/entries').flush({ success: true, data: serverEntries });
    await Promise.resolve();

    expect(service.entries$$()).toEqual(serverEntries);
    expect(service.isLoaded$$()).toBe(true);
    expect(storage.get('time_entries')).toEqual(serverEntries);
    httpMock.verify();
  });

  it('shows the cache at once and replaces only the recent tail from the server', async () => {
    const old = entry(1, '2020-01-01T10:00:00');
    const recentCached = entry(2, '2099-01-01T10:00:00', { activityKindId: 1 });
    const { service, httpMock } = setup([old, recentCached]);

    service.loadData();
    expect(service.entries$$()).toEqual([old, recentCached]);
    expect(service.isLoaded$$()).toBe(true);

    const request = httpMock.expectOne((req) => req.url.startsWith('/api/time/entries?start='));
    request.flush({ success: true, data: [{ ...recentCached, activityKindId: 7 }] });
    await Promise.resolve();

    expect(service.entries$$()).toEqual([old, { ...recentCached, activityKindId: 7 }]);
    httpMock.verify();
  });
});

describe('TimeEntriesService optimistic writes', () => {
  it('createEntry shows the entry at once and swaps the temp id for the server id', () => {
    const { service, operations } = setup();

    service.createEntry({
      activityKindId: 1,
      track: TimeTrack.Primary,
      startAt: '2026-01-05T10:00:00',
      endAt: '2026-01-05T11:00:00',
      options: [],
    });

    const tempId = service.entries$$()[0]?.id;
    expect(tempId).toBeLessThan(0);
    expect(lastOperation(operations).type).toBe(SyncOperationType.CREATE);

    lastOperation(operations).successCallback?.({ success: true, data: { id: 42 } });
    expect(service.entries$$().map((e) => e.id)).toEqual([42]);
  });

  it('createEntry rollback removes the optimistic entry', () => {
    const { service, operations } = setup();

    service.createEntry({
      activityKindId: 1,
      track: TimeTrack.Primary,
      startAt: '2026-01-05T10:00:00',
      endAt: '2026-01-05T11:00:00',
      options: [],
    });
    lastOperation(operations).rollbackCallback?.({ status: 400, body: null });

    expect(service.entries$$()).toEqual([]);
  });

  it('updateEntryTime rollback restores only the time fields', () => {
    const { service, operations } = setup([entry(1, '2026-01-05T10:00:00')]);
    service.loadData();

    service.updateEntrySelection(1, { activityKindId: 5, options: [] });
    service.updateEntryTime(1, {
      track: TimeTrack.Secondary,
      startAt: '2026-01-05T12:00:00',
      endAt: '2026-01-05T13:00:00',
    });
    expect(lastOperation(operations).type).toBe(SyncOperationType.PATCH);
    expect(lastOperation(operations).endpoint).toBe('/api/time/entries/1/time');

    lastOperation(operations).rollbackCallback?.({ status: 500, body: null });

    const [rolledBack] = service.entries$$();
    expect(rolledBack?.track).toBe(TimeTrack.Primary);
    expect(rolledBack?.startAt).toBe('2026-01-05T10:00:00');
    expect(rolledBack?.activityKindId).toBe(5);
  });
});

describe('TimeEntriesService refresh while writes are queued', () => {
  it('keeps the local version of an entry until all of its queued writes settle', async () => {
    const original = entry(1, '2099-01-01T10:00:00');
    const { service, httpMock, operations } = setup();
    service.loadData();
    await flushEntries(httpMock, [original]);

    service.updateEntrySelection(1, { activityKindId: 5, options: [] });
    const selectionWrite = lastOperation(operations);
    service.updateEntryTime(1, {
      track: TimeTrack.Primary,
      startAt: '2099-01-01T08:00:00',
      endAt: '2099-01-01T09:00:00',
    });

    selectionWrite.successCallback?.(null);
    service.loadData();
    await flushEntries(httpMock, [original]);

    expect(service.entries$$()[0]?.startAt).toBe('2099-01-01T08:00:00');

    lastOperation(operations).successCallback?.(null);
    service.loadData();
    await flushEntries(httpMock, [original]);

    expect(service.entries$$()).toEqual([original]);
    httpMock.verify();
  });

  it('does not bring back a deleted entry or drop an unconfirmed create', async () => {
    const { service, httpMock } = setup();
    service.loadData();
    await flushEntries(httpMock, [entry(1, '2099-01-01T10:00:00')]);

    service.deleteEntry(1);
    service.createEntry({
      activityKindId: 1,
      track: TimeTrack.Primary,
      startAt: '2099-02-01T10:00:00',
      endAt: '2099-02-01T11:00:00',
      options: [],
    });
    service.loadData();
    await flushEntries(httpMock, [entry(1, '2099-01-01T10:00:00')]);

    expect(service.entries$$().map((e) => e.startAt)).toEqual(['2099-02-01T10:00:00']);
    httpMock.verify();
  });
});

describe('TimeEntriesService unconfirmed entries', () => {
  it('sends no write for an entry whose create is not confirmed yet', () => {
    const { service, operations } = setup();
    service.createEntry({
      activityKindId: 1,
      track: TimeTrack.Primary,
      startAt: '2026-01-05T10:00:00',
      endAt: '2026-01-05T11:00:00',
      options: [],
    });
    const tempId = service.entries$$()[0]?.id ?? 0;

    service.updateEntryTime(tempId, {
      track: TimeTrack.Primary,
      startAt: '2026-01-05T12:00:00',
      endAt: '2026-01-05T13:00:00',
    });
    service.updateEntrySelection(tempId, { activityKindId: 2, options: [] });
    service.deleteEntry(tempId);

    expect(operations).toHaveLength(1);
    expect(service.entries$$()).toHaveLength(1);
  });
});

describe('TimeEntriesService session', () => {
  it('clears entries when the session ends', async () => {
    const { service, httpMock, sessionState$$ } = setup();
    service.loadData();
    await flushEntries(httpMock, [entry(1, '2026-01-05T10:00:00')]);

    sessionState$$.set(AuthSessionState.Guest);
    TestBed.tick();

    expect(service.entries$$()).toEqual([]);
    expect(service.isLoaded$$()).toBe(false);
  });
});
