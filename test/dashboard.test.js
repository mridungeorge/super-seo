// The dashboard and the CLI, built from the committed demo scan folder (no network).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDashboard, loadScan, actions } from '../src/core/dashboard.js';
import { competitorData } from '../src/core/competitors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'examples', 'demo');
const SM = path.join(ROOT, 'bin', 'sm.js');

function builtDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-demo-'));
  for (const f of fs.readdirSync(DEMO).filter((x) => x.endsWith('.json'))) fs.copyFileSync(path.join(DEMO, f), path.join(dir, f));
  return { dir, file: buildDashboard(dir, 'demo-outdoor.example') };
}

test('the demo dashboard builds every tab with real numbers and no errors', () => {
  const { dir, file } = builtDemo();
  try {
    const html = fs.readFileSync(file, 'utf8').replace(/<script>[\s\S]*<\/script>/, '');
    for (const id of ['overview', 'popularity', 'competitors', 'keywords', 'audit', 'issues', 'pages', 'links', 'content', 'performance', 'ai', 'tech', 'plans', 'log']) assert.ok(html.includes(`id="p-${id}"`), `tab ${id}`);
    assert.ok(!html.includes('Could not build'), 'a tab failed to build');
    assert.doesNotMatch(html, /NaN|undefined|\[object/);
    assert.ok(html.includes('demo-outdoor.example'));
    assert.ok(html.includes('Demo data'), 'the demo banner is shown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('demo crawl: issues are found, attributed and counted consistently', () => {
  const d = loadScan(DEMO);
  const c = d.crawl;
  assert.equal(c.blocked, false);
  assert.ok(c.summary.pages >= 60);
  assert.ok(c.summary.indexable > 0, 'canonical-consistent pages are indexable');
  const byId = Object.fromEntries(c.issues.map((i) => [i.id, i]));
  assert.ok(byId['broken-internal-link'].count > 0, 'the site-wide link to a missing page is found');
  assert.ok(byId['redirected-link'].count > 0);
  assert.ok(byId['title-duplicate'], 'duplicate titles');
  assert.ok(byId['noindex-in-sitemap'], 'a noindex page listed in the sitemap');
  assert.ok(byId['orphan-page'], 'orphans are reported when the whole site was crawled');
  assert.equal(c.complete, true);
  const total = c.issues.reduce((n, i) => n + i.count, 0);
  assert.equal(total, c.summary.errors + c.summary.warnings + c.summary.notices);
});

test('a competitor that refuses the crawl is shown as blocked, not as zeros', () => {
  const d = loadScan(DEMO);
  assert.equal(d['competitor-2-crawl'].blocked, true);
  const c = competitorData(d, 'demo-outdoor.example');
  const blocked = c.rows.find((r) => r.domain === 'peak-supply.example');
  assert.equal(blocked.site.available, false);
  assert.equal(blocked.site.why, 'blocked our crawler');
  assert.ok(c.gap.length > 0 && c.gap.every((g) => g.yourPosition === null));
});

test('priority actions put errors first and carry counts', () => {
  const a = actions(loadScan(DEMO));
  assert.ok(a.length > 0);
  assert.equal(a[0].severity, 'error');
  assert.match(a[0].title, /\d/);
});

test('the CLI prints help and a version, and rejects unknown commands', () => {
  const help = spawnSync(process.execPath, [SM, 'help'], { encoding: 'utf8' });
  assert.match(help.stdout, /sm full <site>|sm full <domain>/);
  assert.doesNotMatch(help.stdout, /semrush|similarweb/i);
  const v = spawnSync(process.execPath, [SM, 'version'], { encoding: 'utf8' });
  assert.match(v.stdout, /^super_seo \d+\.\d+\.\d+/);
  const bad = spawnSync(process.execPath, [SM, 'nonsense'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});
