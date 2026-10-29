// Turns a scan folder (the per-step JSON files written by `sm scan`) into one self-contained,
// interactive dashboard.html laid out like an SEO tool's domain overview: score tiles, trend and
// donut charts, tables you can sort, filter and export, and a sidebar of tabs. Inline CSS and SVG,
// no external assets. A step that failed or was refused by the site shows up as a labelled gap.

import fs from 'node:fs';
import path from 'node:path';
import { competitorData } from './competitors.js';
import { esc, isNum, num, pct, compact, short, PALETTE, delta, spark, donut, area, columns, hbars, ring, stack, CHART_CSS } from './charts.js';

const secs = (n) => (isNum(n) ? `${Math.floor(n / 60)}m ${Math.round(n % 60)}s` : '—');
const ms = (n) => (isNum(n) ? (n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms') : '—');
const pathOf = (u) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search || '/';
  } catch {
    return u;
  }
};

const STYLE = `
:root{--bg:#0e1116;--panel:#161a22;--panel2:#1b2029;--line:#262c38;--text:#e7eaf0;--dim:#97a1b0;--accent:#4f8cff;--good:#3ec28a;--warn:#e9b949;--bad:#ef6b6b}
@media (prefers-color-scheme: light){:root{--bg:#f3f4f7;--panel:#fff;--panel2:#f7f8fa;--line:#e3e6ec;--text:#1a1e26;--dim:#5a6372;--accent:#2563d9;--good:#14915a;--warn:#a87400;--bad:#c33a3a}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:grid;grid-template-columns:210px 1fr;min-height:100vh}
aside{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--panel);border-right:1px solid var(--line);padding:16px 10px}
aside h1{font-size:15px;margin:0 6px 1px;word-break:break-all}aside .sub{color:var(--dim);font-size:11.5px;margin:0 6px 10px}
aside .grp{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:12px 8px 3px}
aside a{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;color:var(--text);text-decoration:none;font-size:13px}
aside a:hover{background:var(--panel2)}aside a.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);font-weight:600}
aside a b{font-size:11px;font-weight:600;padding:0 6px;border-radius:99px;background:var(--line);color:var(--dim)}aside a b.e{background:color-mix(in srgb,var(--bad) 22%,transparent);color:var(--bad)}
main{padding:18px 22px 60px;min-width:0}
.panel{display:none}.panel.on{display:block}
.head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 14px}.head h2{font-size:21px;margin:0}.chip{font-size:11.5px;color:var(--dim);border:1px solid var(--line);border-radius:99px;padding:1px 9px}
h3{font-size:12px;margin:0 0 10px;color:var(--dim);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.sec{font-size:12px;margin:22px 0 8px;color:var(--dim);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin:0 0 14px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:92px}
.tile span{color:var(--dim);font-size:12px;display:block}.tile b{display:block;font-size:24px;line-height:1.2;font-variant-numeric:tabular-nums}.tile b span{display:inline;font-size:inherit}.tile b .good{color:var(--good)}.tile b .warn{color:var(--warn)}.tile b .bad{color:var(--bad)}
.tile small{display:block;color:var(--dim);font-size:11.5px;margin-top:2px}
.g{display:grid;gap:12px;margin:0 0 14px}.g2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
table{width:100%;border-collapse:collapse;font-size:13px;background:var(--panel);border:1px solid var(--line);border-radius:12px}
.card table{border:none;background:none}
th,td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11.5px;white-space:nowrap;background:var(--panel2)}tr:last-child td{border-bottom:none}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.dt th{cursor:pointer;user-select:none}.dt th:hover{color:var(--accent)}.dt th.asc:after{content:" ▲"}.dt th.desc:after{content:" ▼"}
.dt-tools{display:flex;gap:8px;align-items:center;margin:0 0 8px;flex-wrap:wrap}
.dt-tools input{flex:1;min-width:160px;max-width:320px;background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:5px 10px;font:inherit}
.dt-tools button{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:4px 10px;font:inherit;cursor:pointer}.dt-tools button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}.dt-tools button:disabled{opacity:.4;cursor:default}
.dt-tools .count{color:var(--dim);font-size:12px;margin-left:auto}
.scroll{overflow-x:auto;border-radius:12px}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.dim{color:var(--dim)}
.pill{display:inline-block;padding:0 8px;border-radius:99px;font-size:11.5px;border:1px solid currentColor;white-space:nowrap}
.gap{border:1px dashed var(--line);border-radius:12px;padding:12px 16px;color:var(--dim);margin:0 0 14px}.gap b{color:var(--warn)}
.note{color:var(--dim);font-size:12px;margin:6px 0 12px}
details{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:8px 0;padding:0 14px}
details.in{background:none;border:none;margin:0;padding:0}details.in summary{padding:0;font-weight:400;color:var(--accent)}details.in[open]>summary{border:none;margin:0 0 6px}
summary{cursor:pointer;padding:10px 0;font-weight:600}details[open]>summary{border-bottom:1px solid var(--line);margin-bottom:10px}
.prose p{margin:6px 0}.prose ul{margin:6px 0 6px 18px;padding:0}.prose{padding-bottom:12px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.urls{max-height:240px;overflow:auto;margin:4px 0 8px;font-size:12px}.urls div{padding:1px 0;word-break:break-all}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.rings{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
.fix{display:grid;grid-template-columns:70px 1fr auto;gap:10px;align-items:center;padding:7px 12px;background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:0 0 6px;font-size:13px}
.fix.error{border-left:3px solid var(--bad)}.fix.warning{border-left:3px solid var(--warn)}.fix.notice{border-left:3px solid var(--dim)}.fix b{font-variant-numeric:tabular-nums}
.cwv{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.cwv div{border:1px solid var(--line);border-radius:10px;padding:8px 10px}.cwv span{display:block;font-size:11.5px;color:var(--dim)}.cwv b{font-size:19px;font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:1fr auto;gap:2px 10px;font-size:13px}.kv span{color:var(--dim)}.kv b{text-align:right;font-variant-numeric:tabular-nums}
${CHART_CSS}
@media (max-width:860px){body{grid-template-columns:1fr}aside{position:static;height:auto;display:flex;flex-wrap:wrap;gap:2px;border-right:none;border-bottom:1px solid var(--line)}aside .grp{width:100%}main{padding:14px 12px 50px}}
@media print{aside{display:none}body{display:block}.panel{display:block!important;page-break-before:always}}
`;

