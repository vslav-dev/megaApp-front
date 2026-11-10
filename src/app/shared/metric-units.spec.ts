import { formatMetricUnitValue } from './metric-units';
import { THIN_SPACE } from './number-format';

describe('formatMetricUnitValue', () => {
  it('returns "0" for non-finite values regardless of unit', () => {
    expect(formatMetricUnitValue('count', NaN)).toBe('0');
    expect(formatMetricUnitValue('count', Infinity)).toBe('0');
  });

  describe('ratio', () => {
    it('formats a fraction as a percentage with 1 decimal', () => {
      expect(formatMetricUnitValue('ratio', 0.5)).toBe('50.0%');
    });
  });

  describe('bytes', () => {
    it('keeps small values in bytes with no decimals', () => {
      expect(formatMetricUnitValue('bytes', 512)).toBe('512 B');
    });

    it('scales up to KiB, with 1 decimal below 10 units', () => {
      expect(formatMetricUnitValue('bytes', 2048)).toBe('2.0 KiB');
    });

    it('shows 1 decimal below 10 units, none at or above 10', () => {
      expect(formatMetricUnitValue('bytes', 1024 * 5)).toBe('5.0 KiB');
      expect(formatMetricUnitValue('bytes', 1024 * 12)).toBe('12 KiB');
    });

    it('caps at the largest unit (TiB) instead of overflowing further', () => {
      expect(formatMetricUnitValue('bytes', 1024 ** 5)).toBe('1024 TiB');
    });
  });

  describe('durationMs', () => {
    it('formats durations below 500ms in ms', () => {
      expect(formatMetricUnitValue('durationMs', 320)).toBe('320 мс');
    });

    it('switches to seconds with 1 decimal at and above 500ms', () => {
      expect(formatMetricUnitValue('durationMs', 500)).toBe('0.5 с');
      expect(formatMetricUnitValue('durationMs', 3600)).toBe('3.6 с');
    });

    it('omits the decimal when the seconds value is whole', () => {
      expect(formatMetricUnitValue('durationMs', 2000)).toBe('2 с');
    });

    it('switches to minutes and seconds at and above 60s', () => {
      expect(formatMetricUnitValue('durationMs', 61000)).toBe('1 м 1 с');
    });

    it('omits the seconds part when it is exactly 0', () => {
      expect(formatMetricUnitValue('durationMs', 60000)).toBe('1 м');
    });

    it('preserves the sign for negative durations', () => {
      expect(formatMetricUnitValue('durationMs', -1500)).toBe('-1.5 с');
    });
  });

  describe('humanDuration', () => {
    it('formats minutes only under an hour', () => {
      expect(formatMetricUnitValue('humanDuration', 90)).toBe('1m');
    });

    it('formats hours and minutes under a day', () => {
      expect(formatMetricUnitValue('humanDuration', 3660)).toBe('1h 1m');
    });

    it('formats days and hours at and above a day', () => {
      expect(formatMetricUnitValue('humanDuration', 90000)).toBe('1d 1h');
    });

    it('clamps negative values to 0', () => {
      expect(formatMetricUnitValue('humanDuration', -100)).toBe('0m');
    });
  });

  describe('money', () => {
    it('formats with a $ prefix and 2 decimals', () => {
      expect(formatMetricUnitValue('money', 12.345)).toBe('$12.35');
    });

    it('formats a whole number with trailing zeros', () => {
      expect(formatMetricUnitValue('money', 10)).toBe('$10.00');
    });

    it('groups thousands starting at 4 digits', () => {
      expect(formatMetricUnitValue('money', 1800)).toBe(`$1${THIN_SPACE}800.00`);
    });

    it('groups thousands for negative amounts', () => {
      expect(formatMetricUnitValue('money', -1234567.5)).toBe(`$-1${THIN_SPACE}234${THIN_SPACE}567.50`);
    });
  });

  describe('count', () => {
    it('formats an integer with no decimals', () => {
      expect(formatMetricUnitValue('count', 42)).toBe('42');
    });

    it('formats a non-integer with 1 decimal', () => {
      expect(formatMetricUnitValue('count', 42.37)).toBe('42.4');
    });

    it('leaves numbers under 1000 ungrouped', () => {
      expect(formatMetricUnitValue('count', 226)).toBe('226');
    });

    it('groups thousands starting at 4 digits', () => {
      expect(formatMetricUnitValue('count', 9106)).toBe(`9${THIN_SPACE}106`);
      expect(formatMetricUnitValue('count', 118636)).toBe(`118${THIN_SPACE}636`);
    });

    it('groups the integer part of a non-integer value', () => {
      expect(formatMetricUnitValue('count', 6401.5)).toBe(`6${THIN_SPACE}401.5`);
    });

    it('groups multiple thousands separators for large values', () => {
      expect(formatMetricUnitValue('count', 12345678)).toBe(`12${THIN_SPACE}345${THIN_SPACE}678`);
    });

    it('groups a negative count', () => {
      expect(formatMetricUnitValue('count', -1234567)).toBe(`-1${THIN_SPACE}234${THIN_SPACE}567`);
    });
  });
});
