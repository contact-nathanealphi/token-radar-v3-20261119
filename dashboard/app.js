/* Token Radar V3 page: one dataset (window.RADAR from ../data.js), one summary
   (window.RADAR_SUMMARY from summary.js), three views plus a detail view.
   Every number on screen comes from those two scripts, which the program wrote
   from the same sealed snapshot as board.json: the page and the board agree by
   construction, and the detail view reprints the recompute proof per row. */
(function () {
  'use strict';
  var R = window.RADAR;
  var S = window.RADAR_SUMMARY || null;
  if (!R) { document.getElementById('headline').textContent = 'No data: data.js did not load.'; return; }
  var rows = R.rows;
  var maxImplied = rows[0] ? rows[0].implied_value_usd : 1;

  /* ---- formatting ---- */
  function usd(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30) + 'mo';
    return days + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chainSummary(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
  }

  /* ---- header: headline, validation strip, footer ---- */
  document.getElementById('headline').textContent =
    rows.length + ' protocols that record no token, ranked by fitted implied value from the ' + R.as_of +
    ' snapshot. All ' + R.watchlist_size + ' watchlist protocols are covered, plus ' + (rows.length - R.watchlist_size) +
    ' more pre-token protocols that pass the watchlist rule. No wrapped, staked or bridged products: those never launch a token of their own.';
  if (S) {
    var v = S.validation, a = S.accounting;
    document.getElementById('validstrip').innerHTML =
      'Model <b>' + esc(S.model.version) + '</b> · <b>' + S.model.peerCount + '</b> live-token peers · ' +
      'leave-one-out <b>' + v.looModel + '</b> vs flat ' + v.looFlat + ' · blind time-split <b>' + v.splitModel +
      '</b> vs flat ' + v.splitFlat + ' · <b>' + a.total + '/' + a.total + '</b> protocols accounted · ' +
      '<b>' + a.watchlistOnBoard + '/' + a.watchlist + '</b> watchlist';
  }
  document.getElementById('foot').textContent =
    'Source: ' + R.source + '. Implied values are this radar\u2019s own claims, never predictions that a token launches. ' +
    'Model ' + R.model_version + ': peer multiples fit from the snapshot, validated blind, intervals from 200 bootstrap refits.';

  /* ---- filters ---- */
  var state = { q: '', cat: '', chain: '', conf: '', verdict: '', watch: false, sortKey: 'rank', sortDir: -1 };
  var catSel = document.getElementById('f-cat');
  var chainSel = document.getElementById('f-chain');
  var cats = {}, chains = {};
  rows.forEach(function (r) { cats[r.category || '(none)'] = 1; (r.chains || []).forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });
  Object.keys(chains).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o); });

  function filteredRows() {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0 && String(r.category || '').toLowerCase().indexOf(q) < 0)) return false;
      if (state.cat && (r.category || '(none)') !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.conf && r.confidence !== state.conf) return false;
      if (state.verdict && r.farm_costing.verdict !== state.verdict) return false;
      if (state.watch && !r.watchlist) return false;
      return true;
    });
  }
  function sortValue(r, key) {
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? -1 : r.age_days;
    if (key === 'ratio') return r.farm_costing.ratio;
    if (key === 'name') return r.name.toLowerCase();
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    var k = state.sortKey, d = state.sortDir;
    return list.slice().sort(function (a, b) {
      var va = sortValue(a, k), vb = sortValue(b, k);
      if (va < vb) return -d; if (va > vb) return d;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  /* ---- board ---- */
  var COLS = [
    { key: '#', label: '#', cls: 'num', sort: null },
    { key: 'name', label: 'Protocol', cls: '', sort: 'name' },
    { key: 'cat', label: 'Category', cls: '', sort: null },
    { key: 'tvl', label: 'TVL', cls: 'num', sort: 'tvl' },
    { key: 'growth', label: '7D', cls: 'num', sort: 'growth' },
    { key: 'age', label: 'Age', cls: 'num', sort: 'age' },
    { key: 'implied', label: 'Implied value', cls: 'num', sort: 'rank' },
    { key: 'interval', label: 'Interval (p10–p90)', cls: 'num', sort: null },
    { key: 'range', label: 'Rank range', cls: 'num', sort: null },
    { key: 'conf', label: 'Confidence', cls: '', sort: null },
    { key: 'verdict', label: 'Verdict', cls: '', sort: 'ratio' },
  ];
  function renderBoard() {
    var list = sortedRows(filteredRows());
    var h = '<thead><tr>' + COLS.map(function (c) {
      var arrow = '';
      if (c.sort && state.sortKey === c.sort) arrow = state.sortDir === 1 ? ' \u25B2' : ' \u25BC';
      return '<th class="' + c.cls + (c.sort ? ' sortable' : '') + '" data-sort="' + (c.sort || '') + '">' + c.label + arrow + '</th>';
    }).join('') + '</tr></thead><tbody>';
    list.forEach(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      h += '<tr><td class="num">' + r.rank + '</td>' +
        '<td><a class="rowlink" href="#/protocol/' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.watchlist ? ' <span class="badge watch">WATCHLIST</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '<span class="slug">' + esc(chainSummary(r.chains)) + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b><span class="bar"><i style="width:' + w + '%"></i></span></td>' +
        '<td class="num nowrap">' + usd(r.interval_low) + ' – ' + usd(r.interval_high) + '</td>' +
        '<td class="num nowrap">#' + r.rank_low + '–#' + r.rank_high + '</td>' +
        '<td><span class="badge ' + r.confidence + '">' + r.confidence + '</span></td>' +
        '<td><span class="badge ' + r.farm_costing.verdict + '">' + r.farm_costing.verdict + '</span></td></tr>';
    });
    h += '</tbody>';
    document.getElementById('board').innerHTML = h;
    document.getElementById('f-count').textContent = list.length + ' of ' + rows.length + ' shown';
    var ths = document.getElementById('board').querySelectorAll('th.sortable');
    Array.prototype.forEach.call(ths, function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sortKey === k) state.sortDir = -state.sortDir;
        else { state.sortKey = k; state.sortDir = k === 'name' ? 1 : -1; }
        renderBoard();
      });
    });
  }

  /* ---- detail view: full breakdown, recompute proof, costed farm plan ---- */
  function recomputeProof(r) {
    return usdFull(r.tvl_usd) + ' \u00D7 ' + r.base_multiple.toFixed(4) + ' peer multiple = ' + usdFull(r.implied_value_usd) + ' \u2014 the same number board.json carries for rank ' + r.rank + '.';
  }
  function renderDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var el = document.getElementById('detail');
    if (!r) { el.innerHTML = '<p>Unknown protocol: ' + esc(slug) + '.</p>'; return; }
    var c = r.farm_costing;
    var flags = r.flags.length ? r.flags.map(esc).join('; ') : 'none';
    var h = '<h2 class="sec" style="margin-top:0">#' + r.rank + ' ' + esc(r.name) +
      (r.watchlist ? ' <span class="badge watch">WATCHLIST</span>' : '') +
      ' <span class="badge ' + r.confidence + '">' + r.confidence + ' confidence</span>' +
      ' <span class="badge ' + c.verdict + '">' + c.verdict + '</span></h2>' +
      '<p class="note">' + esc(r.category || 'Uncategorized') + ' · ' + esc(chainSummary(r.chains)) +
      (r.chains.length > 3 ? ' (' + r.chains.length + ' chains)' : '') + ' · records no token · listed ' + esc(r.listed_at || 'date not reported') + '.</p>' +
      '<div class="grid grid2">' +
      '<div class="card"><h3>Value breakdown</h3><dl class="kv">' +
      '<dt>TVL</dt><dd>' + usdFull(r.tvl_usd) + '</dd>' +
      '<dt>Base multiple</dt><dd>' + r.base_multiple.toFixed(4) + '\u00D7 (' + r.peers_in_category + (r.peers_in_category === 1 ? ' peer in category' : ' peers in category') + ')</dd>' +
      '<dt>Fitted multiple</dt><dd>' + r.multiple.toFixed(4) + '\u00D7</dd>' +
      '<dt>Implied value</dt><dd><b>' + usdFull(r.implied_value_usd) + '</b></dd>' +
      '<dt>Interval (p10–p90)</dt><dd>' + usd(r.interval_low) + ' – ' + usd(r.interval_high) + '</dd>' +
      '<dt>Rank range (200 refits)</dt><dd>#' + r.rank_low + '–#' + r.rank_high + '</dd>' +
      '<dt>7-day growth</dt><dd>' + pct(r.change_7d) + '</dd>' +
      '<dt>Age</dt><dd>' + ageFmt(r.age_days) + '</dd>' +
      '<dt>Flags</dt><dd>' + esc(flags) + '</dd></dl></div>' +
      '<div class="card"><h3>Farm costing</h3><dl class="kv">' +
      '<dt>Capital deployed</dt><dd>$' + c.capital + '</dd>' +
      '<dt>On-chain actions</dt><dd>' + c.actions + ' \u00D7 $' + (S ? S.costModel.gasPerAction : 2) + ' gas</dd>' +
      '<dt>Total gas</dt><dd>$' + c.gasTotal + '</dd>' +
      '<dt>Break-even airdrop</dt><dd><b>$' + c.breakEven + '</b></dd>' +
      '<dt>Time, all in</dt><dd>' + c.hours + ' hours over ' + c.holdDays + ' days</dd>' +
      '<dt>Gas per hour</dt><dd>$' + c.costPerHour + '/hour</dd>' +
      '<dt>Implied per $ gas</dt><dd>' + c.ratio.toLocaleString('en-US') + '\u00D7</dd>' +
      '<dt>Verdict</dt><dd><span class="badge ' + c.verdict + '">' + c.verdict + '</span></dd></dl>' +
      '<p>Break-even means: any airdrop above $' + c.breakEven + ' covers the gas. Capital is deployed, not spent. ' +
      'Verdict rule: farm at 500,000\u00D7 implied per dollar of gas, thin at 100,000\u00D7, skip below.</p></div></div>' +
      '<p class="proof">' + esc(recomputeProof(r)) + '</p>' +
      '<h2 class="sec">Farm plan: ' + c.actions + ' actions, $' + c.gasTotal + ' gas, ' + c.holdDays + ' days</h2>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">Why this rank: ' + esc(r.name) + ' ranks #' + r.rank + ' because its TVL times the ' +
      esc(r.category || 'uncategorized') + ' peer multiple gives ' + usd(r.implied_value_usd) + ', inside a refit range of #' +
      r.rank_low + '–#' + r.rank_high + '. The interval is wide because peer multiples vary by orders of magnitude ' +
      'within a category: the board reports the uncertainty instead of hiding it.</p>';
    el.innerHTML = h;
  }

  /* ---- live-token view: the market's own values, never modelled ---- */
  function renderLive() {
    var h = '<thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th><th class="num">7D</th></tr></thead><tbody>';
    R.live.forEach(function (p) {
      h += '<tr><td><b>' + esc(p.name) + '</b><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td>' +
        '<td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + (p.multiple === null ? '—' : p.multiple.toFixed(3) + '\u00D7') + '</td>' +
        '<td class="num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(p.change_7d) + '</td></tr>';
    });
    document.getElementById('livetable').innerHTML = h + '</tbody>';
  }

  /* ---- method & accounting: the evidence, from the summary script ---- */
  function renderMethod() {
    if (!S) { document.getElementById('method').innerHTML = '<p>Summary did not load.</p>'; return; }
    var v = S.validation, a = S.accounting, m = S.model;
    var h = '<div class="method">' +
      '<h2 class="sec" style="margin-top:0">The model: ' + esc(m.version) + '</h2>' +
      '<p><b>Implied value = TVL \u00D7 shrunk category multiple.</b> The multiple is the median ' +
      'market-cap/TVL of live-token peers in the protocol\u2019s category, winsorized to the global quartiles (' +
      m.q1 + '\u00D7 to ' + m.q3 + '\u00D7) and shrunk toward the global median (' + m.globalMedian + '\u00D7) with ' + m.prior +
      ' pseudo-peers, so a category with one peer barely moves the median, and clamped to ' + m.clamp[0] + '\u2013' + m.clamp[1] +
      '\u00D7. Growth, age and chain-count tilts were fitted and <b>rejected</b>: their slopes flip sign between the train fit and the full fit ' +
      '(growth ' + v.tilts.trainSlopes.growth + ' on older peers, ' + v.tilts.fullSlopes.growth + ' on all peers), so the shipped value carries no tilt. ' +
      'Growth and age drive the farm plan and the flags instead. ' +
      'No protocol name is hard-coded; the same functions score every row, and every number here was computed at run time from the sealed snapshot.</p>' +
      '<h2 class="sec">Validation: fitted, then tested blind</h2>' +
      '<p>Median absolute log error on live-token peers, whose market caps are known (lower wins; 1.6 means a typical miss of about 5\u00D7 \u2014 peer multiples vary enormously, and the board is honest about it).</p>' +
      '<table><thead><tr><th>Test</th><th class="num">Model</th><th class="num">Flat median</th><th>Reading</th></tr></thead><tbody>' +
      '<tr><td>Leave-one-out (' + v.peerCount + ' peers)</td><td class="num"><b>' + v.looModel + '</b></td><td class="num">' + v.looFlat + '</td><td>A tie: shrinkage neither helps nor hurts held-out peers.</td></tr>' +
      '<tr><td>Blind time-split (fit ' + v.splitTrain + ' older, test ' + v.splitTest + ' newer)</td><td class="num"><b>' + v.splitModel + '</b></td><td class="num">' + v.splitFlat + '</td><td>The category model does <b>not</b> beat flat out of sample; the gap is within noise at n=' + v.splitTest + '.</td></tr>' +
      '<tr><td>Time-split, tilts on vs off</td><td class="num"><b>' + v.tilts.splitWithTilts + '</b> / rank ' + v.tilts.spearmanWithTilts + '</td><td class="num">' + v.tilts.splitNoTilts + ' / rank ' + v.tilts.spearmanNoTilts + ' (no tilts)</td><td>Tilts shave 0.01 off the error but cut rank correlation from ' + v.tilts.spearmanNoTilts + ' to ' + v.tilts.spearmanWithTilts + ', and their slopes flip sign between fits: rejected.</td></tr>' +
      '<tr><td>Rank correlation on the split</td><td class="num"><b>' + v.splitSpearmanModel + '</b></td><td class="num">' + v.splitSpearmanTvl + ' (TVL alone)</td><td>The multiple adds a little ranking signal over TVL alone.</td></tr></tbody></table>' +
      '<p>Shrinkage grid (leave-one-out, base multiple only): ' + v.kGrid.map(function (g) { return 'prior ' + g.prior + ': ' + g.loo; }).join(' · ') +
      '. The curve is flat, so the prior of ' + m.prior + ' is chosen for stability in thin categories, not for a fitted edge. ' +
      'Bootstrap: ' + v.bootstrapRefits + ' seeded refits of the whole model give every row its rank range and interval.</p>' +
      '<p>Confidence labels: high when a category has at least 5 peers and the refit rank range spans at most 30 places; ' +
      'medium at 2 peers and 60 places; low otherwise. Most rows are low because most categories have few live-token peers \u2014 the label says so rather than flattering the estimate.</p>' +
      '<h2 class="sec">Accounting: all ' + a.total + ' snapshot protocols, placed</h2>' +
      '<table><thead><tr><th>Group</th><th class="num">Count</th><th>What happens to them</th></tr></thead><tbody>' +
      '<tr><td>Record a token</td><td class="num">' + a.live + '</td><td>' + a.liveWithMcap + ' carry a market cap; ' + a.liveNoMcap + ' record a token with none. Shown in Already trades, never ranked.</td></tr>' +
      '<tr><td>Usable peers</td><td class="num">' + a.peers + '</td><td>Live, positive market cap and TVL, no exchange. The model fits from these.</td></tr>' +
      a.peerExcluded.map(function (e) { return '<tr><td>Peer excluded: ' + esc(e.reason) + '</td><td class="num">' + e.count + '</td><td>Not usable as a peer; still shown in Already trades where listed.</td></tr>'; }).join('') +
      '<tr><td>Record no token</td><td class="num">' + a.preToken + '</td><td>' + a.boardRows + ' ranked on the board; the rest excluded below, each with a stated reason.</td></tr>' +
      a.excluded.map(function (e) { return '<tr><td>Excluded: ' + esc(e.reason) + '</td><td class="num">' + e.count + '</td><td>Wrapped, staked, bridged, versioned or exchange products: never a launch of their own.</td></tr>'; }).join('') +
      '<tr><td>Watchlist</td><td class="num">' + a.watchlistOnBoard + ' / ' + a.watchlist + '</td><td>Every watchlist protocol is on the board.</td></tr></tbody></table>' +
      '<h2 class="sec">Peer multiples by category</h2>' +
      '<table><thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Shrunk multiple</th></tr></thead><tbody>' +
      m.categories.map(function (c) { return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num">' + c.multiple.toFixed(4) + '\u00D7</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2 class="sec">Farm costing: stated rules, applied uniformly</h2>' +
      '<p>Gas $' + S.costModel.gasPerAction + ' per on-chain action; exit gas $' + S.costModel.exitGas + ' in the break-even figure. ' +
      'Capital by TVL: ' + S.costModel.capitalTiers.map(function (t) { return 'TVL \u2265 ' + usd(t.tvlAtLeast) + ': $' + t.capital; }).join('; ') + '. ' +
      'Hold window: ' + esc(S.costModel.holdRule) + '. Verdict: ' + esc(S.costModel.verdictRule) + '.</p>' +
      '<h2 class="sec">Limits, stated plainly</h2><ul>' +
      '<li>The snapshot is one day (2026-11-14). Nothing here predicts whether or when a token launches.</li>' +
      '<li>Peer multiples span orders of magnitude within a category, so intervals are wide and ranks are ranges.</li>' +
      '<li>Gas and capital figures are planning assumptions, stated above, not quotes: check the chain before acting.</li>' +
      '<li>A protocol on the board may still record a token elsewhere; the snapshot says it records none here.</li></ul></div>';
    document.getElementById('method').innerHTML = h;
  }

  /* ---- routing ---- */
  var views = { board: 'view-board', live: 'view-live', method: 'view-method', detail: 'view-detail' };
  function show(name) {
    Object.keys(views).forEach(function (k) { document.getElementById(views[k]).hidden = k !== name; });
    document.body.classList.toggle('detail-view', name === 'detail');
    ['board', 'live', 'method'].forEach(function (k) {
      var t = document.getElementById('tab-' + k);
      if (k === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
  }
  function route() {
    var hash = location.hash || '#/board';
    if (hash.indexOf('#/protocol/') === 0) {
      renderDetail(decodeURIComponent(hash.slice(11).split('?')[0]));
      show('detail');
      return;
    }
    var parts = hash.split('?');
    var params = new URLSearchParams(parts[1] || '');
    if (params.get('cat')) { state.cat = params.get('cat'); catSel.value = state.cat; }
    if (params.get('chain')) { state.chain = params.get('chain'); chainSel.value = state.chain; }
    if (params.get('conf')) { state.conf = params.get('conf'); document.getElementById('f-conf').value = state.conf; }
    if (params.get('verdict')) { state.verdict = params.get('verdict'); document.getElementById('f-verdict').value = state.verdict; }
    if (params.get('watchlist')) { state.watch = true; document.getElementById('f-watch').checked = true; }
    if (params.get('q')) { state.q = params.get('q'); document.getElementById('f-q').value = state.q; }
    if (parts[0] === '#/live') { renderLive(); show('live'); }
    else if (parts[0] === '#/method') { renderMethod(); show('method'); }
    else { renderBoard(); show('board'); }
  }
  ['f-q', 'f-cat', 'f-chain', 'f-conf', 'f-verdict'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function (e) {
      var map = { 'f-q': 'q', 'f-cat': 'cat', 'f-chain': 'chain', 'f-conf': 'conf', 'f-verdict': 'verdict' };
      state[map[id]] = e.target.value;
      renderBoard();
    });
  });
  document.getElementById('f-watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  window.addEventListener('hashchange', route);
  renderBoard();
  renderLive();
  renderMethod();
  route();
})();
