# Security policy

## Reporting a problem

Please report security issues privately through the repository's "Report a vulnerability" option
(GitHub Security Advisories) rather than a public issue. Include steps to reproduce and the version.

## What is in scope

- Leaking API keys or tokens (in output, errors, logs, files or the generated dashboard and report).
- Executing content from a crawled site (the tool must only parse it).
- Unsafe handling of file paths, child processes or the MCP server's inputs.

## Notes for users

- Keep keys in `.env` or the environment, and never commit `.env`. The repository's `.gitignore` excludes it.
- The generated dashboard and report are static files. They contain data about the sites you scanned, not your keys.
- Crawled pages and fetched data are untrusted input. The tool parses them and never runs them.