const SCRIPT = `
(function(){
  var panels=[].slice.call(document.querySelectorAll('.panel')),links=[].slice.call(document.querySelectorAll('aside a'));
  function show(){var id=(location.hash||'#overview').slice(1);if(!document.getElementById('p-'+id))id='overview';
    panels.forEach(function(p){p.classList.toggle('on',p.id==='p-'+id)});links.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+id)});window.scrollTo(0,0)}
  window.addEventListener('hashchange',show);show();
  [].forEach.call(document.querySelectorAll('.dt-wrap'),function(w){
    var t=w.querySelector('table'),tb=t.tBodies[0],rows=[].slice.call(tb.rows),size=+w.dataset.page||50,page=0,q='',sortCol=-1,dir=1;
    var inp=w.querySelector('input'),cnt=w.querySelector('.count'),btn=w.querySelector('button'),more=w.querySelector('.more');
    var shown=rows.slice();
    function render(){
      shown=rows.filter(function(r){return !q||r.textContent.toLowerCase().indexOf(q)>-1});
      if(sortCol>-1)shown.sort(function(a,b){var x=a.cells[sortCol],y=b.cells[sortCol],xv=x.dataset.v!==undefined?x.dataset.v:x.textContent,yv=y.dataset.v!==undefined?y.dataset.v:y.textContent,xn=parseFloat(xv),yn=parseFloat(yv);
        if(!isNaN(xn)&&!isNaN(yn)&&xv!==''&&yv!=='')return(xn-yn)*dir;return String(xv).localeCompare(String(yv))*dir});
      var pages=Math.max(1,Math.ceil(shown.length/size));if(page>=pages)page=pages-1;
      rows.forEach(function(r){r.style.display='none'});
      shown.slice(page*size,(page+1)*size).forEach(function(r){r.style.display='';tb.appendChild(r)});
      cnt.textContent=shown.length+' of '+rows.length+(pages>1?' · page '+(page+1)+'/'+pages:'');
      if(more){more.style.display=pages>1?'':'none';more.querySelector('.pp').disabled=page===0;more.querySelector('.pn').disabled=page>=pages-1}
    }
    inp.addEventListener('input',function(){q=inp.value.toLowerCase();page=0;render()});
    [].forEach.call(t.tHead.rows[0].cells,function(th,i){th.addEventListener('click',function(){if(sortCol===i)dir=-dir;else{sortCol=i;dir=1}
      [].forEach.call(t.tHead.rows[0].cells,function(c){c.classList.remove('asc','desc')});th.classList.add(dir>0?'asc':'desc');page=0;render()})});
    if(more){more.querySelector('.pp').onclick=function(){page--;render()};more.querySelector('.pn').onclick=function(){page++;render()}}
    btn.addEventListener('click',function(){var head=[].map.call(t.tHead.rows[0].cells,function(c){return c.textContent}),
      lines=[head].concat(shown.map(function(r){return[].map.call(r.cells,function(c){return c.textContent.replace(/\\s+/g,' ').trim()})}));
      var csv=lines.map(function(l){return l.map(function(v){return '"'+v.replace(/"/g,'""')+'"'}).join(',')}).join('\\n');
      var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=(w.dataset.name||'table')+'.csv';a.click()});
    render();
  });
})();
`;

// ---------- building blocks ----------

/** Cells are strings, or {h: html, v: sort value}. */
function dt(name, headers, rows, { align = [], page = 50 } = {}) {
  const th = headers.map((h, i) => `<th${align[i] === 'r' ? ' class="r"' : ''}>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => '<tr>' + r.map((c, i) => { const o = typeof c === 'object' && c !== null ? c : { h: c }; return `<td${align[i] === 'r' ? ' class="r"' : ''}${o.v !== undefined && o.v !== null ? ` data-v="${esc(o.v)}"` : ''}>${o.h}</td>`; }).join('') + '</tr>').join('');
  return `<div class="dt-wrap" data-page="${page}" data-name="${esc(name)}"><div class="dt-tools"><input type="search" placeholder="Filter…"><button type="button">CSV</button><span class="count"></span></div><div class="scroll"><table class="dt"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div><div class="more dt-tools" style="margin-top:8px"><button type="button" class="pp">‹</button><button type="button" class="pn">›</button></div></div>`;
}
function table(headers, rows, align = []) {
  const th = headers.map((h, i) => `<th${align[i] === 'r' ? ' class="r"' : ''}>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => '<tr>' + r.map((c, i) => `<td${align[i] === 'r' ? ' class="r"' : ''}>${c}</td>`).join('') + '</tr>').join('');
  return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
const card = (title, body) => `<div class="card">${title ? `<h3>${esc(title)}</h3>` : ''}${body}</div>`;
const grid = (cls, cards) => `<div class="g ${cls}">${cards.filter(Boolean).join('')}</div>`;
const tile = (label, value, { sub = '', d = '', sp = '', rg = null } = {}) => `<div class="tile"><div><span>${esc(label)}</span><b>${value}${d}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${sp}</div>${rg !== null ? ring(rg, '', { size: 62 }) : ''}</div>`;
const gap = (title, why) => `<div class="gap"><b>${esc(title)}</b> ${esc(why || '')}</div>`;
const sevPill = (s) => `<span class="pill ${s === 'error' ? 'bad' : s === 'warning' ? 'warn' : 'dim'}">${esc(s)}</span>`;
const link = (u, label) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}">${esc(label ?? short(pathOf(u), 60))}</a>`;
const rating = (r) => {
  const k = String(r || '').toLowerCase();
  const cls = k === 'fast' || k === 'good' ? 'good' : k === 'average' || k === 'needs-improvement' ? 'warn' : k === 'slow' || k === 'poor' ? 'bad' : 'dim';
  return `<span class="${cls}">${esc(k || '')}</span>`;
};
const none = '<span class="dim">—</span>';
const o = (v, fmt = (n) => num(n)) => (isNum(v) ? fmt(v) : none);

function prose(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  let html = '';
  let list = false;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) html += '<ul>';
      list = true;
      html += `<li>${inline(item[1])}</li>`;
      continue;
    }
    if (list) html += '</ul>';
    list = false;
    if (line) html += `<p>${inline(/^#+\s*/.test(line) ? '**' + line.replace(/^#+\s*/, '') + '**' : line)}</p>`;
  }
  if (list) html += '</ul>';
  return `<div class="prose">${html}</div>`;
}

// ---------- the scan folder ----------

const NAMES = ['probe', 'estimate', 'radar', 'rank', 'crawl', 'psi', 'psi-desktop', 'psi-page-1', 'psi-page-2', 'psi-page-3', 'competitor-1-crawl', 'competitor-1-psi', 'competitor-2-crawl', 'competitor-2-psi', 'competitor-3-crawl', 'competitor-3-psi', 'tech', 'geo', 'keywords-brand', 'keywords-topic', 'keywords', 'serp', 'intel', 'wayback', 'ai', 'strategy-marketing', 'strategy-content', 'geo-plan', 'sales-score', 'summary'];

function load(dir) {
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  return Object.fromEntries(NAMES.map((n) => [n, read(n)]));
}

const stepNote = (d, name) => {
  const s = d.summary?.steps?.find((x) => x.name === name);
  return s ? (s.status === 'skipped' ? `skipped: ${s.note}` : s.status === 'FAILED' ? `failed: ${s.note || 'no output'}` : '') : 'not run';
};
const crawlOk = (d) => d.crawl && !d.crawl.blocked && d.crawl.summary;

// ---------- priority actions (numbers first, words short) ----------

