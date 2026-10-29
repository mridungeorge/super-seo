// CLI entry: hand-rolled argument parsing, command dispatch, global flags.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

export const GLOBAL_FLAGS = {
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  'cache-dir': { type: 'string' },
  db: { type: 'string' },
  'no-cache': { type: 'boolean' },
  refresh: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean' },
};

const BOOLEAN_ALIASES = new Set(['no-cache', 'no-color', 'refresh', 'verbose', 'help', 'quick', 'no-external', 'probe', 'advise', 'desktop']);

/** Parse argv into { _: positional, ...flags }. Supports --key value, --key=value, -k. */
export function parseArgs(argv, spec = {}) {
  const out = { _: [] };
  for (const k of Object.keys(spec)) out[k] = spec[k].type === 'boolean' ? false : undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      let key = a.slice(2);
      let val = null;
      const eq = key.indexOf('=');
      if (eq >= 0) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      const dashed = key;
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const isBool = BOOLEAN_ALIASES.has(dashed) || spec[dashed]?.type === 'boolean' || spec[camel]?.type === 'boolean';
      if (isBool) {
        out[camel] = val === null ? true : val !== 'false';
      } else {
        if (val === null) {
          val = argv[++i];
          if (val === undefined) throw new Error(`--${key} needs a value`);
        }
        out[camel] = val;
      }
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const key = a.slice(1);
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[camel] = argv[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function defaultCacheDir() {
  const base = process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
  return path.join(base, 'cache');
}

export function defaultDbPath() {
  const base = process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
  return path.join(base, 'super_seo.db');
}

export function makeContext(args) {
  const cacheDir = args.cacheDir || defaultCacheDir();
  return {
    args,
    colors: !args.noColor && process.stdout.isTTY !== false,
    cacheDir,
    dbPath: args.db || defaultDbPath(),
    noCache: !!args.noCache,
    refresh: !!args.refresh,
    verbose: !!args.verbose,
    http: null,
    async close() {
      if (this.http && typeof this.http.close === 'function') await this.http.close();
    },
  };
}

const USAGE = `super_seo: open-source SEO toolkit (crawler, audit, speed, rank, AI visibility, reports)

usage: sm <domain>                 everything: full scan, dashboard and written report (same as: sm full <domain>)
       sm <command> [args] [options]

main commands:
  full <domain>              full scan + interactive dashboard + written report [--competitors a.com,b.com] [--quick]
  scan <domain>              run every collector on one site into a folder (no written report)
  crawl <domain|url>         SEO crawler: pages, issues, links, duplicates, depth [--max-pages 300]
  dashboard <scan-folder>    rebuild dashboard.html from a scan folder

single checks:
  psi <url> [--desktop]      Google PageSpeed: Lighthouse scores + real-user web vitals
  probe <url>                web vitals measured in a real browser, with the slowest element
  rank <domain> [more]       popularity rank (Tranco, plus Cloudflare Radar with a token)
  radar <domain>             Cloudflare Radar rank, categories and 28-day series
  tech <domain>              technology stack from headers and HTML
  geo <domain> [--advise]    AI-answer readiness (crawler rules, llms.txt, structured data)
  ai <brand>                 how often AI models name the brand [--competitors a,b]
  keywords <seed|domain>     keyword ideas from search suggestions, clustered by intent
  serp <domain> --keywords   where the domain ranks for keywords [--engine brave|bing|duckduckgo]
  intel <domain>             registration, DNS, mail, subdomains, archive history
  wayback <domain>           Internet Archive capture history
  demand <article>           Wikipedia pageviews as an interest trend
  utm <url> --source --medium  build a UTM-tagged link

model-written (need an AI provider key):
  strategy <kind> <domain>   marketing|content|geo|trends|ads|pr|local plans from measured evidence
  sales <prep|outreach|score> <domain>   sales brief, outreach draft, lead score

history and estimates:
  watch <domain>             re-measure on a schedule into the history store
  history <domain>           trend of a recorded metric over time
  calibrate --csv file       fit a rank->visits model on traffic you know
  estimate <domain>          rough traffic estimate from a popularity rank

other:
  mcp                        stdio MCP server exposing these commands as agent tools
  doctor                     environment and reachability check
  version                    print the version

options:
  --json                     machine-readable output
  --no-color                 disable ANSI colour
  --cache-dir <dir>          response cache location
  --db <file>                sqlite history file
  --no-cache / --refresh     bypass or force-refresh the cache
  --verbose                  log every request
`;

export async function main(argv) {
  // `sm example.com` is shorthand for `sm full example.com`: no command name contains a dot.
  if (argv[0] && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(argv[0])) argv = ['full', ...argv];
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    console.log(`super_seo ${VERSION}`);
    return;
  }

  const args = parseArgs(argv.slice(1), GLOBAL_FLAGS);
  const ctx = makeContext(args);
  ctx.command = cmd;
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const registry = {
    rank: () => import('./commands/rank.js'),
    tech: () => import('./commands/tech.js'),
    doctor: () => import('./commands/doctor.js'),
    probe: () => import('./commands/probe.js'),
    keywords: () => import('./commands/keywords.js'),
    serp: () => import('./commands/serp.js'),
    ai: () => import('./commands/ai.js'),
    history: () => import('./commands/history.js'),
    watch: () => import('./commands/watch.js'),
    intel: () => import('./commands/intel.js'),
    wayback: () => import('./commands/intel.js'),
    demand: () => import('./commands/intel.js'),
    utm: () => import('./commands/utm.js'),
    mcp: () => import('./commands/mcp.js'),
    psi: () => import('./commands/perf.js'),
    radar: () => import('./commands/perf.js'),
    geo: () => import('./commands/strategy.js'),
    strategy: () => import('./commands/strategy.js'),
    sales: () => import('./commands/strategy.js'),
    estimate: () => import('./commands/estimate.js'),
    calibrate: () => import('./commands/estimate.js'),
    scan: () => import('./commands/scan.js'),
    full: () => import('./commands/full.js'),
    dashboard: () => import('./commands/dashboard.js'),
    crawl: () => import('./commands/crawl.js'),
  };

  const loader = registry[cmd];
  if (!loader) {
    console.error(`sm: unknown command "${cmd}"\n`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const mod = await loader();
  try {
    await mod.run(ctx);
  } finally {
    await ctx.close();
  }
}
