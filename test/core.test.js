// Offline unit tests: table renderer, tech detection, vitals rating, keyword logic,
// AI-answer scoring and the history store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTable, makeColors, sparkline, fmtNum, fmtPct, fmtBytes } from '../src/core/table.js';
import { detectTech } from '../src/core/techdetect.js';
import { rateVitals } from '../src/sources/own.js';
import { classifyIntent, clusterKeywords } from '../src/collect/keywords.js';
import { scoreAnswer, buildPrompts } from '../src/collect/prompts.js';
import { recordSnapshot, metricHistory, snapshots } from '../src/core/store.js';

const off = makeColors(false);

test('renderTable aligns columns and draws a separator under the header', () => {
  const out = renderTable([['name', 'n'], ['alpha', '1'], ['b', '22']], { align: ['left', 'right'], colors: off });
  const lines = out.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^\|-+/);
  assert.equal(new Set(lines.filter((l) => !l.startsWith('|-')).map((l) => l.length)).size, 1);
  assert.ok(lines[3].includes('| b     | 22 |'));
});

test('formatters never print NaN or undefined', () => {
  assert.equal(fmtNum(undefined), '-');
  assert.equal(fmtNum(1234567), '1,234,567');
  assert.equal(fmtPct(0.5399), '53.99%');
  assert.equal(fmtPct(NaN), '-');
  assert.equal(fmtBytes(2048), '2.0KB');
  assert.equal(sparkline([], { colors: off }), '');
});

test('detectTech records the evidence behind every hit', () => {
  const tech = detectTech(
    { Server: 'cloudflare', 'CF-Ray': 'abc' },
    '<script src="/_next/static/x.js"></script><link href="https://fonts.googleapis.com/css">',
  );
  const names = tech.map((t) => t.name);
  assert.ok(names.includes('Cloudflare'));
  assert.ok(names.includes('Next.js'));
  assert.ok(names.includes('Google Fonts'));
  const cf = tech.find((t) => t.name === 'Cloudflare');
  assert.ok(cf.detectedBy.some((d) => d.startsWith('header:')));
});

test('detectTech returns an empty list for a bare page', () => {
  assert.deepEqual(detectTech({}, '<html></html>'), []);
});

test('rateVitals applies the Core Web Vitals thresholds to numbers or {value}', () => {
  assert.equal(rateVitals({ lcp: 2000 }).lcp, 'good');
  assert.equal(rateVitals({ lcp: { value: 3000 } }).lcp, 'needs-improvement');
  assert.equal(rateVitals({ lcp: 5000 }).lcp, 'poor');
  assert.equal(rateVitals({ cls: 0.3 }).cls, 'poor');
  assert.equal(rateVitals({}).lcp, 'unknown');
  assert.equal(rateVitals({}).inp, 'no-interaction');
});

test('classifyIntent buckets keywords', () => {
  assert.equal(classifyIntent('buy crm software'), 'transactional');
  assert.equal(classifyIntent('best crm software'), 'commercial');
  assert.equal(classifyIntent('how to use a crm'), 'informational');
});

test('clusterKeywords groups by head term and sums strength', () => {
  const clusters = clusterKeywords([
    { keyword: 'crm software', intent: 'informational', sourceCount: 2 },
    { keyword: 'crm software free', intent: 'transactional', sourceCount: 1 },
    { keyword: 'email tools', intent: 'informational', sourceCount: 1 },
  ]);
  const crm = clusters.find((c) => c.cluster === 'crm software');
  assert.equal(crm.size, 2);
  assert.equal(crm.strength, 3);
  assert.equal(clusters[0].cluster, 'crm software');
});

test('scoreAnswer finds the brand, its rank and its co-mentions', () => {
  const s = scoreAnswer('Top picks: Canva, then Adobe, and Figma is excellent.', 'Adobe', ['Canva', 'Figma']);
  assert.equal(s.mentioned, true);
  assert.equal(s.firstMentioned, 'Canva');
  assert.equal(s.rank, 1);
  assert.deepEqual(s.coMentions.sort(), ['Canva', 'Figma']);
});

test('scoreAnswer reports an absent brand as not mentioned', () => {
  const s = scoreAnswer('Nothing relevant here.', 'Adobe', ['Canva']);
  assert.equal(s.mentioned, false);
  assert.equal(s.position, null);
  assert.equal(s.firstMentioned, null);
});

test('buildPrompts adds category and per-competitor prompts to the base set', () => {
  const p = buildPrompts('Adobe', { competitors: ['Canva'], category: 'design software', count: 4 });
  assert.equal(p.length, 4 + 1 + 1);
  assert.equal(new Set(p.map((x) => x.prompt)).size, p.length);
  assert.ok(p.some((x) => x.prompt.includes('Adobe vs Canva')));
  assert.ok(p.some((x) => x.prompt.includes('design software')));
  assert.deepEqual(p.map((x) => x.id), [1, 2, 3, 4, 5, 6]);
});

test('the history store records snapshots and metric trends', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-test-'));
  const db = path.join(dir, 'h.db');
  try {
    recordSnapshot(db, 'x.com', { health: { value: 70, unit: 'score' }, errors: 3, note: 'ok' });
    recordSnapshot(db, 'x.com', { health: { value: 82, unit: 'score' }, errors: 1 });
    const hist = metricHistory(db, 'x.com', 'health', { months: 1 });
    assert.deepEqual(hist.map((r) => r.value_num), [70, 82]);
    assert.equal(hist[0].unit, 'score');
    assert.equal(metricHistory(db, 'x.com', 'note', { months: 1 })[0].value_text, 'ok');
    assert.equal(snapshots(db, 'x.com').length, 2);
    assert.equal(metricHistory(db, 'nope.com', 'health').length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
