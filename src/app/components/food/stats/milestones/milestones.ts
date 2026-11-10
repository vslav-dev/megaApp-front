import { Component, inject, Signal } from '@angular/core';
import { StatsHelpIcon } from '@app/components/food/stats/stats-help-icon/stats-help-icon';
import { FoodScreenModeService } from '@app/services/food/food-screen-mode.service';
import { FoodStatsInsightsService, FoodStatsMilestones } from '@app/services/food/food-stats-insights.service';
import { formatDateTicks, getRuDeclension } from '@app/shared/utils';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VCard } from '@ui-kit/components/v-card/v-card';

@Component({
  selector: 'food-stats-milestones',
  templateUrl: './milestones.html',
  styleUrl: './milestones.scss',
  imports: [VCard, StatsHelpIcon, VButton, VIcon],
})
export class Milestones {
  private readonly insightsService = inject(FoodStatsInsightsService);
  private readonly foodScreenModeService = inject(FoodScreenModeService);

  protected readonly milestones$$: Signal<FoodStatsMilestones> = this.insightsService.milestones$$;
  protected readonly Icon = IconName;

  protected formatDate(dateIso: string): string {
    return formatDateTicks(dateIso);
  }

  protected goToDate(dateIso: string): void {
    this.foodScreenModeService.showDiaryDay(dateIso);
  }

  protected daysLabel(days: number): string {
    return getRuDeclension(days, 'день', 'дня', 'дней');
  }

  protected entriesLabel(count: number): string {
    return getRuDeclension(count, 'запись', 'записи', 'записей');
  }

  protected deltaColor(deltaKg: number): string {
    return deltaKg <= 0 ? 'var(--v-color-success)' : 'var(--v-color-danger)';
  }
}
