import { effect, inject, Service, signal, WritableSignal } from '@angular/core';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { NotificationService } from '@app/services/notification.service';
import { FOOD_IMAGE_GENERATION_FALLBACK_MS, FOOD_SEARCH_SEND_DEBOUNCE_MS } from '@app/shared/const';
import { exhaustRequest } from '@app/shared/decorators/exhaust-request.decorator';
import { fixKeyboardLayout } from '@app/shared/keyboard-layout';
import {
  Catalogue,
  CatalogueEntry,
  CatalogueEntryDeletedWsMessage,
  CatalogueEntrySavedWsMessage,
  CatalogueImageFailedWsMessage,
  CatalogueImageGeneratedWsMessage,
  CatalogueListResponse,
  ProductPreviewData,
  ProductSaveRequest,
  SearchQueryWsMessage,
  SearchResultsWsMessage,
  SearchScope,
  ServerResponseBasic,
  ServerResponseProductPreview,
  ServerResponseProductSave,
  ServerResponseWithData,
  WebSocketMessageType,
} from '@app/shared/types';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SyncOperationError, SyncOperationMode, SyncOperationType } from '../sync-engine.service';
import { TelemetryService } from '../telemetry.service';
import { BaseFoodService } from './food-base.service';

@Service()
export class FoodCatalogueService extends BaseFoodService {
  private readonly CATALOGUE_STORAGE_KEY = 'food_catalogue';
  private readonly CATALOGUE_VERSION_STORAGE_KEY = 'food_catalogue_version';
  private readonly SEARCH_CACHE_KEY = 'food_search_cache';

  public readonly catalogue$$: WritableSignal<Catalogue> = signal({});
  // Bumped by the server on every applied create/update/delete — the cheap "did the shared
  // catalogue change" signal the reconnect coordinator checks instead of re-downloading it.
  public readonly catalogueVersion$$: WritableSignal<number> = signal(0);

  private readonly searchQuery$$: WritableSignal<string> = signal('');
  public readonly searchResults$$: WritableSignal<CatalogueEntry[]> = signal([]);

  public readonly isLegacySearch$$: WritableSignal<boolean> = signal(false);
  public readonly legacySearchResults$$: WritableSignal<CatalogueEntry[]> = signal([]);

  // The part of the catalogue the search covers. The add-food modal sets it when its session opens; an admin
  // switches it between Active and Archived. Changed only through setSearchScope, which keeps results of one
  // scope from showing under another.
  private readonly scope$$: WritableSignal<SearchScope> = signal(SearchScope.Active);
  public readonly searchScope$$ = this.scope$$.asReadonly();

  // Products whose image generation this client asked for and has no result for yet: id → the image version at
  // the time of the request (0 for none). Cleared by the result event, or by the fallback timer if it is lost.
  private readonly imageGenerating$$: WritableSignal<Record<number, number>> = signal({});
  private readonly imageGenerationTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private searchCache: Record<string, number[]> = {};
  private searchSequenceNumber: number = 0;
  private lastDisplayedSequenceNumber: number = 0;
  private searchStartedAt: number | null = null;
  private searchSendTimer: ReturnType<typeof setTimeout> | null = null;

  protected getStorageKey(): string {
    return this.CATALOGUE_STORAGE_KEY;
  }

  private readonly authService = inject(AuthService);
  private readonly telemetry = inject(TelemetryService);
  private readonly notificationService = inject(NotificationService);

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  constructor() {
    super();
    this.loadCatalogueFromLocalStorage();
    this.loadSearchCacheFromLocalStorage();
    this.setupSearchWebSocketListener();
    this.networkService.connected$.subscribe(() => {
      this.replaySearchQuery();
      // A result event may have been lost while the socket was down (or the server restarted and dropped its
      // in-memory queue): let the user ask again instead of waiting out the fallback timer. If the server is
      // still generating, the repeated request is answered "already queued" and the state comes back.
      this.resetImageGenerating();
    });
  }

  public reset(): void {
    this.catalogue$$.set({});
    this.catalogueVersion$$.set(0);
    this.searchQuery$$.set('');
    this.searchResults$$.set([]);
    this.isLegacySearch$$.set(false);
    this.legacySearchResults$$.set([]);
    this.scope$$.set(SearchScope.Active);
    this.searchCache = {};
    this.searchSequenceNumber = 0;
    this.lastDisplayedSequenceNumber = 0;
    this.searchStartedAt = null;
    this.cancelScheduledSearchQuery();
    this.resetImageGenerating();
  }

