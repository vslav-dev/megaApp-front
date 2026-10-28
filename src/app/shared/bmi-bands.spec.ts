import { BMI_SCALE, bmiToKg, buildBmiBands } from './bmi-bands';

describe('bmiToKg', () => {
  it('converts BMI to kilograms for a height in centimeters', () => {
    expect(bmiToKg(25, 180)).toBeCloseTo(81, 6);
    expect(bmiToKg(18.5, 100)).toBeCloseTo(18.5, 6);
  });
});

describe('buildBmiBands', () => {
  it('builds one band per category, open-ended at both extremes', () => {
    const bands = buildBmiBands(180, false);

    expect(bands).toHaveLength(BMI_SCALE.length - 1);
    expect(bands[0].fromKg).toBe(-Infinity);
    expect(bands[bands.length - 1].toKg).toBe(Infinity);
  });

  it('keeps bands contiguous: every band starts where the previous one ends', () => {
    const bands = buildBmiBands(173, false);

    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].fromKg).toBe(bands[i - 1].toKg);
    }
  });

  it('places the normal category between BMI 18.5 and 25', () => {
    const normal = buildBmiBands(180, false)[1];

    expect(normal.fromKg).toBeCloseTo(59.94, 6);
    expect(normal.toKg).toBeCloseTo(81, 6);
  });

  it('picks colors by theme', () => {
    expect(buildBmiBands(180, false)[1].color).not.toBe(buildBmiBands(180, true)[1].color);
  });
});
