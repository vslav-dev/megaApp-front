import { Transaction, TransactionDetails } from '@app/shared/types';
import { parseIsoParts } from '@app/shared/utils';

export function convertAmount(
  amount: number,
  fromTicker: string,
  toTicker: string,
  rates: Record<string, number>,
): number {
  if (fromTicker === toTicker) return amount;

  let usdAmount: number;
  if (fromTicker === 'USD') {
    usdAmount = amount;
  } else {
    const fromRate = rates[fromTicker];
    if (typeof fromRate !== 'number' || fromRate <= 0) return amount;
    usdAmount = amount * fromRate;
  }

  if (toTicker === 'USD') return usdAmount;

  const toRate = rates[toTicker];
  if (typeof toRate !== 'number' || toRate <= 0) return usdAmount;
  return usdAmount / toRate;
}

export function parseTransactionDetails(detailsJSON: Transaction['detailsJSON']): TransactionDetails | null {
  if (!detailsJSON) return null;
  if (typeof detailsJSON === 'object') return detailsJSON;
  try {
    return JSON.parse(detailsJSON) as TransactionDetails;
  } catch {
    return null;
  }
}

export function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function generateMonthRange(fromMonthISO: string, toMonthISO: string): string[] {
  const months: string[] = [];
  const [fromYear, fromMonth] = parseIsoParts(fromMonthISO);
  const [toYear, toMonth] = parseIsoParts(toMonthISO);
  let y = fromYear,
    m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

export function areArraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

export function areSetsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
