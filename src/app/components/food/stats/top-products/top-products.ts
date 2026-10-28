import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatsHelpIcon } from '@app/components/food/stats/stats-help-icon/stats-help-icon';
import { FoodCatalogueService } from '@app/services/food/food-catalogue.service';
import { FoodSettingsService, TopProductsMetric } from '@app/services/food/food-settings.service';
import { FoodStatsInsightsService, FoodStatsTopProductShare } from '@app/services/food/food-stats-insights.service';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VProgress } from '@ui-kit/components/v-progress/v-progress';
import { VToggle, VToggleItem } from '@ui-kit/components/v-toggle/v-toggle';

@Component({
  selector: 'food-stats-top-products',
  templateUrl: './top-products.html',
  imports: [VCard, StatsHelpIcon, VToggle, VProgress],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopProducts {
  private readonly foodCatalogueService = inject(FoodCatalogueService);
  private readonly insightsService = inject(FoodStatsInsightsService);
  private readonly foodSettingsService = inject(FoodSettingsService);

  protected readonly metricToggleItems: VToggleItem[] = [
    { id: TopProductsMetric.Kcal, label: 'По калориям' },
    { id: TopProductsMetric.Weight, label: 'По весу' },
  ];

  protected readonly metric$$: Signal<TopProductsMetric> = computed(() =>
    this.foodSettingsService.statsTopProductsMetric$$(),
  );

  // The archive flag comes from the local catalogue by id — the stats response doesn't carry it.
  protected readonly products$$: Signal<(FoodStatsTopProductShare & { isArchived: boolean })[]> = computed(() => {
    const catalogue = this.foodCatalogueService.catalogue$$();
    const products =
      this.metric$$() === TopProductsMetric.Kcal
        ? this.insightsService.topProductsByKcalWithShare$$()
        : this.insightsService.topProductsByWeightWithShare$$();
    return products.map((product) => ({ ...product, isArchived: Boolean(catalogue[product.catalogueId]?.archived) }));
  });

  protected metricToggleValue(): string[] {
    return [this.metric$$()];
  }

  protected onMetricToggleChange(value: string[]): void {
    const metric = value[0] === TopProductsMetric.Weight ? TopProductsMetric.Weight : TopProductsMetric.Kcal;
    this.foodSettingsService.setStatsTopProductsMetric(metric);
  }

  // Bar width is relative to the top product's value for the active metric (not an absolute % of
  // the day) — the list is already sorted descending by that metric, so products()[0] is the max.
  protected barWidthPercent(product: FoodStatsTopProductShare): number {
    const products = this.products$$();
    const maxValue = products.length > 0 ? this.metricValue(products[0]) : 0;
    if (maxValue <= 0) return 0;
    return Math.round((this.metricValue(product) / maxValue) * 100);
  }

  private metricValue(product: FoodStatsTopProductShare): number {
    return this.metric$$() === TopProductsMetric.Kcal ? product.kcal : product.weight;
  }
}
