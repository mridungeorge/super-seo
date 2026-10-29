// The written report for `sm full`. Numbers, tables and the priority list are computed from the scan
// folder; the prose around them is written section by section by a model that is handed only the
// evidence for that section, so every claim can be checked against the data in the same folder.

import { complete } from '../core/llm.js';
import { loadScan, actions, crawlOk } from '../core/dashboard.js';
import { competitorData } from '../core/competitors.js';
import { PALETTE, area, hbars, ring, stack, CHART_CSS, compact, esc, num, pct } from '../core/charts.js';

const trim = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n) + '…' : String(s ?? ''));

const SYSTEM =
  'You are a senior SEO consultant writing one section of a client report. Use ONLY the evidence block you are given. ' +
  'If the evidence does not support a claim, say "not in the evidence" instead of guessing. Never invent numbers, ' +
  'keywords, competitors, search volumes, rankings or traffic figures, and never state a number that is not in the evidence. ' +
  'Write for a non-expert who must act on it: plain language, and explain each term of art in a few words the first time ' +
  '(canonical, meta description, crawler, 301 redirect, structured data). No drama words, no filler. ' +
  'Be brief. Lead with numbers: every "Problem:" line must contain at least one figure copied from the evidence (a count, a percentage, a score, a time). ' +
  'Format: short headed items. Each recommendation is a bold heading followed by three bullets of at most 22 words each: ' +
  '"Problem:" what is true, with the numbers; "Change:" the concrete step; "Expected effect:" the benefit in one clause, ' +
  'saying "size not measurable from this data" when it cannot be known. At most 5 items and 220 words for the whole section.';

