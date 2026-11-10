import { BmiBand } from './bmi-bands';
import { computeBmiBandSpans } from './bmi-bands-plugin';

// Y axis growing upwards: 100 px at 60 kg, 0 px at 80 kg (5 px per kg).
const pixelFor = (kg: number): number => 100 - (kg - 60) * 5;

const bands: BmiBand[] = [
  { fromKg: -Infinity, toKg: 62, color: 'under' },
  { fromKg: 62, toKg: 75, color: 'normal' },
  { fromKg: 75, toKg: 90, color: 'over' },
  { fromKg: 90, toKg: Infinity, color: 'obese' },
];

describe('computeBmiBandSpans', () => {
  it('clamps open-ended and overflowing bands to the visible axis range', () => {
    const spans = computeBmiBandSpans(bands, 60, 80, pixelFor);

    expect(spans).toEqual([
      { top: 90, bottom: 100, color: 'under' },
      { top: 25, bottom: 90, color: 'normal' },
      { top: 0, bottom: 25, color: 'over' },
    ]);
  });

  it('drops bands entirely outside the visible axis range', () => {
    const spans = computeBmiBandSpans(bands, 64, 70, pixelFor);

    expect(spans.map((span) => span.color)).toEqual(['normal']);
  });

  it('returns nothing when there are no bands', () => {
    expect(computeBmiBandSpans([], 60, 80, pixelFor)).toEqual([]);
  });

  it('always yields spans with top above bottom', () => {
    for (const span of computeBmiBandSpans(bands, 55, 95, pixelFor)) {
      expect(span.top).toBeLessThan(span.bottom);
    }
  });
});
