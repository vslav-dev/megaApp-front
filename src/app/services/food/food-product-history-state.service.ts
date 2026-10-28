import { computed, effect, inject, OnDestroy, Service, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodProductHistoryService } from '@app/services/food/food-product-history.service';
import { CatalogueEntry, ProductHistoryEntry } from '@app/shared/types';
import { Subscription } from 'rxjs';

// Mirrors the backend cap on catalogueIds per product-history request (megaapp-back, plan 31).
export const MAX_TRACKED_PRODUCTS = 20;

// Root-scoped: the stats pipeline (FoodStatsService) reads the tracked products' calories per day to
// split the calories chart, and it lives in root. It also keeps the tracked set alive across the
// remounts of food-stats-product-history (mobile diary↔stats toggle, 2↔3 stats column boundary, see
// plan 31). Reset on sign-out, like the stats it feeds; a full page reload clears it too.
@Service()
export class FoodProductHistoryStateService implements OnDestroy {
  private readonly foodProductHistoryService = inject(FoodProductHistoryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly authService = inject(AuthService);

  // Only the ids are stored: name and archive flag are read from the live catalogue, so a product renamed,
  // archived or restored meanwhile (here or on another device) shows its current state.
  private readonly trackedIds$$: WritableSignal<number[]> = signal([]);

  public readonly trackedProducts$$ = computed(() => {
    const catalogue = this.foodCatalogueService.catalogue$$();
    return this.trackedIds$$()
      .map((id) => catalogue[id])
      .filter((product): product is CatalogueEntry => Boolean(product));
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

  private readonly resetOnAuthLossEffect$$ = effect(() => {
    if (this.authService.sessionState$$() === AuthSessionState.Guest) {
      this.reset();
    }
  });

  constructor() {
    // A diary change (local, or an event from another device) can add or remove a tracked product's
    // entry: the chart's bar updates from the diary at once, so its tracked part has to follow.
    this.foodDiaryService.mutationApplied$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.hasSelection$$()) this.reload({ isBackground: true });
    });
  }

  public ngOnDestroy(): void {
    this.activeRequestSub?.unsubscribe();
  }

  public addProduct(product: CatalogueEntry): void {
    const alreadyTracked = this.trackedIds$$().includes(product.id);
    if (alreadyTracked || this.isLimitReached$$()) return;

    this.trackedIds$$.update((ids) => [...ids, product.id]);
    this.reload({ isBackground: false });
  }

  public removeProduct(catalogueId: number): void {
    this.trackedIds$$.update((ids) => ids.filter((id) => id !== catalogueId));
    this.reload({ isBackground: false });
  }

  private reset(): void {
    this.activeRequestSub?.unsubscribe();
    this.trackedIds$$.set([]);
    this.entries$$.set([]);
    this.isLoading$$.set(false);
    this.error$$.set(null);
  }

  // A background reload refreshes data already on screen: no loading overlay, and a failure keeps the
  // previous entries (the next diary change retries) instead of replacing the table with an error.
  private reload({ isBackground }: { isBackground: boolean }): void {
    this.activeRequestSub?.unsubscribe();
    if (!isBackground) this.error$$.set(null);

    const catalogueIds = this.trackedProducts$$().map((product) => product.id);
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
