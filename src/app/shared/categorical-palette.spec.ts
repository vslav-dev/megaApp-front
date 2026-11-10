import type { ChartColors } from '@app/shared/chart-config';
import {
  assignSeriesColors,
  assignSeriesHues,
  createCategoricalPalette,
  DEFAULT_PALETTE_TUNING,
  hueToColor,
  SeriesColor,
  seriesColor,
  seriesColorById,
} from './categorical-palette';

const colors: ChartColors = {
  main: '',
  mainAlpha: '',
  secondary: '',
  secondaryAlpha: '',
  text: '',
  grid: '',
  isDark: false,
  palette: DEFAULT_PALETTE_TUNING,
};

// Mirrors the private STATUS_EXCLUDED_HUE_RANGES in categorical-palette.ts — kept in the test
// deliberately (not imported, it's not exported), so this asserts the observable contract
// ("auto hues never land here") rather than reaching into the implementation.
const STATUS_EXCLUDED_HUE_RANGES: readonly [number, number][] = [
  [350, 360],
  [0, 40],
  [125, 160],
];

function isInExcludedRange(hue: number): boolean {
  return STATUS_EXCLUDED_HUE_RANGES.some(([start, end]) => hue >= start && hue <= end);
}

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function hueOf(colorString: string): number {
  const match = colorString.match(/^oklch\([\d.]+ [\d.]+ (-?[\d.]+)\)$/);
  if (!match) throw new Error(`unexpected color string format: ${colorString}`);
  return Number(match[1]);
}

