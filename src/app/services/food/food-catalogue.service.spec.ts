import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { LocalStorageService } from '@app/services/local-storage.service';
import { NetworkService } from '@app/services/network.service';
import { NotificationService } from '@app/services/notification.service';
import { SyncEngineService } from '@app/services/sync-engine.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { FOOD_IMAGE_GENERATION_FALLBACK_MS, FOOD_SEARCH_SEND_DEBOUNCE_MS } from '@app/shared/const';
import { CatalogueEntry, SearchScope, WebSocketMessageType } from '@app/shared/types';
import { Subject } from 'rxjs';
import { FoodCatalogueService } from './food-catalogue.service';

const SEARCH_CACHE_KEY = 'food_search_cache';

function entry(id: number, name: string, archived?: boolean): CatalogueEntry {
  return {
    id,
    name,
    legacyName: name,
    kcals: 100,
    protein: 1,
    fat: 1,
    carbs: 1,
    fiber: 1,
    description: name,
    archived,
  };
}

function setup(cachedSearches: Record<string, number[]> | null = null) {
  const wsMessages$ = new Subject<unknown>();
  const connected$ = new Subject<void>();
  const sendMessage = vi.fn();
  const setUserScoped = vi.fn();
  const getUserScoped = vi.fn((key: string) => (key === SEARCH_CACHE_KEY ? cachedSearches : null));

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withXhr()),
      provideHttpClientTesting(),
      { provide: NetworkService, useValue: { wsMessages$, connected$, sendMessage } },
      { provide: SyncEngineService, useValue: { addOperation: vi.fn() } },
      { provide: LocalStorageService, useValue: { getUserScoped, setUserScoped } },
      { provide: AuthService, useValue: { sessionState$$: signal(AuthSessionState.Authenticated) } },
      { provide: TelemetryService, useValue: { record: vi.fn(), recordAfterPaint: vi.fn(() => Promise.resolve()) } },
    ],
  });

  const service = TestBed.inject(FoodCatalogueService);
  service.catalogue$$.set({
    1: entry(1, 'Яблоко'),
    2: entry(2, 'Яблоко пирог'),
    3: entry(3, 'Старое яблоко', true),
  });

  const reply = (payload: { scope?: SearchScope; catalogueIds: number[]; sequenceNumber: number; query?: string }) =>
    wsMessages$.next({
      type: WebSocketMessageType.SEARCH_RESULTS,
      payload: { query: 'яблоко', timestamp: 0, scope: SearchScope.Active, ...payload },
    });
  const searchCacheWrites = () => setUserScoped.mock.calls.filter(([key]) => key === SEARCH_CACHE_KEY);
  const ids = () => service.searchResults$$().map((item) => item.id);
  const waitForSend = () => vi.advanceTimersByTime(FOOD_SEARCH_SEND_DEBOUNCE_MS);

  return { service, wsMessages$, connected$, sendMessage, reply, searchCacheWrites, ids, waitForSend };
}

