// Static checks that need no dependencies: every JavaScript file parses, and nothing that looks like a
// secret has been committed. Run with `npm run check`; CI runs it on every push.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'scans', 'var']);
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.venv')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(root);

let failed = 0;
for (const f of files.filter((x) => /\.(js|mjs)$/.test(x))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`syntax error: ${path.relative(root, f)}\n${r.stderr.split('\n').slice(0, 4).join('\n')}`);
  }
}

// Things that must never be committed: real-looking keys, private files.
const SECRET = /(AIza[0-9A-Za-z_-]{30,}|nvapi-[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
for (const f of files) {
  const rel = path.relative(root, f);
  if (/(^|[\\/])\.env$/.test(rel)) {
    failed++;
    console.error(`private file present: ${rel} (it is git-ignored, but do not publish this folder as-is)`);
    continue;
  }
  if (!/\.(js|mjs|json|md|yml|yaml|txt|example|csv|html)$/.test(rel) || fs.statSync(f).size > 2_000_000) continue;
  if (SECRET.test(fs.readFileSync(f, 'utf8'))) {
    failed++;
    console.error(`looks like a secret: ${rel}`);
  }
}

if (failed) {
  console.error(`\n${failed} problem(s)`);
  process.exitCode = 1;
} else {
  console.log(`ok: ${files.filter((x) => /\.(js|mjs)$/.test(x)).length} files parse, no secrets found`);
}
