// Thin space — narrow enough to stay unobtrusive but still renders reliably at
// small canvas font sizes (unlike hair space, which some renderers round away
// to 0px on chart tick labels, e.g. the Y-axis ticks in chart-config.ts).
// export const THIN_SPACE = ' '; // U+2009 THIN SPACE (~1/5 em) — active
//
// All 17 Unicode "Space Separator" (category Zs) characters exist — no more,
// no less (source: unicode.org / compart.com/en/unicode/category/Zs). Listed
// below narrowest → widest (approximate, varies by font/renderer). Pick one,
// move it above as the active THIN_SPACE, comment the rest back out.
// export const THIN_SPACE = ' '; // U+200A HAIR SPACE (~1/10 em) — narrowest visible space. WARNING: some renderers round this to 0px at small canvas font sizes (chart axis ticks) — verify there before picking it.
// export const THIN_SPACE = ' '; // U+2006 SIX-PER-EM SPACE (~1/6 em)
// export const THIN_SPACE = ' '; // U+202F NARROW NO-BREAK SPACE (~1/5 em, non-breaking — won't wrap the number across lines)
export const THIN_SPACE = ' '; // U+205F MEDIUM MATHEMATICAL SPACE (~2/9 em)
// export const THIN_SPACE = ' '; // U+2008 PUNCTUATION SPACE (~width of "." in the font)
// export const THIN_SPACE = ' '; // U+2005 FOUR-PER-EM SPACE (~1/4 em) — previous default in this file
// export const THIN_SPACE = ' '; // U+00A0 NO-BREAK SPACE (regular space width, non-breaking)
// export const THIN_SPACE = ' '; // U+0020 SPACE (regular space width, ordinary ASCII space)
// export const THIN_SPACE = ' '; // U+2004 THREE-PER-EM SPACE (~1/3 em)
// export const THIN_SPACE = ' '; // U+2000 EN QUAD (~1/2 em, same width as EN SPACE)
// export const THIN_SPACE = ' '; // U+2002 EN SPACE (1/2 em)
// export const THIN_SPACE = ' '; // U+2007 FIGURE SPACE (width of a digit "0" in the font — tabular)
// export const THIN_SPACE = ' '; // U+1680 OGHAM SPACE MARK — RISKY: fonts without Ogham support may render a visible dash/box instead of blank space
// export const THIN_SPACE = ' '; // U+2001 EM QUAD (1 em, same width as EM SPACE)
// export const THIN_SPACE = ' '; // U+2003 EM SPACE (1 em)
// export const THIN_SPACE = '　'; // U+3000 IDEOGRAPHIC SPACE (1 em, full-width CJK space) — widest
//
// Not true spaces (category Cf — "Format", zero-width/invisible), listed only
// for completeness since they're sometimes grouped with "space characters" in
// round-ups online. Unusable here: they render with NO visible gap at all, so
// digits would look mashed together ("1234567" instead of "1 234 567").
// export const THIN_SPACE = '​'; // U+200B ZERO WIDTH SPACE — zero width, invisible
// export const THIN_SPACE = '⁠'; // U+2060 WORD JOINER — zero width, invisible, also non-breaking
// export const THIN_SPACE = '﻿'; // U+FEFF ZERO WIDTH NO-BREAK SPACE (byte-order mark) — zero width, invisible
// export const THIN_SPACE = '᠎'; // U+180E MONGOLIAN VOWEL SEPARATOR — zero width in modern fonts; reclassified out of the Zs category in Unicode 6.3

function groupDigits(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

// Groups the integer part of an already-formatted number string (e.g. "-1234.50")
// by thousands, leaving the sign and decimal part untouched.
export function groupNumberText(text: string): string {
  const negative = text.startsWith('-');
  const [intPart, decPart] = (negative ? text.slice(1) : text).split('.');
  return `${negative ? '-' : ''}${groupDigits(intPart)}${decPart ? '.' + decPart : ''}`;
}
