// Our own keyword research: seed expansion, intent classification, clustering and a
// volume *proxy*.
//
// No public keyword index exists, so volume is not invented: we report how many
// suggestion sources returned the term and at what depth, and label it a proxy.

import { Http } from '../core/http.js';

const PREFIXES = [
  'best', 'top', 'cheap', 'free', 'alternative to', 'vs', 'how to', 'what is', 'why use',
  'examples of', 'tools for', 'software for', 'services for',
];

const INTENT_RULES = [
  ['transactional', /\b(buy|price|pricing|discount|coupon|order|for sale|deal|free trial|sign up|login|download)\b/i],
  ['commercial', /\b(best|top|review|reviews|comparison|compare|vs|alternative|alternatives|leading)\b/i],
  ['informational', /\b(how|what|why|guide|tutorial|learn|example|examples|definition|meaning|check)\b/i],
  ['navigational', /\b(login|sign in|support|contact|official|download)\b/i],
];

export function classifyIntent(keyword) {
  for (const [intent, re] of INTENT_RULES) if (re.test(keyword)) return intent;
  return 'informational';
}

/** Pull the completion list out of a Google/DuckDuckGo style response. */
function parseSuggestions(body) {
  if (!body) return [];
  // Google: ["q",["a","b"],["c"]]
  const m = body.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      const out = [];
      const walk = (v) => {
        if (Array.isArray(v)) {
          if (typeof v[0] === 'string' && v.length > 1 && typeof v[1] === 'string') out.push(v[1]);
          else for (const x of v) walk(x);
        }
      };
      walk(parsed);
      if (out.length) return out;
    } catch {
      /* fall through */
    }
  }
  // DuckDuckGo: ["q",["a","b"]]
  const d = body.match(/\[\s*"[^"]*"\s*,\s*\[([^\]]*)\]/);
  if (d) {
    return d[1]
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [];
}

/** Expand a seed into a keyword set using public autocomplete sources. */
export async function expandKeywords(seed, { http = null, alphabet = false, prefixes = true } = {}) {
  const client = http || new Http({});
  const terms = new Map(); // term -> {sources:Set, depth:number}
  const notes = [];

  const add = (term, source, depth) => {
    const t = String(term).trim().toLowerCase();
    if (!t || t === seed.toLowerCase()) return;
    if (!terms.has(t)) terms.set(t, { term: t, sources: new Set(), depth: 99 });
    const e = terms.get(t);
    e.sources.add(source);
    e.depth = Math.min(e.depth, depth);
  };

  const fetchSuggestions = async (url, source, depthBase = 0) => {
    try {
      const res = await client.get(url, { headers: { Accept: 'application/json, text/plain, */*' } });
      if (res.status !== 200) {
        notes.push(`${source} -> HTTP ${res.status}`);
        return [];
      }
      const list = parseSuggestions(res.text());
      list.forEach((t, i) => add(t, source, depthBase + i));
      return list;
    } catch (err) {
      notes.push(`${source}: ${err.message}`);
      return [];
    }
  };

  await fetchSuggestions(
    `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}&hl=en`,
    'google',
  );
  await fetchSuggestions(`https://duckduckgo.com/ac/?q=${encodeURIComponent(seed)}&type=list`, 'duckduckgo');

  if (alphabet) {
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      await fetchSuggestions(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed + ' ' + c)}&hl=en`,
        'google+' + c,
      );
    }
  }

  if (prefixes) {
    for (const p of PREFIXES) {
      const q = `${p} ${seed}`;
      await fetchSuggestions(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}&hl=en`,
        'google:' + p,
      );
    }
  }

  const list = [...terms.values()]
    .map((e) => ({
      keyword: e.term,
      sources: [...e.sources],
      sourceCount: e.sources.size,
      suggestionDepth: e.depth,
      intent: classifyIntent(e.term),
    }))
    .sort((a, b) => b.sourceCount - a.sourceCount || a.suggestionDepth - b.suggestionDepth);

  return { seed, count: list.length, keywords: list, notes };
}

/** Group keywords into clusters by their head term. */
export function clusterKeywords(keywords) {
  const map = new Map();
  for (const k of keywords) {
    const words = k.keyword.split(/\s+/);
    const head = words.length > 1 ? words.slice(0, 2).join(' ') : words[0];
    if (!map.has(head)) map.set(head, { cluster: head, terms: [], intents: new Set(), sourceTotal: 0 });
    const c = map.get(head);
    c.terms.push(k);
    c.intents.add(k.intent);
    c.sourceTotal += k.sourceCount;
  }
  return [...map.values()]
    .map((c) => ({
      cluster: c.cluster,
      size: c.terms.length,
      intents: [...c.intents],
      strength: c.sourceTotal,
      terms: c.terms.map((t) => t.keyword),
    }))
    .sort((a, b) => b.strength - a.strength);
}
