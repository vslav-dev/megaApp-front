import { bmiBandsPlugin } from '@app/shared/bmi-bands-plugin';
import {
  createCategoricalPalette,
  DEFAULT_PALETTE_TUNING,
  hueToColor,
  seriesColor,
} from '@app/shared/categorical-palette';
import { formatMetricUnitValue, MetricUnit } from '@app/shared/metric-units';
import { formatMetricTickLabel } from '@app/shared/metrics-series';
import { MetricGranularity, PaletteTuning } from '@app/shared/types';
import { ChartConfiguration } from 'chart.js';

export interface ChartColors {
  main: string;
  mainAlpha: string;
  secondary: string;
  secondaryAlpha: string;
  text: string;
  grid: string;
  isDark: boolean;
  // How vivid/light category colors are (see hueToColor); the user's override of the default.
  palette: PaletteTuning;
}

export interface MonthLabelsPluginOptions {
  lineColor: string;
  lineWidth: number;
  segmentColor: string;
  segmentWidth: number;
  separatorColorChart: string;
  separatorColorLegend: string;
  separatorWidth: number;
  separatorHeight: number;
  labelColor: string;
  labelFont: string;
  labelPadding: number;
  lineOffset: number;
  labelOffset: number;
  shortMonthSwitchMonths: number;
  yearSwitchMonths: number;
}

// Previous palette (cool teal, ~183°), kept in case we go back to it:
// export const CHART_COLORS_LIGHT: ChartColors = {
//   main: '#578f92',
//   mainAlpha: '#578f9250',
//   secondary: '#345b5b',
//   secondaryAlpha: '#345b5b50',
//   virtual: '#9fc9cb',
//   virtualAlpha: '#9fc9cb80',
// };
//
// export const CHART_COLORS_DARK: ChartColors = {
//   main: '#5a8487',
//   mainAlpha: '#5a848750',
//   secondary: '#89b1b3',
//   secondaryAlpha: '#89b1b350',
//   virtual: '#496365',
//   virtualAlpha: '#49636580',
// };

// Same blue hue (~225°, matching --v-color-primary) in both palettes, but lightness ranking
// is flipped: on a white surface a darker tone reads as the more prominent one, so light mode
// goes secondary(darkest) > main; on a dark surface it's the opposite — a
// lighter tone pops more — so dark mode goes secondary(lightest) > main,
// keeping the same relative emphasis order in both themes instead of reusing light values as-is.
// text/grid match --v-color-text-muted / --v-color-border-subtle from flat-blue.css, so
// axis labels and gridlines read like the rest of the app's chrome instead of Chart.js's
// own default gray.
export const CHART_COLORS_LIGHT: ChartColors = {
  main: '#6278bc',
  mainAlpha: '#6278bc50',
  secondary: '#2d3f76',
  secondaryAlpha: '#2d3f7650',
  text: '#64748b',
  grid: '#e2e8f0',
  isDark: false,
  palette: DEFAULT_PALETTE_TUNING,
};

export const CHART_COLORS_DARK: ChartColors = {
  main: '#545f83',
  mainAlpha: '#545f8350',
  secondary: '#8d98b9',
  secondaryAlpha: '#8d98b950',
  text: '#94a3b8',
  grid: '#334155',
  isDark: true,
  palette: DEFAULT_PALETTE_TUNING,
};

export function createWeightChartConfig(colors: ChartColors): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Вес',
          data: [],
          order: 2,
          fill: false,
          borderColor: colors.main,
          backgroundColor: colors.main,
          pointRadius: 2,
          pointHitRadius: 20,
        },
        {
          label: 'Средний вес за 7 дней',
          data: [],
          order: 1,
          borderColor: colors.secondary,
          backgroundColor: colors.secondary,
          pointRadius: 2,
          pointHitRadius: 20,
        },
      ],
    },
    plugins: [bmiBandsPlugin],
    options: {
      animation: false,
      elements: { line: { tension: 0.5 } },
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: colors.text },
        },
      },
      scales: {
        x: {
          ticks: { color: colors.text },
          grid: { color: colors.grid },
          border: { color: colors.grid },
        },
        y: {
          ticks: { color: colors.text, stepSize: 1 },
          grid: { color: colors.grid },
          border: { color: colors.grid },
        },
      },
    },
  };
}