describe('FoodCatalogueService search scope', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows only regular products in the active scope, dropping archived ids from a reply', () => {
    const { service, sendMessage, reply, ids, waitForSend } = setup();

    service.searchProducts('яблоко');
    waitForSend();
    reply({ catalogueIds: [1, 3, 2], sequenceNumber: 1 });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ query: 'яблоко', scope: SearchScope.Active }));
    expect(ids()).toEqual([1, 2]);
  });

  it('asks the server for the archived scope and shows only archived products', () => {
    const { service, sendMessage, reply, ids, waitForSend } = setup();

    service.toggleArchiveSearch();
    service.searchProducts('яблоко');
    waitForSend();
    reply({ scope: SearchScope.Archived, catalogueIds: [3, 1], sequenceNumber: 1 });

    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'яблоко', scope: SearchScope.Archived }),
    );
    expect(ids()).toEqual([3]);
  });

  it('asks the server for the all scope and shows archived products among the regular ones', () => {
    const { service, sendMessage, reply, ids, waitForSend } = setup();

    service.setSearchScope(SearchScope.All);
    service.searchProducts('яблоко');
    waitForSend();
    reply({ scope: SearchScope.All, catalogueIds: [3, 1, 2], sequenceNumber: 1 });

    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'яблоко', scope: SearchScope.All }));
    expect(ids()).toEqual([3, 1, 2]);
  });

  it.each([SearchScope.Archived, SearchScope.All])(
    'neither reads nor writes the results cache in the %s scope',
    (scope) => {
      const { service, reply, searchCacheWrites, ids, waitForSend } = setup();

      service.searchProducts('яблоко');
      waitForSend();
      reply({ catalogueIds: [1, 2], sequenceNumber: 1 });
      expect(searchCacheWrites()).toHaveLength(1);

      service.setSearchScope(scope);
      service.searchProducts('яблоко');
      waitForSend();
      expect(ids()).toEqual([]); // the cached active ids are not shown under another scope

      reply({ scope, catalogueIds: [3], sequenceNumber: 2 });
      expect(ids()).toEqual([3]);
      expect(searchCacheWrites()).toHaveLength(1);
    },
  );

  it('ignores a reply that was applied in a scope other than the one on screen', () => {
    const { service, reply, ids, waitForSend } = setup();

    service.toggleArchiveSearch();
    service.searchProducts('яблоко');
    waitForSend();
    reply({ scope: SearchScope.Active, catalogueIds: [1, 2], sequenceNumber: 1 }); // the server fell back to active

    expect(ids()).toEqual([]);
  });

  it('keeps caching the active reply that arrives after the user switched to the archived scope', () => {
    const { service, reply, searchCacheWrites, ids, waitForSend } = setup();

    service.searchProducts('яблоко');
    waitForSend();
    service.toggleArchiveSearch();
    service.searchProducts('яблоко');
    waitForSend();
    reply({ scope: SearchScope.Active, catalogueIds: [1, 2], sequenceNumber: 1 });

    expect(searchCacheWrites()).toHaveLength(1);
    expect(ids()).toEqual([]);
  });

  it('excludes archived products from the legacy search in the active scope', () => {
    const { service } = setup();

    service.legacySearchProducts('яблоко');

    expect(service.legacySearchResults$$().map((item) => item.id)).toEqual([1, 2]);
  });

  it('includes archived products in the legacy search in the all scope', () => {
    const { service } = setup();

    service.setSearchScope(SearchScope.All);
    service.legacySearchProducts('яблоко');

    expect(service.legacySearchResults$$().map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('keeps the legacy search and the archived scope mutually exclusive', () => {
    const { service } = setup();

    service.toggleLegacySearch();
    service.toggleArchiveSearch();
    expect(service.isLegacySearch$$()).toBe(false);
    expect(service.searchScope$$()).toBe(SearchScope.Archived);

    service.toggleLegacySearch();
    expect(service.isLegacySearch$$()).toBe(true);
    expect(service.searchScope$$()).toBe(SearchScope.Active);
  });

  it('keeps the all scope when the legacy search is switched on', () => {
    const { service } = setup();

    service.setSearchScope(SearchScope.All);
    service.toggleLegacySearch();

    expect(service.isLegacySearch$$()).toBe(true);
    expect(service.searchScope$$()).toBe(SearchScope.All);
  });

  it('drops a product from the archived results when another client restores it', () => {
    const { service, wsMessages$, reply, ids, waitForSend } = setup();

    service.toggleArchiveSearch();
    service.searchProducts('яблоко');
    waitForSend();
    reply({ scope: SearchScope.Archived, catalogueIds: [3], sequenceNumber: 1 });
    expect(ids()).toEqual([3]);

    wsMessages$.next({ type: WebSocketMessageType.CATALOGUE_ENTRY_SAVED, payload: entry(3, 'Старое яблоко', false) });

    expect(ids()).toEqual([]);
  });

  it('drops a product from the active results when another client archives it', () => {
    const { service, wsMessages$, reply, ids, waitForSend } = setup();

    service.searchProducts('яблоко');
    waitForSend();
    reply({ catalogueIds: [1, 2], sequenceNumber: 1 });

    wsMessages$.next({ type: WebSocketMessageType.CATALOGUE_ENTRY_SAVED, payload: entry(2, 'Яблоко пирог', true) });

    expect(ids()).toEqual([1]);
  });

  it('keeps a product in the all results when another client archives it', () => {
    const { service, wsMessages$, reply, ids, waitForSend } = setup();

    service.setSearchScope(SearchScope.All);
    service.searchProducts('яблоко');
    waitForSend();
    reply({ scope: SearchScope.All, catalogueIds: [1, 2], sequenceNumber: 1 });

    wsMessages$.next({ type: WebSocketMessageType.CATALOGUE_ENTRY_SAVED, payload: entry(2, 'Яблоко пирог', true) });

    expect(ids()).toEqual([1, 2]);
  });

  it('clears the results of another scope when the scope is switched', () => {
    const { service, reply, ids, waitForSend } = setup();

    service.searchProducts('яблоко');
    waitForSend();
    reply({ catalogueIds: [1, 2], sequenceNumber: 1 });
    expect(ids()).toEqual([1, 2]);

    service.setSearchScope(SearchScope.All);

    expect(ids()).toEqual([]);
  });
});

describe('FoodCatalogueService keyboard layout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the retyped Russian query and caches the reply under it', () => {
    const { service, sendMessage, reply, searchCacheWrites, ids, waitForSend } = setup();

    service.searchProducts('Z,kjrj');
    waitForSend();
    reply({ catalogueIds: [1, 2], sequenceNumber: 1, query: 'яблоко' });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ query: 'яблоко' }));
    expect(searchCacheWrites()).toHaveLength(1);
    expect(searchCacheWrites()[0][1]).toEqual({ яблоко: [1, 2] });
    expect(ids()).toEqual([1, 2]);
  });

  it('shows a wrong-layout query from the cache of its Russian text, without waiting for the server', () => {
    const { service, sendMessage, ids } = setup({ яблоко: [1, 2] });

    service.searchProducts('Z,kjrj');

    expect(ids()).toEqual([1, 2]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('runs the legacy search on the retyped Russian query', () => {
    const { service } = setup();

    service.legacySearchProducts('Z,kjrj');

    expect(service.legacySearchResults$$().map((item) => item.id)).toEqual([1, 2]);
  });
});

describe('FoodCatalogueService search send debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends only the final text of a burst of keystrokes, with its sequence number', () => {
    const { service, sendMessage, waitForSend } = setup();

    service.searchProducts('я');
    service.searchProducts('яб');
    service.searchProducts('ябл');
    expect(sendMessage).not.toHaveBeenCalled();

    waitForSend();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ query: 'ябл', sequenceNumber: 3 }));
  });

  it('shows cached results immediately and still asks the server after the pause', () => {
    const { service, sendMessage, ids, waitForSend } = setup({ ябл: [2] });

    service.searchProducts('ябл');
    expect(ids()).toEqual([2]);
    expect(sendMessage).not.toHaveBeenCalled();

    waitForSend();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('replaces the cached results with a different reply to the same query', () => {
    const { service, ids, reply, searchCacheWrites, waitForSend } = setup({ ябл: [2] });

    service.searchProducts('ябл');
    waitForSend();
    expect(ids()).toEqual([2]);

    reply({ catalogueIds: [1, 2], sequenceNumber: 1, query: 'ябл' });

    expect(ids()).toEqual([1, 2]);
    expect(searchCacheWrites()).toHaveLength(1);
  });

  it('drops a reply to an earlier query once a later one is on screen', () => {
    const { service, ids, reply, waitForSend } = setup();

    service.searchProducts('ябл');
    waitForSend();
    service.searchProducts('яблок');
    waitForSend();
    reply({ catalogueIds: [1], sequenceNumber: 2, query: 'яблок' });
    reply({ catalogueIds: [2], sequenceNumber: 1, query: 'ябл' });

    expect(ids()).toEqual([1]);
  });

  it('sends nothing for a query that was cleared before the pause ended', () => {
    const { service, sendMessage, waitForSend } = setup();

    service.searchProducts('яблоко');
    service.clearSearch();
    waitForSend();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing for a query that was emptied before the pause ended', () => {
    const { service, sendMessage, waitForSend } = setup();

    service.searchProducts('яблоко');
    service.searchProducts('');
    waitForSend();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('FoodCatalogueService image regeneration', () => {
  const REGENERATE_URL = '/api/food/catalogue/1/regenerate-image';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupRegeneration() {
    const base = setup();
    const httpMock = TestBed.inject(HttpTestingController);
    const notifications = () => TestBed.inject(NotificationService).notifications$$();
    const generated = (catalogueId: number, imageVersion: number) =>
      base.wsMessages$.next({
        type: WebSocketMessageType.CATALOGUE_IMAGE_GENERATED,
        payload: { catalogueId, imageVersion },
      });
    const failed = (catalogueId: number) =>
      base.wsMessages$.next({ type: WebSocketMessageType.CATALOGUE_IMAGE_FAILED, payload: { catalogueId } });
    const request = async (catalogueId = 1) => {
      const promise = base.service.regenerateProductImage(catalogueId);
      httpMock.expectOne(`/api/food/catalogue/${catalogueId}/regenerate-image`).flush({
        result: true,
        data: { status: 'queued' },
      });
      await promise;
    };

    return { ...base, httpMock, notifications, generated, failed, request };
  }

  it('is generating from the request until a newer image arrives, which also shows the new picture', async () => {
    const { service, request, generated } = setupRegeneration();
    service.catalogue$$.update((catalogue) => ({ ...catalogue, 1: { ...catalogue[1], imageVersion: 2 } }));

    await request();
    expect(service.isImageGenerating(1)).toBe(true);

    generated(1, 3);

    expect(service.isImageGenerating(1)).toBe(false);
    expect(service.getThumbImageUrl(1)).toBe('/api/images/food/1-thumb-v3.webp');
  });

  it('keeps waiting when the arriving image is not newer than the one at the time of the request', async () => {
    const { service, request, generated } = setupRegeneration();
    service.catalogue$$.update((catalogue) => ({ ...catalogue, 1: { ...catalogue[1], imageVersion: 2 } }));

    await request();
    generated(1, 2);

    expect(service.isImageGenerating(1)).toBe(true);
  });

  it('stops and reports a failure of a generation requested here, by the product name', async () => {
    const { service, request, failed, notifications } = setupRegeneration();

    await request();
    failed(1);

    expect(service.isImageGenerating(1)).toBe(false);
    expect(notifications()).toEqual([expect.objectContaining({ type: 'error', message: expect.stringContaining('Яблоко') })]);
  });

  it('stays silent about a failure of a generation requested elsewhere', () => {
    const { service, failed, notifications } = setupRegeneration();

    failed(1);

    expect(service.isImageGenerating(1)).toBe(false);
    expect(notifications()).toEqual([]);
  });

  it('stops being in progress and passes the error on when the request is refused', async () => {
    const { service, httpMock } = setupRegeneration();

    const promise = service.regenerateProductImage(1);
    const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
    httpMock.expectOne(REGENERATE_URL).flush({ result: false }, { status: 429, statusText: 'Too Many Requests' });

    await assertion;
    expect(service.isImageGenerating(1)).toBe(false);
  });

  it('sends no second request while one is in progress', async () => {
    const { service, httpMock, request } = setupRegeneration();

    await request();
    await service.regenerateProductImage(1);

    httpMock.expectNone(REGENERATE_URL);
  });

  it('lets the user try again once the result event is lost for too long', async () => {
    const { service, request } = setupRegeneration();

    await request();
    vi.advanceTimersByTime(FOOD_IMAGE_GENERATION_FALLBACK_MS);

    expect(service.isImageGenerating(1)).toBe(false);
  });

  it('lets the user ask again after the socket reconnects, since the result event may have been lost', async () => {
    const { service, request, connected$ } = setupRegeneration();

    await request();
    connected$.next();

    expect(service.isImageGenerating(1)).toBe(false);
  });

  it('forgets generations in progress when the session is reset', async () => {
    const { service, request } = setupRegeneration();

    await request();
    service.reset();

    expect(service.isImageGenerating(1)).toBe(false);
  });

  it('has no thumbnail URL for a product without an image', () => {
    const { service } = setupRegeneration();

    expect(service.getThumbImageUrl(1)).toBeUndefined();
  });
});
