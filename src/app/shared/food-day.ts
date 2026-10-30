import { dateToIsoNoTimeNoTZ } from '@app/shared/utils';

// The food day ends at 04:00 local time rather than at midnight: a meal logged at 02:00 still
// belongs to the previous day. Applies to food only — money and metrics use plain calendar days.
export const FOOD_DAY_START_HOUR = 4;

export function foodTodayIso(now: Date = new Date()): string {
  const shifted = new Date(now);
  shifted.setHours(shifted.getHours() - FOOD_DAY_START_HOUR);
  return dateToIsoNoTimeNoTZ(shifted);
}
