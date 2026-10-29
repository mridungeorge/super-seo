import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/sm.js');

test('utm builder normalises values', () => {
  const r = spawnSync(process.execPath, [SM, 'utm', 'example.com/x', '--source', 'News Letter', '--medium', 'email'], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'https://example.com/x?utm_source=news_letter&utm_medium=email');
});

test('mcp rejects option-looking arguments', () => {
  const r = spawnSync(process.execPath, [SM, 'mcp'], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'domain_intel', arguments: { domain: '--x' } } }) + '\n',
    encoding: 'utf8',
  });
  assert.match(r.stdout, /invalid argument/);
});

test('ai scoring matches a domain-style competitor by its written name', async () => {
  const { scoreAnswer, aliases } = await import('../src/collect/prompts.js');
  assert.deepEqual(aliases('paypal.com'), ['paypal.com', 'paypal']);
  const r = scoreAnswer('Stripe is strong, but PayPal is a fine backup. Adyen suits enterprises.', 'Stripe', ['paypal.com', 'adyen.com']);
  assert.deepEqual(r.coMentions.sort(), ['adyen.com', 'paypal.com']);
  assert.equal(scoreAnswer('Stripes are patterns', 'Stripe', []).mentioned, false);
});
