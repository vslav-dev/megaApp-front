import { ChangeDetectionStrategy, Component, computed, inject, OnInit, Signal } from '@angular/core';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { BMI_CATEGORIES, BMI_SCALE, bmiToKg } from '@app/shared/bmi-bands';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

interface BmiSegment {
  twSegmentClasses: string;
  twLabelClasses?: string;
}

@Component({
  selector: 'bmi',
  templateUrl: './bmi.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [VIcon],
})
export class BMI implements OnInit {
  protected readonly Icon = IconName;

  protected readonly bmiSegments: BmiSegment[] = BMI_CATEGORIES.map((category, idx) => {
    const roundedClasses = idx === 0 ? 'rounded-l-md' : idx === BMI_CATEGORIES.length - 1 ? 'rounded-r-md' : '';
    return {
      twSegmentClasses: `relative h-2 ${roundedClasses} ${category.twBgClasses}`,
      twLabelClasses: idx === 0 ? undefined : 'absolute left-0 top-[10px] text-sm -translate-x-1/2',
    };
  });

  protected bmiSegmentsWidthFractions: number[] = [];

  protected readonly bmiPointerPercent$$: Signal<number | null> = computed(() => this.calculateBmiPointerPercent());

  private readonly bmiSegmentsThresholdsInKgs$$: Signal<number[]> = computed(() =>
    this.prepBmiSegmentsThresholdsInKgs(),
  );

  private readonly foodDiaryService = inject(FoodDiaryService);

  public ngOnInit(): void {
    this.bmiSegmentsWidthFractions = this.calculateBmiSegmentsWidthFractions();
  }

  protected bmiKgThresholdValue(idx: number): number {
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

    if (!this.isWeightWithinRange(weight)) return null;

    const bmiKgs = this.bmiSegmentsThresholdsInKgs$$();
    if (bmiKgs.length === 0) return null;

    const percentShift = (weight - bmiKgs[0]) / (bmiKgs[bmiKgs.length - 1] - bmiKgs[0]);
    return Math.max(0, Math.min(100, percentShift * 100));
  }

  private isWeightWithinRange(weight: number): boolean {
    const bmiKgs = this.bmiSegmentsThresholdsInKgs$$();
    return weight > bmiKgs[0] && weight < bmiKgs[bmiKgs.length - 1];
  }

  private prepBmiSegmentsThresholdsInKgs(): number[] {
    const height = this.foodDiaryService.height$$();
    if (!height) return [];

    return BMI_SCALE.map((value) => Math.round(bmiToKg(value, height)));
  }

  private calculateBmiSegmentsWidthFractions(): number[] {
    const fractions: number[] = [];
    const total = BMI_SCALE[BMI_SCALE.length - 1] - BMI_SCALE[0];

    for (let i = 0; i < BMI_SCALE.length - 1; i++) {
      const segment = BMI_SCALE[i + 1] - BMI_SCALE[i];
      fractions.push(segment / total);
    }

    return fractions;
  }
}
