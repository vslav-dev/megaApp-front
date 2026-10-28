import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { StatsHelpIcon } from '@app/components/food/stats/stats-help-icon/stats-help-icon';
import { ChartThemeService } from '@app/services/chart-theme.service';
import { DeviceInfoService } from '@app/services/device-info.service';
import { FoodProductHistoryStateService } from '@app/services/food/food-product-history-state.service';
import { FoodSettingsService } from '@app/services/food/food-settings.service';
import { FoodStatsService } from '@app/services/food/food-stats.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { ANIMATION_DURATION_MS } from '@app/shared/animations';
import { BmiBand, buildBmiBands } from '@app/shared/bmi-bands';
import {
  ChartColors,
  FOOD_STATS_MONTH_LABELS_PADDING,
  MonthLabelsPluginOptions,
  createKcalsChartConfig,
  createWeightChartConfig,
  selectedProductsColor,
} from '@app/shared/chart-config';
import { splitKcalsBySelection } from '@app/shared/stats-chart-data';
import { StatsChartData } from '@app/shared/types';
import { formatDateTicks, getRuDeclension } from '@app/shared/utils';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VSlider, VSliderRangeValue } from '@ui-kit/components/v-slider/v-slider';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  Plugin,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarController,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

/**
 * Food stats charts flow:
 * - Raw daily stats are loaded into a service and transformed into full and clipped datasets.
 * - The slider range and range buttons update start/end indices immediately; labels and day count are derived from those indices.
 * - Slider positions are based on the date index list to snap selection to existing days.
 * - Charts are updated from clipped datasets; updates are throttled with a trailing flush so the final fast-drag state is rendered.
 * - Calories of the products tracked in the product history come as their own series (kcalsSelected, a part of
 *   kcalsFactual) and are drawn as the base of the calorie bars; the rest of the day sits above it.
 * - Lite mode only toggles kcal axis ticks and tooltip visibility, without changing data.
 * - Charts are created once and then kept in sync through reactive updates.
 */
@Component({
  selector: 'food-stats-charts',
  templateUrl: './food-stats-charts.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VButton, VCard, VSlider, StatsHelpIcon],
})
export class FoodStatsCharts implements OnInit, AfterViewInit, OnDestroy {
  protected readonly weightChartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('weightChartCanvas');
  protected readonly kcalsChartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('kcalsChartCanvas');

  protected readonly weightChart$$ = signal<Chart | null>(null);
  protected readonly kcalsChart$$ = signal<Chart | null>(null);

