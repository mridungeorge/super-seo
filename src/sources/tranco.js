// Tranco popularity rank (https://tranco-list.eu): a research-grade ranking that combines
// several public lists (DNS-, link- and browser-derived). Free, no key, but rate-limited.
//
// A rank is a popularity signal, not a visit count. estimate.js can convert it to a rough visit
// estimate with a model you calibrate on traffic figures you know (for example your own analytics).

const API = 'https://tranco-list.eu/api/ranks/domain/';

/** @returns {{domain, rank, date, history:[{date,rank}]} | null}  null when not in the list */
export async function trancoRank(http, domain) {
  const res = await http.get(API + encodeURIComponent(domain), { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Tranco HTTP ${res.status}`);
  let body;
  try {
    body = JSON.parse(res.text());
  } catch {
    throw new Error('Tranco returned a non-JSON body');
  }
  const history = Array.isArray(body.ranks) ? body.ranks.filter((r) => typeof r.rank === 'number') : [];
  if (!history.length) return null;
  return { domain, rank: history[0].rank, date: history[0].date, history };
}

/** Median of the recent history: one noisy day should not move an estimate. */
export function medianRank(t, days = 14) {
  const v = t.history
    .slice(0, days)
    .map((r) => r.rank)
    .sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}
