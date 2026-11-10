import { DestroyRef, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService, AuthSessionState } from '@app/services/auth.service';
import {
  FoodProductHistoryStateService,
  MAX_TRACKED_PRODUCTS,
} from '@app/services/food/food-product-history-state.service';

// /food?products=12,45,7 — the product-history selection, in chip order (plan 53).
export const PRODUCTS_QUERY_PARAM = 'products';

const ID_TOKEN = /^\d+$/;

// The param comes from a bookmark and can be edited by hand: a token that is not a positive integer is
// skipped, a repeated id is kept once, and ids past the tracking limit are dropped.
export function parseProductsParam(param: string): number[] {
  const ids: number[] = [];
  for (const token of param.split(',')) {
    const trimmed = token.trim();
    if (!ID_TOKEN.test(trimmed)) continue;

    const id = Number(trimmed);
    if (id === 0 || ids.includes(id)) continue;

    ids.push(id);
    if (ids.length === MAX_TRACKED_PRODUCTS) break;
  }
  return ids;
}

function serializeProductsParam(ids: readonly number[]): string | null {
  return ids.length > 0 ? ids.join(',') : null;
}

// Keeps the product-history selection and the /food URL in step, for as long as the calling component
// (FoodScreen, the /food route component) lives. The root state service owns the selection; the URL
// mirrors it, so a bookmark of the page brings the selection back.
//
// - URL → selection: a navigation into /food that carries the param replaces the selection. Without the
//   param (e.g. a menu click back to /food) the selection stays and is written back into the URL.
// - selection → URL: a query-only router navigation with replaceUrl — the router stays the one owner of
//   the URL (no drift to undo on a cancelled navigation), no history entry is added, and the route
//   component is reused, so nothing reloads. Back/forward are deliberately not synced.
export function syncProductHistoryWithUrl(): void {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const authService = inject(AuthService);
  const state = inject(FoodProductHistoryStateService);
  const destroyRef = inject(DestroyRef);

  const urlParam$$ = toSignal(route.queryParamMap.pipe(map((params) => params.get(PRODUCTS_QUERY_PARAM))), {
    requireSync: true,
  });

  // The last param written below: its own echo coming back through queryParamMap must not be applied —
  // the selection may have moved on while that navigation was in flight.
  let lastWrittenParam: string | null = null;

  route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((params) => {
    const param = params.get(PRODUCTS_QUERY_PARAM);
    if (param !== null && param !== lastWrittenParam) state.selectProducts(parseProductsParam(param));
  });

  // Runs after the navigation that delivered the URL has finished (effects run on change detection, not
  // inside the router's activation), and again on every selection or URL change.
  effect(() => {
    const ids = state.selectedIds$$();
    const urlParam = urlParam$$();
    // Sign-out clears the selection while the redirect to /auth is in flight; a navigation from here
    // would supersede that redirect.
    const isSignedIn = authService.sessionState$$() === AuthSessionState.Authenticated;

    const param = serializeProductsParam(ids);
    if (!isSignedIn || param === urlParam) return;

    lastWrittenParam = param;
    untracked(
      () =>
        void router.navigate([], {
          relativeTo: route,
          queryParams: { [PRODUCTS_QUERY_PARAM]: param },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
    );
  });
}
