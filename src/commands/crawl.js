// `sm crawl <domain|url>`: our own SEO crawler (pages, issues, links, duplicates, depth).
// `--engine scrapling` reads each page with the Scrapling parser instead of the built-in one; it
// changes how HTML is read, not how pages are fetched.

import { crawlSite } from '../collect/crawl.js';
import { startScrapling } from '../collect/scrapling.js';
import { renderTable, makeColors, colorize } from '../core/table.js';

export async function run(ctx) {
  const target = (ctx.args._[0] || '').trim();
  if (!target) {
    console.error('usage: sm crawl <domain|url> [--max-pages 300] [--concurrency 4] [--no-external] [--engine auto|scrapling|builtin]');
    process.exitCode = 1;
    return;
  }
  const wanted = ctx.args.engine || 'auto';
  if (!['auto', 'builtin', 'scrapling'].includes(wanted)) {
    console.error(`crawl: unknown engine "${wanted}" (auto|scrapling|builtin)`);
    process.exitCode = 1;
    return;
  }
  const colors = makeColors(ctx.colors);
  let engine = null;
  // auto: Scrapling when it is installed, otherwise the built-in parser, without complaint.
  if (wanted !== 'builtin') {
    try {
      engine = await startScrapling();
    } catch (err) {
      if (wanted === 'scrapling') console.error(`crawl: ${err.message}; using the built-in parser instead`);
    }
  }
  let r;
  try {
    r = await crawlSite(target, {
      maxPages: Number(ctx.args.maxPages) || 300,
      concurrency: Number(ctx.args.concurrency) || 4,
      checkExternal: !ctx.args.noExternal,
      engineName: engine ? 'scrapling' : 'builtin',
      partsEngine: engine ? engine.parts : null,
      onProgress: (done, total) => !ctx.args.json && process.stderr.write(`\rcrawled ${done}/${total}…`),
    });
  } finally {
    engine?.close();
  }
  if (!ctx.args.json) process.stderr.write('\r');
  if (ctx.args.json) return console.log(JSON.stringify(r));
  if (r.blocked) {
    console.log(colorize(`CRAWL — ${r.host}: blocked`, 'bold', colors));
    console.log(`the site refused the crawl (${r.blockedReason}), so there is nothing to report.`);
    process.exitCode = 2;
    return;
  }
  const s = r.summary;
  console.log(colorize(`CRAWL — ${r.host}   health ${s.healthScore}%   ${s.pages} pages${r.complete ? '' : ' (sample)'}   parser: ${r.options.engine}`, 'bold', colors));
  console.log(renderTable([['errors', 'warnings', 'notices', 'indexable', 'avg words', 'avg TTFB'], [String(s.errors), String(s.warnings), String(s.notices), String(s.indexable), String(s.avgWords), s.avgTtfb + ' ms']], { colors }));
  console.log(renderTable([['issue', 'severity', 'pages'], ...r.issues.slice(0, 15).map((i) => [i.title, i.severity, String(i.count)])], { align: ['l', 'l', 'r'], colors }));
  console.log(renderTable([['site check', 'result', 'detail'], ...r.siteChecks.map((c) => [c.title, c.pass ? 'pass' : 'FAIL', c.detail])], { align: ['l', 'l', 'l'], colors }));
}
