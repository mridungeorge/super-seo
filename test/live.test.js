// Opt-in live smoke tests: they touch the network. Run with SM_LIVE=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveEnabled } from './helpers.js';
import { Http } from '../src/core/http.js';
import { trancoRank } from '../src/sources/tranco.js';
import { crawlSite } from '../src/collect/crawl.js';

const skip = liveEnabled() ? false : 'set SM_LIVE=1 to run live tests';

test('live: a well-known domain is in the Tranco list', { skip }, async () => {
  const t = await trancoRank(new Http({ minDelay: 500 }), 'wikipedia.org');
  assert.ok(t && t.rank > 0);
});

test('live: the crawler reads a small public site', { skip }, async () => {
  const r = await crawlSite('example.com', { maxPages: 3, checkExternal: false });
  assert.equal(r.blocked, false);
  assert.ok(r.summary.pages >= 1);
});
