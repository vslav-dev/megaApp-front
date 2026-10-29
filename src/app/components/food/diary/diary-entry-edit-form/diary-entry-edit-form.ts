import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { form, FormField, FormRoot, validate } from '@angular/forms/signals';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { evaluateWholeAmount, isEmptyOrPositiveWholeAmount } from '@app/shared/amount-expression';
import { DiaryEntry, HistoryEntry, HistoryEntryAction } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VExpand } from '@ui-kit/components/v-expand/v-expand';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VModal } from '@ui-kit/components/v-modal/v-modal';
import { VRollingNumber } from '@ui-kit/components/v-rolling-number/v-rolling-number';
import { UiProgressIcon } from '@ui-kit/progress-icon/progress-icon.component';
import { DiaryEntryProductInfo } from '../diary-entry-product-info/diary-entry-product-info';
import { NutritionSummary } from '../nutrition-summary/nutrition-summary';

const EMPTY_WEIGHTS = { foodWeightNew: '', foodWeightChange: '' };

@Component({
  selector: 'diary-entry-edit-form',
  templateUrl: './diary-entry-edit-form.html',
  host: {
    style: 'display: flex; flex-direction: column;',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    UiProgressIcon,
    VButton,
    VIcon,
    VExpand,
    VInput,
    VModal,
    VRollingNumber,
    DiaryEntryProductInfo,
    NutritionSummary,
  ],
})
export class DiaryEntryEditForm implements OnDestroy {
  public readonly diaryEntryInput = input.required<DiaryEntry>();

  // Fires after the entry was saved or deleted on the server.
  public readonly entryChangedOutput = output<void>();

  protected readonly foodWeightNewElem = viewChild.required<VInput>('foodWeightNewElem');
  protected readonly foodWeightChangeElem = viewChild.required<VInput>('foodWeightChangeElem');
  protected readonly infoPanelElem = viewChild.required<VExpand>('infoPanelElem');
  protected readonly chartsPanelElem = viewChild.required<VExpand>('chartsPanelElem');
  protected readonly historyPanelElem = viewChild.required<VExpand>('historyPanelElem');

  protected readonly isDeleteConfirmOpen$$ = signal(false);
  protected readonly isDeleting$$ = signal(false);
  protected readonly disablePanelsAnimationTemporarily$$ = signal(false);
  private historyAction: HistoryEntryAction = HistoryEntryAction.SET;

  // Compared by value, so effects that depend on it ignore background refreshes of the entry.
  private readonly diaryEntryId$$ = computed(() => this.diaryEntryInput().id);

  // Base data from the server — legitimately refreshed by any background reload, in-progress
  // draft below is never touched by it, only by the user's own input/reset/submit.
  private readonly foodWeightInitial$$ = computed(() => this.diaryEntryInput().foodWeight);

  // The user's in-progress, unsubmitted draft — set only from onNewWeightInput/onChangeWeightInput
  // and the reset handlers below, mutually exclusive (setting one clears the other). Both hold
  // the evaluated number, null while the input is empty or not yet a valid expression.
  private readonly foodWeightDraftNew$$: WritableSignal<number | null> = signal(null);
  private readonly foodWeightDraftChange$$: WritableSignal<number | null> = signal(null);

  protected readonly foodWeightFinal$$ = computed(() => this.computeFoodWeightFinal());
  protected readonly foodWeightFinalDisplay$$ = computed(() => `${this.foodWeightFinal$$()}г.`);

  // Mirrors the day's kcal-percent counter shown everywhere else (top bar, nutrition-summary) —
  // draft-aware via FoodDiaryService.setDraftEntryWeight, so this and the top bar are always the
  // same number, and it's already the exact figure the server will confirm on save.
  protected readonly projectedSelectedDaysConsumedPercentNum$$ = computed(
    () => this.foodDiaryService.selectedDayTotals$$().kcalsPercent,
  );
  protected readonly projectedSelectedDaysConsumedPercentPadded$$ = computed(() =>
    this.projectedSelectedDaysConsumedPercentNum$$().toFixed(1),
  );
  protected readonly projectedSelectedDaysConsumedPercentDisplay$$ = computed(
    () => `${this.projectedSelectedDaysConsumedPercentPadded$$()}%`,
  );

  protected readonly Icon = IconName;

  protected readonly hasOpenPanel$$ = computed(() => {
    return (
      this.infoPanelElem().isPanelExpanded() ||
      this.chartsPanelElem().isPanelExpanded() ||
      this.historyPanelElem().isPanelExpanded()
    );
  });

  private readonly weights$$ = signal({ ...EMPTY_WEIGHTS });

