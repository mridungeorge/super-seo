// `sm scan <domain>`: run the whole toolkit against one site and write the results to a folder.
// Every step is its own `sm <command> --json` child process, so a hang, crash or Chrome teardown in
// one step cannot take the others down; failures are recorded and the scan carries on.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../cli.js';
import { renderTable, makeColors, colorize } from '../core/table.js';
import { buildDashboard } from '../core/dashboard.js';
import { psiKey } from '../sources/psi.js';
import { loadModel } from '../collect/estimate.js';
import { findChrome } from './doctor.js';
import os from 'node:os';
import { radarToken } from '../sources/radar.js';

const SM = path.join(ROOT, 'bin', 'sm.js');
const clean = (s) => (s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

const readJson = (dir, name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Steps in run order. `late` steps decide their arguments from earlier results (they return an
 * argument list, or a string explaining why they are skipped). `model` steps are slow and run
 * side by side after the measured ones.
 */
function buildSteps({ domain, url, brand, competitors, maxPages, engine }) {
  const s = (name, args, o = {}) => ({ name, args, timeout: 180000, ...o });
  const crawlPages = (dir) => (readJson(dir, 'crawl')?.pages || []).filter((p) => p.status === 200 && p.indexable);
  const phrases = (dir) => (readJson(dir, 'crawl')?.content?.phrases || []).map((p) => p.term);
  const cleanDomain = (x) => String(x || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  // The competitors to study: the ones named on the command line (--competitors a.com,b.com).
  const compAt = (dir, i) => String(competitors || '').split(',').map(cleanDomain).filter(Boolean)[i] || null;
  const home = process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
  const compStep = (i, kind) =>
    s('competitor-' + (i + 1) + '-' + kind, null, {
      late: (dir) => {
        const c = compAt(dir, i);
        if (!c) return 'no competitor to study';
        return kind === 'crawl' ? ['crawl', c, '--max-pages', '40', '--no-external'] : ['psi', 'https://' + c];
      },
      needs: kind === 'psi' && !psiKey() ? 'no PSI_API_KEY' : null,
      timeout: kind === 'crawl' ? 400000 : 150000,
    });
  const psiPage = (n) => (dir) => {
    const top = crawlPages(dir).filter((p) => p.depth !== 0).sort((a, b) => b.inlinks - a.inlinks)[n];
    return top ? ['psi', top.url] : 'no crawled page to test';
  };
  return [
    s('probe', ['probe', url], { needs: findChrome() ? null : 'Chrome not found (set CHROME_PATH)', timeout: 300000 }),
    s('estimate', ['estimate', domain], { needs: loadModel(home) ? null : 'no calibration (sm calibrate --csv file)' }),
    s('radar', ['radar', domain], { needs: radarToken() ? null : 'no CLOUDFLARE_API_TOKEN' }),
    s('crawl', ['crawl', url, '--max-pages', String(maxPages), ...(engine ? ['--engine', engine] : [])], { timeout: 1500000 }),
    s('psi', ['psi', url], { needs: psiKey() ? null : 'no PSI_API_KEY', timeout: 150000 }),
    s('psi-desktop', ['psi', url, '--desktop'], { needs: psiKey() ? null : 'no PSI_API_KEY', timeout: 150000 }),
    s('tech', ['tech', domain]),
    s('geo', ['geo', domain]),
    s('rank', ['rank', domain, ...(competitors ? ['--competitors', competitors] : [])], { timeout: 240000 }),
    ...[0, 1, 2].flatMap((i) => [compStep(i, 'crawl'), compStep(i, 'psi')]),
    s('psi-page-1', null, { late: psiPage(0), needs: psiKey() ? null : 'no PSI_API_KEY', timeout: 150000 }),
    s('psi-page-2', null, { late: psiPage(1), needs: psiKey() ? null : 'no PSI_API_KEY', timeout: 150000 }),
    s('psi-page-3', null, { late: psiPage(2), needs: psiKey() ? null : 'no PSI_API_KEY', timeout: 150000 }),
    s('keywords-brand', ['keywords', brand], { timeout: 240000 }),
    s('keywords-topic', null, { late: (dir) => (phrases(dir)[0] ? ['keywords', phrases(dir)[0]] : 'no topic phrase found on the site'), timeout: 240000 }),
    s('serp', null, {
      timeout: 700000,
      late: (dir) => {
        const engine = process.env.SM_SERP_ENGINE || (process.env.BRAVE_API_KEY ? 'brave' : null);
        if (!engine) return 'no BRAVE_API_KEY (or set SM_SERP_ENGINE=bing|duckduckgo to read result pages)';
        const kws = [...new Set([brand.toLowerCase(), ...phrases(dir).slice(0, 12)])].slice(0, 16);
        return kws.length ? ['serp', domain, '--keywords', kws.join(','), '--engine', engine] : 'no keywords to check';
      },
    }),
    s('intel', ['intel', domain]),
    s('wayback', ['wayback', domain]),
    s('ai', ['ai', brand, ...(competitors ? ['--competitors', competitors] : [])], { model: true, timeout: 900000 }),
    s('strategy-marketing', ['strategy', 'marketing', domain], { model: true, timeout: 400000 }),
    s('strategy-content', ['strategy', 'content', domain], { model: true, timeout: 400000 }),
    s('geo-plan', ['geo', domain, '--advise'], { model: true, timeout: 400000 }),
    s('sales-score', ['sales', 'score', domain], { model: true, timeout: 400000 }),
  ];
}

function runStep(step, outDir, passthrough) {
  return new Promise((resolve) => {
    if (step.late) {
      const a = step.late(outDir);
      if (!Array.isArray(a)) return resolve({ name: step.name, status: 'skipped', seconds: 0, file: null, note: String(a) });
      step = { ...step, args: a };
    }
    const started = Date.now();
    const child = spawn(process.execPath, [SM, ...step.args, '--json', '--no-color', ...passthrough], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, step.timeout);
    const finish = (code, spawnErr) => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      let json = true;
      try {
        JSON.parse(out);
      } catch {
        json = false;
      }
      const ok = !timedOut && !spawnErr && code === 0 && out.trim() !== '';
      let file = null;
      if (out.trim()) {
        file = `${step.name}.${json ? 'json' : 'txt'}`;
        fs.writeFileSync(path.join(outDir, file), out);
      }
      const note = timedOut ? `timed out after ${step.timeout / 1000}s` : spawnErr ? spawnErr.message : code !== 0 ? (err.trim().split('\n').find(Boolean) || '').slice(0, 160) || `exit ${code}` : '';
      resolve({ name: step.name, status: ok ? 'ok' : 'FAILED', seconds, file, note });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code, null));
  });
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

export async function run(ctx) {
  const colors = makeColors(ctx.colors);
  const target = (ctx.args._[0] || '').trim();
  const domain = clean(target);
  const named = [ctx.args.competitors, ...ctx.args._.slice(1)].filter(Boolean).join(',').split(',').map(clean).filter(Boolean);
  if (named.length) ctx.args.competitors = [...new Set(named)].join(',');
  if (!domain) {
    console.error('usage: sm scan <domain> [--out dir] [--brand "Name"] [--competitors a.com,b.com] [--max-pages 300] [--engine scrapling] [--quick] [--only a,b] [--skip a,b]');
    process.exitCode = 1;
    return;
  }
  const url = /^https?:\/\//.test(target) ? target : 'https://' + domain;
  const brand = ctx.args.brand || domain.split('.')[0].replace(/^./, (c) => c.toUpperCase());
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(ctx.args.out || `scan-${domain}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const only = ctx.args.only ? ctx.args.only.split(',') : null;
  const skip = new Set((ctx.args.skip || '').split(',').filter(Boolean));
  let steps = buildSteps({ domain, url, brand, competitors: ctx.args.competitors || '', maxPages: Number(ctx.args.maxPages) || 300, engine: ctx.args.engine || '' });
  if (ctx.args.quick) steps = steps.filter((x) => !x.model);
  if (only) steps = steps.filter((x) => only.includes(x.name));
  steps = steps.filter((x) => !skip.has(x.name));

  // Cache and refresh flags carry through; --json/--html/--csv are per-step, so they do not.
  const passthrough = ['--no-cache', '--refresh', '--verbose'].filter((f) => ctx.args[f.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]);

  console.error(`scanning ${domain} -> ${outDir}`);
  const rows = [];
  const record = (r) => {
    rows.push(r);
    console.error(`  ${r.status === 'ok' ? 'ok    ' : r.status === 'skipped' ? 'skip  ' : 'FAILED'} ${r.name} (${r.seconds}s)${r.note ? ' — ' + r.note : ''}`);
  };

  const runnable = [];
  for (const st of steps) {
    if (st.needs) record({ name: st.name, status: 'skipped', seconds: 0, file: null, note: st.needs });
    else runnable.push(st);
  }
  // Measured steps one at a time (polite to the sites, and Chrome is launched by some of them).
  for (const st of runnable.filter((x) => !x.model)) record(await runStep(st, outDir, passthrough));
  // Model steps are mostly waiting on the API, so run a few together.
  const modelResults = await pool(runnable.filter((x) => x.model), 3, (st) => runStep(st, outDir, passthrough));
  modelResults.forEach(record);

  const order = steps.map((x) => x.name);
  rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const failed = rows.filter((r) => r.status === 'FAILED').length;
  const md = [
    `# Scan of ${domain}`,
    '',
    `Run ${new Date().toISOString()}. Each file is the JSON output of the matching \`sm\` command; \`report.html\` is the merged report.`,
    '',
    '| step | status | seconds | file | note |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.name} | ${r.status} | ${r.seconds} | ${r.file || '-'} | ${r.note || ''} |`),
    '',
    'Model-written steps (ai, strategy-*, geo-plan, sales-score) quote measured evidence but can miscalculate; check any derived figure against the JSON.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ domain, outDir, steps: rows }, null, 2));

  let dashboard = null;
  try {
    dashboard = buildDashboard(outDir, domain);
  } catch (err) {
    console.error(`dashboard: ${err.message}`);
  }

  if (ctx.args.json) return console.log(JSON.stringify({ domain, outDir, dashboard, steps: rows }, null, 2));
  console.log(colorize(`SCAN — ${domain}   ${rows.length - failed - rows.filter((r) => r.status === 'skipped').length} ok, ${failed} failed, ${rows.filter((r) => r.status === 'skipped').length} skipped`, 'bold', colors));
  console.log(renderTable([['step', 'status', 'seconds', 'file'], ...rows.map((r) => [r.name, r.status, String(r.seconds), r.file || r.note || '-'])], { align: ['l', 'l', 'r', 'l'], colors }));
  console.log(`results: ${outDir}`);
  if (dashboard) console.log(`dashboard: ${dashboard}`);
  if (failed) process.exitCode = 2;
}
