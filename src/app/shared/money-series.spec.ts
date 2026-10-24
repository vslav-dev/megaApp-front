import {
  EXPENSE_VIRTUAL_SERIES,
  INCOME_VIRTUAL_SERIES,
  SeriesChart,
  SeriesRef,
  TradeSeriesIndex,
  createSeriesResolver,
  filterByEnabledSeries,
  hasEnabledSeries,
} from './money-series';
import { Category, CategoryType, Transaction, TransactionKind } from './types';

const EMPTY_TRADE_INDEX: TradeSeriesIndex = new Map();

function category(overrides: Partial<Category> & { id: number }): Category {
  return { name: `Category ${overrides.id}`, categoryType: CategoryType.EXPENSE, ...overrides };
}

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1,
    dateISO: '2026-01-15',
    accountId: 1,
    amount: 100,
    kind: TransactionKind.EXPENSE,
    isGift: false,
    ...overrides,
  };
}

function expenseSeries(id: number): SeriesRef {
  return { chart: SeriesChart.EXPENSE, id };
}

function incomeSeries(id: number): SeriesRef {
  return { chart: SeriesChart.INCOME, id };
}

describe('createSeriesResolver', () => {
  const categories: Category[] = [
    category({ id: 1, name: 'Еда' }),
    category({ id: 2, name: 'Подарок' }),
    category({ id: 3, name: 'Технический гэп', hiddenOnCharts: true }),
    category({ id: 4, name: 'Зарплата', categoryType: CategoryType.INCOME }),
    category({ id: 5, name: 'Дар', categoryType: CategoryType.INCOME, hiddenOnCharts: true }),
  ];
  const resolve = createSeriesResolver(categories, () => EMPTY_TRADE_INDEX);

  it('maps an expense to its own category series', () => {
    expect(resolve(tx({ categoryId: 1 }))).toEqual([expenseSeries(1)]);
  });

  it('maps an expense without a category to the virtual uncategorized series', () => {
    expect(resolve(tx({ categoryId: null }))).toEqual([expenseSeries(EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED)]);
  });

  it('sends a gift expense to the "Подарок" category whatever its own category is', () => {
    expect(resolve(tx({ categoryId: 1, isGift: true }))).toEqual([expenseSeries(2)]);
    expect(resolve(tx({ categoryId: null, isGift: true }))).toEqual([expenseSeries(2)]);
    expect(resolve(tx({ categoryId: 2 }))).toEqual([expenseSeries(2)]);
  });

  it('keeps a gift expense in its own category when there is no "Подарок" category', () => {
    const withoutCollector = createSeriesResolver([category({ id: 1 })], () => EMPTY_TRADE_INDEX);
    expect(withoutCollector(tx({ categoryId: 1, isGift: true }))).toEqual([expenseSeries(1)]);
  });

  it('sends gifts to the first expense category named "Подарок" when several share the name', () => {
    const twins = createSeriesResolver(
      [category({ id: 1 }), category({ id: 7, name: 'Подарок' }), category({ id: 8, name: 'Подарок' })],
      () => EMPTY_TRADE_INDEX,
    );
    expect(twins(tx({ categoryId: 1, isGift: true }))).toEqual([expenseSeries(7)]);
  });

  it('drops an expense whose series category is hidden — for a gift, the "Подарок" category is what counts', () => {
    expect(resolve(tx({ categoryId: 3 }))).toEqual([]);
    expect(resolve(tx({ categoryId: 3, isGift: true }))).toEqual([expenseSeries(2)]);

    const hiddenCollector = createSeriesResolver(
      [category({ id: 1 }), category({ id: 2, name: 'Подарок', hiddenOnCharts: true })],
      () => EMPTY_TRADE_INDEX,
    );
    expect(hiddenCollector(tx({ categoryId: 1, isGift: true }))).toEqual([]);
  });

  it('ignores the amount: a zero expense belongs to its category series like any other', () => {
    expect(resolve(tx({ categoryId: 1, amount: 0 }))).toEqual([expenseSeries(1)]);
  });

  it('maps an income to its category series, and drops gift, uncategorized and hidden ones', () => {
    expect(resolve(tx({ kind: TransactionKind.INCOME, categoryId: 4 }))).toEqual([incomeSeries(4)]);
    expect(resolve(tx({ kind: TransactionKind.INCOME, categoryId: 4, isGift: true }))).toEqual([]);
    expect(resolve(tx({ kind: TransactionKind.INCOME, categoryId: null }))).toEqual([]);
    expect(resolve(tx({ kind: TransactionKind.INCOME, categoryId: 5 }))).toEqual([]);
  });

  it('maps a dividend to the virtual dividends series', () => {
    expect(resolve(tx({ kind: TransactionKind.INVEST_DIVIDEND }))).toEqual([
      incomeSeries(INCOME_VIRTUAL_SERIES.DIVIDENDS),
    ]);
  });

  it('drops a transfer', () => {
    expect(resolve(tx({ kind: TransactionKind.TRANSFER }))).toEqual([]);
  });

  it('maps a buy/sell to the series the position lots assigned it, and drops one without any', () => {
    const tradeSeries: TradeSeriesIndex = new Map([
      [10, new Set([INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL, INCOME_VIRTUAL_SERIES.CB_OPEN_PNL])],
    ]);
    const withTrades = createSeriesResolver(categories, () => tradeSeries);

    expect(withTrades(tx({ id: 10, kind: TransactionKind.INVEST_BUY }))).toEqual([
      incomeSeries(INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL),
      incomeSeries(INCOME_VIRTUAL_SERIES.CB_OPEN_PNL),
    ]);
    expect(withTrades(tx({ id: 11, kind: TransactionKind.INVEST_SELL }))).toEqual([]);
    expect(withTrades(tx({ id: undefined, kind: TransactionKind.INVEST_BUY }))).toEqual([]);
  });

  it('reads the trade index only when a buy/sell is resolved', () => {
    let reads = 0;
    const lazy = createSeriesResolver(categories, () => {
      reads++;
      return EMPTY_TRADE_INDEX;
    });
    lazy(tx({ categoryId: 1 }));
    lazy(tx({ kind: TransactionKind.INCOME, categoryId: 4 }));
    lazy(tx({ kind: TransactionKind.INVEST_DIVIDEND }));
    expect(reads).toBe(0);
    lazy(tx({ kind: TransactionKind.INVEST_BUY }));
    expect(reads).toBe(1);
  });
});

