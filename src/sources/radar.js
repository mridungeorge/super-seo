// Cloudflare Radar: domain popularity rank/bucket and categories, plus a daily rank series.
// Token: CLOUDFLARE_API_TOKEN or ~/.super_seo/config.json {"cloudflareApiToken": "..."}.
//
// Radar gives an exact rank only for the most popular domains; below that it returns a bucket
// (the rank is "within the top N"), which we keep as an upper bound rather than inventing a rank.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.cloudflare.com/client/v4/radar/ranking';

export function radarToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const home = process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
    return JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).cloudflareApiToken || null;
  } catch {
    return null;
  }
}

async function get(pathAndQuery, token, fetchImpl) {
  const res = await fetchImpl(API + pathAndQuery, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(`Cloudflare Radar ${res.status}: ${String(j.errors?.[0]?.message || 'request failed').slice(0, 160)}`);
  return j.result;
}

/** @returns {{domain, rank:number|null, bucket:number|null, categories:string[], date}} */
export async function radarRank(domain, token, { fetchImpl = fetch } = {}) {
  if (!token) throw new Error('no Cloudflare token (set CLOUDFLARE_API_TOKEN)');
  const r = await get(`/domain/${encodeURIComponent(domain)}`, token, fetchImpl);
  const d = r.details_0 || {};
  return {
    domain,
    rank: typeof d.rank === 'number' ? d.rank : null,
    bucket: d.bucket ? Number(d.bucket) : null,
    categories: (d.categories || []).map((c) => c.name),
    date: r.meta?.dateRange?.[0]?.endTime?.slice(0, 10) || null,
  };
}

/** Daily rank series for the last `range` (e.g. 28d); entries are null when outside the ranked set. */
export async function radarSeries(domain, token, { range = '28d', fetchImpl = fetch } = {}) {
  const r = await get(`/timeseries_groups?domains=${encodeURIComponent(domain)}&dateRange=${range}&format=json`, token, fetchImpl);
  const s = r.serie_0 || {};
  const ranks = s[domain] || Object.values(s).find(Array.isArray) || [];
  return (s.timestamps || []).map((date, i) => ({ date, rank: ranks[i] === null || ranks[i] === undefined ? null : Number(ranks[i]) }));
}
