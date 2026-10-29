// `sm history <domain>` — what we recorded over time.

import { openDb, metricHistory, snapshots } from '../core/store.js';
import { renderTable, makeColors, colorize, fmtNum, sparkline } from '../core/table.js';

export async function run(ctx) {
  const domain = (ctx.args._[0] || '').trim().toLowerCase();
  if (!domain) {
    console.error('usage: sm history <domain> [--field health] [--months 12]');
    process.exitCode = 1;
    return;
  }
  const colors = makeColors(ctx.colors);
  const months = Number(ctx.args.months || 12);
  const db = openDb(ctx.dbPath);

  const fieldRows = db
    .prepare('SELECT DISTINCT field FROM metrics WHERE domain = ? ORDER BY field')
    .all(domain);
  const fields = fieldRows.map((r) => r.field);
  const snaps = snapshots(ctx.dbPath, domain, 100);
  const field = ctx.args.field || (fields.includes('health') ? 'health' : fields[0] || null);

  if (ctx.args.json) {
    const hist = field ? metricHistory(ctx.dbPath, domain, field, { months }) : [];
    console.log(JSON.stringify({ domain, fields, field, history: hist, snapshots: snaps }, null, 2));
    return;
  }

  console.log(colorize(`HISTORY — ${domain}`, 'bold', colors));
  console.log(colorize(`${snaps.length} snapshot(s) · fields: ${fields.join(', ') || 'none yet'}`, 'dim', colors));
  console.log();

  if (!field) {
    console.log(colorize('no metrics recorded yet — run `sm watch ' + domain + ' --runs 1` first.', 'yellow', colors));
    return;
  }

  const hist = metricHistory(ctx.dbPath, domain, field, { months });
  if (!hist.length) {
    console.log(colorize(`no history for "${field}" — run \`sm watch ${domain} --runs 1\` first.`, 'yellow', colors));
    return;
  }

  const values = hist.map((h) => h.value_num);
  console.log(
    renderTable(
      [
        ['captured at', 'as of', 'source', 'value', 'unit', 'trend'],
        ...hist.map((h, i) => [
          h.captured_at.replace('T', ' ').slice(0, 19),
          h.as_of || '-',
          h.source || '-',
          h.value_num != null ? fmtNum(h.value_num, 2) : (h.value_text ?? '-'),
          h.unit || '-',
          i === hist.length - 1 ? '' : sparkline(values),
        ]),
      ],
      { align: ['l', 'l', 'l', 'r', 'l', 'l'], colors, title: field.toUpperCase() },
    ),
  );
  console.log();

  if (values.length > 1) {
    const first = values[0];
    const last = values[values.length - 1];
    const pct = first ? ((last - first) / Math.abs(first)) * 100 : null;
    console.log(
      colorize(
        `change over ${values.length} capture(s): ${pct == null ? '-' : pct.toFixed(1) + '%'}`,
        pct == null ? 'dim' : pct >= 0 ? 'green' : 'red',
        colors,
      ),
    );
  }
}
