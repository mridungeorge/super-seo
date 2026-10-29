// `sm geo <domain>` (deterministic AI-readiness audit, add --advise for a model plan) and
// `sm strategy <kind> <domain>` / `sm sales <prep|outreach|score> <domain>` (model-driven,
// grounded in measured evidence).

import os from 'node:os';
import path from 'node:path';
import { Http } from '../core/http.js';
import { renderTable, makeColors, colorize } from '../core/table.js';
import { defaultEngine } from '../core/llm.js';
import { geoCheck } from '../collect/geo.js';
import { KINDS, buildEvidence, advise } from '../collect/strategy.js';

const home = () => process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
const clean = (s) => (s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

export async function run(ctx) {
  const colors = makeColors(ctx.colors);
  const http = new Http({ cacheDir: ctx.cacheDir, noCache: ctx.noCache, refresh: ctx.refresh, verbose: ctx.verbose, minDelay: 1500 });
  ctx.http = http;
  let kind;
  let domain;
  if (ctx.command === 'geo') {
    kind = 'geo';
    domain = clean(ctx.args._[0]);
  } else if (ctx.command === 'sales') {
    kind = ctx.args._[0];
    domain = clean(ctx.args._[1]);
    if (!['prep', 'outreach', 'score'].includes(kind)) kind = null;
  } else {
    kind = ctx.args._[0];
    domain = clean(ctx.args._[1]);
  }
  if (!domain || (ctx.command !== 'geo' && !KINDS[kind])) {
    const list = ctx.command === 'sales' ? 'prep|outreach|score' : Object.keys(KINDS).filter((k) => !['prep', 'outreach', 'score'].includes(k)).join('|');
    console.error(ctx.command === 'geo' ? 'usage: sm geo <domain> [--advise]' : `usage: sm ${ctx.command} <${list}> <domain>`);
    process.exitCode = 1;
    return;
  }
  const engine = ctx.args.engine || defaultEngine();
  const model = ctx.args.model || null;

  if (ctx.command === 'geo') {
    let geo;
    try {
      geo = await geoCheck(http, domain);
    } catch (err) {
      console.error(`geo: ${err.message} (the site refused our request, so there is nothing to audit)`);
      process.exitCode = 2;
      return;
    }
    let plan = null;
    if (ctx.args.advise) {
      const ev = await buildEvidence(http, domain, { home: home() });
      plan = await advise('geo', ev, { engine, model }).catch((e) => ({ error: e.message }));
    }
    if (ctx.args.json) return console.log(JSON.stringify({ geo, plan }, null, 2));
    console.log(colorize(`AI-ANSWER READINESS — ${domain}   score ${geo.score}/100`, 'bold', colors));
    console.log(renderTable([['check', 'result', 'detail'], ...geo.checks.map((c) => [c.name, c.pass ? 'pass' : 'FAIL', c.detail])], { align: ['l', 'l', 'l'], colors }));
    console.log(renderTable([['AI crawler', 'robots.txt'], ...geo.crawlers.map((c) => [c.agent, c.status])], { align: ['l', 'l'], colors }));
    if (plan) console.log('\n' + (plan.error ? `plan unavailable: ${plan.error}` : `PLAN (${engine})\n${plan.text}`));
    return;
  }

  const evidence = await buildEvidence(http, domain, { home: home() });
  let out;
  try {
    out = await advise(kind, evidence, { engine, model });
  } catch (err) {
    const noKey = /not set/i.test(err.message);
    console.error(`${kind}: ${err.message}${noKey ? '\n(set NVIDIA_API_KEY or ANTHROPIC_API_KEY, or run with --engine claude-cli)' : ''}`);
    process.exitCode = 2;
    return;
  }
  if (ctx.args.json) return console.log(JSON.stringify({ ...out, evidence }, null, 2));
  console.log(colorize(`${kind.toUpperCase()} — ${domain}   (model-written from measured evidence; engine ${engine})`, 'bold', colors));
  console.log(out.text);
  if (ctx.args.evidence) console.log('\nEVIDENCE\n' + JSON.stringify(evidence, null, 2));
}
