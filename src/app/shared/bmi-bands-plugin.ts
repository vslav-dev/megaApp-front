import { BmiBand } from '@app/shared/bmi-bands';
import { ChartType, Plugin } from 'chart.js';

export interface BmiBandsOptions {
  bands: BmiBand[];
}

declare module 'chart.js' {
  // [LOAD-BEARING] The type parameter must mirror chart.js's own declaration for the augmentation to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    bmiBands?: BmiBandsOptions;
  }
}

export interface BmiBandSpan {
  top: number;
  bottom: number;
  color: string;
}

// Each band clamped to the weight range the Y axis currently shows, as vertical pixel spans;
// bands entirely outside it are dropped.
export function computeBmiBandSpans(
  bands: BmiBand[],
  axisMin: number,
  axisMax: number,
  getPixelForValue: (value: number) => number,
): BmiBandSpan[] {
  const spans: BmiBandSpan[] = [];

  for (const band of bands) {
    const fromKg = Math.max(band.fromKg, axisMin);
    const toKg = Math.min(band.toKg, axisMax);
    if (fromKg >= toKg) continue;

    spans.push({ top: getPixelForValue(toKg), bottom: getPixelForValue(fromKg), color: band.color });
  }

  return spans;
}

// Paints BMI category bands behind the chart. beforeDraw runs before the scales' gridlines, so
// the fill sits under the grid and the data. The bands are not datasets: they never touch the Y
// scale, legend or tooltips.
export const bmiBandsPlugin: Plugin<'line', BmiBandsOptions> = {
  id: 'bmiBands',
  defaults: { bands: [] },
  beforeDraw(chart, _args, options) {
    const yScale = chart.scales['y'];
    if (!yScale || options.bands.length === 0) return;

    const { ctx, chartArea } = chart;
    ctx.save();
    for (const span of computeBmiBandSpans(options.bands, yScale.min, yScale.max, (value) =>
      yScale.getPixelForValue(value),
    )) {
      ctx.fillStyle = span.color;
      ctx.fillRect(chartArea.left, span.top, chartArea.width, span.bottom - span.top);
    }
    ctx.restore();
  },
};
