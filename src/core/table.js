// Terminal table renderer with no dependencies.

const ESC = String.fromCharCode(27);
const ANSI = {
  reset: ESC + '[0m',
  dim: ESC + '[2m',
  bold: ESC + '[1m',
  red: ESC + '[31m',
  green: ESC + '[32m',
  yellow: ESC + '[33m',
  blue: ESC + '[34m',
  magenta: ESC + '[35m',
  cyan: ESC + '[36m',
  gray: ESC + '[90m',
};
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g');

export function makeColors(enabled) {
  if (enabled) return ANSI;
  const off = {};
  for (const k of Object.keys(ANSI)) off[k] = '';
  return off;
}

export function colorize(text, color, colors) {
  return `${colors[color] || ''}${text}${colors.reset || ''}`;
}

function width(s) {
  return [...String(s).replace(ANSI_RE, '')].length;
}

function pad(s, n, align = 'left') {
  const w = width(s);
  const filler = ' '.repeat(Math.max(0, n - w));
  if (align === 'right') return filler + s;
  if (align === 'center') {
    const l = Math.floor(filler.length / 2);
    return ' '.repeat(l) + s + ' '.repeat(filler.length - l);
  }
  return s + filler;
}

/**
 * rows: array of arrays of strings (first row is the header).
 * opts: { align: [], colors, title }
 */
export function renderTable(rows, { align = [], colors = ANSI, title = null } = {}) {
  if (!rows || rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = [];
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(...rows.map((r) => width(r[c] ?? '')));
  }
  const line = (vals) =>
    '| ' +
    widths
      .map((w, c) => pad(String(vals[c] ?? ''), w, align[c] || 'left'))
      .join(' | ') +
    ' |';
  const sep = '|-' + widths.map((w) => '-'.repeat(w + 2)).join('-') + '-|';

  const out = [];
  if (title) out.push(colorize(title, 'bold', colors));
  out.push(line(rows[0]));
  out.push(sep);
  for (let i = 1; i < rows.length; i++) out.push(line(rows[i]));
  return out.join('\n');
}

/** A simple horizontal bar for sparklines. */
export function sparkline(values, { width = 24, colors = ANSI } = {}) {
  const blocks = '▁▂▃▄▅▆▇█';
  const nums = values.filter((v) => typeof v === 'number' && isFinite(v));
  if (!nums.length) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const out = values.map((v) => {
    if (typeof v !== 'number' || !isFinite(v)) return ' ';
    const i = Math.min(blocks.length - 1, Math.floor(((v - min) / span) * (blocks.length - 1)));
    return blocks[i];
  });
  return colorize(out.join(''), 'cyan', colors);
}

export function fmtNum(v, digits = 0) {
  if (typeof v !== 'number' || !isFinite(v)) return '-';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPct(v, digits = 2) {
  if (typeof v !== 'number' || !isFinite(v)) return '-';
  return (v * 100).toFixed(digits) + '%';
}

export function fmtBytes(n) {
  if (typeof n !== 'number') return '-';
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1024 / 1024).toFixed(1) + 'MB';
}