  private resetImageGenerating(): void {
    this.imageGenerationTimers.forEach((timer) => clearTimeout(timer));
    this.imageGenerationTimers.clear();
    this.imageGenerating$$.set({});
  }

  @exhaustRequest()
  public async getCatalogueEntries(): Promise<Catalogue> {
    const startedAt = performance.now();
    try {
      const response = await firstValueFrom(this.http.get<CatalogueListResponse>('/api/food/catalogue'));

      this.catalogue$$.set(response.entries);
      this.catalogueVersion$$.set(response.version);
      this.saveToLocalStorage(response.entries);
      this.saveCatalogueVersionToLocalStorage(response.version);
      void this.telemetry.recordAfterPaint('food.catalogue_load', startedAt, {
        source: 'server',
        entries: Object.keys(response.entries).length,
      });
      return response.entries;
    } catch (error) {
      console.error('Failed getting catalogue entries:', error);
      void this.telemetry.recordAfterPaint('food.catalogue_load', startedAt, { source: 'server' }, 'error');
      return {};
    }
  }

  private loadCatalogueFromLocalStorage(): void {
    const startedAt = performance.now();
    const savedCatalogue = this.loadFromLocalStorage<Catalogue>();
    if (savedCatalogue) {
      this.catalogue$$.set(savedCatalogue);
    }
    const savedVersion = this.localStorageService.getUserScoped<number>(this.CATALOGUE_VERSION_STORAGE_KEY);
    if (typeof savedVersion === 'number') {
      this.catalogueVersion$$.set(savedVersion);
    }
    this.telemetry.record('food.catalogue_load', performance.now() - startedAt, {
      source: 'cache',
      entries: savedCatalogue ? Object.keys(savedCatalogue).length : 0,
      hit: Boolean(savedCatalogue),
    });
  }

  private saveCatalogueVersionToLocalStorage(version: number): void {
    this.localStorageService.setUserScoped(this.CATALOGUE_VERSION_STORAGE_KEY, version);
  }

  // The legacy (local) search and the admin's archived scope (server) exclude each other.
  public toggleLegacySearch(): void {
    if (this.scope$$() === SearchScope.Archived) {
      this.setSearchScope(SearchScope.Active);
    }
    this.isLegacySearch$$.update((isLegacy) => !isLegacy);
  }

  public toggleArchiveSearch(): void {
    this.isLegacySearch$$.set(false);
    this.setSearchScope(this.scope$$() === SearchScope.Archived ? SearchScope.Active : SearchScope.Archived);
  }

  public setSearchScope(scope: SearchScope): void {
    if (this.scope$$() === scope) return;
    this.scope$$.set(scope);
    this.searchResults$$.set([]);
  }

  // The query is retyped to the Russian layout here, once, so the local cache, the server, its caches and the
  // embeddings only ever see the Russian text. The input field keeps showing what the user typed.
  public searchProducts(typedQuery: string): void {
    const query = fixKeyboardLayout(typedQuery);
    this.searchQuery$$.set(query);

    if (!query.trim()) {
      this.cancelScheduledSearchQuery();
      this.searchResults$$.set([]);
      this.searchSequenceNumber = 0;
      this.lastDisplayedSequenceNumber = 0;
      return;
    }

    this.searchSequenceNumber++;
    this.searchStartedAt = performance.now();

    const cachedIds = this.isScopeCached(this.scope$$()) ? this.getSearchCachedResults(query) : null;
    if (cachedIds) {
      this.displaySearchResults(cachedIds);
      this.lastDisplayedSequenceNumber = this.searchSequenceNumber;
      this.telemetry.record('food.catalogue_search', performance.now() - this.searchStartedAt, {
        source: 'cache',
        queryLength: query.length,
        results: cachedIds.length,
      });
    }

    this.scheduleSearchQuery(query, this.searchSequenceNumber);
  }

