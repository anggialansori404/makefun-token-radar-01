/* Token Radar dashboard: renders window.RADAR (written by main.ts beside this page).
   No network, no framework: hash-routed views over one static dataset. */
'use strict';

const D = window.RADAR;
const bySlug = new Map(D.rows.map((r) => [r.slug, r]));
const state = {
  view: 'board',
  q: '',
  category: '',
  chain: '',
  minTvl: 0,
  minConf: 0,
  sort: 'rank',
  dir: 1,
  showAll: false,
  selected: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function money(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
}
function pct(n) {
  if (n === null || n === undefined) return '<span class="flat">n/a</span>';
  const cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function mult(n) { return 'x' + n.toFixed(2); }
function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= 730) return (days / 365.25).toFixed(1) + 'y';
  if (days >= 60) return Math.round(days / 30.4) + 'mo';
  return days + 'd';
}
function meter(value, tone) {
  return `<span class="meter ${tone}"><i style="width:${Math.max(2, Math.min(100, value))}%"></i></span>${value}`;
}
function confTone(v) { return v >= 70 ? 'g' : v < 45 ? 'r' : ''; }

/* ---------- filtering and sorting ---------- */
function visibleRows() {
  let rows = D.rows;
  if (state.view === 'watchlist') rows = rows.filter((r) => r.watchlist);
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q));
  }
  if (state.category) rows = rows.filter((r) => r.category === state.category);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.minTvl > 0) rows = rows.filter((r) => r.tvl_usd >= state.minTvl);
  if (state.minConf > 0) rows = rows.filter((r) => r.confidence >= state.minConf);
  const k = state.sort;
  const dir = state.dir;
  const val = (r) => {
    switch (k) {
      case 'name': return r.name.toLowerCase();
      case 'tvl': return r.tvl_usd;
      case 'change': return r.change_7d === null ? -Infinity : r.change_7d;
      case 'age': return r.age_days === null ? -1 : r.age_days;
      case 'multiple': return r.drivers.peer_multiple;
      case 'implied': return r.implied_value_usd;
      case 'confidence': return r.confidence;
      case 'readiness': return r.readiness;
      default: return r.rank;
    }
  };
  return [...rows].sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return a.rank - b.rank;
  });
}

/* ---------- board table ---------- */
const COLUMNS = [
  { key: 'rank', label: '#', left: true },
  { key: 'name', label: 'Protocol', left: true },
  { key: 'category', label: 'Category', left: true, nosort: true },
  { key: 'chains', label: 'Chains', left: true, nosort: true },
  { key: 'tvl', label: 'TVL' },
  { key: 'change', label: '7d' },
  { key: 'age', label: 'Age' },
  { key: 'multiple', label: 'Peer x' },
  { key: 'implied', label: 'Implied' },
  { key: 'confidence', label: 'Conf' },
  { key: 'readiness', label: 'Ready' },
];

function rowHtml(r) {
  const chains = r.chains.length === 0 ? '—'
    : esc(r.chains[0]) + (r.chains.length > 1 ? ` <span class="chains">+${r.chains.length - 1}</span>` : '');
  return `<tr data-slug="${esc(r.slug)}"${state.selected === r.slug ? ' class="sel"' : ''}>
    <td class="l rank${r.rank <= 3 ? ' top' : ''}">${r.rank}</td>
    <td class="l"><span class="pname">${esc(r.name)}</span><span class="pslug">${esc(r.slug)}</span>${r.watchlist ? '<span class="wl">WATCHLIST</span>' : ''}</td>
    <td class="l cat">${esc(r.category ?? 'Uncategorised')}</td>
    <td class="l chains">${chains}</td>
    <td>${money(r.tvl_usd)}</td>
    <td>${pct(r.change_7d)}</td>
    <td>${ageText(r.age_days)}</td>
    <td>${mult(r.drivers.peer_multiple)}</td>
    <td class="implied">${money(r.implied_value_usd)}</td>
    <td>${meter(r.confidence, confTone(r.confidence))}</td>
    <td>${meter(r.readiness, '')}</td>
  </tr>`;
}