  // Both inputs take a number or an expression like "80*2" (see evaluateWholeAmount); empty is valid.
  protected readonly diaryEntryForm = form(
    this.weights$$,
    (path) => {
      validate(path.foodWeightNew, ({ value }) =>
        isEmptyOrPositiveWholeAmount(value()) ? undefined : { kind: 'weightExpression' },
      );
      validate(path.foodWeightChange, ({ value }) => {
        if (!value()) return undefined;

        const changeValue = evaluateWholeAmount(value());
        if (changeValue === null) return { kind: 'weightExpression' };

        return this.foodWeightInitial$$() + changeValue > 0 ? undefined : { kind: 'negativeResult' };
      });
    },
    { submission: { action: () => this.onSubmit() } },
  );

  // The template shows the reset buttons and the "г." suffix while an input has text.
  protected readonly hasNewWeight$$ = computed(() => this.diaryEntryForm.foodWeightNew().value() !== '');
  protected readonly hasChangeWeight$$ = computed(() => this.diaryEntryForm.foodWeightChange().value() !== '');

  private inputFocusEffect$$ = effect(() => {
    const focusId = this.foodDiaryService.diaryEntryFocusId$$();
    if (focusId === this.diaryEntryId$$()) {
      setTimeout(() => {
        this.foodWeightChangeElem().focus();
      }, 100); // Waiting for the panel animation to finish, otherwise there's a jitter
    }
  });

  private formResetEffect$$ = effect(() => {
    const resetId = this.foodDiaryService.diaryEntryResetId$$();
    setTimeout(() => {
      if (resetId === this.diaryEntryId$$()) {
        this.resetForm();
        this.closePanels();
      }
    }, 50); // Waiting for the panel to close, otherwise the reset is visually janky
  });

