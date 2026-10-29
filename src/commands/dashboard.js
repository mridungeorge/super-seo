// `sm dashboard <scan-folder>`: (re)build dashboard.html from a folder written by `sm scan`.

import fs from 'node:fs';
import path from 'node:path';
import { buildDashboard } from '../core/dashboard.js';

export async function run(ctx) {
  const dir = ctx.args._[0];
  if (!dir || !fs.existsSync(dir)) {
    console.error('usage: sm dashboard <scan-folder>');
    process.exitCode = 1;
    return;
  }
  console.log(buildDashboard(path.resolve(dir)));
}