/** Compact, section-sized slices of the scan. */
export function evidencePack(d, domain) {
  const c = crawlOk(d) ? d.crawl : null;
  const self = d.rank?.rows?.[0];
  const popularity = self
    ? {
        trancoRank: self.tranco?.rank ?? null,
        trancoHistory: (self.tranco?.history || []).slice(0, 14).map((x) => ({ date: x.date, rank: x.rank })),
        cloudflareRadar: self.radar ? { rank: self.radar.rank, bucket: self.radar.bucket, categories: self.radar.categories } : null,
        estimatedMonthlyVisits: d.estimate?.estimate ? { ...d.estimate.estimate, note: 'rough estimate from rank, not measured' } : null,
      }
    : null;
  const psi = d.psi ? { mobile: d.psi.scores, field: d.psi.field, originField: d.psi.originField, lab: d.psi.lab, topIssues: (d.psi.topIssues || []).slice(0, 6), desktop: d['psi-desktop']?.scores || null, otherPages: ['psi-page-1', 'psi-page-2', 'psi-page-3'].map((k) => d[k]).filter(Boolean).map((p) => ({ url: p.url, scores: p.scores })) } : null;
  const crawl = c
    ? {
        pagesCrawled: c.summary.pages,
        wholeSiteCrawled: c.complete,
        sitemapUrls: c.sitemap?.urls,
        healthScore: c.summary.healthScore,
        errors: c.summary.errors,
        warnings: c.summary.warnings,
        notices: c.summary.notices,
        indexable: c.summary.indexable,
        avgServerResponseMs: c.summary.avgTtfb,
        avgWords: c.summary.avgWords,
        failedSiteChecks: c.siteChecks.filter((x) => !x.pass).map((x) => `${x.title}: ${x.detail}`),
        topIssues: c.issues.slice(0, 20).map((i) => ({ issue: i.title, severity: i.severity, category: i.category, pages: i.count, fix: i.fix, examples: i.urls.slice(0, 3).map((u) => u.replace(/^https?:\/\/(www\.)?/, '') + (i.details?.[u] ? ` (${trim(i.details[u], 70)})` : '')) })),
        duplicates: { titles: c.duplicates.titles.length, descriptions: c.duplicates.descriptions.length, h1s: c.duplicates.h1s.length, content: c.duplicates.content.length, largestTitleGroup: c.duplicates.titles[0] ? { pages: c.duplicates.titles[0].count, title: trim(c.duplicates.titles[0].value, 80) } : null },
        thinPages: c.pages.filter((p) => p.status === 200 && p.indexable && p.words !== null && p.words < 200).length,
      }
    : { blocked: d.crawl?.blocked || false, reason: d.crawl?.blockedReason || 'no crawl in this scan' };
  const links = c
    ? {
        mostLinkedPages: c.links.topInlinked.slice(0, 8).map((x) => ({ path: x.url.replace(/^https?:\/\/[^/]+/, '') || '/', inlinks: x.inlinks })),
        commonAnchors: c.links.anchors.slice(0, 10),
        brokenInternal: c.links.broken.slice(0, 6).map((b) => ({ url: b.url, status: b.status, linkedFrom: b.sources.length })),
        redirectedInternal: c.links.redirected.slice(0, 6),
        orphans: c.links.orphans === null ? 'not assessed (sample crawl)' : c.links.orphans.length,
        brokenOutbound: c.links.brokenExternal.slice(0, 8),
        outboundChecked: c.links.externalChecked,
        outboundDomains: c.links.externalDomains.slice(0, 10),
      }
    : null;
  const content = c
    ? {
        topPhrases: c.content.phrases.slice(0, 15),
        topWords: c.content.terms.slice(0, 15),
        schemaTypes: c.content.schemaTypes,
        titleLengthBands: c.content.titleLengths,
        descriptionBands: c.content.descLengths,
        wordBands: c.content.wordBands,
        keyPages: c.pages.filter((p) => p.status === 200 && p.indexable).sort((a, b) => b.inlinks - a.inlinks).slice(0, 25).map((p) => ({ path: p.url.replace(/^https?:\/\/[^/]+/, '') || '/', title: trim(p.title, 70), h1: trim(p.h1, 50), words: p.words, inlinks: p.inlinks, phrases: (p.terms?.phrases || []).slice(0, 2).map((t) => t.term) })),
      }
    : null;
  const ideas = [];
  for (const s of [d['keywords-brand'], d['keywords-topic'], d.keywords]) for (const k of s?.keywords || []) if (!ideas.some((x) => x.keyword === k.keyword)) ideas.push({ keyword: k.keyword, intent: k.intent });
  const clusters = [d['keywords-brand'], d['keywords-topic']].flatMap((s) => s?.clusters || []).slice(0, 10).map((x) => ({ cluster: x.cluster, size: x.size, terms: (x.terms || []).slice(0, 6) }));
  const serp = d.serp?.results ? d.serp.results.map((r) => ({ keyword: r.keyword, position: r.position, foundInTop10: r.found, topDomains: (r.results || []).slice(0, 3).map((x) => x.domain) })) : null;
  const aiVis = d.ai ? { mentionRate: d.ai.mentionRate, answered: d.ai.answered, engine: d.ai.engine, competitorsGiven: d.ai.competitors, prompts: d.ai.results.map((r) => ({ prompt: r.prompt, mentioned: r.mentioned })) } : null;
  const geo = d.geo?.geo ? { score: d.geo.geo.score, failed: d.geo.geo.checks.filter((x) => !x.pass).map((x) => `${x.name}: ${x.detail}`), crawlers: d.geo.geo.crawlers.map((x) => `${x.agent}: ${x.status}`), structuredData: d.geo.geo.structuredData?.types } : null;
  const localHints = c ? c.pages.filter((p) => /store|locat|branch|find-us|stockist/i.test(p.url)).slice(0, 5).map((p) => p.url.replace(/^https?:\/\/[^/]+/, '')) : [];

  const cd = d.rank && d.rank.rows.length > 1 ? competitorData(d, domain) : null;
  const competitors = cd
    ? {
        sites: cd.rows.map((r) => ({ domain: r.domain, you: r.isSelf, trancoRank: r.trancoRank, radar: r.radarRank ? '#' + r.radarRank : r.radarBucket ? 'top ' + r.radarBucket : null, mobileSpeedScore: r.speed?.performance ?? null, realUserLcpMs: r.speed?.lcpMs ?? null, siteRead: r.site.available ? { pagesRead: r.site.pages, healthScore: r.site.healthScore, avgWords: r.site.avgWords, shareWithStructuredData: Math.round(r.site.withSchema * 100) + '%', shareMissingMetaDescription: Math.round(r.site.metaMissing * 100) + '%' } : 'not available: ' + r.site.why })),
        keywordsCheckedLive: cd.checked,
        searchResultSlots: cd.presence,
        keywordGap: cd.gap.slice(0, 25).map((g) => ({ keyword: g.keyword, competitor: g.competitor, theirPosition: g.theirPosition })),
        whereYouLead: cd.lead.slice(0, 10),
      }
    : null;
  return {
    domain,
    brand: d.ai?.brand || domain,
    date: new Date().toISOString().slice(0, 10),
    category: self?.radar?.categories?.join(', ') || null,
    popularity, psi, crawl, links, content, competitors, ideas: ideas.slice(0, 40), clusters, serp, aiVis, geo, localHints,
    registration: d.intel?.rdap ? { registrar: d.intel.rdap.registrar } : null,
    firstSeenInArchive: d.intel?.wayback?.firstSeen || null,
    technologies: (d.tech?.technology || []).map((t) => `${t.category}: ${t.name}`),
  };
}

