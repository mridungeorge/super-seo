# Contributing

Thanks for helping. A few ground rules keep the project useful and safe to run.

## Setup

Node.js 24 or newer. No `npm install` is needed: the project has no dependencies.

```
npm test          # must pass, and must not touch the network
npm run check     # syntax and secret scan
npm run demo      # rebuild examples/demo after changing the dashboard or crawler
node bin/sm.js doctor
```

## Principles

- **Say where a number came from.** Measured, estimated and unavailable are different things. Never fill a gap
  with a plausible figure; leave it blank and say why.
- **Polite by default.** Respect `robots.txt`, keep delays and concurrency conservative, identify the crawler
  honestly. Do not add code that disguises the tool, rotates identities or works around bot protection.
- **Official APIs first.** If a service has an API, use it. Anything that reads pages meant for people must be
  opt-in and documented in the README's responsible-use section.
- **No secrets in code, logs or errors.** Keys come from the environment. Tests assert that error messages do
  not contain them.
- **No dependencies without a strong reason.** Optional components (like the Scrapling parser) must degrade
  quietly when missing.

## Tests

- Offline tests use small made-up fixtures. Do not commit captured pages from other sites.
- Live tests live in `test/live.test.js` and run only with `SM_LIVE=1`.
- A new check or issue type needs a test that shows it firing and not firing.

## Pull requests

Keep them focused, say what you measured to verify the change, and update the README if behaviour changes.
