// Our own collectors: web vitals and technology detection on the live site.
//
// These are the numbers the numbers that have to be measured on the live site itself, so they are measured here:
//   LCP / CLS / INP / FCP / TTFB  (with the offending element as a CSS selector)
//   technology stack (headers + HTML), each hit carrying the rule that found it

import { launchBrowser, shutdownBrowser } from '../core/browser.js';
import { detectTech } from '../core/techdetect.js';

// Injected before the page's own scripts so the observers see the real first paint.
const VITALS_SCRIPT = `
(() => {
  window.__vitals = { lcp: null, cls: 0, clsEntries: [], inp: null, fcp: null, ttfb: null, ttfcp: null, domContentLoaded: null, load: null, longTasks: [] };
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      const cls = (node.className && node.className.toString ? node.className.toString() : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const parent = node.parentElement;
      if (parent) {
        const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
        part += ':nth-child(' + idx + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__vitals.lcp = { value: last.startTime, time: last.renderTime || last.loadTime, selector: sel(last.element || (last.target && last.target.nodeType === 1 ? last.target : null)), url: last.url || null, size: last.size || null };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__vitals.cls += entry.value;
          window.__vitals.clsEntries.push({ value: entry.value, time: entry.startTime, selector: sel(entry.sources && entry.sources[0] && entry.sources[0].node) });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const dur = entry.duration || 0;
        if (window.__vitals.inp === null || dur > window.__vitals.inp.value) {
          window.__vitals.inp = { value: dur, time: entry.startTime, type: entry.name, selector: sel(entry.target) };
        }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vitals.longTasks.push({ value: entry.duration, time: entry.startTime });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => { window.__vitals.domContentLoaded = performance.now(); }, { once: true });
  window.addEventListener('load', () => { window.__vitals.load = performance.now(); }, { once: true });
})();
`;

const READ_SCRIPT = `(() => {
  const v = window.__vitals || {};
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = {};
  for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime;
  return JSON.stringify({
    lcp: v.lcp, cls: v.cls, clsEntries: (v.clsEntries || []).slice(-5), inp: v.inp,
    fcp: paints['first-contentful-paint'] ?? null,
    ttfb: nav.responseStart ? nav.responseStart - nav.requestStart : null,
    domContentLoaded: nav.domContentLoadedEventEnd ?? v.domContentLoaded ?? null,
    load: nav.loadEventEnd ?? v.load ?? null,
    longTasks: (v.longTasks || []).slice(0, 10),
    transferSize: nav.transferSize ?? null,
    resources: performance.getEntriesByType('resource').length,
    title: document.title,
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
    metaDescription: (document.querySelector('meta[name=description]') || {}).content || null,
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 120)),
    lang: document.documentElement.lang || null,
    viewport: !!(document.querySelector('meta[name=viewport]')),
    images: document.images.length,
    imagesWithoutAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
    links: document.links.length,
    scripts: document.scripts.length,
    canonicalCount: document.querySelectorAll('link[rel=canonical]').length,
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent.slice(0, 4000)),
    metaRobots: (document.querySelector('meta[name=robots]') || {}).content || null,
    hreflang: [...document.querySelectorAll('link[rel=alternate][hreflang]')].map((l) => l.getAttribute('hreflang') + ' -> ' + l.href),
    ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || null,
    twitterCard: (document.querySelector('meta[name="twitter:card"]') || {}).content || null,
    forms: document.forms.length,
    thirdPartyHosts: [...new Set(performance.getEntriesByType('resource').map((r) => { try { return new URL(r.name).host; } catch (e) { return null; } }).filter(Boolean))].filter((h) => !/^www\.|^$/.test(h) === false || true).slice(0, 60),
  });
})()`;

/** Rating thresholds from the Core Web Vitals guidance. */
export function rateVitals(vitals) {
  const r = {};
  const val = (x) => (typeof x === 'number' ? x : x?.value);
  const lcp = val(vitals.lcp);
  r.lcp = lcp == null ? 'unknown' : lcp <= 2500 ? 'good' : lcp <= 4000 ? 'needs-improvement' : 'poor';
  const cls = val(vitals.cls);
  r.cls = cls == null ? 'unknown' : cls <= 0.1 ? 'good' : cls <= 0.25 ? 'needs-improvement' : 'poor';
  const inp = val(vitals.inp);
  r.inp = inp == null ? 'no-interaction' : inp <= 200 ? 'good' : inp <= 500 ? 'needs-improvement' : 'poor';
  const fcp = val(vitals.fcp);
  r.fcp = fcp == null ? 'unknown' : fcp <= 1800 ? 'good' : fcp <= 3000 ? 'needs-improvement' : 'poor';
  const ttfb = val(vitals.ttfb);
  r.ttfb = ttfb == null ? 'unknown' : ttfb <= 800 ? 'good' : ttfb <= 1800 ? 'needs-improvement' : 'poor';
  return r;
}

/**
 * Probe a URL: web vitals, page basics and the technology stack.
 * Uses a private Chrome instance and always tears it down.
 */
export async function probeSite(url, { runs = 1, verbose = false } = {}) {
  const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const browser = await launchBrowser({ verbose });
  try {
    await browser.openPage('about:blank');
    await browser.addInitScript(VITALS_SCRIPT);
    const runsOut = [];
    const headers = {};
    let html = '';
    // The page cannot read its own response headers; capture them from the CDP network log.
    const off = browser.on('Network.responseReceived', (p) => {
      if (p.type === 'Document' && !Object.keys(headers).length) {
        Object.assign(headers, p.response.headers || {});
      }
    });
    for (let i = 0; i < Math.max(1, runs); i++) {
      await browser.navigate(target, { settle: 1500 });
      const raw = JSON.parse(await browser.evaluate(READ_SCRIPT));
      runsOut.push(raw);
      if (i === 0) html = await browser.html();
    }
    off();
    const vitals = average(runsOut);
    const tech = detectTech(headers, html);
    return {
      url: target,
      measuredAt: new Date().toISOString(),
      runs: runsOut.length,
      vitals,
      ratings: rateVitals(vitals),
      page: runsOut[0] || {},
      tech,
      headers,
    };
  } finally {
    await shutdownBrowser(browser);
  }
}

/** Average the numeric vitals across runs, keeping the worst CLS/LCP. */
function average(runs) {
  const out = { lcp: null, cls: null, inp: null, fcp: null, ttfb: null, domContentLoaded: null, load: null };
  const num = (k) => {
    const vals = runs.map((r) => (typeof r[k] === 'number' ? r[k] : r[k]?.value)).filter((v) => typeof v === 'number');
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  out.lcp = num('lcp');
  out.cls = num('cls');
  out.inp = num('inp');
  out.fcp = num('fcp');
  out.ttfb = num('ttfb');
  out.domContentLoaded = num('domContentLoaded');
  out.load = num('load');
  // Keep the offending-element detail from the run with the worst CLS.
  const worst = runs.reduce((a, b) => ((b.cls || 0) > (a.cls || 0) ? b : a), runs[0] || {});
  out.lcpSelector = (runs.find((r) => r.lcp) || {}).lcp?.selector || null;
  out.clsEntries = worst.clsEntries || [];
  out.inpSelector = (runs.find((r) => r.inp) || {}).inp?.selector || null;
  out.longTasks = (worst.longTasks || []);
  return out;
}
