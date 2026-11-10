import { Transaction, TransactionKind } from '@app/shared/types';

// What a day's transactions add up to: money in (incomes, dividends) and money out (expenses). A side
// with no transactions is null, so the list shows only the sides a day actually has. Transfers and
// buys/sells move money between one's own holdings and count toward neither side.
export interface DayTotals {
  income: number | null;
  expense: number | null;
}

// The caller decides the currency: toAmount returns a transaction's amount already converted.
export function sumDayTotals(
  transactions: readonly Transaction[],
  toAmount: (transaction: Transaction) => number,
): DayTotals {
  const totals: DayTotals = { income: null, expense: null };
  for (const transaction of transactions) {
    switch (transaction.kind) {
      case TransactionKind.INCOME:
      case TransactionKind.INVEST_DIVIDEND:
        totals.income = (totals.income ?? 0) + toAmount(transaction);
        break;
      case TransactionKind.EXPENSE:
        totals.expense = (totals.expense ?? 0) + toAmount(transaction);
        break;
    }
  }
  return totals;
}
