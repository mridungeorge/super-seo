// Model-driven features (strategy, content, PR, ads, trends, local, sales prep). The model is
// handed only facts we measured and told to use nothing else; each answer is labelled with the
// engine and the evidence it was given, so a reader can check it against the data.

import { crawlSite } from './crawl.js';
import { geoCheck } from './geo.js';
import { rdap, wayback, wikiPageviews } from '../sources/open.js';
import { trancoRank, medianRank } from '../sources/tranco.js';
import { radarToken, radarRank } from '../sources/radar.js';
import { loadModel, estimateVisits } from './estimate.js';
import { detectTech } from '../core/techdetect.js';
import { complete } from '../core/llm.js';

const SYSTEM =
  'You are a senior digital-marketing analyst. Use ONLY the evidence block you are given. ' +
  'If the evidence does not support a claim, say "not in the evidence" instead of guessing. ' +
  'Never invent numbers, competitors, prices or contact details. Be specific and concise; ' +
  'cite which evidence field each recommendation rests on.';

export const KINDS = {
  marketing: 'Marketing strategy: positioning drawn from what the site says about itself, 3 priorities supported by the audit, popularity and AI-readiness evidence, 3 quick wins, 3 risks.',
  content: 'Content strategist: 8 content topics ranked by opportunity, each tied to a phrase, page or gap in the evidence, with format and search intent.',
  geo: 'GEO/AEO plan: ordered changes to get cited by AI answer engines, based on the readiness checks that failed and the entity markup present.',
  trends: 'Trend analysis: what the popularity-rank history and interest trend say about momentum, and what to watch next quarter.',
  ads: 'Advertising: 5 ad angles based on what the site demonstrably sells (titles, phrases), what to test first, and what the evidence cannot tell you about spend or audience.',
  pr: 'Digital PR: 6 story angles and the types of publications to pitch, based on what the brand is demonstrably known for in the evidence.',
  local: 'Local search visibility: what a local-pack and Maps strategy should cover for this business, noting what the evidence cannot show.',
  prep: 'Sales meeting prep: a one-page brief (who they are, how visible they are, tech stack, likely priorities, 5 discovery questions).',
  outreach: 'Outreach draft: a short cold email (under 120 words) and a LinkedIn note, referencing only evidenced facts. No invented personalisation.',
  score: 'Lead scoring: a 0-100 fit score with a transparent rubric (popularity scale, site quality, tech fit, reachability), showing points per criterion.',
};

export async function buildEvidence(http, domain, { home } = {}) {
  const [reg, arch, geo, t, crawl, homeRes] = await Promise.all([
    rdap(domain).catch(() => null),
    wayback(domain).catch(() => null),
    geoCheck(http, domain).catch(() => null),
    trancoRank(http, domain).catch(() => null),
    crawlSite(domain, { maxPages: 40, concurrency: 3, checkExternal: false }).catch(() => null),
    http.get(`https://${domain}/`).catch(() => null),
  ]);
  const rank = t ? medianRank(t) : null;
  const model = home ? loadModel(home) : null;
  const token = radarToken();
  const radar = token ? await radarRank(domain, token).catch(() => null) : null;
  const wiki = await wikiPageviews(domain.split('.')[0], { months: 24 }).catch(() => null);
  const c = crawl && !crawl.blocked ? crawl : null;
  return {
    domain,
    popularity: {
      trancoRank: rank,
      trancoHistory: t ? t.history.slice(0, 14).map((x) => ({ date: x.date, rank: x.rank })) : null,
      cloudflareRadar: radar ? { rank: radar.rank, bucket: radar.bucket, categories: radar.categories } : null,
      estimatedMonthlyVisits: model && rank ? { ...estimateVisits(model, rank), note: 'rough estimate from rank, not measured' } : null,
    },
    site: c
      ? {
          pagesCrawled: c.summary.pages,
          healthScore: c.summary.healthScore,
          errors: c.summary.errors,
          warnings: c.summary.warnings,
          topIssues: c.issues.slice(0, 8).map((i) => ({ issue: i.title, pages: i.count })),
          topPhrases: c.content.phrases.slice(0, 15),
          schemaTypes: c.content.schemaTypes,
          keyPages: c.pages.filter((p) => p.status === 200 && p.indexable).sort((a, b) => b.inlinks - a.inlinks).slice(0, 12).map((p) => ({ title: p.title, h1: p.h1, words: p.words })),
        }
      : 'site could not be crawled',
    technologies: homeRes && homeRes.status === 200 ? detectTech(homeRes.headers || {}, homeRes.text()).map((x) => `${x.category}: ${x.name}`) : null,
    registration: reg ? { registered: reg.registered?.slice(0, 10), registrar: reg.registrar } : null,
    archive: arch ? { firstSeen: arch.firstSeen } : null,
    interestTrend: wiki ? wiki.slice(-12) : null,
    geoReadiness: geo ? { score: geo.score, failed: geo.checks.filter((x) => !x.pass).map((x) => `${x.name}: ${x.detail}`.trim()), structuredData: geo.structuredData.types } : null,
  };
}

export async function advise(kind, evidence, { engine, model } = {}) {
  if (!KINDS[kind]) throw new Error(`unknown kind "${kind}". Available: ${Object.keys(KINDS).join(', ')}`);
  const prompt = `TASK: ${KINDS[kind]}\n\nEVIDENCE (JSON):\n${JSON.stringify(evidence)}\n\nWrite the answer in plain text with short headed sections.`;
  const text = await complete(prompt, { system: SYSTEM, engine, model, maxTokens: 1600 });
  return { kind, engine: engine || 'default', text };
}
