// `sm serp <domain> --keywords a,b,c` — our own rank tracking.

import { captureSerp } from '../collect/serp.js';
import { openDb } from '../core/store.js';
import { renderTable, makeColors, colorize } from '../core/table.js';

export async function run(ctx) {
  const domain = (ctx.args._[0] || '').trim();
  const keywordArg = ctx.args.keywords || ctx.args.k;
  if (!domain || !keywordArg) {
    console.error('usage: sm serp <domain> --keywords "kw one,kw two" [--engine brave|bing|duckduckgo]');
    process.exitCode = 1;
    return;
  }
  const keywords = String(keywordArg)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const engine = ctx.args.engine || (process.env.BRAVE_API_KEY ? 'brave' : null);
  if (!engine) {
    console.error('sm serp needs a search engine: set BRAVE_API_KEY (recommended, official API) or pass --engine bing|duckduckgo (scrapes result pages; check the engine terms).');
    process.exitCode = 1;
    return;
  }
  if (engine !== 'brave') console.error('note: --engine ' + engine + ' reads result pages directly; automated queries may break that site terms.');
  const colors = makeColors(ctx.colors);

  const res = await captureSerp(domain, keywords, { engine, verbose: ctx.verbose });

  if (ctx.args.track) {
    const db = openDb(ctx.dbPath);
    const insert = db.prepare(
      'INSERT INTO metrics (domain, captured_at, as_of, source, field, value_num, value_text, unit, geography, window) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    for (const r of res) {
      insert.run(domain, r.capturedAt, r.capturedAt.slice(0, 10), 'own-serp', `serp.${engine}.${r.keyword}`, r.position, null, 'rank', 'WORLD', 'point');
    }
    db.close?.();
  }

  if (ctx.args.json) {
    console.log(JSON.stringify({ domain, engine, results: res }, null, 2));
    return;
  }

  console.log(colorize(`SERP — ${domain} (${engine})`, 'bold', colors));
  console.log();
  console.log(
    renderTable(
      [
        ['keyword', 'position', 'found', 'top result', 'captured'],
        ...res.map((r) => [
          r.keyword,
          r.position == null ? '-' : String(r.position),
          r.error ? 'error' : r.found ? 'yes' : 'no',
          r.results[0] ? `${r.results[0].domain} — ${String(r.results[0].title).slice(0, 40)}` : '-',
          r.capturedAt.replace('T', ' ').slice(0, 19),
        ]),
      ],
      { align: ['l', 'r', 'l', 'l', 'l'], colors },
    ),
  );
  console.log();
  if (ctx.args.track) console.log(colorize('positions written to the history store', 'dim', colors));
  else console.log(colorize('add --track to record these positions in the history store', 'dim', colors));
}
