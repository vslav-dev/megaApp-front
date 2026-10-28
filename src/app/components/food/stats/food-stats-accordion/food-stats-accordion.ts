import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { FoodStatsBlock, getFoodStatsBlockOrder } from '@app/components/food/stats/food-stats-block';
import { FoodStatsCharts } from '@app/components/food/stats/food-stats-charts/food-stats-charts';
import { Milestones } from '@app/components/food/stats/milestones/milestones';
import { ProductHistory } from '@app/components/food/stats/product-history/product-history';
import { Streak } from '@app/components/food/stats/streak/streak';
import { TopProducts } from '@app/components/food/stats/top-products/top-products';
import { FoodSettingsService } from '@app/services/food/food-settings.service';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

interface BlockToggle {
  block: FoodStatsBlock;
  icon: IconName;
}

const BLOCK_ICONS: Record<FoodStatsBlock, IconName> = {
  [FoodStatsBlock.Streak]: IconName.LocalFireDepartment,
  [FoodStatsBlock.Milestones]: IconName.Verified,
  [FoodStatsBlock.Charts]: IconName.BarChart,
  [FoodStatsBlock.TopProducts]: IconName.ForkChart,
  [FoodStatsBlock.ProductHistory]: IconName.History,
};

// Accordion always renders as a single stacked column.
const BLOCK_TOGGLES: BlockToggle[] = getFoodStatsBlockOrder().map((block) => ({ block, icon: BLOCK_ICONS[block] }));

@Component({
  selector: 'food-stats-accordion',
  templateUrl: './food-stats-accordion.html',
  imports: [VButton, VIcon, Streak, TopProducts, Milestones, FoodStatsCharts, ProductHistory],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodStatsAccordion {
  private readonly foodSettingsService = inject(FoodSettingsService);

  protected readonly Block = FoodStatsBlock;
  protected readonly toggles: BlockToggle[] = BLOCK_TOGGLES;

  private readonly openBlocks$$: Signal<FoodStatsBlock[]> = this.foodSettingsService.statsAccordionOpenBlocks$$;

  protected isOpen(block: FoodStatsBlock): boolean {
    return this.openBlocks$$().includes(block);
  }

  protected toggleBlock(block: FoodStatsBlock): void {
    const current = this.openBlocks$$();
    this.foodSettingsService.setStatsAccordionOpenBlocks(
      current.includes(block) ? current.filter((openBlock) => openBlock !== block) : [...current, block],
    );
  }
}