function renderBoard() {
  const rows = visibleRows();
  const shown = state.showAll ? rows : rows.slice(0, 60);
  const head = state.view === 'watchlist'
    ? ['The watchlist', `The ${D.watchlist_size} protocols at or above the snapshot's ${money(D.floor_usd)} floor that record no token and are no wrapped, staked or bridged product of one that trades. The floor the gate checks — ranked here by the same model as the whole board.`]
    : ['The board', `Every protocol in the snapshot that records no token and is a protocol in its own right — not a wrapped, staked or bridged product of a token that already trades — ranked by implied value. The watchlist's ${D.watchlist_size} are the floor, not the ceiling: ${D.early_size} further rows come from the same rule with no size floor. Click a row for its value drivers and farm plan.`];
  const ths = COLUMNS.map((c) => {
    const sorted = state.sort === c.key;
    const arrow = sorted ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return `<th class="${c.left ? 'l' : ''}${sorted ? ' sorted' : ''}" data-sort="${c.nosort ? '' : c.key}">${c.label}${arrow}</th>`;
  }).join('');
  $('main').innerHTML = `
    <div class="pagehead"><div><h2>${head[0]}</h2><p class="sub">${head[1]}</p></div>
    <div class="count">${rows.length} of ${D.board_size} rows</div></div>
    ${rows.length === 0 ? '<p class="empty">No protocol matches the current filters.</p>' : `
    <table class="board"><thead><tr>${ths}</tr></thead><tbody>${shown.map(rowHtml).join('')}</tbody></table>
    ${shown.length < rows.length ? `<button class="showall" id="showall">Show all ${rows.length} rows</button>` : ''}`}`;
  $('railnote').textContent = `${rows.length} rows after filters`;
  const btn = $('showall');
  if (btn) btn.addEventListener('click', () => { state.showAll = true; render(); });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    if (!th.dataset.sort) return;
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sort === k) state.dir = state.dir === 1 ? -1 : 1;
      else { state.sort = k; state.dir = k === 'rank' || k === 'name' ? 1 : -1; }
      render();
    });
  });
  document.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
  });
}

