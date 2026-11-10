import { Component, computed, inject, input } from '@angular/core';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { DayTotals, DiaryEntry } from '@app/shared/types';
import { VProgress } from '@ui-kit/components/v-progress/v-progress';

interface NutrientBarState {
  value: number;
  barColor: string;
}

export const NutrientType = {
  Protein: 'protein',
  Fat: 'fat',
  Carbs: 'carbs',
  Fiber: 'fiber',
} as const;

export type NutrientType = (typeof NutrientType)[keyof typeof NutrientType];

@Component({
  selector: 'nutrition-summary',
  templateUrl: './nutrition-summary.html',
  imports: [VProgress],
})
export class NutritionSummary {
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodCatalogueService = inject(FoodCatalogueService);

  protected readonly NutrientType = NutrientType;
  public readonly diaryEntry = input<DiaryEntry | undefined>(undefined);

  protected readonly totals$$ = computed(() => {
    const entry = this.diaryEntry();
    if (entry) {
      return this.calculateEntryTotals(entry);
    }
    return this.foodDiaryService.selectedDayTotals$$();
  });

  private readonly NUTRIENT_KEYS: Record<NutrientType, { consumed: keyof DayTotals; target: keyof DayTotals }> = {
    [NutrientType.Protein]: { consumed: 'consumedProtein', target: 'targetProtein' },
    [NutrientType.Fat]: { consumed: 'consumedFat', target: 'targetFat' },
    [NutrientType.Carbs]: { consumed: 'consumedCarbs', target: 'targetCarbs' },
    [NutrientType.Fiber]: { consumed: 'consumedFiber', target: 'targetFiber' },
  };

  protected readonly proteinBar$$ = computed(() => this.calculateBarState(NutrientType.Protein));
  protected readonly fatBar$$ = computed(() => this.calculateBarState(NutrientType.Fat));
  protected readonly carbsBar$$ = computed(() => this.calculateBarState(NutrientType.Carbs));
  protected readonly fiberBar$$ = computed(() => this.calculateBarState(NutrientType.Fiber));

  protected readonly proteinPercentFormatted$$ = computed(() => this.calculatePercentFormatted(NutrientType.Protein));
  protected readonly fatPercentFormatted$$ = computed(() => this.calculatePercentFormatted(NutrientType.Fat));
  protected readonly carbsPercentFormatted$$ = computed(() => this.calculatePercentFormatted(NutrientType.Carbs));
  protected readonly fiberPercentFormatted$$ = computed(() => this.calculatePercentFormatted(NutrientType.Fiber));

  private calculateBarState(nutrient: NutrientType): NutrientBarState {
    const totals = this.totals$$();
    const { consumed: consumedKey, target: targetKey } = this.NUTRIENT_KEYS[nutrient];

    const consumed = totals[consumedKey] as number;
    const target = totals[targetKey] as number;

    const percent = target > 0 ? (consumed / target) * 100 : 0;

    return {
      value: percent,
      barColor: this.calculateBarColor(percent),
    };
  }

  /**
   * Calculates the progress bar color based on nutrient percentage.
   * - 0-125%: Blue color
   * - 125-200%: Gradient from orange to red
   */
  private calculateBarColor(percent: number): string {
    if (percent <= 125) {
      return `var(--v-color-primary)`;
    } else {
      const redPercent = Math.min(percent - 125, 75);
      return `color-mix(in srgb, var(--v-color-danger) ${redPercent}%, var(--v-color-warning))`;
    }
  }

  private calculatePercentFormatted(nutrient: NutrientType): string {
    const totals = this.totals$$();
    const { consumed: consumedKey, target: targetKey } = this.NUTRIENT_KEYS[nutrient];

    const consumed = totals[consumedKey] as number;
    const target = totals[targetKey] as number;

    if (target === 0) return '0%';

    const percent = Math.round((consumed / target) * 100);
    return `${percent}%`;
  }

  private calculateEntryTotals(entry: DiaryEntry): DayTotals {
    const dayTotals = this.foodDiaryService.selectedDayTotals$$();
    const product = this.foodCatalogueService.catalogue$$()?.[entry.foodCatalogueId];

    if (!product) {
      return {
        kcalsConsumed: 0,
        kcalsPercent: 0,
        bodyWeight: null,
        targetKcals: dayTotals.targetKcals,
        targetProtein: dayTotals.targetProtein,
        targetFat: dayTotals.targetFat,
        targetCarbs: dayTotals.targetCarbs,
        targetFiber: dayTotals.targetFiber,
        consumedProtein: 0,
        consumedFat: 0,
        consumedCarbs: 0,
        consumedFiber: 0,
      };
    }

    const portionMultiplier = entry.foodWeight / 100;

    return {
      kcalsConsumed: entry.kcals,
      kcalsPercent: 0,
      bodyWeight: null,
      targetKcals: dayTotals.targetKcals,
      targetProtein: dayTotals.targetProtein,
      targetFat: dayTotals.targetFat,
      targetCarbs: dayTotals.targetCarbs,
      targetFiber: dayTotals.targetFiber,
      consumedProtein: product.protein * portionMultiplier,
      consumedFat: product.fat * portionMultiplier,
      consumedCarbs: product.carbs * portionMultiplier,
      consumedFiber: product.fiber * portionMultiplier,
    };
  }
}
