import test from 'node:test';
import assert from 'node:assert/strict';
import { complete } from '../src/core/llm.js';
import { parseRobots, crawlerStatus, analyseGeo } from '../src/collect/geo.js';

test('nvidia engine sends a bearer key and an OpenAI-style body, and never leaks the key in errors', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-SECRET123';
  let seen;
  const ok = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: ' hello ' } }] }) };
  };
  assert.equal(await complete('hi', { engine: 'nvidia', system: 's', fetchImpl: ok }), 'hello');
  assert.match(seen.url, /integrate\.api\.nvidia\.com\/v1\/chat\/completions/);
  assert.equal(seen.init.headers.authorization, 'Bearer nvapi-SECRET123');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.messages[0].role, 'system');
  const bad = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(() => complete('hi', { engine: 'nvidia', fetchImpl: bad }), (e) => /401/.test(e.message) && !e.message.includes('SECRET123'));
  delete process.env.NVIDIA_API_KEY;
});

test('robots.txt crawler rules: specific group beats wildcard', () => {
  const g = parseRobots('User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nDisallow: /\n');
  assert.equal(crawlerStatus(g, 'GPTBot'), 'blocked');
  assert.equal(crawlerStatus(g, 'ClaudeBot'), 'allowed (no rule)');
});

test('geo analysis flags missing FAQ markup and counts passes', () => {
  const html = '<html><head><meta name="description" content="x"><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>A</h1></body></html>';
  const r = analyseGeo({ html, robots: 'User-agent: *\nAllow: /', llmsTxt: true });
  assert.equal(r.checks.find((c) => c.name.startsWith('FAQ')).pass, false);
  assert.equal(r.checks.find((c) => c.name === 'Exactly one h1').pass, true);
  assert.ok(r.score > 0 && r.score < 100);
});

import { looksLikeReasoning } from '../src/core/llm.js';

test('planning notes are recognised, real answers are not', () => {
  assert.equal(looksLikeReasoning('The user wants a Technical SEO findings section for a client report. I need to:'), true);
  assert.equal(looksLikeReasoning("Let me think about the evidence first."), true);
  assert.equal(looksLikeReasoning('**1. Broken internal links**\n- Problem: 295 pages link to a 404.'), false);
  assert.equal(looksLikeReasoning('The site earns 97K monthly organic visits.'), false);
});

test('openai engine posts to LLM_BASE_URL with the model and never leaks the key', async () => {
  process.env.LLM_API_KEY = 'secret-test-key-123';
  process.env.LLM_BASE_URL = 'http://localhost:9999/v1/';
  process.env.LLM_MODEL = 'my-model';
  try {
    let seen;
    const ok = await complete('hi', { engine: 'openai', fetchImpl: async (url, init) => { seen = { url, body: JSON.parse(init.body), auth: init.headers.authorization }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'hello there' } }] }) }; } });
    assert.equal(ok, 'hello there');
    assert.equal(seen.url, 'http://localhost:9999/v1/chat/completions');
    assert.equal(seen.body.model, 'my-model');
    assert.equal(seen.auth, 'Bearer secret-test-key-123');
    const bad = { ok: false, status: 401, text: async () => 'nope', json: async () => ({}) };
    await assert.rejects(complete('hi', { engine: 'openai', fetchImpl: async () => bad }), (e) => /401/.test(e.message) && !e.message.includes('secret-test-key-123'));
  } finally {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  }
});
