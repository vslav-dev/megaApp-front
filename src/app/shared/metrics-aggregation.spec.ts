import { aggregateMetricValues } from './metrics-aggregation';

describe('aggregateMetricValues', () => {
  it('returns 0 for an empty values array regardless of aggregation', () => {
    expect(aggregateMetricValues('avg', [], false)).toBe(0);
    expect(aggregateMetricValues('max', [], false)).toBe(0);
    expect(aggregateMetricValues('sum', [], false)).toBe(0);
    expect(aggregateMetricValues('last', [], false)).toBe(0);
  });

  it('computes max', () => {
    expect(aggregateMetricValues('max', [3, 7, 2], false)).toBe(7);
  });

  it('computes sum', () => {
    expect(aggregateMetricValues('sum', [1, 2, 3], false)).toBe(6);
  });

  it('computes last (last element of the array, not chronological max)', () => {
    expect(aggregateMetricValues('last', [10, 20, 5], false)).toBe(5);
  });

  it('computes avg as a fraction for a non-integer-valued metric', () => {
    expect(aggregateMetricValues('avg', [1, 2], false)).toBe(1.5);
  });

  it('rounds avg to the nearest integer for an integer-valued metric', () => {
    expect(aggregateMetricValues('avg', [1, 2], true)).toBe(2);
    expect(aggregateMetricValues('avg', [1, 2, 4], true)).toBe(2);
  });
});
