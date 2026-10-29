# Command reference

Run `sm help` for the short list. Every command accepts `--json` (machine-readable output) and `--no-color`.
Global options: `--cache-dir <dir>`, `--db <file>`, `--no-cache`, `--refresh`, `--verbose`.

`sm <site>` on its own is shorthand for `sm full <site>`.

## The whole job

| Command | What it does |
|---|---|
| `sm full <site>` | Runs every collector, builds the dashboard, and writes the report. Options: `--competitors a.com,b.com`, `--brand "Name"`, `--max-pages 300`, `--engine auto\|scrapling\|builtin`, `--out <dir>`, `--quick` (skip model-written parts), `--from <scan-folder>` (rebuild the report from an existing folder). |
| `sm scan <site>` | The collectors and the dashboard, without the written report. Same options as `full`, plus `--only a,b` and `--skip a,b` to choose steps. |
| `sm dashboard <folder>` | Rebuilds `dashboard.html` from a scan folder. |

## Collectors

| Command | What it does |
|---|---|
| `sm crawl <site\|url>` | The SEO crawler. `--max-pages 300`, `--concurrency 4`, `--no-external` (skip checking outbound links), `--engine`. |
| `sm psi <url>` | Google PageSpeed Insights; `--desktop` for the desktop strategy. Needs `PSI_API_KEY`. |
| `sm probe <url>` | Web vitals measured in a real Chrome, with the slowest element as a CSS selector. Needs Chrome or Chromium. |
| `sm rank <domain> [more]` | Popularity rank from the Tranco list, plus Cloudflare Radar when a token is set. |
| `sm radar <domain>` | Cloudflare Radar rank, categories and 28-day series. Needs `CLOUDFLARE_API_TOKEN`. |
| `sm serp <domain> --keywords "a,b"` | Where the domain appears in the top results. `--engine brave\|bing\|duckduckgo`. |
| `sm keywords <seed\|domain>` | Keyword ideas from search suggestions, clustered, with intent. |
| `sm geo <domain>` | AI-answer readiness: AI crawler rules, `llms.txt`, structured data, answer-ready content. `--advise` adds a model-written plan. |
| `sm ai "<brand>"` | Asks an AI model about the brand and scores whether and how it is named. `--competitors a,b`, `--prompts n`. |
| `sm tech <domain>` | Technology stack from headers and HTML, with the rule behind each detection. |
| `sm intel <domain>` | Registration, DNS, mail, subdomains from certificate logs, archive history. |
| `sm wayback <domain>` | Internet Archive capture history. |
| `sm demand <article>` | Wikipedia pageviews as an interest trend. |
| `sm utm <url> --source s --medium m` | Builds a UTM-tagged link (`--campaign`, `--term`, `--content`). |

## Model-written

These need an AI provider key (see [api-keys.md](api-keys.md)).

| Command | What it does |
|---|---|
| `sm strategy <kind> <domain>` | `marketing`, `content`, `geo`, `trends`, `ads`, `pr` or `local` plans from measured evidence. |
| `sm sales <prep\|outreach\|score> <domain>` | A sales brief, an outreach draft, or a transparent lead score. |

## Over time

| Command | What it does |
|---|---|
| `sm watch <site>` | Re-measures on a schedule (`--interval 1h`, `--runs 5`, `--pages 30`, `--psi`) and records the results. |
| `sm history <site>` | Shows a recorded metric over time (`--field health`). |
| `sm calibrate --csv known-traffic.csv` | Fits a rank-to-visits model on traffic you know. See `examples/known-traffic.csv`. |
| `sm estimate <domain>` | A rough monthly-visit estimate from a popularity rank, with an 80% range. Needs a calibration. |

## Other

| Command | What it does |
|---|---|
| `sm mcp` | Starts an MCP server over stdio so an AI agent can call the read-only commands. |
| `sm doctor` | Checks Node, SQLite, Chrome, the optional parser, network reachability and which keys are set. |
| `sm version` | Prints the version. |

## Environment variables

See `.env.example`. Settings are read from the environment first, then `./.env`, then `~/.super_seo/.env`.
`SM_DEBUG=1` prints stack traces for errors.
