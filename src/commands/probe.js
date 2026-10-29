// `sm probe <url>` — our own web-vitals + technology-stack measurement.

import { probeSite } from '../sources/own.js';
import { renderTable, makeColors, colorize, fmtNum, fmtBytes } from '../core/table.js';

const RATING_COLOR = { good: 'green', 'needs-improvement': 'yellow', poor: 'red', unknown: 'gray', 'no-interaction': 'gray' };

export async function run(ctx) {
  const target = (ctx.args._[0] || ctx.args.url || '').trim();
  if (!target) {
    console.error('usage: sm probe <url> [--runs 3]');
    process.exitCode = 1;
    return;
  }
  const runs = Number(ctx.args.runs || 1);
  const colors = makeColors(ctx.colors);

  const res = await probeSite(target, { runs, verbose: ctx.verbose });

  if (ctx.args.json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.log(colorize(`WEB VITALS — ${res.url}`, 'bold', colors));
  console.log(colorize(`measured ${res.measuredAt} over ${res.runs} run(s)`, 'dim', colors));
  console.log();
  const v = res.vitals;
  const rows = [
    ['metric', 'value', 'rating', 'offending element'],
    ['LCP', v.lcp == null ? '-' : fmtNum(v.lcp, 0) + ' ms', res.ratings.lcp, v.lcpSelector || '-'],
    ['CLS', v.cls == null ? '-' : v.cls.toFixed(4), res.ratings.cls, (v.clsEntries || []).map((c) => c.selector).filter(Boolean)[0] || '-'],
    ['INP', v.inp == null ? '-' : fmtNum(v.inp, 0) + ' ms', res.ratings.inp, v.inpSelector || '-'],
    ['FCP', v.fcp == null ? '-' : fmtNum(v.fcp, 0) + ' ms', res.ratings.fcp, '-'],
    ['TTFB', v.ttfb == null ? '-' : fmtNum(v.ttfb, 0) + ' ms', res.ratings.ttfb, '-'],
    ['DOMContentLoaded', v.domContentLoaded == null ? '-' : fmtNum(v.domContentLoaded, 0) + ' ms', '-', '-'],
    ['Load', v.load == null ? '-' : fmtNum(v.load, 0) + ' ms', '-', '-'],
    ['Long tasks', String((v.longTasks || []).length), '-', (v.longTasks || []).map((t) => fmtNum(t.value, 0) + 'ms').slice(0, 3).join(', ')],
  ];
  console.log(
    renderTable(
      rows.map((r) => [r[0], r[1], colorize(r[2], RATING_COLOR[r[2]] || 'gray', colors), r[3]]),
      { align: ['left', 'right', 'left', 'left'], colors },
    ),
  );
  console.log();

  const p = res.page || {};
  console.log(colorize('PAGE', 'bold', colors));
  console.log(
    renderTable(
      [
        ['field', 'value'],
        ['title', p.title || '-'],
        ['canonical', p.canonical || '-'],
        ['meta description', (p.metaDescription || '-').slice(0, 120)],
        ['h1', (p.h1 || []).join(' | ') || '-'],
        ['lang', p.lang || '-'],
        ['viewport', p.viewport ? 'yes' : 'no'],
        ['images / missing alt', `${p.images ?? '-'} / ${p.imagesWithoutAlt ?? '-'}`],
        ['links / scripts / forms', `${p.links ?? '-'} / ${p.scripts ?? '-'} / ${p.forms ?? '-'}`],
        ['json-ld blocks', String((p.jsonLd || []).length)],
        ['hreflang pairs', String((p.hreflang || []).length)],
        ['transfer size', p.transferSize == null ? '-' : fmtBytes(p.transferSize)],
        ['resources loaded', String(p.resources ?? '-')],
      ],
      { align: ['left', 'left'], colors },
    ),
  );
  console.log();

  console.log(colorize('TECHNOLOGY', 'bold', colors));
  console.log(
    renderTable(
      [
        ['technology', 'category', 'version', 'detected by'],
        ...res.tech.map((t) => [t.name, t.category, t.version || '-', t.detectedBy.join(', ')]),
      ],
      { align: ['left', 'left', 'left', 'left'], colors },
    ),
  );
}
