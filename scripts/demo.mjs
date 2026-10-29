// Builds examples/demo: a complete scan folder and dashboard for a fictional shop, with no third party
// involved. Two small fake sites are generated and served on localhost, then crawled by the real
// crawler; a third refuses all requests, to show how a blocked competitor appears. The speed, rank,
// search and AI figures are MADE UP (the dashboard says "demo data"); everything derived from the
// crawl is real output of the tool.
//
//   node scripts/demo.mjs            rebuild examples/demo
//   node scripts/demo.mjs --out dir  write somewhere else

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlSite } from '../src/collect/crawl.js';
import { analyseGeo } from '../src/collect/geo.js';
import { classifyIntent, clusterKeywords } from '../src/collect/keywords.js';
import { detectTech } from '../src/core/techdetect.js';
import { buildDashboard } from '../src/core/dashboard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const outDir = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : path.join(root, 'examples', 'demo'));
const DATE = '2026-01-15';

/** Small seeded random numbers so the demo is the same every time. */
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = 'trail pack tent stove boot jacket merino camp hike ridge summit river sleeping bag light shell fleece grip waterproof durable season family compact insulated rain wind valley canyon lantern bottle filter map compass cord'.split(' ');
const para = (r, n) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');

/**
 * A small shop. `quality` (0..1) controls how many deliberate problems it has: missing titles and
 * descriptions, duplicate titles, thin pages, images without alt text, broken and redirected links.
 */