// Color of the part of the calories bar eaten from the products tracked in the product history: a
// raspberry/magenta far from the chart's blue and outside the status bands (see
// STATUS_EXCLUDED_HUE_RANGES in categorical-palette.ts), so it reads as "highlighted", never as an
// error or a warning. The dark theme follows the user's palette tuning; the default palette is too
// loud on white, so the light theme has its own fixed lightness and saturation.
export function selectedProductsColor(colors: ChartColors): string {
  return colors.isDark ? hueToColor(330, colors) : seriesColor({ hue: 345, lightness: 44, saturation: 90 }, colors);
}

// The bar is a two-segment stack: the tracked products at the base (a shared baseline makes their
// height comparable from day to day), the rest of the day above. Their sum is the day's calories,
// so the bar height and the target line keep their meaning with or without a selection.
export function createKcalsChartConfig(colors: ChartColors): ChartConfiguration {
  return {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Выбранные продукты',
          data: [],
          order: 2,
          stack: 'kcals',
          borderColor: selectedProductsColor(colors),
          backgroundColor: selectedProductsColor(colors),
          borderWidth: 1,
          barThickness: 'flex',
          maxBarThickness: 30,
        },
        {
          label: 'Ккал за день',
          data: [],
          order: 2,
          stack: 'kcals',
          borderColor: colors.main,
          backgroundColor: colors.main,
          borderWidth: 1,
          barThickness: 'flex',
          maxBarThickness: 30,
        },
        {
          label: 'Целевое значение',
          data: [],
          order: 1,
          type: 'line',
          borderColor: colors.secondary,
          backgroundColor: colors.secondary,
          pointRadius: 2,
          pointHitRadius: 20,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      events: [],
      plugins: {
        tooltip: {
          enabled: false,
        },
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: {},
        },
        y: {
          stacked: true,
          display: false,
          ticks: {
            display: false,
            stepSize: 500,
          },
        },
      },
    },
  };
}

export const FOOD_STATS_MONTH_LABELS_PADDING = 24;

export const FOOD_STATS_MONTH_LABELS_OPTIONS_LIGHT: MonthLabelsPluginOptions = {
  lineColor: 'rgba(0, 0, 0, 0.2)',
  lineWidth: 1,
  segmentColor: 'rgba(0, 0, 0, 0.35)',
  segmentWidth: 2,
  separatorColorChart: 'rgba(0, 0, 0, 0.1)',
  separatorColorLegend: 'rgba(0, 0, 0, 0.45)',
  separatorWidth: 1,
  separatorHeight: 10,
  labelColor: '#3f4a5a',
  labelFont: '12px system-ui, -apple-system, sans-serif',
  labelPadding: 8,
  lineOffset: 26,
  labelOffset: 3,
  shortMonthSwitchMonths: 6,
  yearSwitchMonths: 8,
};

// Same structure as the light variant, but every color anchors to white instead
// of black — on a dark surface, black-based rgba lines/labels just read as a
// dirty smudge instead of a clean divider, so opacity blends toward white and
// labelColor moves to --v-color-text-muted (dark) from flat-blue.css.
export const FOOD_STATS_MONTH_LABELS_OPTIONS_DARK: MonthLabelsPluginOptions = {
  ...FOOD_STATS_MONTH_LABELS_OPTIONS_LIGHT,
  lineColor: 'rgba(255, 255, 255, 0.2)',
  segmentColor: 'rgba(255, 255, 255, 0.35)',
  separatorColorChart: 'rgba(255, 255, 255, 0.12)',
  separatorColorLegend: 'rgba(255, 255, 255, 0.45)',
  labelColor: '#94a3b8',
};