  protected get selectedFoodName() {
    return this.foodCatalogueService.catalogue$$()?.[this.diaryEntryInput().foodCatalogueId]?.name;
  }

  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);

  public ngOnDestroy(): void {
    this.foodDiaryService.clearDraftEntryWeight(this.diaryEntryId$$());
  }

  protected isFormValid(): boolean {
    if (this.diaryEntryForm().invalid() || this.diaryEntryForm().submitting() || this.isDeleting$$()) return false;

    const nextWeightIfNew = evaluateWholeAmount(this.diaryEntryForm.foodWeightNew().value());
    const nextWeightIfChange = evaluateWholeAmount(this.diaryEntryForm.foodWeightChange().value());

    const hasValidChange =
      (nextWeightIfNew !== null && this.foodWeightInitial$$() !== nextWeightIfNew) ||
      (nextWeightIfChange !== null && nextWeightIfChange !== 0);

    return hasValidChange && this.foodWeightFinal$$() > 0;
  }

  protected onNewWeightInput() {
    this.diaryEntryForm.foodWeightChange().value.set('');
    this.foodWeightDraftChange$$.set(null);

    const newWeight = evaluateWholeAmount(this.diaryEntryForm.foodWeightNew().value());
    this.foodWeightDraftNew$$.set(newWeight !== null && newWeight > 0 ? newWeight : null);
    this.syncDraftWithService();
  }

  protected onWeightNewResetClick(): void {
    this.diaryEntryForm.foodWeightNew().value.set('');
    this.foodWeightDraftNew$$.set(null);
    this.syncDraftWithService();
  }

  protected onChangeWeightInput() {
    this.diaryEntryForm.foodWeightNew().value.set('');
    this.foodWeightDraftNew$$.set(null);
    this.foodWeightDraftChange$$.set(evaluateWholeAmount(this.diaryEntryForm.foodWeightChange().value()));
    this.syncDraftWithService();
  }

  protected onWeightChangeResetClick(): void {
    this.diaryEntryForm.foodWeightChange().value.set('');
    this.foodWeightDraftChange$$.set(null);
    this.syncDraftWithService();
  }

  // The form's submission action.
  private async onSubmit(): Promise<void> {
    const weightIfChange = evaluateWholeAmount(this.diaryEntryForm.foodWeightChange().value());
    const weightIfSet = evaluateWholeAmount(this.diaryEntryForm.foodWeightNew().value());

    const foodWeight = weightIfChange ?? (weightIfSet !== null ? weightIfSet - this.foodWeightInitial$$() : 0);

    const historyValue = weightIfChange !== null ? Math.abs(foodWeight) : (weightIfSet ?? 0);

    if (weightIfChange === null) {
      this.historyAction = HistoryEntryAction.SET;
    } else {
      this.historyAction = weightIfChange < 0 ? HistoryEntryAction.SUBTRACT : HistoryEntryAction.ADD;
    }

    const history: HistoryEntry = { action: this.historyAction, value: historyValue };
    this.foodWeightNewElem().blur();
    this.foodWeightChangeElem().blur();

    const preppedFormValues: DiaryEntry = {
      id: this.diaryEntryId$$(),
      dateISO: this.foodDiaryService.selectedDayIso$$(),
      foodCatalogueId: this.diaryEntryInput().foodCatalogueId,
      foodWeight: this.foodWeightFinal$$(),
      kcals: 0,
      history: [history],
    };

    await this.foodDiaryService.editDiaryEntry(preppedFormValues);
    this.foodDiaryService.clearDraftEntryWeight(this.diaryEntryId$$());
    this.diaryEntryForm().reset({ ...EMPTY_WEIGHTS });
    this.entryChangedOutput.emit();
  }

  protected openConfirmationModal(): void {
    this.isDeleteConfirmOpen$$.set(true);
  }

  protected closeConfirmationModal(): void {
    this.isDeleteConfirmOpen$$.set(false);
  }

  protected onDeleteConfirmed(): void {
    this.deleteDiaryEntry();
    this.isDeleteConfirmOpen$$.set(false);
  }

  protected formHistoryEntry(historyEntry: HistoryEntry) {
    switch (historyEntry.action) {
      case HistoryEntryAction.INIT:
        return `Создано: ${historyEntry.value} г.`;
      case HistoryEntryAction.SET:
        return `Задано: ${historyEntry.value} г.`;
      case HistoryEntryAction.ADD:
        return `Добавлено: ${historyEntry.value} г.`;
      case HistoryEntryAction.SUBTRACT:
        return `Убрано: ${historyEntry.value} г.`;
    }
  }

  protected chooseIconForHistoryEntry(historyEntry: HistoryEntry) {
    switch (historyEntry.action) {
      case HistoryEntryAction.INIT:
        return this.Icon.Star;
      case HistoryEntryAction.SET:
        return this.Icon.Edit;
      case HistoryEntryAction.ADD:
        return this.Icon.Add;
      case HistoryEntryAction.SUBTRACT:
        return this.Icon.Remove;
    }
  }

  protected toggleInfoPanel(): void {
    const isExpanded = this.infoPanelElem().isPanelExpanded();

    if (!isExpanded) {
      this.chartsPanelElem().setExpanded(false);
      this.historyPanelElem().setExpanded(false);
    }

    this.infoPanelElem().setExpanded(!isExpanded);
  }

  protected toggleChartsPanel(): void {
    const isExpanded = this.chartsPanelElem().isPanelExpanded();

    if (!isExpanded) {
      this.infoPanelElem().setExpanded(false);
      this.historyPanelElem().setExpanded(false);
    }

    this.chartsPanelElem().setExpanded(!isExpanded);
  }

  protected toggleHistoryPanel(): void {
    const isExpanded = this.historyPanelElem().isPanelExpanded();

    if (!isExpanded) {
      this.infoPanelElem().setExpanded(false);
      this.chartsPanelElem().setExpanded(false);
    }

    this.historyPanelElem().setExpanded(!isExpanded);
  }

  private async deleteDiaryEntry(): Promise<void> {
    this.isDeleting$$.set(true);
    this.foodDiaryService.clearDraftEntryWeight(this.diaryEntryId$$());
    await this.foodDiaryService.deleteDiaryEntry(this.diaryEntryId$$());
    this.isDeleting$$.set(false);
    this.diaryEntryForm().reset({ ...EMPTY_WEIGHTS });
    this.entryChangedOutput.emit();
  }

  private computeFoodWeightFinal(): number {
    const draftNew = this.foodWeightDraftNew$$();
    if (draftNew !== null) return draftNew;

    const base = this.foodWeightInitial$$();
    const draftChange = this.foodWeightDraftChange$$();

    // Empty or unfinished input (e.g. "-" or "50*") has no draft: fall back to the base weight.
    if (draftChange === null) return base;

    return Math.max(base + draftChange, 0); // Prevent non-positive result.
  }

  private resetForm(): void {
    this.diaryEntryForm().reset({ ...EMPTY_WEIGHTS });
    this.foodWeightDraftNew$$.set(null);
    this.foodWeightDraftChange$$.set(null);
    this.syncDraftWithService();
  }

  // final === initial whenever there's no genuine in-progress edit (including right after
  // resetForm) — in that case we drop the projection override entirely rather than push a
  // no-op draft, so the counters fall back to the plain server truth.
  private syncDraftWithService(): void {
    const final = this.foodWeightFinal$$();
    const diaryEntry = this.diaryEntryInput();
    if (final === this.foodWeightInitial$$()) {
      this.foodDiaryService.clearDraftEntryWeight(diaryEntry.id);
    } else {
      this.foodDiaryService.setDraftEntryWeight(diaryEntry.dateISO, diaryEntry.id, diaryEntry.foodCatalogueId, final);
    }
  }

  private closePanels(): void {
    this.disablePanelsAnimationTemporarily$$.set(true);
    this.infoPanelElem().setExpanded(false);
    this.chartsPanelElem().setExpanded(false);
    this.historyPanelElem().setExpanded(false);
    setTimeout(() => {
      this.disablePanelsAnimationTemporarily$$.set(false);
    }, 100);
  }
}
