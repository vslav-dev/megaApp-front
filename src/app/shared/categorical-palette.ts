import type { ChartColors } from '@app/shared/chart-config';
import { maxChroma } from '@app/shared/oklch-gamut';
import type { PaletteTuning } from '@app/shared/types';

// Golden angle: the standard way to place N points around a circle so they stay maximally
// spread regardless of N — no clustering, no fixed palette-length ceiling to wrap around.
const GOLDEN_ANGLE_DEG = 137.508;

// Hue bands reserved for the app's status colors (--v-color-danger/warning/success), so an
// auto-picked category swatch is never mistakable for an error/warning/success indicator
// elsewhere in the UI. Red and orange sit next to each other and are merged into one band.
const STATUS_EXCLUDED_HUE_RANGES: readonly [number, number][] = [
  [350, 360],
  [0, 40],
  [125, 160],
];

// How close (in degrees) an auto-picked hue is allowed to land next to a manually pinned one.
// Pins themselves are exempt from every exclusion rule below — that's the point of choosing one
// deliberately — but auto colors still steer clear of them so a pinned category stays visually
// unique against the rest of the chart.
const PIN_EXCLUSION_RADIUS_DEG = 35;

// The golden-angle scan lands within ~1deg of any point after this many steps, so if none of them
// is allowed, no hue is.
const MAX_AUTO_HUE_ATTEMPTS = 360;

function isStatusExcluded(hue: number): boolean {
  return STATUS_EXCLUDED_HUE_RANGES.some(([start, end]) => hue >= start && hue <= end);
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

// Next golden-angle hue that is neither a status color nor close to a pinned one. `cursor` is the
// caller's scan position, so a palette keeps drawing from where it left off.
function scanAutoHue(cursor: { step: number }, pinnedHues: readonly number[]): number {
  const isExcluded = (candidate: number): boolean =>
    isStatusExcluded(candidate) ||
    pinnedHues.some((pinnedHue) => circularHueDistance(candidate, pinnedHue) < PIN_EXCLUSION_RADIUS_DEG);
  const nextCandidate = (): number => (cursor.step++ * GOLDEN_ANGLE_DEG) % 360;

  for (let attempt = 0; attempt < MAX_AUTO_HUE_ATTEMPTS; attempt++) {
    const hue = nextCandidate();
    if (!isExcluded(hue)) return hue;
  }
  // Pins chosen by the user plus the status bands can cover the whole circle; take the next hue
  // as it is rather than scan forever.
  return nextCandidate();
}

// A chart color is three numbers, which is the least that can reach any color: hue (which color),
// lightness (how light or dark) and saturation (how pure or grey). Saturation is a share of the
// most vivid chroma the screen can show at that hue and lightness (see oklch-gamut.ts), so every
// combination is a real, unclipped color. Perceptually uniform in OKLCH (unlike HSL).
//
// A category sets its own hue, lightness and saturation, or leaves lightness/saturation at the
// user's palette default (one per theme, in settings), which itself starts at DEFAULT_PALETTE_TUNING.
export const DEFAULT_PALETTE_TUNING: PaletteTuning = { lightness: 70, saturation: 100 };

// Slider limits; lightness stops short of black and white, where no color is left to tell apart.
export const PALETTE_LIMITS = {
  lightness: { min: 20, max: 95 },
  saturation: { min: 0, max: 100 },
};

// Alpha for a muted (non-hovered) category segment when another category is highlighted across
// a stacked-bar chart (see category-hover-highlight.ts).
export const CATEGORY_DIM_ALPHA = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// One chart series' color. null lightness/saturation follow the palette default in ChartColors.
export interface SeriesColor {
  hue: number;
  lightness: number | null;
  saturation: number | null;
}

export function seriesColor(series: SeriesColor, colors: ChartColors, alpha?: number): string {
  const lightnessPercent = clamp(
    series.lightness ?? colors.palette.lightness,
    PALETTE_LIMITS.lightness.min,
    PALETTE_LIMITS.lightness.max,
  );
  const saturationPercent = clamp(
    series.saturation ?? colors.palette.saturation,
    PALETTE_LIMITS.saturation.min,
    PALETTE_LIMITS.saturation.max,
  );

  const lightness = lightnessPercent / 100;
  // Rounded down so the printed chroma never lands a hair outside the gamut.
  const chroma = Math.floor((saturationPercent / 100) * maxChroma(lightness, series.hue) * 1000) / 1000;

  const color = `${lightness.toFixed(3)} ${chroma.toFixed(3)} ${series.hue.toFixed(1)}`;
  return alpha === undefined ? `oklch(${color})` : `oklch(${color} / ${alpha})`;
}

// A series' color by id; an id the map does not know (data newer than the categories) gets hue 0.
export function seriesColorById(
  seriesColors: ReadonlyMap<number, SeriesColor>,
  seriesId: number,
  colors: ChartColors,
  alpha?: number,
): string {
  return seriesColor(seriesColors.get(seriesId) ?? { hue: 0, lightness: null, saturation: null }, colors, alpha);
}

// A hue at the palette default lightness and saturation.
export function hueToColor(hue: number, colors: ChartColors, alpha?: number): string {
  return seriesColor({ hue, lightness: null, saturation: null }, colors, alpha);
}

export interface SeriesHueInput {
  id: number;
  // A hue the user picked for this series, or null for "pick one automatically".
  hue: number | null;
}

// Hue of every series of one chart. Pinned series keep their hue; the rest get golden-angle hues
// that avoid status colors and pinned neighbours, handed out in ascending id order. The result
// depends only on the set of series — not on render order, enabled checkboxes or data — so a new
// series (highest id) never recolors the others.
export function assignSeriesHues(series: readonly SeriesHueInput[]): Map<number, number> {
  const hues = new Map<number, number>();
  for (const item of series) {
    if (item.hue !== null) hues.set(item.id, item.hue);
  }
  const pinnedHues = Array.from(hues.values());
  const cursor = { step: 0 };
  const auto = series.filter((item) => item.hue === null).sort((a, b) => a.id - b.id);
  for (const item of auto) hues.set(item.id, scanAutoHue(cursor, pinnedHues));
  return hues;
}

export interface SeriesColorInput extends SeriesHueInput {
  lightness: number | null;
  saturation: number | null;
}

// The color of every series of one chart: its hue from assignSeriesHues, its own lightness and
// saturation if it has them.
export function assignSeriesColors(series: readonly SeriesColorInput[]): Map<number, SeriesColor> {
  const hues = assignSeriesHues(series);
  return new Map(
    series.map((item) => [
      item.id,
      { hue: hues.get(item.id)!, lightness: item.lightness, saturation: item.saturation },
    ]),
  );
}

export interface CategoricalPalette {
  // Stable per-identity categorical color: same `key` always yields the same hue, independent
  // of call order or how many other keys exist. Falls back to the next unclaimed hue in a
  // continuous golden-angle scan the first time a key is seen, shared across every key in this
  // palette so two keys can never collide on the same hue.
  getColor(key: string, colors: ChartColors, alpha?: number): string;
}

// One palette = one independent hue pool (the balance chart's accounts have their own instance).
export function createCategoricalPalette(): CategoricalPalette {
  const assignedHues = new Map<string, number>();
  const cursor = { step: 0 };

  function hueForKey(key: string): number {
    const existing = assignedHues.get(key);
    if (existing !== undefined) return existing;
    const hue = scanAutoHue(cursor, []);
    assignedHues.set(key, hue);
    return hue;
  }

  function getColor(key: string, colors: ChartColors, alpha?: number): string {
    return hueToColor(hueForKey(key), colors, alpha);
  }

  return { getColor };
}
