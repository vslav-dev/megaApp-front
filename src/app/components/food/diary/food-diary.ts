import { NgStyle } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BMI } from '@app/components/food/diary/bmi/bmi';
import { BodyWeight } from '@app/components/food/diary/body-weight/body-weight';
import { DiaryEntryEditForm } from '@app/components/food/diary/diary-entry-edit-form/diary-entry-edit-form';
import { DiaryNavButtons } from '@app/components/food/diary/diary-nav/diary-nav-buttons';
import { FOOD_DIARY_ACCORDION_GROUP_ID } from '@app/components/food/diary/food-diary-accordion';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodAddModalService, ModalState } from '@app/services/food/food-add-modal.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { KeyboardService } from '@app/services/keyboard.service';
import { DiaryEntryWithFullData } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VAccordion } from '@ui-kit/components/v-expand/v-accordion';
import { VExpand } from '@ui-kit/components/v-expand/v-expand';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VModal } from '@ui-kit/components/v-modal/v-modal';
import { VRollingNumber } from '@ui-kit/components/v-rolling-number/v-rolling-number';
import { AccordionGroupService } from '@ui-kit/services/accordion-group.service';
import { NutritionSummary } from './nutrition-summary/nutrition-summary';

@Component({
  selector: 'food-diary',
  templateUrl: './food-diary.html',
  styleUrl: './food-diary.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    NgStyle,
    DiaryNavButtons,
    DiaryEntryEditForm,
    BMI,
    BodyWeight,
    NutritionSummary,
    VButton,
    VModal,
    VAccordion,
    VExpand,
    VIcon,
    VRollingNumber,
  ],
})
export class FoodDiary {
  protected readonly bodyWeightComponent = viewChild.required<BodyWeight>('bodyWeight');
  protected readonly diaryEntryHeaders = viewChildren<ElementRef>('diaryEntryHeader');

  private readonly weightMeasureElems = viewChildren<ElementRef>('foodWeightMeasureElem');
  private readonly percentMeasureElems = viewChildren<ElementRef>('foodPercentMeasureElem');

  // null = no width constraint yet, each row sits at its own natural (auto) width.
  // Never reset on day change — new rows are born pinned to the last committed width
  // instead of jumping to auto, then animate (via CSS transition) to the freshly
  // measured target once the new day's content has painted.
  protected readonly columnWidths$$ = signal<{ weight: number | null; percent: number | null }>({
    weight: null,
    percent: null,
  });

  protected readonly selectedDayDiaryEntries$$ = computed(() => {
    const selectedDay = this.foodDiaryService.selectedDayIso$$();
    return this.foodDiaryService.diary$$()[selectedDay]?.food || [];
  });

  protected readonly selectedDaysKcalsPercent$$ = computed(() => {
    return this.foodDiaryService.selectedDayTotals$$().kcalsPercent;
  });

  protected readonly selectedDaysKcalsConsumed$$ = computed(() => {
    return this.foodDiaryService.selectedDayTotals$$().kcalsConsumed;
  });

  protected readonly selectedDaysTargetKcals$$ = computed(() => {
    return this.foodDiaryService.selectedDayTotals$$().targetKcals;
  });

  protected readonly selectedDaysFormattedConsumedPercent$$ = computed(() => {
    return Math.round(this.foodDiaryService.selectedDayTotals$$().kcalsPercent * 10) / 10;
  });

  // Bar scale sits at 100% until consumption overflows it, then jumps to the next
  // 25%-multiple ceiling (125, 150, ...) so the fill never clips past the bar's edge.
  protected readonly dayProgressScale$$ = computed(() => {
    const percent = this.selectedDaysKcalsPercent$$();
    if (percent <= 100) return 100;
    return Math.ceil(percent / FoodDiary.DAY_PROGRESS_STEP) * FoodDiary.DAY_PROGRESS_STEP;
  });

  protected readonly dayProgressFillPercent$$ = computed(() => {
    return (this.selectedDaysKcalsPercent$$() / this.dayProgressScale$$()) * 100;
  });

  // One dashed marker per 25%-multiple the current scale has absorbed (100, then 125, ...),
  // positioned as a fraction of the current scale so they slide left as the scale grows.
  protected readonly dayProgressTicks$$ = computed(() => {
    const scale = this.dayProgressScale$$();
    const ticks: { value: number; position: number }[] = [];

    for (let threshold = 100; threshold < scale; threshold += FoodDiary.DAY_PROGRESS_STEP) {
      ticks.push({ value: threshold, position: (threshold / scale) * 100 });
    }

    return ticks;
  });

  protected readonly hasSelectedDayDiaryEntries$$ = computed(() => this.selectedDayDiaryEntries$$().length > 0);
  protected readonly canRestoreSelectedDay$$ = computed(
    () => this.foodDiaryService.selectedDayDeletedSnapshot$$() !== null,
  );

  // null hides the whole label (no target set yet) — string, not number, so it can feed
  // v-rolling-number directly without the template re-deriving a display format.
  protected readonly selectedDaysConsumedPercentText$$ = computed<string | null>(() => {
    const percent = this.selectedDaysFormattedConsumedPercent$$();
    return Number.isNaN(percent) ? null : String(percent);
  });

  // Drives hiding "Добавить запись" (and the mobile add-FAB in diary-nav-buttons) while any
  // accordion on this screen is expanded — its "Сохранить"/panel controls sit right next to
  // that button and users kept mis-tapping one for the other.
  protected readonly isAnyAccordionOpen$$ = computed(() =>
    this.accordionGroupService.isAnyOpen(FOOD_DIARY_ACCORDION_GROUP_ID),
  );

  protected isDeleteDayConfirmOpen = false;
  protected readonly Icon = IconName;