function makeSite({ brand, seed, quality, host }) {
  const r = rng(seed);
  const pages = new Map();
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cats = [['Camping', 'camping'], ['Hiking', 'hiking'], ['Footwear', 'footwear']];
  const products = [];
  const adjectives = ['Alpine', 'Ridge', 'Summit', 'Trail', 'Canyon', 'Glacier', 'Basin', 'Pioneer'];
  const kinds = [['Tent', 'camping'], ['Stove', 'camping'], ['Sleeping Bag', 'camping'], ['Lantern', 'camping'], ['Daypack', 'hiking'], ['Rain Jacket', 'hiking'], ['Trekking Poles', 'hiking'], ['Water Filter', 'hiking'], ['Hiking Boot', 'footwear'], ['Trail Shoe', 'footwear'], ['Wool Socks', 'footwear']];
  for (const adj of adjectives) for (const [kind, cat] of kinds) if (r() < 0.55) products.push({ name: `${adj} ${kind}`, cat, slug: slug(`${adj} ${kind}`) });

  const page = ({ title, desc, h1, body, extra = '', status = 200, headers = {}, delay = 0, noindex = false }) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, delay, html: `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${title === null ? '' : `<title>${title}</title>`}${desc ? `<meta name="description" content="${desc}">` : ''}${noindex ? '<meta name="robots" content="noindex">' : ''}<link rel="canonical" href="__ORIGIN____PATH__">${extra}</head><body><header><nav><a href="/">Home</a> <a href="/camping/">Camping</a> <a href="/hiking/">Hiking</a> <a href="/footwear/">Footwear</a> <a href="/sale/">Sale</a> <a href="/blog/">Guides</a> <a href="/about/">About</a> <a href="/store-locator/">Stores</a>${quality < 0.8 ? ' <a href="/old-sale">Clearance</a> <a href="/discontinued/">Archive</a>' : ''}</nav></header><main>${h1 === null ? '' : `<h1>${h1}</h1>`}${body}</main><footer>${brand}. All rights reserved.</footer></body></html>` });

  const lengthy = (n) => `<p>${para(r, n)}.</p>`;
  const img = (alt) => `<img src="/img/${Math.floor(r() * 90)}.jpg" width="400" height="300"${alt ? ` alt="${alt}"` : ''}>`;
  const productLd = (p) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, brand: brand })}</script>`;

  pages.set('/', page({ title: `${brand} | Camping and hiking gear`, desc: `Tents, packs, boots and stoves for every trip. Free shipping over $99 from ${brand}.`, h1: 'Gear for the long way round', body: `${lengthy(180)}${cats.map(([n, s]) => `<a href="/${s}/">${n}</a>`).join(' ')}<a href="/p/${products[0].slug}/">Featured</a>${img('Hikers on a ridge')}`, extra: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: brand })}</script>`, headers: { server: 'demo-server', 'content-encoding': 'identity' } }));
  for (const [name, s] of cats) {
    const own = products.filter((p) => p.cat === s);
    pages.set(`/${s}/`, page({ title: `${name} gear | ${brand}`, desc: r() < quality + 0.2 ? `Shop ${name.toLowerCase()} gear from ${brand}: ${own.length} products, tested on the trail.` : '', h1: `${name} gear`, body: `${lengthy(220)}<ul>${own.map((p) => `<li><a href="/p/${p.slug}/">${p.name}</a></li>`).join('')}</ul>` }));
  }
  const dupTitle = `Best outdoor gear | ${brand}`;
  products.forEach((p, i) => {
    const thin = r() > quality + 0.15;
    const dup = i % 6 === 0 && quality < 0.8;
    pages.set(`/p/${p.slug}/`, page({
      title: r() > quality + 0.45 ? null : dup ? dupTitle : `${p.name} | ${brand}`,
      desc: r() < quality ? `${p.name}: durable, tested and ready for the trail. Free returns for 30 days.` : '',
      h1: r() > quality + 0.7 ? null : p.name,
      body: `${thin ? lengthy(60) : lengthy(260)}${img(r() < quality ? `${p.name} in use` : '')}${img(r() < quality ? `${p.name} detail` : '')}<a href="/${p.cat}/">Back to ${p.cat}</a> ${products[(i + 1) % products.length] ? `<a href="/p/${products[(i + 1) % products.length].slug}/">Next</a>` : ''}`,
      extra: r() < quality - 0.1 ? productLd(p) : '',
    }));
  });
  const posts = ['How to pick a tent', 'Layering for cold trails', 'Water filters compared', 'A first overnight hike', 'Boot fit guide', 'Winter camping basics'];
  pages.set('/blog/', page({ title: `Guides | ${brand}`, desc: `Practical guides from the ${brand} team.`, h1: 'Guides', body: `<ul>${posts.map((t) => `<li><a href="/blog/${slug(t)}/">${t}</a></li>`).join('')}</ul>` }));
  posts.forEach((t, i) => pages.set(`/blog/${slug(t)}/`, page({ title: `${t} | ${brand} guides`, desc: `${t}: advice from people who walk a lot.`, h1: i === 2 && quality < 0.8 ? null : t, body: `${lengthy(520)}${lengthy(380)}<a href="/blog/">All guides</a>`, extra: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: t })}</script>` })));
  pages.set('/about/', page({ title: `About us | ${brand}`, desc: `The story behind ${brand}.`, h1: 'About us', body: lengthy(90) }));
  pages.set('/store-locator/', page({ title: `Find a store | ${brand}`, desc: `Stores near you.`, h1: 'Find a store', body: lengthy(120) }));
  pages.set('/sale/', page({ title: `Sale | ${brand}`, desc: `Seasonal markdowns on tents, boots and packs.`, h1: 'Sale', body: lengthy(160) }));
  pages.set('/old-sale', { status: 301, headers: { location: '/sale/' }, html: '' });
  pages.set('/thank-you/', page({ title: `Thank you | ${brand}`, desc: 'Order received.', h1: 'Thank you', body: lengthy(50), noindex: true }));
  pages.set('/slow/', page({ title: `Trip planner | ${brand}`, desc: 'Plan a route.', h1: 'Trip planner', body: lengthy(200), delay: 950 }));
  pages.set('/catalogue/', page({ title: `Catalogue | ${brand}`, desc: 'The full catalogue.', h1: 'Catalogue', body: `${lengthy(300)}<script>/*${'x'.repeat(530000)}*/</script>` }));
  pages.set('/orphan-guide/', page({ title: `Orphan guide | ${brand}`, desc: 'Not linked from anywhere.', h1: 'Orphan guide', body: lengthy(260) }));
  pages.set('/orphan-offer/', page({ title: `Orphan offer | ${brand}`, desc: 'Not linked from anywhere.', h1: 'Orphan offer', body: lengthy(210) }));
  return { pages, products, posts };
}

function serve(site, host, { blocked = false } = {}) {
  const sitemapPaths = [...site.pages.keys()].filter((p) => site.pages.get(p).status === 200);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (blocked) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('Forbidden');
      }
      if (url.pathname === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end(`User-agent: *\nDisallow: /cart/\nDisallow: /account/\nSitemap: http://${req.headers.host}/sitemap.xml\n`);
      }
      if (url.pathname === '/sitemap.xml') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><urlset>${sitemapPaths.map((p) => `<url><loc>http://${req.headers.host}${p}</loc></url>`).join('')}</urlset>`);
      }
      const p = site.pages.get(url.pathname);
      if (!p) {
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('<h1>Not found</h1>');
      }
      setTimeout(() => {
        res.writeHead(p.status, p.headers);
        res.end(p.html.replaceAll('__ORIGIN__', `http://${req.headers.host}`).replaceAll('__PATH__', url.pathname));
      }, p.delay || 0);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function crawlLocal(site, host, opts = {}) {
  const { server, origin } = await serve(site, host, opts);
  try {
    const result = await crawlSite(origin, { maxPages: 200, concurrency: 4, delay: 20, checkExternal: false });
    // present the local server under a reserved example domain
    return JSON.parse(JSON.stringify(result).replaceAll(origin, `https://${host}`).replaceAll(origin.replace('http://', ''), host));
  } finally {
    server.close();
  }
}

