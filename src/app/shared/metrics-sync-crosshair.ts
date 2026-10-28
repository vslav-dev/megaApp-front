import { signal } from '@angular/core';
import { Chart, ChartType, Plugin } from 'chart.js';

export interface MetricSyncCrosshairOptions {
  enabled: boolean;
  windowStartBucket: number;
  windowEndBucket: number;
  displayStepSeconds: number;
}

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    metricSyncCrosshair?: MetricSyncCrosshairOptions;
  }
}

const CROSSHAIR_LINE_COLOR = 'rgba(239, 68, 68, 0.9)';
const CROSSHAIR_LINE_DASH = [4, 4];
const CROSSHAIR_LINE_WIDTH = 1;

const registeredCharts = new Set<Chart>();

// Writable only within this module — cards elsewhere consume the readonly view below.
const hoverBucketState$$ = signal<number | null>(null);
export const hoverBucket$$ = hoverBucketState$$.asReadonly();

let redrawScheduled = false;

function requestCrosshairRedraw(): void {
  if (redrawScheduled) {
    return;
  }

  redrawScheduled = true;
  requestAnimationFrame(() => {
    redrawScheduled = false;
    for (const chart of registeredCharts) {
      chart.update('none');
    }
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readMetricSyncCrosshairOptions(options: unknown): MetricSyncCrosshairOptions | null {
  if (!options || typeof options !== 'object') {
    return null;
  }

  const candidate = options as Partial<MetricSyncCrosshairOptions>;
  if (
    typeof candidate.enabled !== 'boolean' ||
    !Number.isFinite(candidate.windowStartBucket) ||
    !Number.isFinite(candidate.windowEndBucket) ||
    !Number.isFinite(candidate.displayStepSeconds)
  ) {
    return null;
  }

  return {
    enabled: candidate.enabled,
    windowStartBucket: candidate.windowStartBucket as number,
    windowEndBucket: candidate.windowEndBucket as number,
    displayStepSeconds: candidate.displayStepSeconds as number,
  };
}

function resolveHoverBucket(chart: Chart, options: MetricSyncCrosshairOptions, eventX: number): number | null {
  const xScale = chart.scales['x'];
  if (!xScale) {
    return null;
  }

  if (chart.options.interaction?.mode === 'nearest') {
    const activeElement = chart.getActiveElements()[0]?.element;
    if (!activeElement) {
      return null;
    }

    const activeBucket = xScale.getValueForPixel(activeElement.x);
    return typeof activeBucket === 'number' && Number.isFinite(activeBucket) ? activeBucket : null;
  }

  const rawBucket = xScale.getValueForPixel(eventX);
  if (typeof rawBucket !== 'number' || !Number.isFinite(rawBucket)) {
    return null;
  }

  const relativeBucket = (rawBucket - options.windowStartBucket) / options.displayStepSeconds;
  const snappedBucket = options.windowStartBucket + Math.round(relativeBucket) * options.displayStepSeconds;
  return clamp(snappedBucket, options.windowStartBucket, options.windowEndBucket);
}

export function clearMetricSyncCrosshair(): void {
  if (hoverBucketState$$() === null) {
    return;
  }

  hoverBucketState$$.set(null);
  requestCrosshairRedraw();
}

// Touch devices never fire `mouseout` on releasing a chart (Chart.js maps
// touchend to mouseup, not mouseout), so the crosshair would otherwise stick
// forever after a tap — tapping anywhere outside every card is the escape hatch.
function handleOutsideTap(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('metric-chart-card')) {
    return;
  }
  clearMetricSyncCrosshair();
}

export const metricSyncCrosshairPlugin: Plugin<'line' | 'bar'> = {
  id: 'metricSyncCrosshair',
  afterInit(chart) {
    if (registeredCharts.size === 0) {
      document.addEventListener('pointerdown', handleOutsideTap);
    }
    registeredCharts.add(chart);
  },
  afterDestroy(chart) {
    registeredCharts.delete(chart);
    if (registeredCharts.size === 0) {
      hoverBucketState$$.set(null);
      document.removeEventListener('pointerdown', handleOutsideTap);
    }
  },
  afterEvent(chart, args, pluginOptions) {
    const options = readMetricSyncCrosshairOptions(pluginOptions);
    if (!options?.enabled) {
      return;
    }

    if (args.event.type === 'mouseout') {
      clearMetricSyncCrosshair();
      return;
    }

    if (args.event.type !== 'mousemove' || !args.inChartArea) {
      return;
    }

    if (typeof args.event.x !== 'number') {
      return;
    }

    const nextHoverBucket = resolveHoverBucket(chart, options, args.event.x);
    if (nextHoverBucket === null || nextHoverBucket === hoverBucketState$$()) {
      return;
    }

    hoverBucketState$$.set(nextHoverBucket);
    requestCrosshairRedraw();
  },
  afterDraw(chart, _args, pluginOptions) {
    const options = readMetricSyncCrosshairOptions(pluginOptions);
    const currentHoverBucket = hoverBucketState$$();
    if (!options?.enabled || currentHoverBucket === null) {
      return;
    }

    if (currentHoverBucket < options.windowStartBucket || currentHoverBucket > options.windowEndBucket) {
      return;
    }

    const xScale = chart.scales['x'];
    if (!xScale) {
      return;
    }

    const x = xScale.getPixelForValue(currentHoverBucket);
    const { left, right, top, bottom } = chart.chartArea;
    if (x < left || x > right) {
      return;
    }

    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = CROSSHAIR_LINE_WIDTH;
    ctx.strokeStyle = CROSSHAIR_LINE_COLOR;
    ctx.setLineDash(CROSSHAIR_LINE_DASH);
    ctx.stroke();
    ctx.restore();
  },
};
