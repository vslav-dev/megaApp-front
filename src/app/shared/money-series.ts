import { Category, CategoryType, Transaction, TransactionKind } from '@app/shared/types';

// A "series" is one checkable line in the legend under the expense or income chart. Its id lives in
// one number space per chart: a positive id is a category id, a negative id is a virtual series —
// something the chart shows that is not a category (see below). The same ids are what the settings
// store as "checked", so a transaction's series and a legend checkbox are directly comparable.
export const SeriesChart = {
  EXPENSE: 'expense',
  INCOME: 'income',
} as const;

export type SeriesChart = (typeof SeriesChart)[keyof typeof SeriesChart];

export interface SeriesRef {
  chart: SeriesChart;
  id: number;
}

export const EXPENSE_VIRTUAL_SERIES = {
  UNCATEGORIZED: -1,
} as const;

export const INCOME_VIRTUAL_SERIES = {
  DIVIDENDS: -1,
  CB_CLOSED_PNL: -2,
  CB_OPEN_PNL: -3,
  CRYPTO_CLOSED_PNL: -4,
  CRYPTO_OPEN_PNL: -5,
} as const;

export const EXPENSE_VIRTUAL_SERIES_NAMES = {
  [EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED]: 'Uncategorized',
} as const satisfies Readonly<Record<number, string>>;

export const INCOME_VIRTUAL_SERIES_NAMES: Readonly<Record<number, string>> = {
  [INCOME_VIRTUAL_SERIES.DIVIDENDS]: 'Дивиденды',
  [INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL]: 'ЦБ закрытые',
  [INCOME_VIRTUAL_SERIES.CB_OPEN_PNL]: 'ЦБ открытые',
  [INCOME_VIRTUAL_SERIES.CRYPTO_CLOSED_PNL]: 'Крипта закрытые',
  [INCOME_VIRTUAL_SERIES.CRYPTO_OPEN_PNL]: 'Крипта открытые',
};

// Which income series each buy/sell transaction feeds (see position-lots.ts), by transaction id.
export type TradeSeriesIndex = ReadonlyMap<number, ReadonlySet<number>>;

export type SeriesResolver = (transaction: Transaction) => readonly SeriesRef[];

// An expense with the gift flag always goes to the expense category of this name (the first one, if
// several share it), whatever its own category is — the chart column "Подарок" and the list filter
// both follow this rule.
export const GIFT_CATEGORY_NAME = 'Подарок';

const NO_SERIES: readonly SeriesRef[] = [];
const DIVIDEND_SERIES: readonly SeriesRef[] = [{ chart: SeriesChart.INCOME, id: INCOME_VIRTUAL_SERIES.DIVIDENDS }];
const UNCATEGORIZED_SERIES: readonly SeriesRef[] = [
  { chart: SeriesChart.EXPENSE, id: EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED },
];

// The single place that decides which chart series a transaction feeds — shared by the chart
// builders and the transactions-list filter, so the list can never disagree with a chart. Usually
// zero or one series; a buy/sell can feed several (a partly sold position sits in both the closed
// and the open series). The amount never matters here: a zero expense belongs to its category's
// series like any other (the chart builders skip zero amounts themselves).
//
// tradeSeries is a getter, not a value, on purpose: it is only called for buy/sell transactions,
// so a caller resolving expenses and incomes never depends on the position lots behind it.
export function createSeriesResolver(
  categories: readonly Category[],
  tradeSeries: () => TradeSeriesIndex,
): SeriesResolver {
  const hiddenIds = new Set<number>();
  let giftCategoryId: number | null = null;
  for (const category of categories) {
    if (category.id === undefined) continue;
    if (category.hiddenOnCharts) hiddenIds.add(category.id);
    const isGiftCategory = category.categoryType === CategoryType.EXPENSE && category.name === GIFT_CATEGORY_NAME;
    if (isGiftCategory && giftCategoryId === null) giftCategoryId = category.id;
  }

  return (transaction) => {
    switch (transaction.kind) {
      case TransactionKind.EXPENSE: {
        const categoryId = transaction.isGift && giftCategoryId !== null ? giftCategoryId : transaction.categoryId;
        if (categoryId == null) return UNCATEGORIZED_SERIES;
        return hiddenIds.has(categoryId) ? NO_SERIES : [{ chart: SeriesChart.EXPENSE, id: categoryId }];
      }
      case TransactionKind.INCOME: {
        const categoryId = transaction.categoryId;
        if (transaction.isGift || categoryId == null || hiddenIds.has(categoryId)) return NO_SERIES;
        return [{ chart: SeriesChart.INCOME, id: categoryId }];
      }
      case TransactionKind.INVEST_DIVIDEND:
        return DIVIDEND_SERIES;
      case TransactionKind.INVEST_BUY:
      case TransactionKind.INVEST_SELL: {
        const seriesIds = transaction.id === undefined ? undefined : tradeSeries().get(transaction.id);
        return seriesIds ? Array.from(seriesIds, (id) => ({ chart: SeriesChart.INCOME, id })) : NO_SERIES;
      }
      default:
        return NO_SERIES;
    }
  };
}

export type EnabledSeries = Readonly<Record<SeriesChart, ReadonlySet<number>>>;

export function hasEnabledSeries(refs: readonly SeriesRef[], enabled: EnabledSeries): boolean {
  return refs.some((ref) => enabled[ref.chart].has(ref.id));
}

// The transactions that feed at least one checked series — what the list shows when it follows the charts.
export function filterByEnabledSeries(
  transactions: readonly Transaction[],
  resolveSeries: SeriesResolver,
  enabled: EnabledSeries,
): Transaction[] {
  return transactions.filter((transaction) => hasEnabledSeries(resolveSeries(transaction), enabled));
}
