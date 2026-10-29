// Inline-SVG chart helpers shared by the dashboard and the written report. Every chart prints its
// numbers; nothing relies on hover or colour alone.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const isNum = (n) => typeof n === 'number' && isFinite(n);
export const num = (n, d = 0) => (isNum(n) ? n.toLocaleString('en-AU', { maximumFractionDigits: d }) : '—');
export const pct = (n, d = 1) => (isNum(n) ? (n * 100).toFixed(d) + '%' : '—');
export const compact = (n) => (!isNum(n) ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
export const short = (s, n = 70) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));

/** Categorical palette, readable on light and dark. */
export const PALETTE = ['#4f8cff', '#f2994a', '#27ae80', '#b06bff', '#eb5757', '#2dc2d6', '#e2b93b', '#8a94a6'];

/** Change chip: ▲ 4.2% (green) / ▼ 8.5% (red). `invert` flips meaning for metrics where lower is better. */
export function delta(cur, prev, { invert = false } = {}) {
  if (!isNum(cur) || !isNum(prev) || prev === 0) return '';
  const d = (cur - prev) / Math.abs(prev);
  const good = invert ? d < 0 : d > 0;
  const cls = Math.abs(d) < 0.0005 ? 'dim' : good ? 'good' : 'bad';
  return `<span class="delta ${cls}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(1)}%</span>`;
}

/** Tiny trend line. values oldest → newest. */
export function spark(values, { w = 110, h = 30, color = 'var(--accent)' } = {}) {
  const v = values.filter(isNum);
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const x = (i) => (i / (v.length - 1)) * (w - 4) + 2;
  const y = (n) => (hi === lo ? h / 2 : h - 3 - ((n - lo) / (hi - lo)) * (h - 6));
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(v.length - 1).toFixed(1)}" cy="${y(v[v.length - 1]).toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}

/** Donut with a centre label and a legend that prints value and share. items: {label, value, color?} */
export function donut(items, { center = '', sub = '', fmt = num, size = 150 } = {}) {
  const data = items.filter((i) => isNum(i.value) && i.value > 0).map((i, k) => ({ ...i, color: i.color || PALETTE[k % PALETTE.length] }));
  const total = data.reduce((n, i) => n + i.value, 0);
  if (!total) return '<p class="dim">no data</p>';
  const r = 52;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = data
    .map((i) => {
      const len = (i.value / total) * c;
      const el = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${i.color}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(i.label)}: ${esc(fmt(i.value))}</title></circle>`;
      acc += len;
      return el;
    })
    .join('');
  const legend = data.map((i) => `<div class="lg"><i style="background:${i.color}"></i><span>${esc(short(i.label, 26))}</span><b>${esc(fmt(i.value))}</b><em>${pct(i.value / total, 0)}</em></div>`).join('');
  return `<div class="donut"><svg viewBox="0 0 140 140" width="${size}" height="${size}" role="img">${arcs}<text x="70" y="${sub ? 68 : 75}" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)">${esc(center)}</text>${sub ? `<text x="70" y="86" text-anchor="middle" font-size="10" fill="var(--dim)">${esc(sub)}</text>` : ''}</svg><div class="legend2">${legend}</div></div>`;
}

/** Area/line chart with a value label on every point. points: {label, value}, oldest → newest. */
export function area(points, { fmt = compact, color = 'var(--accent)', h = 170 } = {}) {
  const p = points.filter((q) => isNum(q.value));
  if (p.length < 2) return p.length ? `<div class="big">${esc(fmt(p[0].value))}<small>${esc(p[0].label)}</small></div>` : '<p class="dim">no data</p>';
  const W = 560;
  const padL = 8;
  const padR = 8;
  const top = 26;
  const bottom = 24;
  const lo = Math.min(0, ...p.map((q) => q.value));
  const hi = Math.max(...p.map((q) => q.value));
  const span = hi - lo || 1;
  const x = (i) => padL + (i / (p.length - 1)) * (W - padL - padR);
  const y = (v) => top + (1 - (v - lo) / span) * (h - top - bottom);
  const line = p.map((q, i) => `${x(i).toFixed(1)},${y(q.value).toFixed(1)}`).join(' ');
  const fill = `${x(0).toFixed(1)},${(h - bottom).toFixed(1)} ${line} ${x(p.length - 1).toFixed(1)},${(h - bottom).toFixed(1)}`;
  const step = Math.ceil(p.length / 6);
  const lo2 = p.reduce((m, q, i) => (q.value < p[m].value ? i : m), 0);
  const hi2 = p.reduce((m, q, i) => (q.value > p[m].value ? i : m), 0);
  const showVal = (i) => p.length <= 8 || i === 0 || i === p.length - 1 || i === lo2 || i === hi2;
  const showLabel = (i) => p.length <= 8 || i % step === 0 || i === p.length - 1;
  const dots = p.map((q, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(q.value).toFixed(1)}" r="${p.length > 8 ? 2.2 : 3.5}" fill="${color}"/>${showVal(i) ? `<text x="${x(i).toFixed(1)}" y="${(y(q.value) - 9).toFixed(1)}" text-anchor="${i === 0 ? 'start' : i === p.length - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--text)">${esc(fmt(q.value))}</text>` : ''}${showLabel(i) ? `<text x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === p.length - 1 ? 'end' : 'middle'}" font-size="10" fill="var(--dim)">${esc(q.label)}</text>` : ''}`).join('');
  return `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img"><polygon points="${fill}" fill="${color}" opacity=".14"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>${dots}</svg>`;
}