const pick = (ev, keys) => Object.fromEntries(keys.map((k) => [k, ev[k]]));

export const SECTIONS = [
  { id: 'summary', title: 'Verdict and what to do first', keys: ['domain', 'brand', 'category', 'popularity', 'crawl', 'psi', 'geo', 'aiVis', 'serp'], task: 'Write the verdict: in two or three sentences, how healthy is this site for organic search, and what is the single biggest thing holding it back. Then the one to three recommendations most likely to grow useful organic traffic, each in the Problem / Change / Expected effect format. Lead with the biggest measured problem, not with praise.' },
  { id: 'technical', title: 'Technical SEO', keys: ['domain', 'crawl', 'psi'], task: 'Technical SEO findings. Group related issues, order them by how many pages they affect and how serious they are, and give the five that matter most. Separate problems that block or confuse search engines (errors, redirects, canonicals, indexing) from polish (titles, descriptions, alt text). For speed, say what the real-user figures show versus the lab simulation, and name the biggest fix. State clearly whether the crawl covered the whole site or a sample.' },
  { id: 'competitive', title: 'Competitors', keys: ['domain', 'brand', 'category', 'popularity', 'competitors', 'serp'], task: 'Compare this site with the competitors in the evidence on popularity rank, speed, site quality (health, structured data, missing metadata, content depth) and who holds the live search results (searchResultSlots). Say where it leads, where it trails, and what the gap probably means. Only use competitors that appear in the evidence. If a competitor shows "not available", say the comparison is not possible for that part. If there are no competitors in the evidence, write one sentence saying so. Finish with two or three things to learn from or counter in the strongest competitor.' },
  { id: 'keywords', title: 'Keywords and content opportunities', keys: ['domain', 'brand', 'serp', 'ideas', 'clusters', 'content', 'competitors'], task: 'Keyword and content opportunities. Use the live rank check, the keyword ideas and clusters, what the key pages are about, and competitors.keywordGap (keywords where a competitor is in the top 10 and the site is not). Identify (a) topics the site already has pages for but could strengthen, (b) topics from the ideas that no page appears to cover, (c) keywords where the site ranks or almost ranks. Map each suggested topic to an existing page path or to a new page. No search volumes are measured, so say demand has not been measured and never state a volume.' },
  { id: 'links', title: 'Links and site structure', keys: ['domain', 'links', 'crawl'], task: 'Links and site structure. Cover internal linking (which pages get the most links, broken or redirected internal links, orphan pages) and outbound links (broken ones). Be explicit that links from other sites to this one (backlinks) were not measured, and describe in two or three sentences what kinds of sites would be worth approaching given what the site sells.' },
  { id: 'ai', title: 'AI search visibility', keys: ['domain', 'brand', 'geo', 'aiVis', 'content'], task: 'Visibility in AI answers (ChatGPT, Gemini, Perplexity and similar). Report the AI-readiness checks that failed and what each means in plain words, how the AI crawlers are treated in robots.txt, and how often the brand was named when AI models were asked about it. Say plainly that the prompts used were generic if no competitors were supplied, so share of voice cannot be judged. Give the steps in order of effect.' },
  { id: 'local', title: 'Local search', keys: ['domain', 'brand', 'localHints', 'content', 'category'], task: 'Local search. Only if the evidence shows physical locations or a store locator (see localHints and schema types), say what Google Business Profile and local landing pages should cover. If there is no sign of a local presence in the evidence, write one short paragraph saying so and that this section does not apply. Never invent store counts or locations.' },
  { id: 'plan', title: '30 / 60 / 90 day plan', keys: ['domain', 'crawl', 'psi', 'geo', 'links', 'serp'], extra: 'priority', task: 'A 30, 60 and 90 day plan. Use the PRIORITY LIST in the evidence as the backbone. For each period list three to five actions; for each action give who would do it (developer, content, marketing), how much effort (small, medium, large) and what it fixes. Quick technical fixes first, content and structure next, larger programmes last. Do not add actions that are not supported by the evidence.' },
];

