// `sm psi <url>` (Google PageSpeed Insights: Lighthouse + real-user field data) and
// `sm radar <domain>` (Cloudflare Radar rank/bucket/categories and a 28-day rank series).

import { renderTable, makeColors, colorize, fmtNum } from '../core/table.js';
import { psiKey, fetchPsi } from '../sources/psi.js';
import { radarToken, radarRank, radarSeries } from '../sources/radar.js';

const bar = (n, max, w = 24) => '█'.repeat(Math.max(0, Math.round((n / max) * w)));

export async function run(ctx) {
  const colors = makeColors(ctx.colors);
  const target = (ctx.args._[0] || '').trim();
  if (!target) {
    console.error(ctx.command === 'psi' ? 'usage: sm psi <url> [--desktop]' : 'usage: sm radar <domain>');
    process.exitCode = 1;
    return;
  }
  try {
    return ctx.command === 'psi' ? await psi(ctx, colors, target) : await radar(ctx, colors, target);
  } catch (err) {
    console.error(`${ctx.command}: ${err.message}`);
    process.exitCode = 2;
  }
}

async function psi(ctx, colors, target) {
  const url = /^https?:\/\//.test(target) ? target : 'https://' + target;
  const r = await fetchPsi(url, psiKey(), { strategy: ctx.args.desktop ? 'desktop' : 'mobile' });
  if (ctx.args.json) return console.log(JSON.stringify(r, null, 2));
  console.log(colorize(`PAGESPEED — ${r.url}   (${r.strategy})`, 'bold', colors));
  console.log(renderTable([['category', 'score'], ...Object.entries(r.scores).map(([k, v]) => [k, v === null ? '-' : String(v)])], { align: ['l', 'r'], colors }));
  const rows = [['metric', 'lab (Lighthouse)', 'real users, this URL (p75)', 'real users, origin (p75)']];
  for (const m of ['lcp', 'inp', 'cls', 'fcp', 'ttfb']) {
    const f = (x) => (x?.[m] ? `${x[m].p75}${x[m].unit === 'ms' ? ' ms' : ''} (${String(x[m].rating).toLowerCase()})` : '-');
    rows.push([m.toUpperCase(), r.lab[m]?.display || '-', f(r.field), f(r.originField)]);
  }
  console.log(renderTable(rows, { align: ['l', 'r', 'r', 'r'], colors }));
  if (!r.field && !r.originField) console.log(colorize('  no real-user data: Chrome UX Report has too few visits for this URL/origin.', 'dim', colors));
  if (r.topIssues.length) console.log(renderTable([['top issues', 'savings'], ...r.topIssues.map((i) => [i.title, i.savings ? `${Math.round(i.savings)} ms` : '-'])], { align: ['l', 'r'], colors }));
}

async function radar(ctx, colors, target) {
  const domain = target.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const token = radarToken();
  const [info, series] = await Promise.all([radarRank(domain, token), radarSeries(domain, token, { range: ctx.args.range || '28d' }).catch(() => [])]);
  if (ctx.args.json) return console.log(JSON.stringify({ ...info, series }, null, 2));
  console.log(colorize(`CLOUDFLARE RADAR — ${domain}`, 'bold', colors));
  console.log(
    renderTable(
      [
        ['signal', 'value'],
        ['rank', info.rank !== null ? fmtNum(info.rank) : `not individually ranked (top ${fmtNum(info.bucket)} bucket)`],
        ['categories', info.categories.join(', ') || '-'],
        ['as of', info.date || '-'],
      ],
      { align: ['l', 'l'], colors },
    ),
  );
  const ranked = series.filter((s) => s.rank !== null);
  if (ranked.length) {
    const worst = Math.max(...ranked.map((s) => s.rank));
    console.log(renderTable([['date', 'rank', ''], ...ranked.map((s) => [s.date, fmtNum(s.rank), bar(worst - s.rank + 1, worst)])], { align: ['l', 'r', 'l'], colors }));
  }
}
