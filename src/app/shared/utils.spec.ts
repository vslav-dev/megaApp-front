import {
  calcDateWithUserTimeShift,
  dateToIsoNoTimeNoTZ,
  divideNumberWithWhitespaces,
  epochToIsoNoTimeNoTZ,
  fitColumnsToWidth,
  getRuDeclension,
  isDeepEqual,
  isoDaysBefore,
  splitNumber,
} from './utils';

describe('isoDaysBefore', () => {
  it('subtracts days within the same month', () => {
    expect(isoDaysBefore('2026-08-19', 5)).toBe('2026-08-14');
  });

  it('crosses a month boundary', () => {
    expect(isoDaysBefore('2026-08-01', 1)).toBe('2026-07-31');
  });

  it('crosses a year boundary', () => {
    expect(isoDaysBefore('2026-01-01', 1)).toBe('2025-12-31');
  });

  it('handles daysBefore = 0', () => {
    expect(isoDaysBefore('2026-08-19', 0)).toBe('2026-08-19');
  });
});

describe('dateToIsoNoTimeNoTZ', () => {
  it('pads single-digit month and day', () => {
    expect(dateToIsoNoTimeNoTZ(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('formats double-digit month and day without padding change', () => {
    expect(dateToIsoNoTimeNoTZ(new Date(2026, 10, 25))).toBe('2026-11-25');
  });
});

describe('epochToIsoNoTimeNoTZ', () => {
  it('formats an epoch timestamp using local date parts', () => {
    const date = new Date(2026, 2, 3);
    expect(epochToIsoNoTimeNoTZ(date.getTime())).toBe('2026-03-03');
  });
});

describe('calcDateWithUserTimeShift', () => {
  it('shifts the date backward by USER_PREFERRED_MIDNIGHT_OFFSET_HOURS hours', () => {
    const input = new Date(2026, 7, 19, 2, 0, 0);
    const shifted = calcDateWithUserTimeShift(input);
    expect(shifted.getTime()).toBeLessThan(input.getTime());
    expect(input.getHours()).toBe(2);
  });
});

describe('fitColumnsToWidth', () => {
  it('returns 1 for non-positive containerWidthPx or targetWidthPx', () => {
    expect(fitColumnsToWidth(0, 100, 8)).toBe(1);
    expect(fitColumnsToWidth(100, 0, 8)).toBe(1);
    expect(fitColumnsToWidth(-10, 100, 8)).toBe(1);
  });

  it('picks the column count whose fitted width is closest to target', () => {
    // container 320, gap 8, target 150 -> 2 columns: (320-8)/2 = 156, delta 6
    // 3 columns: (320-16)/3 = 101.3, delta 48.6 (worse) -> stop, bestColumns=2
    expect(fitColumnsToWidth(320, 150, 8)).toBe(2);
  });

  it('returns 1 when even 2 columns would be worse than 1', () => {
    expect(fitColumnsToWidth(100, 100, 8)).toBe(1);
  });
});

describe('getRuDeclension', () => {
  it('handles the 11-14 exception regardless of the last digit', () => {
    expect(getRuDeclension(11, 'день', 'дня', 'дней')).toBe('дней');
    expect(getRuDeclension(12, 'день', 'дня', 'дней')).toBe('дней');
    expect(getRuDeclension(14, 'день', 'дня', 'дней')).toBe('дней');
    expect(getRuDeclension(111, 'день', 'дня', 'дней')).toBe('дней');
  });

  it('picks "one" form for numbers ending in 1 (except 11)', () => {
    expect(getRuDeclension(1, 'день', 'дня', 'дней')).toBe('день');
    expect(getRuDeclension(21, 'день', 'дня', 'дней')).toBe('день');
  });

  it('picks "few" form for numbers ending in 2-4 (except 12-14)', () => {
    expect(getRuDeclension(2, 'день', 'дня', 'дней')).toBe('дня');
    expect(getRuDeclension(3, 'день', 'дня', 'дней')).toBe('дня');
    expect(getRuDeclension(24, 'день', 'дня', 'дней')).toBe('дня');
  });

  it('picks "many" form for numbers ending in 0, 5-9', () => {
    expect(getRuDeclension(0, 'день', 'дня', 'дней')).toBe('дней');
    expect(getRuDeclension(5, 'день', 'дня', 'дней')).toBe('дней');
    expect(getRuDeclension(9, 'день', 'дня', 'дней')).toBe('дней');
  });
});

describe('isDeepEqual', () => {
  it('returns true for primitives that are strictly equal', () => {
    expect(isDeepEqual(1, 1)).toBe(true);
    expect(isDeepEqual('a', 'a')).toBe(true);
  });

  it('returns false when one side is not an object', () => {
    expect(isDeepEqual(1, { a: 1 })).toBe(false);
    expect(isDeepEqual(null, {})).toBe(false);
  });

  it('returns true for structurally equal plain objects regardless of key order', () => {
    expect(isDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('returns false when key counts differ', () => {
    expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('returns false when a nested value differs', () => {
    expect(isDeepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('returns true for deeply nested equal structures', () => {
    expect(isDeepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
  });
});

describe('splitNumber', () => {
  it('splits a positive integer with no fraction', () => {
    expect(splitNumber('123')).toEqual(['', '123', '']);
  });

  it('splits a negative number with a fraction', () => {
    expect(splitNumber('-123.45')).toEqual(['-', '123', '.45']);
  });

  it('splits a positive number with a fraction', () => {
    expect(splitNumber('0.5')).toEqual(['', '0', '.5']);
  });
});

describe('divideNumberWithWhitespaces', () => {
  it('does not add whitespace for 3 digits or fewer', () => {
    expect(divideNumberWithWhitespaces('123')).toBe('123');
  });

  it('adds a whitespace every 3 digits from the right', () => {
    expect(divideNumberWithWhitespaces('1234567')).toBe('1 234 567');
  });

  it('handles exactly 4 digits', () => {
    expect(divideNumberWithWhitespaces('1000')).toBe('1 000');
  });
});
