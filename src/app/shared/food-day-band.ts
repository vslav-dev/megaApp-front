export const FoodDayBand = {
  Under: 'under',
  Normal: 'normal',
  SlightOver: 'slightOver',
  Over: 'over',
} as const;

export type FoodDayBand = (typeof FoodDayBand)[keyof typeof FoodDayBand];

const UNDER_MAX_PERCENT = 50;
const NORMAL_MAX_PERCENT = 101;
const OVER_MIN_PERCENT = 125;

export function resolveFoodDayBand(consumedKcal: number, targetKcal: number): FoodDayBand {
  if (!targetKcal) return FoodDayBand.Normal;
  const percent = (consumedKcal / targetKcal) * 100;
  if (percent < UNDER_MAX_PERCENT) return FoodDayBand.Under;
  if (percent <= NORMAL_MAX_PERCENT) return FoodDayBand.Normal;
  if (percent < OVER_MIN_PERCENT) return FoodDayBand.SlightOver;
  return FoodDayBand.Over;
}

export const FOOD_DAY_BAND_COLOR_VAR: Record<FoodDayBand, string> = {
  [FoodDayBand.Under]: 'var(--v-color-text-muted)',
  [FoodDayBand.Normal]: 'var(--v-color-success)',
  [FoodDayBand.SlightOver]: 'var(--v-color-warning)',
  [FoodDayBand.Over]: 'var(--v-color-danger)',
};

export const FOOD_DAY_BAND_TEXT_COLOR_VAR: Record<FoodDayBand, string> = {
  [FoodDayBand.Under]: 'var(--v-color-text-on-accent)',
  [FoodDayBand.Normal]: 'var(--v-color-text-on-success)',
  [FoodDayBand.SlightOver]: 'var(--v-color-text-on-warning)',
  [FoodDayBand.Over]: 'var(--v-color-text-on-accent)',
};

export const FOOD_DAY_BAND_LABEL: Record<FoodDayBand, string> = {
  [FoodDayBand.Under]: 'Недобор',
  [FoodDayBand.Normal]: 'В норме',
  [FoodDayBand.SlightOver]: 'Небольшой перебор',
  [FoodDayBand.Over]: 'Сильный перебор',
};

export const FOOD_DAY_BAND_RANGE_LABEL: Record<FoodDayBand, string> = {
  [FoodDayBand.Under]: `меньше ${UNDER_MAX_PERCENT}%`,
  [FoodDayBand.Normal]: `${UNDER_MAX_PERCENT}–${NORMAL_MAX_PERCENT}%`,
  [FoodDayBand.SlightOver]: `${NORMAL_MAX_PERCENT}–${OVER_MIN_PERCENT}%`,
  [FoodDayBand.Over]: `от ${OVER_MIN_PERCENT}%`,
};

const FOOD_STREAK_SUCCESS_BANDS: ReadonlySet<FoodDayBand> = new Set([FoodDayBand.Under, FoodDayBand.Normal]);

export function isFoodStreakSuccessBand(band: FoodDayBand): boolean {
  return FOOD_STREAK_SUCCESS_BANDS.has(band);
}
