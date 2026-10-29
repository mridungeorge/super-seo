// Our own SEO crawler. Follows links from the homepage and samples the sitemap, records what a
// search engine would see on every page, then derives the site-wide findings an SEO tool reports:
// issues by category, duplicates, broken and redirected links, orphan pages, internal link strength,
// page depth, indexability and a few technical checks.
//
// Pure functions (parsePage, robotsRules, sitemapLocs, buildIssues) are separate from the network
// loop so they can be tested on fixtures. A site that refuses the crawl is reported as blocked.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { requestHeaders } from '../core/http.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = (s) =>
  String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const NON_HTML = /\.(jpe?g|png|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|mp3|mov|css|js|mjs|json|xml|txt|woff2?|ttf|eot|docx?|xlsx?|pptx?)(\?|#|$)/i;
const STOPWORDS = new Set(
  'a about after all also an and any are as at be been but by can could do does for from had has have he her his how i if in into is it its just like more most my no not of on one or our out over she so some than that the their them then there these they this to up us was we were what when which who will with you your add cart shop view all new now free see get via per off sale buy click here read learn menu search login sign account home contact help'.split(' '),
);

const attrsOf = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
};

const textOf = (html) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** Normalise a URL for de-duplication: no fragment, lower-case host, no default port. */
export function normUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** A development server on this machine: HTTPS, HSTS and www checks do not apply to it. */
export const isLocalHost = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i.test(String(h || ''));

const bareHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

function ldTypes(blocks) {
  const types = [];
  let invalid = 0;
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n['@type']) types.push(...[].concat(n['@type']).map(String));
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  for (const b of blocks) {
    try {
      walk(JSON.parse(b));
    } catch {
      invalid++;
    }
  }
  return { types: [...new Set(types)], invalid };
}

/**
 * Raw parts of an HTML document, read with regular expressions (the built-in engine). Another engine
 * (see scrapling.js) can supply the same shape from a real DOM; assemble() does the rest.
 */
export function regexParts(html) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html])[0];
  const body = html.replace(/<head[\s\S]*?<\/head>/i, ' ');
  const headings = { h1: [], h2: [], h3: [] };
  for (const lvl of ['h1', 'h2', 'h3']) for (const m of body.matchAll(new RegExp(`<${lvl}\\b[^>]*>([\\s\\S]*?)</${lvl}>`, 'gi'))) headings[lvl].push(textOf(m[1]).slice(0, 200));
  return {
    title: decodeEntities(((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim()),
    metas: [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0])),
    links: [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0])),
    headings,
    anchors: [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => {
      const a = attrsOf('<a ' + m[1] + '>');
      return { href: a.href || '', rel: a.rel || '', text: textOf(m[2]) || (m[2].match(/<img[^>]+alt=["']([^"']*)["']/i) || [])[1] || '' };
    }),
    imgs: [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => attrsOf(m[0])),
    ld: [...body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi), ...head.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]),
    text: textOf(body),
    lang: (html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i) || [])[1] || '',
    insecure: (html.match(/\b(?:src|href)=["']http:\/\/(?!schema\.org)[^"']+/gi) || []).filter((x) => /src=|\.css|\.js/i.test(x)).length,
    metaRefresh: /<meta[^>]+http-equiv=["']refresh["']/i.test(head),
  };
}

/** Everything a search engine reads from one HTML document. host is the site host for link typing. */
export function parsePage(html, url, host, parts = regexParts(html)) {
  const page = new URL(url);
  const { metas, links: headLinks } = parts;
  const meta = (name) => metas.find((m) => (m.name || '').toLowerCase() === name)?.content?.trim() || '';
  const prop = (p) => metas.find((m) => (m.property || '').toLowerCase() === p)?.content?.trim() || '';
  const rel = (r) => headLinks.filter((l) => (l.rel || '').toLowerCase().split(/\s+/).includes(r));
  const canonical = rel('canonical')[0]?.href ? normUrl(rel('canonical')[0].href, url) : null;
  const hreflang = rel('alternate').filter((l) => l.hreflang).map((l) => ({ lang: l.hreflang, href: normUrl(l.href, url) }));
  const headings = { h1: parts.headings.h1.filter(Boolean), h2: parts.headings.h2, h3: parts.headings.h3 };

  const internal = new Map();
  const external = new Map();
  for (const a of parts.anchors) {
    if (!a.href || /^(mailto|tel|javascript|sms):/i.test(a.href.trim()) || a.href.startsWith('#')) continue;
    const target = normUrl(a.href, url);
    if (!target) continue;
    const bucket = bareHost(new URL(target).host) === bareHost(host) ? internal : external;
    if (!bucket.has(target)) bucket.set(target, { url: target, anchor: a.text.slice(0, 120), nofollow: /\bnofollow\b/i.test(a.rel || '') });
  }

  const imgs = parts.imgs;
  const schema = ldTypes(parts.ld);
  const text = parts.text;
  const words = text ? text.split(' ').length : 0;
  const tokens = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
  const uni = new Map();
  const bi = new Map();
  let prev = null;
  for (const t of tokens) {
    const ok = !STOPWORDS.has(t);
    if (ok) uni.set(t, (uni.get(t) || 0) + 1);
    if (ok && prev) bi.set(prev + ' ' + t, (bi.get(prev + ' ' + t) || 0) + 1);
    prev = ok ? t : null;
  }
  const top = (m, n, min) => [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([term, count]) => ({ term, count }));

  const robotsMeta = (meta('robots') + ',' + meta('googlebot')).toLowerCase();
  return {
    title: parts.title,
    description: meta('description'),
    canonical,
    robotsMeta,
    noindex: /noindex/.test(robotsMeta),
    nofollowPage: /nofollow/.test(robotsMeta),
    viewport: !!meta('viewport'),
    lang: parts.lang,
    headings,
    words,
    textHash: words >= 30 ? sha1(text.toLowerCase().slice(0, 30000)) : null,
    terms: { words: top(uni, 8, 3), phrases: top(bi, 6, 2) },
    internal: [...internal.values()],
    external: [...external.values()],
    images: { count: imgs.length, noAlt: imgs.filter((i) => !('alt' in i)).length, noDimensions: imgs.filter((i) => !i.width || !i.height).length },
    hreflang,
    og: { title: !!prop('og:title'), description: !!prop('og:description'), image: !!prop('og:image') },
    twitterCard: !!meta('twitter:card'),
    schemaTypes: schema.types,
    schemaInvalid: schema.invalid,
    mixedContent: page.protocol === 'https:' ? parts.insecure : 0,
    metaRefresh: parts.metaRefresh,
  };
}

/** Rules for `User-agent: *` plus any sitemap lines. */
export function robotsRules(txt) {
  const rules = [];
  const sitemaps = [];
  let applies = false;
  let inGroupHead = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'sitemap') sitemaps.push(m[2].trim());
    else if (k === 'user-agent') {
      if (!inGroupHead) applies = false;
      inGroupHead = true;
      if (m[2].trim() === '*') applies = true;
    } else {
      inGroupHead = false;
      if (applies && (k === 'disallow' || k === 'allow') && m[2].trim()) rules.push({ allow: k === 'allow', path: m[2].trim() });
    }
  }
  const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  const compiled = rules.map((r) => ({ ...r, re: toRe(r.path) }));
  const allowed = (pathname) => {
    let best = null;
    for (const r of compiled) if (r.re.test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    return !best || best.allow;
  };
  return { rules: rules.filter((r) => !r.allow).map((r) => r.path), sitemaps, allowed };
}

/** <loc> values from a sitemap or sitemap index, with XML entities decoded. */
export function sitemapLocs(xml) {
  return { index: /<sitemapindex/i.test(xml), locs: [...String(xml).matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1])) };
}

