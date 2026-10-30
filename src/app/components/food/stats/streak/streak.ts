import { Component, computed, inject, Signal } from '@angular/core';
import { StatsHelpIcon } from '@app/components/food/stats/stats-help-icon/stats-help-icon';
import { FoodScreenModeService } from '@app/services/food/food-screen-mode.service';
import { FoodStatsInsightsService, FoodStatsStreak } from '@app/services/food/food-stats-insights.service';
import { foodTodayIso } from '@app/shared/food-day';
import {
  FOOD_DAY_BAND_COLOR_VAR,
  FOOD_DAY_BAND_LABEL,
  FOOD_DAY_BAND_RANGE_LABEL,
  FOOD_DAY_BAND_TEXT_COLOR_VAR,
  FoodDayBand,
} from '@app/shared/food-day-band';
import { formatDateTicks, getRuDeclension, parseIsoParts } from '@app/shared/utils';
import { VCard } from '@ui-kit/components/v-card/v-card';

interface CalendarCell {
  dateIso: string;
  band: FoodDayBand | null;
  isToday: boolean;
  hasNoData: boolean;
}

@Component({
  selector: 'food-stats-streak',
  templateUrl: './streak.html',
  imports: [VCard, StatsHelpIcon],
})
export class Streak {
  protected readonly BandLabel = FOOD_DAY_BAND_LABEL;
  protected readonly BandRangeLabel = FOOD_DAY_BAND_RANGE_LABEL;
  protected readonly legendBands: FoodDayBand[] = [
    FoodDayBand.Under,
    FoodDayBand.Normal,
    FoodDayBand.SlightOver,
    FoodDayBand.Over,
  ];

  private readonly insightsService = inject(FoodStatsInsightsService);
  private readonly foodScreenModeService = inject(FoodScreenModeService);

  protected readonly streak$$: Signal<FoodStatsStreak> = this.insightsService.streak$$;

  // Front-padded with nulls so the first real day lands in its correct Mon..Sun column,
  // making full weeks (rows of 7) read as actual calendar weeks.
  protected readonly calendarCells$$: Signal<(CalendarCell | null)[]> = computed(() => {
    const completedDays = this.insightsService.ribbon30$$();
    const todayIso = foodTodayIso();
    const cells: CalendarCell[] = [
      ...completedDays.map((day) => ({ dateIso: day.dateIso, band: day.band, isToday: false, hasNoData: day.hasNoData })),
      { dateIso: todayIso, band: null, isToday: true, hasNoData: false },
    ];
    const padding = Array<null>(this.mondayIndex(completedDays[0]?.dateIso ?? todayIso)).fill(null);
    return [...padding, ...cells];
  });

  protected goToDay(dateIso: string): void {
    this.foodScreenModeService.showDiaryDay(dateIso);
  }

  protected daysLabel(days: number): string {
    return getRuDeclension(days, 'день', 'дня', 'дней');
  }

  protected cellColor(band: FoodDayBand): string {
    return FOOD_DAY_BAND_COLOR_VAR[band];
  }

  protected cellTextColor(band: FoodDayBand): string {
    return FOOD_DAY_BAND_TEXT_COLOR_VAR[band];
  }

  protected dayNumber(dateIso: string): number {
    return Number(dateIso.slice(8, 10));
  }

  protected cellTitle(cell: CalendarCell): string {
    if (cell.isToday) return `${formatDateTicks(cell.dateIso)} — сегодня`;
    if (cell.hasNoData) return `${formatDateTicks(cell.dateIso)} — день не заполнен`;
    return `${formatDateTicks(cell.dateIso)} — ${FOOD_DAY_BAND_LABEL[cell.band!]}`;
  }

  // Sun=0..Sat=6 -> Mon=0..Sun=6.
  private mondayIndex(dateIso: string): number {
    const [year, month, day] = parseIsoParts(dateIso);
    const sundayIndex = new Date(year, month - 1, day).getDay();
    return (sundayIndex + 6) % 7;
  }
}
