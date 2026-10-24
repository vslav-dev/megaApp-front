import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { evaluateWholeAmount } from '@app/shared/amount-expression';
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

interface DiaryEntryFormModel {
  id: FormControl<number>;
  foodWeightNew: FormControl<string | null>;
  foodWeightChange: FormControl<string | null>;
}

@Component({
  selector: 'diary-entry-edit-form',
  templateUrl: './diary-entry-edit-form.html',
  host: {
    style: 'display: flex; flex-direction: column;',
  },
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    ReactiveFormsModule,
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
export class DiaryEntryEditForm implements OnChanges, OnDestroy {
  @Input()
  public diaryEntry!: DiaryEntry;

  @Output()
  public onServerSuccessfullEditResponse = new EventEmitter<void>();

  protected readonly foodWeightNewElem = viewChild.required<VInput>('foodWeightNewElem');
  protected readonly foodWeightChangeElem = viewChild.required<VInput>('foodWeightChangeElem');
  protected readonly infoPanelElem = viewChild.required<VExpand>('infoPanelElem');
  protected readonly chartsPanelElem = viewChild.required<VExpand>('chartsPanelElem');
  protected readonly historyPanelElem = viewChild.required<VExpand>('historyPanelElem');

  protected isDeleteConfirmOpen = false;
  protected disablePanelsAnimationTemporarily = false;
  private historyAction: HistoryEntryAction = HistoryEntryAction.SET;

  // Base data from the server — legitimately refreshed by any background reload, in-progress
  // draft below is never touched by it, only by the user's own input/reset/submit.
  private readonly foodWeightInitial$$: WritableSignal<number> = signal(0);

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

  // Both inputs take a number or an expression like "80*2" (see evaluateWholeAmount); empty is valid.
  private newWeightValidator(): ValidatorFn {
    return (control: AbstractControl<string | null>): ValidationErrors | null => {
      if (!control.value) return null;

      const newWeight = evaluateWholeAmount(control.value);
      return newWeight !== null && newWeight > 0 ? null : { weightExpression: true };
    };
  }

  private changeWeightValidator(): ValidatorFn {
    return (control: AbstractControl<string | null>): ValidationErrors | null => {
      if (!control.value) return null;

      const changeValue = evaluateWholeAmount(control.value);
      if (changeValue === null) return { weightExpression: true };

      return this.foodWeightInitial$$() + changeValue > 0 ? null : { negativeResult: true };
    };
  }

  protected diaryEntryForm = new FormGroup<DiaryEntryFormModel>({
    id: new FormControl(0, { nonNullable: true }),
    foodWeightNew: new FormControl<string | null>(null, [this.newWeightValidator()]),
    foodWeightChange: new FormControl<string | null>(null, [this.changeWeightValidator()]),
  });

  protected get foodWeightNewControl() {
    return this.diaryEntryForm.controls.foodWeightNew;
  }
  protected get foodWeightChangeControl() {
    return this.diaryEntryForm.controls.foodWeightChange;
  }

  private inputFocusEffect$$ = effect(() => {
    const focusId = this.foodDiaryService.diaryEntryFocusId$$();
    if (focusId === this.diaryEntryForm.value.id) {
      setTimeout(() => {
        this.foodWeightChangeElem().focus();
      }, 100); // Waiting for the panel animation to finish, otherwise there's a jitter
    }
  });

  private formResetEffect$$ = effect(() => {
    const resetId = this.foodDiaryService.diaryEntryResetId$$();
    setTimeout(() => {
      if (resetId === this.diaryEntryForm.value.id) {
        this.resetForm();
        this.closePanels();
      }
    }, 50); // Waiting for the panel to close, otherwise the reset is visually janky
  });

  protected get selectedFoodName() {
    return this.foodCatalogueService.catalogue$$()?.[this.diaryEntry.foodCatalogueId]?.name;
  }

  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);

  public ngOnChanges(): void {
    if (this.diaryEntry) {
      this.diaryEntryForm.patchValue({
        id: this.diaryEntry.id,
      });
      this.foodWeightInitial$$.set(this.diaryEntry.foodWeight);
    }
  }

  public ngOnDestroy(): void {
    this.foodDiaryService.clearDraftEntryWeight(this.diaryEntry.id);
  }

  protected isFormValid(): boolean {
    if (!this.diaryEntryForm.valid) return false;

    const nextWeightIfNew = evaluateWholeAmount(this.foodWeightNewControl.value);
    const nextWeightIfChange = evaluateWholeAmount(this.foodWeightChangeControl.value);

    const hasValidChange =
      (nextWeightIfNew !== null && this.foodWeightInitial$$() !== nextWeightIfNew) ||
      (nextWeightIfChange !== null && nextWeightIfChange !== 0);

    return hasValidChange && this.foodWeightFinal$$() > 0;
  }

  protected onNewWeightInput() {
    this.foodWeightChangeControl.setValue(null);
    this.foodWeightDraftChange$$.set(null);

    const newWeight = evaluateWholeAmount(this.foodWeightNewControl.value);
    this.foodWeightDraftNew$$.set(newWeight !== null && newWeight > 0 ? newWeight : null);
    this.syncDraftWithService();
  }

  protected onWeightNewResetClick(): void {
    this.foodWeightNewControl.setValue(null);
    this.foodWeightDraftNew$$.set(null);
    this.syncDraftWithService();
  }

  protected onChangeWeightInput() {
    this.diaryEntryForm.controls.foodWeightNew.setValue(null);
    this.foodWeightDraftNew$$.set(null);
    this.foodWeightDraftChange$$.set(evaluateWholeAmount(this.foodWeightChangeControl.value));
    this.syncDraftWithService();
  }

  protected onWeightChangeResetClick(): void {
    this.foodWeightChangeControl.setValue(null);
    this.foodWeightDraftChange$$.set(null);
    this.syncDraftWithService();
  }

  public async onSubmit(): Promise<void> {
    const weightIfChange = evaluateWholeAmount(this.foodWeightChangeControl.value);
    const weightIfSet = evaluateWholeAmount(this.foodWeightNewControl.value);

    const foodWeight = weightIfChange ?? (weightIfSet !== null ? weightIfSet - this.foodWeightInitial$$() : 0);

    const historyValue = weightIfChange !== null ? Math.abs(foodWeight) : (weightIfSet ?? 0);

    if (weightIfChange === null) {
      this.historyAction = HistoryEntryAction.SET;
    } else {
      this.historyAction = weightIfChange < 0 ? HistoryEntryAction.SUBTRACT : HistoryEntryAction.ADD;
    }

    const history: HistoryEntry = { action: this.historyAction, value: historyValue };
    this.diaryEntryForm.disable();
    this.foodWeightNewElem().blur();
    this.foodWeightChangeElem().blur();

    const preppedFormValues: DiaryEntry = {
      id: this.diaryEntryForm.getRawValue().id,
      dateISO: this.foodDiaryService.selectedDayIso$$(),
      foodCatalogueId: this.diaryEntry.foodCatalogueId,
      foodWeight: this.foodWeightFinal$$(),
      kcals: 0,
      history: [history],
    };

    await this.foodDiaryService.editDiaryEntry(preppedFormValues);
    this.foodDiaryService.clearDraftEntryWeight(this.diaryEntry.id);
    this.diaryEntryForm.enable();
    this.diaryEntryForm.reset();
    this.onServerSuccessfullEditResponse.emit();
  }

  protected openConfirmationModal(): void {
    this.isDeleteConfirmOpen = true;
  }

  protected closeConfirmationModal(): void {
    this.isDeleteConfirmOpen = false;
  }

  protected onDeleteConfirmed(): void {
    this.deleteDiaryEntry();
    this.isDeleteConfirmOpen = false;
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
    this.diaryEntryForm.disable();
    this.foodDiaryService.clearDraftEntryWeight(this.diaryEntry.id);
    await this.foodDiaryService.deleteDiaryEntry(this.diaryEntryForm.getRawValue().id);
    this.diaryEntryForm.enable();
    this.diaryEntryForm.reset();
    this.onServerSuccessfullEditResponse.emit();
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
    this.foodWeightNewControl.setValue(null);
    this.foodWeightChangeControl.setValue(null);
    this.foodWeightDraftNew$$.set(null);
    this.foodWeightDraftChange$$.set(null);
    this.syncDraftWithService();
  }

  // final === initial whenever there's no genuine in-progress edit (including right after
  // resetForm) — in that case we drop the projection override entirely rather than push a
  // no-op draft, so the counters fall back to the plain server truth.
  private syncDraftWithService(): void {
    const final = this.foodWeightFinal$$();
    if (final === this.foodWeightInitial$$()) {
      this.foodDiaryService.clearDraftEntryWeight(this.diaryEntry.id);
    } else {
      this.foodDiaryService.setDraftEntryWeight(
        this.diaryEntry.dateISO,
        this.diaryEntry.id,
        this.diaryEntry.foodCatalogueId,
        final,
      );
    }
  }

  private closePanels(): void {
    this.disablePanelsAnimationTemporarily = true;
    this.infoPanelElem().setExpanded(false);
    this.chartsPanelElem().setExpanded(false);
    this.historyPanelElem().setExpanded(false);
    setTimeout(() => {
      this.disablePanelsAnimationTemporarily = false;
    }, 100);
  }
}
