import { Injectable, signal, WritableSignal } from '@angular/core';

export const FoodScreenMobileTab = {
  Diary: 'diary',
  Stats: 'stats',
} as const;

export type FoodScreenMobileTab = (typeof FoodScreenMobileTab)[keyof typeof FoodScreenMobileTab];

// Scoped to FoodScreen (provided there, not root) — the shared hub between food-screen (which owns
// the layout computation) and its descendants that need to read or drive the current mode:
// food-diary/food-stats-accordion (which of the two to render) and food-mode-toggle-fab (the
// always-mounted button that switches between them).
@Injectable()
export class FoodScreenModeService {
  public readonly mobileTab$$: WritableSignal<FoodScreenMobileTab> = signal(FoodScreenMobileTab.Diary);

  // True when food-screen's own column-fit algorithm settled on 1 column — the only layout where
  // the diary/stats toggle applies. Pushed in by food-screen, read by food-mode-toggle-fab.
  public readonly isSingleColumnLayout$$: WritableSignal<boolean> = signal(false);

  public toggleMobileTab(): void {
    this.mobileTab$$.update((tab) =>
      tab === FoodScreenMobileTab.Diary ? FoodScreenMobileTab.Stats : FoodScreenMobileTab.Diary,
    );
  }
}