function actions(d) {
  const out = [];
  const push = (severity, area, title, why, panel, count = null) => out.push({ severity, area, title, why, panel, count });
  const c = d.crawl;
  if (c?.blocked) push('error', 'Crawl', 'Site blocked our crawler', c.blockedReason, 'audit');
  if (crawlOk(d)) {
    const n = c.summary.pages;
    for (const i of c.issues.filter((x) => x.severity === 'error').slice(0, 4)) push('error', i.category, `${i.title}: ${num(i.count)} of ${num(n)} pages`, i.fix, 'issues', i.count);
    for (const i of c.issues.filter((x) => x.severity === 'warning').slice(0, 5)) push('warning', i.category, `${i.title}: ${num(i.count)} of ${num(n)} pages`, i.fix, 'issues', i.count);
    for (const sc of c.siteChecks.filter((x) => !x.pass)) push('warning', 'Technical', `${sc.title}: failed`, sc.detail, 'audit');
    if (c.links.brokenExternal?.length) push('warning', 'Links', `${c.links.brokenExternal.length} broken outbound links`, 'Fix or remove', 'links', c.links.brokenExternal.length);
    for (const g of [['titles', 'duplicate titles'], ['descriptions', 'duplicate meta descriptions']]) if (c.duplicates[g[0]].length) push('warning', 'Content', `${c.duplicates[g[0]].length} ${c.duplicates[g[0]].length === 1 ? 'set' : 'sets'} of ${g[1]}`, `largest: ${c.duplicates[g[0]][0].count} pages`, 'content', c.duplicates[g[0]].length);
  }
  const p = d.psi;
  if (p?.scores && p.scores.performance < 90) push(p.scores.performance < 50 ? 'error' : 'warning', 'Speed', `Mobile speed score ${p.scores.performance}/100`, p.topIssues?.[0] ? `${p.topIssues[0].title}${p.topIssues[0].savings ? ` (−${ms(p.topIssues[0].savings)})` : ''}` : '', 'performance', p.scores.performance);
  for (const k of ['lcp', 'inp', 'cls']) {
    const f = p?.field?.[k] || p?.originField?.[k];
    if (f && /slow|poor/i.test(f.rating)) push('error', 'Core Web Vitals', `Real-user ${k.toUpperCase()} ${k === 'cls' ? f.p75 : ms(f.p75)} (poor)`, 'ranking signal', 'performance');
  }
  const g = d.geo?.geo;
  if (g) for (const ck of g.checks.filter((x) => !x.pass).slice(0, 3)) push('notice', 'AI search', `${ck.name}: ${ck.detail}`, '', 'ai');
  if (d.ai && aiStats(d.ai).rate !== null && aiStats(d.ai).rate < 0.6) push('warning', 'AI search', `Named in ${aiStats(d.ai).named} of ${aiStats(d.ai).answered} AI answers`, '', 'ai');
  if (d.ai && aiStats(d.ai).failed) push('notice', 'AI search', `${aiStats(d.ai).failed} of ${d.ai.results.length} AI questions failed`, 'rerun later', 'ai');
  const rank = ['error', 'warning', 'notice'];
  return out.sort((a, b) => rank.indexOf(a.severity) - rank.indexOf(b.severity)).slice(0, 12);
}

const aiStats = (a) => {
  const named = a.results.filter((r) => r.mentioned === true).length;
  const failed = a.results.filter((r) => r.error).length;
  const answered = a.results.length - failed;
  return { named, failed, answered, notNamed: answered - named, rate: answered ? named / answered : null };
};

const fixRows = (list) => list.map((a) => `<div class="fix ${a.severity}">${sevPill(a.severity)}<div><b>${esc(a.title)}</b>${a.why ? ` <span class="dim">· ${esc(short(a.why, 90))}</span>` : ''}</div><a href="#${a.panel}">›</a></div>`).join('');

// ---------- shared data pulls ----------

/** Tranco rank history for the scanned site, oldest first. */
function rankSeries(d) {
  const h = d.rank?.rows?.[0]?.tranco?.history || [];
  return h.slice().reverse().map((x) => ({ label: String(x.date).slice(5), value: x.rank }));
}

function overview(d, domain) {
  const c = crawlOk(d) ? d.crawl : null;
  const self = d.rank?.rows?.[0];
  const hist = rankSeries(d);
  const ps = d.psi?.scores;
  const live = (d.serp?.results || []).filter((r) => !r.error);
  const ai = d.ai ? aiStats(d.ai) : null;
  const out = [];
  if (d.summary?.demo) out.push(gap('Demo data.', 'A generated shop crawled by the real crawler; the speed, rank, search and AI figures are made up to show the layout.'));
  const top = [];
  top.push(tile('Site health', c ? c.summary.healthScore + '%' : '—', { sub: c ? `${num(c.summary.errors)} errors · ${num(c.summary.warnings)} warnings` : d.crawl?.blocked ? 'site blocked the crawl' : 'no crawl', rg: c ? c.summary.healthScore : null }));
  top.push(tile('Mobile speed', ps ? String(ps.performance) : '—', { sub: ps ? `SEO ${ps.seo} · A11y ${ps.accessibility}` : '', rg: ps ? ps.performance : null }));
  top.push(tile('Desktop speed', d['psi-desktop']?.scores ? String(d['psi-desktop'].scores.performance) : '—', { rg: d['psi-desktop']?.scores ? d['psi-desktop'].scores.performance : null }));
  top.push(tile('AI-readiness', d.geo?.geo ? `${d.geo.geo.score}/100` : '—', { sub: ai ? `named in ${ai.named} of ${ai.answered} AI answers` : '', rg: d.geo?.geo ? d.geo.geo.score : null }));
  top.push(tile('Popularity rank', self?.tranco ? '#' + num(self.tranco.rank) : '—', { d: hist.length > 1 ? delta(hist[hist.length - 1].value, hist[0].value, { invert: true }) : '', sub: self?.radar ? (self.radar.rank ? `Radar #${num(self.radar.rank)}` : `Radar: top ${num(self.radar.bucket)}`) : 'Tranco list', sp: spark(hist.map((p) => p.value)) }));
  top.push(tile('Pages crawled', c ? num(c.summary.pages) : '—', { sub: c ? `${num(c.summary.indexable)} indexable${c.complete ? '' : ' · sample'}` : '' }));
  top.push(tile('Top-10 keywords', live.length ? `${live.filter((r) => r.found).length}/${live.length}` : '—', { sub: live.length ? 'live check' : 'not run' }));
  top.push(tile('Named in AI answers', ai ? `${ai.named}/${ai.answered}` : '—', { sub: ai && ai.rate !== null ? pct(ai.rate, 0) : '' }));
  out.push(`<div class="tiles">${top.join('')}</div>`);

  const st = c ? Object.entries(c.summary.byStatus).sort() : [];
  out.push(grid('g3', [
    card('Popularity rank (lower is better)', hist.length > 1 ? area(hist, { fmt: compact }) : '<p class="dim">no rank history</p>'),
    card('Issues', c ? donut([{ label: 'Errors', value: c.summary.errors, color: 'var(--bad)' }, { label: 'Warnings', value: c.summary.warnings, color: 'var(--warn)' }, { label: 'Notices', value: c.summary.notices, color: '#8a94a6' }], { center: compact(c.summary.errors + c.summary.warnings + c.summary.notices), sub: 'issues' }) : '<p class="dim">no crawl</p>'),
    card('Status codes', c ? donut(st.map(([k, v]) => ({ label: k === '200' ? '200 OK' : k, value: v })), { center: num(c.summary.pages), sub: 'pages' }) : '<p class="dim">no crawl</p>'),
  ]));

  const cd = d.rank ? competitorData(d, domain) : null;
  const sites = cd ? cd.rows.filter((r) => r.speed || r.site.available) : [];
  out.push(grid('g3', [
    card('Top phrases on the site', c ? hbars(c.content.phrases.slice(0, 10).map((t, k) => ({ label: t.term, value: t.count, color: PALETTE[k % 8] }))) : '<p class="dim">no crawl</p>'),
    card('Live search check', live.length ? table(['keyword', 'position'], live.slice(0, 10).map((r) => [esc(short(r.keyword, 34)), r.found ? `<b class="good">#${r.position}</b>` : '<span class="dim">not in top 10</span>']), ['l', 'r']) : '<p class="dim">not run</p>'),
    card('Competitors: mobile speed', sites.filter((r) => r.speed).length > 1 ? hbars(sites.filter((r) => r.speed).map((r, k) => ({ label: r.domain, value: r.speed.performance, color: r.isSelf ? 'var(--accent)' : PALETTE[(k + 1) % 8] })), { fmt: String }) : '<p class="dim">no competitors given</p>'),
  ]));

  const issuesCard = c
    ? card('Site audit', stack([{ label: 'Errors', value: c.summary.errors, color: 'var(--bad)' }, { label: 'Warnings', value: c.summary.warnings, color: 'var(--warn)' }, { label: 'Notices', value: c.summary.notices, color: 'var(--dim)' }]) + '<div style="height:8px"></div>' + hbars(c.issues.slice(0, 6).map((i) => ({ label: i.title, value: i.count, text: `${num(i.count)} pages`, color: i.severity === 'error' ? 'var(--bad)' : i.severity === 'warning' ? 'var(--warn)' : 'var(--dim)' }))))
    : card('Site audit', gap('Blocked or not run.', d.crawl?.blockedReason || ''));
  const f = d.psi?.field || d.psi?.originField;
  const cwvTile = (label, k, fmt) => `<div><span>${label}</span><b class="${f?.[k] ? (/fast|good/i.test(f[k].rating) ? 'good' : /average/i.test(f[k].rating) ? 'warn' : 'bad') : 'dim'}">${f?.[k] ? fmt(f[k].p75) : '—'}</b></div>`;
  const speedCard = card('Core Web Vitals (real users)', `<div class="cwv">${cwvTile('LCP', 'lcp', ms)}${cwvTile('INP', 'inp', ms)}${cwvTile('CLS', 'cls', (n) => String(n))}${cwvTile('TTFB', 'ttfb', ms)}</div>` + (ps ? `<div class="rings" style="margin-top:12px">${ring(ps.performance, 'Speed')}${ring(ps.accessibility, 'A11y')}${ring(ps['best-practices'], 'Practice')}${ring(ps.seo, 'SEO')}</div>` : ''));
  const aiCard = card('AI search', (ai ? donut([{ label: 'Named', value: ai.named, color: 'var(--good)' }, { label: 'Not named', value: ai.notNamed, color: '#8a94a6' }, { label: 'Failed', value: ai.failed, color: 'var(--bad)' }], { center: pct(ai.rate, 0), sub: 'of answers', size: 120 }) : '<p class="dim">not run</p>') + (d.geo?.geo ? `<div class="kv" style="margin-top:10px"><span>AI crawlers allowed</span><b>${d.geo.geo.crawlers.filter((x) => /^allowed/.test(x.status)).length} of ${d.geo.geo.crawlers.length}</b><span>Checks failed</span><b>${d.geo.geo.checks.filter((x) => !x.pass).length} of ${d.geo.geo.checks.length}</b></div>` : ''));
  out.push(grid('g3', [issuesCard, speedCard, aiCard]));

  const acts = actions(d).slice(0, 8);
  out.push('<div class="sec">Fix first</div>' + (acts.length ? fixRows(acts) : gap('Nothing flagged.', '')));
  return out.join('');
}

