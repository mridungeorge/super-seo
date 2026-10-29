// `sm keywords <seed>` — keyword expansion, intent and clustering.

import { expandKeywords, clusterKeywords } from '../collect/keywords.js';
import { renderTable, makeColors, colorize } from '../core/table.js';

export async function run(ctx) {
  const seed = (ctx.args._[0] || '').trim();
  if (!seed) {
    console.error('usage: sm keywords <seed> [--expand] [--cluster] [--alphabet]');
    process.exitCode = 1;
    return;
  }
  const colors = makeColors(ctx.colors);
  const res = await expandKeywords(seed, {
    alphabet: !!ctx.args.alphabet,
    prefixes: ctx.args.prefixes !== false,
  });
  const clusters = clusterKeywords(res.keywords);

  if (ctx.args.json) {
    console.log(JSON.stringify({ ...res, clusters }, null, 2));
    return;
  }

  console.log(colorize(`KEYWORDS — ${seed}`, 'bold', colors));
  console.log(colorize(`${res.count} term(s) from public autocomplete sources`, 'dim', colors));
  console.log();
  console.log(
    renderTable(
      [
        ['keyword', 'intent', 'sources', 'suggestion depth'],
        ...res.keywords.slice(0, Number(ctx.args.limit || 60)).map((k) => [k.keyword, k.intent, String(k.sourceCount), String(k.suggestionDepth)]),
      ],
      { align: ['l', 'l', 'r', 'r'], colors, title: 'TERMS' },
    ),
  );
  console.log();
  console.log(
    renderTable(
      [
        ['cluster', 'size', 'intents', 'terms'],
        ...clusters.slice(0, Number(ctx.args.clusters || 20)).map((c) => [c.cluster, String(c.size), c.intents.join(', '), c.terms.slice(0, 4).join(' · ')]),
      ],
      { align: ['l', 'r', 'l', 'l'], colors, title: 'CLUSTERS' },
    ),
  );
  console.log();
  console.log(
    colorize(
      'note: no public keyword index is reachable, so volume is not shown — "sources" and "suggestion depth" are the honest proxy for demand signal.',
      'dim',
      colors,
    ),
  );
  for (const n of res.notes) console.log(colorize('note: ' + n, 'dim', colors));
}