// ---------- issue catalogue ----------

const ISSUES = {
  'http-error': ['error', 'indexability', 'Page returns an error status', 'Visitors and Google get an error instead of content.', 'Fix the page, restore it, or redirect it to the closest live page.'],
  'fetch-failed': ['error', 'indexability', 'Page could not be fetched', 'The request timed out or the connection failed.', 'Check the server logs; repeated failures can hurt crawling.'],
  'not-https': ['error', 'security', 'Page is not served over HTTPS', 'Browsers warn on HTTP and Google prefers HTTPS.', 'Serve everything over HTTPS and 301 the HTTP URLs.'],
  'redirect-chain': ['error', 'indexability', 'Redirect chain (2+ hops)', 'Each hop slows the page and dilutes link signals.', 'Point links and redirects straight at the final URL.'],
  'title-missing': ['error', 'content', 'Missing <title>', 'The title is the main ranking and click signal.', 'Add a unique title of 30–60 characters.'],
  'h1-missing': ['error', 'content', 'Missing <h1>', 'No main heading tells search engines what the page is about.', 'Add one descriptive H1.'],
  'canonical-broken': ['error', 'indexability', 'Canonical points to a non-200 page', 'Google may ignore the canonical or drop the page.', 'Point the canonical at a live, indexable URL.'],
  'noindex-in-sitemap': ['error', 'indexability', 'Page is in the sitemap but set to noindex', 'Conflicting signals waste crawl budget.', 'Remove it from the sitemap or remove the noindex.'],
  'broken-internal-link': ['error', 'links', 'Page links to a broken internal URL', 'Visitors hit a dead end and link equity is wasted.', 'Update or remove the link.'],
  'mixed-content': ['error', 'security', 'Page loads HTTP resources on an HTTPS page', 'Browsers block or warn about the insecure resources.', 'Load every script, style and image over HTTPS.'],
  'schema-invalid': ['error', 'structured-data', 'Invalid JSON-LD structured data', 'Broken markup makes the page ineligible for rich results.', 'Validate the JSON-LD and fix the syntax.'],
  'no-viewport': ['error', 'mobile', 'No mobile viewport meta tag', 'The page will not render properly on phones.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'],
  'title-long': ['warning', 'content', 'Title longer than 60 characters', 'Long titles get cut off in results.', 'Shorten to about 50–60 characters.'],
  'title-short': ['warning', 'content', 'Title shorter than 30 characters', 'Short titles under-use the main ranking signal.', 'Expand with the page topic and brand.'],
  'title-duplicate': ['warning', 'content', 'Duplicate title', 'Several pages compete with an identical title.', 'Give each page a unique title.'],
  'meta-missing': ['warning', 'content', 'Missing meta description', 'Google writes its own snippet, often a worse one.', 'Add a 70–160 character description.'],
  'meta-long': ['warning', 'content', 'Meta description longer than 160 characters', 'It will be truncated in results.', 'Trim to 160 characters or fewer.'],
  'meta-short': ['notice', 'content', 'Meta description shorter than 70 characters', 'A short snippet misses a chance to sell the click.', 'Expand to 70–160 characters.'],
  'meta-duplicate': ['warning', 'content', 'Duplicate meta description', 'Identical snippets across pages.', 'Write a unique description per page.'],
  'h1-multiple': ['warning', 'content', 'More than one <h1>', 'Mixed signals about the main topic.', 'Keep one H1 per page and use H2/H3 below it.'],
  'h1-duplicate': ['notice', 'content', 'Same H1 on several pages', 'Pages are not clearly differentiated.', 'Make each H1 specific to its page.'],
  'content-duplicate': ['warning', 'content', 'Near-identical page text', 'Duplicate content splits ranking signals.', 'Merge, canonicalise or rewrite the pages.'],
  'thin-content': ['warning', 'content', 'Fewer than 200 words', 'Thin pages rarely rank for competitive terms.', 'Add useful, unique content or consolidate the page.'],
  'canonical-missing': ['warning', 'indexability', 'No canonical tag', 'Duplicate URL variants can be indexed separately.', 'Add a self-referencing canonical.'],
  'canonical-other': ['notice', 'indexability', 'Canonical points to a different URL', 'This page will not be indexed itself, by design or by mistake.', 'Confirm the canonical is intentional.'],
  'images-no-alt': ['warning', 'content', 'Images without alt attribute', 'Alt text feeds image search and accessibility.', 'Add descriptive alt text (alt="" for pure decoration).'],
  'redirect': ['warning', 'indexability', 'URL redirects', 'Internal links should point at the final URL.', 'Update internal links to the destination.'],
  'redirected-link': ['warning', 'links', 'Page links to a redirected URL', 'Each click takes an extra hop.', 'Link straight to the final URL.'],
  'slow-response': ['warning', 'performance', 'Slow server response (over 800 ms)', 'A slow first byte delays everything else.', 'Cache the page, tune the backend or use a CDN.'],
  'large-html': ['warning', 'performance', 'HTML document over 500 KB', 'Heavy HTML slows parsing on phones.', 'Trim inline scripts and data from the document.'],
  'orphan-page': ['warning', 'links', 'Page has no internal links pointing to it', 'Crawlers and visitors cannot find it by clicking.', 'Link to it from relevant pages.'],
  'deep-page': ['notice', 'links', 'Page is more than 4 clicks from the homepage', 'Deep pages get crawled and ranked less.', 'Link to it from higher-level pages.'],
  'low-inlinks': ['notice', 'links', 'Only one internal link points to this page', 'Little internal authority flows to it.', 'Add contextual internal links.'],
  'broken-external-link': ['warning', 'links', 'Page links to a broken external URL', 'Dead outbound links look neglected.', 'Update or remove the link.'],
  'lang-missing': ['notice', 'international', 'No lang attribute on <html>', 'Helps browsers and search engines pick the right language.', 'Add lang="en-AU" or similar.'],
  'hreflang-no-self': ['notice', 'international', 'hreflang set but no self-reference', 'hreflang sets should list the page itself.', 'Add the page to its own hreflang set.'],
  'images-no-dimensions': ['notice', 'performance', 'Images without width/height', 'Causes layout shift while loading.', 'Set width and height attributes.'],
  'og-missing': ['notice', 'social', 'Missing Open Graph tags', 'Shared links will look plain on Facebook, LinkedIn and Slack.', 'Add og:title, og:description and og:image.'],
  'twitter-missing': ['notice', 'social', 'Missing Twitter card', 'Shared links on X will look plain.', 'Add twitter:card.'],
  'schema-missing': ['notice', 'structured-data', 'No structured data', 'No eligibility for rich results.', 'Add JSON-LD (Product, Article, FAQ, Organization…).'],
  'url-long': ['notice', 'content', 'URL longer than 115 characters', 'Long URLs are harder to share and may be truncated.', 'Shorten the URL.'],
  'url-style': ['notice', 'content', 'URL has uppercase letters or underscores', 'Mixed-case URLs create duplicates.', 'Use lower-case with hyphens.'],
  'url-params': ['notice', 'content', 'URL has query parameters', 'Parameter URLs often duplicate other pages.', 'Canonicalise or block parameter variants.'],
  'blocked-robots': ['notice', 'indexability', 'Blocked by robots.txt', 'Not crawlable; Google can still index the bare URL.', 'Confirm the block is intended.'],
  'meta-refresh': ['warning', 'indexability', 'Uses a meta refresh redirect', 'Slow and not treated as a proper redirect.', 'Use a 301 redirect.'],
};
export const ISSUE_META = Object.fromEntries(Object.entries(ISSUES).map(([id, [severity, category, title, why, fix]]) => [id, { id, severity, category, title, why, fix }]));

