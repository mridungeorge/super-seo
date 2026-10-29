// `sm calibrate --csv file` and `sm estimate <domain>`: a rough traffic estimate from a popularity rank.
// There is no built-in model; calibrate on traffic figures you know (your own analytics, or sites
// you manage), then estimate sites you cannot measure.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Http } from '../core/http.js';
import { renderTable, makeColors, colorize, fmtNum } from '../core/table.js';
import { trancoRank, medianRank } from '../sources/tranco.js';
import { radarToken, radarRank } from '../sources/radar.js';
import { parseCalibrationCsv, collectPairs, fitCalibration, estimateVisits, loadModel, saveModel } from '../collect/estimate.js';

const home = () => process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');

function client(ctx) {
  return new Http({ cacheDir: ctx.cacheDir, noCache: ctx.noCache, refresh: ctx.refresh, verbose: ctx.verbose, minDelay: 2500 });
}

export async function calibrate(ctx) {
  const colors = makeColors(ctx.colors);
  const file = ctx.args.csv;
  if (!file || !fs.existsSync(file)) {
    console.error('usage: sm calibrate --csv known-traffic.csv\n  CSV header: domain,visits[,rank]. At least 3 domains whose monthly visits you know.\n  Missing ranks are looked up in the Tranco list.');
    process.exitCode = 1;
    return;
  }
  const rows = parseCalibrationCsv(fs.readFileSync(file, 'utf8'));
  console.error(`calibrating on ${rows.length} domain(s), one rank lookup each, politely paced...`);
  const { pairs, skipped } = await collectPairs(client(ctx), rows, { onProgress: (d, n) => console.error(`  ${n}. ${d}`) });
  if (pairs.length < 3) {
    console.error(colorize(`only ${pairs.length} usable row(s), need at least 3. Skipped: ${skipped.map((s) => s.domain + ' (' + s.why + ')').join(', ')}`, 'yellow', colors));
    process.exitCode = 2;
    return;
  }
  const model = fitCalibration(pairs);
  saveModel(home(), model);
  if (ctx.args.json) return console.log(JSON.stringify({ model, skipped }, null, 2));
  console.log(colorize('CALIBRATION', 'bold', colors));
  console.log(`log10(visits) = ${model.a.toFixed(3)} + ${model.b.toFixed(3)} * log10(rank)   n=${model.n}  R²=${model.r2.toFixed(3)}  σ=${model.sigma.toFixed(3)} (log10)`);
  console.log(`typical error: ×/÷ ${(10 ** model.sigma).toFixed(2)}   saved to ${path.join(home(), 'calibration.json')}`);
  console.log(
    renderTable(
      [['domain', 'rank', 'known visits', 'model', 'ratio'], ...model.points.map((p) => {
        const e = estimateVisits(model, p.rank).visits;
        return [p.domain, fmtNum(p.rank), fmtNum(p.visits), fmtNum(e), (e / p.visits).toFixed(2)];
      })],
      { align: ['l', 'r', 'r', 'r', 'r'], colors },
    ),
  );
  if (skipped.length) console.log(colorize('skipped: ' + skipped.map((s) => `${s.domain} (${s.why})`).join(', '), 'dim', colors));
}

export async function run(ctx) {
  if (ctx.command === 'calibrate') return calibrate(ctx);
  const colors = makeColors(ctx.colors);
  const domain = (ctx.args._[0] || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!domain) {
    console.error('usage: sm estimate <domain>   (run `sm calibrate --csv file` first)');
    process.exitCode = 1;
    return;
  }
  const model = loadModel(home());
  if (!model) {
    console.error('no calibration yet. Run `sm calibrate --csv known-traffic.csv` with traffic figures you know.');
    process.exitCode = 1;
    return;
  }
  const t = await trancoRank(client(ctx), domain);
  if (!t) {
    console.error(`${domain} is not in the Tranco top list, so no popularity-based estimate is possible.`);
    process.exitCode = 2;
    return;
  }
  const rank = medianRank(t);
  const est = estimateVisits(model, rank);
  const rt = radarToken();
  const radar = rt ? await radarRank(domain, rt).catch(() => null) : null;
  const out = { domain, trancoRank: rank, rankDate: t.date, estimate: est, cloudflareRadar: radar, model: { n: model.n, r2: model.r2, sigma: model.sigma } };
  if (ctx.args.json) return console.log(JSON.stringify(out, null, 2));
  console.log(colorize(`ESTIMATE — ${domain}`, 'bold', colors));
  console.log(
    renderTable(
      [
        ['signal', 'value', 'note'],
        ['Tranco rank (14-day median)', fmtNum(rank), `as of ${t.date}`],
        ['estimated monthly visits', fmtNum(est.visits), 'model (see calibration)'],
        ['80% range', `${fmtNum(est.low)} – ${fmtNum(est.high)}`, `typical error ×/÷ ${(10 ** model.sigma).toFixed(1)}`],
        ...(radar ? [['Cloudflare Radar', radar.rank !== null ? fmtNum(radar.rank) : `top ${fmtNum(radar.bucket)} bucket`, 'independent popularity cross-check']] : []),
      ],
      { align: ['l', 'r', 'l'], colors },
    ),
  );
  if (est.extrapolated) console.log(colorize('  note: this rank is outside the calibrated range, so treat it as rougher than the stated band.', 'yellow', colors));
  console.log(colorize(`  basis: ${model.n} calibration domains, R²=${model.r2.toFixed(2)}. An estimate from a popularity rank, not a measured figure; no engagement, geography or channel data.`, 'dim', colors));
}
