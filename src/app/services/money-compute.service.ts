import { Service, Signal, computed, inject, signal } from '@angular/core';
import { SeriesColor, SeriesColorInput, assignSeriesColors } from '../shared/categorical-palette';
import { EXPENSE_SERIES_ORDER, INCOME_SERIES_ORDER, seriesOrderIndex } from '../shared/chart-config';
import {
  EXPENSE_VIRTUAL_SERIES,
  EXPENSE_VIRTUAL_SERIES_NAMES,
  INCOME_VIRTUAL_SERIES,
  INCOME_VIRTUAL_SERIES_NAMES,
  SeriesChart,
  SeriesResolver,
  createSeriesResolver,
} from '../shared/money-series';
import {
  areArraysShallowEqual,
  convertAmount,
  generateMonthRange,
  parseTransactionDetails,
  toPositiveNumber,
} from '../shared/money-utils';
import { buildPositionLots, buildTradeSeriesIndex } from '../shared/position-lots';
import {
  Account,
  Asset,
  BalanceChartAccountSeries,
  BalanceChartData,
  Category,
  CategoryType,
  Currency,
  ExpenseCategory,
  ExpenseChartData,
  IncomeChartCategorySeries,
  IncomeChartData,
  SeriesShare,
  Transaction,
  TransactionKind,
} from '../shared/types';
import { MoneyService } from './money.service';
import { TelemetryService } from './telemetry.service';

// Native-currency monthly sums. income/expense are keyed month → account → series id (see money-series.ts);
// dividends sit in the income buckets under their virtual series.
interface MonthlyBuckets {
  accountDelta: Record<string, Record<number, number>>;
  fxInvestDelta: Record<string, Record<number, number>>;
  brokerDelta: Record<string, Record<string, number>>;
  income: Record<string, Record<number, Record<number, number>>>;
  expense: Record<string, Record<number, Record<number, number>>>;
}

export interface CategoryColorDraft extends SeriesColorInput {
  categoryType: CategoryType;
}

// The colors preview shows the typical chart: an average over the last year.
const SHARE_WINDOW_MONTHS = 12;

// Series with a positive total, as shares of their sum, ordered like the chart stacks them (names
// not in `order` keep their relative order, after the listed ones).
function toSeriesShares(
  totals: ReadonlyMap<number, number>,
  names: ReadonlyMap<number, string>,
  order: readonly string[],
): SeriesShare[] {
  const positive = [...names].filter(([id]) => (totals.get(id) ?? 0) > 0);
  const grandTotal = positive.reduce((sum, [id]) => sum + totals.get(id)!, 0);
  return positive
    .sort(([, a], [, b]) => seriesOrderIndex(order, a) - seriesOrderIndex(order, b))
    .map(([id, name]) => ({ id, name, share: totals.get(id)! / grandTotal }));
}

@Service()
export class MoneyComputeService {
  private readonly moneyService = inject(MoneyService);
  private readonly telemetry = inject(TelemetryService);
  private readonly fxTickers = new Set(['USD', 'EUR']);

  private readonly accountTickers$$: Signal<Map<number, string>> = computed(() => {
    const currencyById = new Map(this.moneyService.currencies$$().map((c) => [c.id, c]));
    const tickers = new Map<number, string>();
    for (const account of this.moneyService.accounts$$()) {
      const currency = account.id ? currencyById.get(account.currencyId) : undefined;
      if (currency) tickers.set(account.id!, currency.ticker);
    }
    return tickers;
  });

  private readonly assetById$$ = computed(() => {
    const assetById = new Map<number, Asset>();
    for (const asset of this.moneyService.assets$$()) {
      if (asset.id !== undefined) assetById.set(asset.id, asset);
    }
    return assetById;
  });

  // Only buys/sells feed the position lots. Compared element by element, so editing an expense
  // (which keeps every other transaction object) does not recompute the lots.
  private readonly tradeTransactions$$ = computed(
    () =>
      this.moneyService
        .transactions$$()
        .filter((tx) => tx.kind === TransactionKind.INVEST_BUY || tx.kind === TransactionKind.INVEST_SELL),
    { equal: areArraysShallowEqual },
  );

