// How vivid an OKLCH color can be while still fitting the sRGB screen gamut. Each hue has its own
// limit that also depends on lightness: at lightness 0.7 red reaches chroma ~0.2, blue only ~0.13.
// Asking for more than the limit makes the browser clip the color. Expressing saturation as a share
// of this limit (0-100%) makes every slider position a color that exists, for every hue and
// lightness, and lets hue + lightness + saturation reach any sRGB color. Hue is in degrees.

const MAX_SEARCHED_CHROMA = 0.4;
const CHROMA_SEARCH_STEPS = 24;

function isInSrgbGamut(lightness: number, chroma: number, hue: number): boolean {
  const hueRad = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueRad);
  const b = chroma * Math.sin(hueRad);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return channels.every((channel) => channel >= 0 && channel <= 1);
}

// Largest chroma at this lightness and hue that still fits sRGB.
export function maxChroma(lightness: number, hue: number): number {
  let inside = 0;
  let outside = MAX_SEARCHED_CHROMA;
  for (let step = 0; step < CHROMA_SEARCH_STEPS; step++) {
    const middle = (inside + outside) / 2;
    if (isInSrgbGamut(lightness, middle, hue)) inside = middle;
    else outside = middle;
  }
  return inside;
}
