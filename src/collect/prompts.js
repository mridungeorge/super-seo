// AI-answer probing: ask a model a set of buying-style questions and measure how (and where)
// the brand and its competitors come up.
//
// Two engines:
//   claude-cli  — `claude -p "<prompt>"`, which uses the operator's own Claude subscription
//   anthropic   — the Messages API, when ANTHROPIC_API_KEY is present
//
// Nothing here pretends to be an industry benchmark: it is our own measurement of one model on one
// day, and the report says so.

import { complete } from '../core/llm.js';

const DEFAULT_TEMPLATE = (brand) => [
  `Which ${brand} alternatives should a mid-market company consider? List them.`,
  `Is ${brand} a good choice for a growing startup? Answer briefly and say why.`,
  `Compare ${brand} with its main competitors for a small team.`,
  `What are the main strengths and weaknesses of ${brand}?`,
  `Who is ${brand} best suited for, and when should a company pick something else?`,
];

const POSITIVE = ['best', 'leading', 'popular', 'recommend', 'excellent', 'great', 'powerful', 'flexible', 'affordable', 'reliable', 'trusted', 'strong'];
const NEGATIVE = ['limited', 'outdated', 'expensive', 'clunky', 'lacking', 'weak', 'difficult', 'confusing', 'poor', 'problematic', 'missing', 'legacy'];

/** A name as it appears in prose: "paypal.com" is written "PayPal", so match the label without its TLD too. */
export function aliases(name) {
  const out = new Set([name.toLowerCase()]);
  const m = /^(?:www.)?([a-z0-9-]+).[a-z.]{2,}$/i.exec(name.trim());
  if (m) out.add(m[1].toLowerCase());
  return [...out];
}

/** {idx, count} of a name (any alias, whole-word) in lower-cased text. */
export function findName(lower, name) {
  let idx = -1;
  let count = 0;
  for (const a of aliases(name)) {
    const re = new RegExp(`(?<![a-z0-9])${a.replace(/[.*+?^${}()|[]\]/g, '\export function buildPrompts(')}(?![a-z0-9])`, 'g');
    for (const m of lower.matchAll(re)) {
      count++;
      if (idx < 0 || m.index < idx) idx = m.index;
    }
  }
  return { idx, count };
}

export function buildPrompts(brand, { competitors = [], category = '', templates = null, count = 5 } = {}) {
  const list = templates ? templates.slice() : DEFAULT_TEMPLATE(brand).slice(0, count);
  if (category) {
    list.unshift(`What are the best ${category} solutions for a small business? Name the leading options.`);
  }
  for (const c of competitors) {
    list.push(`${brand} vs ${c} — which one should a growing company choose, and why?`);
  }
  return list.map((p, i) => ({ id: i + 1, prompt: p }));
}

/** Ask one engine a single question. Returns the answer text. */
export async function ask(engine, prompt, { model = null, timeout = 120000 } = {}) {
  return complete(prompt, { engine, model, timeout, maxTokens: 700 });
}

/** Score one answer for a brand and its competitors. */
export function scoreAnswer(answer, brand, competitors) {
  const text = String(answer || '');
  const lower = text.toLowerCase();
  const names = [brand, ...competitors].map((b) => ({ name: b, key: b.toLowerCase() }));
  const mentions = [];
  for (const n of names) {
    const { idx, count } = findName(lower, n.name);
    mentions.push({
      name: n.name,
      mentioned: idx >= 0,
      position: idx >= 0 ? idx : null,
      rank: idx >= 0 ? lower.slice(0, idx).split(/[,\n.()]/).filter((s) => s.trim()).length : null,
      count,
    });
  }
  mentions.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  const brandMention = mentions.find((m) => m.name === brand);
  const first = mentions.find((m) => m.mentioned);
  return {
    mentioned: !!brandMention?.mentioned,
    mentions,
    position: brandMention?.position ?? null,
    rank: first ? mentions.filter((m) => m.mentioned).findIndex((m) => m.name === first.name) + 1 : null,
    firstMentioned: first?.name ?? null,
    coMentions: mentions.filter((m) => m.mentioned && m.name !== brand).map((m) => m.name),
    sentiment: sentimentOf(text, brand),
    length: text.length,
    excerpt: text.slice(0, 280),
  };
}

function sentimentOf(text, brand) {
  const lower = text.toLowerCase();
  const idx = findName(lower, brand).idx;
  const window = idx >= 0 ? text.slice(Math.max(0, idx - 200), idx + 300).toLowerCase() : text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE) if (window.includes(w)) pos++;
  for (const w of NEGATIVE) if (window.includes(w)) neg++;
  const label = pos === neg ? 'neutral' : pos > neg ? 'positive' : 'negative';
  return { label, positive: pos, negative: neg };
}

/**
 * Run the whole probe: every prompt, every engine, aggregated.
 */
export async function probeAiVisibility({ brand, competitors = [], prompts, engine = 'claude-cli', model = null, onProgress = null }) {
  const results = [];
  for (const p of prompts) {
    let answer = '';
    let error = null;
    try {
      answer = await ask(engine, p.prompt, { model });
    } catch (err) {
      error = err.message;
    }
    const score = error ? null : scoreAnswer(answer, brand, competitors);
    results.push({ ...p, answer, error, score });
    if (onProgress) onProgress(results.length, prompts.length, p);
  }
  return aggregate(results, brand, competitors, engine);
}

function aggregate(results, brand, competitors, engine) {
  const ok = results.filter((r) => r.score);
  const total = results.length;
  const brandMentions = ok.filter((r) => r.score.mentioned).length;
  const allMentions = {};
  for (const r of ok) {
    for (const m of [brand, ...competitors]) {
      const s = r.score.mentions || r.score.coMentions;
      const hit = findName(r.answer.toLowerCase(), m).idx >= 0;
      if (hit) allMentions[m] = (allMentions[m] || 0) + 1;
    }
  }
  const totalMentions = Object.values(allMentions).reduce((a, b) => a + b, 0) || 1;
  const coMatrix = {};
  for (const c of competitors) {
    coMatrix[c] = competitors.concat([brand]).filter((other) => other !== c).filter((other) => {
      const r = ok.find((x) => findName(x.answer.toLowerCase(), c).idx >= 0 && findName(x.answer.toLowerCase(), other).idx >= 0);
      return !!r;
    });
  }
  const sentiments = { positive: 0, negative: 0, neutral: 0 };
  for (const r of ok) sentiments[r.score.sentiment.label]++;
  const positions = ok.filter((r) => r.score.position != null).map((r) => r.score.position);

  return {
    brand,
    competitors,
    engine,
    measuredAt: new Date().toISOString(),
    prompts: total,
    answered: ok.length,
    mentionRate: ok.length ? brandMentions / ok.length : 0,
    shareOfVoice: (allMentions[brand] || 0) / totalMentions,
    mentions: allMentions,
    avgPosition: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
    sentiments,
    coMentions: coMatrix,
    results: results.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      error: r.error,
      mentioned: r.score?.mentioned ?? null,
      rank: r.score?.rank ?? null,
      coMentions: r.score?.coMentions ?? [],
      sentiment: r.score?.sentiment?.label ?? null,
      excerpt: r.score?.excerpt ?? null,
    })),
  };
}
