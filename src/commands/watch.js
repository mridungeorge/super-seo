// `sm watch <domain>`: re-measure on a schedule and write each result into the history store, so
// `sm history` can show health, speed and rank over time.

import { Http } from '../core/http.js';
import { crawlSite } from '../collect/crawl.js';
import { trancoRank, medianRank } from '../sources/tranco.js';
import { radarToken, radarRank } from '../sources/radar.js';
import { psiKey, fetchPsi } from '../sources/psi.js';
import { recordSnapshot, recordRun } from '../core/store.js';
import { colorize, makeColors } from '../core/table.js';

const norm = (s) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

export function parseInterval(s) {
  if (!s) return 3600000;
  const m = String(s).match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!m) return 3600000;
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[(m[2] || 'h').toLowerCase()];
  return Number(m[1]) * mult;
}

/** One measurement: a small crawl, popularity ranks and (with a key) PageSpeed. */
export async function measure(domain, { http, pages = 30, psi = false } = {}) {
  const metrics = {};
  const crawl = await crawlSite(domain, { maxPages: pages, concurrency: 3, checkExternal: false });
  if (crawl.blocked) metrics.crawl_blocked = 1;
  else {
    const s = crawl.summary;
    Object.assign(metrics, { health: { value: s.healthScore, unit: 'score' }, errors: s.errors, warnings: s.warnings, notices: s.notices, pages_crawled: s.pages, avg_response_ms: { value: s.avgTtfb, unit: 'ms' } });
  }
  const t = await trancoRank(http, domain).catch(() => null);
  if (t) metrics.rank_tranco = { value: medianRank(t), unit: 'rank' };
  const rt = radarToken();
  const radar = rt ? await radarRank(domain, rt).catch(() => null) : null;
  if (radar) metrics.rank_radar = { value: radar.rank ?? radar.bucket, unit: radar.rank ? 'rank' : 'bucket' };
  if (psi && psiKey()) {
    const p = await fetchPsi('https://' + domain, psiKey(), { strategy: 'mobile' }).catch(() => null);
    if (p) for (const [k, v] of Object.entries(p.scores)) metrics['psi_' + k.replace(/-/g, '_')] = { value: v, unit: 'score' };
  }
  return metrics;
}

export async function run(ctx) {
  const domain = norm(ctx.args._[0]);
  if (!domain) {
    console.error('usage: sm watch <domain> [--interval 1h] [--runs 5] [--pages 30] [--psi]');
    process.exitCode = 1;
    return;
  }
  const interval = parseInterval(ctx.args.interval);
  const runs = Number(ctx.args.runs || 0); // 0 = forever
  const colors = makeColors(ctx.colors);
  const http = new Http({ cacheDir: ctx.cacheDir, noCache: ctx.noCache, refresh: true, verbose: ctx.verbose });

  const cycle = async () => {
    const started = new Date().toISOString();
    try {
      const metrics = await measure(domain, { http, pages: Number(ctx.args.pages) || 30, psi: !!ctx.args.psi });
      recordSnapshot(ctx.dbPath, domain, metrics);
      const h = metrics.health?.value;
      console.log(colorize(`[${started}] ${domain} recorded: health ${h ?? 'n/a'}, ${Object.keys(metrics).length} metrics`, 'green', colors));
      recordRun(ctx.dbPath, { command: 'watch', domains: [domain], status: 'ok', notes: `${Object.keys(metrics).length} metrics` });
    } catch (err) {
      console.error(colorize(`[${started}] ${domain} failed: ${err.message}`, 'red', colors));
      recordRun(ctx.dbPath, { command: 'watch', domains: [domain], status: 'error', notes: err.message });
    }
  };

  await cycle();
  if (runs > 0) {
    for (let i = 1; i < runs; i++) {
      await new Promise((r) => setTimeout(r, interval));
      await cycle();
    }
    return;
  }
  console.log(colorize(`watching every ${Math.round(interval / 1000)}s, Ctrl-C to stop`, 'dim', colors));
  for (;;) {
    await new Promise((r) => setTimeout(r, interval));
    await cycle();
  }
}
