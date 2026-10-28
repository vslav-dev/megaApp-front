import { FoodDayBand, isFoodStreakSuccessBand, resolveFoodDayBand } from './food-day-band';

describe('resolveFoodDayBand', () => {
  it('returns Normal when targetKcal is 0 (avoids division by zero)', () => {
    expect(resolveFoodDayBand(1000, 0)).toBe(FoodDayBand.Normal);
  });

  it('returns Under strictly below 50%', () => {
    expect(resolveFoodDayBand(489, 1000)).toBe(FoodDayBand.Under);
  });

  it('returns Normal exactly at the 50% boundary', () => {
    expect(resolveFoodDayBand(500, 1000)).toBe(FoodDayBand.Normal);
  });

  it('returns Normal exactly at the 101% boundary', () => {
    expect(resolveFoodDayBand(1010, 1000)).toBe(FoodDayBand.Normal);
  });

  it('returns SlightOver just above the 101% boundary', () => {
    expect(resolveFoodDayBand(1011, 1000)).toBe(FoodDayBand.SlightOver);
  });

  it('returns SlightOver just below the 125% boundary', () => {
    expect(resolveFoodDayBand(1249, 1000)).toBe(FoodDayBand.SlightOver);
  });

  it('returns Over at and above the 125% boundary', () => {
    expect(resolveFoodDayBand(1250, 1000)).toBe(FoodDayBand.Over);
    expect(resolveFoodDayBand(2000, 1000)).toBe(FoodDayBand.Over);
  });
});

describe('isFoodStreakSuccessBand', () => {
  it('treats Under and Normal as streak successes', () => {
    expect(isFoodStreakSuccessBand(FoodDayBand.Under)).toBe(true);
    expect(isFoodStreakSuccessBand(FoodDayBand.Normal)).toBe(true);
  });

  it('treats SlightOver and Over as streak failures', () => {
    expect(isFoodStreakSuccessBand(FoodDayBand.SlightOver)).toBe(false);
    expect(isFoodStreakSuccessBand(FoodDayBand.Over)).toBe(false);
  });
});