  private readonly positionLots$$ = computed(() =>
    this.telemetry.measure(
      'money.position_lots',
      () =>
        buildPositionLots({
          transactions: this.tradeTransactions$$(),
          assetById: this.assetById$$(),
          accountTickers: this.accountTickers$$(),
          targetTicker: this.moneyService.displayCurrency$$(),
          getRatesForDate: (dateISO) => this.moneyService.getRatesForDate(dateISO),
          now: new Date(),
        }),
      (result) => ({ lots: result.length }),
    ),
  );

  private readonly tradeSeriesIndex$$ = computed(() => buildTradeSeriesIndex(this.positionLots$$()));

  // Which chart series a transaction feeds. Depends on the categories only; the position lots behind
  // buy/sell series are read lazily, so charts resolving expenses/incomes never wait for them.
  public readonly seriesResolver$$: Signal<SeriesResolver> = computed(() =>
    createSeriesResolver(this.moneyService.categories$$(), () => this.tradeSeriesIndex$$()),
  );

  // A category color being edited in the category form, shown on the charts before it is saved.
  private readonly colorDraft$$ = signal<CategoryColorDraft | null>(null);

  public readonly expenseSeriesColors$$: Signal<Map<number, SeriesColor>> = computed(() =>
    this.buildSeriesColors(
      CategoryType.EXPENSE,
      Object.values(EXPENSE_VIRTUAL_SERIES),
      this.draftFor(CategoryType.EXPENSE),
    ),
  );

  public readonly incomeSeriesColors$$: Signal<Map<number, SeriesColor>> = computed(() =>
    this.buildSeriesColors(
      CategoryType.INCOME,
      Object.values(INCOME_VIRTUAL_SERIES),
      this.draftFor(CategoryType.INCOME),
    ),
  );

  public setColorDraft(draft: CategoryColorDraft | null): void {
    this.colorDraft$$.set(draft);
  }

  // How much of the last year's total each series is, in the order the chart stacks them.
  public readonly expenseSeriesShares$$: Signal<SeriesShare[]> = computed(() => this.buildExpenseSeriesShares());

  public readonly incomeSeriesShares$$: Signal<SeriesShare[]> = computed(() => this.buildIncomeSeriesShares());

  // The colors a chart would have if `draft` were saved as a category's color — the live preview in
  // the category form. The draft replaces the stored category with that id, or joins as a new one.
  public previewSeriesColors(categoryType: CategoryType, draft: SeriesColorInput): Map<number, SeriesColor> {
    const virtualSeriesIds =
      categoryType === CategoryType.EXPENSE
        ? Object.values(EXPENSE_VIRTUAL_SERIES)
        : Object.values(INCOME_VIRTUAL_SERIES);
    return this.buildSeriesColors(categoryType, virtualSeriesIds, draft);
  }

  private readonly monthlyBuckets$$: Signal<MonthlyBuckets> = computed(() =>
    this.telemetry.measure(
      'money.monthly_buckets',
      () =>
        this.buildBuckets(
          this.moneyService.transactions$$(),
          this.moneyService.accounts$$(),
          this.moneyService.currencies$$(),
          this.seriesResolver$$(),
        ),
      (result) => ({
        transactions: this.moneyService.transactions$$().length,
        months: Object.keys(result.accountDelta).length,
      }),
    ),
  );

  public readonly balanceChartData$$: Signal<BalanceChartData> = computed(() =>
    this.telemetry.measure(
      'money.balance_model',
      () => this.buildBalanceChartData(),
      (result) => ({
        months: result.dates.length,
        series: result.accountSeries.length,
      }),
    ),
  );

  public readonly incomeChartData$$: Signal<IncomeChartData> = computed(() =>
    this.telemetry.measure(
      'money.income_model',
      () => this.buildIncomeChartData(),
      (result) => ({
        months: result.months.length,
        series: result.categorySeries.length,
      }),
    ),
  );

