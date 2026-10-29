// One entry point for the model-driven features (written reports, plans, AI-answer probes).
// Engines:
//   openai     - any OpenAI-compatible chat service: LLM_BASE_URL (default https://api.openai.com/v1),
//                LLM_API_KEY and LLM_MODEL. Works with hosted services and local servers alike.
//   nvidia     - NVIDIA NIM at integrate.api.nvidia.com; NVIDIA_API_KEY (or config.json nvidiaApiKey)
//   anthropic  - Anthropic Messages API; ANTHROPIC_API_KEY
//   claude-cli - the local `claude -p` binary, no key
// Keys are read here and never placed in an error message or log line.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// Tried in order; hosted catalogues retire models without notice (a retired one answers 404/410), so a
// request falls through to the next. Override with --model or NVIDIA_MODEL.
export const NVIDIA_MODELS = ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'z-ai/glm-5.3-flash', 'openai/gpt-oss-20b'];

function configValue(field) {
  try {
    const home = process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo');
    return JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'))[field] || null;
  } catch {
    return null;
  }
}

export const nvidiaKey = () => process.env.NVIDIA_API_KEY || configValue('nvidiaApiKey');
export const openaiKey = () => process.env.LLM_API_KEY || configValue('llmApiKey');

/** The engine to use when the caller does not choose one. */
export function defaultEngine() {
  if (openaiKey()) return 'openai';
  if (nvidiaKey()) return 'nvidia';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'claude-cli';
}

/** Planning notes rather than an answer: the model talking about the task, not doing it. */
export const looksLikeReasoning = (t) => /^(the user (wants|is asking|has asked|needs)|i need to|i should|let me |let's |okay,|ok,|we need to|first, i|so,? the user|hmm)/i.test(String(t).trim());

async function postJson(url, headers, body, timeout, label, fetchImpl) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`${label} API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * An OpenAI-style chat completion with retries. A rate limit, server error or timeout is retried
 * (shared capacity makes these common when several requests run at once); after that the next
 * candidate model gets a turn. A retired model (404/410) moves on at once.
 */
async function chatCompletions({ label, url, key, candidates, system, prompt, maxTokens, timeout, fetchImpl, headroom }) {
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  let lastErr;
  for (const m of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Reasoning models spend part of max_tokens thinking, so leave headroom.
        const j = await postJson(url, { authorization: `Bearer ${key}` }, { model: m, messages, max_tokens: Math.round((maxTokens + headroom) * (1 + attempt * 0.8)), temperature: 0.3 }, timeout, label, fetchImpl);
        const text = String(j.choices?.[0]?.message?.content || '').trim();
        if (!text) {
          lastErr = new Error(`${label} model ${m} returned no text`);
          break;
        }
        // When the token budget runs out mid-thought, a reasoning model can hand back its planning
        // notes instead of the answer. Retry with a larger budget rather than pass those on.
        if (looksLikeReasoning(text)) {
          lastErr = new Error(`${label} model ${m} returned its reasoning instead of an answer`);
          continue;
        }
        return text;
      } catch (err) {
        lastErr = err;
        if (/ API (404|410):/.test(err.message)) break;
        const transient = / API (429|5\d\d):|timed out|TimeoutError|aborted|fetch failed|ECONN|socket/i.test(err.message + ' ' + err.name);
        if (!transient) throw err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/** @returns {Promise<string>} the model's text */
export async function complete(prompt, { system = null, engine = defaultEngine(), model = null, maxTokens = 1400, timeout = 120000, fetchImpl = fetch } = {}) {
  if (engine === 'openai') {
    const key = openaiKey();
    if (!key) throw new Error('LLM_API_KEY is not set');
    const m = model || process.env.LLM_MODEL;
    if (!m) throw new Error('set LLM_MODEL (or pass --model) for the openai engine');
    const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return chatCompletions({ label: 'LLM', url: base + '/chat/completions', key, candidates: [m], system, prompt, maxTokens, timeout, fetchImpl, headroom: 1500 });
  }
  if (engine === 'nvidia') {
    const key = nvidiaKey();
    if (!key) throw new Error('NVIDIA_API_KEY is not set (env var or ~/.super_seo/config.json nvidiaApiKey)');
    const wanted = model || process.env.NVIDIA_MODEL;
    return chatCompletions({ label: 'NVIDIA', url: NVIDIA_URL, key, candidates: wanted ? [wanted] : NVIDIA_MODELS, system, prompt, maxTokens, timeout, fetchImpl, headroom: 2500 });
  }
  if (engine === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    const j = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model: model || process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] }, timeout, 'Anthropic', fetchImpl);
    return (j.content || []).map((c) => c.text || '').join('\n').trim();
  }
  return askClaudeCli(system ? `${system}\n\n${prompt}` : prompt, { model, timeout });
}

function askClaudeCli(prompt, { model, timeout }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'text'];
    if (model) args.push('--model', model);
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('claude CLI timed out'));
    }, timeout);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude CLI exited ${code}: ${err.slice(-300)}`));
      else resolve(out.trim());
    });
  });
}