/** Write each section with the model; a failure is recorded, never fatal. */
export async function writeSections(ev, priority, { engine, model, concurrency = 3, onDone = () => {} } = {}) {
  const out = new Array(SECTIONS.length);
  let next = 0;
  const worker = async () => {
    while (next < SECTIONS.length) {
      const i = next++;
      const s = SECTIONS[i];
      const evidence = { ...pick(ev, s.keys), ...(s.extra === 'priority' ? { priorityList: priority } : {}) };
      try {
        const text = await complete(`TASK: ${s.task}\n\nEVIDENCE (JSON):\n${JSON.stringify(evidence)}`, { system: SYSTEM, engine, model, maxTokens: 1500, timeout: 240000 });
        out[i] = { id: s.id, title: s.title, text };
      } catch (err) {
        out[i] = { id: s.id, title: s.title, error: err.message };
      }
      onDone(out[i]);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// ---------- rendering ----------

const STYLE = `
:root{--bg:#fff;--text:#1b1f27;--dim:#5b6472;--line:#e3e6ec;--accent:#1f4fb4;--good:#17795a;--warn:#946200;--bad:#b73636;--panel:#f6f7f9}
@media (prefers-color-scheme: dark){:root{--bg:#12151b;--text:#e7eaf0;--dim:#9aa4b2;--line:#2a303b;--accent:#7fb0ff;--good:#4cc38a;--warn:#e9b949;--bad:#ef6b6b;--panel:#1a1e26}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:36px 22px 80px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:38px 0 10px;padding-top:6px;border-top:2px solid var(--line)}h3{font-size:15px;margin:18px 0 6px}
.sub{color:var(--dim);margin:0 0 20px}
.verdict{background:var(--panel);border-left:4px solid var(--accent);border-radius:6px;padding:4px 18px 8px;margin:18px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin:10px 0}th,td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--dim);font-size:12px}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:10px 0}.kpi{background:var(--panel);border-radius:8px;padding:10px 12px}.kpi b{display:block;font-size:20px}.kpi span{color:var(--dim);font-size:12px}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.dim{color:var(--dim)}
.pill{display:inline-block;padding:0 8px;border-radius:99px;font-size:11.5px;border:1px solid currentColor}
.note{color:var(--dim);font-size:12.5px;border-left:3px solid var(--line);padding-left:10px;margin:10px 0}
ul{margin:6px 0 6px 20px;padding:0}li{margin:3px 0}p{margin:8px 0}
a{color:var(--accent)}
${CHART_CSS}
.vis{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin:14px 0}.vis .box{background:var(--panel);border-radius:10px;padding:12px 14px}.vis h4{margin:0 0 8px;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--dim)}.rings{display:flex;gap:12px;flex-wrap:wrap}
@media print{.wrap{padding:0}h2{page-break-after:avoid}table,.verdict{page-break-inside:avoid}}
`;

function prose(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  let html = '';
  let list = false;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) html += '<ul>';
      list = true;
      html += `<li>${inline(item[1])}</li>`;
      continue;
    }
    if (list) html += '</ul>';
    list = false;
    if (!line) continue;
    const head = line.match(/^#{1,4}\s*(.*)$/);
    html += head ? `<h3>${inline(head[1])}</h3>` : /^\*\*[^*]+\*\*:?$/.test(line) ? `<h3>${inline(line.replace(/:$/, ''))}</h3>` : `<p>${inline(line)}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

const sevClass = (s) => (s === 'error' ? 'bad' : s === 'warning' ? 'warn' : 'dim');

/** @returns {{html:string, md:string}} */
export function renderReport(ev, d, sections, priority, meta) {
  const title = `SEO report — ${new Date(ev.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const k = (label, value, sub) => `<div class="kpi"><span>${esc(label)}</span><b>${value}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  const c = ev.crawl;
  const pop = ev.popularity;
  const live = (ev.serp || []).filter((r) => r.position !== undefined);
  const kpis = [
    pop?.trancoRank ? k('Popularity rank', '#' + num(pop.trancoRank), pop.cloudflareRadar ? (pop.cloudflareRadar.rank ? `Radar #${num(pop.cloudflareRadar.rank)}` : `Radar: top ${num(pop.cloudflareRadar.bucket)}`) : 'Tranco list') : '',
    c?.pagesCrawled ? k('Site health', `${c.healthScore}%`, `${num(c.pagesCrawled)} pages${c.wholeSiteCrawled ? '' : ' (sample)'}`) : k('Site health', '—', c?.blocked ? 'site blocked the crawl' : ''),
    ev.psi ? k('Mobile speed score', String(ev.psi.mobile?.performance ?? '—'), `SEO ${ev.psi.mobile?.seo ?? '—'}`) : '',
    ev.geo ? k('AI-readiness', `${ev.geo.score}/100`) : '',
    ev.aiVis ? k('Named in AI answers', pct(ev.aiVis.mentionRate, 0), `${ev.aiVis.answered} questions`) : '',
    live.length ? k('Top-10 keywords', `${live.filter((r) => r.foundInTop10).length}/${live.length}`, 'live check') : '',
  ].join('');
  const rankSeries = (d.rank?.rows?.[0]?.tranco?.history || []).slice().reverse().map((x) => ({ label: String(x.date).slice(5), value: x.rank }));
  const sev = c?.pagesCrawled ? stack([{ label: 'Errors', value: c.errors, color: 'var(--bad)' }, { label: 'Warnings', value: c.warnings, color: 'var(--warn)' }, { label: 'Notices', value: c.notices, color: '#8a94a6' }]) + '<div style="height:8px"></div>' + hbars((c.topIssues || []).slice(0, 5).map((i) => ({ label: i.issue, value: i.pages, text: num(i.pages) + ' pages', color: i.severity === 'error' ? 'var(--bad)' : i.severity === 'warning' ? 'var(--warn)' : '#8a94a6' }))) : '';
  const sites = ev.competitors?.sites || [];
  const compBars = (pick, fmt) => {
    const items = sites.map((x, k) => ({ x, k, v: pick(x) })).filter((y) => typeof y.v === 'number');
    return items.length > 1 ? hbars(items.map((y) => ({ label: y.x.domain, value: y.v, color: y.x.you ? 'var(--accent)' : PALETTE[(y.k + 1) % 8] })), { fmt }) : '';
  };
  const box = (t, body) => (body ? '<div class="box"><h4>' + esc(t) + '</h4>' + body + '</div>' : '');
  const visuals = '<div class="vis">' + [
    box('Popularity rank, 30 days (lower is better)', rankSeries.length > 1 ? area(rankSeries, { fmt: compact, h: 150 }) : ''),
    box('Site audit', sev),
    box('Speed (mobile)', ev.psi?.mobile ? '<div class="rings">' + ring(ev.psi.mobile.performance, 'Speed') + ring(ev.psi.mobile.accessibility, 'A11y') + ring(ev.psi.mobile['best-practices'], 'Practice') + ring(ev.psi.mobile.seo, 'SEO') + '</div>' : ''),
    box('Top phrases on the site', ev.content ? hbars(ev.content.topPhrases.slice(0, 8).map((t, i) => ({ label: t.term, value: t.count, color: PALETTE[i % 8] }))) : ''),
    box('Competitors: mobile speed', compBars((x) => x.mobileSpeedScore, String)),
    box('Competitors: site health', compBars((x) => x.siteRead?.healthScore, (n) => n + '%')),
  ].join('') + '</div>';
  const prio = priority.length ? `<table><thead><tr><th>Priority</th><th>Fix</th><th>Why / how</th></tr></thead><tbody>${priority.map((p) => `<tr><td><span class="pill ${sevClass(p.severity)}">${esc(p.severity)}</span></td><td><b>${esc(p.title)}</b></td><td class="dim">${esc(trim(p.why, 160))}</td></tr>`).join('')}</tbody></table>` : '<p>No issues were flagged in the data collected.</p>';
  const sum = sections.find((s) => s.id === 'summary');
  const summaryHtml = sum ? `<div class="verdict">${sum.text ? prose(sum.text) : `<p class="dim">Not written: ${esc(sum.error || 'model unavailable')}.</p>`}</div>` : '';
  const restHtml = sections
    .filter((s) => s.id !== 'summary')
    .map((s) => `<h2>${esc(s.title)}</h2>${s.text ? prose(s.text) : `<p class="note">This section could not be written: ${esc(s.error || 'model unavailable')}. The data tables still apply.</p>`}`)
    .join('\n');
  const issues = c?.topIssues ? `<h2>Appendix A: every issue found</h2><table><thead><tr><th>Severity</th><th>Issue</th><th class="r">Pages</th><th>Examples</th></tr></thead><tbody>${(d.crawl.issues || []).map((i) => `<tr><td><span class="pill ${sevClass(i.severity)}">${esc(i.severity)}</span></td><td>${esc(i.title)}<div class="dim">${esc(i.fix)}</div></td><td class="r">${num(i.count)}</td><td class="dim">${esc(i.urls.slice(0, 2).map((u) => u.replace(/^https?:\/\/(www\.)?/, '')).join(' · '))}</td></tr>`).join('')}</tbody></table>` : '';
  const comp = sites.length > 1 ? `<h2>Appendix B: competitor comparison</h2><table><thead><tr><th>Site</th><th class="r">Tranco rank</th><th class="r">Mobile speed</th><th class="r">Site health</th><th class="r">Structured data</th><th class="r">No meta description</th></tr></thead><tbody>${sites.map((r) => `<tr><td>${esc(r.domain)}${r.you ? ' (you)' : ''}</td><td class="r">${r.trancoRank ? '#' + num(r.trancoRank) : '—'}</td><td class="r">${r.mobileSpeedScore ?? '—'}</td>${typeof r.siteRead === 'object' ? `<td class="r">${r.siteRead.healthScore}%</td><td class="r">${r.siteRead.shareWithStructuredData}</td><td class="r">${r.siteRead.shareMissingMetaDescription}</td>` : `<td colspan="3" class="dim">${esc(r.siteRead)}</td>`}</tr>`).join('')}</tbody></table>` : '';
  const checks = d.crawl?.siteChecks ? `<h2>Appendix C: technical checks</h2><table><tbody>${d.crawl.siteChecks.map((x) => `<tr><td>${esc(x.title)}</td><td class="${x.pass ? 'good' : 'bad'}">${x.pass ? 'pass' : 'FAIL'}</td><td class="dim">${esc(x.detail)}</td></tr>`).join('')}</tbody></table>` : '';
  const not = [
    'Links from other sites to this one (backlinks) and the sites worth approaching for them: these need a backlink index that this tool does not have.',
    'Visit counts, channel mix, audience and each competitor\'s ranked keyword list: these come from panel or index data, not from public measurement.',
    'Search volumes and keyword difficulty: not measured.',
    ...(c?.blocked ? [`The crawl of ${ev.domain}: ${c.reason}.`] : []),
    ...(c && !c.wholeSiteCrawled && c.pagesCrawled ? [`Pages beyond the ${num(c.pagesCrawled)} crawled${c.sitemapUrls ? ` (the sitemap lists ${num(c.sitemapUrls)})` : ''}.`] : []),
  ];
  const made = `<h2 id="how-this-report-was-made">How this report was made</h2>
<p>Generated by super_seo (<code>sm full</code>) on ${esc(ev.date)}. Numbers and tables come from measurements: the tool's own crawler${meta.parser ? ` (parser: ${esc(meta.parser)})` : ''}, Google PageSpeed Insights, the Tranco list and Cloudflare Radar, live search results, the Internet Archive, and AI-model answers. The prose in each section was written by ${esc(meta.engine || 'a language model')} from only that section's evidence; models can miscalculate, so check any figure that is not also in a table or appendix.</p>
<p class="note"><b>Not covered:</b></p><ul>${not.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ev.domain)} — ${esc(title)}</title><style>${STYLE}</style></head><body><div class="wrap">
<h1>${esc(ev.domain)} — ${esc(title)}</h1><p class="sub">${esc(ev.brand)}${ev.category ? ' · ' + esc(ev.category) : ''}</p>
${summaryHtml}
<div class="kpis">${kpis}</div>
${visuals}
<h2>Fix these first</h2>${prio}
${restHtml}
${issues}${comp}${checks}
${made}
</div></body></html>`;

  const md = [
    `# ${ev.domain} — ${title}`,
    '',
    ...sections.filter((s) => s.id === 'summary').map((s) => `## ${s.title}\n\n${s.text || `_Not written: ${s.error}_`}\n`),
    '## Fix these first',
    '',
    ...priority.map((p) => `- **${p.severity.toUpperCase()}** ${p.title} — ${trim(p.why, 160)}`),
    '',
    ...sections.filter((s) => s.id !== 'summary').map((s) => `## ${s.title}\n\n${s.text || `_This section could not be written: ${s.error}_`}\n`),
    '## How this report was made',
    '',
    `Generated by super_seo (sm full) on ${ev.date}. Prose written by ${meta.engine || 'a language model'} from per-section evidence; verify derived figures against the appendices and the raw JSON.`,
    '',
    '### Not covered',
    ...not.map((x) => `- ${x}`),
    '',
  ].join('\n');
  return { html, md };
}

export { loadScan, actions };
