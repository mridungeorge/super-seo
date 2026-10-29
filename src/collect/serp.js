// Rank tracking: run a search and find where a domain sits in the top results.
//
// Engines:
//   brave       - the Brave Search API (BRAVE_API_KEY). The recommended engine: an official API.
//   bing        - scrapes bing.com result pages. Automated queries may break that site's terms; use
//   duckduckgo    only where you are comfortable doing so, and pass --engine explicitly.
//
// Google is not attempted. A captured position is only as good as the engine and the date; both
// are recorded with the result.

import { Http } from '../core/http.js';

const htmlEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Bing wraps every result in a /ck/a?…&u=a1<base64url> redirect. Recover the real URL. */
function decodeBingUrl(href) {
  const raw = htmlEntities(href);
  if (!raw.includes('bing.com/ck/a')) return raw;
  const u = new URL(raw, 'https://www.bing.com');
  const enc = u.searchParams.get('u');
  if (!enc) return raw;
  const b64 = enc.startsWith('a1') ? enc.slice(2) : enc;
  try {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return raw;
  }
}

/** DuckDuckGo wraps results in //duckduckgo.com/l/?uddg=<url-encoded target>. */
function decodeDdgUrl(href) {
  const raw = htmlEntities(href);
  if (!raw.includes('duckduckgo.com/l/')) return raw;
  const u = new URL(raw.startsWith('//') ? 'https:' + raw : raw, 'https://duckduckgo.com');
  const target = u.searchParams.get('uddg');
  return target ? decodeURIComponent(target) : raw;
}

const ENGINES = {
  brave: {
    label: 'brave',
    api: true,
    search: async (client, q) => {
      const key = process.env.BRAVE_API_KEY;
      if (!key) throw new Error('BRAVE_API_KEY is not set');
      const res = await client.get('https://api.search.brave.com/res/v1/web/search?count=20&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
      if (res.status !== 200) throw new Error('Brave Search API HTTP ' + res.status);
      return (JSON.parse(res.text()).web?.results || []).map((r) => ({ url: r.url, title: r.title || '' }));
    },
  },
  duckduckgo: {
    label: 'duckduckgo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    extract: (html) => {
      const out = [];
      for (const m of html.matchAll(/<div class="result results_links[^"]*"[\s\S]*?<\/div>\s*<\/div>/g)) {
        const blk = m[0];
        if (/result--ad/.test(blk)) continue; // sponsored
        const a = blk.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        const title = a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        out.push({ url: decodeDdgUrl(a[1]), title });
      }
      if (out.length) return out;
      // Fallback: any result__a anchor on the page.
      for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        out.push({ url: decodeDdgUrl(m[1]), title: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() });
      }
      return out;
    },
  },
  bing: {
    label: 'bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=30&setlang=en`,
    extract: (html) => {
      const out = [];
      for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)) {
        const blk = m[0];
        const a = blk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        const title = a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        out.push({ url: decodeBingUrl(a[1]), title });
      }
      return out;
    },
  },
};

export const SERP_ENGINES = Object.keys(ENGINES);

/**
 * Capture positions for a domain across a set of keywords.
 * @returns [{keyword, engine, position, results:[{domain,title,url}], capturedAt, error}]
 */
export async function captureSerp(domain, keywords, { engine = 'bing', http = null, verbose = false } = {}) {
  const spec = ENGINES[engine];
  if (!spec) throw new Error(`unknown engine ${engine} (have: ${SERP_ENGINES.join(', ')})`);
  const target = domain.toLowerCase().replace(/^www\./, '');
  const client = http || new Http({ verbose });
  const out = [];
  try {
    for (const keyword of keywords) {
      const capturedAt = new Date().toISOString();
      try {
        const results = spec.search ? await spec.search(client, keyword) : spec.extract((await client.get(spec.url(keyword))).text());
        const position = results.findIndex(
          (r) => hostOf(r.url) === target || hostOf(r.url)?.endsWith('.' + target),
        );
        out.push({
          keyword,
          engine,
          position: position >= 0 ? position + 1 : null,
          found: position >= 0,
          results: results.slice(0, 10).map((r) => ({ domain: hostOf(r.url), title: r.title, url: r.url })),
          capturedAt,
          error: null,
        });
      } catch (err) {
        out.push({ keyword, engine, position: null, found: false, results: [], capturedAt, error: err.message });
      }
    }
  } finally {
    if (!http) await client.close();
  }
  return out;
}
