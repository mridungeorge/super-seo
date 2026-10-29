// Free public data sources that need no key: Wayback CDX, RDAP, DNS, certificate transparency,
// Wikimedia pageviews. Each returns null/[] on failure rather than throwing, so a flaky
// service degrades one section instead of the whole command.

import dns from 'node:dns/promises';

const UA = 'super_seo/0.1 (internal research tool)';

async function getJson(url, ms = 20000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Snapshot counts per year and first/last capture from the Internet Archive. */
export async function wayback(domain) {
  const rows = await getJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp,statuscode&collapse=timestamp:6&limit=5000`, 45000);
  if (!rows || rows.length < 2) return null;
  const data = rows.slice(1);
  const perYear = {};
  for (const [ts] of data) perYear[ts.slice(0, 4)] = (perYear[ts.slice(0, 4)] || 0) + 1;
  const fmt = (t) => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return { firstSeen: fmt(data[0][0]), lastSeen: fmt(data[data.length - 1][0]), monthsWithSnapshots: data.length, perYear };
}

/** Registration facts from RDAP (the redirector picks the right registry). */
export async function rdap(domain) {
  const j = await getJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (!j) return null;
  const ev = (a) => (j.events || []).find((e) => e.eventAction === a)?.eventDate || null;
  const registrar = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const name = registrar?.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3] || null;
  return {
    registered: ev('registration'),
    expires: ev('expiration'),
    changed: ev('last changed'),
    registrar: name,
    nameservers: (j.nameservers || []).map((n) => String(n.ldhName).toLowerCase()),
    status: j.status || [],
  };
}

export async function dnsRecords(domain) {
  const tryIt = async (fn) => {
    try {
      return await fn();
    } catch {
      return [];
    }
  };
  const [a, aaaa, mx, ns, txt] = await Promise.all([
    tryIt(() => dns.resolve4(domain)),
    tryIt(() => dns.resolve6(domain)),
    tryIt(() => dns.resolveMx(domain)),
    tryIt(() => dns.resolveNs(domain)),
    tryIt(() => dns.resolveTxt(domain)),
  ]);
  const txts = txt.map((r) => r.join(''));
  return {
    a,
    aaaa,
    mx: mx.sort((x, y) => x.priority - y.priority).map((m) => m.exchange),
    ns,
    spf: txts.find((t) => t.startsWith('v=spf1')) || null,
    verifications: txts
      .filter((t) => /site-verification|^ms=|facebook-domain-verification|atlassian-domain|docusign|stripe-verification|adobe-idp/i.test(t))
      .map((t) => t.split(/[=:]/)[0]),
  };
}

/** Subdomains seen in public certificate logs (best effort; crt.sh is slow and often down). */
export async function subdomains(domain) {
  const rows = await getJson(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, 30000);
  if (!rows) return null;
  const set = new Set();
  for (const r of rows) {
    for (const n of String(r.name_value).split('\n')) {
      const h = n.trim().toLowerCase().replace(/^\*\./, '');
      if (h.endsWith(domain) && /^[a-z0-9.-]+$/.test(h)) set.add(h);
    }
  }
  return [...set].sort();
}

/** Monthly Wikipedia pageviews for an article: a public interest proxy. */
export async function wikiPageviews(title, { months = 24, project = 'en.wikipedia' } = {}) {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  const j = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${slug}/monthly/${ymd(start)}/${ymd(end)}`);
  return j?.items ? j.items.map((i) => ({ month: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}`, views: i.views })) : null;
}