/* ---------- live peers ---------- */
function renderLive() {
  const rows = D.live.map((r) => `<tr>
    <td class="l"><span class="pname">${esc(r.name)}</span><span class="pslug">${esc(r.symbol ?? '')}</span></td>
    <td class="l cat">${esc(r.category ?? 'Uncategorised')}</td>
    <td>${money(r.tvl_usd)}</td><td>${money(r.mcap_usd)}</td>
    <td>${r.multiple === null ? '—' : mult(r.multiple)}</td><td>${pct(r.change_7d)}</td></tr>`).join('');
  $('main').innerHTML = `
    <div class="pagehead"><div><h2>Live peers — the evidence</h2>
    <p class="sub">These protocols already have a token that trades, so the board never ranks them: it shows the market's own price for them. Their mcap/TVL ratios, grouped by category, are the peer multiples that price every row of the board. The market-wide median is ${mult(D.market_multiple)} across ${D.peer_groups.find((g) => g.label === 'Whole market')?.peers ?? 0} priced peers.</p></div>
    <div class="count">${D.live.length} of the largest shown</div></div>
    <table class="board"><thead><tr><th class="l">Protocol</th><th class="l">Category</th><th>TVL</th><th>Market cap</th><th>mcap / TVL</th><th>7d</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  $('railnote').textContent = 'live peers are not ranked';
}

/* ---------- the model ---------- */
function renderModel() {
  const groups = D.peer_groups.map((g) => `<tr>
    <td>${esc(g.label)} <span class="kind">${g.kind}</span></td>
    <td>${g.peers}</td><td>${mult(g.multiple)}</td><td>${mult(g.multiple_q1)}</td><td>${mult(g.multiple_q3)}</td></tr>`).join('');
  $('main').innerHTML = `
    <div class="pagehead"><div><h2>The model — ${esc(D.model_version)}</h2>
    <p class="sub">Every number on the board comes out of this page's arithmetic and the snapshot's own figures. No protocol's name is an input.</p></div></div>
    <div class="prose">
      <div class="formula">implied = TVL x peer multiple x momentum x maturity x breadth</div>
      <p><strong>The universe.</strong> The board applies the watchlist's own definition of a launch candidate at every size, not just above the ${money(D.floor_usd)} floor: a protocol must record no token and be a protocol in its own right. Wrapped, staked and bridged products of a token that already trades are set aside — WBTC, Binance staked ETH and USDT0 record no token in the snapshot, but each is a product of a traded token, and ranking them would rank the wrapper. The Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories are set aside whole, because DefiLlama's record cannot separate a protocol from a product inside them; so are names carrying a whole word wrapped, staked or staking, names beginning with an exchange's name, and versioned pools of another protocol.</p>
      <p><strong>Peer multiple.</strong> For each category, the traded protocols in the snapshot reveal a market price for a dollar of TVL: their mcap/TVL ratio, winsorised to [x0.02, x5.00] so one mania or one dead token cannot price a category. A protocol is priced at the <strong>median</strong> of its own category's set when that set has at least 4 traded members, else its family's set, else the whole market's. The band on each row is the set's interquartile range put through the same adjustments.</p>
      <p><strong>Momentum.</strong> 1 + 0.35 x clamp(7-day TVL change, -50%, +100%) / 100. A protocol gaining TVL is worth more per dollar of it; one bleeding TVL, less. Unreported change counts as flat.</p>
      <p><strong>Maturity.</strong> 0.75 + 0.45 x min(age, 1460 days) / 1460. Four years of operating with no token is the strongest record the snapshot can show; an unknown listing date is priced as 270 days.</p>
      <p><strong>Breadth.</strong> 1 + 0.04 x min(chains - 1, 5): distribution across chains is worth a little, capped at five extra chains.</p>
      <p><strong>Confidence</strong> scores the evidence: how many peers priced the row, how tightly they agree, whether the snapshot reports its growth and its age, and its size. <strong>Readiness</strong> (size, record, momentum) is shown beside the value and never moves it. The <strong>airdrop pool</strong> on each detail view is the implied value times an assumed ${(D.airdrop_share * 100).toFixed(0)}% community allocation — an assumption, stated here, not a figure from the snapshot.</p>
      <p><strong>What the board does not claim.</strong> An implied value is what a token would be worth if the protocol's record stayed as it is. The radar does not predict whether or when a token is issued, and it says a protocol <em>records</em> no token — DefiLlama's record is not proof that none exists. Protocols whose token already trades are never ranked; they stand in the Live peers view as the evidence.</p>
      <h3 style="margin:22px 0 4px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)">Peer multiples from this snapshot</h3>
      <table class="groups"><thead><tr><th>Peer set</th><th>Peers</th><th>Median</th><th>Q1</th><th>Q3</th></tr></thead><tbody>${groups}</tbody></table>
      <p style="margin-top:16px">Snapshot: ${esc(D.as_of)} — ${esc(D.source)}. ${D.protocols_total} protocols at or above $5M TVL; ${D.board_size} ranked as pre-token; watchlist floor ${money(D.floor_usd)}.</p>
    </div>`;
  $('railnote').textContent = 'model ' + D.model_version;
}

/* ---------- detail drawer ---------- */
function splitStep(s) {
  const at = s.indexOf(' Cost: ');
  if (at < 0) return { action: s, meta: '' };
  const action = s.slice(0, at);
  const rest = s.slice(at + 7);
  const tat = rest.indexOf('. Time: ');
  if (tat < 0) return { action, meta: 'Cost: ' + rest };
  return { action, meta: `Cost: ${rest.slice(0, tat)} · Time: ${rest.slice(tat + 8)}` };
}

function risksFor(r) {
  const risks = [];
  if (r.change_7d !== null && r.change_7d <= -15)
    risks.push(`TVL fell ${Math.abs(r.change_7d).toFixed(1)}% in the last seven days: check whether the outflow is one whale leaving or the start of a run before adding capital.`);
  if (r.change_7d !== null && r.change_7d >= 150)
    risks.push(`TVL is up ${r.change_7d.toFixed(0)}% in seven days, far past the model's +100% momentum cap: growth that fast is often mercenary capital that leaves before any snapshot that matters.`);
  if (r.age_days !== null && r.age_days < 90)
    risks.push(`DefiLlama has tracked it for only ${r.age_days} days: almost no operating record, so the maturity adjustment is doing little and the implied value rests mostly on size.`);
  if (r.age_days === null)
    risks.push('The snapshot gives no listing date, so its age is priced at the model\'s 270-day assumption rather than a record.');
  if (r.chains.length === 1)
    risks.push('Single-chain protocol: one chain outage, exploit or ecosystem slump reaches the whole position.');
  if (r.peers.basis === 'market')
    risks.push(`No traded peers in its own category or family, so it is priced from the whole market's median (${mult(r.peers.multiple)}): the least specific evidence on the board.`);
  else if (r.peers.peers < 8)
    risks.push(`Only ${r.peers.peers} traded peers price this row, and their multiples run from ${mult(r.peers.multiple_q1)} to ${mult(r.peers.multiple_q3)}: treat the band, not the point, as the estimate.`);
  if (r.tvl_usd >= 1_000_000_000)
    risks.push('At this size a launch usually values broad distribution over rewarding early farmers: expect any allocation per wallet to be small next to the capital a qualifying position needs.');
  if (risks.length === 0)
    risks.push('No flag from the snapshot\'s own figures. The standing risks remain: smart-contract risk in an unaudited-by-you protocol, and the chance no token is ever issued.');
  return risks;
}

