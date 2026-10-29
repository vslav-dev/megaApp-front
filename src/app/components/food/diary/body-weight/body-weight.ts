import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { form, FormField, FormRoot, pattern, required } from '@angular/forms/signals';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodSettingsService } from '@app/services/food/food-settings.service';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { BodyWeightInterface } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput, VInputAutoSubmitResult } from '@ui-kit/components/v-input/v-input';

const WEIGHT_PATTERN = /^\d{2,3}([.,]\d)?$/;
const HEIGHT_PATTERN = /^\d{3}$/;

const FormLabels = {
  WEIGHT: 'Вес',
  WEIGHT_UNIT: 'кг',
  HEIGHT: 'Рост',
  HEIGHT_UNIT: 'см',
} as const;

const FormErrors = {
  WEIGHT: 'ХХ.Х или ХХ',
  HEIGHT: 'XXX',
} as const;

@Component({
  selector: 'body-weight',
  templateUrl: './body-weight.html',
  imports: [FormField, FormRoot, VInput, VButton, VCheckbox, VIcon, FormModal],
})
export class BodyWeight {
  protected readonly Icon = IconName;

  protected readonly bodyWeightInput = viewChild.required<VInput>('bodyWeightInputElem');
  protected readonly heightInputElem = viewChild<VInput>('heightInputElem');

  protected readonly FormLabels = FormLabels;
  protected readonly FormErrors = FormErrors;

  private readonly weight$$ = signal({ bodyWeight: '' });
  private readonly height$$ = signal({ height: '' });

  protected readonly weightForm = form(this.weight$$, (path) => {
    required(path.bodyWeight);
    pattern(path.bodyWeight, WEIGHT_PATTERN, { message: FormErrors.WEIGHT });
  });

  protected readonly heightForm = form(this.height$$, (path) => {
    required(path.height, { message: FormErrors.HEIGHT });
    pattern(path.height, HEIGHT_PATTERN, { message: FormErrors.HEIGHT });
  });

  protected readonly autoSubmitResult$$ = signal<VInputAutoSubmitResult | null>(null);
  protected readonly heightAutoSubmitResult$$ = signal<VInputAutoSubmitResult | null>(null);
  protected readonly isHeightModalOpen$$ = signal(false);

  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodSettingsService = inject(FoodSettingsService);

  // The bands are computed from height, so without it there is nothing to switch.
  protected readonly hasHeight$$ = computed(() => !!this.foodDiaryService.height$$());
  protected readonly isBmiBandsEnabled$$ = this.foodSettingsService.statsWeightBmiBands$$;

  public onAutoSubmit(): void {
    if (this.weightForm().invalid()) return;
    void this.submitValue();
  }

  private async submitValue(): Promise<void> {
    const selectedDateISO = this.foodDiaryService.selectedDayIso$$();
    const bodyWeightValue = this.weightForm.bodyWeight().value();

    if (!bodyWeightValue) return;

    try {
      const normalizedBodyWeight = String(bodyWeightValue).replace(',', '.');
      const bodyWeight: BodyWeightInterface = {
        bodyWeight: normalizedBodyWeight,
        dateISO: selectedDateISO,
      };

      const result = await this.foodDiaryService.setUserBodyWeight(bodyWeight);

      if (!result) throw new Error();

      this.autoSubmitResult$$.set(VInputAutoSubmitResult.Success);
      this.bodyWeightInput().blur();
    } catch {
      this.autoSubmitResult$$.set(VInputAutoSubmitResult.Error);
    } finally {
      setTimeout(() => this.autoSubmitResult$$.set(null), 1);
    }
  }

  public focusInput(): void {
    this.bodyWeightInput().focus();
  }

  private readonly applyWeightEffect$$ = effect(() => {
    const selectedDateISO = this.foodDiaryService.selectedDayIso$$();
    const weight = this.foodDiaryService.diary$$()?.[selectedDateISO]?.totals.bodyWeight;

    this.weight$$.set({ bodyWeight: weight ? String(weight) : '' });
  });

  public focusIfEmpty(): void {
    if (!this.weightForm.bodyWeight().value()) {
      setTimeout(() => {
        this.bodyWeightInput().focus();
      }, 100); // Waiting for expansion panel to open
    }
  }

  protected openHeightModal(): void {
    const height = this.foodDiaryService.height$$();
    this.height$$.set({ height: height ? String(height) : '' });
    this.isHeightModalOpen$$.set(true);
  }

  protected onBmiBandsChange(isEnabled: boolean): void {
    this.foodSettingsService.setStatsWeightBmiBands(isEnabled);
  }

  protected closeHeightModal(): void {
    this.isHeightModalOpen$$.set(false);
  }

  protected focusHeightInput(): void {
    this.heightInputElem()?.focus();
  }

  protected onHeightAutoSubmit(): void {
    if (this.heightForm.height().invalid()) return;
    this.foodDiaryService.setHeight(Number(this.heightForm.height().value()));
    this.heightAutoSubmitResult$$.set(VInputAutoSubmitResult.Success);
    setTimeout(() => this.heightAutoSubmitResult$$.set(null), 1);
  }
}
