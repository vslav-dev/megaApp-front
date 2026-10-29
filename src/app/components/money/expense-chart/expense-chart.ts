import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ChartThemeService } from '@app/services/chart-theme.service';
import { MoneyComputeService } from '@app/services/money-compute.service';
import { MoneyService } from '@app/services/money.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { CATEGORY_DIM_ALPHA, SeriesColor, seriesColorById } from '@app/shared/categorical-palette';
import { createCategoryHoverHighlight } from '@app/shared/category-hover-highlight';
import {
  ChartColors,
  EXPENSE_SERIES_ORDER,
  createExpenseChartConfig,
  formatMonthYearLabel,
  seriesOrderIndex,
} from '@app/shared/chart-config';
import { EXPENSE_VIRTUAL_SERIES, EXPENSE_VIRTUAL_SERIES_NAMES } from '@app/shared/money-series';
import { convertAmount } from '@app/shared/money-utils';
import { ExpenseChartData } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VToggle, VToggleItem } from '@ui-kit/components/v-toggle/v-toggle';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartDataset,
  Legend,
  LinearScale,
  Plugin,
  Tooltip,
} from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

interface ExpenseChartSeries {
  // Series id: a category id, or EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED.
  categoryId: number;
  categoryName: string;
}

@Component({
  selector: 'expense-chart',
  templateUrl: './expense-chart.html',
  imports: [VButton, VCheckbox, VInput, VToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpenseChart implements AfterViewInit, OnDestroy {
  readonly dataInput = input.required<ExpenseChartData>();
  readonly currencySymbolInput = input<string>('₽');
  readonly currencyTickerInput = input<string>('RUB');
  readonly monthRangeInput = input<[string, string] | null>(null);

  protected readonly chartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');
  protected readonly yMaxElem = viewChild.required<VInput>('yMaxElem');
  protected readonly chart$$ = signal<Chart | null>(null);
  protected readonly enabledIds$$ = computed(() => this.moneyService.enabledExpenseSeriesIds$$());
  protected readonly yearlyMode$$ = computed(() => this.moneyService.yearlyMode$$());

  private readonly moneyService = inject(MoneyService);
  private readonly moneyComputeService = inject(MoneyComputeService);
  private readonly chartThemeService = inject(ChartThemeService);
  private readonly telemetry = inject(TelemetryService);
  private readonly today = new Date().toISOString().substring(0, 10);
  private readonly latestRates$$ = computed(() => this.moneyService.getRatesForDate(this.today) ?? {});

  protected readonly isYMaxAuto$$ = computed(() => {
    const setting = this.moneyService.expenseChartYMax$$();
    return !!setting && setting.currencyTicker !== this.currencyTickerInput();
  });

  protected readonly yMaxInput$$ = computed(() => {
    const setting = this.moneyService.expenseChartYMax$$();
    if (!setting) return '';
    const ticker = this.currencyTickerInput();
    if (setting.currencyTicker === ticker) return setting.rawValue;

    const rawNum = Number(setting.rawValue);
    if (!setting.rawValue || isNaN(rawNum)) return '';
    const converted = convertAmount(rawNum, setting.currencyTicker, ticker, this.latestRates$$());
    return String(Math.round(converted));
  });
  protected readonly yMaxWidth$$ = computed(() => Math.max(60, 60 + this.yMaxInput$$().length * 10));

  // Chart.js caches a scale's resolved grid/border/ticks color internally — mutating
  // chart.data and calling chart.update('none') doesn't reliably repaint it after a theme
  // toggle (see the identical comment/fix in food-stats-charts.ts). Recreating the chart
  // whenever the theme (light/dark) changes sidesteps it; plain data updates, including a new
  // category palette, stay a cheap in-place mutation.
  private lastColors: ChartColors | null = null;

  private yearBoundaries: { year: string; startIdx: number; endIdx: number }[] = [];
  protected readonly hoveredCategoryName$$ = signal<string | null>(null);
  private readonly categoryHighlight = createCategoryHoverHighlight(this.hoveredCategoryName$$);
  // The dataset colors are scriptable functions Chart.js only re-evaluates on an explicit
  // update, so any hoveredCategoryName$$ write — from the canvas or from a legend row below —
  // needs one to actually repaint the bars.
  private readonly repaintOnHoverEffect = effect(() => {
    this.hoveredCategoryName$$();
    this.chart$$()?.update('none');
  });

  protected readonly viewToggleItems: VToggleItem[] = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'yearly', label: 'Yearly' },
  ];

  protected readonly allSeriesList$$ = computed((): ExpenseChartSeries[] => {
    const categories = this.dataInput().categories;
    const series: ExpenseChartSeries[] = categories.map((cat) => ({ categoryId: cat.id, categoryName: cat.name }));
    if (this.dataInput().monthRows.some((r) => r.uncategorizedAmount > 0)) {
      series.push({
        categoryId: EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED,
        categoryName: EXPENSE_VIRTUAL_SERIES_NAMES[EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED],
      });
    }
    series.sort(
      (a, b) =>
        seriesOrderIndex(EXPENSE_SERIES_ORDER, a.categoryName) - seriesOrderIndex(EXPENSE_SERIES_ORDER, b.categoryName),
    );
    return series;
  });

  protected readonly activeSeries$$ = computed(() => {
    const series = this.allSeriesList$$();
    const enabled = this.enabledIds$$();
    return series.filter((s) => enabled.has(s.categoryId));
  });

  private readonly chartUpdateEffect = effect(() => {
    const data = this.dataInput();
    const activeSeries = this.activeSeries$$();
    const yearly = this.yearlyMode$$();
    const ymax = this.yMaxInput$$();
    const monthRange = this.monthRangeInput();
    const seriesColors = this.moneyComputeService.expenseSeriesColors$$();
    // Dataset colors here are category-identity colors, not theme colors — colors$$ is only
    // needed to detect a theme switch and recreate the chart so its grid/tick colors repaint.
    const colors = this.chartThemeService.colors$$();
    this.telemetry.measure(
      'money.expense_chart_render',
      () => {
        let chart = this.chart$$();
        if (chart && colors.isDark !== this.lastColors?.isDark) {
          chart.destroy();
          chart = this.createChart(colors);
          this.chart$$.set(chart);
        }
        this.lastColors = colors;
        if (!chart) return;
        this.rebuildChartDatasets(chart, data, activeSeries, yearly, ymax, monthRange, colors, seriesColors);
      },
      () => ({ months: data.monthRows.length, series: activeSeries.length, yearly }),
    );
  });

  private readonly yearSeparatorPlugin: Plugin = {
    id: 'expenseYearSeparator',
    // Drawn before the dataset (not afterDraw) so the separator sits under the data line,
    // the same layering the built-in grid uses — the year label text stays in afterDraw
    // below, since it's positioned under the plot area and never overlaps the line anyway.
    beforeDatasetsDraw: (chart) => {
      if (this.yearlyMode$$()) return;
      if (!this.yearBoundaries.length) return;
      const xScale = chart.scales['x'];
      if (!xScale) return;
      const { ctx, chartArea } = chart;
      ctx.save();

      // Was a hardcoded 'rgba(0, 0, 0, 0.15)' — always-black, so on dark theme it barely
      // showed up at all. Chart.defaults.borderColor is the same theme grid color every
      // scale's own gridlines use, read live on every draw (no stale-cache concern here —
      // unlike Chart.js's own scale rendering, this plugin paints the canvas directly).
      ctx.strokeStyle = Chart.defaults.borderColor as string;
      ctx.lineWidth = 1;
      for (let i = 1; i < this.yearBoundaries.length; i++) {
        const x =
          Math.round(
            (xScale.getPixelForValue(this.yearBoundaries[i - 1].endIdx) +
              xScale.getPixelForValue(this.yearBoundaries[i].startIdx)) /
              2,
          ) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
      }

      ctx.restore();
    },
    afterDraw: (chart) => {
      if (this.yearlyMode$$()) return;
      if (!this.yearBoundaries.length) return;
      const xScale = chart.scales['x'];
      if (!xScale) return;
      const { ctx, chartArea } = chart;
      ctx.save();

      const labelY = Math.round((chartArea.bottom + xScale.bottom) / 2);
      const font = Chart.defaults.font;
      ctx.fillStyle = Chart.defaults.color as string;
      ctx.font = `${font.size ?? 12}px ${font.family ?? 'sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const { year, startIdx, endIdx } of this.yearBoundaries) {
        const centerX = (xScale.getPixelForValue(startIdx) + xScale.getPixelForValue(endIdx)) / 2;
        ctx.fillText(year, centerX, labelY);
      }

      ctx.restore();
    },
  };

  private createChart(colors: ChartColors): Chart | null {
    const ctx = this.chartCanvas().nativeElement.getContext('2d');
    if (!ctx) return null;
    const chart = new Chart(ctx, {
      ...createExpenseChartConfig(colors),
      plugins: [this.yearSeparatorPlugin, this.categoryHighlight],
    });
    if (chart.options.plugins?.tooltip?.callbacks) {
      chart.options.plugins.tooltip.callbacks.label = (ctx) => {
        if (!ctx.parsed.y) return '';
        return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(ctx.parsed.y)} ${this.currencySymbolInput()}`;
      };
      chart.options.plugins.tooltip.callbacks.footer = (items) => {
        if (items.length < 2) return [];
        const sum = items.reduce((acc, item) => acc + (item.parsed.y ?? 0), 0);
        return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(sum)} ${this.currencySymbolInput()}`;
      };
    }
    return chart;
  }

  public ngAfterViewInit(): void {
    this.lastColors = this.chartThemeService.colors$$();
    const chart = this.createChart(this.lastColors);
    if (chart) this.chart$$.set(chart);
  }

  public ngOnDestroy(): void {
    this.chart$$()?.destroy();
  }

  protected readonly allEnabled$$ = computed(() => {
    const enabled = this.enabledIds$$();
    return this.allSeriesList$$().every((s) => enabled.has(s.categoryId));
  });

  protected readonly allNoneLabel$$ = computed(() => (this.allEnabled$$() ? 'None' : 'All'));

  protected viewToggleValue(): string[] {
    return this.yearlyMode$$() ? ['yearly'] : ['monthly'];
  }

  protected onViewToggleChange(value: string[]): void {
    this.moneyService.setYearlyMode(value[0] === 'yearly');
  }

  protected onYMaxChange(value: string): void {
    this.moneyService.setExpenseChartYMax(
      value ? { rawValue: value, currencyTicker: this.currencyTickerInput() } : null,
    );
  }

  protected focusYMaxInput(): void {
    this.yMaxElem().focus();
  }

  protected toggleAll(): void {
    this.moneyService.setEnabledExpenseSeriesIds(
      this.allEnabled$$() ? new Set() : new Set(this.allSeriesList$$().map((s) => s.categoryId)),
    );
  }

  protected toggleCategory(categoryId: number, checked: boolean): void {
    const updated = new Set(this.enabledIds$$());
    if (checked) {
      updated.add(categoryId);
    } else {
      updated.delete(categoryId);
    }
    this.moneyService.setEnabledExpenseSeriesIds(updated);
  }

  protected isCategoryEnabled(categoryId: number): boolean {
    return this.enabledIds$$().has(categoryId);
  }

  protected onCategoryMouseEnter(categoryName: string): void {
    this.hoveredCategoryName$$.set(categoryName);
  }

  protected onCategoryMouseLeave(): void {
    this.hoveredCategoryName$$.set(null);
  }

  protected getCategoryColor(categoryId: number): string {
    return seriesColorById(
      this.moneyComputeService.expenseSeriesColors$$(),
      categoryId,
      this.chartThemeService.colors$$(),
    );
  }

  private rebuildChartDatasets(
    chart: Chart,
    data: ExpenseChartData,
    activeSeries: ExpenseChartSeries[],
    yearly: boolean,
    yMaxRaw: string,
    monthRange: [string, string] | null,
    colors: ChartColors,
    seriesColors: ReadonlyMap<number, SeriesColor>,
  ): void {
    const effectiveData: ExpenseChartData =
      !yearly && monthRange !== null
        ? {
            categories: data.categories,
            monthRows: data.monthRows.filter((r) => r.period >= monthRange[0] && r.period <= monthRange[1]),
          }
        : data;
    const months = effectiveData.monthRows.map((r) => r.period);
    let labels: string[];
    let yearlyValues: Map<number, number[]> | null = null;

    if (yearly) {
      const yearLabels: string[] = [];
      const yearIndexMap = new Map<string, number>();
      months.forEach((m) => {
        const year = m.substring(0, 4);
        if (!yearIndexMap.has(year)) {
          yearIndexMap.set(year, yearLabels.length);
          yearLabels.push(year);
        }
      });
      labels = yearLabels;
      yearlyValues = new Map();
      activeSeries.forEach((s) => {
        const yearVals = new Array<number>(yearLabels.length).fill(0);
        months.forEach((m, i) => {
          const year = m.substring(0, 4);
          const val =
            s.categoryId === EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED
              ? effectiveData.monthRows[i].uncategorizedAmount
              : (effectiveData.monthRows[i].categoryAmounts[s.categoryId] ?? 0);
          yearVals[yearIndexMap.get(year)!] += val;
        });
        yearlyValues!.set(s.categoryId, yearVals);
      });
    } else {
      this.yearBoundaries = [];
      const yearMap = new Map<string, { startIdx: number; endIdx: number }>();
      months.forEach((m, i) => {
        const year = m.substring(0, 4);
        const existing = yearMap.get(year);
        if (!existing) {
          yearMap.set(year, { startIdx: i, endIdx: i });
        } else {
          existing.endIdx = i;
        }
      });
      yearMap.forEach((bounds, year) => this.yearBoundaries.push({ year, ...bounds }));
      labels = months.map((m) => formatMonthYearLabel(m));
    }

    chart.options.scales!['x']!.ticks!.callback = yearly
      ? (value: unknown, index: number) => labels[index]
      : () => '';

    const datasets: ChartDataset<'bar'>[] = activeSeries.map((series) => {
      const color = seriesColorById(seriesColors, series.categoryId, colors);
      const dimColor = seriesColorById(seriesColors, series.categoryId, colors, CATEGORY_DIM_ALPHA);
      const resolveColor = () => {
        const hovered = this.hoveredCategoryName$$();
        return hovered === null || hovered === series.categoryName ? color : dimColor;
      };
      const seriesValues: number[] = yearly
        ? yearlyValues!.get(series.categoryId)!
        : months.map((_, i) =>
            series.categoryId === EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED
              ? effectiveData.monthRows[i].uncategorizedAmount
              : (effectiveData.monthRows[i].categoryAmounts[series.categoryId] ?? 0),
          );
      return {
        label: series.categoryName,
        data: seriesValues,
        backgroundColor: resolveColor,
        hoverBackgroundColor: resolveColor,
        borderColor: color,
        borderWidth: 0,
        stack: 'expense',
      };
    });
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    const parsedMax = parseInt(yMaxRaw, 10);
    const maxStackedValue = labels.reduce((max, _, i) => {
      const barTotal = datasets.reduce((sum, ds) => sum + ((ds.data[i] as number) ?? 0), 0);
      return Math.max(max, barTotal);
    }, 0);
    chart.options.scales!['y']!.max =
      !yearly && parsedMax > 0 && !isNaN(parsedMax) && maxStackedValue > parsedMax ? parsedMax : undefined;
    chart.update('none');
  }
}
