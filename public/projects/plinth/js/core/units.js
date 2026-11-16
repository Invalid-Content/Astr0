/**
 * core/units.js — unit conversion, number formatting and expression parsing.
 *
 * The document stores every length in millimetres. This module converts to
 * and from the user's chosen display unit and parses typed input such as
 * "25.4", "1in", "10cm + 5" or "120/3".
 */

export const UNITS = {
  mm: { label: 'mm', name: 'Millimetres', mm: 1 },
  cm: { label: 'cm', name: 'Centimetres', mm: 10 },
  m: { label: 'm', name: 'Metres', mm: 1000 },
  in: { label: 'in', name: 'Inches', mm: 25.4 },
};

const SUFFIX = { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4, ft: 304.8, "'": 304.8 };

/** Format a plain number with a fixed maximum precision, trimming trailing zeros. */
export function formatNumber(v, precision = 2) {
  if (!Number.isFinite(v)) return '—';
  let s = v.toFixed(precision);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** Format a millimetre value in the given unit settings, e.g. "25.4 mm". */
export function formatLength(mm, settings, withUnit = true) {
  const u = UNITS[settings.unit] || UNITS.mm;
  const s = formatNumber(mm / u.mm, settings.precision);
  return withUnit ? `${s} ${u.label}` : s;
}

/**
 * Parse an arithmetic expression. Numbers may carry a length suffix; bare
 * numbers are multiplied by `bareFactor` (the display unit in mm for lengths,
 * 1 for angles and counts). Returns NaN if the text is not a valid expression.
 */
export function parseExpression(text, bareFactor = 1) {
  const src = String(text).trim().replace(/,/g, '.').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/°/g, '');
  if (!src) return NaN;
  let i = 0;
  const ws = () => { while (src[i] === ' ') i++; };
  function number() {
    ws();
    const m = /^(\d+\.?\d*|\.\d+)\s*(mm|cm|m|in|ft|"|')?/.exec(src.slice(i));
    if (!m) throw new Error('number');
    i += m[0].length;
    return parseFloat(m[1]) * (m[2] ? SUFFIX[m[2]] : bareFactor);
  }
  function factor() {
    ws();
    if (src[i] === '-') { i++; return -factor(); }
    if (src[i] === '+') { i++; return factor(); }
    if (src[i] === '(') {
      i++;
      const v = sum();
      ws();
      if (src[i] !== ')') throw new Error(')');
      i++;
      return v;
    }
    return number();
  }
  // In a product only the first operand keeps its unit; later bare numbers are scalars.
  function product() {
    let v = factor();
    for (;;) {
      ws();
      const op = src[i];
      if (op !== '*' && op !== '/') return v;
      i++;
      const saved = bareFactor;
      bareFactor = 1;
      const r = factor();
      bareFactor = saved;
      v = op === '*' ? v * r : v / r;
    }
  }
  function sum() {
    let v = product();
    for (;;) {
      ws();
      const op = src[i];
      if (op !== '+' && op !== '-') return v;
      i++;
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
  }
  try {
    const v = sum();
    ws();
    return i === src.length && Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** Parse a typed length into millimetres using the current display unit. */
export const parseLength = (text, settings) => parseExpression(text, (UNITS[settings.unit] || UNITS.mm).mm);
