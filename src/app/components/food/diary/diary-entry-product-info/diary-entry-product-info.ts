import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { DiaryEntry } from '@app/shared/types';

@Component({
  selector: 'diary-entry-product-info',
  templateUrl: './diary-entry-product-info.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiaryEntryProductInfo {
  public readonly diaryEntry = input.required<DiaryEntry>();

  private readonly foodCatalogueService = inject(FoodCatalogueService);

  protected readonly product$$ = computed(() => {
    const entry = this.diaryEntry();
    return this.foodCatalogueService.catalogue$$()?.[entry.foodCatalogueId] ?? null;
  });

  protected readonly kcalsPer100$$ = computed(() => this.product$$()?.kcals ?? 0);
  protected readonly proteinPer100$$ = computed(() => this.product$$()?.protein ?? 0);
  protected readonly fatPer100$$ = computed(() => this.product$$()?.fat ?? 0);
  protected readonly carbsPer100$$ = computed(() => this.product$$()?.carbs ?? 0);
  protected readonly fiberPer100$$ = computed(() => this.product$$()?.fiber ?? 0);
}