  public readonly expenseChartData$$: Signal<ExpenseChartData> = computed(() =>
    this.telemetry.measure(
      'money.expense_model',
      () => this.buildExpenseChartData(),
      (result) => ({
        months: result.monthRows.length,
        categories: result.categories.length,
      }),
    ),
  );

  // ── Bucket builder ────────────────────────────────────────────────────────

  private buildBuckets(
    transactions: Transaction[],
    accounts: Account[],
    currencies: Currency[],
    resolveSeries: SeriesResolver,
  ): MonthlyBuckets {
    const buckets: MonthlyBuckets = {
      accountDelta: {},
      fxInvestDelta: {},
      brokerDelta: {},
      income: {},
      expense: {},
    };

    const currencyById = new Map(currencies.map((c) => [c.id, c]));
    const fxInvestAccountIds = new Set<number>();
    accounts.forEach((a) => {
      if (!a.id || a.kind !== 'cash' || !a.isInvest) return;
      const currency = currencyById.get(a.currencyId);
      if (currency && this.fxTickers.has(currency.ticker)) fxInvestAccountIds.add(a.id);
    });

    for (const tx of transactions) {
      const { accountId, amount, kind } = tx;
      // A zero income/expense (e.g. a refunded order) carries nothing: no balance delta, no phantom chart series.
      if (amount === 0 && (kind === TransactionKind.INCOME || kind === TransactionKind.EXPENSE)) continue;
      const month = tx.dateISO.substring(0, 7);

      const cashDelta = this.getTxCashDelta(tx);
      if (cashDelta !== 0) {
        buckets.accountDelta[month] ??= {};
        buckets.accountDelta[month][accountId] = (buckets.accountDelta[month][accountId] ?? 0) + cashDelta;
      }

      if (fxInvestAccountIds.has(accountId) && kind === TransactionKind.TRANSFER && cashDelta !== 0) {
        buckets.fxInvestDelta[month] ??= {};
        buckets.fxInvestDelta[month][accountId] = (buckets.fxInvestDelta[month][accountId] ?? 0) + cashDelta;
      }

      if (kind === TransactionKind.INVEST_BUY || kind === TransactionKind.INVEST_SELL) {
        const details = parseTransactionDetails(tx.detailsJSON);
        const assetId = toPositiveNumber(details?.assetId);
        const quantity = toPositiveNumber(details?.quantity);
        if (assetId != null && quantity != null) {
          const key = `${accountId}:${assetId}`;
          buckets.brokerDelta[month] ??= {};
          buckets.brokerDelta[month][key] =
            (buckets.brokerDelta[month][key] ?? 0) + (kind === TransactionKind.INVEST_BUY ? quantity : -quantity);
        }
      }

      // Only these kinds are summed per transaction; buy/sell results come from the position lots.
      if (
        kind !== TransactionKind.EXPENSE &&
        kind !== TransactionKind.INCOME &&
        kind !== TransactionKind.INVEST_DIVIDEND
      ) {
        continue;
      }

      for (const { chart, id } of resolveSeries(tx)) {
        const byMonth = chart === SeriesChart.EXPENSE ? buckets.expense : buckets.income;
        const byAccount = (byMonth[month] ??= {});
        const bySeries = (byAccount[accountId] ??= {});
        bySeries[id] = (bySeries[id] ?? 0) + amount;
      }
    }

    return buckets;
  }

  // ── Balance chart ─────────────────────────────────────────────────────────

