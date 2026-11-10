import { evaluateAmountExpression, evaluateWholeAmount, normalizeAmountInput } from './amount-expression';

describe('evaluateWholeAmount', () => {
  it.each([
    ['100/3', 33],
    ['80*1,5', 120],
    ['-7/2', -3],
    ['80', 80],
  ])('rounds %s to %d', (input, expected) => {
    expect(evaluateWholeAmount(input)).toBe(expected);
  });

  it('returns null for invalid input', () => {
    expect(evaluateWholeAmount('80*')).toBeNull();
  });
});

describe('normalizeAmountInput', () => {
  it('strips whitespace and turns commas into dots', () => {
    expect(normalizeAmountInput(' 1 200,5 ')).toBe('1200.5');
  });
});

describe('evaluateAmountExpression', () => {
  it.each([
    ['80', 80],
    ['80*2', 160],
    ['80 * 1,5', 120],
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['100/4', 25],
    ['-5+10', 5],
    ['5--3', 8],
    ['+7', 7],
    ['10-20', -10],
  ])('evaluates %s to %d', (input, expected) => {
    expect(evaluateAmountExpression(input)).toBe(expected);
  });

  it.each([
    [''],
    [null],
    [undefined],
    ['   '],
    ['80*'],
    ['*2'],
    ['(2+3'],
    ['2+3)'],
    ['abc'],
    ['5/0'],
    ['1..2*3'],
    ['-'],
  ])('returns null for %s', (input) => {
    expect(evaluateAmountExpression(input)).toBeNull();
  });
});
