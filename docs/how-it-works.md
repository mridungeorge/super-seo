# How it works

## The pipeline

`sm full <site>` runs the steps below. Each step is its own `sm <command> --json` child process, so a hang or crash in
one cannot stop the others, and each writes one JSON file to the output folder. Steps that need a missing key are
skipped and recorded as skipped.

```
 measured steps (one at a time)            model-written steps (a few at once)
 ──────────────────────────────            ───────────────────────────────────
 probe      real-browser web vitals         ai                 AI-answer probe
 estimate   rough traffic (if calibrated)   strategy-marketing marketing plan
 radar      Cloudflare Radar rank           strategy-content   content plan
 crawl      the SEO crawler                 geo-plan           AI-readiness plan
 psi        PageSpeed, mobile and desktop   sales-score        lead score
 tech, geo  stack, AI readiness
 rank       popularity ranks (you + competitors)
 competitor-N-crawl / -psi   each named competitor
 psi-page-N  PageSpeed on your most-linked pages
 keywords-*  suggestions, clustered
 serp       live rank check
 intel, wayback   domain background
                         │
                         ▼
        dashboard.html (interactive)  +  report.html / report.md (written)
```

## The output folder

| File | Contents |
|---|---|
| `crawl.json` | Every crawled page, the issue catalogue with affected URLs, duplicates, link analysis, content statistics, technical checks. |
| `psi*.json`, `competitor-N-psi.json` | PageSpeed results. |
| `rank.json`, `radar.json`, `estimate.json` | Popularity data. |
| `serp.json`, `keywords-*.json` | Rank check and keyword ideas. |
| `geo.json`, `ai.json` | AI readiness and AI-answer probe. |
| `tech.json`, `intel.json`, `wayback.json`, `probe.json` | Background and browser measurements. |
| `summary.json`, `summary.md` | What ran, how long it took, what was skipped and why. |
| `dashboard.html` | Built from the files above. `sm dashboard <folder>` rebuilds it. |
| `report.html`, `report.md`, `report-evidence.json` | The written report and the exact evidence given to the model. |

Because the dashboard and report are built only from these files, you can inspect, version, diff or reuse any of them.

## The crawler

`src/collect/crawl.js` starts at the homepage and follows same-site links breadth-first, while sampling the sitemap
for the rest of the budget (40% of `--max-pages`), so large sites are covered beyond what links reveal.

- It respects `robots.txt` (`User-agent: *` rules), waits between requests, and limits concurrency.
- It follows redirects by hand so chains are counted, and records response time, size and headers.
- It reads each page into the same shape with either the built-in parser or, if installed, Scrapling.
- After the crawl it computes inlinks, click depth, an internal link-strength score (PageRank over the crawled pages),
  duplicates, broken and redirected links, orphan pages (only when the whole site was crawled) and the issue list.
- A page's score is 100 minus 25 per error type, 6 per warning type and 1 per notice type; site health is the
  average. Issue definitions live in one table at the top of `crawl.js`: each has a severity, a category, why it
  matters and how to fix it.
- A site that refuses the crawl (HTTP 403, 429 and so on) is reported as blocked. Nothing is done to get around it.

## Honesty rules

- Every figure comes from a named step. Unavailable data is blank and explained, never replaced by a plausible number.
- The only estimates are the optional rank-to-traffic model (with its error stated) and the text a model writes.
- Model prose is generated section by section from a compact evidence block. The system prompt forbids numbers that
  are not in the evidence, and the evidence is saved next to the report so any claim can be checked.
- If a model returns its planning notes instead of an answer, the request is retried with a larger budget.

## Layout

```
bin/sm.js            entry point; loads .env
src/cli.js           argument parsing and command registry
src/commands/        one file per command
src/collect/         crawler, geo/AI readiness, keywords, SERP, AI probe, estimator, report writer
src/sources/         PageSpeed, Radar, Tranco, Wayback/RDAP/DNS, browser probe
src/core/            HTTP client, LLM client, store, charts, dashboard, competitor logic, table rendering
scripts/             demo generator, syntax check, optional Scrapling worker
examples/            demo scan folder and calibration CSV
test/                offline tests (live tests are opt-in)
```
