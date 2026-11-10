import { maxChroma } from './oklch-gamut';

describe('maxChroma', () => {
  it('is zero for black and white, where no chroma fits', () => {
    expect(maxChroma(0, 30)).toBe(0);
    expect(maxChroma(1, 30)).toBe(0);
  });

  it('is larger for red than for blue at the same lightness', () => {
    expect(maxChroma(0.7, 25)).toBeGreaterThan(maxChroma(0.7, 262));
  });

  it('shows why a fixed chroma of 0.2 clips: only some hues reach it at lightness 0.7', () => {
    expect(maxChroma(0.7, 25)).toBeGreaterThan(0.17);
    expect(maxChroma(0.7, 262)).toBeLessThan(0.17);
  });

  it('is largest near mid lightness and shrinks toward black and white', () => {
    expect(maxChroma(0.55, 262)).toBeGreaterThan(maxChroma(0.9, 262));
    expect(maxChroma(0.55, 262)).toBeGreaterThan(maxChroma(0.2, 262));
  });
});
