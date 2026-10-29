// Runs the opt-in live tests (they touch the network). A script rather than `SM_LIVE=1 node ...` so it
// works the same on Windows, macOS and Linux.

import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['--test', 'test/live.test.js'], { stdio: 'inherit', env: { ...process.env, SM_LIVE: '1' } });
process.exitCode = r.status ?? 1;
