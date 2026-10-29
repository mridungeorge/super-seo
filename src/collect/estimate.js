// A rough traffic estimator for sites where you have no analytics.
//
// Model: log10(monthly visits) = a + b * log10(Tranco rank), fitted by least squares over domains
// where you know BOTH the public rank and the real monthly visits (your own analytics, or sites you
// manage). The residual spread gives the range. The result is an order-of-magnitude estimate; it says
// nothing about engagement, geography or channels, and is labelled as an estimate wherever it appears.
// No model ships with the tool: calibrate it on your own numbers (sm calibrate --csv file).

import fs from 'node:fs';
import path from 'node:path';
import { trancoRank, medianRank } from '../sources/tranco.js';

/** Ordinary least squares on (x, y). */
export function ols(points) {
  const n = points.length;
  if (n < 3) throw new Error(`need at least 3 calibration points, have ${n}`);
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const sse = points.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0);
  return { a, b, n, r2: syy === 0 ? 1 : 1 - sse / syy, sigma: Math.sqrt(sse / Math.max(1, n - 2)) };
}

/** pairs: [{domain, rank, visits}] -> model */
export function fitCalibration(pairs) {
  const usable = pairs.filter((p) => p.rank > 0 && p.visits > 0);
  const fit = ols(usable.map((p) => ({ x: Math.log10(p.rank), y: Math.log10(p.visits) })));
  return {
    ...fit,
    fittedAt: new Date().toISOString(),
    rankRange: [Math.min(...usable.map((p) => p.rank)), Math.max(...usable.map((p) => p.rank))],
    points: usable,
  };
}

/** @returns {{visits, low, high, extrapolated}}  low/high = 80% band */
export function estimateVisits(model, rank) {
  const y = model.a + model.b * Math.log10(rank);
  const z = 1.2816; // 80% two-sided
  return {
    visits: Math.round(10 ** y),
    low: Math.round(10 ** (y - z * model.sigma)),
    high: Math.round(10 ** (y + z * model.sigma)),
    extrapolated: rank < model.rankRange[0] || rank > model.rankRange[1],
  };
}

export function modelPath(home) {
  return path.join(home, 'calibration.json');
}

export function loadModel(home) {
  try {
    return JSON.parse(fs.readFileSync(modelPath(home), 'utf8'));
  } catch {
    return null;
  }
}

export function saveModel(home, model) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelPath(home), JSON.stringify(model, null, 2));
}

/**
 * Read calibration data from a CSV with a header row. Columns: domain, visits, and optionally rank.
 * Rows without a rank get their Tranco rank looked up.
 */
export function parseCalibrationCsv(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('the CSV needs a header row and at least one data row');
  const head = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const col = (name) => head.indexOf(name);
  if (col('domain') < 0 || col('visits') < 0) throw new Error('the CSV header must include "domain" and "visits" (optionally "rank")');
  return lines.slice(1).map((l) => {
    const c = l.split(',').map((x) => x.trim());
    return { domain: c[col('domain')].toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''), visits: Number(c[col('visits')].replace(/[^0-9.]/g, '')), rank: col('rank') >= 0 && c[col('rank')] ? Number(c[col('rank')]) : null };
  });
}

/** Fill in missing ranks from Tranco. Failures are recorded and skipped, never guessed. */
export async function collectPairs(http, rows, { onProgress = null } = {}) {
  const pairs = [];
  const skipped = [];
  for (const row of rows) {
    try {
      let rank = row.rank;
      if (!rank) {
        const t = await trancoRank(http, row.domain);
        if (!t) {
          skipped.push({ domain: row.domain, why: 'not in Tranco' });
          continue;
        }
        rank = medianRank(t);
      }
      if (!(row.visits > 0)) {
        skipped.push({ domain: row.domain, why: 'no visit count' });
        continue;
      }
      pairs.push({ domain: row.domain, rank, visits: row.visits });
      if (onProgress) onProgress(row.domain, pairs.length);
    } catch (err) {
      skipped.push({ domain: row.domain, why: err.message });
    }
  }
  return { pairs, skipped };
}