  private buildBalanceChartData(): BalanceChartData {
    const buckets = this.monthlyBuckets$$();
    const accounts = this.moneyService.accounts$$();
    const assets = this.moneyService.assets$$();
    const currencies = this.moneyService.currencies$$();
    const targetTicker = this.moneyService.displayCurrency$$();

    if (!accounts.length) return { dates: [], totals: [], accountSeries: [] };

    const currencyById = new Map(currencies.map((c) => [c.id, c]));
    const accountCurrencyTicker = new Map<number, string>();
    const fxInvestAccountIds = new Set<number>();
    accounts.forEach((a) => {
      if (!a.id) return;
      const currency = currencyById.get(a.currencyId);
      if (currency) accountCurrencyTicker.set(a.id, currency.ticker);
      if (a.kind === 'cash' && a.isInvest && currency && this.fxTickers.has(currency.ticker)) {
        fxInvestAccountIds.add(a.id);
      }
    });

    const assetSuspendedSince = new Map<number, string>();
    const assetsById = new Map<number, string>();
    const suspendedAccountIds = new Set<number>();
    assets.forEach((asset) => {
      if (!asset.id) return;
      assetsById.set(asset.id, asset.ticker);
      if (asset.suspendedSince) {
        assetSuspendedSince.set(asset.id, asset.suspendedSince);
        asset.accountIds.forEach((id) => suspendedAccountIds.add(id));
      }
    });

    const allMonthsSet = new Set<string>([
      ...Object.keys(buckets.accountDelta),
      ...Object.keys(buckets.fxInvestDelta),
      ...Object.keys(buckets.brokerDelta),
    ]);
    if (!allMonthsSet.size) return { dates: [], totals: [], accountSeries: [] };

    const sortedMonths = Array.from(allMonthsSet).sort();
    const months = generateMonthRange(sortedMonths[0], sortedMonths[sortedMonths.length - 1]);

    const cumulativeBalance = new Map<number, number>();
    const cumulativeFxInvest = new Map<number, number>();
    const cumulativeBrokerQty = new Map<string, number>();
    accounts.forEach((a) => {
      if (a.id) cumulativeBalance.set(a.id, 0);
    });

    const seriesMap = new Map<number, { values: number[]; suspendedValues: number[] }>();
    accounts.forEach((a) => {
      if (a.id) seriesMap.set(a.id, { values: [], suspendedValues: [] });
    });

    const dates: string[] = [];
    const totals: number[] = [];

    for (const monthKey of months) {
      const [yr, mo] = monthKey.split('-').map(Number);
      const eomDay = new Date(yr, mo, 0).getDate();
      const eomISO = `${yr}-${String(mo).padStart(2, '0')}-${String(eomDay).padStart(2, '0')}`;

      for (const [idStr, delta] of Object.entries(buckets.accountDelta[monthKey] ?? {})) {
        const id = Number(idStr);
        cumulativeBalance.set(id, (cumulativeBalance.get(id) ?? 0) + delta);
      }
      for (const [idStr, delta] of Object.entries(buckets.fxInvestDelta[monthKey] ?? {})) {
        const id = Number(idStr);
        cumulativeFxInvest.set(id, (cumulativeFxInvest.get(id) ?? 0) + delta);
      }
      for (const [key, qty] of Object.entries(buckets.brokerDelta[monthKey] ?? {})) {
        cumulativeBrokerQty.set(key, (cumulativeBrokerQty.get(key) ?? 0) + qty);
      }

      const rates = this.moneyService.getRatesForDate(eomISO);
      let total = 0;

      for (const account of accounts) {
        if (!account.id) continue;
        const series = seriesMap.get(account.id)!;
        const currencyTicker = accountCurrencyTicker.get(account.id);

        if (fxInvestAccountIds.has(account.id)) {
          const nativeAmt = cumulativeFxInvest.get(account.id) ?? 0;
          const converted =
            currencyTicker && rates ? convertAmount(nativeAmt, currencyTicker, targetTicker, rates) : nativeAmt;
          series.values.push(converted);
          series.suspendedValues.push(0);
          total += converted;
          continue;
        }

        const isBroker = account.kind === 'brokerage' || account.kind === 'crypto';
        const cashBalance = cumulativeBalance.get(account.id) ?? 0;
        const convertedCash =
          currencyTicker && rates ? convertAmount(cashBalance, currencyTicker, targetTicker, rates) : cashBalance;
        total += convertedCash;

        if (isBroker) {
          const virtualValue = this.sumBrokerPositions(
            account.id,
            cumulativeBrokerQty,
            assetsById,
            targetTicker,
            rates,
            null,
            eomISO,
          );
          const suspendedValue = this.sumBrokerPositions(
            account.id,
            cumulativeBrokerQty,
            assetsById,
            targetTicker,
            rates,
            assetSuspendedSince,
            eomISO,
          );
          series.values.push(convertedCash + virtualValue);
          series.suspendedValues.push(suspendedValue);
          total += virtualValue;
        } else {
          series.values.push(convertedCash);
          series.suspendedValues.push(0);
        }
      }

      dates.push(eomISO);
      totals.push(total);
    }

    const accountSeries: BalanceChartAccountSeries[] = [];
    for (const account of accounts) {
      if (!account.id) continue;
      const series = seriesMap.get(account.id)!;
      if (!series.values.some((v) => v !== 0)) continue;
      accountSeries.push({
        accountId: account.id,
        accountTitle: account.title,
        values: series.values,
        suspendedValues: series.suspendedValues,
        isSuspended: suspendedAccountIds.has(account.id),
      });
    }

    return { dates, totals, accountSeries };
  }

