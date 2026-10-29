// `sm mcp` — a stdio MCP server that exposes the CLI's read-only commands as tools, so an
// agent can call the same engine. Newline-delimited JSON-RPC 2.0; each tool shells out to
// `sm <command> --json` in a child process, so a failing command cannot take the server down.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/sm.js');

const domainTool = (name, command, description) => ({
  name,
  description,
  command,
  inputSchema: { type: 'object', properties: { domain: { type: 'string', description: 'e.g. example.com' } }, required: ['domain'] },
  args: (a) => [command, a.domain],
});

const TOOLS = [
  domainTool('popularity_rank', 'rank', 'Popularity rank from the Tranco list (and Cloudflare Radar when a token is set).'),
  domainTool('traffic_estimate', 'estimate', 'Rough traffic estimate from popularity rank with an 80% range (needs a calibration).'),
  domainTool('domain_intel', 'intel', 'Registration, DNS, mail, certificate-log subdomains and archive history.'),
  domainTool('wayback_history', 'wayback', 'Internet Archive capture history.'),
  domainTool('tech_stack', 'tech', 'Detected technology stack.'),
  domainTool('ai_readiness', 'geo', 'How ready the site is to be read and cited by AI assistants (crawler rules, llms.txt, structured data).'),
  {
    name: 'pagespeed',
    description: 'Google PageSpeed Insights: Lighthouse scores plus real-user Core Web Vitals for a URL (needs PSI_API_KEY).',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'e.g. https://example.com' } }, required: ['url'] },
    args: (a) => ['psi', a.url],
  },
  {
    name: 'wikipedia_demand',
    description: 'Monthly Wikipedia pageviews for an article title, as an interest trend.',
    inputSchema: { type: 'object', properties: { article: { type: 'string' } }, required: ['article'] },
    args: (a) => ['demand', a.article],
  },
];

function runSm(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SM, ...args, '--json', '--no-color'], { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 180000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && out.trim().length > 0, text: out.trim() || err.trim() || `exit ${code}` });
    });
  });
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: msg.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'super_seo', version: '0.1.0' } };
    case 'tools/list':
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) throw Object.assign(new Error('unknown tool'), { code: -32602 });
      const a = msg.params.arguments || {};
      for (const k of tool.inputSchema.required || []) {
        if (typeof a[k] !== 'string' || !a[k].trim() || a[k].startsWith('-')) throw Object.assign(new Error(`invalid argument: ${k}`), { code: -32602 });
      }
      const r = await runSm(tool.args(a));
      return { content: [{ type: 'text', text: r.text }], isError: !r.ok };
    }
    case 'ping':
      return {};
    default:
      throw Object.assign(new Error('method not found'), { code: -32601 });
  }
}

export async function run() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id === undefined) continue; // notification
      try {
        const result = await handle(msg);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
      } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }) + '\n');
      }
    }
  });
  await new Promise((resolve) => process.stdin.on('end', resolve));
}
