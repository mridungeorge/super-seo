import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePage, robotsRules, sitemapLocs, buildIssues, normUrl, decodeEntities } from '../src/collect/crawl.js';
import { buildDashboard } from '../src/core/dashboard.js';

const HTML = `<!doctype html><html lang="en-AU"><head><title>Storage &amp; Shelving | Acme</title>
<meta name="description" content="Shelves and storage for every room in the house.">
<meta name="viewport" content="width=device-width"><meta name="robots" content="noindex, follow">
<link rel="canonical" href="/storage/"><link rel="alternate" hreflang="en-au" href="/storage/">
<script type="application/ld+json">{"@graph":[{"@type":"Product"},{"@type":["Offer","Thing"]}]}</script></head>
<body><h1>Storage</h1><h2>Shelves</h2><a href="/a/">Shelf A</a><a href="https://other.com/x" rel="nofollow">Out</a><a href="mailto:x@y.com">mail</a><a href="#top">top</a>
<img src="a.jpg" alt="a"><img src="b.jpg"><p>${'shelving unit storage '.repeat(40)}</p></body></html>`;

test('parsePage reads the signals a search engine uses', () => {
  const p = parsePage(HTML, 'https://www.acme.com/storage/', 'acme.com');
  assert.equal(p.title, 'Storage & Shelving | Acme');
  assert.equal(p.canonical, 'https://www.acme.com/storage/');
  assert.equal(p.noindex, true);
  assert.equal(p.lang, 'en-AU');
  assert.deepEqual(p.headings.h1, ['Storage']);
  assert.equal(p.images.count, 2);
  assert.equal(p.images.noAlt, 1);
  assert.deepEqual(p.internal.map((l) => l.url), ['https://www.acme.com/a/']);
  assert.equal(p.external.length, 1);
  assert.equal(p.external[0].nofollow, true);
  assert.deepEqual(p.schemaTypes.sort(), ['Offer', 'Product', 'Thing']);
  assert.equal(p.hreflang.length, 1);
  assert.ok(p.terms.phrases.some((t) => t.term === 'shelving unit'));
});

test('robots rules: longest match wins and wildcards work', () => {
  const r = robotsRules('User-agent: Googlebot\nDisallow: /g/\n\nUser-agent: *\nDisallow: /cart\nDisallow: /*?sort=\nAllow: /cart/help\nSitemap: https://x.com/s.xml');
  assert.equal(r.allowed('/cart/x'), false);
  assert.equal(r.allowed('/cart/help'), true);
  assert.equal(r.allowed('/shop?sort=price'), false);
  assert.equal(r.allowed('/g/x'), true);
  assert.deepEqual(r.sitemaps, ['https://x.com/s.xml']);
});

test('sitemap locs decode XML entities and CDATA', () => {
  const s = sitemapLocs('<urlset><url><loc>https://x.com/s.php?type=pages&amp;page=1</loc></url><url><loc><![CDATA[https://x.com/b]]></loc></url></urlset>');
  assert.deepEqual(s.locs, ['https://x.com/s.php?type=pages&page=1', 'https://x.com/b']);
  assert.equal(s.index, false);
  assert.equal(sitemapLocs('<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>').index, true);
});

test('urls normalise and entities decode', () => {
  assert.equal(normUrl('/a#frag', 'https://x.com/b'), 'https://x.com/a');
  assert.equal(normUrl('mailto:a@b.c'), null);
  assert.equal(decodeEntities('a&#39;b &amp; &#x41;'), "a'b & A");
});

const page = (o) => ({ url: 'https://x.com/', status: 200, html: true, redirects: [], indexable: true, title: 'A good page title that is long enough ok', description: 'd'.repeat(100), h1: 'H', h1Count: 1, words: 400, images: { count: 0, noAlt: 0, noDimensions: 0 }, hreflang: [], og: { title: true, description: true }, twitterCard: true, schemaTypes: ['Product'], schemaInvalid: 0, viewport: true, lang: 'en', canonical: 'https://x.com/', ttfb: 100, bytes: 1000, inlinks: 3, depth: 1, textHash: null, ...o });

test('issues: duplicates, broken links and thin pages are found and attributed', () => {
  const pages = [page({ url: 'https://x.com/a', canonical: 'https://x.com/a', title: 'Same title for two pages here ok', words: 50, brokenLinks: ['https://x.com/gone'] }), page({ url: 'https://x.com/b', canonical: 'https://x.com/b', title: 'Same title for two pages here ok' }), page({ url: 'https://x.com/gone', status: 404, html: false, canonical: null })];
  const issues = buildIssues(pages, { complete: false });
  const ids = Object.fromEntries(issues.map((i) => [i.id, i]));
  assert.equal(ids['title-duplicate'].count, 2);
  assert.equal(ids['thin-content'].count, 1);
  assert.equal(ids['broken-internal-link'].urls[0], 'https://x.com/a');
  assert.equal(ids['http-error'].urls[0], 'https://x.com/gone');
  assert.equal(ids['orphan-page'], undefined, 'orphans are only reported on a complete crawl');
  assert.equal(issues[0].severity, 'error', 'errors sort first');
});

test('the dashboard builds from an empty or blocked scan folder without throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-dash-'));
  fs.writeFileSync(path.join(dir, 'crawl.json'), JSON.stringify({ blocked: true, blockedReason: 'the homepage returned HTTP 403', host: 'x.com', pages: [], issues: [], summary: null }));
  const file = buildDashboard(dir, 'x.com');
  const html = fs.readFileSync(file, 'utf8').replace(/<script>[\s\S]*<\/script>/, '');
  assert.ok(html.includes('blocked our crawler'));
  assert.doesNotMatch(html, /could not be built/);
  assert.doesNotMatch(html, /NaN|undefined/);
  fs.rmSync(dir, { recursive: true });
});

import { startScrapling, findPython } from '../src/collect/scrapling.js';

test('the Scrapling engine reads a page the same way as the built-in one', { skip: !findPython() && 'Scrapling is not installed' }, async () => {
  const engine = await startScrapling();
  try {
    const url = 'https://www.acme.com/storage/';
    const a = parsePage(HTML, url, 'acme.com');
    const b = parsePage(HTML, url, 'acme.com', await engine.parts(HTML, url));
    for (const k of ['title', 'description', 'canonical', 'noindex', 'viewport', 'lang', 'words', 'internal', 'external', 'images', 'schemaTypes', 'hreflang', 'og', 'headings']) assert.deepEqual(b[k], a[k], k);
  } finally {
    engine.close();
  }
});
