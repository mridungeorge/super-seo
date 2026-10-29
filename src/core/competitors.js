// Competitor comparison built from a scan folder: popularity ranks, a small crawl of each competitor
// (when they allow it), PageSpeed scores, and who holds the live search results for the keywords we
// checked. Pure functions over the loaded scan; nothing here fetches.

const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

/** Page-level statistics from a crawl result, or a reason it is not available. */
export function siteStats(crawl) {
  if (!crawl) return { available: false, why: 'not crawled' };
  if (crawl.blocked) return { available: false, why: 'blocked our crawler' };
  const ok = (crawl.pages || []).filter((p) => p.status === 200 && p.indexable);
  if (!ok.length) return { available: false, why: 'no pages read' };
  const share = (f) => ok.filter(f).length / ok.length;
  const avg = (f) => ok.reduce((n, p) => n + (f(p) || 0), 0) / ok.length;
  return {
    available: true,
    pages: crawl.summary.pages,
    healthScore: crawl.summary.healthScore,
    avgWords: Math.round(avg((p) => p.words)),
    avgTitleLength: Math.round(avg((p) => p.title.length)),
    metaMissing: share((p) => !p.description),
    withSchema: share((p) => (p.schemaTypes || []).length > 0),
    thin: share((p) => p.words < 200),
    avgResponseMs: Math.round(avg((p) => p.ttfb)),
    schemaTypes: [...new Set(ok.flatMap((p) => p.schemaTypes || []))].slice(0, 8),
  };
}

const matches = (domain, dom) => bare(domain) === dom || bare(domain).endsWith('.' + dom);

/**
 * @param d the loaded scan folder (see loadScan)
 * @param domain the site being scanned
 * @returns {{self: string, rows: object[], gap: object[], presence: object[], checked: number}}
 */
export function competitorData(d, domain) {
  const ranked = d.rank?.rows || [];
  const self = ranked[0]?.domain || domain;
  const rows = ranked.map((r, i) => {
    const crawl = i === 0 ? d.crawl : d[`competitor-${i}-crawl`];
    const psi = i === 0 ? d.psi : d[`competitor-${i}-psi`];
    return {
      domain: r.domain,
      isSelf: i === 0,
      trancoRank: r.tranco?.rank ?? null,
      radarRank: r.radar?.rank ?? null,
      radarBucket: r.radar?.bucket ?? null,
      speed: psi?.scores ? { performance: psi.scores.performance, seo: psi.scores.seo, lcpMs: psi.field?.lcp?.p75 ?? psi.originField?.lcp?.p75 ?? null } : null,
      site: siteStats(crawl),
    };
  });

  // Who holds the top 10 for the keywords we checked live.
  const results = (d.serp?.results || []).filter((r) => !r.error);
  const doms = rows.map((r) => bare(r.domain));
  const presence = doms.map((dom) => ({
    domain: dom,
    slots: results.reduce((n, r) => n + (r.results || []).filter((x) => matches(x.domain, dom)).length, 0),
    keywordsInTop10: results.filter((r) => (r.results || []).some((x) => matches(x.domain, dom))).length,
  }));

  // Keyword gap: checked keywords where a competitor is in the top 10 and you are not.
  const gap = [];
  for (const r of results) {
    const top = (r.results || []).map((x, i) => ({ domain: bare(x.domain), position: i + 1 }));
    const theirs = rows.filter((x) => !x.isSelf).map((x) => ({ domain: x.domain, hit: top.find((t) => matches(t.domain, bare(x.domain))) })).filter((x) => x.hit);
    if (!theirs.length || r.found) continue;
    for (const t of theirs) gap.push({ keyword: r.keyword, competitor: t.domain, theirPosition: t.hit.position, yourPosition: null });
  }
  // And the reverse: where you lead.
  const lead = results.filter((r) => r.found && rows.filter((x) => !x.isSelf).every((x) => !(r.results || []).slice(0, r.position - 1).some((t) => matches(t.domain, bare(x.domain))))).map((r) => ({ keyword: r.keyword, yourPosition: r.position }));
  return { self, rows, gap, lead, presence, checked: results.length };
}
