import { INCOME_VIRTUAL_SERIES } from './money-series';
import { PositionLot, PositionLotsInput, buildPositionLots, buildTradeSeriesIndex } from './position-lots';
import { Asset, AssetType, Transaction, TransactionKind } from './types';

const STOCK: Asset = { id: 10, title: 'Actual', ticker: 'ACT', type: AssetType.STOCK, accountIds: [1] };
const COIN: Asset = { id: 20, title: 'Coin', ticker: 'BTC', type: AssetType.CRYPTO, accountIds: [1] };

function trade(
  id: number,
  kind: typeof TransactionKind.INVEST_BUY | typeof TransactionKind.INVEST_SELL,
  dateISO: string,
  amount: number,
  assetId: number,
  quantity: number,
): Transaction {
  return { id, kind, dateISO, accountId: 1, amount, isGift: false, detailsJSON: { assetId, quantity } };
}

function lots(transactions: Transaction[], overrides: Partial<PositionLotsInput> = {}): PositionLot[] {
  return buildPositionLots({
    transactions,
    assetById: new Map([STOCK, COIN].map((asset) => [asset.id!, asset])),
    accountTickers: new Map([[1, 'RUB']]),
    targetTicker: 'RUB',
    getRatesForDate: () => null,
    now: new Date(2026, 5, 15),
    ...overrides,
  });
}

const buy = TransactionKind.INVEST_BUY;
const sell = TransactionKind.INVEST_SELL;

describe('buildPositionLots', () => {
  it('returns nothing without buy/sell transactions or when their asset is unknown', () => {
    expect(lots([])).toEqual([]);
    expect(lots([trade(1, buy, '2026-01-05', 1000, 99, 10)])).toEqual([]);
  });

  it('matches a sell to buys in FIFO order and records both transaction ids on each lot', () => {
    const result = lots([
      trade(1, buy, '2026-01-05', 1000, 10, 10),
      trade(2, buy, '2026-02-05', 1200, 10, 10),
      trade(3, sell, '2026-03-05', 1800, 10, 15),
    ]);

    const closed = result.filter((lot) => lot.status === 'closed');
    expect(closed.map((lot) => [lot.buyTransactionId, lot.sellTransactionId])).toEqual([
      [1, 3],
      [2, 3],
    ]);
    // lot 1: cost 1000, proceeds 1800*10/15 = 1200; lot 2 (5 of 10): cost 600, proceeds 600.
    expect(closed[0].pnl).toBeCloseTo(200, 5);
    expect(closed[1].pnl).toBeCloseTo(0, 5);
    expect(closed[0].openMonths).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(closed.every((lot) => lot.seriesId === INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL)).toBe(true);
  });

  it('leaves the unsold rest of a buy as an open lot without a result until a quote is known', () => {
    const transactions = [trade(1, buy, '2026-01-05', 1000, 10, 10), trade(2, sell, '2026-02-05', 700, 10, 4)];

    const withoutQuote = lots(transactions);
    const open = withoutQuote.find((lot) => lot.status === 'open')!;
    expect(open).toMatchObject({ buyTransactionId: 1, sellTransactionId: null, pnl: null });
    expect(open.seriesId).toBe(INCOME_VIRTUAL_SERIES.CB_OPEN_PNL);
    expect(open.openMonths[open.openMonths.length - 1]).toBe('2026-06');

    // 6 left at quote 200/unit: value 1200 against cost 1000*6/10 = 600.
    const withQuote = lots(transactions, { getRatesForDate: () => ({ ACT: 200, USD: 1, RUB: 1 }) });
    expect(withQuote.find((lot) => lot.status === 'open')!.pnl).toBeCloseTo(600, 5);
  });

  it('routes crypto to its own series', () => {
    const result = lots([trade(1, buy, '2026-01-05', 100, 20, 1), trade(2, sell, '2026-02-05', 150, 20, 1)]);
    expect(result).toHaveLength(1);
    expect(result[0].seriesId).toBe(INCOME_VIRTUAL_SERIES.CRYPTO_CLOSED_PNL);
  });

  it('orders same-day buys by id and keeps groups of different accounts apart', () => {
    const second: Transaction = { ...trade(5, buy, '2026-01-05', 500, 10, 5), accountId: 2 };
    const result = lots(
      [
        trade(4, buy, '2026-01-05', 900, 10, 10),
        trade(3, buy, '2026-01-05', 1000, 10, 10),
        second,
        trade(6, sell, '2026-02-05', 1100, 10, 10),
      ],
      {
        accountTickers: new Map([
          [1, 'RUB'],
          [2, 'RUB'],
        ]),
      },
    );
    const closed = result.filter((lot) => lot.status === 'closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].buyTransactionId).toBe(3);
  });

  it('ignores a transaction that has no id yet', () => {
    const noId: Transaction = { ...trade(1, buy, '2026-01-05', 1000, 10, 10), id: undefined };
    expect(lots([noId])).toEqual([]);
  });
});

describe('buildTradeSeriesIndex', () => {
  it('assigns each transaction the series of every lot it takes part in, once', () => {
    const closed = INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL;
    const open = INCOME_VIRTUAL_SERIES.CB_OPEN_PNL;
    const index = buildTradeSeriesIndex([
      {
        status: 'closed',
        seriesId: closed,
        buyTransactionId: 1,
        sellTransactionId: 3,
        pnl: 10,
        openMonths: ['2026-01'],
      },
      {
        status: 'closed',
        seriesId: closed,
        buyTransactionId: 1,
        sellTransactionId: 4,
        pnl: 5,
        openMonths: ['2026-01'],
      },
      { status: 'open', seriesId: open, buyTransactionId: 1, sellTransactionId: null, pnl: 7, openMonths: ['2026-01'] },
    ]);

    expect([...index.get(1)!].sort()).toEqual([closed, open].sort());
    expect([...index.get(3)!]).toEqual([closed]);
    expect([...index.get(4)!]).toEqual([closed]);
  });

  it('skips lots without a known result', () => {
    const index = buildTradeSeriesIndex([
      {
        status: 'open',
        seriesId: INCOME_VIRTUAL_SERIES.CB_OPEN_PNL,
        buyTransactionId: 1,
        sellTransactionId: null,
        pnl: null,
        openMonths: ['2026-01'],
      },
    ]);
    expect(index.size).toBe(0);
  });
});
