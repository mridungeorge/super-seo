// `sm rank <domain> [more domains]`: popularity ranks side by side (Tranco list, plus Cloudflare Radar
// when a token is set). A rank is a popularity signal, not a visit count.

import { Http } from '../core/http.js';
import { renderTable, makeColors, colorize, fmtNum } from '../core/table.js';
import { trancoRank, medianRank } from '../sources/tranco.js';
import { radarToken, radarRank } from '../sources/radar.js';

const clean = (s) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

export async function rankOne(http, domain, token) {
  const t = await trancoRank(http, domain).catch(() => null);
  const radar = token ? await radarRank(domain, token).catch(() => null) : null;
  return {
    domain,
    tranco: t ? { rank: medianRank(t), date: t.date, history: t.history.slice(0, 30) } : null,
    radar: radar ? { rank: radar.rank, bucket: radar.bucket, categories: radar.categories, date: radar.date } : null,
  };
}

export async function run(ctx) {
  const domains = [ctx.args._[0], ...ctx.args._.slice(1), ...String(ctx.args.competitors || '').split(',')].map(clean).filter(Boolean);
  const unique = [...new Set(domains)];
  if (!unique.length) {
    console.error('usage: sm rank <domain> [more domains] [--competitors a.com,b.com]');
    process.exitCode = 1;
    return;
  }
  const colors = makeColors(ctx.colors);
  const http = new Http({ cacheDir: ctx.cacheDir, noCache: ctx.noCache, refresh: ctx.refresh, verbose: ctx.verbose, minDelay: 1500 });
  const token = radarToken();
  const rows = [];
  for (const d of unique) rows.push(await rankOne(http, d, token));
  if (ctx.args.json) return console.log(JSON.stringify({ rows }, null, 2));
  console.log(colorize('POPULARITY RANK (lower is more popular)', 'bold', colors));
  console.log(
    renderTable(
      [['domain', 'Tranco rank', 'as of', 'Cloudflare Radar'], ...rows.map((r) => [r.domain, r.tranco ? fmtNum(r.tranco.rank) : 'not in list', r.tranco?.date || '-', r.radar ? (r.radar.rank !== null ? fmtNum(r.radar.rank) : `top ${fmtNum(r.radar.bucket)}`) : token ? 'not in list' : 'no token'])],
      { align: ['l', 'r', 'l', 'r'], colors },
    ),
  );
}
