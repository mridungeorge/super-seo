// `sm intel <domain>` — domain/company research from open sources (RDAP, DNS, certificate
// transparency, Wayback). `sm wayback` and `sm demand` reuse the same sources.

import { renderTable, makeColors, colorize, fmtNum } from '../core/table.js';
import { wayback, rdap, dnsRecords, subdomains, wikiPageviews } from '../sources/open.js';

const clean = (s) => (s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

export async function run(ctx) {
  const colors = makeColors(ctx.colors);
  if (ctx.command === 'demand') return demand(ctx, colors);
  const domain = clean(ctx.args._[0]);
  if (!domain) {
    console.error(`usage: sm ${ctx.command} <domain>`);
    process.exitCode = 1;
    return;
  }
  const only = ctx.command === 'wayback';
  const [w, r, d, subs] = await Promise.all([
    wayback(domain),
    only ? null : rdap(domain),
    only ? null : dnsRecords(domain),
    only ? null : subdomains(domain),
  ]);
  if (ctx.args.json) {
    console.log(JSON.stringify({ domain, wayback: w, rdap: r, dns: d, subdomains: subs }, null, 2));
    return;
  }
  console.log(colorize(`${ctx.command.toUpperCase()} — ${domain}`, 'bold', colors));
  const rows = [['signal', 'value']];
  if (r) rows.push(['registered', r.registered?.slice(0, 10) || '-'], ['expires', r.expires?.slice(0, 10) || '-'], ['registrar', r.registrar || '-'], ['nameservers', r.nameservers.join(', ') || '-']);
  else if (!only) rows.push(['registration (RDAP)', 'unavailable']);
  if (w) rows.push(['first archived', w.firstSeen], ['last archived', w.lastSeen], ['months archived', fmtNum(w.monthsWithSnapshots)]);
  else rows.push(['web archive', 'no snapshots']);
  if (d) rows.push(['A records', d.a.join(', ') || '-'], ['mail (MX)', d.mx.join(', ') || '-'], ['SPF', d.spf ? d.spf.slice(0, 90) : '-'], ['service verifications', d.verifications.join(', ') || '-']);
  if (subs) rows.push(['subdomains in cert logs', `${subs.length}` + (subs.length ? ' — ' + subs.slice(0, 8).join(', ') + (subs.length > 8 ? ', …' : '') : '')]);
  else if (!only) rows.push(['subdomains (crt.sh)', 'unavailable (service slow or down)']);
  console.log(renderTable(rows, { align: ['l', 'l'], colors }));
  if (w) console.log(renderTable([['year', 'monthly captures'], ...Object.entries(w.perYear)], { align: ['l', 'r'], colors }));
}

async function demand(ctx, colors) {
  const term = ctx.args._.join(' ').trim();
  if (!term) {
    console.error('usage: sm demand <wikipedia article title>   e.g. sm demand "Adobe Inc."');
    process.exitCode = 1;
    return;
  }
  const rows = await wikiPageviews(term, { months: Number(ctx.args.months || 24) });
  if (!rows?.length) {
    console.error(`no Wikipedia pageview data for "${term}" (use the exact article title).`);
    process.exitCode = 2;
    return;
  }
  if (ctx.args.json) return console.log(JSON.stringify({ term, rows }, null, 2));
  const max = Math.max(...rows.map((r) => r.views));
  const last12 = rows.slice(-12).reduce((s, r) => s + r.views, 0);
  const prev12 = rows.slice(-24, -12).reduce((s, r) => s + r.views, 0);
  console.log(colorize(`DEMAND — Wikipedia pageviews for "${term}"`, 'bold', colors));
  console.log(renderTable([['month', 'views', ''], ...rows.map((r) => [r.month, fmtNum(r.views), '█'.repeat(Math.round((r.views / max) * 30))])], { align: ['l', 'r', 'l'], colors }));
  if (rows.length >= 24 && prev12) console.log(`last 12 months vs prior 12: ${(((last12 - prev12) / prev12) * 100).toFixed(1)}%   (a public interest proxy, not search volume)`);
}
