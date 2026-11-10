// A single reused canvas 2D context for text measurement — creating one per
// call is wasteful, and Canvas.measureText gives pixel-accurate widths for
// any font/string without needing a hand-maintained per-character width table.
let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  measureContext ??= document.createElement('canvas').getContext('2d')!;
  return measureContext;
}

export function measureTextWidthPx(text: string, font: string): number {
  const ctx = getMeasureContext();
  ctx.font = font;
  return ctx.measureText(text).width;
}
