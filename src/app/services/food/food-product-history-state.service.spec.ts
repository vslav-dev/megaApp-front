import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { Catalogue, CatalogueEntry, ProductHistoryEntry } from '@app/shared/types';
import { Observable, of, Subject, throwError } from 'rxjs';
import { FoodCatalogueService } from './food-catalogue.service';
import { FoodDiaryService } from './food-diary.service';
import { FoodProductHistoryService } from './food-product-history.service';
import { FoodProductHistoryStateService, MAX_TRACKED_PRODUCTS } from './food-product-history-state.service';

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

function historyEntry(dateISO: string, foodCatalogueId: number, kcal: number): ProductHistoryEntry {
  return { dateISO, foodCatalogueId, foodWeight: 100, kcal, percentOfNorm: 1 };
}

function setup() {
  const catalogue$$ = signal<Catalogue>({
    1: entry(1, 'Шаурма'),
    2: entry(2, 'Чипсы', true),
  });
  const sessionState$$ = signal<AuthSessionState>(AuthSessionState.Authenticated);
  const mutationApplied$ = new Subject<string>();
  const getProductHistory = vi.fn((_ids: number[]): Observable<ProductHistoryEntry[]> => of([]));
  TestBed.configureTestingModule({
    providers: [
      { provide: FoodCatalogueService, useValue: { catalogue$$ } },
      { provide: FoodProductHistoryService, useValue: { getProductHistory } },
      { provide: FoodDiaryService, useValue: { mutationApplied$ } },
      { provide: AuthService, useValue: { sessionState$$ } },
    ],
  });
  return {
    state: TestBed.inject(FoodProductHistoryStateService),
    catalogue$$,
    sessionState$$,
    mutationApplied$,
    getProductHistory,
  };
}

