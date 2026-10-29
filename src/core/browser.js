// A minimal Chrome DevTools Protocol client over Node's native WebSocket.
//
// No puppeteer, no npm dependencies. Chrome is launched headless with a private
// user-data-dir, on a port the OS picks, and is always torn down: the process tree is
// killed, the temp profile removed, and the port confirmed free.
//
// Only the PID we spawned is ever signalled — other Chrome instances are untouched.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { UA } from './http.js';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  constructor({ proc, ws, port, profileDir, userDataDir }) {
    this.proc = proc;
    this.ws = ws;
    this.port = port;
    this.profileDir = profileDir;
    this.userDataDir = userDataDir;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.sessionId = null;
    this.targetId = null;
    this.closed = false;
    this.log = [];

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const key = msg.sessionId ? `${msg.sessionId}:${msg.method}` : msg.method;
        for (const fn of this.listeners.get(key) || []) fn(msg.params);
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }

  send(method, params = {}, sessionId = this.sessionId) {
    if (this.closed) return Promise.reject(new Error('browser closed'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
      timer.unref?.();
      const wrap = (fn) => (v) => {
        clearTimeout(timer);
        fn(v);
      };
      this.pending.set(id, { resolve: wrap(resolve), reject: wrap(reject) });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  on(event, fn) {
    const key = this.sessionId ? `${this.sessionId}:${event}` : event;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
    return () => {
      const arr = this.listeners.get(key) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  /** Open a page target and attach to it. */
  async openPage(url = 'about:blank') {
    const { targetId } = await this.send('Target.createTarget', { url }, null);
    this.targetId = targetId;
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true }, null);
    this.sessionId = sessionId;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    return sessionId;
  }

  /** Navigate and wait for load (plus a short settle for client-side rendering). */
  async navigate(url, { timeout = 45000, settle = 1200 } = {}) {
    const loaded = new Promise((resolve) => {
      const off = this.on('Page.loadEventFired', () => {
        off();
        resolve(true);
      });
      setTimeout(() => {
        off();
        resolve(false);
      }, timeout).unref?.();
    });
    const nav = await this.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`navigate failed: ${nav.errorText}`);
    await loaded;
    if (settle) await sleep(settle);
    return nav;
  }

  /** Evaluate an expression in the page and return the JSON value. */
  async evaluate(expression, { awaitPromise = true, timeout = 45000 } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page exception: ${d.exception?.description || d.text}`);
    }
    return res.result?.value;
  }

  /** The current document HTML. */
  async html() {
    return this.evaluate('document.documentElement.outerHTML');
  }

  /** Run a script in every new document, before the page's own scripts. */
  async addInitScript(source) {
    const r = await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return r.identifier;
  }

  /**
   * Same-origin fetch executed inside the page. This is how we beat a CloudFront
   * bot challenge: the request carries the browser's TLS fingerprint and cookies.
   */
  async fetchText(url, { method = 'GET', body = null, headers = {} } = {}) {
    const expr = `(async () => {
      const res = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(headers)},
        ${body ? `body: ${JSON.stringify(body)},` : ''}
        credentials: 'include',
      });
      const text = await res.text();
      return JSON.stringify({ status: res.status, text, len: text.length });
    })()`;
    const out = await this.evaluate(expr);
    if (!out) throw new Error('fetch returned nothing');
    return JSON.parse(out);
  }

  /** Cookies for a URL, as a cookie header string. */
  async cookiesFor(url) {
    const { cookies } = await this.send('Network.getCookies', { urls: [url] });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    for (const { reject } of this.pending.values()) reject(new Error('browser closed'));
    this.pending.clear();
  }
}

/**
 * Launch Chrome and return a connected Browser.
 * The caller MUST call `browser.shutdown()` — use try/finally.
 */
export async function launchBrowser({ headless = true, timeout = 30000, verbose = false } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found (set CHROME_PATH)');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-chrome-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--user-agent=${UA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1440,900',
    '--lang=en-US',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const proc = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false, windowsHide: true });
  let stderr = '';
  if (proc.stderr) proc.stderr.on('data', (d) => (stderr += d.toString()));
  if (proc.stdout) proc.stdout.resume();

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeout;
  let port = null;
  let wsPath = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Chrome exited (${proc.exitCode}): ${stderr.slice(-400)}`);
    }
    try {
      const raw = fs.readFileSync(portFile, 'utf8').split('\n');
      if (raw.length >= 2 && raw[0].trim()) {
        port = Number(raw[0].trim());
        wsPath = raw[1].trim();
        break;
      }
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  if (!port) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw new Error(`Chrome did not report a debugging port: ${stderr.slice(-400)}`);
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath.startsWith('/') ? wsPath : '/' + wsPath}`);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('CDP websocket connect timeout')), 15000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(t);
      reject(new Error('CDP websocket error: ' + (e.message || 'unknown')));
    });
  });

  const browser = new Browser({ proc, ws, port, profileDir: portFile, userDataDir });
  if (verbose) browser.log.push({ event: 'launched', port, pid: proc.pid });
  return browser;
}

/**
 * Kill any Chrome process whose command line references our temp profile.
 * This is how we clean up Chrome's helper processes, which taskkill's /T flag does not
 * always reach. The filter is our own unique --user-data-dir, so the user's own Chrome
 * instances are never touched.
 */
export async function killChromeForProfile(userDataDir) {
  if (process.platform !== 'win32') {
    // POSIX: match only processes started with our own unique profile directory.
    return new Promise((resolve) => {
      const p = spawn('pkill', ['-f', '--', `--user-data-dir=${userDataDir}`], { stdio: 'ignore' });
      p.on('exit', () => resolve(0));
      p.on('error', () => resolve(0));
      setTimeout(() => resolve(0), 5000);
    });
  }
  const script =`$needle='${userDataDir.replace(/'/g, "''")}';`
    + `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | `
    + `Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | `
    + `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    p.on('exit', () => resolve(0));
    p.on('error', () => resolve(0));
    setTimeout(() => resolve(0), 15000);
  });
}

/** Kill the browser process tree and remove the temp profile. Only our own PID. */
export async function shutdownBrowser(browser) {
  if (!browser) return;
  const { proc, port, userDataDir } = browser;
  await browser.close().catch(() => {});
  if (proc && proc.exitCode === null) {
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const k = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        k.on('exit', resolve);
        k.on('error', resolve);
        setTimeout(resolve, 8000);
      });
    } else {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
  // Chrome's helper processes can survive the tree kill; sweep the ones bound to our profile.
  await killChromeForProfile(userDataDir);
  // The child's stdout/stderr pipes are ref'd net.Sockets in this process; leaving them open
  // keeps the event loop alive forever. Destroy them explicitly.
  for (const stream of [proc?.stdout, proc?.stderr, proc?.stdin]) {
    try {
      stream?.destroy();
    } catch {
      /* ignore */
    }
  }
  try {
    proc?.unref?.();
  } catch {
    /* ignore */
  }
  // Chrome releases its profile files a moment after exit; retry instead of leaking the dir.
  for (let i = 0; i < 12; i++) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* retry below */
    }
    if (!fs.existsSync(userDataDir)) break;
    await sleep(400);
  }
  if (port) await waitPortFree(port, 5000);
}

/** True when nothing is listening on the port. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

export async function waitPortFree(port, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Run a function with a browser, guaranteeing teardown.
 * The exit hook is the safety net for Ctrl-C and uncaught exceptions.
 */
export async function withBrowser(fn, opts = {}) {
  let browser = null;
  let done = false;
  const cleanup = async () => {
    if (done) return;
    done = true;
    await shutdownBrowser(browser).catch(() => {});
  };
  const hook = () => {
    try {
      if (browser && browser.proc && browser.proc.exitCode === null) {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(browser.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else browser.proc.kill('SIGKILL');
      }
    } catch {
      /* ignore */
    }
  };
  process.on('exit', hook);
  process.on('SIGINT', () => {
    hook();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    hook();
    process.exit(143);
  });
  try {
    browser = await launchBrowser(opts);
    return await fn(browser);
  } finally {
    process.removeListener('exit', hook);
    await cleanup();
  }
}
