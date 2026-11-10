import {
  areArraysShallowEqual,
  areSetsEqual,
  convertAmount,
  generateMonthRange,
  parseTransactionDetails,
  toPositiveNumber,
} from './money-utils';

describe('convertAmount', () => {
  it('returns amount unchanged when fromTicker === toTicker', () => {
    expect(convertAmount(100, 'EUR', 'EUR', {})).toBe(100);
  });

  it('converts USD to a target currency via its rate', () => {
    expect(convertAmount(100, 'USD', 'EUR', { EUR: 0.5 })).toBe(200);
  });

  it('converts a source currency to USD via its rate', () => {
    expect(convertAmount(100, 'EUR', 'USD', { EUR: 0.5 })).toBe(50);
  });

  it('converts between two non-USD currencies via USD as pivot', () => {
    expect(convertAmount(100, 'EUR', 'GBP', { EUR: 0.5, GBP: 0.25 })).toBe(200);
  });

  it('falls back to the original amount when fromTicker rate is missing', () => {
    expect(convertAmount(100, 'EUR', 'USD', {})).toBe(100);
  });

  it('falls back to the original amount when fromTicker rate is zero or negative', () => {
    expect(convertAmount(100, 'EUR', 'USD', { EUR: 0 })).toBe(100);
    expect(convertAmount(100, 'EUR', 'USD', { EUR: -1 })).toBe(100);
  });

  it('falls back to the USD amount when toTicker rate is missing', () => {
    expect(convertAmount(100, 'USD', 'EUR', {})).toBe(100);
  });

  it('falls back to the USD amount when toTicker rate is zero or negative', () => {
    expect(convertAmount(100, 'USD', 'EUR', { EUR: 0 })).toBe(100);
    expect(convertAmount(100, 'USD', 'EUR', { EUR: -1 })).toBe(100);
  });
});

describe('generateMonthRange', () => {
  it('lists every month in range across a year boundary', () => {
    expect(generateMonthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('returns a single month for equal bounds and nothing for reversed ones', () => {
    expect(generateMonthRange('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(generateMonthRange('2026-04', '2026-03')).toEqual([]);
  });
});

describe('areArraysShallowEqual', () => {
  it('compares elements by identity, in order', () => {
    const a = { id: 1 };
    const b = { id: 2 };
    expect(areArraysShallowEqual([a, b], [a, b])).toBe(true);
    expect(areArraysShallowEqual([a, b], [b, a])).toBe(false);
    expect(areArraysShallowEqual([a], [a, b])).toBe(false);
    expect(areArraysShallowEqual([a], [{ id: 1 }])).toBe(false);
  });
});

describe('areSetsEqual', () => {
  it('compares content, not identity', () => {
    expect(areSetsEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(areSetsEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(areSetsEqual(new Set([1]), new Set([1, 2]))).toBe(false);
  });
});

describe('parseTransactionDetails', () => {
  it('returns an object as it is', () => {
    expect(parseTransactionDetails({ direction: 'out' })).toEqual({ direction: 'out' });
  });

  it('parses a JSON string', () => {
    expect(parseTransactionDetails('{"assetId":7,"quantity":2}')).toEqual({ assetId: 7, quantity: 2 });
  });

  it('returns null for nothing or for a string that is not JSON', () => {
    expect(parseTransactionDetails(undefined)).toBeNull();
    expect(parseTransactionDetails('')).toBeNull();
    expect(parseTransactionDetails('not json')).toBeNull();
  });
});

describe('toPositiveNumber', () => {
  it('accepts positive finite numbers and numeric strings only', () => {
    expect(toPositiveNumber('2.5')).toBe(2.5);
    expect(toPositiveNumber(0)).toBeNull();
    expect(toPositiveNumber(-1)).toBeNull();
    expect(toPositiveNumber('abc')).toBeNull();
    expect(toPositiveNumber(undefined)).toBeNull();
  });
});