// Same grid/border/ticks treatment as createWeightChartConfig (the reference look for the
// whole app): subtle grid.color/border.color, muted ticks.color, both from the same
// ChartColors the theme is currently resolved to. Money/metrics charts used to leave these
// unset and rely on Chart.defaults alone — harmless while nothing else changes them, but
// Chart.js caches a scale's resolved color internally and chart.update() alone doesn't
// reliably repaint it (see the recreate-on-color-change comment in food-stats-charts.ts),
// so a stale (often light-theme) color could stick after a theme toggle. Setting it
// explicitly at chart-(re)creation time, the same way the canonical chart always has,
// removes that ambiguity — see rebuildBalanceChart in balances-chart.ts for the recreation.
export function createBalanceChartConfig(colors: ChartColors): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      animation: false,
      elements: { line: { tension: 0.3 }, point: { radius: 0, hitRadius: 20 } },
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          footerAlign: 'right',
          filter: (item) => {
            const raw = (item.dataset as any)['_rawValues'];
            const value = raw ? raw[item.dataIndex] : item.parsed.y;
            return Math.abs(value) >= 1;
          },
          callbacks: {
            label: (ctx) => {
              const raw = (ctx.dataset as any)['_rawValues'];
              const value = raw ? raw[ctx.dataIndex] : ctx.parsed.y;
              return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`;
            },
            footer: (items) => {
              if (items.length < 2) return [];
              const sum = items.reduce((acc, item) => {
                const raw = (item.dataset as any)['_rawValues'];
                const value = raw ? raw[item.dataIndex] : item.parsed.y;
                return acc + value;
              }, 0);
              return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(sum)} ₽`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false, color: colors.grid },
          border: { color: colors.grid },
          ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12, callback: () => '' },
        },
        y: {
          min: 0,
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: {
            color: colors.text,
            callback: (value) =>
              new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value as number),
          },
        },
      },
    },
  };
}

// Same explicit-color rationale as createBalanceChartConfig above.
export function createIncomeChartConfig(colors: ChartColors): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          footerAlign: 'right',
          callbacks: {
            label: (ctx) => {
              if (!ctx.parsed.y) return '';
              return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(ctx.parsed.y)} ₽`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false, color: colors.grid },
          border: { color: colors.grid },
          ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
        },
        y: {
          stacked: true,
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: {
            color: colors.text,
            callback: (value) =>
              new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value as number),
          },
        },
      },
    },
  };
}

// Legend and stack order of the expense and income series, by name; a series that is not listed
// goes last. Category colors are not here: they are a property of the category (its hue).
export const EXPENSE_SERIES_ORDER: readonly string[] = [
  'Еда',
  'Алкоголь',
  'Квартплата',
  'Развл.',
  'Отдых',
  'Проезд',
  'Одежда',
  'Связь',
  'Рекуррентка',
  'Лекарства',
  'Хоз.товары',
  'Запчасти',
  'Прочее',
  'Подарок',
  'Техника',
];

export const INCOME_SERIES_ORDER: readonly string[] = [
  'Зарплата',
  'Проекты',
  'Проценты',
  'Дивиденды',
  'ЦБ закрытые',
  'ЦБ открытые',
  'Крипта закрытые',
  'Крипта открытые',
];

export function seriesOrderIndex(order: readonly string[], name: string): number {
  const index = order.indexOf(name);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export const balanceCategoricalPalette = createCategoricalPalette();

export function rgbToRgba(rgb: string, alpha: number): string {
  return rgb.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

export function formatMonthYearLabel(dateISO: string): string {
  const date = new Date(dateISO + 'T00:00:00');
  return `${date.toLocaleDateString('en-US', { month: 'long' })} ${date.getFullYear()}`;
}

// Same explicit-color rationale as createBalanceChartConfig above.
export function createExpenseChartConfig(colors: ChartColors): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          mode: 'index',
          intersect: false,
          footerAlign: 'right',
          callbacks: {
            label: (ctx) => {
              if (!ctx.parsed.y) return '';
              return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(ctx.parsed.y)} ₽`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false, color: colors.grid },
          border: { color: colors.grid },
          ticks: { color: colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
        },
        y: {
          stacked: true,
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: {
            color: colors.text,
            callback: (value) =>
              new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value as number),
          },
        },
      },
    },
  };
}

