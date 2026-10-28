// Strips whitespace and turns decimal commas into dots, so "1 200,5" becomes "1200.5".
export function normalizeAmountInput(value: string): string {
  let normalized = '';

  for (const char of value) {
    if (char.trim() === '') continue;
    normalized += char === ',' ? '.' : char;
  }

  return normalized;
}

// Evaluates a typed amount: a plain number or an arithmetic expression with + - * / and
// parentheses ("80*2", "(100+50)/3"). Returns null for empty, malformed or non-finite input.
export function evaluateAmountExpression(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = normalizeAmountInput(value);
  if (!normalized) return null;

  return parseAmountExpression(normalized);
}

// Same as evaluateAmountExpression, rounded to a whole number (e.g. grams of food).
export function evaluateWholeAmount(value: string | null | undefined): number | null {
  const result = evaluateAmountExpression(value);
  return result === null ? null : Math.round(result);
}

function parseAmountExpression(value: string): number | null {
  let index = 0;

  const parseExpression = (): number | null => {
    let left = parseTerm();
    if (left == null) return null;

    while (index < value.length) {
      const operator = value[index];
      if (operator !== '+' && operator !== '-') break;
      index += 1;

      const right = parseTerm();
      if (right == null) return null;

      left = operator === '+' ? left + right : left - right;
    }

    return left;
  };

  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left == null) return null;

    while (index < value.length) {
      const operator = value[index];
      if (operator !== '*' && operator !== '/') break;
      index += 1;

      const right = parseFactor();
      if (right == null) return null;

      if (operator === '*') {
        left *= right;
        continue;
      }

      if (right === 0) return null;
      left /= right;
    }

    return left;
  };

  const parseFactor = (): number | null => {
    let sign = 1;

    while (index < value.length) {
      const operator = value[index];
      if (operator === '+') {
        index += 1;
        continue;
      }
      if (operator === '-') {
        sign *= -1;
        index += 1;
        continue;
      }
      break;
    }

    if (index >= value.length) return null;

    if (value[index] === '(') {
      index += 1;
      const nested = parseExpression();
      if (nested == null || value[index] !== ')') return null;
      index += 1;
      return sign * nested;
    }

    const start = index;
    while (index < value.length) {
      const char = value[index];
      if ((char >= '0' && char <= '9') || char === '.') {
        index += 1;
        continue;
      }
      break;
    }

    if (start === index) return null;

    const parsed = Number(value.slice(start, index));
    if (!Number.isFinite(parsed)) return null;

    return sign * parsed;
  };

  const parsed = parseExpression();
  if (parsed == null || index !== value.length || !Number.isFinite(parsed)) return null;

  return parsed;
}