  public legacySearchProducts(typedQuery: string): void {
    const startedAt = performance.now();
    const query = fixKeyboardLayout(typedQuery);
    this.searchQuery$$.set(query);

    if (!query.trim()) {
      this.legacySearchResults$$.set([]);
      return;
    }

    const searchTerms = query
      .toLowerCase()
      .split(' ')
      .filter((term) => term.length > 0);

    const catalogue = this.catalogue$$();
    const allEntries = Object.values(catalogue);

    const results = allEntries.filter((food) => {
      if (!this.matchesSearchScope(food)) return false;
      const legacyNameLower = food.legacyName?.toLowerCase() || '';
      return searchTerms.every((term) => legacyNameLower.includes(term));
    });

    this.legacySearchResults$$.set(results);
    this.telemetry.record('food.catalogue_search', performance.now() - startedAt, {
      source: 'legacy',
      queryLength: query.length,
      results: results.length,
    });
  }

  private getSearchCachedResults(query: string): number[] | null {
    return this.searchCache[query] || null;
  }

  private setSearchCachedResults(query: string, ids: number[]): void {
    this.searchCache[query] = ids;
    this.saveSearchCacheToLocalStorage();
  }

  // A burst of keystrokes sends only the final text: every call replaces the pending send.
  private scheduleSearchQuery(query: string, sequenceNumber: number): void {
    this.cancelScheduledSearchQuery();
    this.searchSendTimer = setTimeout(() => {
      this.searchSendTimer = null;
      this.sendSearchQuery(query, sequenceNumber);
    }, FOOD_SEARCH_SEND_DEBOUNCE_MS);
  }

  private cancelScheduledSearchQuery(): void {
    if (this.searchSendTimer === null) return;
    clearTimeout(this.searchSendTimer);
    this.searchSendTimer = null;
  }

  private sendSearchQuery(query: string, sequenceNumber: number): void {
    const message: SearchQueryWsMessage = {
      type: WebSocketMessageType.SEARCH_QUERY,
      query: query,
      scope: this.scope$$(),
      sequenceNumber: sequenceNumber,
    };
    this.networkService.sendMessage(message);
  }

  private replaySearchQuery(): void {
    const query = this.searchQuery$$().trim();
    if (!query || this.searchSequenceNumber === 0) return;
    this.sendSearchQuery(query, this.searchSequenceNumber);
  }

  private setupSearchWebSocketListener(): void {
    this.networkService.wsMessages$
      .pipe(filter((msg) => msg.type === WebSocketMessageType.SEARCH_RESULTS))
      .subscribe((msg) => {
        this.handleSearchResults(msg as SearchResultsWsMessage);
      });

    this.networkService.wsMessages$
      .pipe(filter((msg) => msg.type === WebSocketMessageType.CATALOGUE_ENTRY_SAVED))
      .subscribe((msg) => {
        const typed = msg as CatalogueEntrySavedWsMessage;
        if (this.isValidCatalogueEntry(typed.payload)) this.handleCatalogueEntrySaved(typed);
      });

    this.networkService.wsMessages$
      .pipe(filter((msg) => msg.type === WebSocketMessageType.CATALOGUE_ENTRY_DELETED))
      .subscribe((msg) => {
        const typed = msg as CatalogueEntryDeletedWsMessage;
        if (typed.payload && typeof typed.payload.catalogueId === 'number') {
          this.removeCatalogueEntry(typed.payload.catalogueId);
        }
      });

    this.networkService.wsMessages$
      .pipe(filter((msg) => msg.type === WebSocketMessageType.CATALOGUE_IMAGE_GENERATED))
      .subscribe((msg) => {
        const typed = msg as CatalogueImageGeneratedWsMessage;
        if (
          typed.payload &&
          typeof typed.payload.catalogueId === 'number' &&
          typeof typed.payload.imageVersion === 'number'
        ) {
          this.handleCatalogueImageGenerated(typed);
        }
      });

    this.networkService.wsMessages$
      .pipe(filter((msg) => msg.type === WebSocketMessageType.CATALOGUE_IMAGE_FAILED))
      .subscribe((msg) => {
        const typed = msg as CatalogueImageFailedWsMessage;
        if (typed.payload && typeof typed.payload.catalogueId === 'number') {
          this.handleCatalogueImageFailed(typed);
        }
      });
  }

  private isValidCatalogueEntry(entry: CatalogueEntry): entry is CatalogueEntry {
    return Boolean(entry) && typeof entry.id === 'number' && typeof entry.name === 'string';
  }