function openDetail(slug, push = true) {
  const r = bySlug.get(slug);
  if (!r) return;
  state.selected = slug;
  if (push) history.replaceState(null, '', '#p/' + slug);
  const d = r.drivers;
  const lo = Math.log(r.implied_low_usd * 0.8);
  const hi = Math.log(r.implied_high_usd * 1.12);
  const pos = (v) => Math.max(0, Math.min(100, ((Math.log(v) - lo) / (hi - lo)) * 100));
  const steps = r.farm_steps.map((s) => {
    const p = splitStep(s);
    return `<li>${esc(p.action)}${p.meta ? `<span class="meta">${esc(p.meta)}</span>` : ''}</li>`;
  }).join('');
  const risks = risksFor(r).map((t) => `<li>${esc(t)}</li>`).join('');
  $('drawer').innerHTML = `
    <button class="close" id="dclose" aria-label="Close">×</button>
    <h2>${esc(r.name)}</h2>
    <div class="dslug">${esc(r.slug)} · rank #${r.rank} of ${D.board_size}</div>
    <div class="badges">
      ${r.watchlist ? '<span class="badge amber">ON THE WATCHLIST</span>' : '<span class="badge">BEYOND THE WATCHLIST</span>'}
      <span class="badge">${esc(r.category ?? 'Uncategorised')}</span>
      ${r.family ? `<span class="badge">${esc(r.family)}</span>` : ''}
      <span class="badge">RECORDS NO TOKEN</span>
    </div>
    <div class="bigval">${money(r.implied_value_usd)} <small>IMPLIED VALUE</small></div>
    <div class="bandbar"><div class="range" style="left:${pos(r.implied_low_usd)}%;width:${Math.max(1, pos(r.implied_high_usd) - pos(r.implied_low_usd))}%"></div><div class="point" style="left:${pos(r.implied_value_usd)}%"></div></div>
    <div class="bandlabels"><span>band ${money(r.implied_low_usd)}</span><span>${money(r.implied_high_usd)}</span></div>
    <h3>Why this value</h3>
    <table class="kv">
      <tr><td>TVL (snapshot)</td><td>${money(r.tvl_usd)}</td></tr>
      <tr><td>Peer multiple</td><td>x ${d.peer_multiple.toFixed(2)}<span class="why">${esc(r.peers.label)} — ${r.peers.peers} traded peers, quartiles ${mult(r.peers.multiple_q1)} to ${mult(r.peers.multiple_q3)}, basis: ${esc(r.peers.basis)}</span></td></tr>
      <tr><td>Momentum</td><td>x ${d.momentum_multiplier.toFixed(2)}<span class="why">7-day TVL change ${r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</span></td></tr>
      <tr><td>Maturity</td><td>x ${d.maturity_multiplier.toFixed(2)}<span class="why">tracked ${r.age_days === null ? 'date unknown' : r.age_days + ' days'} with no token</span></td></tr>
      <tr><td>Breadth</td><td>x ${d.breadth_multiplier.toFixed(2)}<span class="why">${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}: ${esc(r.chains.join(', '))}</span></td></tr>
      <tr><td>Airdrop pool at ${(D.airdrop_share * 100).toFixed(0)}% allocation</td><td>${money(r.airdrop_pool_usd)}<span class="why">assumed community share of the implied value</span></td></tr>
      <tr><td>Confidence</td><td>${r.confidence} — ${esc(r.confidence_label)}</td></tr>
      <tr><td>Readiness</td><td>${r.readiness} — ${esc(r.readiness_label)}<span class="why">signal only; it does not move the value</span></td></tr>
      <tr><td>Listed by DefiLlama</td><td>${esc(r.listed_at ?? 'not reported')}</td></tr>
    </table>
    <h3>How to farm it</h3>
    <ol class="steps">${steps}</ol>
    <h3>Risks from its own record</h3>
    <ul class="risks">${risks}</ul>
    <p class="dnote" style="margin-top:16px">The snapshot records no token for this protocol; that is DefiLlama's record, not proof none exists. The implied value is what a token would be worth if this record stayed as it is.</p>`;
  $('drawer').hidden = false;
  $('dclose').addEventListener('click', closeDetail);
  document.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
    tr.classList.toggle('sel', tr.dataset.slug === slug);
  });
}

