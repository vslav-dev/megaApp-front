import { inject, Service, signal, WritableSignal } from '@angular/core';
import { FoodDiaryService } from '@app/services/food/food-diary.service';

export const FoodScreenMobileTab = {
  Diary: 'diary',
  Stats: 'stats',
} as const;

export type FoodScreenMobileTab = (typeof FoodScreenMobileTab)[keyof typeof FoodScreenMobileTab];

// Scoped to FoodScreen (provided there, not root) — the shared hub between food-screen (which owns
// the layout computation) and its descendants that need to read or drive the current mode:
// food-diary/food-stats-accordion (which of the two to render) and food-mode-toggle-fab (the
// always-mounted button that switches between them).
@Service({ autoProvided: false })
export class FoodScreenModeService {
  private readonly foodDiaryService = inject(FoodDiaryService);

  public readonly mobileTab$$: WritableSignal<FoodScreenMobileTab> = signal(FoodScreenMobileTab.Diary);

  // True when food-screen's own column-fit algorithm settled on 1 column — the only layout where
  // the diary/stats toggle applies. Pushed in by food-screen, read by food-mode-toggle-fab.
  public readonly isSingleColumnLayout$$: WritableSignal<boolean> = signal(false);

  // Jumps the diary to a date, same as picking it in the calendar. On the single-column mobile
  // layout, diary and stats are two tabs of the same screen — also switch to the diary tab so the
  // jump is actually visible instead of landing behind the stats tab.
  public showDiaryDay(dateIso: string): void {
    this.foodDiaryService.selectedDayIso$$.set(dateIso);
    if (this.isSingleColumnLayout$$()) this.mobileTab$$.set(FoodScreenMobileTab.Diary);
  }

  public toggleMobileTab(): void {
    this.mobileTab$$.update((tab) =>
      tab === FoodScreenMobileTab.Diary ? FoodScreenMobileTab.Stats : FoodScreenMobileTab.Diary,
    );
  }
}