const write = (name, data) => fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(data, null, 2));

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const SELF = 'demo-outdoor.example';
  const C1 = 'trail-gear.example';
  const C2 = 'peak-supply.example';
  const self = makeSite({ brand: 'Demo Outdoor Supply', seed: 11, quality: 0.5, host: SELF });
  const c1 = makeSite({ brand: 'Trail Gear Co', seed: 23, quality: 0.92, host: C1 });
  const c2 = makeSite({ brand: 'Peak Supply', seed: 5, quality: 0.6, host: C2 });

  console.error('crawling the generated sites…');
  const crawl = await crawlLocal(self, SELF);
  write('crawl', crawl);
  write('competitor-1-crawl', await crawlLocal(c1, C1));
  write('competitor-2-crawl', await crawlLocal(c2, C2, { blocked: true }));

  // ---- made-up measurements (labelled as demo data in the dashboard) ----
  const r = rng(99);
  const history = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.parse(DATE) - i * 86400000).toISOString().slice(0, 10), rank: Math.round(48210 + i * 150 + (r() - 0.5) * 900) }));
  write('rank', {
    rows: [
      { domain: SELF, tranco: { rank: 48210, date: DATE, history }, radar: { rank: null, bucket: 100000, categories: ['Shopping'], date: DATE } },
      { domain: C1, tranco: { rank: 21980, date: DATE, history: history.map((h) => ({ ...h, rank: Math.round(h.rank * 0.46) })) }, radar: { rank: null, bucket: 50000, categories: ['Shopping'], date: DATE } },
      { domain: C2, tranco: { rank: 97300, date: DATE, history: history.map((h) => ({ ...h, rank: Math.round(h.rank * 2) })) }, radar: { rank: null, bucket: 100000, categories: ['Shopping'], date: DATE } },
    ],
  });
  write('radar', { domain: SELF, rank: null, bucket: 100000, categories: ['Shopping'], date: DATE, series: [] });

  const psi = (url, strategy, perf, a11y, bp, seo, lcp, ttfb) => ({
    url, strategy, fetchedAt: `${DATE}T09:00:00Z`, scores: { performance: perf, accessibility: a11y, 'best-practices': bp, seo },
    lab: { lcp: { value: lcp, display: `${(lcp / 1000).toFixed(1)} s` }, cls: { value: 0.04, display: '0.04' }, tbt: { value: 420, display: '420 ms' }, fcp: { value: 1900, display: '1.9 s' }, si: { value: 4800, display: '4.8 s' } },
    field: { overall: 'AVERAGE', lcp: { p75: Math.round(lcp * 0.8), unit: 'ms', rating: lcp > 4000 ? 'SLOW' : 'AVERAGE' }, inp: { p75: 210, unit: 'ms', rating: 'AVERAGE' }, cls: { p75: 0.07, unit: 'score', rating: 'FAST' }, fcp: { p75: 1600, unit: 'ms', rating: 'FAST' }, ttfb: { p75: ttfb, unit: 'ms', rating: 'FAST' } },
    originField: null,
    topIssues: [{ id: 'unused-javascript', title: 'Reduce unused JavaScript', score: 0, savings: 1850 }, { id: 'uses-optimized-images', title: 'Serve images in next-gen formats', score: 0.3, savings: 900 }, { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', score: 0.4, savings: 640 }, { id: 'unused-css-rules', title: 'Reduce unused CSS', score: 0.5, savings: 310 }],
  });
  write('psi', psi(`https://${SELF}/`, 'mobile', 54, 88, 92, 100, 4100, 480));
  write('psi-desktop', psi(`https://${SELF}/`, 'desktop', 81, 88, 92, 100, 1800, 310));
  const keyPages = crawl.pages.filter((p) => p.status === 200 && p.indexable && p.depth !== 0).sort((a, b) => b.inlinks - a.inlinks).slice(0, 3);
  keyPages.forEach((p, i) => write(`psi-page-${i + 1}`, psi(p.url, 'mobile', 48 + i * 7, 90, 92, 100, 4600 - i * 500, 450)));
  write('competitor-1-psi', psi(`https://${C1}/`, 'mobile', 74, 94, 96, 100, 2600, 360));
  write('competitor-2-psi', psi(`https://${C2}/`, 'mobile', 38, 80, 83, 92, 6100, 700));

  const homeHtml = self.pages.get('/').html.replaceAll('__ORIGIN__', `https://${SELF}`).replaceAll('__PATH__', '/');
  const robotsTxt = 'User-agent: *\nDisallow: /cart/\nDisallow: /account/\n';
  write('geo', { geo: analyseGeo({ html: homeHtml, robots: robotsTxt, llmsTxt: false, url: `https://${SELF}/` }), plan: null });
  write('tech', { domain: SELF, detectedAt: `${DATE}T09:00:00Z`, technology: detectTech({ server: 'cloudflare', 'cf-ray': 'demo' }, '<script src="https://www.googletagmanager.com/gtag/js?id=G-DEMO"></script><link href="https://fonts.googleapis.com/css">'), sources: [] });
  write('probe', {
    url: `https://${SELF}/`, measuredAt: `${DATE}T09:00:00Z`, runs: 1,
    vitals: { lcp: 3400, cls: 0.08, inp: null, fcp: 1900, ttfb: 420, domContentLoaded: 2100, load: 3900, lcpSelector: 'main > div.hero > img:nth-child(1)', clsEntries: [], longTasks: [] },
    ratings: { lcp: 'needs-improvement', cls: 'good', inp: 'no-interaction', fcp: 'good', ttfb: 'good' }, page: { resources: 86 }, tech: [],
  });

  const kws = ['camping tents', 'family camping tent', 'lightweight hiking boots', 'best rain jacket for hiking', 'how to choose a sleeping bag', 'buy camping stove', 'trekking poles', 'waterproof daypack', 'hiking boots women', 'compact water filter', 'winter camping checklist', 'camping lantern rechargeable', 'wool hiking socks', 'trail running shoes', 'camping gear sale', 'demo outdoor supply'];
  const ideas = kws.map((k, i) => ({ keyword: k, sources: ['suggest'], sourceCount: 1 + (i % 3), suggestionDepth: 0, intent: classifyIntent(k) }));
  write('keywords-brand', { seed: 'Demo Outdoor Supply', count: ideas.length, keywords: ideas, notes: [], clusters: clusterKeywords(ideas) });
  write('serp', {
    domain: SELF, engine: 'demo',
    results: kws.slice(0, 12).map((k, i) => {
      const position = [1, 4, null, 7, null, 2, 9, null, 5, null, 3, null][i];
      const others = [C1, C2, 'bigretailer.example', 'outdoor-reviews.example', 'gearlab.example'];
      const results = Array.from({ length: 10 }, (_, j) => ({ domain: position === j + 1 ? SELF : others[(i + j) % others.length], title: `${k} result ${j + 1}`, url: `https://example/${j}` }));
      return { keyword: k, engine: 'demo', position, found: position !== null, results, capturedAt: `${DATE}T09:00:00Z`, error: null };
    }),
  });
  const prompts = [['What are good alternatives to Demo Outdoor Supply?', true, 2, 'positive'], ['Is Demo Outdoor Supply a good choice for hiking boots?', true, 1, 'positive'], ['Where can I buy a lightweight tent in Australia?', false, null, 'neutral'], ['Best online stores for camping gear?', true, 4, 'neutral'], ['Demo Outdoor Supply reviews', false, null, 'neutral'], ['Who sells Alpine-brand rain jackets?', false, null, 'neutral'], ['Is Demo Outdoor Supply trustworthy?', true, 1, 'positive']];
  write('ai', {
    brand: 'Demo Outdoor Supply', competitors: [], engine: 'demo', measuredAt: `${DATE}T09:00:00Z`, prompts: prompts.length, answered: prompts.length, mentionRate: 4 / 7, shareOfVoice: 1, mentions: {}, avgPosition: 2, sentiments: { positive: 3, negative: 0, neutral: 4 }, coMentions: {},
    results: prompts.map(([prompt, mentioned, rank, sentiment], i) => ({ id: i + 1, prompt, error: null, mentioned, rank, coMentions: [], sentiment, excerpt: mentioned ? 'Demo Outdoor Supply is an Australian retailer of camping and hiking gear…' : 'Several retailers sell lightweight tents, including larger chains…' })),
  });
  const steps = ['probe', 'crawl', 'psi', 'psi-desktop', 'tech', 'geo', 'rank', 'competitor-1-crawl', 'competitor-1-psi', 'competitor-2-crawl', 'competitor-2-psi', 'psi-page-1', 'psi-page-2', 'psi-page-3', 'keywords-brand', 'serp', 'ai'].map((name) => ({ name, status: 'ok', seconds: 0, file: name + '.json', note: '' }));
  write('summary', { domain: SELF, demo: true, steps });
  const file = buildDashboard(outDir, SELF);
  console.error(`wrote ${outDir}\nopen ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
