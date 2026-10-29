import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPsi, parsePsi } from '../src/sources/psi.js';
import { radarRank, radarSeries } from '../src/sources/radar.js';

const psiBody = {
  id: 'https://x.test/',
  lighthouseResult: {
    fetchTime: '2026-10-26T00:00:00Z',
    categories: { performance: { score: 0.87 }, seo: { score: 1 } },
    audits: { 'largest-contentful-paint': { numericValue: 1234, displayValue: '1.2 s' } },
  },
  loadingExperience: { overall_category: 'FAST', metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8, category: 'FAST' }, LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: 'FAST' } } },
};

test('psi: scores are percentages, CLS field value is rescaled from x100', () => {
  const r = parsePsi(psiBody, 'mobile');
  assert.equal(r.scores.performance, 87);
  assert.equal(r.field.cls.p75, 0.08);
  assert.equal(r.field.lcp.p75, 2100);
  assert.equal(r.originField, null);
});

test('psi: error message never contains the key', async () => {
  const bad = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key AIzaSECRET is not allowed' } }) });
  await assert.rejects(() => fetchPsi('https://x.test', 'AIzaSECRET', { fetchImpl: bad }), (e) => /403/.test(e.message) && !e.message.includes('AIzaSECRET'));
});

test('radar: unranked domain keeps its bucket, rank stays null', async () => {
  const f = async () => ({ ok: true, json: async () => ({ success: true, result: { details_0: { rank: null, bucket: '20000', categories: [] }, meta: { dateRange: [{ endTime: '2026-10-26T00:00:00Z' }] } } }) });
  const r = await radarRank('a.test', 't', { fetchImpl: f });
  assert.deepEqual([r.rank, r.bucket, r.date], [null, 20000, '2026-10-26']);
});

test('radar series maps timestamps to ranks', async () => {
  const f = async () => ({ ok: true, json: async () => ({ success: true, result: { serie_0: { timestamps: ['d1', 'd2'], 'a.test': [5, null] } } }) });
  assert.deepEqual(await radarSeries('a.test', 't', { fetchImpl: f }), [{ date: 'd1', rank: 5 }, { date: 'd2', rank: null }]);
});
