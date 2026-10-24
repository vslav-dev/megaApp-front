import { fixKeyboardLayout } from './keyboard-layout';

describe('fixKeyboardLayout', () => {
  it.each([
    ['ifehvf', 'шаурма'],
    ['ifeh', 'шаур'],
    ['vjkjrj', 'молоко'],
    ['vjkjrj 200', 'молоко 200'],
    ['rfif ce[fz', 'каша сухая'],
    [',ehuth', 'бургер'],
    ['Vjkjrj', 'молоко'],
    ['`kt,', 'ёлеб'],
  ])('retypes %s as %s', (input, expected) => {
    expect(fixKeyboardLayout(input)).toBe(expected);
  });

  it('maps every letter key and the punctuation keys that hold Russian letters', () => {
    expect(fixKeyboardLayout("`qwertyuiop[]asdfghjkl;'zxcvbnm,.")).toBe('ёйцукенгшщзхъфывапролджэячсмитьбю');
  });

  it('keeps punctuation between digits', () => {
    expect(fixKeyboardLayout('vjkjrj 2,5')).toBe('молоко 2,5');
    expect(fixKeyboardLayout('1.5 vk')).toBe('1.5 мл');
  });

  it('retypes punctuation next to a letter or a digit on only one side', () => {
    expect(fixKeyboardLayout('v,2')).toBe('мб2');
    expect(fixKeyboardLayout('2,v')).toBe('2бм');
  });

  it.each(['молоко', 'Молоко 2,5', 'молоко milk', 'mолоко', '', '   ', '2,5', '200', '%'])(
    'leaves %j untouched',
    (input) => {
      expect(fixKeyboardLayout(input)).toBe(input);
    },
  );
});
