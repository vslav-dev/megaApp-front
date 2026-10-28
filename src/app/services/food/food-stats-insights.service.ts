import { computed, inject, Service, Signal } from '@angular/core';
import { FoodStatsService } from '@app/services/food/food-stats.service';
import { FoodDayBand, isFoodStreakSuccessBand, resolveFoodDayBand } from '@app/shared/food-day-band';
import { FoodStatsSummary, FoodStatsTopProduct } from '@app/shared/types';

export interface FoodStatsRibbonDay {
  dateIso: string;
  band: FoodDayBand;
  hasNoData: boolean;
}

export interface FoodStatsStreak {
  current: number;
  record: number;
}

export interface FoodStatsTopProductShare extends FoodStatsTopProduct {
  sharePercent: number;
}

// FoodStatsSummary (backend all-time aggregate, §"Находки в эксплуатации" of plan 28) plus
// totalEntries, which stays a separate top-level field on FoodStatsResponse rather than part of
// Summary.
export interface FoodStatsMilestones extends FoodStatsSummary {
  totalEntries: number;
}

interface DayPoint {
  dateIso: string;
  weight: number;
  consumedKcal: number;
  targetKcal: number;
  hasNoData: boolean;
}

interface StreakStats {
  current: number;
  record: number;
}

const RIBBON_WINDOW_DAYS = 30;

@Service()
export class FoodStatsInsightsService {
  private readonly foodStatsService = inject(FoodStatsService);

  public readonly totalEntries$$: Signal<number> = this.foodStatsService.totalEntries$$;

  private readonly allDays$$: Signal<DayPoint[]> = computed(() => {
    const data = this.foodStatsService.statsChartData$$();
    return data.dates.map((dateIso, index) => ({
      dateIso,
      weight: data.weights[index],
      consumedKcal: data.kcalsFactual[index],
      targetKcal: data.kcalsTarget[index],
      hasNoData: data.hasNoData[index],
    }));
  });

  // Today is always the last entry (backend always includes it, even with zero consumption) and
  // is excluded everywhere "completed days" are needed — it hasn't finished yet, so its band
  // isn't a fair success/failure verdict.
  private readonly completedDays$$: Signal<DayPoint[]> = computed(() => this.allDays$$().slice(0, -1));

  private readonly ribbonWindowDays$$: Signal<DayPoint[]> = computed(() => this.completedDays$$().slice(-RIBBON_WINDOW_DAYS));

  public readonly ribbon30$$: Signal<FoodStatsRibbonDay[]> = computed(() =>
    this.ribbonWindowDays$$().map((day) => ({
      dateIso: day.dateIso,
      band: resolveFoodDayBand(day.consumedKcal, day.targetKcal),
      hasNoData: day.hasNoData,
    })),
  );

  // Share percent divides each product's absolute kcal/weight by the matching window total the
  // backend computed over the same trailing-30-completed-days window (not an all-time total), so
  // it always sums close to 100% across the returned top-10 for whichever metric is active.
  public readonly topProductsByKcalWithShare$$: Signal<FoodStatsTopProductShare[]> = computed(() =>
    this.withSharePercent(
      this.foodStatsService.topProductsByKcal$$(),
      this.foodStatsService.topProductsWindowTotalKcal$$(),
      (product) => product.kcal,
    ),
  );

  public readonly topProductsByWeightWithShare$$: Signal<FoodStatsTopProductShare[]> = computed(() =>
    this.withSharePercent(
      this.foodStatsService.topProductsByWeight$$(),
      this.foodStatsService.topProductsWindowTotalWeight$$(),
      (product) => product.weight,
    ),
  );

  private withSharePercent(
    products: FoodStatsTopProduct[],
    windowTotal: number,
    valueOf: (product: FoodStatsTopProduct) => number,
  ): FoodStatsTopProductShare[] {
    if (windowTotal <= 0) return products.map((product) => ({ ...product, sharePercent: 0 }));
    return products.map((product) => ({
      ...product,
      sharePercent: this.roundTo((valueOf(product) / windowTotal) * 100, 0),
    }));
  }

  private readonly streakStats$$: Signal<StreakStats> = computed(() => this.computeStreakStats(this.completedDays$$()));

  public readonly streak$$: Signal<FoodStatsStreak> = computed(() => {
    const stats = this.streakStats$$();
    return { current: stats.current, record: stats.record };
  });

  // Plain pass-through of the backend's all-time aggregate (§"Находки в эксплуатации" of plan 28) —
  // correct in every /api/food/stats response regardless of the requested window, unlike the
  // client-side reduction over allDays$$ this replaced, which was silently wrong/incomplete
  // whenever only the default 90-day window had been loaded.
  public readonly milestones$$: Signal<FoodStatsMilestones> = computed(() => ({
    ...this.foodStatsService.summary$$(),
    totalEntries: this.foodStatsService.totalEntries$$(),
  }));

  // A day keeps the streak alive unless it was skipped entirely (no diary entries logged) or the
  // user went over target — being under target still counts, since undereating isn't a failure.
  private isStreakSuccessDay(day: DayPoint): boolean {
    return !day.hasNoData && isFoodStreakSuccessBand(resolveFoodDayBand(day.consumedKcal, day.targetKcal));
  }

  private computeStreakStats(days: DayPoint[]): StreakStats {
    let current = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (!this.isStreakSuccessDay(days[i])) break;
      current++;
    }

    let record = 0;
    let running = 0;
    for (const day of days) {
      if (!this.isStreakSuccessDay(day)) {
        running = 0;
        continue;
      }
      running++;
      record = Math.max(record, running);
    }

    return { current, record };
  }

  private roundTo(value: number, places: number): number {
    const multiplier = Math.pow(10, places);
    return Math.round(value * multiplier) / multiplier;
  }
}
