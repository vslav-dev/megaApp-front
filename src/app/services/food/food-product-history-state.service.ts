import { computed, effect, inject, OnDestroy, Service, signal, untracked, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodProductHistoryService } from '@app/services/food/food-product-history.service';
import { CatalogueEntry, ProductHistoryEntry } from '@app/shared/types';
import { Subscription } from 'rxjs';

// Mirrors the backend cap on catalogueIds per product-history request (megaapp-back, plan 31).
export const MAX_TRACKED_PRODUCTS = 20;

const isSameIdList = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

// Root-scoped: the stats pipeline (FoodStatsService) reads the tracked products' calories per day to
// split the calories chart, and it lives in root. It also keeps the tracked set alive across the
// remounts of food-stats-product-history (mobile diary↔stats toggle, 2↔3 stats column boundary, see
// plan 31). Reset on sign-out, like the stats it feeds. The selection is mirrored into the /food URL
// (food-product-history-url.ts, plan 53), so a bookmark brings it back after a reload.
@Service()
export class FoodProductHistoryStateService implements OnDestroy {
  private readonly foodProductHistoryService = inject(FoodProductHistoryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly authService = inject(AuthService);

  // Only the ids are stored, in chip order: name and archive flag are read from the live catalogue, so a
  // product renamed, archived or restored meanwhile (here or on another device) shows its current state.
  // An id missing from the catalogue stays here but is neither shown nor requested: on a cold start the
  // selection comes from the URL before the catalogue does, and dropping those ids would wipe the URL.
  private readonly trackedIds$$: WritableSignal<number[]> = signal([], { equal: isSameIdList });
  public readonly selectedIds$$ = this.trackedIds$$.asReadonly();

  public readonly trackedProducts$$ = computed(() => {
    const catalogue = this.foodCatalogueService.catalogue$$();
    return this.trackedIds$$()
      .map((id) => catalogue[id])
      .filter((product): product is CatalogueEntry => Boolean(product));
  });

  // The ids the history is requested for: tracked and present in the catalogue. Compared by content, so
  // a catalogue change that keeps this set (a rename, an archive) costs nothing, while the catalogue
  // arriving after a selection taken from the URL loads that selection's history.
  private readonly requestedIds$$ = computed(() => this.trackedProducts$$().map((product) => product.id), {
    equal: isSameIdList,
  });

  public readonly entries$$: WritableSignal<ProductHistoryEntry[]> = signal([]);
  public readonly isLoading$$ = signal(false);
  public readonly error$$: WritableSignal<string | null> = signal(null);

  public readonly isLimitReached$$ = computed(() => this.trackedProducts$$().length >= MAX_TRACKED_PRODUCTS);
  public readonly hasSelection$$ = computed(() => this.trackedProducts$$().length > 0);

  public readonly productById$$ = computed(
    () => new Map(this.trackedProducts$$().map((product) => [product.id, product] as const)),
  );

  // Calories per day eaten from all tracked products together. Entries of a product removed a moment
  // ago still sit in entries$$ until the next response lands — filtering by the tracked set makes
  // the removal show at once.
  //
  // Compared by content: it is rebuilt on every catalogue change and every response, almost always
  // to the same numbers, and a new Map identity would rebuild the whole stats model and the charts.
  public readonly selectedKcalByDate$$ = computed(
    () => {
      const productById = this.productById$$();
      const kcalByDate = new Map<string, number>();
      for (const entry of this.entries$$()) {
        if (!productById.has(entry.foodCatalogueId)) continue;
        kcalByDate.set(entry.dateISO, (kcalByDate.get(entry.dateISO) ?? 0) + entry.kcal);
      }
      return kcalByDate;
    },
    { equal: (a, b) => a.size === b.size && [...a].every(([date, kcal]) => b.get(date) === kcal) },
  );

  private activeRequestSub: Subscription | null = null;

  // The one trigger of a foreground load: a user edit, a selection from the URL and a late catalogue all
  // reach the request through requestedIds$$.
  private readonly loadOnSelectionChangeEffect$$ = effect(() => {
    const catalogueIds = this.requestedIds$$();
    untracked(() => this.reload(catalogueIds, { isBackground: false }));
  });

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  public constructor() {
    // A diary change (local, or an event from another device) can add or remove a tracked product's
    // entry: the chart's bar updates from the diary at once, so its tracked part has to follow.
    this.foodDiaryService.mutationApplied$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.hasSelection$$()) this.reload(this.requestedIds$$(), { isBackground: true });
    });
  }

  public ngOnDestroy(): void {
    this.activeRequestSub?.unsubscribe();
  }

  // A user edit starts from the shown products, not the raw ids: ids unknown to the catalogue (a stale or
  // hand-edited URL) leave the selection, and with it the URL, on the first edit.
  public addProduct(product: CatalogueEntry): void {
    const shownIds = this.requestedIds$$();
    if (shownIds.includes(product.id) || this.isLimitReached$$()) return;

    this.trackedIds$$.set([...shownIds, product.id]);
  }

  public removeProduct(catalogueId: number): void {
    this.trackedIds$$.set(this.requestedIds$$().filter((id) => id !== catalogueId));
  }

  // Replaces the whole selection, e.g. with the one from a bookmarked URL. Expects distinct positive ids,
  // at most MAX_TRACKED_PRODUCTS of them (parseProductsParam guarantees that).
  public selectProducts(catalogueIds: number[]): void {
    this.trackedIds$$.set(catalogueIds);
  }

  private reset(): void {
    this.activeRequestSub?.unsubscribe();
    this.trackedIds$$.set([]);
    this.entries$$.set([]);
    this.isLoading$$.set(false);
    this.error$$.set(null);
  }

  // [LOAD-BEARING]: do not rewrite this as a resource()/rxResource() (decided in plan 37, Angular 22.2).
  // The required behaviour is the opposite of what a resource does:
  //  - while a new request is in flight (add/remove a product) the previous entries must stay visible,
  //    otherwise the tracked part of the calories chart blinks out and back; a resource drops its
  //    value to undefined in the `loading` status;
  //  - a failed background reload must keep the previous entries and show no error; a resource loses
  //    its value in the `error` status;
  //  - a failed foreground load clears the entries and shows the error — a resource has no notion of
  //    foreground vs background, only the isBackground flag here tells them apart.
  // Emulating this on top of a resource needs a separate last-good-value signal plus logic that derives
  // the meaning of an error from the previous status — more code and harder to read than this method.
  //
  // A background reload refreshes data already on screen: no loading overlay, and a failure keeps the
  // previous entries (the next diary change retries) instead of replacing the table with an error.
  private reload(catalogueIds: number[], { isBackground }: { isBackground: boolean }): void {
    this.activeRequestSub?.unsubscribe();
    if (!isBackground) this.error$$.set(null);

    if (catalogueIds.length === 0) {
      this.entries$$.set([]);
      this.isLoading$$.set(false);
      return;
    }

    if (!isBackground) this.isLoading$$.set(true);
    this.activeRequestSub = this.foodProductHistoryService.getProductHistory(catalogueIds).subscribe({
      next: (entries) => {
        this.entries$$.set(entries);
        this.isLoading$$.set(false);
      },
      error: () => {
        this.isLoading$$.set(false);
        if (isBackground) return;
        this.entries$$.set([]);
        this.error$$.set('Не удалось загрузить историю продукта');
      },
    });
  }
}