function popularityPanel(d) {
  const self = d.rank?.rows?.[0];
  const hist = rankSeries(d);
  const out = [];
  if (!self?.tranco && !self?.radar) return gap('No rank data.', 'Not in the Tranco list' + (d.radar ? '' : '; no Cloudflare token set.'));
  out.push(`<div class="tiles">${tile('Tranco rank', self.tranco ? '#' + num(self.tranco.rank) : '—', { d: hist.length > 1 ? delta(hist[hist.length - 1].value, hist[0].value, { invert: true }) : '', sub: self.tranco ? `14-day median · ${self.tranco.date}` : 'not in the list', sp: spark(hist.map((p) => p.value)) })}${tile('Cloudflare Radar', self.radar ? (self.radar.rank ? '#' + num(self.radar.rank) : 'top ' + num(self.radar.bucket)) : '—', { sub: self.radar?.categories?.join(', ') || (self.radar ? '' : 'no token') })}${d.estimate ? tile('Estimated visits', '~' + num(d.estimate.estimate?.visits), { sub: `${compact(d.estimate.estimate?.low)} – ${compact(d.estimate.estimate?.high)} (80%)` }) : ''}</div>`);
  const series = (d.radar?.series || []).filter((x) => x.rank !== null).slice().map((x) => ({ label: String(x.date).slice(5, 10), value: x.rank }));
  out.push(grid('g2', [card('Tranco rank, last 30 days (lower is better)', hist.length > 1 ? area(hist, { fmt: compact }) : '<p class="dim">no history</p>'), card('Cloudflare Radar rank, last 28 days', series.length > 1 ? area(series, { fmt: compact, color: PALETTE[2] }) : '<p class="dim">Radar publishes a daily rank only for the most popular sites.</p>')]));
  if (d.estimate) {
    const e = d.estimate;
    out.push('<div class="sec">Traffic estimate</div>' + table(['signal', 'value', 'detail'], [
      ['Estimated monthly visits', num(e.estimate?.visits), `${num(e.estimate?.low)} – ${num(e.estimate?.high)} (80% range, ×/÷ ${(10 ** (e.model?.sigma ?? 0.5)).toFixed(1)})`],
      ['Model', `n=${e.model?.n}, R²=${e.model ? e.model.r2.toFixed(2) : '—'}`, 'calibrated on traffic figures you supplied'],
    ], ['l', 'r', 'l']));
  }
  return out.join('');
}

