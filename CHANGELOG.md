# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First public release.

### Added
- `sm full`, `sm scan` and `sm dashboard`: a full scan, an interactive dashboard and a written report from one command.
- SEO crawler with about 40 issue types, duplicates, broken and redirected links, orphan pages, click depth, internal link
  strength and technical checks; optional Scrapling parser.
- Google PageSpeed Insights, Cloudflare Radar, Tranco rank, live rank check (Brave Search API), keyword ideas, AI-readiness
  and AI-answer probes, technology stack, domain background and archive history.
- Competitor comparison: rank, speed, a small crawl and structured-data use side by side, who holds the top 10, and a
  keyword-gap table.
- `sm watch` and `sm history` for tracking health, speed and rank over time.
- `sm calibrate` and `sm estimate`: a rough traffic estimate from a model calibrated on traffic you know.
- Any OpenAI-compatible model provider, plus NVIDIA and Anthropic.
- `sm mcp`: a read-only MCP server.
- A generated demo (`examples/demo`) that needs no third-party site.
