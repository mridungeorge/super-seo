// HTTP layer: one fetch wrapper that identifies itself honestly, waits politely between requests
// to the same host, caches responses on disk, and retries with backoff. No dependencies.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0';
  }
})();
// Replace the URL with your fork's address so site owners can see who is crawling and why.
// SM_USER_AGENT overrides the whole string.
export const UA = process.env.SM_USER_AGENT || `super_seo/${VERSION} (SEO crawler; +https://github.com/mridungeorge/super-seo)`;

/** Plain request headers for fetching pages. The tool does not pretend to be a browser. */
export function requestHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en',
    'Accept-Encoding': 'gzip, deflate, br',
    ...extra,
  };
}

export function jsonHeaders(extra = {}) {
  return { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...extra };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheKey(url, headers) {
  // Only the headers that change the payload take part in the key.
  const relevant = {
    accept: headers.Accept || headers.accept || '',
    lang: headers['Accept-Language'] || headers['accept-language'] || '',
  };
  return createHash('sha1').update(url + '|' + JSON.stringify(relevant)).digest('hex');
}

export class Http {
  constructor({ cacheDir, noCache = false, refresh = false, verbose = false, minDelay = 1200 } = {}) {
    this.cacheDir = cacheDir || null;
    this.noCache = noCache;
    this.refresh = refresh;
    this.verbose = verbose;
    this.minDelay = minDelay;
    this.lastHit = new Map();
    this.log = [];
  }

  async close() {}

  _cachePaths(key) {
    return {
      body: path.join(this.cacheDir, key + '.body'),
      meta: path.join(this.cacheDir, key + '.json'),
    };
  }

  _readCache(key) {
    if (!this.cacheDir || this.noCache) return null;
    const p = this._cachePaths(key);
    try {
      if (!fs.existsSync(p.body) || !fs.existsSync(p.meta)) return null;
      const meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
      const body = fs.readFileSync(p.body);
      return { ...meta, body, cacheHit: true };
    } catch {
      return null;
    }
  }

  _writeCache(key, meta, body) {
    if (!this.cacheDir) return;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const p = this._cachePaths(key);
      fs.writeFileSync(p.body, body);
      fs.writeFileSync(p.meta, JSON.stringify(meta, null, 1));
    } catch (err) {
      if (this.verbose) console.error('cache write failed: ' + err.message);
    }
  }

  async _politeness(url) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    const last = this.lastHit.get(host) || 0;
    const wait = this.minDelay - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    this.lastHit.set(host, Date.now());
  }

  /**
   * GET a URL. Returns { status, bytes, body (Buffer), text(), json(), cacheHit, fetchedAt }.
   * Never throws on HTTP error status; only on network failure.
   */
  async get(url, { headers = requestHeaders(), retries = 3, timeout = 30000, accept = 'text' } = {}) {
    const key = cacheKey(url, headers);
    if (!this.refresh) {
      const hit = this._readCache(key);
      if (hit) {
        this.log.push({ url, status: hit.status, bytes: hit.bytes, cacheHit: true, fetchedAt: hit.fetchedAt });
        return decorate(hit, accept);
      }
    }

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this._politeness(url);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      try {
        const res = await fetch(url, { headers, redirect: 'follow', signal: ac.signal });
        const buf = Buffer.from(await res.arrayBuffer());
        clearTimeout(timer);
        const meta = {
          url,
          status: res.status,
          bytes: buf.length,
          fetchedAt: new Date().toISOString(),
          contentType: res.headers.get('content-type') || '',
          headers: Object.fromEntries(res.headers.entries()),
        };
        // Only keep real answers: a cached 202 challenge or 403 block would be replayed forever.
        if (res.status >= 200 && res.status < 300 && res.status !== 202) this._writeCache(key, meta, buf);
        this.log.push({ ...meta, cacheHit: false });
        if (this.verbose) {
          console.error(`[http] ${res.status} ${buf.length}B ${url}`);
        }
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} for ${url}`);
          await sleep(Math.min(15000, 1500 * 2 ** attempt));
          continue;
        }
        return decorate({ ...meta, body: buf }, accept);
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        await sleep(Math.min(10000, 800 * 2 ** attempt));
      }
    }
    throw lastErr || new Error('fetch failed: ' + url);
  }

  /** Store a response obtained some other way (e.g. through the browser) under the same key. */
  put(url, headers, meta, buf) {
    if (!(meta.status >= 200 && meta.status < 300)) return;
    this._writeCache(cacheKey(url, headers || requestHeaders()), meta, buf);
  }

  async getJson(url, opts = {}) {
    const r = await this.get(url, { ...opts, headers: opts.headers || jsonHeaders() });
    if (r.status === 202) {
      return { ...r, challenge: true, json: () => null };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(r.text());
    } catch {
      parsed = null;
    }
    return { ...r, json: () => parsed };
  }
}

function decorate(res, accept) {
  return {
    ...res,
    text: () => res.body.toString('utf8'),
    json: () => JSON.parse(res.body.toString('utf8')),
  };
}
