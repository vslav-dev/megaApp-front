import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import { FoodProductHistoryStateService, MAX_TRACKED_PRODUCTS } from './food-product-history-state.service';
import { parseProductsParam, syncProductHistoryWithUrl } from './food-product-history-url';

@Component({ template: '' })
class FoodRoute {
  public constructor() {
    syncProductHistoryWithUrl();
  }
}

@Component({ template: '' })
class MoneyRoute {}

async function setup(initialUrl: string, initialSelection: number[] = []) {
  const selectedIds$$ = signal<number[]>(initialSelection);
  const selectProducts = vi.fn((ids: number[]) => selectedIds$$.set(ids));
  const sessionState$$ = signal<AuthSessionState>(AuthSessionState.Authenticated);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'food', component: FoodRoute },
        { path: 'money', component: MoneyRoute },
      ]),
      { provide: FoodProductHistoryStateService, useValue: { selectedIds$$, selectProducts } },
      { provide: AuthService, useValue: { sessionState$$ } },
    ],
  });
  const harness = await RouterTestingHarness.create(initialUrl);
  const router = TestBed.inject(Router);
  const settle = async (): Promise<void> => {
    TestBed.tick();
    await harness.fixture.whenStable();
  };
  await settle();
  return { harness, router, settle, selectedIds$$, selectProducts, sessionState$$ };
}

describe('parseProductsParam', () => {
  it.each([
    ['', []],
    ['12', [12]],
    ['3,1,2', [3, 1, 2]],
    [' 3 , 1 ', [3, 1]],
    ['3,3,1,3', [3, 1]],
    ['0,-1,1.5,abc,,7', [7]],
  ])('reads %j as %j', (param, ids) => {
    expect(parseProductsParam(param)).toEqual(ids);
  });

  it('keeps at most the tracking limit', () => {
    const param = Array.from({ length: MAX_TRACKED_PRODUCTS + 5 }, (_, index) => index + 1).join(',');

    expect(parseProductsParam(param)).toHaveLength(MAX_TRACKED_PRODUCTS);
  });
});

describe('syncProductHistoryWithUrl', () => {
  it('selects the products of a bookmarked URL', async () => {
    const { router, selectProducts } = await setup('/food?products=3,1');

    expect(selectProducts).toHaveBeenCalledWith([3, 1]);
    expect(router.url).toBe('/food?products=3,1');
  });

  it('rewrites a hand-edited param into the selection it produced', async () => {
    const { router, selectProducts } = await setup('/food?products=3,x,3,0,1');

    expect(selectProducts).toHaveBeenCalledWith([3, 1]);
    expect(router.url).toBe('/food?products=3,1');
  });

  it('writes the current selection into a URL without the param', async () => {
    const { router, selectProducts } = await setup('/food', [5, 6]);

    expect(selectProducts).not.toHaveBeenCalled();
    expect(router.url).toBe('/food?products=5,6');
  });

  it('follows the selection in place, without a history entry', async () => {
    const { router, settle, selectedIds$$ } = await setup('/food');
    const navigate = vi.spyOn(router, 'navigate');

    selectedIds$$.set([1, 2]);
    await settle();

    expect(router.url).toBe('/food?products=1,2');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true }));

    selectedIds$$.set([]);
    await settle();

    expect(router.url).toBe('/food');
  });

  it('does not navigate while the URL already matches the selection', async () => {
    const { router, settle, selectedIds$$ } = await setup('/food?products=1,2', [1, 2]);
    const navigate = vi.spyOn(router, 'navigate');

    selectedIds$$.set([1, 2]);
    await settle();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('puts the selection back when /food is opened again without the param', async () => {
    const { router, settle, selectProducts } = await setup('/food?products=1,2');

    await router.navigateByUrl('/money');
    await router.navigateByUrl('/food');
    await settle();

    expect(selectProducts).toHaveBeenCalledOnce();
    expect(router.url).toBe('/food?products=1,2');
  });

  it('puts the selection back after a menu click to /food while on /food', async () => {
    const { router, settle } = await setup('/food?products=1,2');

    await router.navigateByUrl('/food');
    await settle();

    expect(router.url).toBe('/food?products=1,2');
  });

  it('leaves the URL to the sign-out redirect', async () => {
    const { router, settle, selectedIds$$, sessionState$$ } = await setup('/food?products=1');
    const navigate = vi.spyOn(router, 'navigate');

    sessionState$$.set(AuthSessionState.Guest);
    selectedIds$$.set([]);
    await settle();

    expect(navigate).not.toHaveBeenCalled();
  });
});