export function createMetricSparklineConfig(color: string, colors: ChartColors): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          borderColor: color,
          backgroundColor: rgbToRgba(color, 0.15),
          borderWidth: 1.5,
          fill: true,
          pointRadius: 0,
          pointHitRadius: 12,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      elements: { line: { tension: 0.3 } },
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'nearest', intersect: false },
      },
      scales: {
        x: {
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: { color: colors.text, maxRotation: 0, autoSkip: false },
        },
        y: {
          min: 0,
          display: false,
          ticks: { precision: 0 },
        },
      },
    },
  };
}

// 'nearest' picks the point closest to the cursor by raw pixel distance (x and y both
// count), so on a spiky line it can snap to a point noticeably left/right of the cursor
// just because it's vertically close. 'index' ignores y entirely and always picks the
// point whose x sits exactly under the cursor — same interaction mode the money charts
// already use for their (multi-series) tooltips.
export type MetricTooltipInteractionMode = 'nearest' | 'index';

// The header value in metric-chart-card already shows the hovered value and time,
// so the chart's own popup tooltip is redundant and just disabled here.
function metricSparseTooltipOptions() {
  return { enabled: false };
}

export function createMetricSparseLineConfig(
  color: string,
  unit: MetricUnit,
  granularity: MetricGranularity,
  tooltipMode: MetricTooltipInteractionMode,
  colors: ChartColors,
): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          borderColor: color,
          backgroundColor: rgbToRgba(color, 0.15),
          borderWidth: 1.5,
          fill: false,
          spanGaps: false,
          pointRadius: 0,
          // Nearest mode jumps between samples, so a marker on the active one is useful;
          // Vertical mode already tracks the cursor continuously via the crosshair line.
          pointHoverRadius: tooltipMode === 'nearest' ? 4 : 0,
          pointHitRadius: 12,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: tooltipMode, intersect: false },
      elements: { line: { tension: 0.3 } },
      plugins: {
        legend: { display: false },
        tooltip: metricSparseTooltipOptions(),
      },
      scales: {
        x: {
          type: 'linear',
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: {
            color: colors.text,
            maxRotation: 0,
            autoSkip: false,
            callback: (value) => formatMetricTickLabel(value as number, granularity),
          },
        },
        y: {
          display: true,
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: { color: colors.text, callback: (value) => formatMetricUnitValue(unit, value as number) },
        },
      },
    },
  };
}

export function createMetricBarConfig(
  color: string,
  unit: MetricUnit,
  granularity: MetricGranularity,
  tooltipMode: MetricTooltipInteractionMode,
  colors: ChartColors,
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          backgroundColor: color,
          borderWidth: 0,
          barThickness: 1,
        },
      ],
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: tooltipMode, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: metricSparseTooltipOptions(),
      },
      scales: {
        x: {
          type: 'linear',
          // BarController defaults offset/grid.offset to true (for category axes),
          // which on a linear scale pads _startValue/_endValue by half a tick
          // spacing — shifting the whole plot away from the sparse-line chart's
          // edge-to-edge range. Disable both so the two share the same canvas.
          offset: false,
          grid: { offset: false, color: colors.grid },
          border: { color: colors.grid },
          ticks: {
            color: colors.text,
            maxRotation: 0,
            autoSkip: false,
            callback: (value) => formatMetricTickLabel(value as number, granularity),
          },
        },
        y: {
          min: 0,
          display: true,
          grid: { color: colors.grid },
          border: { color: colors.grid },
          ticks: { color: colors.text, callback: (value) => formatMetricUnitValue(unit, value as number) },
        },
      },
    },
  };
}
