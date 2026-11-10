import { Component, computed, inject, Signal } from '@angular/core';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { BMI_CATEGORIES, BMI_SCALE, bmiToKg } from '@app/shared/bmi-bands';
import { itemAt } from '@app/shared/utils';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

interface BmiSegment {
  twSegmentClasses: string;
  twLabelClasses?: string | undefined;
}

@Component({
  selector: 'bmi',
  templateUrl: './bmi.html',
  imports: [VIcon],
})
export class BMI {
  protected readonly Icon = IconName;

  protected readonly bmiSegments: BmiSegment[] = BMI_CATEGORIES.map((category, idx) => {
    const roundedClasses = idx === 0 ? 'rounded-l-md' : idx === BMI_CATEGORIES.length - 1 ? 'rounded-r-md' : '';
    return {
      twSegmentClasses: `relative h-2 ${roundedClasses} ${category.twBgClasses}`,
      twLabelClasses: idx === 0 ? undefined : 'absolute left-0 top-[10px] text-sm -translate-x-1/2',
    };
  });

  protected readonly bmiSegmentsWidthFractions: number[] = this.calculateBmiSegmentsWidthFractions();

  protected readonly bmiPointerPercent$$: Signal<number | null> = computed(() => this.calculateBmiPointerPercent());

  private readonly bmiSegmentsThresholdsInKgs$$: Signal<number[]> = computed(() =>
    this.prepBmiSegmentsThresholdsInKgs(),
  );

  private readonly foodDiaryService = inject(FoodDiaryService);

  protected bmiKgThresholdValue(idx: number): number | undefined {
    return this.bmiSegmentsThresholdsInKgs$$()[idx];
  }

  protected bmiSegmentTitle(segmentIdx: number): string {
    const thresholds = this.bmiSegmentsThresholdsInKgs$$();
    const segmentStart = thresholds[segmentIdx];
    const segmentEnd = thresholds[segmentIdx + 1];
    return `${segmentStart} - ${segmentEnd}`;
  }

  private calculateBmiPointerPercent(): number | null {
    const selectedDateISO = this.foodDiaryService.selectedDayIso$$();
    const weight = this.foodDiaryService.diary$$()?.[selectedDateISO]?.totals.bodyWeight ?? 0;

    const bmiKgs = this.bmiSegmentsThresholdsInKgs$$();
    const first = bmiKgs[0];
    const last = bmiKgs.at(-1);
    if (first === undefined || last === undefined) return null;
    if (weight <= first || weight >= last) return null;

    const percentShift = (weight - first) / (last - first);
    return Math.max(0, Math.min(100, percentShift * 100));
  }

  private prepBmiSegmentsThresholdsInKgs(): number[] {
    const height = this.foodDiaryService.height$$();
    if (!height) return [];

    return BMI_SCALE.map((value) => Math.round(bmiToKg(value, height)));
  }

  private calculateBmiSegmentsWidthFractions(): number[] {
    const first = BMI_SCALE[0];
    const last = BMI_SCALE.at(-1);
    if (first === undefined || last === undefined) return [];
    const total = last - first;

    return BMI_SCALE.slice(1).map((end, i) => (end - itemAt(BMI_SCALE, i)) / total);
  }
}
