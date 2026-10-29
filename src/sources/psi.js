// Google PageSpeed Insights v5: Lighthouse lab scores plus Chrome UX Report field data (real
// users, 75th percentile) for the URL and for its whole origin. Key: PSI_API_KEY or
// ~/.super_seo/config.json {"googleApiKey": "..."}; the key never appears in errors.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export function psiKey() {
  if (process.env.PSI_API_KEY) return process.env.PSI_API_KEY;
  try {
    const home = process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
    return JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).googleApiKey || null;
  } catch {
    return null;
  }
}

const FIELD = {
  LARGEST_CONTENTFUL_PAINT_MS: ['lcp', 'ms', 1],
  INTERACTION_TO_NEXT_PAINT: ['inp', 'ms', 1],
  CUMULATIVE_LAYOUT_SHIFT_SCORE: ['cls', 'score', 0.01], // reported x100
  FIRST_CONTENTFUL_PAINT_MS: ['fcp', 'ms', 1],
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: ['ttfb', 'ms', 1],
};

export function parseField(exp) {
  if (!exp?.metrics) return null;
  const out = { overall: exp.overall_category || null };
  for (const [k, v] of Object.entries(exp.metrics)) {
    const f = FIELD[k];
    if (f && typeof v.percentile === 'number') out[f[0]] = { p75: Math.round(v.percentile * f[2] * 1000) / 1000, unit: f[1], rating: v.category };
  }
  return out;
}

/** Parse a raw PSI response into the pieces we report. */
export function parsePsi(j, strategy) {
  const lh = j.lighthouseResult || {};
  const cats = Object.fromEntries(Object.entries(lh.categories || {}).map(([k, v]) => [k, v.score === null ? null : Math.round(v.score * 100)]));
  const a = lh.audits || {};
  const lab = (id) => (a[id] ? { value: a[id].numericValue, display: a[id].displayValue } : null);
  const failing = Object.values(a)
    .filter((x) => x.score !== null && x.score !== undefined && x.score < 0.9 && x.details && ['opportunity', 'table', 'list'].includes(x.details.type))
    .map((x) => ({ id: x.id, title: x.title, score: x.score, savings: x.details.overallSavingsMs ?? null }))
    .sort((p, q) => (q.savings || 0) - (p.savings || 0) || p.score - q.score)
    .slice(0, 8);
  return {
    url: j.id,
    strategy,
    fetchedAt: lh.fetchTime,
    scores: cats,
    lab: { lcp: lab('largest-contentful-paint'), cls: lab('cumulative-layout-shift'), tbt: lab('total-blocking-time'), fcp: lab('first-contentful-paint'), si: lab('speed-index') },
    field: parseField(j.loadingExperience),
    originField: parseField(j.originLoadingExperience),
    topIssues: failing,
  };
}

export async function fetchPsi(url, key, { strategy = 'mobile', fetchImpl = fetch, timeout = 120000 } = {}) {
  if (!key) throw new Error('no Google API key (set PSI_API_KEY)');
  const u = new URL(API);
  u.searchParams.set('url', url);
  u.searchParams.set('strategy', strategy);
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) u.searchParams.append('category', c);
  u.searchParams.set('key', key);
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(timeout) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PageSpeed API ${res.status}: ${String(j.error?.message || 'request failed').replaceAll(key, '***').slice(0, 200)}`);
  return parsePsi(j, strategy);
}
