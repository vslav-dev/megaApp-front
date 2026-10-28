import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { StatsHelpIcon } from '@app/components/food/stats/stats-help-icon/stats-help-icon';
import { FoodDiaryService } from '@app/services/food/food-diary.service';
import { FoodScreenMobileTab, FoodScreenModeService } from '@app/services/food/food-screen-mode.service';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Milestones {
  private readonly insightsService = inject(FoodStatsInsightsService);
  private readonly foodDiaryService = inject(FoodDiaryService);
  private readonly foodScreenModeService = inject(FoodScreenModeService);

  protected readonly milestones$$: Signal<FoodStatsMilestones> = this.insightsService.milestones$$;
  protected readonly Icon = IconName;

  protected formatDate(dateIso: string): string {
    return formatDateTicks(dateIso);
  }

  // Jumps the diary to a record's date, same as picking it in the calendar. On the single-column
  // mobile layout, diary and stats are two tabs of the same screen (FoodScreenModeService) — also
  // switch to the diary tab so the jump is actually visible instead of landing behind the stats tab.
  protected goToDate(dateIso: string): void {
    this.foodDiaryService.selectedDayIso$$.set(dateIso);
    if (this.foodScreenModeService.isSingleColumnLayout$$()) {
      this.foodScreenModeService.mobileTab$$.set(FoodScreenMobileTab.Diary);
    }
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
