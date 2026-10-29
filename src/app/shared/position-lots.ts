import { convertAmount, generateMonthRange, parseTransactionDetails, toPositiveNumber } from '@app/shared/money-utils';
import { INCOME_VIRTUAL_SERIES, TradeSeriesIndex } from '@app/shared/money-series';
import { Asset, AssetType, Transaction, TransactionKind } from '@app/shared/types';

// One FIFO match: a (part of a) buy, paired with a (part of a) sell when the position was closed, or
// with what is still held when it is open. The atomic fact everything about securities is derived
// from — the income chart's "ЦБ/Крипта" series values and which transactions feed which series.
export interface PositionLot {
  status: 'closed' | 'open';
  // Income series this lot's result goes to: asset type (crypto or securities) x status.
  seriesId: number;
  buyTransactionId: number;
  sellTransactionId: number | null;
  // null: the position is open and no quote is known — it has no result yet, so it feeds no series.
  pnl: number | null;
  // Result is spread evenly across these months (buy month .. sell month, or .. current month).
  openMonths: string[];
}

export interface PositionLotsInput {
  transactions: readonly Transaction[];
  assetById: ReadonlyMap<number, Asset>;
  accountTickers: ReadonlyMap<number, string>;
  targetTicker: string;
  getRatesForDate: (dateISO: string) => Record<string, number> | null;
  now: Date;
}

interface Trade {
  id: number;
  isBuy: boolean;
  dateISO: string;
  accountId: number;
  amount: number;
  quantity: number;
  assetType: AssetType;
  assetTicker: string;
}

interface OpenLot {
  trade: Trade;
  quantity: number;
  amount: number;
  remaining: number;
}

function lotSeriesId(assetType: AssetType, status: PositionLot['status']): number {
  const isCrypto = assetType === AssetType.CRYPTO;
  if (status === 'closed') {
    return isCrypto ? INCOME_VIRTUAL_SERIES.CRYPTO_CLOSED_PNL : INCOME_VIRTUAL_SERIES.CB_CLOSED_PNL;
  }
  return isCrypto ? INCOME_VIRTUAL_SERIES.CRYPTO_OPEN_PNL : INCOME_VIRTUAL_SERIES.CB_OPEN_PNL;
}

function byDateThenId(a: Trade, b: Trade): number {
  return a.dateISO.localeCompare(b.dateISO) || a.id - b.id;
}

export function buildPositionLots(input: PositionLotsInput): PositionLot[] {
  const { assetById, accountTickers, targetTicker, getRatesForDate, now } = input;

  const groups = new Map<string, Trade[]>();
  for (const transaction of input.transactions) {
    if (transaction.kind !== TransactionKind.INVEST_BUY && transaction.kind !== TransactionKind.INVEST_SELL) continue;
    if (transaction.id === undefined) continue;
    const details = parseTransactionDetails(transaction.detailsJSON);
    const assetId = toPositiveNumber(details?.assetId);
    const asset = assetId === null ? undefined : assetById.get(assetId);
    if (!asset) continue;

    const trade: Trade = {
      id: transaction.id,
      isBuy: transaction.kind === TransactionKind.INVEST_BUY,
      dateISO: transaction.dateISO,
      accountId: transaction.accountId,
      amount: transaction.amount,
      quantity: toPositiveNumber(details?.quantity) ?? 0,
      assetType: asset.type,
      assetTicker: asset.ticker,
    };
    const key = `${trade.accountId}:${assetId}`;
    const group = groups.get(key);
    if (group) group.push(trade);
    else groups.set(key, [trade]);
  }
  if (!groups.size) return [];

  const currentMonthISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentDateISO = `${currentMonthISO}-${String(now.getDate()).padStart(2, '0')}`;
  const currentRates = getRatesForDate(currentDateISO);

  const inTargetCurrency = (trade: Trade): number => {
    const ticker = accountTickers.get(trade.accountId);
    const rates = getRatesForDate(trade.dateISO);
    return ticker && rates ? convertAmount(trade.amount, ticker, targetTicker, rates) : trade.amount;
  };

  const lots: PositionLot[] = [];

  groups.forEach((groupTrades) => {
    const first = groupTrades[0];
    if (!first) return;
    const { assetType, assetTicker } = first;
    const buys = groupTrades.filter((t) => t.isBuy).sort(byDateThenId);
    const sells = groupTrades.filter((t) => !t.isBuy).sort(byDateThenId);

    const lotQueue: OpenLot[] = buys.map((trade) => ({
      trade,
      quantity: trade.quantity,
      amount: inTargetCurrency(trade),
      remaining: trade.quantity,
    }));

    for (const sell of sells) {
      const sellAmount = inTargetCurrency(sell);

      let remainingToMatch = sell.quantity;
      for (const lot of lotQueue) {
        if (remainingToMatch <= 0) break;
        if (lot.remaining <= 0) continue;

        const matchedQuantity = Math.min(lot.remaining, remainingToMatch);
        const cost = lot.quantity > 0 ? lot.amount * (matchedQuantity / lot.quantity) : 0;
        const proceeds = sell.quantity > 0 ? sellAmount * (matchedQuantity / sell.quantity) : 0;

        lots.push({
          status: 'closed',
          seriesId: lotSeriesId(assetType, 'closed'),
          buyTransactionId: lot.trade.id,
          sellTransactionId: sell.id,
          pnl: proceeds - cost,
          openMonths: generateMonthRange(lot.trade.dateISO.substring(0, 7), sell.dateISO.substring(0, 7)),
        });

        lot.remaining -= matchedQuantity;
        remainingToMatch -= matchedQuantity;
      }
    }

    for (const lot of lotQueue) {
      if (lot.remaining <= 0) continue;
      const cost = lot.quantity > 0 ? lot.amount * (lot.remaining / lot.quantity) : 0;

      let currentValue: number | null = null;
      if (currentRates) {
        const quoteUsd = currentRates[assetTicker];
        if (typeof quoteUsd === 'number' && quoteUsd > 0) {
          currentValue = convertAmount(lot.remaining * quoteUsd, 'USD', targetTicker, currentRates);
        }
      }

      lots.push({
        status: 'open',
        seriesId: lotSeriesId(assetType, 'open'),
        buyTransactionId: lot.trade.id,
        sellTransactionId: null,
        pnl: currentValue !== null ? currentValue - cost : null,
        openMonths: generateMonthRange(lot.trade.dateISO.substring(0, 7), currentMonthISO),
      });
    }
  });

  return lots;
}

// Which income series each buy/sell transaction feeds: those of every lot it takes part in that has
// a known result. A buy that was partly sold is in both the closed and the open series.
export function buildTradeSeriesIndex(lots: readonly PositionLot[]): TradeSeriesIndex {
  const index = new Map<number, Set<number>>();
  const add = (transactionId: number, seriesId: number): void => {
    const seriesIds = index.get(transactionId);
    if (seriesIds) seriesIds.add(seriesId);
    else index.set(transactionId, new Set([seriesId]));
  };

  for (const lot of lots) {
    if (lot.pnl === null) continue;
    add(lot.buyTransactionId, lot.seriesId);
    if (lot.sellTransactionId !== null) add(lot.sellTransactionId, lot.seriesId);
  }
  return index;
}
