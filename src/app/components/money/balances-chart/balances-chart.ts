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
import { MoneyService, SuspensionFilter } from '@app/services/money.service';
import { TelemetryService } from '@app/services/telemetry.service';
import {
  ChartColors,
  balanceCategoricalPalette,
  createBalanceChartConfig,
  formatMonthYearLabel,
} from '@app/shared/chart-config';
import { BalanceChartAccountSeries, BalanceChartData } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { VToggle, VToggleItem } from '@ui-kit/components/v-toggle/v-toggle';
import {
  CategoryScale,
  Chart,
  ChartDataset,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  Plugin,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Title, Tooltip, Legend, Filler);

@Component({
  selector: 'balances-chart',
  templateUrl: './balances-chart.html',
  imports: [VButton, VCheckbox, VToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BalancesChart implements AfterViewInit, OnDestroy {
  readonly dataInput = input.required<BalanceChartData>();
  readonly currencySymbolInput = input<string>('₽');

  protected readonly chartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');
  protected readonly chart$$ = signal<Chart | null>(null);
  protected readonly showByAccount$$ = computed(() => this.moneyService.showByAccount$$());
  protected readonly suspensionFilter$$ = computed(() => this.moneyService.suspensionFilter$$());
  protected readonly disabledAccountIds$$ = computed(() => this.moneyService.disabledAccountIds$$());

  private readonly moneyService = inject(MoneyService);
  private readonly chartThemeService = inject(ChartThemeService);
  private readonly telemetry = inject(TelemetryService);

  // Chart.js caches a scale's resolved grid/border/ticks color internally — mutating
  // chart.data and calling chart.update('none') doesn't reliably repaint it after a theme
  // toggle (see the identical comment/fix in food-stats-charts.ts). Recreating the chart
  // whenever the theme (light/dark) changes sidesteps it; plain data updates, including a new
  // category palette, stay a cheap in-place mutation.
  private lastColors: ChartColors | null = null;

  private yearBoundaries: { year: string; startIdx: number; endIdx: number }[] = [];

  private readonly crosshairPlugin: Plugin = {
    id: 'balanceCrosshair',
    // beforeDatasetsDraw (not afterDraw) so the crosshair sits under the data line, the
    // same layering the built-in grid uses — active-element state is already known by
    // this point in the draw cycle (set by the hover handler, not computed during draw).
    beforeDatasetsDraw: (chart) => {
      const active = chart.tooltip?.getActiveElements();
      if (!active?.length) return;

      const { top, bottom, left, right } = chart.chartArea;
      const x = active[0].element.x;
      if (x < left || x > right) return;

      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.lineWidth = 1;
      // Reads the live theme color instead of a hardcoded one — same mechanism the
      // label fillStyle below already uses via Chart.defaults.
      ctx.strokeStyle = Chart.defaults.color as string;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    },
  };

  private readonly yearSeparatorPlugin: Plugin = {
    id: 'balanceYearSeparator',
    // Drawn before the dataset (not afterDraw) so the separator sits under the data line,
    // the same layering the built-in grid uses — the year label text stays in afterDraw
    // below, since it's positioned under the plot area and never overlaps the line anyway.
    beforeDatasetsDraw: (chart) => {
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

  protected readonly activeAccountSeries$$ = computed(() => {
    const series = this.dataInput().accountSeries;
    const disabled = this.disabledAccountIds$$();
    return series.filter((s) => !disabled.has(s.accountId));
  });

  private readonly chartUpdateEffect = effect(() => {
    const data = this.dataInput();
    const showByAccount = this.showByAccount$$();
    const activeSeries = this.activeAccountSeries$$();
    const suspensionFilter = this.suspensionFilter$$();
    const colors = this.chartThemeService.colors$$();
    this.telemetry.measure(
      'money.balance_chart_render',
      () => {
        let chart = this.chart$$();
        if (chart && colors.isDark !== this.lastColors?.isDark) {
          chart.destroy();
          chart = this.createChart(colors);
          this.chart$$.set(chart);
        }
        this.lastColors = colors;
        if (!chart) return;
        this.rebuildChartDatasets(chart, data, showByAccount, activeSeries, suspensionFilter, colors);
      },
      () => ({ months: data.dates.length, series: activeSeries.length }),
    );
  });

  private createChart(colors: ChartColors): Chart | null {
    const ctx = this.chartCanvas().nativeElement.getContext('2d');
    if (!ctx) return null;
    const chart = new Chart(ctx, {
      ...createBalanceChartConfig(colors),
      plugins: [this.yearSeparatorPlugin, this.crosshairPlugin],
    });
    if (chart.options.plugins?.tooltip?.callbacks) {
      chart.options.plugins.tooltip.callbacks.label = (ctx) => {
        const raw = (ctx.dataset as any)['_rawValues'];
        const value = raw ? raw[ctx.dataIndex] : ctx.parsed.y;
        return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ${this.currencySymbolInput()}`;
      };
      chart.options.plugins.tooltip.callbacks.footer = (items) => {
        if (items.length < 2) return [];
        const sum = items.reduce((acc, item) => {
          const raw = (item.dataset as any)['_rawValues'];
          const value = raw ? raw[item.dataIndex] : item.parsed.y;
          return acc + value;
        }, 0);
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

  protected readonly viewToggleItems: VToggleItem[] = [
    { id: 'aggregated', label: 'Aggregated' },
    { id: 'by-account', label: 'By Account' },
  ];

  protected readonly suspensionToggleItems: VToggleItem[] = [
    { id: 'all', label: 'All' },
    { id: 'exclude', label: 'Exclude Suspended' },
    { id: 'only', label: 'Only Suspended' },
  ];

  protected viewToggleValue(): string[] {
    return this.showByAccount$$() ? ['by-account'] : ['aggregated'];
  }

  protected onViewToggleChange(value: string[]): void {
    this.moneyService.setShowByAccount(value[0] === 'by-account');
  }

  protected suspensionToggleValue(): string[] {
    return [this.suspensionFilter$$()];
  }

  protected onSuspensionToggleChange(value: string[]): void {
    this.moneyService.setSuspensionFilter((value[0] ?? 'all') as SuspensionFilter);
  }

  protected isAccountEnabled(accountId: number): boolean {
    return !this.disabledAccountIds$$().has(accountId);
  }

  protected readonly allEnabled$$ = computed(() => {
    const series = this.dataInput().accountSeries;
    const disabled = this.disabledAccountIds$$();
    return series.every((s) => !disabled.has(s.accountId));
  });

  protected readonly allNoneLabel$$ = computed(() => (this.allEnabled$$() ? 'None' : 'All'));

  protected toggleAll(): void {
    const series = this.dataInput().accountSeries;
    if (this.allEnabled$$()) {
      this.moneyService.setDisabledAccountIds(new Set(series.map((s) => s.accountId)));
    } else {
      this.moneyService.setDisabledAccountIds(new Set());
    }
  }

  protected toggleAccount(accountId: number, checked: boolean): void {
    const current = this.disabledAccountIds$$();
    const updated = new Set(current);
    if (checked) {
      updated.delete(accountId);
    } else {
      updated.add(accountId);
    }
    this.moneyService.setDisabledAccountIds(updated);
  }

  protected getAccountColor(accountId: number): string {
    return balanceCategoricalPalette.getColor(String(accountId), this.chartThemeService.colors$$());
  }

  private rebuildChartDatasets(
    chart: Chart,
    data: BalanceChartData,
    showByAccount: boolean,
    activeSeries: BalanceChartAccountSeries[],
    suspensionFilter: 'all' | 'exclude' | 'only',
    colors: ChartColors,
  ): void {
    const labels = data.dates.map((d) => formatMonthYearLabel(d));

    this.yearBoundaries = [];
    const yearMap = new Map<string, { startIdx: number; endIdx: number }>();
    data.dates.forEach((d, i) => {
      const year = d.substring(0, 4);
      const existing = yearMap.get(year);
      if (!existing) {
        yearMap.set(year, { startIdx: i, endIdx: i });
      } else {
        existing.endIdx = i;
      }
    });
    yearMap.forEach((bounds, year) => this.yearBoundaries.push({ year, ...bounds }));

    const getEffectiveValue = (s: BalanceChartAccountSeries, i: number): number => {
      if (suspensionFilter === 'only') return Math.max(0, s.suspendedValues[i] ?? 0);
      if (suspensionFilter === 'exclude') return Math.max(0, (s.values[i] ?? 0) - (s.suspendedValues[i] ?? 0));
      return Math.max(0, s.values[i] ?? 0);
    };

    if (!showByAccount) {
      const filteredTotals = data.dates.map((_, i) =>
        activeSeries.reduce((sum, s) => sum + getEffectiveValue(s, i), 0),
      );
      chart.data.labels = labels;
      chart.data.datasets = [
        {
          label: 'Баланс',
          data: filteredTotals,
          fill: true,
          borderColor: colors.main,
          backgroundColor: colors.mainAlpha,
        },
      ];
      chart.update('none');
      return;
    }

    const datasets: ChartDataset<'line'>[] = [];
    const accumulated: number[] = new Array(data.dates.length).fill(0);

    activeSeries.forEach((series, localIdx) => {
      const color = balanceCategoricalPalette.getColor(String(series.accountId), colors);
      const colorAlpha = balanceCategoricalPalette.getColor(String(series.accountId), colors, 0.6);

      const rawValues = series.values.map((_, i) => getEffectiveValue(series, i));
      const cumulativeData = rawValues.map((v, i) => {
        accumulated[i] += v;
        return accumulated[i];
      });

      datasets.push({
        label: series.accountTitle,
        data: cumulativeData,
        fill: localIdx === 0 ? 'origin' : '-1',
        borderColor: color,
        backgroundColor: colorAlpha,
        _rawValues: rawValues,
      } as unknown as ChartDataset<'line'>);
    });

    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update('none');
  }
}