describe('filterByEnabledSeries', () => {
  const resolve = createSeriesResolver(
    [
      category({ id: 1 }),
      category({ id: 2, name: 'Подарок' }),
      category({ id: 3, hiddenOnCharts: true }),
      category({ id: 4, categoryType: CategoryType.INCOME }),
    ],
    () => new Map([[20, new Set([INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL])]]),
  );
  const transactions: Transaction[] = [
    tx({ id: 1, categoryId: 1 }),
    tx({ id: 2, categoryId: 1, isGift: true }),
    tx({ id: 3, categoryId: 3 }),
    tx({ id: 4, categoryId: null }),
    tx({ id: 5, kind: TransactionKind.INCOME, categoryId: 4 }),
    tx({ id: 6, kind: TransactionKind.INVEST_DIVIDEND }),
    tx({ id: 20, kind: TransactionKind.INVEST_BUY }),
    tx({ id: 21, kind: TransactionKind.INVEST_BUY }),
    tx({ id: 7, kind: TransactionKind.TRANSFER }),
    tx({ id: 8, categoryId: 1, amount: 0 }),
  ];
  const idsOf = (list: Transaction[]) => list.map((t) => t.id);
  const none = new Set<number>();

  it('keeps nothing when no series is checked', () => {
    expect(filterByEnabledSeries(transactions, resolve, { expense: none, income: none })).toEqual([]);
  });

  it('follows the expense legend: a category, "Подарок", uncategorized — and zero amounts too', () => {
    const only = (...ids: number[]) =>
      idsOf(filterByEnabledSeries(transactions, resolve, { expense: new Set(ids), income: none }));

    expect(only(1)).toEqual([1, 8]);
    expect(only(2)).toEqual([2]);
    expect(only(EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED)).toEqual([4]);
    expect(only(1, 2, EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED)).toEqual([1, 2, 4, 8]);
  });

  it('follows the income legend: categories, dividends and the position series', () => {
    const only = (...ids: number[]) =>
      idsOf(filterByEnabledSeries(transactions, resolve, { expense: none, income: new Set(ids) }));

    expect(only(4)).toEqual([5]);
    expect(only(INCOME_VIRTUAL_SERIES.DIVIDENDS)).toEqual([6]);
    expect(only(INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL)).toEqual([20]);
    expect(only(INCOME_VIRTUAL_SERIES.CB_OPEN_PNL)).toEqual([]);
  });

  it('never lists transfers or hidden categories, whatever is checked', () => {
    const everything = new Set([1, 2, 3, 4, -1, -2, -3, -4, -5]);
    const result = idsOf(filterByEnabledSeries(transactions, resolve, { expense: everything, income: everything }));
    expect(result).not.toContain(7);
    expect(result).not.toContain(3);
    expect(result).not.toContain(21);
  });
});

describe('hasEnabledSeries', () => {
  const enabled = {
    [SeriesChart.EXPENSE]: new Set([1]),
    [SeriesChart.INCOME]: new Set([4, INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL]),
  };

  it('is true when any series is checked on its own chart', () => {
    expect(hasEnabledSeries([expenseSeries(1)], enabled)).toBe(true);
    expect(
      hasEnabledSeries(
        [incomeSeries(INCOME_VIRTUAL_SERIES.CB_OPEN_PNL), incomeSeries(INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL)],
        enabled,
      ),
    ).toBe(true);
  });

  it('is false for unchecked series, the same id on the other chart, and no series at all', () => {
    expect(hasEnabledSeries([expenseSeries(2)], enabled)).toBe(false);
    expect(hasEnabledSeries([expenseSeries(4)], enabled)).toBe(false);
    expect(hasEnabledSeries([incomeSeries(1)], enabled)).toBe(false);
    expect(hasEnabledSeries([], enabled)).toBe(false);
  });
});