const ORDER = { error: 0, warning: 1, notice: 2 };

/** Turn crawled pages (with parse results) into a per-page issue list and a catalogue. */
export function buildIssues(pages, ctx) {
  const by = new Map();
  const add = (page, id, detail) => {
    page.issues.push(id);
    if (!by.has(id)) by.set(id, { ...ISSUE_META[id], count: 0, urls: [], details: {} });
    const e = by.get(id);
    e.count++;
    if (e.urls.length < 200) e.urls.push(page.url);
    if (detail && Object.keys(e.details).length < 200) e.details[page.url] = detail;
  };
  const group = (key) => {
    const m = new Map();
    for (const p of pages) if (p.indexable && p[key]) (m.get(p[key]) || m.set(p[key], []).get(p[key])).push(p.url);
    return m;
  };
  const dupTitle = group('title');
  const dupDesc = group('description');
  const dupH1 = group('h1');
  const dupText = group('textHash');
  const byUrl = new Map(pages.map((p) => [p.url, p]));

  for (const p of pages) {
    p.issues = [];
    const u = new URL(p.url);
    if (p.fetchError) {
      add(p, 'fetch-failed', p.fetchError);
      continue;
    }
    if (p.status >= 400) add(p, 'http-error', `HTTP ${p.status}`);
    if (p.redirects.length >= 2) add(p, 'redirect-chain', `${p.redirects.length} hops → ${p.finalUrl}`);
    else if (p.redirects.length === 1) add(p, 'redirect', `→ ${p.finalUrl}`);
    if (u.protocol === 'http:' && !p.redirects.length && !isLocalHost(u.hostname)) add(p, 'not-https');
    if (p.blockedByRobots) add(p, 'blocked-robots');
    if (u.search) add(p, 'url-params', u.search.slice(0, 60));
    if (p.url.length > 115) add(p, 'url-long', `${p.url.length} chars`);
    if (/[A-Z_]/.test(u.pathname)) add(p, 'url-style');
    if (p.status !== 200 || !p.html) {
      continue;
    }
    if (p.ttfb > 800) add(p, 'slow-response', `${p.ttfb} ms`);
    if (p.bytes > 500 * 1024) add(p, 'large-html', `${Math.round(p.bytes / 1024)} KB`);
    if (!p.title) add(p, 'title-missing');
    else if (p.title.length > 60) add(p, 'title-long', `${p.title.length} chars`);
    else if (p.title.length < 30) add(p, 'title-short', `${p.title.length} chars`);
    if (!p.description) add(p, 'meta-missing');
    else if (p.description.length > 160) add(p, 'meta-long', `${p.description.length} chars`);
    else if (p.description.length < 70) add(p, 'meta-short', `${p.description.length} chars`);
    if (!p.h1) add(p, 'h1-missing');
    if (p.h1Count > 1) add(p, 'h1-multiple', `${p.h1Count} H1s`);
    if (p.indexable && p.title && dupTitle.get(p.title)?.length > 1) add(p, 'title-duplicate', `${dupTitle.get(p.title).length} pages`);
    if (p.indexable && p.description && dupDesc.get(p.description)?.length > 1) add(p, 'meta-duplicate', `${dupDesc.get(p.description).length} pages`);
    if (p.indexable && p.h1 && dupH1.get(p.h1)?.length > 1) add(p, 'h1-duplicate', `${dupH1.get(p.h1).length} pages`);
    if (p.indexable && p.textHash && dupText.get(p.textHash)?.length > 1) add(p, 'content-duplicate', `${dupText.get(p.textHash).length} pages`);
    if (p.words < 200) add(p, 'thin-content', `${p.words} words`);
    if (!p.canonical) add(p, 'canonical-missing');
    else if (p.canonical !== p.finalUrl && p.canonical !== p.url) {
      const target = byUrl.get(p.canonical);
      if (target && target.status !== 200 && !target.fetchError) add(p, 'canonical-broken', `${p.canonical} → HTTP ${target.status}`);
      else add(p, 'canonical-other', p.canonical);
    }
    if (p.noindex && p.inSitemap) add(p, 'noindex-in-sitemap');
    if (p.images.noAlt) add(p, 'images-no-alt', `${p.images.noAlt} of ${p.images.count}`);
    if (p.images.noDimensions > 3) add(p, 'images-no-dimensions', `${p.images.noDimensions} of ${p.images.count}`);
    if (!p.viewport) add(p, 'no-viewport');
    if (!p.lang) add(p, 'lang-missing');
    if (p.hreflang.length && !p.hreflang.some((h) => h.href === p.finalUrl || h.href === p.url)) add(p, 'hreflang-no-self');
    if (!(p.og.title && p.og.description)) add(p, 'og-missing');
    if (!p.twitterCard) add(p, 'twitter-missing');
    if (!p.schemaTypes.length && !p.schemaInvalid) add(p, 'schema-missing');
    if (p.schemaInvalid) add(p, 'schema-invalid', `${p.schemaInvalid} block(s)`);
    if (p.mixedContent) add(p, 'mixed-content', `${p.mixedContent} resource(s)`);
    if (p.metaRefresh) add(p, 'meta-refresh');
    if (p.brokenLinks?.length) add(p, 'broken-internal-link', p.brokenLinks.slice(0, 3).join(', '));
    if (p.redirectedLinks?.length) add(p, 'redirected-link', p.redirectedLinks.length > 1 ? `${p.redirectedLinks[0]} (+${p.redirectedLinks.length - 1} more)` : p.redirectedLinks[0]);
    if (p.brokenExternal?.length) add(p, 'broken-external-link', p.brokenExternal.slice(0, 3).join(', '));
    if (ctx.complete && p.inlinks === 0 && p.depth !== 0 && p.indexable) add(p, 'orphan-page');
    else if (p.inlinks === 1 && p.depth !== 0 && p.indexable) add(p, 'low-inlinks');
    if (p.depth > 4) add(p, 'deep-page', `${p.depth} clicks`);
  }
  return [...by.values()].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.count - a.count);
}