  private handleSearchResults(msg: SearchResultsWsMessage): void {
    const results = msg.payload.catalogueIds;
    const queryFromMessage = msg.payload.query;
    const sequenceFromMessage = msg.payload.sequenceNumber;
    // The reply belongs to the scope the server applied, which can differ from the one on screen:
    // the user may have switched meanwhile, or the server may have fallen back to the active scope.
    const replyScope = msg.payload.scope;

    if (!queryFromMessage || !Array.isArray(results)) {
      return;
    }

    const cachedIds = this.isScopeCached(replyScope) ? this.getSearchCachedResults(queryFromMessage) : null;
    const isChanged = !cachedIds || !this.arraysEqual(cachedIds, results);

    if (isChanged) {
      if (this.isScopeCached(replyScope)) {
        this.setSearchCachedResults(queryFromMessage, results);
      }

      // The last displayed number is the query on screen; its own reply (equal number) refines what the local
      // cache showed, while a reply to an earlier query (smaller number) is dropped.
      if (replyScope === this.scope$$() && sequenceFromMessage >= this.lastDisplayedSequenceNumber) {
        this.displaySearchResults(results);
        this.lastDisplayedSequenceNumber = sequenceFromMessage;
      }
    }

    if (this.searchStartedAt !== null && queryFromMessage === this.searchQuery$$()) {
      this.telemetry.record('food.catalogue_search', performance.now() - this.searchStartedAt, {
        source: 'remote',
        queryLength: queryFromMessage.length,
        results: results.length,
        displayed: sequenceFromMessage === this.lastDisplayedSequenceNumber,
      });
      this.searchStartedAt = null;
    }
  }

  private handleCatalogueEntrySaved(msg: CatalogueEntrySavedWsMessage): void {
    this.upsertCatalogueEntry(msg.payload);
  }

  private handleCatalogueImageFailed(msg: CatalogueImageFailedWsMessage): void {
    const catalogueId = msg.payload.catalogueId;
    // Another device's failure is none of this client's business: only a generation requested here is reported.
    if (!(catalogueId in this.imageGenerating$$())) {
      return;
    }

    this.stopImageGenerating(catalogueId);
    const name = this.catalogue$$()[catalogueId]?.name;
    this.notificationService.addNotification(
      'error',
      name ? `Не удалось сгенерировать картинку: ${name}` : 'Не удалось сгенерировать картинку',
    );
  }

  private handleCatalogueImageGenerated(msg: CatalogueImageGeneratedWsMessage): void {
    const catalogueId = msg.payload.catalogueId;
    const imageVersion = msg.payload.imageVersion;
    const catalogue = this.catalogue$$();

    const requestedAtVersion = this.imageGenerating$$()[catalogueId];
    if (requestedAtVersion !== undefined && imageVersion > requestedAtVersion) {
      this.stopImageGenerating(catalogueId);
    }

    const existingEntry = catalogue[catalogueId];

    if (existingEntry) {
      const updatedEntry = {
        ...existingEntry,
        imageVersion,
      };

      const updatedCatalogue = {
        ...catalogue,
        [catalogueId]: updatedEntry,
      };

      this.catalogue$$.set(updatedCatalogue);
      this.saveToLocalStorage(updatedCatalogue);

      const currentSearchResults = this.searchResults$$();
      const updatedSearchResults = currentSearchResults.map((item) => (item.id === catalogueId ? updatedEntry : item));
      this.searchResults$$.set(updatedSearchResults);

      const currentLegacyResults = this.legacySearchResults$$();
      const updatedLegacyResults = currentLegacyResults.map((item) => (item.id === catalogueId ? updatedEntry : item));
      this.legacySearchResults$$.set(updatedLegacyResults);
    }
  }

  private displaySearchResults(ids: number[]): void {
    const catalogue = this.catalogue$$();

    if (!ids || !Array.isArray(ids) || !catalogue) {
      this.searchResults$$.set([]);
      return;
    }

    // Single place that applies the scope: it also drops ids from a stale cache, so the cache
    // itself never needs cleaning when a product is archived or restored.
    const results = ids.map((id) => catalogue[id]).filter((entry) => entry && this.matchesSearchScope(entry));
    this.searchResults$$.set(results);
  }

