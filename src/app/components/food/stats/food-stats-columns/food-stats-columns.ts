import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FoodStatsBlock, getFoodStatsColumns } from '@app/components/food/stats/food-stats-block';
import { FoodStatsCharts } from '@app/components/food/stats/food-stats-charts/food-stats-charts';
import { Milestones } from '@app/components/food/stats/milestones/milestones';
import { ProductHistory } from '@app/components/food/stats/product-history/product-history';
import { Streak } from '@app/components/food/stats/streak/streak';
import { TopProducts } from '@app/components/food/stats/top-products/top-products';

@Component({
  selector: 'food-stats-columns',
  templateUrl: './food-stats-columns.html',
  imports: [Streak, TopProducts, Milestones, FoodStatsCharts, ProductHistory],
  host: {
    class: 'contents',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodStatsColumns {
  public readonly columnCountInput = input.required<number>();
  // Grid column (1-based) for each stats column, in the same order as columnCountInput's columns —
  // set by food-screen so stats columns can land on either side of the diary column.
  public readonly gridColumnsInput = input.required<number[]>();

  protected readonly Block = FoodStatsBlock;

  protected readonly columns$$ = computed<FoodStatsBlock[][]>(() => getFoodStatsColumns(this.columnCountInput()));
}