// ---------- the crawl ----------

async function fetchOnce(url, { timeout = 20000, fetchImpl = fetch, method = 'GET' } = {}) {
  const t0 = performance.now();
  const res = await fetchImpl(url, { method, redirect: 'manual', headers: requestHeaders(), signal: AbortSignal.timeout(timeout) });
  return { res, ttfb: Math.round(performance.now() - t0) };
}

async function fetchPage(url, opts) {
  const redirects = [];
  let cur = url;
  let ttfb = 0;
  for (let hop = 0; hop < 6; hop++) {
    const r = await fetchOnce(cur, opts);
    if (hop === 0) ttfb = r.ttfb;
    const loc = r.res.headers.get('location');
    if (r.res.status >= 300 && r.res.status < 400 && loc) {
      redirects.push({ url: cur, status: r.res.status });
      await r.res.arrayBuffer().catch(() => {});
      cur = normUrl(loc, cur) || cur;
      continue;
    }
    const type = r.res.headers.get('content-type') || '';
    let html = null;
    let bytes = 0;
    if (/html|xml/i.test(type) || type === '') {
      const buf = Buffer.from(await r.res.arrayBuffer());
      bytes = buf.length;
      html = buf.subarray(0, 3_000_000).toString('utf8');
    } else await r.res.arrayBuffer().catch(() => {});
    return { status: r.res.status, finalUrl: cur, redirects, ttfb, bytes, type, html, headers: Object.fromEntries(r.res.headers) };
  }
  return { status: 310, finalUrl: cur, redirects, ttfb, bytes: 0, type: '', html: null, headers: {}, loop: true };
}