  private matchesSearchScope(entry: CatalogueEntry): boolean {
    switch (this.scope$$()) {
      case SearchScope.Archived:
        return Boolean(entry.archived);
      case SearchScope.All:
        return true;
      default:
        return !entry.archived;
    }
  }

  // Only the active scope has a results cache: the other scopes are searched rarely.
  private isScopeCached(scope: SearchScope): boolean {
    return scope === SearchScope.Active;
  }

  private arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  private loadSearchCacheFromLocalStorage(): void {
    try {
      const savedCache = this.localStorageService.getUserScoped<Record<string, number[]>>(this.SEARCH_CACHE_KEY);
      if (savedCache) {
        this.searchCache = savedCache;
      }
    } catch (error) {
      console.error('Failed to load search cache from localStorage:', error);
      this.searchCache = {};
    }
  }

  private saveSearchCacheToLocalStorage(): void {
    try {
      this.localStorageService.setUserScoped(this.SEARCH_CACHE_KEY, this.searchCache);
    } catch (error) {
      console.error('Failed to save search cache to localStorage:', error);
    }
  }

  public clearSearch(): void {
    this.cancelScheduledSearchQuery();
    this.searchQuery$$.set('');
    this.searchResults$$.set([]);
    this.legacySearchResults$$.set([]);
    this.searchSequenceNumber = 0;
    this.lastDisplayedSequenceNumber = 0;
  }

  public async generateProductPreview(description: string): Promise<ProductPreviewData> {
    try {
      const response = await firstValueFrom(
        this.http.post<ServerResponseProductPreview>('/api/food/generate-product-preview', { description }),
      );

      if (!response.result || !response.data) {
        throw new Error('Failed to generate product preview');
      }

      return response.data;
    } catch (error) {
      console.error('Failed to generate product preview:', error);
      throw error;
    }
  }

  public saveProduct(productData: ProductSaveRequest): Promise<CatalogueEntry> {
    const startedAt = performance.now();
    const mutationType = productData.id ? 'update' : 'create';
    return new Promise<CatalogueEntry>((resolve, reject) => {
      this.addSyncOperation({
        mode: SyncOperationMode.NonOptimistic,
        type: SyncOperationType.CREATE, // always POST — save-product handles both create and update by body.id
        endpoint: '/api/food/save-product',
        data: productData,
        applyCallback: (response: ServerResponseProductSave) => {
          if (!response.result || !response.data?.catalogueEntry) {
            void this.telemetry.recordAfterPaint('food.catalogue_mutation', startedAt, { mutationType }, 'error');
            reject(new Error(response.error || 'Failed to save product'));
            return;
          }

          const catalogueEntry = response.data.catalogueEntry;
          this.upsertCatalogueEntry(catalogueEntry);
          void this.telemetry.recordAfterPaint('food.catalogue_mutation', startedAt, { mutationType });
          resolve(catalogueEntry);
        },
        errorCallback: (error: SyncOperationError) => {
          void this.telemetry.recordAfterPaint('food.catalogue_mutation', startedAt, { mutationType }, 'error');
          reject(error);
        },
      });
    });
  }

  public async getProductById(catalogueId: number): Promise<CatalogueEntry> {
    try {
      const response = await firstValueFrom(
        this.http.get<ServerResponseWithData<CatalogueEntry>>(`/api/food/catalogue/${catalogueId}`),
      );

      if (!response.result || !response.data) {
        throw new Error('Failed to load product');
      }

      this.upsertCatalogueEntry(response.data);

      return response.data;
    } catch (error) {
      console.error('Failed to load product:', error);
      throw error;
    }
  }

  public deleteProduct(catalogueId: number): Promise<void> {
    const startedAt = performance.now();
    return new Promise<void>((resolve, reject) => {
      this.addSyncOperation({
        mode: SyncOperationMode.NonOptimistic,
        type: SyncOperationType.DELETE,
        endpoint: `/api/food/catalogue/${catalogueId}`,
        data: {},
        applyCallback: (response: ServerResponseBasic) => {
          if (!response.result) {
            void this.telemetry.recordAfterPaint(
              'food.catalogue_mutation',
              startedAt,
              { mutationType: 'delete' },
              'error',
            );
            reject(new Error('Failed to delete product'));
            return;
          }

          this.removeCatalogueEntry(catalogueId);
          void this.telemetry.recordAfterPaint('food.catalogue_mutation', startedAt, {
            mutationType: 'delete',
          });
          resolve();
        },
        errorCallback: (error: SyncOperationError) => {
          void this.telemetry.recordAfterPaint(
            'food.catalogue_mutation',
            startedAt,
            { mutationType: 'delete' },
            'error',
          );
          reject(error);
        },
      });
    });
  }

