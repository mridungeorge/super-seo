// The traffic estimator's math and Tranco parsing, offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ols, fitCalibration, estimateVisits } from '../src/collect/estimate.js';
import { trancoRank, medianRank } from '../src/sources/tranco.js';

test('ols recovers an exact power law', () => {
  // visits = 1e9 * rank^-1  =>  log10 v = 9 - log10 rank
  const pts = [1, 10, 100, 1000].map((r) => ({ x: Math.log10(r), y: 9 - Math.log10(r) }));
  const m = ols(pts);
  assert.ok(Math.abs(m.a - 9) < 1e-9 && Math.abs(m.b + 1) < 1e-9);
  assert.ok(m.r2 > 0.999999);
});

test('ols refuses to fit on fewer than three points', () => {
  assert.throws(() => ols([{ x: 1, y: 1 }, { x: 2, y: 2 }]), /at least 3/);
});

test('estimateVisits returns a band that widens with residual spread and flags extrapolation', () => {
  const model = fitCalibration([
    { domain: 'a', rank: 10, visits: 1e8 },
    { domain: 'b', rank: 100, visits: 1.5e7 },
    { domain: 'c', rank: 1000, visits: 8e5 },
    { domain: 'd', rank: 10000, visits: 2e5 },
  ]);
  const e = estimateVisits(model, 500);
  assert.ok(e.low < e.visits && e.visits < e.high);
  assert.equal(e.extrapolated, false);
  assert.equal(estimateVisits(model, 5e6).extrapolated, true);
  // monotonic: a worse rank never estimates more traffic
  assert.ok(estimateVisits(model, 5000).visits < estimateVisits(model, 50).visits);
});

test('fitCalibration ignores unusable pairs', () => {
  const m = fitCalibration([
    { rank: 10, visits: 1e8 }, { rank: 100, visits: 1e7 }, { rank: 1000, visits: 1e6 },
    { rank: 0, visits: 5 }, { rank: 50, visits: 0 },
  ]);
  assert.equal(m.n, 3);
});

test('trancoRank parses history, reports unlisted domains as null and surfaces HTTP errors', async () => {
  const mk = (status, body) => ({ get: async () => ({ status, text: () => body }) });
  const t = await trancoRank(mk(200, JSON.stringify({ ranks: [{ date: 'd1', rank: 9 }, { date: 'd2', rank: 7 }, { date: 'd3', rank: 8 }] })), 'x.com');
  assert.equal(t.rank, 9);
  assert.equal(medianRank(t), 8);
  assert.equal(await trancoRank(mk(404, ''), 'x.com'), null);
  assert.equal(await trancoRank(mk(200, '{"ranks":[]}'), 'x.com'), null);
  await assert.rejects(trancoRank(mk(429, ''), 'x.com'), /429/);
});