async function readSitemaps(starts, fetchImpl, notes, maxFiles = 25) {
  const queue = [...starts];
  const files = [];
  const urls = [];
  const seen = new Set();
  while (queue.length && files.length < maxFiles) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    try {
      const { res } = await fetchOnce(sm, { fetchImpl });
      if (res.status !== 200) {
        files.push({ url: sm, status: res.status, urls: 0 });
        notes.push(`sitemap ${sm} → HTTP ${res.status}`);
        continue;
      }
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      const { index, locs } = sitemapLocs(buf.toString('utf8'));
      files.push({ url: sm, status: 200, urls: index ? 0 : locs.length, index });
      if (index) queue.push(...locs);
      else urls.push(...locs);
    } catch (err) {
      files.push({ url: sm, status: 0, urls: 0 });
      notes.push(`sitemap ${sm}: ${err.message}`);
    }
  }
  return { files, urls };
}

/** Crawl a site. Returns the full dataset; never throws for a refused site, it reports `blocked`. */
export async function crawlSite(start, { maxPages = 300, concurrency = 4, delay = 150, checkExternal = true, fetchImpl = fetch, onProgress = () => {}, partsEngine = null, engineName = 'builtin' } = {}) {
  const notes = [];
  const startUrl = normUrl(/^https?:\/\//.test(start) ? start : 'https://' + start);
  const home = await fetchPage(startUrl, { fetchImpl }).catch((err) => ({ fetchError: err.message }));
  const base = { startUrl, crawledAt: new Date().toISOString(), options: { maxPages, concurrency, checkExternal, engine: engineName } };
  if (home.fetchError || !home.html || home.status !== 200) {
    const why = home.fetchError || `the homepage returned HTTP ${home.status}`;
    return { ...base, blocked: true, blockedReason: why, host: new URL(startUrl).host, pages: [], issues: [], summary: null, notes: [`crawl not possible: ${why}`] };
  }
  const origin = new URL(home.finalUrl).origin;
  const host = new URL(origin).host;
  base.origin = origin;
  base.host = host;

  const robotsRes = await fetchOnce(origin + '/robots.txt', { fetchImpl }).then(async ({ res }) => ({ status: res.status, text: res.status === 200 ? await res.text() : '' })).catch(() => ({ status: 0, text: '' }));
  const robots = robotsRules(robotsRes.text);
  const sm = await readSitemaps(robots.sitemaps.length ? robots.sitemaps : [origin + '/sitemap.xml'], fetchImpl, notes);
  const sitemapSet = new Set(sm.urls.map((u) => normUrl(u)).filter(Boolean));

  const pages = new Map();
  const queue = [];
  const queued = new Set();
  const enqueue = (url, depth, from) => {
    if (!url || queued.has(url) || NON_HTML.test(new URL(url).pathname + new URL(url).search)) return;
    if (bareHost(new URL(url).host) !== bareHost(host)) return;
    queued.add(url);
    queue.push({ url, depth, from });
  };
  enqueue(home.finalUrl, 0, null);
  if (home.finalUrl !== startUrl) queued.add(startUrl);

  // Sitemap URLs fill whatever the link crawl does not: sampled evenly so a big sitemap is covered.
  const sitemapPool = [...sitemapSet].filter((u) => bareHost(new URL(u).host) === bareHost(host));
  const reserve = Math.floor(maxPages * 0.4);
  const stride = Math.max(1, Math.floor(sitemapPool.length / Math.max(1, reserve)));
  const sitemapPick = sitemapPool.filter((_, i) => i % stride === 0).slice(0, reserve);

  let claimed = 0;
  let linkClaimed = 0;
  const edges = [];
  const results = [];

  const next = () => {
    while (claimed < maxPages) {
      const preferLinks = linkClaimed < maxPages - reserve || !sitemapPick.length;
      if (preferLinks && queue.length) {
        linkClaimed++;
        return queue.shift();
      }
      if (sitemapPick.length) {
        const u = sitemapPick.shift();
        if (queued.has(u)) continue;
        queued.add(u);
        return { url: u, depth: null, from: 'sitemap' };
      }
      if (queue.length) {
        linkClaimed++;
        return queue.shift();
      }
      return null;
    }
    return null;
  };

  let active = 0;
  const worker = async () => {
    for (;;) {
      const item = claimed < maxPages ? next() : null;
      if (!item) {
        if (active === 0 && !queue.length && !sitemapPick.length) return;
        if (claimed >= maxPages) return;
        if (active === 0) return;
        await sleep(30);
        continue;
      }
      claimed++;
      active++;
      try {
        const path = new URL(item.url).pathname + new URL(item.url).search;
        const row = { url: item.url, depthFromQueue: item.depth, inSitemap: sitemapSet.has(item.url), blockedByRobots: !robots.allowed(path) };
        if (row.blockedByRobots) {
          Object.assign(row, { status: 0, redirects: [], finalUrl: item.url, html: false, indexable: false });
        } else {
          try {
            const r = item.url === home.finalUrl ? home : await fetchPage(item.url, { fetchImpl });
            Object.assign(row, { status: r.status, redirects: r.redirects, finalUrl: r.finalUrl, ttfb: r.ttfb, bytes: r.bytes, contentType: r.type, xRobots: r.headers['x-robots-tag'] || '', html: !!r.html && /html/i.test(r.type || 'html') });
            row.headers = { hsts: !!r.headers['strict-transport-security'], server: r.headers.server || '', encoding: r.headers['content-encoding'] || '' };
            if (r.html && row.html && r.status === 200) {
              const p = parsePage(r.html, r.finalUrl, host, (partsEngine && (await partsEngine(r.html, r.finalUrl))) || undefined);
              Object.assign(row, { title: p.title, description: p.description, canonical: p.canonical, noindex: p.noindex || /noindex/i.test(row.xRobots), nofollowPage: p.nofollowPage, viewport: p.viewport, lang: p.lang, h1: p.headings.h1[0] || '', h1Count: p.headings.h1.length, h2: p.headings.h2.slice(0, 12), words: p.words, textHash: p.textHash, terms: p.terms, images: p.images, hreflang: p.hreflang, og: p.og, twitterCard: p.twitterCard, schemaTypes: p.schemaTypes, schemaInvalid: p.schemaInvalid, mixedContent: p.mixedContent, metaRefresh: p.metaRefresh, outInternal: p.internal.length, outExternal: p.external.length, _internal: p.internal, _external: p.external });
              for (const l of p.internal) {
                edges.push([item.url, l.url, l.anchor, l.nofollow]);
                enqueue(l.url, (item.depth ?? 0) + 1, item.url);
              }
            }
          } catch (err) {
            Object.assign(row, { status: 0, redirects: [], finalUrl: item.url, fetchError: err.name === 'TimeoutError' ? 'timed out' : err.message });
          }
        }
        row.indexable = row.status === 200 && !row.noindex && (!row.canonical || row.canonical === row.finalUrl || row.canonical === row.url) && !row.blockedByRobots;
        results.push(row);
        if (results.length % 25 === 0) onProgress(results.length, Math.min(maxPages, claimed + queue.length));
      } finally {
        active--;
      }
      await sleep(delay);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  // ----- graph analysis over the crawled set -----
  const byUrl = new Map();
  for (const r of results) {
    byUrl.set(r.url, r);
    if (r.finalUrl) byUrl.set(r.finalUrl, byUrl.get(r.finalUrl) || r);
  }
  for (const r of results) Object.assign(r, { inlinks: 0, inlinkAnchors: new Map(), brokenLinks: [], redirectedLinks: [] });
  const inSources = new Map();
  for (const [from, to, anchor] of edges) {
    const t = byUrl.get(to);
    const f = byUrl.get(from);
    if (!t || !f || t === f) continue;
    const key = from + '>' + t.url;
    if (inSources.has(key)) continue;
    inSources.set(key, 1);
    t.inlinks++;
    if (anchor) t.inlinkAnchors.set(anchor, (t.inlinkAnchors.get(anchor) || 0) + 1);
    if (t.status >= 400) f.brokenLinks.push(to);
    else if (t.redirects?.length) f.redirectedLinks.push(to);
  }
  // Depth: shortest click path from the homepage within the crawled graph.
  const adj = new Map();
  for (const [from, to] of edges) {
    const f = byUrl.get(from);
    const t = byUrl.get(to);
    if (f && t && f !== t) (adj.get(f.url) || adj.set(f.url, new Set()).get(f.url)).add(t.url);
  }
  const homeRow = byUrl.get(home.finalUrl);
  for (const r of results) r.depth = null;
  if (homeRow) {
    homeRow.depth = 0;
    const q = [homeRow.url];
    while (q.length) {
      const u = q.shift();
      for (const v of adj.get(u) || []) {
        const vr = byUrl.get(v);
        if (vr.depth === null) {
          vr.depth = byUrl.get(u).depth + 1;
          q.push(vr.url);
        }
      }
    }
  }
  // Internal PageRank (damping 0.85, 25 rounds) as a relative measure of link strength.
  const nodes = results.filter((r) => r.status === 200 && r.html);
  const idx = new Map(nodes.map((r, i) => [r.url, i]));
  let rank = new Array(nodes.length).fill(1 / Math.max(1, nodes.length));
  const outs = nodes.map((r) => [...(adj.get(r.url) || [])].map((u) => idx.get(byUrl.get(u)?.url)).filter((i) => i !== undefined));
  for (let it = 0; it < 25; it++) {
    const nr = new Array(nodes.length).fill((1 - 0.85) / Math.max(1, nodes.length));
    outs.forEach((o, i) => {
      if (o.length) o.forEach((j) => (nr[j] += (0.85 * rank[i]) / o.length));
      else nodes.forEach((_, j) => (nr[j] += (0.85 * rank[i]) / nodes.length));
    });
    rank = nr;
  }
  const maxRank = Math.max(...rank, 1e-12);
  nodes.forEach((r, i) => (r.linkScore = Math.round((rank[i] / maxRank) * 100)));

  // External links: count, then HEAD-check the most linked.
  const extCount = new Map();
  const extSources = new Map();
  for (const r of results) for (const l of r._external || []) {
    extCount.set(l.url, (extCount.get(l.url) || 0) + 1);
    (extSources.get(l.url) || extSources.set(l.url, []).get(l.url)).push(r.url);
  }
  const extStatus = new Map();
  if (checkExternal) {
    const list = [...extCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([u]) => u);
    let k = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (k < list.length) {
          const u = list[k++];
          try {
            let { res } = await fetchOnce(u, { fetchImpl, method: 'HEAD', timeout: 12000 });
            if (res.status === 405 || res.status === 403 || res.status === 501) ({ res } = await fetchOnce(u, { fetchImpl, timeout: 12000 }));
            extStatus.set(u, res.status);
            await res.arrayBuffer().catch(() => {});
          } catch {
            extStatus.set(u, 0);
          }
        }
      }),
    );
  }
  for (const r of results) r.brokenExternal = (r._external || []).filter((l) => extStatus.has(l.url) && (extStatus.get(l.url) >= 400 && ![401, 403, 429, 999].includes(extStatus.get(l.url)) || extStatus.get(l.url) === 0)).map((l) => l.url);

  const complete = !queue.length && !sitemapPick.length && claimed < maxPages;
  const issues = buildIssues(results, { complete });

  // ----- site-wide checks -----
  const siteChecks = [];
  const check = (id, title, pass, detail) => siteChecks.push({ id, title, pass, detail });
  const local = isLocalHost(new URL(origin).hostname);
  check('https', 'Site served over HTTPS', local || new URL(home.finalUrl).protocol === 'https:', local ? 'local host' : home.finalUrl);
  check('robots', 'robots.txt present', robotsRes.status === 200, robotsRes.status === 200 ? `${robots.rules.length} disallow rule(s)` : `HTTP ${robotsRes.status}`);
  check('sitemap', 'XML sitemap found', sm.urls.length > 0, sm.urls.length ? `${sm.urls.length.toLocaleString()} URLs in ${sm.files.filter((f) => f.status === 200).length} file(s)` : 'none readable');
  check('sitemap-robots', 'Sitemap declared in robots.txt', robots.sitemaps.length > 0, robots.sitemaps[0] || 'not declared');
  check('hsts', 'HSTS header sent', local || !!homeRow?.headers?.hsts, local ? 'local host' : homeRow?.headers?.hsts ? 'present' : 'missing');
  check('compression', 'Responses compressed', /br|gzip|zstd/.test(homeRow?.headers?.encoding || ''), homeRow?.headers?.encoding || 'none');
  const probe = await fetchOnce(origin + '/sm-' + crypto.randomBytes(5).toString('hex'), { fetchImpl }).then(({ res }) => res.status).catch(() => 0);
  check('soft404', 'Unknown URLs return a real 404', probe === 404 || probe === 410, `HTTP ${probe}`);
  if (!local) {
    const alt = new URL(origin);
    alt.hostname = alt.hostname.startsWith('www.') ? alt.hostname.slice(4) : 'www.' + alt.hostname;
    const altRes = await fetchOnce(alt.origin + '/', { fetchImpl }).catch(() => null);
    const altOk = altRes ? [301, 302, 307, 308].includes(altRes.res.status) || altRes.res.status === 0 : true;
    check('www', `${alt.host} redirects to ${host}`, altOk, altRes ? `HTTP ${altRes.res.status}` : 'does not resolve');
    const httpRes = await fetchOnce('http://' + host + '/', { fetchImpl }).catch(() => null);
    check('http-redirect', 'HTTP redirects to HTTPS', httpRes ? [301, 308].includes(httpRes.res.status) && /^https:/.test(httpRes.res.headers.get('location') || '') : true, httpRes ? `HTTP ${httpRes.res.status}` : 'not reachable');
  }
  const smNotCrawlable = sm.urls.length ? results.filter((r) => r.inSitemap && (r.status >= 400 || r.status === 0 && !r.blockedByRobots)).length : 0;
  check('sitemap-clean', 'Sitemap URLs all return 200', smNotCrawlable === 0, smNotCrawlable ? `${smNotCrawlable} sampled sitemap URL(s) fail` : 'sampled URLs are fine');

  // ----- aggregates -----
  const ok = results.filter((r) => r.status === 200 && r.html);
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  const dupGroups = (key) => {
    const m = new Map();
    for (const r of ok) if (r.indexable && r[key]) (m.get(r[key]) || m.set(r[key], []).get(r[key])).push(r.url);
    return [...m.entries()].filter(([, u]) => u.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 40).map(([value, urls]) => ({ value: key === 'textHash' ? `identical text (${urls.length} pages)` : value, urls: urls.slice(0, 20), count: urls.length }));
  };
  const termTotals = new Map();
  const phraseTotals = new Map();
  for (const r of ok) {
    for (const t of r.terms?.words || []) termTotals.set(t.term, (termTotals.get(t.term) || 0) + t.count);
    for (const t of r.terms?.phrases || []) phraseTotals.set(t.term, (phraseTotals.get(t.term) || 0) + t.count);
  }
  const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([term, count]) => ({ term, count }));
  const errP = new Set();
  const warnP = new Set();
  for (const r of results) for (const id of r.issues) (ISSUE_META[id].severity === 'error' ? errP : ISSUE_META[id].severity === 'warning' ? warnP : new Set()).add(r.url);
  const healthy = results.filter((r) => !errP.has(r.url) && !warnP.has(r.url)).length;
  // Per-page score: 100, minus 25 per distinct error, 6 per warning, 1 per notice. Site health is the mean.
  const PENALTY = { error: 25, warning: 6, notice: 1 };
  for (const r of results) r.score = Math.max(0, 100 - r.issues.reduce((n, id) => n + PENALTY[ISSUE_META[id].severity], 0));
  const sev = (s) => issues.filter((i) => i.severity === s).reduce((n, i) => n + i.count, 0);
  const anchors = new Map();
  for (const [, , a] of edges) if (a) anchors.set(a, (anchors.get(a) || 0) + 1);
  const extDomains = new Map();
  for (const [u, c] of extCount) {
    const h = bareHost(new URL(u).host);
    extDomains.set(h, (extDomains.get(h) || 0) + c);
  }

  const rows = results.map((r) => ({
    url: r.url,
    finalUrl: r.finalUrl,
    status: r.status,
    redirects: r.redirects.length,
    depth: r.depth,
    indexable: r.indexable,
    inSitemap: r.inSitemap,
    title: r.title || '',
    description: r.description || '',
    h1: r.h1 || '',
    h1Count: r.h1Count ?? 0,
    h2: r.h2 || [],
    words: r.words ?? null,
    ttfb: r.ttfb ?? null,
    bytes: r.bytes ?? null,
    inlinks: r.inlinks,
    inlinkAnchors: [...r.inlinkAnchors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, n]) => ({ text, n })),
    outInternal: r.outInternal ?? null,
    outExternal: r.outExternal ?? null,
    linkScore: r.linkScore ?? null,
    canonical: r.canonical || null,
    noindex: !!r.noindex,
    lang: r.lang || '',
    images: r.images || null,
    schemaTypes: r.schemaTypes || [],
    terms: r.terms || null,
    brokenLinks: r.brokenLinks.slice(0, 10),
    score: r.score,
    issues: r.issues,
    fetchError: r.fetchError || null,
  }));

  return {
    ...base,
    blocked: false,
    robots: { status: robotsRes.status, disallow: robots.rules.slice(0, 40), sitemaps: robots.sitemaps },
    sitemap: { urls: sm.urls.length, files: sm.files, sampled: sitemapPick.length },
    complete,
    summary: {
      pages: results.length,
      indexable: results.filter((r) => r.indexable).length,
      nonIndexable: results.filter((r) => !r.indexable).length,
      healthy,
      healthScore: results.length ? Math.round(results.reduce((n, r) => n + r.score, 0) / results.length) : null,
      healthyShare: results.length ? Math.round((healthy / results.length) * 100) : null,
      errors: sev('error'),
      warnings: sev('warning'),
      notices: sev('notice'),
      pagesWithErrors: errP.size,
      pagesWithWarnings: warnP.size,
      byStatus: count(results, (r) => (r.fetchError ? 'failed' : r.blockedByRobots ? 'robots' : String(r.status))),
      byDepth: count(results.filter((r) => r.depth !== null), (r) => r.depth),
      unreached: results.filter((r) => r.depth === null).length,
      avgWords: ok.length ? Math.round(ok.reduce((s, r) => s + (r.words || 0), 0) / ok.length) : null,
      avgTtfb: ok.length ? Math.round(ok.reduce((s, r) => s + (r.ttfb || 0), 0) / ok.length) : null,
      avgBytes: ok.length ? Math.round(ok.reduce((s, r) => s + (r.bytes || 0), 0) / ok.length) : null,
    },
    siteChecks,
    issues,
    pages: rows,
    duplicates: { titles: dupGroups('title'), descriptions: dupGroups('description'), h1s: dupGroups('h1'), content: dupGroups('textHash') },
    links: {
      topInlinked: rows.filter((r) => r.status === 200).sort((a, b) => b.inlinks - a.inlinks).slice(0, 25).map((r) => ({ url: r.url, inlinks: r.inlinks, anchors: r.inlinkAnchors })),
      topScore: rows.filter((r) => r.linkScore !== null).sort((a, b) => b.linkScore - a.linkScore).slice(0, 25).map((r) => ({ url: r.url, score: r.linkScore, inlinks: r.inlinks })),
      orphans: complete ? rows.filter((r) => r.indexable && r.inlinks === 0 && r.depth !== 0).map((r) => r.url).slice(0, 100) : null,
      broken: [...results.filter((r) => r.status >= 400 && r.status !== 0)].map((r) => ({ url: r.url, status: r.status, sources: [...new Set(edges.filter((e) => byUrl.get(e[1]) === r).map((e) => e[0]))].slice(0, 5) })).slice(0, 100),
      redirected: results.filter((r) => r.redirects?.length && r.inlinks > 0).map((r) => ({ url: r.url, to: r.finalUrl, hops: r.redirects.length, inlinks: r.inlinks })).sort((a, b) => b.inlinks - a.inlinks).slice(0, 50),
      anchors: topN(anchors, 30).map((a) => ({ text: a.term, count: a.count })),
      externalDomains: topN(extDomains, 25).map((d) => ({ host: d.term, count: d.count })),
      brokenExternal: [...extStatus.entries()].filter(([, s]) => (s >= 400 && ![401, 403, 429, 999].includes(s)) || s === 0).map(([url, status]) => ({ url, status, sources: (extSources.get(url) || []).slice(0, 5) })),
      externalChecked: extStatus.size,
    },
    content: {
      terms: topN(termTotals, 30),
      phrases: topN(phraseTotals, 25),
      schemaTypes: topN(new Map(Object.entries(count(ok.flatMap((r) => r.schemaTypes || []), (t) => t))), 15).map((t) => ({ type: t.term, pages: t.count })),
      titleLengths: count(ok.filter((r) => r.title), (r) => (r.title.length > 60 ? '61+' : r.title.length >= 30 ? '30–60' : '<30')),
      descLengths: count(ok, (r) => (!r.description ? 'missing' : r.description.length > 160 ? '161+' : r.description.length >= 70 ? '70–160' : '<70')),
      wordBands: count(ok, (r) => (r.words < 200 ? '<200' : r.words < 500 ? '200–499' : r.words < 1000 ? '500–999' : '1000+')),
    },
    notes,
  };
}