function competitorsPanel(d, domain) {
  if (!d.rank || d.rank.rows.length < 2) return gap('No competitors given.', 'Run with --competitors a.com,b.com');
  const c = competitorData(d, domain);
  const out = [];
  const spd = (r) => (r.speed ? `<span class="${r.speed.performance >= 90 ? 'good' : r.speed.performance >= 50 ? 'warn' : 'bad'}">${r.speed.performance}</span>` : none);
  out.push(dt('competitors', ['site', 'Tranco rank', 'Radar', 'speed', 'LCP', 'pages read', 'health', 'words', 'schema', 'no meta'], c.rows.map((r) => [
    esc(r.domain) + (r.isSelf ? ' <span class="pill dim">you</span>' : ''),
    { h: o(r.trancoRank, (n) => '#' + num(n)), v: r.trancoRank },
    { h: r.radarRank ? '#' + num(r.radarRank) : r.radarBucket ? 'top ' + num(r.radarBucket) : none, v: r.radarRank ?? r.radarBucket },
    { h: spd(r), v: r.speed?.performance }, { h: r.speed?.lcpMs ? ms(r.speed.lcpMs) : none, v: r.speed?.lcpMs },
    r.site.available ? { h: num(r.site.pages), v: r.site.pages } : { h: `<span class="warn">${esc(r.site.why)}</span>`, v: -1 },
    r.site.available ? { h: r.site.healthScore + '%', v: r.site.healthScore } : none,
    r.site.available ? { h: num(r.site.avgWords), v: r.site.avgWords } : none,
    r.site.available ? { h: pct(r.site.withSchema, 0), v: r.site.withSchema } : none,
    r.site.available ? { h: pct(r.site.metaMissing, 0), v: r.site.metaMissing } : none,
  ]), { align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], page: 20 }));
  const bars = (label, pick, fmt) => {
    const items = c.rows.map((r, k) => ({ r, k, v: pick(r) })).filter((x) => isNum(x.v));
    return card(label, items.length ? hbars(items.map((x) => ({ label: x.r.domain, value: x.v, color: x.r.isSelf ? 'var(--accent)' : PALETTE[(x.k + 1) % 8] })), { fmt }) : '<p class="dim">no data</p>');
  };
  out.push('<div style="height:12px"></div>' + grid('g3', [bars('Mobile speed', (r) => r.speed?.performance, String), bars('Site health (crawl)', (r) => (r.site.available ? r.site.healthScore : null), (n) => n + '%'), bars('Pages with structured data', (r) => (r.site.available ? Math.round(r.site.withSchema * 100) : null), (n) => n + '%')]));
  if (c.checked) out.push(grid('g2', [card(`Top-10 slots across ${c.checked} keywords`, hbars(c.presence.map((p, k) => ({ label: p.domain, value: p.slots, text: `${p.slots} slots · ${p.keywordsInTop10} keywords`, color: PALETTE[k % 8] })))), card('Where you lead', c.lead.length ? table(['keyword', 'your position'], c.lead.slice(0, 10).map((x) => [esc(x.keyword), '#' + x.yourPosition]), ['l', 'r']) : '<p class="dim">none yet</p>')]));
  if (c.gap.length) out.push('<div class="sec">Keyword gap: a competitor is in the top 10, you are not</div>' + dt('keyword-gap', ['keyword', 'competitor', 'their position'], c.gap.map((g) => [esc(g.keyword), esc(g.competitor), { h: '#' + g.theirPosition, v: g.theirPosition }]), { align: ['l', 'l', 'r'], page: 25 }));
  else if (c.checked) out.push('<p class="note">No keyword where a competitor ranks and you do not.</p>');
  const blocked = c.rows.filter((r) => !r.isSelf && !r.site.available && r.site.why === 'blocked our crawler');
  if (blocked.length) out.push(`<p class="note">Blocked our crawler: ${blocked.map((r) => esc(r.domain)).join(', ')}. Not worked around.</p>`);
  return out.join('');
}

function keywordsPanel(d) {
  const out = [];
  const live = d.serp?.results || [];
  const ok = live.filter((r) => !r.error);
  const ideas = new Map();
  for (const src of [d['keywords-brand'], d['keywords-topic'], d.keywords]) for (const k of src?.keywords || []) if (!ideas.has(k.keyword)) ideas.set(k.keyword, k);
  const clusters = [d['keywords-brand'], d['keywords-topic']].flatMap((x) => x?.clusters || []);
  out.push(`<div class="tiles">${tile('Live top-10', ok.length ? `${ok.filter((r) => r.found).length}/${ok.length}` : '—', { sub: ok.length ? 'keywords checked' : stepNote(d, 'serp') })}${tile('Keyword ideas', num(ideas.size))}${tile('Clusters', num(clusters.length))}${tile('Distinct phrases', crawlOk(d) ? num(d.crawl.content.phrases.length) : '—', { sub: 'from the site' })}</div>`);
  if (live.length) out.push(card('Live rank check', dt('rank-check', ['keyword', 'position', 'top results'], live.map((r) => [esc(r.keyword), { h: r.error ? '<span class="bad">error</span>' : r.found ? `<b class="good">#${r.position}</b>` : '<span class="dim">–</span>', v: r.position ?? 99 }, `<span class="dim">${esc((r.results || []).slice(0, 3).map((x) => x.domain).join(' · '))}</span>`]), { align: ['l', 'r', 'l'], page: 20 })));
  if (crawlOk(d)) {
    const cr = d.crawl.content;
    out.push('<div style="height:12px"></div>' + grid('g2', [card('Top phrases on the site', hbars(cr.phrases.slice(0, 12).map((t, k) => ({ label: t.term, value: t.count, color: PALETTE[k % 8] })))), card('Top words on the site', hbars(cr.terms.slice(0, 12).map((t, k) => ({ label: t.term, value: t.count, color: PALETTE[k % 8] }))))]));
  }
  if (ideas.size) out.push('<div class="sec">Keyword ideas</div>' + dt('keyword-ideas', ['keyword', 'intent', 'sources'], [...ideas.values()].map((k) => [esc(k.keyword), esc(k.intent), { h: String(k.sourceCount), v: k.sourceCount }]), { align: ['l', 'l', 'r'], page: 25 }));
  if (clusters.length) out.push('<div class="sec">Clusters</div>' + table(['cluster', 'size', 'terms'], clusters.map((c) => [esc(c.cluster), String(c.size), `<span class="dim">${esc(short((c.terms || []).join(', '), 110))}</span>`]), ['l', 'r', 'l']));
  if (crawlOk(d)) {
    const pages = d.crawl.pages.filter((p) => p.status === 200 && p.terms?.phrases?.length);
    out.push('<div class="sec">Pages and what they target</div>' + dt('page-topics', ['page', 'title', 'top phrases', 'inlinks', 'words'], pages.map((p) => [link(p.url), esc(short(p.title, 55)), `<span class="dim">${esc(p.terms.phrases.slice(0, 3).map((t) => t.term).join(', '))}</span>`, { h: num(p.inlinks), v: p.inlinks }, { h: num(p.words), v: p.words }]), { align: ['l', 'l', 'l', 'r', 'r'] }));
  }
  return out.join('');
}

function auditPanel(d) {
  const c = d.crawl;
  if (!c) return gap('No crawl.', stepNote(d, 'crawl'));
  if (c.blocked) return gap('Site blocked our crawler.', c.blockedReason);
  const s = c.summary;
  const out = [];
  out.push(`<div class="tiles">${tile('Site health', s.healthScore + '%', { rg: s.healthScore, sub: `${s.healthyShare}% pages clean` })}${tile('Pages crawled', num(s.pages), { sub: c.complete ? 'whole site' : `sample of ${num(c.sitemap?.urls || 0)} in sitemap` })}${tile('Errors', `<span class="${s.errors ? 'bad' : 'good'}">${num(s.errors)}</span>`, { sub: `${num(s.pagesWithErrors)} pages` })}${tile('Warnings', `<span class="${s.warnings ? 'warn' : 'good'}">${num(s.warnings)}</span>`, { sub: `${num(s.pagesWithWarnings)} pages` })}${tile('Notices', num(s.notices))}${tile('Indexable', num(s.indexable), { sub: `${num(s.nonIndexable)} not` })}</div>`);
  const cats = Object.entries(c.issues.reduce((m, i) => ((m[i.category] = (m[i.category] || 0) + i.count), m), {})).sort((a, b) => b[1] - a[1]);
  const st = Object.entries(s.byStatus).sort();
  out.push(grid('g3', [
    card('Issues', donut([{ label: 'Errors', value: s.errors, color: 'var(--bad)' }, { label: 'Warnings', value: s.warnings, color: 'var(--warn)' }, { label: 'Notices', value: s.notices, color: '#8a94a6' }], { center: compact(s.errors + s.warnings + s.notices), sub: 'issues' })),
    card('Status codes', donut(st.map(([k, v]) => ({ label: k === '200' ? '200 OK' : k, value: v })), { center: num(s.pages), sub: 'pages' })),
    card('Issues by category', hbars(cats.map(([k, v], i) => ({ label: k, value: v, color: PALETTE[i % 8] })))),
  ]));
  out.push(grid('g2', [card('Pages by click depth', columns(Object.entries(s.byDepth).map(([k, v]) => ({ label: 'depth ' + k, value: v })), { fmt: num })), card('Technical checks', `<div class="kv">${c.siteChecks.map((k) => `<span>${esc(k.title)}</span><b class="${k.pass ? 'good' : 'bad'}">${k.pass ? 'pass' : 'FAIL'}</b>`).join('')}</div>`)]));
  const rb = c.robots;
  out.push(`<details><summary>robots.txt · ${rb.disallow.length} disallow rules · ${num(c.sitemap?.urls || 0)} sitemap URLs</summary><div class="prose mono">${rb.disallow.map((x) => `<p>Disallow: ${esc(x)}</p>`).join('') || '<p>no disallow rules</p>'}${(c.sitemap.files || []).map((f) => `<p>${esc(f.url)} → ${f.status}${f.urls ? ` (${num(f.urls)} URLs)` : ''}</p>`).join('')}</div></details>`);
  return out.join('');
}

