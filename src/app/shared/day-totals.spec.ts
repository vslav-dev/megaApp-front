import { sumDayTotals } from './day-totals';
import { Transaction, TransactionKind } from './types';

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

const asIs = (transaction: Transaction) => transaction.amount;

describe('sumDayTotals', () => {
  it('has neither side for an empty day', () => {
    expect(sumDayTotals([], asIs)).toEqual({ income: null, expense: null });
  });

  it('sums only the expense side when there are only expenses', () => {
    const totals = sumDayTotals([tx({ amount: 30 }), tx({ amount: 12 })], asIs);
    expect(totals).toEqual({ income: null, expense: 42 });
  });

  it('keeps income and expense apart', () => {
    const totals = sumDayTotals(
      [tx({ amount: 30 }), tx({ kind: TransactionKind.INCOME, amount: 500 }), tx({ amount: 20 })],
      asIs,
    );
    expect(totals).toEqual({ income: 500, expense: 50 });
  });

  it('counts dividends as income', () => {
    const totals = sumDayTotals([tx({ kind: TransactionKind.INVEST_DIVIDEND, amount: 7 })], asIs);
    expect(totals).toEqual({ income: 7, expense: null });
  });

  it('ignores transfers and buys/sells', () => {
    const totals = sumDayTotals(
      [
        tx({ kind: TransactionKind.TRANSFER }),
        tx({ kind: TransactionKind.INVEST_BUY }),
        tx({ kind: TransactionKind.INVEST_SELL }),
      ],
      asIs,
    );
    expect(totals).toEqual({ income: null, expense: null });
  });

  it('sums the converted amounts', () => {
    const totals = sumDayTotals([tx({ amount: 10 }), tx({ amount: 5 })], (transaction) => transaction.amount * 2);
    expect(totals.expense).toBe(30);
  });

  it('keeps a zero-amount expense as a zero side', () => {
    expect(sumDayTotals([tx({ amount: 0 })], asIs)).toEqual({ income: null, expense: 0 });
  });
});