describe('createCategoricalPalette', () => {
  it('returns the same color for the same key on repeated calls', () => {
    const palette = createCategoricalPalette();
    const first = palette.getColor('expenses', colors);
    const second = palette.getColor('expenses', colors);
    expect(second).toBe(first);
  });

  it('never auto-assigns a hue inside a status-excluded range', () => {
    const palette = createCategoricalPalette();
    for (let i = 0; i < 20; i++) {
      const hue = hueOf(palette.getColor(`category-${i}`, colors));
      expect(isInExcludedRange(hue)).toBe(false);
    }
  });

  it('assigns pairwise distinct hues to distinct auto-assigned keys', () => {
    const palette = createCategoricalPalette();
    const hues = Array.from({ length: 10 }, (_, i) => hueOf(palette.getColor(`category-${i}`, colors)));
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('keeps palette instances independent: every one starts from the same first hue', () => {
    const paletteA = createCategoricalPalette();
    const paletteB = createCategoricalPalette();
    const firstOfA = hueOf(paletteA.getColor('a1', colors));
    paletteA.getColor('a2', colors);

    expect(hueOf(paletteB.getColor('b1', colors))).toBe(firstOfA);
  });

  it('applies alpha suffix only when alpha is provided', () => {
    const palette = createCategoricalPalette();
    const opaque = palette.getColor('with-alpha', colors);
    const transparent = palette.getColor('with-alpha', colors, 0.5);
    expect(opaque).not.toContain('/');
    expect(transparent).toBe(`${opaque.slice(0, -1)} / 0.5)`);
  });
});

describe('assignSeriesHues', () => {
  const series = (...entries: [number, number | null][]) => entries.map(([id, hue]) => ({ id, hue }));

  it('keeps a pinned hue exactly, even inside a status-excluded range', () => {
    const hues = assignSeriesHues(series([1, 10], [2, null]));
    expect(hues.get(1)).toBe(10);
  });

  it('gives auto series distinct hues outside status ranges and away from pinned ones', () => {
    const hues = assignSeriesHues(
      series([1, 200], ...Array.from({ length: 12 }, (_, i): [number, null] => [i + 2, null])),
    );
    const autoHues = [...hues.entries()].filter(([id]) => id !== 1).map(([, hue]) => hue);
    expect(new Set(autoHues).size).toBe(autoHues.length);
    for (const hue of autoHues) {
      expect(isInExcludedRange(hue)).toBe(false);
      expect(circularHueDistance(hue, 200)).toBeGreaterThanOrEqual(35);
    }
  });

  it('still terminates and hands out hues when the pins and status bands leave no free hue', () => {
    const pins: [number, number | null][] = [50, 110, 170, 230, 290, 350].map((hue, i) => [i + 1, hue]);
    const hues = assignSeriesHues(series(...pins, [10, null], [11, null]));
    expect(hues.size).toBe(8);
    for (const id of [10, 11]) expect(hues.get(id)).toBeGreaterThanOrEqual(0);
    expect(hues.get(10)).not.toBe(hues.get(11));
  });

  it('does not depend on the input order', () => {
    const forward = assignSeriesHues(series([-2, null], [-1, null], [3, null], [7, 90]));
    const reversed = assignSeriesHues(series([7, 90], [3, null], [-1, null], [-2, null]));
    expect([...forward.entries()].sort()).toEqual([...reversed.entries()].sort());
  });

  it('does not recolor existing series when a series with a higher id is added', () => {
    const before = assignSeriesHues(series([1, null], [2, null], [3, 250]));
    const after = assignSeriesHues(series([1, null], [2, null], [3, 250], [9, null]));
    expect(after.get(1)).toBe(before.get(1));
    expect(after.get(2)).toBe(before.get(2));
  });

  it('formats a hue as an oklch color with optional alpha', () => {
    expect(hueToColor(142, colors)).toMatch(/^oklch\([\d.]+ [\d.]+ 142\.0\)$/);
    expect(hueToColor(142, colors, 0.25)).toMatch(/^oklch\([\d.]+ [\d.]+ 142\.0 \/ 0\.25\)$/);
  });
});

describe('seriesColor', () => {
  function lightnessAndChroma(color: string): { lightness: number; chroma: number } {
    const match = color.match(/^oklch\(([\d.]+) ([\d.]+) /);
    if (!match) throw new Error(`unexpected color string format: ${color}`);
    return { lightness: Number(match[1]), chroma: Number(match[2]) };
  }

  const withPalette = (lightness: number, saturation: number): ChartColors => ({
    ...colors,
    palette: { lightness, saturation },
  });
  const own = (hue: number, lightness: number | null, saturation: number | null): SeriesColor => ({
    hue,
    lightness,
    saturation,
  });

  it('gives every hue the same default lightness: the default is one value, not a per-hue table', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      expect(lightnessAndChroma(hueToColor(hue, colors)).lightness).toBe(DEFAULT_PALETTE_TUNING.lightness / 100);
    }
  });

  it('follows the palette default for lightness and saturation a series leaves unset', () => {
    const defaulted = seriesColor(own(262, null, null), withPalette(40, 50));
    expect(defaulted).toBe(hueToColor(262, withPalette(40, 50)));
    expect(lightnessAndChroma(defaulted).lightness).toBe(0.4);
  });

  it('lets a series override the palette default per value', () => {
    const colorsWithDefault = withPalette(70, 100);
    const ownLightness = lightnessAndChroma(seriesColor(own(262, 40, null), colorsWithDefault));
    const ownSaturation = lightnessAndChroma(seriesColor(own(262, null, 30), colorsWithDefault));
    const base = lightnessAndChroma(seriesColor(own(262, null, null), colorsWithDefault));

    expect(ownLightness.lightness).toBe(0.4);
    expect(ownSaturation.lightness).toBe(base.lightness);
    expect(ownSaturation.chroma).toBeLessThan(base.chroma);
  });

  it('scales chroma with saturation and gives grey at zero', () => {
    const full = lightnessAndChroma(seriesColor(own(262, 60, 100), colors)).chroma;
    const half = lightnessAndChroma(seriesColor(own(262, 60, 50), colors)).chroma;
    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full / 2, 2);
    expect(lightnessAndChroma(seriesColor(own(262, 60, 0), colors)).chroma).toBe(0);
  });

  it('reaches different chroma for different hues at 100% saturation: it is a share of what fits the screen', () => {
    const red = lightnessAndChroma(seriesColor(own(25, 70, 100), colors)).chroma;
    const blue = lightnessAndChroma(seriesColor(own(262, 70, 100), colors)).chroma;
    expect(red).toBeGreaterThan(blue);
  });

  it('survives out-of-range values from stored data', () => {
    const { lightness } = lightnessAndChroma(seriesColor(own(262, 500, 900), colors));
    expect(lightness).toBeLessThanOrEqual(0.95);
    expect(lightnessAndChroma(seriesColor(own(262, -5, -5), colors)).lightness).toBeGreaterThanOrEqual(0.2);
  });
});

describe('seriesColorById', () => {
  it('uses hue 0 for an id the map does not know', () => {
    expect(seriesColorById(new Map(), 99, colors)).toBe(hueToColor(0, colors));
  });
});

describe('assignSeriesColors', () => {
  it('keeps each series own lightness and saturation next to its assigned hue', () => {
    const result = assignSeriesColors([
      { id: 1, hue: 200, lightness: 40, saturation: null },
      { id: 2, hue: null, lightness: null, saturation: 70 },
    ]);
    expect(result.get(1)).toEqual({ hue: 200, lightness: 40, saturation: null });
    expect(result.get(2)).toEqual({
      hue: assignSeriesHues([{ id: 2, hue: null }]).get(2),
      lightness: null,
      saturation: 70,
    });
  });
});
