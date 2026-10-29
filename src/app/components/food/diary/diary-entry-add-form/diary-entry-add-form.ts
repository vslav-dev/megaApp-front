import {
  AfterViewInit,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField, FormRoot, required, validate } from '@angular/forms/signals';
import { FoodAddModalService } from '@app/services/food/food-add-modal.service';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodStatsService } from '@app/services/food/food-stats.service';
import { evaluateWholeAmount, isEmptyOrPositiveWholeAmount } from '@app/shared/amount-expression';
import { DiaryEntry, HistoryEntryAction } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VRollingNumber } from '@ui-kit/components/v-rolling-number/v-rolling-number';
import { UiProgressIcon } from '@ui-kit/progress-icon/progress-icon.component';

@Component({
  selector: 'diary-entry-add-form',
  templateUrl: './diary-entry-add-form.html',
  imports: [FormField, FormRoot, UiProgressIcon, VButton, VIcon, VInput, VRollingNumber],
})
export class DiaryEntryAddForm implements AfterViewInit, OnDestroy {
  protected readonly Icon = IconName;

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

  protected readonly isProductArchived$$ = computed(() =>
    Boolean(this.foodAddModalService.selectedProduct$$()?.archived),
  );

  protected readonly foodWeightInput = viewChild.required(VInput);

  protected readonly foodCatalogueService = inject(FoodCatalogueService);
  protected readonly foodAddModalService = inject(FoodAddModalService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodStatsService = inject(FoodStatsService);

  // Raw text: a number or an expression like "80*2" — evaluated by evaluateWholeAmount.
  private readonly entry$$ = signal({ foodWeight: '' });

  protected readonly diaryEntryForm = form(
    this.entry$$,
    (path) => {
      required(path.foodWeight);
      validate(path.foodWeight, ({ value }) =>
        isEmptyOrPositiveWholeAmount(value()) ? undefined : { kind: 'weightExpression' },
      );
    },
    { submission: { action: () => this.submitForm() } },
  );

  public ngAfterViewInit(): void {
    setTimeout(() => {
      this.foodWeightInput().focus();
    }, 100);
  }

  public ngOnDestroy(): void {
    this.foodDiaryService.clearDraftEntryWeight(null);
  }

  protected onFoodWeightInput(): void {
    const weight = evaluateWholeAmount(this.diaryEntryForm.foodWeight().value()) ?? 0;
    const product = this.foodAddModalService.selectedProduct$$();
    if (product && weight > 0) {
      this.foodDiaryService.setDraftEntryWeight(this.foodDiaryService.selectedDayIso$$(), null, product.id, weight);
    } else {
      this.foodDiaryService.clearDraftEntryWeight(null);
    }
  }

  // The form's submission action: runs only for a valid form, with diaryEntryForm().submitting() true meanwhile.
  private async submitForm(): Promise<void> {
    if (this.isProductArchived$$()) return;

    const foodWeight = evaluateWholeAmount(this.diaryEntryForm.foodWeight().value()) ?? 0;
    const product = this.foodAddModalService.selectedProduct$$();
    if (!product) return;

    const entry: DiaryEntry = {
      id: 0,
      dateISO: this.foodDiaryService.selectedDayIso$$(),
      foodCatalogueId: product.id,
      foodWeight,
      kcals: 0,
      history: [{ action: HistoryEntryAction.INIT, value: foodWeight }],
    };

    const response = await this.foodDiaryService.createDiaryEntry(entry);
    this.foodDiaryService.clearDraftEntryWeight(null);

    if (response?.result && response.diaryId) {
      this.foodAddModalService.submitSuccess();
    }
  }

  protected goBack(): void {
    this.foodAddModalService.goBackToSearch();
  }

  protected editProduct(): void {
    const product = this.foodAddModalService.selectedProduct$$();
    if (!product) return;

    this.foodAddModalService.editProduct(product);
  }
}
