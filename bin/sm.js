#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';

// Optional .env files (existing environment variables win): the project folder, then ~/.super_seo.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of [path.join(root, '.env'), path.join(process.env.SUPER_SEO_HOME || path.join(os.homedir(), '.super_seo'), '.env')]) {
  try {
    process.loadEnvFile(f);
  } catch {
    // no file: fine
  }
  // blank placeholders (KEY=) count as unset, so a later file can still supply the value
  for (const k of Object.keys(process.env)) if (process.env[k] === '') delete process.env[k];
}

main(process.argv.slice(2)).catch((err) => {
  // A stack trace helps maintainers and confuses everyone else: show it only on request.
  console.error('sm: ' + (process.env.SM_DEBUG && err?.stack ? err.stack : err?.message || String(err)));
  process.exitCode = 1;
});
