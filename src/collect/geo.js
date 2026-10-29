// Generative / answer-engine readiness: the deterministic half of "GEO / AEO tools". Checks what
// an AI crawler or answer engine can actually see on a site, with no model involved.

export const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Applebot-Extended'];

/** Parse robots.txt into per-agent disallow lists. */
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === 'user-agent') {
      if (!lastWasAgent) {
        cur = { agents: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.agents.push(m[2].toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && k === 'disallow' && m[2]) cur.disallow.push(m[2]);
      if (cur && k === 'allow' && m[2]) cur.allow.push(m[2]);
    }
  }
  return groups;
}

/** 'blocked' | 'allowed' | 'allowed (no rule)' for the site root, by the most specific matching group. */
export function crawlerStatus(groups, agent) {
  const a = agent.toLowerCase();
  const group = groups.find((g) => g.agents.includes(a)) || groups.find((g) => g.agents.includes('*'));
  if (!group) return 'allowed (no rule)';
  const specific = groups.some((g) => g.agents.includes(a));
  const blocked = group.disallow.includes('/') && !group.allow.includes('/');
  return blocked ? 'blocked' : specific ? 'allowed' : 'allowed (no rule)';
}

const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function jsonLdTypes(html) {
  const types = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      const t = n['@type'];
      for (const x of Array.isArray(t) ? t : t ? [t] : []) types.add(String(x));
      Object.values(n).forEach(walk);
    }
  };
  let invalid = 0;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      invalid++;
    }
  }
  return { types: [...types], invalid };
}

/** Analyse a fetched homepage + robots.txt + llms.txt. Pure: no network. */
export function analyseGeo({ html = '', robots = null, llmsTxt = false, url = '' }) {
  const groups = robots ? parseRobots(robots) : [];
  const crawlers = AI_CRAWLERS.map((c) => ({ agent: c, status: robots === null ? 'unknown (no robots.txt)' : crawlerStatus(groups, c) }));
  const ld = jsonLdTypes(html);
  const h1 = [...html.matchAll(/<h1[\s>]/gi)].length;
  const headings = [...html.matchAll(/<h([2-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => strip(m[2]));
  const questionHeadings = headings.filter((h) => /\?$|^(how|what|why|when|which|can|does|is|are)\b/i.test(h));
  const words = strip(html).split(' ').filter(Boolean).length;
  const meta = (n) => new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]+content=["']([^"']{1,400})`, 'i').exec(html)?.[1] || null;
  const checks = [
    ['Allows major AI crawlers', crawlers.filter((c) => c.status === 'blocked').length === 0, `${crawlers.filter((c) => c.status === 'blocked').map((c) => c.agent).join(', ') || 'none blocked'}`],
    ['Publishes /llms.txt', llmsTxt, llmsTxt ? 'present' : 'missing'],
    ['Structured data (JSON-LD)', ld.types.length > 0 && ld.invalid === 0, ld.types.slice(0, 8).join(', ') || 'none found'],
    ['Organization or Product entity markup', ld.types.some((t) => /^(Organization|Corporation|LocalBusiness|Product|WebSite)$/.test(t)), ''],
    ['FAQ / HowTo markup (answer-ready)', ld.types.some((t) => /^(FAQPage|HowTo|QAPage)$/.test(t)), ''],
    ['Exactly one h1', h1 === 1, `${h1} found`],
    ['Question-style headings', questionHeadings.length >= 2, `${questionHeadings.length} of ${headings.length} h2/h3`],
    ['Meta description', !!meta('description'), meta('description') ? 'present' : 'missing'],
    ['Canonical URL', /<link[^>]+rel=["']canonical["']/i.test(html), ''],
    ['Substantive text (300+ words)', words >= 300, `${words} words in the HTML`],
  ].map(([name, pass, detail]) => ({ name, pass: !!pass, detail }));
  return { url, score: Math.round((checks.filter((c) => c.pass).length / checks.length) * 100), checks, crawlers, structuredData: ld, words };
}

export async function geoCheck(http, domain) {
  const base = 'https://' + domain;
  const get = async (p) => {
    try {
      return await http.get(base + p);
    } catch {
      return { status: 0, text: () => '' };
    }
  };
  const [home, robots, llms] = await Promise.all([get('/'), get('/robots.txt'), get('/llms.txt')]);
  if (home.status !== 200) throw new Error(`homepage returned HTTP ${home.status}`);
  const isText = llms.status === 200 && !/<html/i.test(llms.text().slice(0, 500));
  return analyseGeo({ html: home.text(), robots: robots.status === 200 ? robots.text() : null, llmsTxt: isText, url: base + '/' });
}
