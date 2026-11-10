export const FoodStatsBlock = {
  Streak: 'streak',
  TopProducts: 'topProducts',
  Milestones: 'milestones',
  Charts: 'charts',
  ProductHistory: 'productHistory',
} as const;

export type FoodStatsBlock = (typeof FoodStatsBlock)[keyof typeof FoodStatsBlock];

const SINGLE_COLUMN_ORDER: FoodStatsBlock[] = [
  FoodStatsBlock.Streak,
  FoodStatsBlock.Milestones,
  FoodStatsBlock.Charts,
  FoodStatsBlock.ProductHistory,
  FoodStatsBlock.TopProducts,
];

// Used by the mobile accordion, which always renders as one stacked column.
export function getFoodStatsBlockOrder(): FoodStatsBlock[] {
  return SINGLE_COLUMN_ORDER;
}

const TWO_COLUMN_LAYOUT: FoodStatsBlock[][] = [
  [FoodStatsBlock.Streak, FoodStatsBlock.Milestones, FoodStatsBlock.TopProducts],
  [FoodStatsBlock.Charts, FoodStatsBlock.ProductHistory],
];

const THREE_COLUMN_LAYOUT: FoodStatsBlock[][] = [
  [FoodStatsBlock.Streak, FoodStatsBlock.Milestones],
  [FoodStatsBlock.Charts],
  [FoodStatsBlock.ProductHistory, FoodStatsBlock.TopProducts],
];

// Desktop grid layout, one entry per stats column (see food-stats-columns). Fixed per column
// count rather than a generic distribution — Streak+Milestones always share the column left of
// the diary, Charts and TopProducts split apart only once there's a 3rd stats column.
export function getFoodStatsColumns(columnCount: number): FoodStatsBlock[][] {
  if (columnCount <= 1) return [SINGLE_COLUMN_ORDER];
  if (columnCount === 2) return TWO_COLUMN_LAYOUT;
  if (columnCount === 3) return THREE_COLUMN_LAYOUT;
  // Beyond the specified layouts (very wide screens): keep the 3-column shape, extra columns empty.
  return [...THREE_COLUMN_LAYOUT, ...Array.from({ length: columnCount - 3 }, (): FoodStatsBlock[] => [])];
}