function closeDetail() {
  state.selected = null;
  $('drawer').hidden = true;
  $('drawer').innerHTML = '';
  history.replaceState(null, '', state.view === 'board' ? '#board' : '#' + state.view);
  document.querySelectorAll('tbody tr.sel').forEach((tr) => tr.classList.remove('sel'));
}

/* ---------- routing and init ---------- */
function render() {
  document.querySelectorAll('.viewbtn').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('filters').style.display = state.view === 'live' || state.view === 'model' ? 'none' : '';
  if (state.view === 'live') renderLive();
  else if (state.view === 'model') renderModel();
  else renderBoard();
}

function applyHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('p/')) {
    state.view = 'board';
    render();
    openDetail(h.slice(2), false);
    return;
  }
  if (['board', 'watchlist', 'live', 'model'].includes(h)) state.view = h;
  closeDetailQuiet();
  render();
}

function init() {
  $('topstats').innerHTML = `
    <div class="stat"><b>${D.protocols_total}</b><span>protocols scanned</span></div>
    <div class="stat"><b>${D.board_size}</b><span>pre-token ranked</span></div>
    <div class="stat"><b>${D.watchlist_size}</b><span>watchlist covered</span></div>
    <div class="stat"><b>${mult(D.market_multiple)}</b><span>market median mcap/TVL</span></div>
    <div class="stat"><b>${esc(D.as_of)}</b><span>snapshot date</span></div>`;
  const catSel = $('f-category');
  for (const c of D.categories) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  }
  const chainSel = $('f-chain');
  for (const c of D.chains) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    chainSel.appendChild(o);
  }
  document.querySelectorAll('.viewbtn').forEach((b) => {
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      state.showAll = false;
      closeDetailQuiet();
      history.replaceState(null, '', '#' + state.view);
      render();
    });
  });
  $('f-search').addEventListener('input', (e) => { state.q = e.target.value.trim(); state.showAll = false; render(); });
  catSel.addEventListener('change', (e) => { state.category = e.target.value; render(); });
  chainSel.addEventListener('change', (e) => { state.chain = e.target.value; render(); });
  $('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); render(); });
  $('f-conf').addEventListener('change', (e) => { state.minConf = Number(e.target.value); render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.selected) closeDetail(); });
  window.addEventListener('hashchange', applyHash);
  applyHash();
}

function closeDetailQuiet() {
  state.selected = null;
  $('drawer').hidden = true;
  $('drawer').innerHTML = '';
}

init();