  private sumBrokerPositions(
    accountId: number,
    cumulativeBrokerQty: Map<string, number>,
    assetsById: Map<number, string>,
    targetTicker: string,
    rates: Record<string, number> | null,
    suspendedSinceMap: Map<number, string> | null,
    currentDateISO: string,
  ): number {
    if (!rates) return 0;
    let total = 0;
    cumulativeBrokerQty.forEach((units, key) => {
      if (units <= 0) return;
      const colonIdx = key.indexOf(':');
      if (Number(key.substring(0, colonIdx)) !== accountId) return;
      const assetId = Number(key.substring(colonIdx + 1));
      if (suspendedSinceMap != null) {
        const suspendedSince = suspendedSinceMap.get(assetId);
        if (!suspendedSince || currentDateISO < suspendedSince) return;
      }
      const ticker = assetsById.get(assetId);
      if (!ticker) return;
      const quoteUsd = rates[ticker];
      if (typeof quoteUsd !== 'number' || quoteUsd <= 0) return;
      total += convertAmount(units * quoteUsd, 'USD', targetTicker, rates);
    });
    return total;
  }

  // ── Income chart ──────────────────────────────────────────────────────────

  private buildIncomeChartData(): IncomeChartData {
    const buckets = this.monthlyBuckets$$();
    const lots = this.positionLots$$();
    const accountTickers = this.accountTickers$$();
    const targetTicker = this.moneyService.displayCurrency$$();

    const now = new Date();
    const currentMonthISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const allMonthsSet = new Set<string>(Object.keys(buckets.income));
    lots.forEach((lot) => lot.openMonths.forEach((m) => allMonthsSet.add(m)));
    if (lots.some((lot) => lot.status === 'open')) allMonthsSet.add(currentMonthISO);

    if (!allMonthsSet.size) return { months: [], categorySeries: [] };

    const sortedMonths = Array.from(allMonthsSet).sort();
    const months = this.generateEomDates(sortedMonths[0], sortedMonths[sortedMonths.length - 1]);
    const monthIndexMap = new Map<string, number>(months.map((m, i) => [m.substring(0, 7), i]));

    // Monthly values per income series id: categories and dividends from the buckets, ЦБ/Крипта from the lots.
    const seriesValues = new Map<number, number[]>();
    const valuesOf = (seriesId: number): number[] => {
      let values = seriesValues.get(seriesId);
      if (!values) {
        values = new Array(months.length).fill(0);
        seriesValues.set(seriesId, values);
      }
      return values;
    };
    valuesOf(INCOME_VIRTUAL_SERIES.DIVIDENDS);

    for (const [monthKey, accountMap] of Object.entries(buckets.income)) {
      const monthIdx = monthIndexMap.get(monthKey);
      if (monthIdx === undefined) continue;
      const rates = this.moneyService.getRatesForDate(months[monthIdx]);

      for (const [accountIdStr, seriesMap] of Object.entries(accountMap)) {
        const currencyTicker = accountTickers.get(Number(accountIdStr));

        for (const [seriesIdStr, nativeAmt] of Object.entries(seriesMap)) {
          const converted =
            currencyTicker && rates ? convertAmount(nativeAmt, currencyTicker, targetTicker, rates) : nativeAmt;
          valuesOf(Number(seriesIdStr))[monthIdx] += converted;
        }
      }
    }

    for (const lot of lots) {
      if (lot.pnl === null) continue;
      const values = valuesOf(lot.seriesId);
      const perMonth = lot.pnl / lot.openMonths.length;
      for (const monthKey of lot.openMonths) {
        const idx = monthIndexMap.get(monthKey);
        if (idx !== undefined) values[idx] += perMonth;
      }
    }

    const categoryNames = new Map(this.moneyService.categories$$().map((c) => [c.id, c.name]));
    const categorySeries: IncomeChartCategorySeries[] = [];
    for (const [seriesId, values] of seriesValues) {
      if (seriesId !== INCOME_VIRTUAL_SERIES.DIVIDENDS && !values.some((v) => v !== 0)) continue;
      categorySeries.push({
        categoryId: seriesId,
        categoryName: INCOME_VIRTUAL_SERIES_NAMES[seriesId] ?? categoryNames.get(seriesId) ?? 'Other',
        values,
      });
    }
    categorySeries.sort(
      (a, b) =>
        seriesOrderIndex(INCOME_SERIES_ORDER, a.categoryName) - seriesOrderIndex(INCOME_SERIES_ORDER, b.categoryName),
    );

    return { months, categorySeries };
  }

