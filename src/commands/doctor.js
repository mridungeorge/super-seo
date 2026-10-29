// `sm doctor`: environment, optional-component and reachability checks.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Http } from '../core/http.js';
import { renderTable, makeColors, fmtBytes } from '../core/table.js';
import { openDb } from '../core/store.js';
import { findPython } from '../collect/scrapling.js';

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function run(ctx) {
  const colors = makeColors(ctx.colors);
  const rows = [['check', 'result', 'detail']];
  const add = (check, ok, detail) => rows.push([check, ok ? 'ok' : 'FAIL', detail ?? '']);

  add('node', Number(process.versions.node.split('.')[0]) >= 24, `${process.version} (24 or newer needed)`);
  try {
    openDb(ctx.dbPath).prepare('SELECT 1 AS x').get();
    add('node:sqlite', true, ctx.dbPath);
  } catch (err) {
    add('node:sqlite', false, err.message);
  }
  add('WebSocket global', typeof WebSocket === 'function', typeof WebSocket);
  const chrome = findChrome();
  add('chrome (optional, for sm probe)', !!chrome, chrome || 'not found (set CHROME_PATH)');
  const py = findPython();
  add('scrapling (optional parser)', true, py ? 'installed' : 'not installed; the built-in parser is used');
  try {
    fs.mkdirSync(ctx.cacheDir, { recursive: true });
    const probe = path.join(ctx.cacheDir, '.probe');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    add('cache dir', true, ctx.cacheDir);
  } catch (err) {
    add('cache dir', false, err.message);
  }

  // The public services the tool reads. Any HTTP answer below 500 means the host is reachable.
  const http = new Http({ cacheDir: ctx.cacheDir, noCache: true, verbose: ctx.verbose, minDelay: 300 });
  for (const [name, url] of [
    ['tranco list', 'https://tranco-list.eu/api/ranks/domain/example.com'],
    ['internet archive', 'https://web.archive.org/cdx/search/cdx?url=example.com&limit=1'],
    ['rdap', 'https://rdap.org/domain/example.com'],
    ['pagespeed api', 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'],
    ['cloudflare api', 'https://api.cloudflare.com/client/v4/radar/ranking/top'],
  ]) {
    try {
      const res = await http.get(url);
      add('reach ' + name, res.status < 500, `HTTP ${res.status} ${fmtBytes(res.bytes)}`);
    } catch (err) {
      // a 4xx answer (for example 429 without a key) still proves the host is reachable
      const code = /HTTP (\d{3})/.exec(err.message);
      add('reach ' + name, !!code && Number(code[1]) < 500, code ? `HTTP ${code[1]}` : err.message);
    }
  }

  // Optional keys: nothing fails without them, a feature just switches off.
  for (const [k, what] of [
    ['PSI_API_KEY', 'sm psi, speed scores'],
    ['CLOUDFLARE_API_TOKEN', 'sm radar, rank cross-check'],
    ['LLM_API_KEY', 'written reports and plans (any OpenAI-compatible service)'],
    ['NVIDIA_API_KEY', 'written reports and plans (NVIDIA NIM)'],
    ['ANTHROPIC_API_KEY', 'written reports and plans (Anthropic)'],
  ]) add('env ' + k, true, process.env[k] ? 'set' : `not set (${what})`);

  console.log(renderTable(rows, { align: ['left', 'left', 'left'], colors, title: 'super_seo doctor' }));
  console.log();
  console.log('cache:  ' + ctx.cacheDir);
  console.log('db:     ' + ctx.dbPath);
  console.log('home:   ' + (process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo')));
}
