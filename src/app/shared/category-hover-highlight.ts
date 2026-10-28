import { WritableSignal } from '@angular/core';
import { Chart, Plugin } from 'chart.js';

// Hovering one category — a bar segment on the chart, or its entry in the legend below it —
// keeps that category's own color everywhere it appears and mutes every other category
// everywhere else. `hoveredCategory$$` is the single source of truth for "which category is
// hovered": the plugin below is the canvas-side writer (via chart.getActiveElements(), the same
// active-element list Chart.js already resolves through its hover interaction mode on every
// relevant event before any plugin's afterEvent runs), the legend rows are the DOM-side writer
// (mouseenter/mouseleave), and both the dataset's scriptable colors and the legend's own opacity
// binding read the same signal — no separate state to keep in sync between the two hover sources
// or the two rendered surfaces (canvas + DOM).
// One signal per chart — hover state must not leak between independent charts (Expense/Income).
export function createCategoryHoverHighlight(hoveredCategory$$: WritableSignal<string | null>): Plugin {
  return {
    id: 'categoryHoverHighlight',
    afterEvent(chart: Chart) {
      const active = chart.getActiveElements();
      const label = active.length ? (chart.data.datasets[active[0].datasetIndex]?.label ?? null) : null;
      hoveredCategory$$.set(label);
    },
  };
}
