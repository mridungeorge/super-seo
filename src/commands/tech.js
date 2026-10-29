// `sm tech <domain>`: the technology stack of a domain, from its response headers and HTML.
// Each detection says how it was identified, so you can judge it.

import { Http } from '../core/http.js';
import { renderTable, makeColors, colorize } from '../core/table.js';
import { detectTech, TECH_CATEGORIES } from '../core/techdetect.js';

function normaliseDomain(arg) {
  if (!arg) return null;
  const d = String(arg).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return d || null;
}

export async function run(ctx) {
  const domain = normaliseDomain(ctx.args._[0] || ctx.args.domain);
  if (!domain) {
    console.error('sm tech: usage: sm tech <domain>');
    process.exitCode = 1;
    return;
  }

  const http = new Http({ cacheDir: ctx.cacheDir, noCache: ctx.noCache, refresh: ctx.refresh, verbose: ctx.verbose });
  const colors = makeColors(ctx.colors);
  const out = { domain, detectedAt: new Date().toISOString(), technology: [], sources: [] };

  const res = await http.get(`https://${domain}/`);
  out.sources.push({ url: `https://${domain}/`, status: res.status, bytes: res.bytes, via: 'own' });
  if (res.status === 200) out.technology = detectTech(res.headers || {}, res.text());
  else out.error = `origin returned ${res.status}`;

  if (ctx.args.json) return console.log(JSON.stringify(out, null, 2));

  if (!out.technology.length) {
    console.log(colorize(`no technology detected for ${domain}`, 'yellow', colors));
    if (out.error) console.log(out.error);
    return;
  }

  const byCat = new Map();
  for (const t of out.technology) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  const ordered = [...byCat.keys()].sort((a, b) => {
    const ia = TECH_CATEGORIES.indexOf(a);
    const ib = TECH_CATEGORIES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  console.log(colorize(`TECHNOLOGY STACK — ${domain}`, 'bold', colors));
  console.log();
  for (const cat of ordered) {
    console.log(colorize(cat, 'cyan', colors));
    console.log(renderTable([['technology', 'version', 'detected by'], ...byCat.get(cat).map((t) => [t.name, t.version || '-', t.detectedBy.join(', ')])], { align: ['l', 'l', 'l'], colors }));
    console.log();
  }
  console.log(colorize(`sources: ${out.sources.map((s) => `${s.via} ${s.status}`).join(' · ')}`, 'dim', colors));
}