function issuesPanel(d) {
  const c = d.crawl;
  if (!crawlOk(d)) return gap('No issues.', c?.blocked ? 'Site blocked the crawl.' : stepNote(d, 'crawl'));
  const rows = c.issues.map((i) => {
    const list = `<details class="in"><summary>${num(i.count)}</summary><div class="urls">${i.urls.map((u) => `<div>${link(u, short(u.replace(/^https?:\/\//, ''), 90))}${i.details?.[u] ? ` <span class="dim">· ${esc(short(i.details[u], 90))}</span>` : ''}</div>`).join('')}${i.count > i.urls.length ? `<div class="dim">+${num(i.count - i.urls.length)} more</div>` : ''}</div></details>`;
    return [{ h: sevPill(i.severity), v: { error: 0, warning: 1, notice: 2 }[i.severity] }, esc(i.category), `<b>${esc(i.title)}</b>`, `<span class="dim">${esc(i.fix)}</span>`, { h: list, v: i.count }, { h: pct(i.count / c.summary.pages, 0), v: i.count / c.summary.pages }];
  });
  return dt('issues', ['severity', 'category', 'issue', 'fix', 'pages', '%'], rows, { align: ['l', 'l', 'l', 'l', 'r', 'r'], page: 40 });
}

function pagesPanel(d) {
  const c = d.crawl;
  if (!crawlOk(d)) return gap('No pages.', c?.blocked ? 'Site blocked the crawl.' : stepNote(d, 'crawl'));
  const sevOf = new Map(c.issues.map((i) => [i.id, i.severity]));
  const rows = c.pages.map((p) => [
    link(p.url),
    { h: p.status ? `<span class="${p.status === 200 ? '' : p.status >= 400 ? 'bad' : 'warn'}">${p.status}</span>` : none, v: p.status },
    { h: p.depth === null ? '—' : String(p.depth), v: p.depth ?? 99 },
    { h: p.indexable ? '<span class="good">yes</span>' : '<span class="warn">no</span>', v: p.indexable ? 1 : 0 },
    `<span title="${esc(p.title)}">${esc(short(p.title, 48))}</span>`,
    { h: num(p.title.length), v: p.title.length }, { h: num(p.description.length), v: p.description.length },
    esc(short(p.h1, 36)), { h: num(p.words), v: p.words }, { h: num(p.inlinks), v: p.inlinks }, { h: p.linkScore ?? '—', v: p.linkScore },
    { h: p.ttfb ? ms(p.ttfb) : '—', v: p.ttfb }, { h: p.bytes ? Math.round(p.bytes / 1024) + ' KB' : '—', v: p.bytes },
    { h: p.issues.length ? `<span class="${p.issues.some((i) => sevOf.get(i) === 'error') ? 'bad' : 'warn'}">${p.issues.length}</span>` : '<span class="good">0</span>', v: p.issues.length },
    { h: String(p.score), v: p.score },
  ]);
  return dt('pages', ['page', 'status', 'depth', 'index', 'title', 'title len', 'meta len', 'H1', 'words', 'inlinks', 'link score', 'response', 'size', 'issues', 'score'], rows, { align: ['l', 'r', 'r', 'l', 'l', 'r', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], page: 50 });
}

function linksPanel(d) {
  const c = d.crawl;
  if (!crawlOk(d)) return gap('No link analysis.', c?.blocked ? 'Site blocked the crawl.' : stepNote(d, 'crawl'));
  const out = [];
  const L = c.links;
  out.push(`<div class="tiles">${tile('Broken internal', `<span class="${L.broken.length ? 'bad' : 'good'}">${L.broken.length}</span>`)}${tile('Redirected links', `<span class="${L.redirected.length ? 'warn' : 'good'}">${L.redirected.length}</span>`)}${tile('Orphan pages', L.orphans === null ? 'n/a' : String(L.orphans.length), { sub: L.orphans === null ? 'sample crawl' : '' })}${tile('Broken outbound', `<span class="${L.brokenExternal.length ? 'warn' : 'good'}">${L.brokenExternal.length}</span>`, { sub: `${L.externalChecked} checked` })}</div>`);
  out.push(grid('g3', [
    card('Most linked pages (inlinks)', hbars(L.topInlinked.slice(0, 10).map((x, k) => ({ label: pathOf(x.url), value: x.inlinks, color: PALETTE[k % 8] })))),
    card('Strongest pages (link score)', hbars(L.topScore.slice(0, 10).map((x, k) => ({ label: pathOf(x.url), value: x.score, color: PALETTE[k % 8] })), { fmt: String })),
    card('Common anchor text', hbars(L.anchors.slice(0, 10).map((a, k) => ({ label: a.text, value: a.count, color: PALETTE[k % 8] })))),
  ]));
  out.push(grid('g2', [card('Links out to', hbars(L.externalDomains.slice(0, 10).map((x, k) => ({ label: x.host, value: x.count, color: PALETTE[k % 8] })))), card('Broken outbound', L.brokenExternal.length ? table(['URL', 'status'], L.brokenExternal.map((b) => [link(b.url, short(b.url, 48)), String(b.status || 'no reply')])) : '<p class="good">none</p>')]));
  if (L.broken.length) out.push('<div class="sec">Broken internal pages</div>' + dt('broken-internal', ['URL', 'status', 'linked from'], L.broken.map((b) => [link(b.url), { h: `<span class="bad">${b.status}</span>`, v: b.status }, b.sources.map((x) => link(x)).join('<br>')]), { page: 25 }));
  if (L.redirected.length) out.push('<div class="sec">Redirected internal URLs</div>' + dt('redirected-internal', ['URL', 'goes to', 'hops', 'inlinks'], L.redirected.map((r) => [link(r.url), link(r.to), { h: String(r.hops), v: r.hops }, { h: num(r.inlinks), v: r.inlinks }]), { align: ['l', 'l', 'r', 'r'], page: 25 }));
  if (L.orphans?.length) out.push(`<div class="sec">Orphan pages</div><div class="urls">${L.orphans.map((u) => `<div>${link(u)}</div>`).join('')}</div>`);
  out.push('<p class="note">Inbound links from other sites need a backlink index, which this tool does not have.</p>');
  return out.join('');
}

function contentPanel(d) {
  if (!crawlOk(d)) return gap('No content analysis.', d.crawl?.blocked ? 'Site blocked the crawl.' : stepNote(d, 'crawl'));
  const c = d.crawl;
  const out = [];
  const band = (o2, order, colors) => donut(order.map((k, i) => ({ label: k, value: o2[k] || 0, color: colors[i] })), { size: 120, center: num(order.reduce((n, k) => n + (o2[k] || 0), 0)), sub: 'pages' });
  const G = 'var(--good)';
  const W = 'var(--warn)';
  const B = 'var(--bad)';
  out.push(grid('g3', [
    card('Title length', band(c.content.titleLengths, ['<30', '30–60', '61+'], [W, G, W])),
    card('Meta description', band(c.content.descLengths, ['missing', '<70', '70–160', '161+'], [B, W, G, W])),
    card('Words per page', band(c.content.wordBands, ['<200', '200–499', '500–999', '1000+'], [B, W, G, G])),
  ]));
  out.push(grid('g2', [card('Structured data (pages using each type)', c.content.schemaTypes.length ? hbars(c.content.schemaTypes.map((t, k) => ({ label: t.type, value: t.pages, color: PALETTE[k % 8] }))) : '<p class="bad">none found on any page</p>'), card('Duplicates', `<div class="kv"><span>Duplicate titles</span><b>${c.duplicates.titles.length}</b><span>Duplicate descriptions</span><b>${c.duplicates.descriptions.length}</b><span>Duplicate H1s</span><b>${c.duplicates.h1s.length}</b><span>Identical text</span><b>${c.duplicates.content.length}</b></div>`)]));
  const dupes = (k, label) => (c.duplicates[k].length ? `<div class="sec">${label}</div>` + dt('dup-' + k, ['pages', 'value', 'urls'], c.duplicates[k].map((g) => [{ h: String(g.count), v: g.count }, esc(short(g.value, 90)), `<details class="in"><summary>show</summary><div class="urls">${g.urls.map((u) => `<div>${link(u)}</div>`).join('')}</div></details>`]), { align: ['r', 'l', 'l'], page: 15 }) : '');
  out.push(dupes('titles', 'Duplicate titles'), dupes('descriptions', 'Duplicate descriptions'), dupes('h1s', 'Duplicate H1s'), dupes('content', 'Identical text'));
  const thin = c.pages.filter((p) => p.status === 200 && p.indexable && p.words !== null && p.words < 200).sort((a, b) => a.words - b.words);
  if (thin.length) out.push(`<div class="sec">Thin pages (${thin.length})</div>` + dt('thin-pages', ['page', 'words', 'title'], thin.map((p) => [link(p.url), { h: num(p.words), v: p.words }, esc(short(p.title, 70))]), { align: ['l', 'r', 'l'], page: 25 }));
  return out.join('');
}

function speedPanel(d) {
  const out = [];
  const one = (p, label) => {
    if (!p) return '';
    const rows = [];
    for (const [key, name] of [['lcp', 'LCP'], ['inp', 'INP'], ['cls', 'CLS'], ['fcp', 'FCP'], ['ttfb', 'TTFB']]) {
      const f = (x) => (x?.[key] ? `${key === 'cls' ? x[key].p75 : ms(x[key].p75)} ${rating(x[key].rating)}` : '—');
      rows.push([name, esc(p.lab?.[key]?.display || '—'), f(p.field), f(p.originField)]);
    }
    return `<div class="sec">${esc(label)} · ${esc(p.url)}</div>` + grid('g2', [
      card('Scores', `<div class="rings">${ring(p.scores.performance, 'Speed')}${ring(p.scores.accessibility, 'Accessibility')}${ring(p.scores['best-practices'], 'Best practice')}${ring(p.scores.seo, 'SEO')}</div>`),
      card('Lab vs real users', table(['metric', 'lab', 'users: page', 'users: site'], rows, ['l', 'r', 'r', 'r'])),
    ]) + (p.topIssues?.length ? card('Biggest fixes', hbars(p.topIssues.map((i, k) => ({ label: i.title, value: i.savings || 0, text: i.savings ? '−' + ms(i.savings) : '', color: PALETTE[k % 8] })))) : '');
  };
  if (!d.psi && !d['psi-desktop']) out.push(gap('No PageSpeed data.', stepNote(d, 'psi')));
  out.push(one(d.psi, 'Mobile'), one(d['psi-desktop'], 'Desktop'));
  const pg = ['psi-page-1', 'psi-page-2', 'psi-page-3'].map((k) => d[k]).filter(Boolean);
  if (pg.length) out.push('<div class="sec">Other pages, mobile</div>' + table(['page', 'speed', 'a11y', 'practice', 'SEO', 'LCP lab', 'LCP users'], pg.map((p) => [link(p.url), String(p.scores.performance), String(p.scores.accessibility), String(p.scores['best-practices']), String(p.scores.seo), esc(p.lab?.lcp?.display || '—'), p.field?.lcp ? ms(p.field.lcp.p75) : '—']), ['l', 'r', 'r', 'r', 'r', 'r', 'r']));
  const own = d.probe;
  if (own?.vitals) {
    const v = own.vitals;
    out.push('<div class="sec">Our own browser test (one cold load)</div>' + grid('g2', [card('', `<div class="kv"><span>LCP</span><b>${ms(v.lcp)} ${rating(own.ratings?.lcp)}</b><span>FCP</span><b>${ms(v.fcp)} ${rating(own.ratings?.fcp)}</b><span>CLS</span><b>${isNum(v.cls) ? v.cls.toFixed(3) : '—'} ${rating(own.ratings?.cls)}</b><span>TTFB</span><b>${ms(v.ttfb)} ${rating(own.ratings?.ttfb)}</b><span>Load</span><b>${ms(v.load)}</b><span>Requests</span><b>${num(own.page?.resources)}</b></div>`)]));
  }
  if (crawlOk(d)) {
    const ok = d.crawl.pages.filter((p) => p.ttfb);
    out.push('<div class="sec">From the crawl</div>' + grid('g2', [
      card('Slowest responses', hbars(ok.slice().sort((a, b) => b.ttfb - a.ttfb).slice(0, 10).map((p) => ({ label: pathOf(p.url), value: p.ttfb, text: ms(p.ttfb), color: 'var(--warn)' })))),
      card('Heaviest HTML', hbars(ok.filter((p) => p.bytes).sort((a, b) => b.bytes - a.bytes).slice(0, 10).map((p) => ({ label: pathOf(p.url), value: p.bytes, text: Math.round(p.bytes / 1024) + ' KB', color: PALETTE[3] })))),
    ]));
  }
  return out.join('');
}

function aiPanel(d) {
  const out = [];
  const g = d.geo?.geo;
  const a = d.ai;
  const s = a ? aiStats(a) : null;
  const tiles = [];
  if (g) tiles.push(tile('AI-readiness', `${g.score}/100`, { rg: g.score, sub: `${g.checks.filter((x) => !x.pass).length} checks failed` }));
  if (a) tiles.push(tile('Named in AI answers', `${s.named}/${s.answered}`, { sub: pct(s.rate, 0) + (s.failed ? ` · ${s.failed} failed` : '') }), tile('Share of voice', a.competitors?.length ? pct(a.shareOfVoice, 0) : '—', { sub: a.competitors?.length ? '' : 'no competitors given' }), tile('Avg. position', isNum(a.avgPosition) ? a.avgPosition.toFixed(1) : '—'));
  out.push(`<div class="tiles">${tiles.join('')}</div>`);
  if (g) {
    out.push(grid('g2', [
      card('AI crawlers in robots.txt', table(['crawler', 'status'], g.crawlers.map((c) => [esc(c.agent), `<span class="${/^allowed/.test(c.status) ? 'good' : /^blocked/.test(c.status) ? 'bad' : 'dim'}">${esc(c.status)}</span>`]))),
      card('Readiness checks', table(['check', 'result', 'detail'], g.checks.map((c) => [esc(c.name), `<span class="${c.pass ? 'good' : 'bad'}">${c.pass ? 'pass' : 'FAIL'}</span>`, `<span class="dim">${esc(c.detail)}</span>`]))),
    ]));
    if (d['geo-plan']?.plan?.text) out.push(`<details><summary>Plan to improve</summary>${prose(d['geo-plan'].plan.text)}</details>`);
  } else out.push(gap('No AI-readiness audit.', stepNote(d, 'geo')));
  if (a) out.push('<div class="sec">Questions asked of ' + esc(a.engine) + '</div>' + dt('ai-prompts', ['question', 'named', 'sentiment', 'answer began'], a.results.map((r) => [esc(r.prompt), { h: r.error ? '<span class="bad">error</span>' : r.mentioned ? '<span class="good">yes</span>' : '<span class="bad">no</span>', v: r.mentioned ? 1 : 0 }, esc(r.sentiment || '—'), `<span class="dim">${esc(short(String(r.excerpt || '').replace(/\*+/g, ''), 150))}</span>`])));
  else out.push(gap('No AI visibility run.', stepNote(d, 'ai')));
  return out.join('');
}

function techPanel(d) {
  const out = [];
  const list = d.tech?.technology || d.probe?.tech || [];
  out.push(list.length ? dt('technology', ['category', 'technology', 'detected by'], list.map((t) => [esc(t.category), esc(t.name + (t.version ? ' ' + t.version : '')), `<span class="dim">${esc((t.detectedBy || []).join(', '))}</span>`])) : gap('No technologies detected.', stepNote(d, 'tech')));
  const i = d.intel || d.wayback;
  if (!i) return out.join('');
  const r = i.rdap || {};
  const dns = i.dns || {};
  out.push('<div class="sec">Domain</div>' + grid('g2', [
    card('Registration', `<div class="kv"><span>Registrar</span><b>${esc(r.registrar || '—')}</b><span>Registered</span><b>${esc(r.registered || '—')}</b><span>Expires</span><b>${esc(r.expires || '—')}</b><span>Changed</span><b>${esc((r.changed || '—').slice(0, 10))}</b></div><p class="note">${esc((r.nameservers || []).join(' · '))}</p>`),
    card('DNS and mail', `<div class="kv"><span>A</span><b>${esc((dns.a || []).join(', ') || '—')}</b><span>MX</span><b>${esc((dns.mx || []).join(', ') || '—')}</b><span>SPF</span><b>${esc(dns.spf ? 'yes' : 'none')}</b></div>`),
  ]));
  const w = i.wayback;
  if (w?.perYear) out.push(grid('g2', [card(`Archive snapshots per year · first seen ${w.firstSeen} · ${num(w.monthsWithSnapshots)} months`, columns(Object.entries(w.perYear).map(([y, n]) => ({ label: y.slice(2), value: n })), { fmt: String }))]));
  if (i.subdomains?.length) out.push(`<div class="sec">Subdomains (${i.subdomains.length})</div><p class="mono">${i.subdomains.map(esc).join(' · ')}</p>`);
  return out.join('');
}

function plansPanel(d) {
  const blocks = [['strategy-marketing', 'Marketing plan'], ['strategy-content', 'Content plan'], ['sales-score', 'Lead score']];
  const out = blocks.filter(([k]) => d[k]?.text).map(([k, t]) => `<details${k === 'strategy-marketing' ? ' open' : ''}><summary>${t} <span class="dim">· ${esc(d[k].engine)}</span></summary>${prose(d[k].text)}</details>`);
  return out.length ? out.join('') + '<p class="note">Model-written; check derived figures against the tabs.</p>' : gap('No plans.', stepNote(d, 'strategy-marketing'));
}

function logPanel(d) {
  const s = d.summary?.steps || [];
  if (!s.length) return '';
  const ok = s.filter((x) => x.status === 'ok').length;
  return `<div class="tiles">${tile('Steps ok', `${ok}/${s.length}`)}${tile('Total time', secs(s.reduce((n, x) => n + (x.seconds || 0), 0)))}</div>` + table(['step', 'status', 'seconds', 'file / note'], s.map((x) => [esc(x.name), `<span class="${x.status === 'ok' ? 'good' : x.status === 'skipped' ? 'dim' : 'bad'}">${esc(x.status)}</span>`, String(x.seconds), `<span class="dim">${esc(x.file || x.note || '')}</span>`]), ['l', 'l', 'r', 'l']);
}

/** @returns {string} path of the file written */
export function buildDashboard(dir, domainHint) {
  const d = load(dir);
  const domain = d.summary?.domain || domainHint || path.basename(dir);
  const safe = (fn) => {
    try {
      return fn();
    } catch (err) {
      return gap('Could not build this tab.', err.message);
    }
  };
  const c = crawlOk(d) ? d.crawl : null;
  const chips = [d.summary?.demo ? 'demo data' : null, d.radar?.categories?.[0], d.crawl?.options?.engine ? 'parser: ' + d.crawl.options.engine : null].filter(Boolean);
  const groups = [
    ['', [['overview', 'Domain overview', () => overview(d, domain)]]],
    ['Market', [['popularity', 'Popularity', () => popularityPanel(d)], ['competitors', 'Competitors', () => competitorsPanel(d, domain)]]],
    ['Organic', [['keywords', 'Keywords', () => keywordsPanel(d)]]],
    ['Site audit', [
      ['audit', 'Audit overview', () => auditPanel(d), c ? { n: c.summary.errors, e: true } : null],
      ['issues', 'Issues', () => issuesPanel(d), c ? { n: c.issues.length } : null],
      ['pages', 'Pages', () => pagesPanel(d), c ? { n: c.summary.pages } : null],
      ['links', 'Links', () => linksPanel(d)],
      ['content', 'Content', () => contentPanel(d)],
    ]],
    ['Experience', [['performance', 'Speed', () => speedPanel(d)]]],
    ['AI', [['ai', 'AI search', () => aiPanel(d)]]],
    ['More', [['tech', 'Tech & domain', () => techPanel(d)], ['plans', 'Plans', () => plansPanel(d)], ['log', 'Run log', () => logPanel(d)]]],
  ];
  const panels = groups.flatMap(([, items]) => items.map(([id, title, fn]) => `<section class="panel" id="p-${id}"><div class="head"><h2>${id === 'overview' ? esc(domain) : esc(title)}</h2>${id === 'overview' ? chips.map((x) => `<span class="chip">${esc(x)}</span>`).join('') : `<span class="chip">${esc(domain)}</span>`}</div>${safe(fn)}</section>`));
  const nav = groups.map(([g, items]) => (g ? `<div class="grp">${esc(g)}</div>` : '') + items.map(([id, title, , badge]) => `<a href="#${id}">${esc(title)}${badge ? `<b${badge.e && badge.n ? ' class="e"' : ''}>${num(badge.n)}</b>` : ''}</a>`).join('')).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(domain)} — SEO dashboard</title><style>${STYLE}</style></head><body>
<aside><h1>${esc(domain)}</h1><p class="sub">${new Date().toISOString().slice(0, 10)}</p>${nav}</aside>
<main>${panels.join('\n')}</main>
<script>${SCRIPT}</script></body></html>`;
  const file = path.join(dir, 'dashboard.html');
  fs.writeFileSync(file, html);
  return file;
}
export { load as loadScan, actions, crawlOk };