/** Vertical columns, each labelled with its value. */
export function columns(points, { fmt = compact, color = 'var(--accent)', h = 150 } = {}) {
  if (!points.length) return '<p class="dim">no data</p>';
  const W = 560;
  const max = Math.max(...points.map((p) => p.value || 0), 1);
  const step = (W - 16) / points.length;
  const bw = Math.min(56, step - 8);
  return `<svg viewBox="0 0 ${W} ${h}" width="100%" role="img">${points
    .map((p, i) => {
      const bh = Math.max(2, ((p.value || 0) / max) * (h - 42));
      const x = 8 + i * step + (step - bw) / 2;
      return `<rect x="${x.toFixed(1)}" y="${(h - 20 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${p.color || color}"/><text x="${(x + bw / 2).toFixed(1)}" y="${(h - 24 - bh).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--text)">${esc(fmt(p.value))}</text><text x="${(x + bw / 2).toFixed(1)}" y="${h - 5}" text-anchor="middle" font-size="10" fill="var(--dim)">${esc(p.label)}</text>`;
    })
    .join('')}</svg>`;
}

/** Horizontal bars with the number printed at the end. items: {label, value, text?, color?} */
export function hbars(items, { fmt = num } = {}) {
  if (!items.length) return '<p class="dim">no data</p>';
  const max = Math.max(...items.map((i) => i.value || 0), 1e-9);
  return items.map((i, k) => `<div class="hb"><span title="${esc(i.label)}">${esc(short(i.label, 38))}</span><div><i style="width:${Math.max(1.5, ((i.value || 0) / max) * 100).toFixed(1)}%;background:${i.color || PALETTE[0]}"></i></div><b>${esc(i.text ?? fmt(i.value))}</b></div>`).join('');
}

/** Score ring 0-100. */
export function ring(score, label, { size = 76 } = {}) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const s = isNum(score) ? Math.max(0, Math.min(100, score)) : 0;
  const colour = !isNum(score) ? 'var(--dim)' : score >= 90 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="ring"><svg width="${size}" height="${size}" viewBox="0 0 76 76"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/><circle cx="38" cy="38" r="${r}" fill="none" stroke="${colour}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${((s / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="43.5" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)">${isNum(score) ? Math.round(score) : '—'}</text></svg><span>${esc(label)}</span></div>`;
}

/** One stacked bar with a numeric legend. parts: {label, value, color} */
export function stack(parts) {
  const tot = parts.reduce((n, p) => n + (p.value || 0), 0) || 1;
  return `<div class="stack">${parts.map((p) => `<i style="width:${((p.value || 0) / tot) * 100}%;background:${p.color}" title="${esc(p.label)}: ${p.value}"></i>`).join('')}</div><div class="legend">${parts.map((p) => `<span style="--c:${p.color}">${esc(p.label)} <b>${num(p.value)}</b></span>`).join('')}</div>`;
}

export const CHART_CSS = `
.delta{font-size:12px;font-weight:600;margin-left:6px;white-space:nowrap}
.spark{display:block;margin-top:4px}
.donut{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.donut svg{flex:none}
.legend2{flex:1;min-width:150px;font-size:12.5px}
.lg{display:grid;grid-template-columns:10px 1fr auto 40px;gap:7px;align-items:center;padding:2px 0}.lg i{width:10px;height:10px;border-radius:3px}.lg span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lg b{font-variant-numeric:tabular-nums}.lg em{font-style:normal;color:var(--dim);text-align:right;font-variant-numeric:tabular-nums}
.hb{display:grid;grid-template-columns:minmax(80px,200px) 1fr minmax(48px,auto);gap:8px;align-items:center;margin:5px 0;font-size:12.5px}
.hb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hb div{background:var(--line);border-radius:5px;height:10px;overflow:hidden}.hb i{display:block;height:10px;border-radius:5px}.hb b{text-align:right;font-variant-numeric:tabular-nums}
.stack{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line);margin:6px 0}.stack i{display:block}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--dim)}.legend span:before{content:"";display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;background:var(--c)}.legend b{color:var(--text);font-variant-numeric:tabular-nums}
.ring{text-align:center;font-size:12px;color:var(--dim)}.ring svg{display:block;margin:0 auto 2px}
.big{font-size:30px;font-weight:700}.big small{display:block;font-size:12px;font-weight:400;color:var(--dim)}
`;
