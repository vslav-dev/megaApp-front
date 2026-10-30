import { Component, computed, inject } from '@angular/core';
import { StatsHelpIcon } from '@app/components/food/stats/stats-help-icon/stats-help-icon';
import { FoodAddModalService } from '@app/services/food/food-add-modal.service';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import {
  FoodProductHistoryStateService,
  MAX_TRACKED_PRODUCTS,
} from '@app/services/food/food-product-history-state.service';
import { FoodScreenMobileTab, FoodScreenModeService } from '@app/services/food/food-screen-mode.service';
import { formatDateTicks } from '@app/shared/utils';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VChip } from '@ui-kit/components/v-chip/v-chip';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

interface ProductHistoryRow {
  dateIso: string;
  dateLabel: string;
  productName: string;
  isProductArchived: boolean;
  foodWeight: number;
  percentOfNorm: number;
}

// State (tracked products, loaded entries) lives in the root FoodProductHistoryStateService, not
// here — this component is remounted on every layout-form change (mobile diary↔stats toggle, stats
// 2↔3 column boundary, see plan 31), and a component-local signal would be wiped on each remount.
// The same state feeds the calories chart (see plan 46).
@Component({
  selector: 'food-stats-product-history',
  templateUrl: './product-history.html',
  styleUrl: './product-history.scss',
  imports: [VCard, VButton, VIcon, VChip, StatsHelpIcon],
})
export class ProductHistory {
  protected readonly Icon = IconName;

  protected readonly state = inject(FoodProductHistoryStateService);
  protected readonly trackedProducts$$ = this.state.trackedProducts$$;
  protected readonly isLoading$$ = this.state.isLoading$$;
  protected readonly error$$ = this.state.error$$;
  protected readonly isLimitReached$$ = this.state.isLimitReached$$;
  protected readonly maxTrackedProducts = MAX_TRACKED_PRODUCTS;

  protected readonly showProductColumn$$ = computed(() => this.trackedProducts$$().length > 1);

  // Display strings are built once per data change here, not per row on every change detection pass.
  protected readonly rows$$ = computed<ProductHistoryRow[]>(() => {
    const productById = this.state.productById$$();
    return this.state.entries$$().map((entry) => {
      const product = productById.get(entry.foodCatalogueId);
      return {
        dateIso: entry.dateISO,
        dateLabel: formatDateTicks(entry.dateISO),
        productName: product?.name ?? '',
        isProductArchived: Boolean(product?.archived),
        foodWeight: entry.foodWeight,
        percentOfNorm: entry.percentOfNorm,
      };
    });
  });

  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodScreenModeService = inject(FoodScreenModeService);
  private readonly foodAddModalService = inject(FoodAddModalService);

  protected openPicker(): void {
    this.foodAddModalService.openForProductSelection((product) => this.state.addProduct(product));
  }

  protected goToDate(dateIso: string): void {
    this.foodDiaryService.selectedDayIso$$.set(dateIso);
    if (this.foodScreenModeService.isSingleColumnLayout$$()) {
      this.foodScreenModeService.mobileTab$$.set(FoodScreenMobileTab.Diary);
    }
  }
}
