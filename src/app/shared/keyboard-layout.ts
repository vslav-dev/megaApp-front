const LATIN_TO_RUSSIAN_KEYS: { [key: string]: string } = {
  '`': 'ё',
  q: 'й',
  w: 'ц',
  e: 'у',
  r: 'к',
  t: 'е',
  y: 'н',
  u: 'г',
  i: 'ш',
  o: 'щ',
  p: 'з',
  '[': 'х',
  ']': 'ъ',
  a: 'ф',
  s: 'ы',
  d: 'в',
  f: 'а',
  g: 'п',
  h: 'р',
  j: 'о',
  k: 'л',
  l: 'д',
  ';': 'ж',
  "'": 'э',
  z: 'я',
  x: 'ч',
  c: 'с',
  v: 'м',
  b: 'и',
  n: 'т',
  m: 'ь',
  ',': 'б',
  '.': 'ю',
};

const CYRILLIC_LETTER = /[а-яё]/i;
const LATIN_LETTER = /[a-z]/i;
const DIGIT = /\d/;

// There are no Latin product names in the catalogue, so a query with Latin letters and no Cyrillic one
// means the user forgot to switch the keyboard layout: the whole query is retyped key by key ("ifehvf" →
// "шаурма"). A mixed query is left as it is. Punctuation between digits stays ("2,5" is a number).
export function fixKeyboardLayout(query: string): string {
  if (CYRILLIC_LETTER.test(query) || !LATIN_LETTER.test(query)) return query;

  return query
    .split('')
    .map((char, index) => {
      const russianChar = LATIN_TO_RUSSIAN_KEYS[char.toLowerCase()];
      if (!russianChar) return char;

      const isPunctuationBetweenDigits =
        !LATIN_LETTER.test(char) && DIGIT.test(query[index - 1] ?? '') && DIGIT.test(query[index + 1] ?? '');
      return isPunctuationBetweenDigits ? char : russianChar;
    })
    .join('');
}