describe('FoodProductHistoryStateService', () => {
  it('requests the history of the tracked ids, once per change', () => {
    const { state, getProductHistory } = setup();

    state.addProduct(entry(1, 'Шаурма'));
    state.addProduct(entry(2, 'Чипсы', true));
    state.removeProduct(1);

    expect(getProductHistory.mock.calls).toEqual([[[1]], [[1, 2]], [[2]]]);
  });

  it('tracks a product once', () => {
    const { state, getProductHistory } = setup();

    state.addProduct(entry(1, 'Шаурма'));
    state.addProduct(entry(1, 'Шаурма'));

    expect(state.trackedProducts$$().map((product) => product.id)).toEqual([1]);
    expect(getProductHistory).toHaveBeenCalledTimes(1);
  });

  it('stops tracking at the limit', () => {
    const { state, catalogue$$ } = setup();
    const products = Array.from({ length: MAX_TRACKED_PRODUCTS + 1 }, (_, index) =>
      entry(index + 1, `Продукт ${index}`),
    );
    catalogue$$.set(Object.fromEntries(products.map((product) => [product.id, product])));

    products.forEach((product) => state.addProduct(product));

    expect(state.trackedProducts$$()).toHaveLength(MAX_TRACKED_PRODUCTS);
    expect(state.isLimitReached$$()).toBe(true);
  });

  it('shows the current name and archive flag of a tracked product from the live catalogue', () => {
    const { state, catalogue$$ } = setup();
    state.addProduct(entry(1, 'Шаурма'));

    catalogue$$.update((catalogue) => ({ ...catalogue, 1: entry(1, 'Шаурма куриная', true) }));

    expect(state.productById$$().get(1)).toMatchObject({ name: 'Шаурма куриная', archived: true });
  });

  it('drops a product that left the catalogue from the tracked list', () => {
    const { state, catalogue$$ } = setup();
    state.addProduct(entry(1, 'Шаурма'));
    state.addProduct(entry(2, 'Чипсы', true));

    catalogue$$.update(({ 1: _removed, ...rest }) => rest);

    expect(state.trackedProducts$$().map((product) => product.id)).toEqual([2]);
  });

  describe('selectedKcalByDate$$', () => {
    it('sums the calories of all tracked products per day', () => {
      const { state, getProductHistory } = setup();
      getProductHistory.mockReturnValue(
        of([
          historyEntry('2026-01-02', 1, 300),
          historyEntry('2026-01-02', 2, 150),
          historyEntry('2026-01-01', 1, 200),
        ]),
      );

      state.addProduct(entry(1, 'Шаурма'));
      state.addProduct(entry(2, 'Чипсы', true));

      expect(Object.fromEntries(state.selectedKcalByDate$$())).toEqual({ '2026-01-02': 450, '2026-01-01': 200 });
    });

    it('keeps the same map while its content does not change', () => {
      const { state, catalogue$$, getProductHistory } = setup();
      getProductHistory.mockReturnValue(of([historyEntry('2026-01-02', 1, 300)]));
      state.addProduct(entry(1, 'Шаурма'));
      const before = state.selectedKcalByDate$$();

      catalogue$$.update((catalogue) => ({ ...catalogue, 2: entry(2, 'Чипсы новые', true) }));

      expect(state.selectedKcalByDate$$()).toBe(before);
    });

    it('stops counting a removed product before the next response arrives', () => {
      const { state, getProductHistory } = setup();
      getProductHistory.mockReturnValue(of([historyEntry('2026-01-02', 1, 300), historyEntry('2026-01-02', 2, 150)]));
      state.addProduct(entry(1, 'Шаурма'));
      state.addProduct(entry(2, 'Чипсы', true));

      getProductHistory.mockReturnValue(new Subject<ProductHistoryEntry[]>());
      state.removeProduct(1);

      expect(Object.fromEntries(state.selectedKcalByDate$$())).toEqual({ '2026-01-02': 150 });
    });
  });

  describe('refresh on diary changes', () => {
    it('reloads in the background while products are tracked', () => {
      const { state, mutationApplied$, getProductHistory } = setup();
      state.addProduct(entry(1, 'Шаурма'));
      const pending = new Subject<ProductHistoryEntry[]>();
      getProductHistory.mockReturnValue(pending);

      mutationApplied$.next('2026-01-02');

      expect(getProductHistory).toHaveBeenCalledTimes(2);
      expect(state.isLoading$$()).toBe(false);

      pending.next([historyEntry('2026-01-02', 1, 300)]);
      expect(state.selectedKcalByDate$$().get('2026-01-02')).toBe(300);
    });

    it('does not request anything while nothing is tracked', () => {
      const { mutationApplied$, getProductHistory } = setup();

      mutationApplied$.next('2026-01-02');

      expect(getProductHistory).not.toHaveBeenCalled();
    });

    it('keeps the shown entries when a background reload fails', () => {
      const { state, mutationApplied$, getProductHistory } = setup();
      getProductHistory.mockReturnValue(of([historyEntry('2026-01-02', 1, 300)]));
      state.addProduct(entry(1, 'Шаурма'));

      getProductHistory.mockReturnValue(throwError(() => new Error('offline')));
      mutationApplied$.next('2026-01-02');

      expect(state.error$$()).toBeNull();
      expect(state.selectedKcalByDate$$().get('2026-01-02')).toBe(300);
    });

    it('does not leave the loading overlay on when a background reload replaces a foreground one', () => {
      const { state, mutationApplied$, getProductHistory } = setup();
      getProductHistory.mockReturnValue(new Subject<ProductHistoryEntry[]>());
      state.addProduct(entry(1, 'Шаурма'));
      expect(state.isLoading$$()).toBe(true);

      getProductHistory.mockReturnValue(of([historyEntry('2026-01-02', 1, 300)]));
      mutationApplied$.next('2026-01-02');

      expect(state.isLoading$$()).toBe(false);
    });
  });

  it('shows an error and no entries when a foreground reload fails', () => {
    const { state, getProductHistory } = setup();
    getProductHistory.mockReturnValue(throwError(() => new Error('offline')));

    state.addProduct(entry(1, 'Шаурма'));

    expect(state.error$$()).not.toBeNull();
    expect(state.entries$$()).toEqual([]);
    expect(state.isLoading$$()).toBe(false);
  });

  it('forgets the tracked products on sign-out', () => {
    const { state, sessionState$$, getProductHistory } = setup();
    getProductHistory.mockReturnValue(of([historyEntry('2026-01-02', 1, 300)]));
    state.addProduct(entry(1, 'Шаурма'));

    sessionState$$.set(AuthSessionState.Guest);
    TestBed.tick();

    expect(state.hasSelection$$()).toBe(false);
    expect(state.entries$$()).toEqual([]);
  });
});
