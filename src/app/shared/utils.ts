import { USER_PREFERRED_MIDNIGHT_OFFSET_HOURS } from '@app/shared/const';

export function calculateTodayIsoWithUserTimeShift(): string {
  const todayDate = calcDateWithUserTimeShift(new Date());
  const todayIso = dateToIsoNoTimeNoTZ(todayDate);
  return todayIso;
}

export function dateToIsoNoTimeNoTZ(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function epochToIsoNoTimeNoTZ(tsMs: number): string {
  const date = new Date(tsMs);
  return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
}

// export function dateToIsoNoTimeNoTZ(milliseconds: number): string {
//   // There was a more neat way (date.toISOString().slice(0,10)), but there were problems with TZs
//   const date = new Date(milliseconds);
//   return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
// }


export function calcDateWithUserTimeShift(date: Date): Date {
  const adjustedDate = new Date(date.getTime());
  adjustedDate.setHours(adjustedDate.getHours() - USER_PREFERRED_MIDNIGHT_OFFSET_HOURS);
  return adjustedDate;
}

// All-UTC date arithmetic — deliberately avoids new Date(dateISO) for parsing (that reads a
// date-only string as UTC midnight, which shifts by a day once read back through local getters for
// any user behind UTC) by building/reading the Date exclusively through its UTC accessors.
export function isoDaysBefore(dateISO: string, daysBefore: number): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - daysBefore);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function formatDateTicks(dateIso: string): string {
  const date = new Date(dateIso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// export function generateDatesList(inputDateIso: string): string[] {
//   const today = new Date().setHours(0, 0, 0, 0);
//   const inputDate = new Date(inputDateIso);
//   const resultDatesList: string[] = [];

//   for (let i = -FETCH_DAYS_RANGE_OFFSET; i <= FETCH_DAYS_RANGE_OFFSET; i++) {
//     const newDate = new Date(inputDate);
//     newDate.setDate(inputDate.getDate() + i);
//     newDate.setHours(0, 0, 0, 0);
//     if (newDate.getTime() > today) {
//       break;
//     }
//     const isoDate = dateToIsoNoTimeNoTZ(newDate.getTime());
//     resultDatesList.push(isoDate);
//   }

//   return resultDatesList;
// }

export function splitNumber(numStr: string): [string, string, string] {
  let sign = '';
  if (numStr.startsWith('-')) {
    sign = '-';
    numStr = numStr.substring(1);
  }
  let [integer, fraction] = numStr.split('.');
  return [sign, integer, fraction ? '.' + fraction : ''];
}

export function divideNumberWithWhitespaces(num: string): string {
  let result = [];
  let count = 0;
  for (let i = num.length - 1; i >= 0; i--) {
    if (count > 0 && count % 3 === 0) {
      result.unshift(' ');
    }
    result.unshift(num.charAt(i));
    count++;
  }
  return result.join('');
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aEntries = Object.entries(a as Record<string, unknown>);
  const bRecord = b as Record<string, unknown>;
  if (aEntries.length !== Object.keys(bRecord).length) return false;
  return aEntries.every(([key, value]) => isDeepEqual(value, bRecord[key]));
}

// Purely a safety bound against pathological inputs (e.g. an absurdly small target width on a very
// wide container) — no realistic column-fit layout ever approaches this many columns.
const FIT_COLUMNS_MAX_SEARCH = 64;

// Finds the column count whose per-column width (container width minus gaps, divided by columns)
// lands closest to targetWidthPx. Fitted width shrinks monotonically as columns grow, so the first
// column count that stops improving on the previous one is the answer.
export function fitColumnsToWidth(containerWidthPx: number, targetWidthPx: number, gapPx: number): number {
  if (targetWidthPx <= 0 || containerWidthPx <= 0) return 1;

  const fittedWidth = (columns: number) => (containerWidthPx - gapPx * (columns - 1)) / columns;
  let bestColumns = 1;
  let bestDelta = Math.abs(fittedWidth(1) - targetWidthPx);
  for (let columns = 2; columns <= FIT_COLUMNS_MAX_SEARCH; columns++) {
    const width = fittedWidth(columns);
    if (width <= 0) break;
    const delta = Math.abs(width - targetWidthPx);
    if (delta >= bestDelta) break;
    bestColumns = columns;
    bestDelta = delta;
  }
  return bestColumns;
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2') // Adds hyphen between camelCase parts (e.g. 'camelCase' -> 'camel-Case')
    .replace(/[\s_]+/g, '-') // Replaces spaces and underscores with hyphens
    .toLowerCase();
}

/**
 * Returns the correct declension of a Russian word depending on the number.
 *
 * @param number - The number determining the word form.
 * @param one - The form for one (e.g., "день").
 * @param few - The form for a few (e.g., "дня").
 * @param many - The form for many (e.g., "дней").
 * @returns The appropriate word form.
 *
 * @example
 * getRuDeclension(1, 'день', 'дня', 'дней'); // 'день'
 * getRuDeclension(2, 'день', 'дня', 'дней'); // 'дня'
 * getRuDeclension(5, 'день', 'дня', 'дней'); // 'дней'
 */
export function getRuDeclension(number: number, one: string, few: string, many: string): string {
  // Corner cases first: numbers from 11 to 14
  const numberAsString = String(number);
  const lastTwoDigits = numberAsString.slice(-2);

  if (['11', '12', '13', '14'].includes(lastTwoDigits)) return many;

  // Next, checking only the last digit
  const lastDigit = numberAsString.slice(-1);

  if (['0', '5', '6', '7', '8', '9'].includes(lastDigit)) return many;

  if (['2', '3', '4'].includes(lastDigit)) return few;

  if (lastDigit === '1') return one;

  // Fallback in case of NaN|Infinity
  return many;
}
