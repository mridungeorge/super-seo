// Bridge to the optional Scrapling parser: a long-lived Python worker that turns HTML into the same
// "parts" shape as the built-in regex engine. It parses only; fetching stays in crawl.js, so a site
// that refuses our requests stays refused.
//
// Setup (once):  python -m venv .venv-scrapling   then   .venv-scrapling/Scripts/pip install scrapling

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { ROOT } from '../cli.js';

const WORKER = path.join(ROOT, 'scripts', 'scrapling_worker.py');

export function findPython() {
  if (process.env.SCRAPLING_PYTHON && fs.existsSync(process.env.SCRAPLING_PYTHON)) return process.env.SCRAPLING_PYTHON;
  for (const rel of [['.venv-scrapling', 'Scripts', 'python.exe'], ['.venv-scrapling', 'bin', 'python']]) {
    const p = path.join(ROOT, ...rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** @returns {Promise<{parts:(html:string,url:string)=>Promise<object|null>, close:()=>void}>} */
export async function startScrapling({ timeout = 20000 } = {}) {
  const py = findPython();
  if (!py) throw new Error('Scrapling is not installed (no .venv-scrapling; see src/collect/scrapling.js for setup)');
  const child = spawn(py, ['-I', WORKER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  let nextId = 1;
  let dead = null;
  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-400)));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg.error ? null : msg.parts);
  });
  child.on('exit', (code) => {
    dead = `worker exited (${code}) ${stderr.trim().split('\n').pop() || ''}`.trim();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
    pending.clear();
  });
  child.on('error', (e) => (dead = e.message));

  const request = (html, url) =>
    new Promise((resolve) => {
      if (dead) return resolve(null);
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, timeout);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({ id, html, url }) + '\n');
    });

  // A first round trip proves the import works before the crawl depends on it.
  const probe = await request('<html lang="en"><head><title>x</title></head><body><h1>x</h1></body></html>', 'https://example.com/');
  if (!probe) {
    child.kill();
    throw new Error('Scrapling worker did not start: ' + (dead || stderr.trim().split('\n').pop() || 'no reply'));
  }
  return { parts: request, close: () => child.kill() };
}
