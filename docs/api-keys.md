# Getting free API keys

super_seo works with no keys at all: you still get the crawl, the audit, content analysis, popularity rank,
technology stack and the dashboard. Three free keys unlock the advanced parts. Each one is optional, takes a few
minutes, and any feature whose key is missing is skipped (and listed as skipped in the report).

| Key | Unlocks | Cost |
|---|---|---|
| [Google PageSpeed Insights](#1-google-pagespeed-insights-psi_api_key) | Lighthouse scores, real-user Core Web Vitals, the biggest speed fixes, speed comparison with competitors | Free |
| [Cloudflare Radar](#2-cloudflare-radar-cloudflare_api_token) | Popularity rank from a second source, site categories, 28-day rank history | Free account |
| [NVIDIA API catalog](#3-nvidia-api-catalog-nvidia_api_key) | The written report, strategy and sales plans, and the AI-visibility probe | Free, rate-limited |
| [Brave Search API](#4-brave-search-api-brave_api_key-optional) (optional) | The live "where do I rank" check and the keyword-gap table | Credit-based; see below |

Service sign-up pages change their layout from time to time. The steps below describe what the pages looked like
when this was written; if a menu has moved, the service's own documentation (linked in each section) is the
authority.

## Where to put a key

Put each key in a file named `.env` in the project folder (copy `.env.example`), or in
`~/.super_seo/.env` to use it from any folder:

```
PSI_API_KEY=your-key-here
CLOUDFLARE_API_TOKEN=your-token-here
NVIDIA_API_KEY=nvapi-your-key-here
```

Rules that keep keys safe:

- **Never commit `.env`.** The repository's `.gitignore` already excludes it.
- **Never paste a key into an issue, a chat or a screenshot.** If you do, delete the key and create a new one.
- Restrict a key to the one API it is for wherever the service lets you (shown below).
- Run `sm doctor`. It reports each key as "set" or "not set" without printing the value.

---

## 1. Google PageSpeed Insights (`PSI_API_KEY`)

PageSpeed Insights runs Lighthouse on a page and adds field data from real Chrome users. It powers the Speed tab,
the speed rings on the Overview, the competitor speed comparison and the "biggest fixes" list.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and sign in with a Google account.
2. Create a project (or pick an existing one).
3. Go to **APIs & Services → Library**, search for **PageSpeed Insights API** and click **Enable**.
4. Go to **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
5. Recommended: click the new key, under **API restrictions** choose **Restrict key** and select
   **PageSpeed Insights API**, then save.
6. Add `PSI_API_KEY=...` to your `.env`.

Check it: `sm psi https://example.com`

Notes:

- Google's [documentation](https://developers.google.com/speed/docs/insights/v5/get-started) says the API can be
  used without a key but recommends one for frequent, automated requests, which is what a scan makes.
- Quotas are shown in the Cloud console under **APIs & Services → PageSpeed Insights API → Quotas**. A full scan
  makes up to about 8 requests (mobile, desktop, three key pages, and each named competitor).
- Real-user ("field") data exists only for pages with enough Chrome traffic. For small sites the report shows the lab
  simulation only, and says so.

## 2. Cloudflare Radar (`CLOUDFLARE_API_TOKEN`)

Radar gives a second, independent popularity ranking, the site's category, and a daily rank history. It powers the
popularity cross-check and the Radar chart.

1. Sign in at the [Cloudflare dashboard](https://dash.cloudflare.com/) (a free account is enough to create a token).
2. Open your profile menu, then **My Profile → API Tokens → Create Token**.
3. Choose **Create Custom Token**.
4. Under **Permissions** pick **Account → Radar → Read**.
5. Under **Account Resources** include your account, then **Continue to summary → Create Token**.
6. Copy the token (it is shown once) and add `CLOUDFLARE_API_TOKEN=...` to your `.env`.

Check it: `sm radar example.com`

Notes:

- Use an **API token**, not the "Global API Key". A token with only the Radar read permission cannot change anything
  in your account.
- Radar publishes an exact rank for the most popular domains. Smaller sites are reported as being inside a "top N"
  bucket (for example "top 200,000"), and the tool shows that as it is rather than inventing a rank.
- See the [Radar API documentation](https://developers.cloudflare.com/radar/) for current terms and limits.

## 3. NVIDIA API catalog (`NVIDIA_API_KEY`)

A language model writes the prose of the report (technical findings, competitor read, keyword and content ideas, the
30/60/90 day plan), the strategy and sales plans, and the questions asked in the AI-visibility probe. It is given only
the measured evidence for each section. NVIDIA's API catalog offers free access to a range of hosted models.

1. Go to [build.nvidia.com](https://build.nvidia.com/) and sign in or create an account. Joining the free NVIDIA
   Developer Program is part of this.
2. Open a model page (for example search for "nemotron") and choose **Get API Key** (or **Build with this NIM**, then
   generate a key).
3. Copy the key (it starts with `nvapi-`) and add `NVIDIA_API_KEY=...` to your `.env`.
   You may be asked to verify a phone number.

Check it: `sm strategy marketing example.com`

Notes:

- The free tier is rate limited. A commonly reported limit is about 40 requests per minute, and NVIDIA's own FAQ says
  limits vary by model and by how busy the service is. The tool retries when the service is busy and falls back to
  another model when one is retired, so a full report can take a few minutes longer at busy times.
- Hosted models are retired from time to time (the tool then reports HTTP 404 or 410 and tries the next one). To pin a
  model, set `NVIDIA_MODEL` or pass `--model`. The current list is at [build.nvidia.com/models](https://build.nvidia.com/models).
- Use is subject to NVIDIA's terms; read them if you plan anything beyond personal or evaluation use.
- The evidence sent to the service is measurements about the site you scanned (counts, scores, page titles and
  phrases). It does not include your keys or files.

### Prefer another model provider?

Set these instead (any OpenAI-compatible service, hosted or local):

```
LLM_API_KEY=your-key
LLM_MODEL=model-name
LLM_BASE_URL=https://api.openai.com/v1
```

A local server works too, for example Ollama at `LLM_BASE_URL=http://localhost:11434/v1` with any non-empty
`LLM_API_KEY`. `ANTHROPIC_API_KEY` is also supported. With no model configured, `sm full` still writes the dashboard and
the data-driven parts of the report; only the written prose is skipped.

## 4. Brave Search API (`BRAVE_API_KEY`, optional)

The live rank check ("where does my site appear for these keywords?") and the keyword-gap table need search results.
The tool uses the Brave Search API because it is an official API.

1. Sign up at [brave.com/search/api](https://brave.com/search/api/) and create a subscription and an API key.
2. Add `BRAVE_API_KEY=...` to your `.env`.

Notes:

- Brave's pricing has changed over time. Reports from early 2026 describe a monthly credit that covers roughly a thousand
  queries and requires a payment card to activate. Check the current plan in Brave's dashboard before relying on it.
- A scan checks up to about 16 keywords, so a monthly allowance goes a long way.
- Without this key the rank check is skipped and everything else still runs. As an opt-in alternative,
  `--engine bing` or `--engine duckduckgo` (or `SM_SERP_ENGINE`) read those sites' result pages directly. Automated
  queries may be against their terms, so use that only where you are comfortable doing so.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `sm doctor` shows a key as "not set" | The `.env` file is in the wrong folder, the name is misspelled, or the line is still `KEY=` with no value. |
| PageSpeed: HTTP 403 or "API not enabled" | The PageSpeed Insights API is not enabled on the Cloud project that owns the key, or the key is restricted to a different API. |
| PageSpeed: HTTP 429 | Quota or rate limit reached. Wait and retry, or check the quota page. |
| Radar: HTTP 400 or 403 | The token is missing **Account → Radar → Read**, or it is the wrong kind of credential. |
| NVIDIA: HTTP 404 or 410 | The model was retired. The tool tries the next one; set `NVIDIA_MODEL` to pin a current model. |
| NVIDIA: HTTP 429 or 503 | The free tier is busy. The tool retries; run the scan again later if it keeps failing. |
