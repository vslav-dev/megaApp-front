import { foodTodayIso } from '@app/shared/food-day';

describe('foodTodayIso', () => {
  it('keeps the night hours before the cutoff on the previous day', () => {
    expect(foodTodayIso(new Date(2026, 7, 19, 0, 30))).toBe('2026-08-18');
    expect(foodTodayIso(new Date(2026, 7, 19, 3, 59))).toBe('2026-08-18');
  });

  it('starts the new day at the cutoff hour', () => {
    expect(foodTodayIso(new Date(2026, 7, 19, 4, 0))).toBe('2026-08-19');
    expect(foodTodayIso(new Date(2026, 7, 19, 23, 59))).toBe('2026-08-19');
  });

  it('crosses month and year boundaries', () => {
    expect(foodTodayIso(new Date(2026, 0, 1, 2, 0))).toBe('2025-12-31');
  });

  it('does not mutate the given date', () => {
    const input = new Date(2026, 7, 19, 2, 0);
    foodTodayIso(input);
    expect(input.getHours()).toBe(2);
  });
});
