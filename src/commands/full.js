// `sm full <site>`: the complete job. Runs every collector (`sm scan`), builds the interactive
// dashboard, then writes the full report (report.html and report.md) from the measurements.
// `--from <scan-folder>` skips the scan and rebuilds the report from an existing folder.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../cli.js';
import { defaultEngine } from '../core/llm.js';
import { buildDashboard } from '../core/dashboard.js';
import { loadScan, actions, evidencePack, writeSections, renderReport, SECTIONS } from '../collect/fullreport.js';

const SM = path.join(ROOT, 'bin', 'sm.js');
const clean = (s) => (s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

function runScan(site, outDir, a) {
  const args = [SM, 'scan', site, '--out', outDir];
  const str = { competitors: '--competitors', brand: '--brand', maxPages: '--max-pages', engine: '--engine', only: '--only', skip: '--skip' };
  for (const [k, flag] of Object.entries(str)) if (a[k]) args.push(flag, String(a[k]));
  for (const [k, flag] of Object.entries({ quick: '--quick', refresh: '--refresh', noCache: '--no-cache' })) if (a[k]) args.push(flag);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function run(ctx) {
  const site = (ctx.args._[0] || '').trim();
  // A space after the comma (`--competitors a.com, b.com`) leaves the rest as extra positionals; keep them.
  const named = [ctx.args.competitors, ...ctx.args._.slice(1)].filter(Boolean).join(',').split(',').map(clean).filter(Boolean);
  if (named.length) ctx.args.competitors = [...new Set(named)].join(',');
  const domain = clean(site);
  if (!domain) {
    console.error('usage: sm full <site> [--competitors a.com,b.com] [--brand "Name"] [--max-pages 300] [--quick] [--out dir] [--from scan-folder]');
    process.exitCode = 1;
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(ctx.args.from || ctx.args.out || `full-${domain}-${stamp}`);

  if (!ctx.args.from) {
    console.error(`full scan of ${domain} -> ${outDir}\n`);
    await runScan(site, outDir, ctx.args);
  } else if (!fs.existsSync(outDir)) {
    console.error(`full: scan folder not found: ${outDir}`);
    process.exitCode = 1;
    return;
  }

  // The scan writes its own dashboard; rebuild it in case --from pointed at an older folder.
  try {
    buildDashboard(outDir, domain);
  } catch (err) {
    console.error(`dashboard: ${err.message}`);
  }

  const d = loadScan(outDir);
  const ev = evidencePack(d, domain);
  const priority = actions(d);
  const engine = ctx.args.engine && ['openai', 'nvidia', 'anthropic', 'claude-cli'].includes(ctx.args.engine) ? ctx.args.engine : defaultEngine();
  let sections;
  if (ctx.args.quick) {
    sections = SECTIONS.map((s) => ({ id: s.id, title: s.title, error: 'skipped with --quick' }));
  } else {
    console.error(`\nwriting the report sections (${engine})…`);
    sections = await writeSections(ev, priority, { engine, model: ctx.args.model || null, onDone: (s) => console.error(`  ${s.error ? 'FAILED' : 'ok    '} ${s.title}${s.error ? ' — ' + s.error.slice(0, 100) : ''}`) });
  }
  const parser = d.crawl?.options?.engine || null;
  const { html, md } = renderReport(ev, d, sections, priority, { engine: ctx.args.quick ? null : engine, parser });
  fs.writeFileSync(path.join(outDir, 'report.html'), html);
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  fs.writeFileSync(path.join(outDir, 'report-evidence.json'), JSON.stringify(ev, null, 2));

  const failed = sections.filter((s) => s.error && !ctx.args.quick).length;
  if (ctx.args.json) return console.log(JSON.stringify({ domain, outDir, report: path.join(outDir, 'report.html'), dashboard: path.join(outDir, 'dashboard.html'), sectionsFailed: failed }, null, 2));
  console.log(`\nfull report:  ${path.join(outDir, 'report.html')}`);
  console.log(`dashboard:    ${path.join(outDir, 'dashboard.html')}`);
  console.log(`markdown:     ${path.join(outDir, 'report.md')}`);
  console.log(`raw data:     ${outDir}`);
  if (failed) {
    console.log(`${failed} report section(s) could not be written by the model; the tables and priority list are still complete.`);
    process.exitCode = 2;
  }
}