  private readonly dates$$ = computed(() => this.foodStatsService.statsChartData$$().dates);
  private readonly monthLabelsPadding = FOOD_STATS_MONTH_LABELS_PADDING;
  private readonly monthLabelsFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
  private readonly shortMonthLabelsFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'short' });
  private readonly yearLabelsFormatter = new Intl.DateTimeFormat('ru-RU', { year: 'numeric' });
  private readonly chartThemeService = inject(ChartThemeService);
  private monthLabelsOptions: MonthLabelsPluginOptions = this.chartThemeService.monthLabelsOptions$$();

  private readonly monthLabelsPlugin: Plugin = {
    id: 'foodStatsMonthLabels',
    // The month/year separator runs the full chart-area height, so — unlike the rest of
    // this plugin, which lives below the plot area near the axis labels — it visually
    // crosses the data line. Drawn here, before the dataset, it sits under the line the
    // same way the built-in grid does; the matching legend-tick + everything else stays
    // in afterDraw below, since none of that overlaps the line regardless of draw order.
    beforeDatasetsDraw: (chart: Chart, _args: unknown, options: unknown) => {
      const labels = chart.data.labels;
      if (!labels || labels.length === 0) return;
      if (!labels.every((label) => typeof label === 'string')) return;

      const xScale = chart.scales['x'];
      if (!xScale) return;

      const { ctx, chartArea } = chart;
      const pluginOptions = (options as MonthLabelsPluginOptions | undefined) ?? this.monthLabelsOptions;
      const groups = this.buildTimeGroups(
        labels as string[],
        pluginOptions.shortMonthSwitchMonths,
        pluginOptions.yearSwitchMonths,
      );
      if (groups.length < 2) return;

      ctx.save();
      ctx.strokeStyle = pluginOptions.separatorColorChart;
      ctx.lineWidth = pluginOptions.separatorWidth;
      for (let i = 0; i < groups.length - 1; i += 1) {
        const current = groups[i];
        const next = groups[i + 1];
        const currentEnd = xScale.getPixelForTick(current.endIndex);
        const nextStart = xScale.getPixelForTick(next.startIndex);
        const separatorX = Math.round((currentEnd + nextStart) / 2) + 0.5;
        ctx.beginPath();
        ctx.moveTo(separatorX, chartArea.top);
        ctx.lineTo(separatorX, chartArea.bottom);
        ctx.stroke();
      }
      ctx.restore();
    },
    afterDraw: (chart: Chart, _args: unknown, options: unknown) => {
      const labels = chart.data.labels;
      if (!labels || labels.length === 0) return;
      if (!labels.every((label) => typeof label === 'string')) return;

      const xScale = chart.scales['x'];
      if (!xScale) return;

      const { ctx, chartArea } = chart;
      const pluginOptions = (options as MonthLabelsPluginOptions | undefined) ?? this.monthLabelsOptions;
      const groups = this.buildTimeGroups(
        labels as string[],
        pluginOptions.shortMonthSwitchMonths,
        pluginOptions.yearSwitchMonths,
      );
      if (groups.length === 0) return;
      const lineY = chartArea.bottom + pluginOptions.lineOffset;

      ctx.save();
      ctx.strokeStyle = pluginOptions.lineColor;
      ctx.lineWidth = pluginOptions.lineWidth;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, lineY);
      ctx.lineTo(chartArea.right, lineY);
      ctx.stroke();

      ctx.strokeStyle = pluginOptions.segmentColor;
      ctx.lineWidth = pluginOptions.segmentWidth;
      groups.forEach((group) => {
        const startX = xScale.getPixelForTick(group.startIndex);
        const endX = xScale.getPixelForTick(group.endIndex);
        ctx.beginPath();
        ctx.moveTo(startX, lineY);
        ctx.lineTo(endX, lineY);
        ctx.stroke();
      });

      if (groups.length > 1) {
        ctx.strokeStyle = pluginOptions.separatorColorLegend;
        ctx.lineWidth = pluginOptions.separatorWidth;
        for (let i = 0; i < groups.length - 1; i += 1) {
          const current = groups[i];
          const next = groups[i + 1];
          const currentEnd = xScale.getPixelForTick(current.endIndex);
          const nextStart = xScale.getPixelForTick(next.startIndex);
          const separatorX = Math.round((currentEnd + nextStart) / 2) + 0.5;
          ctx.beginPath();
          ctx.moveTo(separatorX, lineY - pluginOptions.separatorHeight / 2);
          ctx.lineTo(separatorX, lineY + pluginOptions.separatorHeight / 2);
          ctx.stroke();
        }
      }

      ctx.fillStyle = pluginOptions.labelColor;
      ctx.font = pluginOptions.labelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      groups.forEach((group) => {
        const startX = xScale.getPixelForTick(group.startIndex);
        const endX = xScale.getPixelForTick(group.endIndex);
        const segmentWidth = Math.abs(endX - startX);
        const textWidth = ctx.measureText(group.label).width;
        const minLabelWidth = textWidth + pluginOptions.labelPadding * 2;
        if (groups.length > 1 && segmentWidth < minLabelWidth) return;
        const centerX = (startX + endX) / 2;
        ctx.fillText(group.label, centerX, lineY - pluginOptions.labelOffset);
      });

      ctx.restore();
    },
  };

  private readonly selectedRangeInfo$$ = computed(() => {
    const dates = this.dates$$();
    const startIdx = this.foodStatsService.selectedDateIdxStart$$();
    const endIdx = this.foodStatsService.selectedDateIdxEnd$$();

    if (dates.length === 0 || startIdx < 0 || endIdx < 0 || startIdx >= dates.length || endIdx >= dates.length) {
      return { startLabel: '', endLabel: '', rangeLabel: '' };
    }

    const selectedLowDate = dates[startIdx];
    const selectedHighDate = dates[endIdx];
    if (!selectedLowDate || !selectedHighDate) return { startLabel: '', endLabel: '', rangeLabel: '' };

    const selectedDaysCount = endIdx - startIdx + 1;

    return {
      startLabel: formatDateTicks(selectedLowDate),
      endLabel: formatDateTicks(selectedHighDate),
      rangeLabel: this.formatSelectedRange(selectedDaysCount),
    };
  });

  protected readonly sliderStartLabel$$ = computed(() => this.selectedRangeInfo$$().startLabel);
  protected readonly sliderEndLabel$$ = computed(() => this.selectedRangeInfo$$().endLabel);
  protected readonly selectedRangeLabel$$ = computed(() => this.selectedRangeInfo$$().rangeLabel);

  protected readonly sliderValueList$$ = computed(() => {
    return this.dates$$().map((_, index) => index);
  });

  protected readonly selectedRange$$ = computed(() => {
    return [
      this.foodStatsService.selectedDateIdxStart$$(),
      this.foodStatsService.selectedDateIdxEnd$$(),
    ] as VSliderRangeValue;
  });

  protected readonly maxSliderValue$$ = computed(() => {
    return this.dates$$().length - 1;
  });

  protected readonly hasSelection$$ = computed(() => this.productHistoryState.hasSelection$$());
  protected readonly selectedColor$$ = computed(() => selectedProductsColor(this.chartThemeService.colors$$()));
  protected readonly restColor$$ = computed(() => this.chartThemeService.colors$$().main);

  protected readonly deviceInfoService = inject(DeviceInfoService);
  private readonly productHistoryState = inject(FoodProductHistoryStateService);
  private readonly foodStatsService = inject(FoodStatsService);
  private readonly foodSettingsService = inject(FoodSettingsService);
  private readonly telemetry = inject(TelemetryService);
  private readonly rangeAnimationDurationMs = ANIMATION_DURATION_MS.MEDIUM;
  private rangeAnimationFrameId: number | null = null;

  // Chart.js doesn't reliably repaint an existing chart's colors from an in-place
  // dataset.borderColor/backgroundColor mutation + update('none') — the data model
  // updates but the canvas keeps the old colors until the chart is rebuilt. Colors only
  // change on a theme toggle (rare), so recreating both charts on that transition is cheap
  // and sidesteps the stale-repaint issue entirely; plain data updates stay a cheap mutation.
  private lastChartColors: ChartColors | null = null;

  // Bands last handed to the weight chart's plugin options. They change only with height, the
  // diary toggle or the theme, not on every slider-drag data update — and a freshly (re)created
  // chart has none yet, hence the reset in initializeCharts().
  private appliedBmiBands: BmiBand[] | null = null;

  // No height or the diary toggle off — no bands; the weight chart then looks as it always did.
  private readonly bmiBands$$ = computed(() => {
    const height = this.foodSettingsService.height$$();
    if (!height || !this.foodSettingsService.statsWeightBmiBands$$()) return [];
    return buildBmiBands(height, this.chartThemeService.colors$$().isDark);
  });

  private readonly chartsUpdateEffect = effect(() => {
    const data = this.foodStatsService.statsChartDataClipped$$();
    const colors = this.chartThemeService.colors$$();
    const bmiBands = this.bmiBands$$();
    this.telemetry.measure(
      'food.stats_charts_render',
      () => {
        if (colors !== this.lastChartColors) {
          this.lastChartColors = colors;
          this.recreateCharts(colors);
        }
        this.updateWeightChart(data, colors, bmiBands);
        this.updateKcalsChart(data, colors);
      },
      () => ({ points: data.dates.length }),
    );
  });

  // Doesn't call getStats() itself — FoodStatsCharts is always mounted under FoodScreen, whose
  // ngOnInit already triggers FoodSyncCoordinatorService.loadInitialFoodData() (the single
  // bootstrap owner for food data, §2.4 of plan 28). This component is a pure reactive reader of
  // statsChartDataClipped$$; a second independent getStats() call here used to race that bootstrap
  // call for who decides windowed vs. full history (see plan 28, "Находки в эксплуатации").
  public ngOnInit(): void {
    this.lastChartColors = this.chartThemeService.colors$$();
    this.initializeCharts(this.lastChartColors);
  }

  public ngAfterViewInit(): void {
    const weightContext = this.weightChartCanvas().nativeElement.getContext('2d');
    if (weightContext) {
      weightContext.canvas.height = 250;
    }

    const kcalsContext = this.kcalsChartCanvas().nativeElement.getContext('2d');
    if (kcalsContext) {
      kcalsContext.canvas.height = 250;
    }
  }

  public ngOnDestroy(): void {
    this.weightChart$$()?.destroy();
    this.kcalsChart$$()?.destroy();
  }

  protected onRangeChange(range: VSliderRangeValue): void {
    const [start, end] = range;
    if (end <= start) return;
    this.foodStatsService.selectedDateIdxStart$$.set(start);
    this.foodStatsService.selectedDateIdxEnd$$.set(end);
    this.foodStatsService.saveDateRange(start, end);
    // Live drag, unlike animateClipDateRange() below, can pull the start thumb into the
    // not-yet-loaded region on its own — indices apply optimistically, the gap fills in once this
    // resolves (see rangeNeedsFullHistory()).
    if (this.foodStatsService.rangeNeedsFullHistory(start)) {
      void this.foodStatsService.ensureFullHistoryLoaded();
    }
  }

  // "Выбрать всё" / "1 год" can ask for more days than the default server window loaded (§2.1 of
  // plan 28) — clipNeedsFullHistory() catches that and this awaits the full-history fetch before
  // resolving the target range, otherwise getClipRange() below would clamp to whatever partial
  // window happened to already be in memory and animate to the wrong place.
  protected async animateClipDateRange(daysAmtToShow: number): Promise<void> {
    if (this.foodStatsService.clipNeedsFullHistory(daysAmtToShow)) {
      await this.foodStatsService.ensureFullHistoryLoaded();
    }
    const targetRange = this.foodStatsService.getClipRange(daysAmtToShow);
    this.animateRangeTo(targetRange);
  }

  private updateWeightChart(data: StatsChartData, colors: ChartColors, bmiBands: BmiBand[]) {
    const chart = this.weightChart$$();
    if (chart?.data) {
      if (bmiBands !== this.appliedBmiBands) {
        chart.options.plugins ??= {};
        chart.options.plugins.bmiBands = { bands: bmiBands };
        this.appliedBmiBands = bmiBands;
      }
      chart.data.labels = data.dates;
      chart.data.datasets[0].data = data.weights;
      chart.data.datasets[0].borderColor = colors.main;
      chart.data.datasets[0].backgroundColor = colors.main;
      chart.data.datasets[1].data = data.weightsAvg;
      chart.data.datasets[1].borderColor = colors.secondary;
      chart.data.datasets[1].backgroundColor = colors.secondary;
      chart.update('none');
    }
  }

  // The bar is the tracked products' calories (base) plus the rest of the day in the chart's main color.
  private updateKcalsChart(data: StatsChartData, colors: ChartColors) {
    const chart = this.kcalsChart$$();
    if (chart?.data) {
      const selectedColor = selectedProductsColor(colors);
      const kcals = splitKcalsBySelection(data.kcalsFactual, data.kcalsSelected);

      chart.data.labels = data.dates;
      chart.data.datasets[0].data = kcals.selected;
      chart.data.datasets[0].borderColor = selectedColor;
      chart.data.datasets[0].backgroundColor = selectedColor;
      chart.data.datasets[1].data = kcals.rest;
      chart.data.datasets[1].borderColor = colors.main;
      chart.data.datasets[1].backgroundColor = colors.main;
      chart.data.datasets[2].data = data.kcalsTarget;
      chart.data.datasets[2].borderColor = colors.secondary;
      chart.data.datasets[2].backgroundColor = colors.secondary;

      chart.update('none');
    }
  }

  private createChartConfig(baseConfig: ChartConfiguration): ChartConfiguration {
    const baseOptions = baseConfig.options ?? {};
    const baseScales = baseOptions.scales ?? {};
    const baseXScale = (baseScales as { x?: { ticks?: { display?: boolean }; grid?: { display?: boolean } } }).x ?? {};
    const baseXTicks = baseXScale.ticks ?? {};
    const baseXGrid = baseXScale.grid ?? {};
    const normalizedPadding = this.normalizePadding(baseOptions.layout?.padding);

    return {
      ...baseConfig,
      data: {
        ...baseConfig.data,
        labels: baseConfig.data?.labels ? [...baseConfig.data.labels] : [],
        datasets: baseConfig.data?.datasets ? baseConfig.data.datasets.map((dataset) => ({ ...dataset })) : [],
      },
      options: {
        ...baseOptions,
        layout: {
          padding: {
            ...normalizedPadding,
            bottom: Math.max(normalizedPadding.bottom, this.monthLabelsPadding),
          },
        },
        scales: {
          ...baseScales,
          x: {
            ...baseXScale,
            ticks: {
              ...baseXTicks,
              display: false,
            },
            grid: {
              ...baseXGrid,
              display: false,
            },
          },
        },
        plugins: {
          ...(baseOptions.plugins ?? {}),
          [this.monthLabelsPlugin.id]: this.monthLabelsOptions,
        } as NonNullable<ChartConfiguration['options']>['plugins'],
      },
      plugins: [...(baseConfig.plugins ?? []), this.monthLabelsPlugin],
    };
  }

  private normalizePadding(padding: unknown): { top: number; right: number; bottom: number; left: number } {
    if (typeof padding === 'number') {
      return { top: padding, right: padding, bottom: padding, left: padding };
    }

    if (!padding || typeof padding !== 'object') {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    const value = padding as { top?: number; right?: number; bottom?: number; left?: number };

    return {
      top: value.top ?? 0,
      right: value.right ?? 0,
      bottom: value.bottom ?? 0,
      left: value.left ?? 0,
    };
  }

  private buildTimeGroups(
    labels: string[],
    shortMonthSwitchMonths: number,
    yearSwitchMonths: number,
  ): { startIndex: number; endIndex: number; label: string }[] {
    const dates: Date[] = [];
    labels.forEach((label) => {
      const date = this.parseDateLabel(label);
      if (date) {
        dates.push(date);
      }
    });

    if (dates.length !== labels.length) return [];

    const monthSpanCount = this.getMonthSpanCount(dates);
    const useYears = monthSpanCount >= yearSwitchMonths;
    const useShortMonths = monthSpanCount >= shortMonthSwitchMonths && !useYears;

    return useYears ? this.buildYearGroups(dates) : this.buildMonthGroups(dates, useShortMonths);
  }

  private buildMonthGroups(
    dates: Date[],
    useShortMonths: boolean,
  ): { startIndex: number; endIndex: number; label: string }[] {
    const groups: { startIndex: number; endIndex: number; label: string }[] = [];
    let currentKey = '';
    let currentLabel = '';
    let currentStart = 0;

    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      if (key !== currentKey) {
        if (currentKey) {
          groups.push({ startIndex: currentStart, endIndex: i - 1, label: currentLabel });
        }
        currentKey = key;
        currentStart = i;
        currentLabel = useShortMonths ? this.formatShortMonthLabel(date) : this.formatMonthLabel(date);
      }
    }

    if (currentKey) {
      groups.push({ startIndex: currentStart, endIndex: dates.length - 1, label: currentLabel });
    }

    return groups;
  }

  private buildYearGroups(dates: Date[]): { startIndex: number; endIndex: number; label: string }[] {
    const groups: { startIndex: number; endIndex: number; label: string }[] = [];
    let currentYear = -1;
    let currentLabel = '';
    let currentStart = 0;

    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const year = date.getFullYear();
      if (year !== currentYear) {
        if (currentYear !== -1) {
          groups.push({ startIndex: currentStart, endIndex: i - 1, label: currentLabel });
        }
        currentYear = year;
        currentStart = i;
        currentLabel = this.formatYearLabel(date);
      }
    }

    if (currentYear !== -1) {
      groups.push({ startIndex: currentStart, endIndex: dates.length - 1, label: currentLabel });
    }

    return groups;
  }

  private parseDateLabel(label: string): Date | null {
    const parts = label.split('.');
    if (parts.length !== 3) return null;
    const day = Number(parts[0]);
    const month = Number(parts[1]);
    const year = Number(parts[2]);
    if (!day || !month || !year) return null;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private formatMonthLabel(date: Date): string {
    const raw = this.monthLabelsFormatter.format(date);
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  private formatShortMonthLabel(date: Date): string {
    const raw = this.shortMonthLabelsFormatter.format(date).replace('.', '');
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  private formatYearLabel(date: Date): string {
    return this.yearLabelsFormatter.format(date);
  }

  private getMonthSpanCount(dates: Date[]): number {
    if (dates.length === 0) return 0;
    const first = dates[0];
    const last = dates[dates.length - 1];
    return (last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth()) + 1;
  }

  private formatSelectedRange(selectedDaysCount: number): string {
    const DAYS_IN_YEAR = 365;
    const DAYS_IN_MONTH = 30;

    // converting days to years, months and days
    const years = Math.floor(selectedDaysCount / DAYS_IN_YEAR);
    const remainingDaysAfterYears = selectedDaysCount % DAYS_IN_YEAR;
    const months = Math.floor(remainingDaysAfterYears / DAYS_IN_MONTH);
    const remainingDays = remainingDaysAfterYears % DAYS_IN_MONTH;

    const parts: string[] = [];

    // building human readable description
    if (years > 0) {
      const yearText = `${years} ${getRuDeclension(years, 'год', 'года', 'лет')}`;
      const hasRemainingUnits = months > 0 || remainingDays > 0;
      parts.push(yearText + (hasRemainingUnits ? ',' : ''));
    }

    if (months > 0) {
      const monthText = `${months} ${getRuDeclension(months, 'месяц', 'месяца', 'месяцев')}`;
      const hasRemainingDays = remainingDays > 0;
      parts.push(monthText + (hasRemainingDays ? ',' : ''));
    }

    if (remainingDays > 0) {
      parts.push(`${remainingDays} ${getRuDeclension(remainingDays, 'день', 'дня', 'дней')}`);
    }

    return parts.join(' ');
  }

  private initializeCharts(colors: ChartColors): void {
    this.monthLabelsOptions = this.chartThemeService.monthLabelsOptions$$();
    this.appliedBmiBands = null;
    this.weightChart$$.set(new Chart('WeightChart', this.createChartConfig(createWeightChartConfig(colors))));
    this.kcalsChart$$.set(new Chart('KcalsChart', this.createChartConfig(createKcalsChartConfig(colors))));
  }

  private recreateCharts(colors: ChartColors): void {
    this.weightChart$$()?.destroy();
    this.kcalsChart$$()?.destroy();
    this.initializeCharts(colors);
  }

  private animateRangeTo(targetRange: VSliderRangeValue): void {
    if (this.rangeAnimationFrameId !== null) {
      cancelAnimationFrame(this.rangeAnimationFrameId);
      this.rangeAnimationFrameId = null;
    }

    const startRange: VSliderRangeValue = [
      this.foodStatsService.selectedDateIdxStart$$(),
      this.foodStatsService.selectedDateIdxEnd$$(),
    ];

    if (startRange[0] === targetRange[0] && startRange[1] === targetRange[1]) return;

    const startTime = performance.now();
    const duration = this.rangeAnimationDurationMs;

    const step = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = this.easeInOut(progress);
      const nextStart = Math.round(startRange[0] + (targetRange[0] - startRange[0]) * eased);
      const nextEnd = Math.round(startRange[1] + (targetRange[1] - startRange[1]) * eased);
      const lower = Math.min(nextStart, nextEnd);
      const upper = Math.max(nextStart, nextEnd);
      this.foodStatsService.selectedDateIdxStart$$.set(lower);
      this.foodStatsService.selectedDateIdxEnd$$.set(upper);

      if (progress < 1) {
        this.rangeAnimationFrameId = requestAnimationFrame(step);
        return;
      }

      this.foodStatsService.selectedDateIdxStart$$.set(targetRange[0]);
      this.foodStatsService.selectedDateIdxEnd$$.set(targetRange[1]);
      this.foodStatsService.saveDateRange(targetRange[0], targetRange[1]);
      this.rangeAnimationFrameId = null;
    };

    this.rangeAnimationFrameId = requestAnimationFrame(step);
  }

  private easeInOut(t: number): number {
    if (t < 0.5) return 2 * t * t;
    return 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
