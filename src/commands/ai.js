// `sm ai <brand>` — AI-answer brand visibility, measured by us.

import fs from 'node:fs';
import { probeAiVisibility, buildPrompts } from '../collect/prompts.js';
import { defaultEngine } from '../core/llm.js';
import { renderTable, makeColors, colorize, fmtPct, fmtNum } from '../core/table.js';

export async function run(ctx) {
  const brand = (ctx.args._[0] || '').trim();
  if (!brand) {
    console.error('usage: sm ai <brand> [--competitors a.com,b.com] [--prompts-file f] [--engine nvidia|anthropic|claude-cli]');
    process.exitCode = 1;
    return;
  }
  const competitors = String(ctx.args.competitors || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const colors = makeColors(ctx.colors);

  let templates = null;
  if (ctx.args.promptsFile) {
    templates = fs
      .readFileSync(ctx.args.promptsFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  const prompts = buildPrompts(brand, { competitors, templates, count: Number(ctx.args.prompts || 5) });
  const engine = ctx.args.engine || defaultEngine();

  const res = await probeAiVisibility({
    brand,
    competitors,
    prompts,
    engine,
    model: ctx.args.model || null,
    onProgress: (i, total) => {
      if (!ctx.args.json) process.stderr.write(`\rprobing ${i}/${total}…`);
    },
  });
  if (!ctx.args.json) process.stderr.write('\r');

  if (ctx.args.json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.log(colorize(`AI VISIBILITY — ${brand}`, 'bold', colors));
  console.log(colorize(`engine ${engine} · ${res.answered}/${res.prompts} answered · ${res.measuredAt}`, 'dim', colors));
  console.log();
  console.log(
    renderTable(
      [
        ['metric', 'value'],
        ['mention rate', fmtPct(res.mentionRate)],
        ['share of voice', fmtPct(res.shareOfVoice)],
        ['avg first-mention offset (chars)', res.avgPosition == null ? '-' : fmtNum(res.avgPosition, 0)],
        ['sentiment', `positive ${res.sentiments.positive} · neutral ${res.sentiments.neutral} · negative ${res.sentiments.negative}`],
      ],
      { align: ['left', 'left'], colors },
    ),
  );
  console.log();
  console.log(colorize('MENTIONS BY BRAND', 'bold', colors));
  console.log(
    renderTable(
      [['brand', 'prompts mentioning', 'share']].concat(
        Object.entries(res.mentions)
          .sort((a, b) => b[1] - a[1])
          .map(([b, n]) => [b, String(n), fmtPct(n / (res.prompts || 1))]),
      ),
      { align: ['left', 'right', 'right'], colors },
    ),
  );
  console.log();
  console.log(colorize('PER-PROMPT', 'bold', colors));
  console.log(
    renderTable(
      [
        ['#', 'prompt', 'mentioned', 'rank', 'sentiment', 'co-mentions'],
        ...res.results.map((r) => [
          String(r.id),
          r.prompt.slice(0, 70),
          r.error ? 'error' : r.mentioned ? 'yes' : 'no',
          r.rank ? String(r.rank) : '-',
          r.sentiment || '-',
          (r.coMentions || []).join(', ') || '-',
        ]),
      ],
      { align: ['r', 'l', 'l', 'r', 'l', 'l'], colors },
    ),
  );
  console.log();
  console.log(colorize('note: measured by our own probe on one model, one day — not a published benchmark.', 'dim', colors));
}
