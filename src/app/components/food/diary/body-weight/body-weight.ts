import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodSettingsService } from '@app/services/food/food-settings.service';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { BodyWeightInterface } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput, VInputAutoSubmitResult } from '@ui-kit/components/v-input/v-input';

interface BodyWeightForm {
  bodyWeight: FormControl<string | null>;
}

interface HeightForm {
  height: FormControl<string>;
}

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, VInput, VButton, VCheckbox, VIcon, FormModal],
})
export class BodyWeight {
  protected readonly Icon = IconName;

  protected readonly bodyWeightInput = viewChild.required<VInput>('bodyWeightInputElem');
  protected readonly heightInputElem = viewChild<VInput>('heightInputElem');

  protected readonly FormLabels = FormLabels;
  protected readonly FormErrors = FormErrors;

  protected form = new FormGroup<BodyWeightForm>({
    bodyWeight: new FormControl('', {
      validators: [Validators.required, Validators.pattern(/^\d{2,3}([.,]\d)?$/)],
    }),
  });

  protected readonly heightForm = new FormGroup<HeightForm>({
    height: new FormControl('', {
      validators: [Validators.required, Validators.pattern(/^\d{3}$/)],
      nonNullable: true,
    }),
  });

  protected readonly autoSubmitResult$$ = signal<VInputAutoSubmitResult | null>(null);
  protected readonly heightAutoSubmitResult$$ = signal<VInputAutoSubmitResult | null>(null);
  protected readonly isHeightModalOpen$$ = signal(false);

  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodSettingsService = inject(FoodSettingsService);

  // The bands are computed from height, so without it there is nothing to switch.
  protected readonly hasHeight$$ = computed(() => !!this.foodDiaryService.height$$());
  protected readonly isBmiBandsEnabled$$ = this.foodSettingsService.statsWeightBmiBands$$;

  protected get isFormValid(): boolean {
    return this.form.valid || this.form.disabled || this.form.pristine;
  }

  protected get isHeightValid(): boolean {
    return this.heightForm.controls.height.valid || this.heightForm.controls.height.pristine;
  }

  public onAutoSubmit(): void {
    if (!this.form.valid) return;
    this.submitValue();
  }

  private async submitValue(): Promise<void> {
    const selectedDateISO = this.foodDiaryService.selectedDayIso$$();
    const bodyWeightValue = this.form.controls.bodyWeight.value;

    if (!bodyWeightValue) return;

    this.form.disable();

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
      this.form.enable();
      setTimeout(() => this.autoSubmitResult$$.set(null), 1);
    }
  }

  public focusInput(): void {
    this.bodyWeightInput().focus();
  }

  private readonly applyWeightEffect$$ = effect(() => {
    const selectedDateISO = this.foodDiaryService.selectedDayIso$$();
    const weight = this.foodDiaryService.diary$$()?.[selectedDateISO]?.totals.bodyWeight;

    if (!weight) {
      this.form.patchValue({ bodyWeight: null });
      return;
    }

    this.form.patchValue({ bodyWeight: String(weight) });
  });

  public focusIfEmpty(): void {
    const control = this.form.controls.bodyWeight;
    if (!control.value || control.value === '') {
      setTimeout(() => {
        this.bodyWeightInput().focus();
      }, 100); // Waiting for expansion panel to open
    }
  }

  protected openHeightModal(): void {
    const height = this.foodDiaryService.height$$();
    this.heightForm.patchValue({ height: height ? String(height) : '' }, { emitEvent: false });
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
    if (!this.heightForm.controls.height.valid) return;
    this.foodDiaryService.setHeight(Number(this.heightForm.controls.height.value));
    this.heightAutoSubmitResult$$.set(VInputAutoSubmitResult.Success);
    setTimeout(() => this.heightAutoSubmitResult$$.set(null), 1);
  }
}