  private static readonly DAY_PROGRESS_STEP = 25;

  // Measures natural content width from the unconstrained inner spans (unaffected by
  // whatever width is currently applied to their parent), so recalculation never needs
  // to reset columns back to auto first — that reset was the source of the visible jump.
  private readonly columnWidthsSyncEffect$$ = afterRenderEffect({
    read: () => {
      this.selectedDayDiaryEntries$$();

      const weightWidths = this.weightMeasureElems().map((elem) => elem.nativeElement.getBoundingClientRect().width);
      const percentWidths = this.percentMeasureElems().map((elem) => elem.nativeElement.getBoundingClientRect().width);
      if (weightWidths.length === 0) return;

      const nextWeight = Math.ceil(Math.max(...weightWidths));
      const nextPercent = Math.ceil(Math.max(...percentWidths));

      this.columnWidths$$.update((current) => {
        if (current.weight === nextWeight && current.percent === nextPercent) return current;
        return { weight: nextWeight, percent: nextPercent };
      });
    },
  });

  private readonly closeFoodEntriesOnDayChangeEffect$$ = effect(() => {
    const currentDay = this.foodDiaryService.selectedDayIso$$();

    if (this.previousSelectedDay !== currentDay) {
      this.previousSelectedDay = currentDay;

      if (this.openedDiaryEntryId$$() !== null) {
        this.closeAllAccordions();
        this.openedDiaryEntryId$$.set(null);
      }
    }
  });

  protected readonly foodDiaryService = inject(FoodDiaryService);
  protected readonly foodAddModalService = inject(FoodAddModalService);
  protected readonly deviceInfoService = inject(DeviceInfoService);
  protected readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly accordionGroupService = inject(AccordionGroupService);
  private readonly keyboardService = inject(KeyboardService);

  private readonly shortcutSubscription = this.keyboardService
    .shortcut$({
      code: 'KeyN',
      when: () => this.foodAddModalService.currentState$$() === ModalState.CLOSED,
    })
    .pipe(takeUntilDestroyed())
    .subscribe(() => {
      this.openAddFoodModal();
    });

  // An archived product's fill is hatched: the filled part is made of diagonal stripes with
  // transparent gaps, so whatever is behind the row (light or dark theme background) shows through.
  // The entry that is being edited right now shows its draft share, any other one its saved share.
  protected getFillPercent(food: DiaryEntryWithFullData): number {
    const draft = this.foodDiaryService.draftEntryPercent$$();
    return draft?.diaryId === food.id ? draft.percent : food.foodKcalPercentageOfDaysNorm;
  }

  protected setBackgroundStyle(percent: number, isArchived: boolean): { [key: string]: string } {
    const percentCapped = percent <= 100 ? percent : 100;
    if (isArchived) {
      const hatching = 'repeating-linear-gradient(120deg, var(--gradient-color) 0 8px, transparent 8px 14px)';
      return { background: `${hatching} right / ${percentCapped}% 100% no-repeat` };
    }
    return {
      background: `linear-gradient(to left, var(--gradient-color) ${percentCapped}%, var(--gradient-bg) ${percentCapped}%)`,
    };
  }

  protected openAddFoodModal() {
    this.closeAllAccordions();
    this.foodAddModalService.openModal();
  }

  protected openDeleteDayConfirmationModal(): void {
    if (!this.hasSelectedDayDiaryEntries$$()) return;

    this.closeAllAccordions();
    this.isDeleteDayConfirmOpen = true;
  }

  protected closeDeleteDayConfirmationModal(): void {
    this.isDeleteDayConfirmOpen = false;
  }

  protected async onDeleteDayConfirmed(): Promise<void> {
    this.isDeleteDayConfirmOpen = false;
    await this.foodDiaryService.deleteSelectedDayEntries();
  }

  protected async onRestoreDayClicked(): Promise<void> {
    await this.foodDiaryService.restoreSelectedDayEntries();
  }

  protected isEntryExpanded(diaryEntryId: number): boolean {
    return this.openedDiaryEntryId$$() === diaryEntryId;
  }

  private readonly openedDiaryEntryId$$ = signal<number | null>(null);
  private previousSelectedDay: string | null = null;

  protected onVExpandOpened($event: CustomEvent<boolean>, expandingDiaryEntryId: number): void {
    if ($event.detail) {
      setTimeout(() => {
        this.openedDiaryEntryId$$.set(expandingDiaryEntryId);
      }, 0);
      this.foodDiaryService.focusDiaryEntry(expandingDiaryEntryId);

      if (this.deviceInfoService.isDesktopScreen$$()) return;

      setTimeout(() => {
        const foodIndex = this.selectedDayDiaryEntries$$().findIndex((food) => food.id === expandingDiaryEntryId);
        if (foodIndex === -1) return;

        const headerEl = this.diaryEntryHeaders()[foodIndex]?.nativeElement;
        if (headerEl) {
          window.scrollTo({
            top: headerEl.getBoundingClientRect().top + window.scrollY - 40,
            behavior: 'smooth',
          });
        }
      }, 100); // Waiting for the v-expand animation to finish, otherwise the scroll animation may not finish properly
    } else {
      this.openedDiaryEntryId$$.set(null);
      this.foodDiaryService.resetDiaryEntryForm(expandingDiaryEntryId);
    }
  }

  protected onBMIExpandOpened($event: CustomEvent<boolean>): void {
    if ($event.detail) {
      this.bodyWeightComponent().focusIfEmpty();
    }
  }

  protected closeAllAccordions(): void {
    this.accordionGroupService.closeAll(FOOD_DIARY_ACCORDION_GROUP_ID);
  }
}