  private upsertCatalogueEntry(entry: CatalogueEntry): void {
    const updatedCatalogue = {
      ...this.catalogue$$(),
      [entry.id]: entry,
    };

    this.catalogue$$.set(updatedCatalogue);
    this.saveToLocalStorage(updatedCatalogue);

    // A product whose archive flag changed may no longer belong to the results of the current scope.
    this.searchResults$$.update((results) =>
      results.map((item) => (item.id === entry.id ? entry : item)).filter((item) => this.matchesSearchScope(item)),
    );
    this.legacySearchResults$$.update((results) =>
      results.map((item) => (item.id === entry.id ? entry : item)).filter((item) => this.matchesSearchScope(item)),
    );
  }

  private removeCatalogueEntry(catalogueId: number): void {
    const updatedCatalogue = { ...this.catalogue$$() };
    delete updatedCatalogue[catalogueId];

    this.catalogue$$.set(updatedCatalogue);
    this.saveToLocalStorage(updatedCatalogue);

    this.searchResults$$.update((results) => results.filter((item) => item.id !== catalogueId));
    this.legacySearchResults$$.update((results) => results.filter((item) => item.id !== catalogueId));
  }

  public isImageGenerating(catalogueId: number): boolean {
    return catalogueId in this.imageGenerating$$();
  }

  // Asks the server to generate (or replace) the product image; the result arrives as a WebSocket event. A plain
  // request, not a sync operation: generation costs money and must neither queue up offline nor repeat by itself.
  public async regenerateProductImage(catalogueId: number): Promise<void> {
    if (this.isImageGenerating(catalogueId)) {
      return;
    }

    this.startImageGenerating(catalogueId, this.catalogue$$()[catalogueId]?.imageVersion ?? 0);
    try {
      await firstValueFrom(
        this.http.post<ServerResponseWithData<{ status: string }>>(
          `/api/food/catalogue/${catalogueId}/regenerate-image`,
          {},
        ),
      );
    } catch (error) {
      this.stopImageGenerating(catalogueId);
      throw error;
    }
  }

  private startImageGenerating(catalogueId: number, imageVersion: number): void {
    this.imageGenerating$$.update((current) => ({ ...current, [catalogueId]: imageVersion }));
    this.imageGenerationTimers.set(
      catalogueId,
      setTimeout(() => this.stopImageGenerating(catalogueId), FOOD_IMAGE_GENERATION_FALLBACK_MS),
    );
  }

  private stopImageGenerating(catalogueId: number): void {
    clearTimeout(this.imageGenerationTimers.get(catalogueId));
    this.imageGenerationTimers.delete(catalogueId);
    this.imageGenerating$$.update((current) => {
      const next = { ...current };
      delete next[catalogueId];
      return next;
    });
  }

  public getThumbImageUrl(catalogueId: number): string | undefined {
    const catalogueEntry = this.catalogue$$()[catalogueId];
    if (!catalogueEntry?.imageVersion) {
      return undefined;
    }
    return `/api/images/food/${catalogueId}-thumb-v${catalogueEntry.imageVersion}.webp`;
  }

  public getSquircleImageUrl(catalogueId: number): string | undefined {
    const catalogueEntry = this.catalogue$$()[catalogueId];
    if (!catalogueEntry?.imageVersion) {
      return undefined;
    }
    return `/api/images/food/${catalogueId}-squircle-v${catalogueEntry.imageVersion}.png`;
  }

  public getCornerImageUrl(catalogueId: number): string | undefined {
    const catalogueEntry = this.catalogue$$()[catalogueId];
    if (!catalogueEntry?.imageVersion) {
      return undefined;
    }
    return `/api/images/food/${catalogueId}-corner-v${catalogueEntry.imageVersion}.png`;
  }
}
