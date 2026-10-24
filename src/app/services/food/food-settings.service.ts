import { computed, Injectable, Signal } from '@angular/core';
import { FoodStatsBlock, getFoodStatsBlockOrder } from '@app/components/food/stats/food-stats-block';
import { NamespaceSettingsStore } from '@app/services/settings/namespace-settings-store';

export const TopProductsMetric = {
  Kcal: 'kcal',
  Weight: 'weight',
} as const;
export type TopProductsMetric = (typeof TopProductsMetric)[keyof typeof TopProductsMetric];

export interface SavedDateRange {
  start: string;
  end: string;
}

interface FoodSettings {
  height: number | null;
  statsDateRange: SavedDateRange | null;
  statsTopProductsMetric: TopProductsMetric;
  statsAccordionOpenBlocks: FoodStatsBlock[];
  statsWeightBmiBands: boolean;
}

const DEFAULT_FOOD_SETTINGS: FoodSettings = {
  height: null,
  statsDateRange: null,
  statsTopProductsMetric: TopProductsMetric.Kcal,
  statsAccordionOpenBlocks: getFoodStatsBlockOrder(),
  statsWeightBmiBands: true,
};

// Sole owner of the `food` namespace store — every food-domain server setting (diary height,
// stats range/metric/accordion state) reads and writes through here, never through a second
// NamespaceSettingsStore('food', ...) instance.
@Injectable({
  providedIn: 'root',
})
export class FoodSettingsService {
  private readonly settingsStore = new NamespaceSettingsStore<FoodSettings>('food', DEFAULT_FOOD_SETTINGS);

  public readonly height$$: Signal<number | null> = computed(() => this.settingsStore.value$$().height);
  public readonly statsDateRange$$: Signal<SavedDateRange | null> = computed(
    () => this.settingsStore.value$$().statsDateRange,
  );
  public readonly statsTopProductsMetric$$: Signal<TopProductsMetric> = computed(
    () => this.settingsStore.value$$().statsTopProductsMetric,
  );
  public readonly statsAccordionOpenBlocks$$: Signal<FoodStatsBlock[]> = computed(
    () => this.settingsStore.value$$().statsAccordionOpenBlocks,
  );
  public readonly statsWeightBmiBands$$: Signal<boolean> = computed(
    () => this.settingsStore.value$$().statsWeightBmiBands,
  );

  public ready(): Promise<void> {
    return this.settingsStore.ready();
  }

  public setHeight(height: number | null): void {
    this.settingsStore.set('height', height);
  }

  public setStatsDateRange(range: SavedDateRange | null): void {
    this.settingsStore.set('statsDateRange', range);
  }

  public setStatsTopProductsMetric(metric: TopProductsMetric): void {
    this.settingsStore.set('statsTopProductsMetric', metric);
  }

  public setStatsAccordionOpenBlocks(blocks: FoodStatsBlock[]): void {
    this.settingsStore.set('statsAccordionOpenBlocks', blocks);
  }

  public setStatsWeightBmiBands(isEnabled: boolean): void {
    this.settingsStore.set('statsWeightBmiBands', isEnabled);
  }

  public reset(): void {
    this.settingsStore.reset();
  }
}