  // ── Expense chart ─────────────────────────────────────────────────────────

  private buildExpenseChartData(): ExpenseChartData {
    const buckets = this.monthlyBuckets$$();
    const accountTickers = this.accountTickers$$();
    const targetTicker = this.moneyService.displayCurrency$$();

    if (!Object.keys(buckets.expense).length) return { categories: [], monthRows: [] };

    const categoryMap = new Map<number, Category>();
    this.moneyService.categories$$().forEach((c) => {
      if (c.id != null) categoryMap.set(c.id, c);
    });

    const uniqueDisplayCategoryIds = new Set<number>();
    const monthAmounts = new Map<string, Map<number, number>>();
    const monthUncategorized = new Map<string, number>();

    for (const [monthKey, accountMap] of Object.entries(buckets.expense)) {
      const rates = this.moneyService.getRatesForDate(this.toEomISO(monthKey));

      for (const [accountIdStr, seriesMap] of Object.entries(accountMap)) {
        const currencyTicker = accountTickers.get(Number(accountIdStr));

        for (const [seriesIdStr, nativeAmt] of Object.entries(seriesMap)) {
          const catId = Number(seriesIdStr);
          const converted =
            currencyTicker && rates ? convertAmount(nativeAmt, currencyTicker, targetTicker, rates) : nativeAmt;

          if (catId === EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED) {
            monthUncategorized.set(monthKey, (monthUncategorized.get(monthKey) ?? 0) + converted);
            continue;
          }

          uniqueDisplayCategoryIds.add(catId);
          if (!monthAmounts.has(monthKey)) monthAmounts.set(monthKey, new Map());
          const monthCats = monthAmounts.get(monthKey)!;
          monthCats.set(catId, (monthCats.get(catId) ?? 0) + converted);
        }
      }
    }

    const expenseCategories: ExpenseCategory[] = Array.from(uniqueDisplayCategoryIds)
      .map((id) => ({ id, name: categoryMap.get(id)?.name ?? 'Other' }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const allMonths = new Set([...monthAmounts.keys(), ...monthUncategorized.keys()]);
    const monthRows = Array.from(allMonths)
      .sort()
      .map((period) => {
        const catsMap = monthAmounts.get(period);
        const categoryAmounts: Record<number, number> = {};
        let total = 0;
        catsMap?.forEach((amount, catId) => {
          categoryAmounts[catId] = amount;
          total += amount;
        });
        const uncategorizedAmount = monthUncategorized.get(period) ?? 0;
        total += uncategorizedAmount;
        return { period, categoryAmounts, total, uncategorizedAmount };
      });

    return { categories: expenseCategories, monthRows };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getTxCashDelta(tx: Transaction): number {
    const { kind, amount } = tx;
    if (kind === TransactionKind.INCOME) return amount;
    if (kind === TransactionKind.EXPENSE) return -amount;
    if (kind === TransactionKind.INVEST_BUY) return -amount;
    if (kind === TransactionKind.INVEST_SELL || kind === TransactionKind.INVEST_DIVIDEND) return amount;
    if (kind !== TransactionKind.TRANSFER) return 0;

    const details = parseTransactionDetails(tx.detailsJSON);
    const direction = details?.direction;
    if (direction === 'out') return -amount;
    if (direction === 'in') return amount;
    return 0;
  }

  private toEomISO(monthKey: string): string {
    const [yr, mo] = monthKey.split('-').map(Number);
    const eomDay = new Date(yr, mo, 0).getDate();
    return `${yr}-${String(mo).padStart(2, '0')}-${String(eomDay).padStart(2, '0')}`;
  }

  private generateEomDates(firstMonthISO: string, lastMonthISO: string): string[] {
    return generateMonthRange(firstMonthISO, lastMonthISO).map((month) => this.toEomISO(month));
  }

  private draftFor(categoryType: CategoryType): SeriesColorInput | undefined {
    const draft = this.colorDraft$$();
    return draft?.categoryType === categoryType ? draft : undefined;
  }

  private buildSeriesColors(
    categoryType: CategoryType,
    virtualSeriesIds: number[],
    draft?: SeriesColorInput,
  ): Map<number, SeriesColor> {
    const categorySeries: SeriesColorInput[] = this.moneyService
      .categories$$()
      .filter((category) => category.id !== undefined && category.categoryType === categoryType)
      .map((category) => ({
        id: category.id!,
        hue: category.hue ?? null,
        lightness: category.lightness ?? null,
        saturation: category.saturation ?? null,
      }));
    const virtualSeries: SeriesColorInput[] = virtualSeriesIds.map((id) => ({
      id,
      hue: null,
      lightness: null,
      saturation: null,
    }));
    const stored = [...categorySeries, ...virtualSeries].filter((series) => series.id !== draft?.id);
    return assignSeriesColors(draft ? [...stored, draft] : stored);
  }

  private buildExpenseSeriesShares(): SeriesShare[] {
    const { categories, monthRows } = this.expenseChartData$$();
    const names = new Map<number, string>(categories.map((category) => [category.id, category.name]));
    names.set(EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED, EXPENSE_VIRTUAL_SERIES_NAMES[EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED]);

    const totals = new Map<number, number>();
    const addToTotal = (seriesId: number, amount: number): void => {
      totals.set(seriesId, (totals.get(seriesId) ?? 0) + amount);
    };
    // Rows exist only for months with expenses, so the window is counted in calendar months from the
    // latest one, not in rows.
    const monthNumber = (period: string): number => {
      const [year, month] = period.split('-').map(Number);
      return year * 12 + month;
    };
    const latestMonth = monthRows.length ? monthNumber(monthRows[monthRows.length - 1].period) : 0;
    for (const row of monthRows.filter((item) => monthNumber(item.period) > latestMonth - SHARE_WINDOW_MONTHS)) {
      for (const [seriesId, amount] of Object.entries(row.categoryAmounts)) addToTotal(Number(seriesId), amount);
      addToTotal(EXPENSE_VIRTUAL_SERIES.UNCATEGORIZED, row.uncategorizedAmount);
    }
    return toSeriesShares(totals, names, EXPENSE_SERIES_ORDER);
  }

  private buildIncomeSeriesShares(): SeriesShare[] {
    const { categorySeries } = this.incomeChartData$$();
    const names = new Map<number, string>(categorySeries.map((series) => [series.categoryId, series.categoryName]));

    const totals = new Map<number, number>();
    for (const series of categorySeries) {
      totals.set(
        series.categoryId,
        series.values.slice(-SHARE_WINDOW_MONTHS).reduce((sum, value) => sum + Math.max(0, value), 0),
      );
    }
    return toSeriesShares(totals, names, INCOME_SERIES_ORDER);
  }
}
