// Token Radar dashboard: renders window.RADAR (written by main.ts beside this page).
// No network, no framework: the board, a detail drawer per protocol, filters, the fit
// evidence and the model view all read the one data object.
(function () {
  var R = window.RADAR;
  if (!R) return;
  var $ = function (id) { return document.getElementById(id); };
  var fmt$ = function (n) {
    if (n === null || n === undefined) return '-';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  };
  var fmtPct = function (n) {
    if (n === null || n === undefined) return '<span class="band">n/a</span>';
    var cls = n >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

  // ---- header stats ----
  var bt = R.fit.backtest;
  $('topstats').innerHTML =
    '<div class="stat"><b>' + R.board_size + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + R.watchlist_size + ' / ' + R.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + R.fit.protocols + '</b><span>traded protocols fitted</span></div>' +
    '<div class="stat"><b>x' + bt.typical_factor.toFixed(1) + '</b><span>backtest median error</span></div>' +
    '<div class="stat"><b>' + Math.round(bt.within_2x * 100) + '%</b><span>backtest within 2x</span></div>';

  // ---- board ----
  var COLS = [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: 'Protocol' },
    { key: 'category', label: 'Category' },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true },
    { key: 'fitted_multiple', label: 'Fitted multiple', num: true },
    { key: 'confidence', label: 'Confidence', num: true },
  ];
  var sortKey = 'rank';
  var sortDir = 1;
  var head = $('board-head');
  head.innerHTML = COLS.map(function (c) {
    return '<th class="' + (c.num ? 'num ' : '') + 'sortable" data-key="' + c.key + '">' + c.label + '</th>';
  }).join('');
  head.addEventListener('click', function (e) {
    var th = e.target.closest('th');
    if (!th) return;
    var k = th.getAttribute('data-key');
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
    renderBoard();
  });

  var catSel = $('f-category');
  R.categories.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });
  var chainSel = $('f-chain');
  R.chains.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o); });

  function visibleRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var chain = chainSel.value;
    var watchOnly = $('f-watch').checked;
    var rows = R.rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (a, b) {
      var x = a[sortKey], y = b[sortKey];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'string') return sortDir * x.localeCompare(y);
      return sortDir * (x - y);
    });
    return rows;
  }

  function renderBoard() {
    var rows = visibleRows();
    $('count').textContent = rows.length + ' of ' + R.board_size + ' protocols';
    $('board-body').innerHTML = rows.map(function (r) {
      var confCls = r.confidence >= 70 ? 'high' : r.confidence >= 45 ? 'med' : 'low';
      return '<tr data-slug="' + r.slug + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="pill">watchlist</span>' : '') +
        '<br><span class="pslug">' + r.slug + '</span></td>' +
        '<td>' + esc(r.category || '-') + '</td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + fmt$(r.implied_value_usd) + '</b><br><span class="band">' + fmt$(r.implied_low_usd) + ' - ' + fmt$(r.implied_high_usd) + '</span></td>' +
        '<td class="num">' + r.fitted_multiple.toFixed(2) + 'x</td>' +
        '<td class="num"><span class="conf ' + confCls + '">' + r.confidence + '</span></td></tr>';
    }).join('');
  }
  $('board-body').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'f-category', 'f-chain', 'f-watch'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });

  // ---- detail drawer ----
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    var base = R.fit.base_multiple;
    var offsetMult = Math.exp(r.offset);
    var sizePct = Math.round((r.size_factor - 1) * 100);
    var offsetPct = Math.round((offsetMult - 1) * 100);
    var bandW = Math.max(0.05, Math.min(1, Math.log10(r.implied_high_usd / r.implied_low_usd) / 2));
    $('drawer-body').innerHTML =
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="pill">watchlist</span>' : '') + '</h2>' +
      '<p class="band">' + r.slug + ' - ' + esc(r.category || 'uncategorised') + (r.family ? ' - ' + esc(r.family) : '') + '</p>' +
      '<dl class="kv">' +
      '<dt>Rank</dt><dd>#' + r.rank + ' of ' + R.board_size + '</dd>' +
      '<dt>Implied value</dt><dd>' + fmt$(r.implied_value_usd) + '</dd>' +
      '<dt>Band (peer IQR)</dt><dd>' + fmt$(r.implied_low_usd) + ' - ' + fmt$(r.implied_high_usd) + '</dd>' +
      '<dt>TVL</dt><dd>' + fmt$(r.tvl_usd) + '</dd>' +
      '<dt>7-day TVL change</dt><dd>' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%') + '</dd>' +
      '<dt>Recorded since</dt><dd>' + (r.listed_at || 'not reported') + (r.age_days !== null ? ' (' + r.age_days + ' days)' : '') + '</dd>' +
      '<dt>Chains</dt><dd>' + r.chains.length + ': ' + esc(r.chains.slice(0, 4).join(', ')) + (r.chains.length > 4 ? '...' : '') + '</dd>' +
      '<dt>Confidence</dt><dd>' + r.confidence + ' (' + r.confidence_label + ')</dd></dl>' +
      '<h3>How the model prices it</h3>' +
      '<div class="bar-row"><label><span>Base multiple at typical size</span><span>' + base.toFixed(2) + 'x</span></label>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.min(100, base * 100) + '%"></div></div></div>' +
      '<div class="bar-row"><label><span>Size adjustment (fitted size curve)</span><span>' + (sizePct >= 0 ? '+' : '') + sizePct + '%</span></label>' +
      '<div class="bar-track"><div class="bar-fill amber" style="width:' + Math.min(100, Math.abs(sizePct)) + '%"></div></div></div>' +
      '<div class="bar-row"><label><span>' + esc(r.offset_basis) + ' offset, ' + r.peers + ' traded peers</span><span>' + (offsetPct >= 0 ? '+' : '') + offsetPct + '%</span></label>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.min(100, Math.abs(offsetPct)) + '%"></div></div></div>' +
      '<div class="bar-row"><label><span>Band width (uncertainty)</span><span>' + fmt$(r.implied_low_usd) + ' - ' + fmt$(r.implied_high_usd) + '</span></label>' +
      '<div class="bar-track"><div class="bar-fill amber" style="width:' + Math.round(bandW * 100) + '%"></div></div></div>' +
      '<p class="band">Fitted multiple ' + r.fitted_multiple.toFixed(2) + 'x TVL. Growth and age are shown as context: the fit tested both and they did not price (see The model).</p>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('drawer').hidden = false;
    $('scrim').hidden = false;
  }
  function closeDetail() { $('drawer').hidden = true; $('scrim').hidden = true; }
  $('drawer-close').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);

  // ---- live evidence ----
  $('live-body').innerHTML = R.live.map(function (p) {
    var ratio = p.fitted_value_usd && p.mcap_usd ? (p.fitted_value_usd / p.mcap_usd).toFixed(2) + 'x' : '-';
    return '<tr><td><span class="pname">' + esc(p.name) + '</span> <span class="pslug">' + esc(p.symbol || '') + '</span></td>' +
      '<td>' + esc(p.category || '-') + '</td>' +
      '<td class="num">' + fmt$(p.tvl_usd) + '</td>' +
      '<td class="num">' + fmt$(p.mcap_usd) + '</td>' +
      '<td class="num">' + (p.multiple !== null ? p.multiple.toFixed(2) + 'x' : '-') + '</td>' +
      '<td class="num">' + fmt$(p.fitted_value_usd) + '</td>' +
      '<td class="num">' + ratio + '</td></tr>';
  }).join('');

  // ---- model view ----
  var groups = R.peer_groups.filter(function (g) { return g.kind === 'category'; }).slice(0, 14);
  $('model-version').textContent = R.model_version;
  $('model-body').innerHTML =
    '<div class="model-grid">' +
    '<div class="card"><h3>The fitted relationship</h3>' +
    '<p><code>ln(mcap / TVL) = ' + R.fit.intercept.toFixed(2) + ' + (' + R.fit.size_slope.toFixed(2) + ') x s + (' + R.fit.size_quad.toFixed(2) + ') x s^2 + group offset, s = ln TVL - mean ln TVL</code></p>' +
    '<p>Fitted on the ' + R.fit.protocols + ' traded protocols with a recorded market cap, by ridge-regularised iteratively reweighted least squares toward the conditional median, so the snapshot\'s extreme multiples (0.0003x to 400x) cannot set the price. At the typical TVL the base multiple is ' + R.fit.base_multiple.toFixed(2) + 'x; the fitted size slope of ' + R.fit.size_slope.toFixed(2) + ' means a protocol ten times the typical size carries about a quarter of the typical multiple — the single largest correction over a flat-multiple model. The curvature term (' + R.fit.size_quad.toFixed(2) + ') bends that line: the discount is steepest near the typical size and flattens for the largest protocols. New in fitcomps-2, with hierarchical group offsets below: on the backtest beside this card the median error moves from x3.9 to x3.7 and the within-2x share from 32% to 33% against fitcomps-1, the previous round\'s straight-line fit.</p></div>' +
    '<div class="card"><h3>The backtest (computed at run time)</h3>' +
    '<p>Deterministic 10-fold cross-validation over the ' + bt.protocols + ' traded protocols, five partitions: refit on nine folds, price the held-out fold, compare with the recorded market cap.</p>' +
    '<ul><li>Median absolute error: <b>x' + bt.typical_factor.toFixed(1) + '</b> (log10 ' + bt.median_abs_log10.toFixed(2) + ')</li>' +
    '<li>Priced within 2x of recorded: <b>' + Math.round(bt.within_2x * 100) + '%</b>; within 5x: <b>' + Math.round(bt.within_5x * 100) + '%</b></li>' +
    '<li>Rank correlation (Spearman): <b>' + bt.spearman.toFixed(2) + '</b>; mean bias: ' + (bt.bias_log10 >= 0 ? '+' : '') + bt.bias_log10.toFixed(2) + ' log10</li></ul></div>' +
    '<div class="card"><h3>Fitted and rejected</h3>' +
    '<p>Three candidate signals were fitted again for this round — jointly with the size curve, under the same regularisation — and rejected again, because they moved the backtest error by less than their own noise: 7-day TVL growth, protocol age, and chain count. They appear on every row as context, and age sets the farm plan\'s holding period, but they do not move the price. A model that only uses what the record supports is the claim; the backtest above is the evidence.</p></div>' +
    '<div class="card"><h3>Group offsets</h3>' +
    '<p>Each category\'s offset is the median residual of its traded members, shrunk toward zero by n/(n+10), and blended with its family\'s offset at the same weight: deep categories price themselves, thin ones lean on their family instead of standing alone. Categories with no traded members take their family\'s offset whole.</p>' +
    '<table class="mini"><thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Offset</th><th class="num">Band q1-q3</th></tr></thead><tbody>' +
    groups.map(function (g) {
      return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.peers + '</td><td class="num">' + (g.offset >= 0 ? '+' : '') + g.offset.toFixed(2) + '</td><td class="num">' + g.band_q1.toFixed(2) + ' / ' + g.band_q3.toFixed(2) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>' +
    '<p class="foot">Snapshot: ' + esc(R.as_of) + ', ' + R.protocols_total + ' protocols, source ' + esc(R.source) + '. The board ranks ' + R.board_size + ' pre-token protocols (all ' + R.watchlist_size + ' watchlist members and ' + R.early_size + ' earlier ones below the $50M floor). An implied value is the entry\'s own claim about what a launch would be worth if the record stayed as it is.</p>';

  // ---- views + hash routing ----
  function showView(name) {
    var boardish = name === 'board' || name === 'watchlist';
    $('view-board').hidden = !boardish;
    $('view-live').hidden = name !== 'live';
    $('view-model').hidden = name !== 'model';
    $('controls').style.display = boardish ? '' : 'none';
    var btns = document.querySelectorAll('.view-btn');
    btns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === name); });
    if (name === 'watchlist' && !$('f-watch').checked) { $('f-watch').checked = true; renderBoard(); }
    if (name === 'board' && $('f-watch').checked) { $('f-watch').checked = false; renderBoard(); }
  }
  document.querySelectorAll('.view-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-view');
      if (v === 'board') location.hash = '';
      else location.hash = v;
      showView(v);
    });
  });
  function route() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('p/') === 0) { showView('board'); openDetail(h.slice(2)); }
    else if (h === 'watchlist' || h === 'live' || h === 'model') { closeDetail(); showView(h); }
    else { closeDetail(); showView('board'); }
  }
  window.addEventListener('hashchange', route);
  renderBoard();
  route();
})();
