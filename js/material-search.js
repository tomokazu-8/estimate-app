// ===== MATERIAL SEARCH =====
// CAT_LABELSはMATERIAL_CATEGORIESから動的生成
const CAT_LABELS = {};
(typeof MATERIAL_CATEGORIES !== 'undefined' ? MATERIAL_CATEGORIES : []).forEach(c => { CAT_LABELS[c.id] = c.name; });

let searchTargetItemId = null;
let _searchResults = [];
let _suggestMatches = [];

// カテゴリフィルタを MATERIAL_CATEGORIES から動的生成
function initCatFilter() {
  const sel = document.getElementById('searchCatFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">全カテゴリ</option>';
  if (typeof MATERIAL_CATEGORIES !== 'undefined') {
    MATERIAL_CATEGORIES.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      sel.appendChild(opt);
    });
  }
  if (current) sel.value = current;
}

function openSearchModal(itemId) {
  searchTargetItemId = itemId;
  document.getElementById('searchModal').classList.add('show');
  document.getElementById('searchQuery').value = '';
  document.getElementById('searchCatFilter').value = '';
  _initSearchSourceFilter();
  initBunruiFilter();
  searchMaterial();
  setTimeout(() => document.getElementById('searchQuery').focus(), 100);
}

// ソース切替セレクトを動的生成
function _initSearchSourceFilter() {
  const sel = document.getElementById('searchSource');
  if (!sel) return;
  sel.innerHTML = '<option value="">全ソース</option>';
  if (typeof TRIDGE_APPLIED !== 'undefined') {
    if (TRIDGE_APPLIED.zairyo) {
      sel.innerHTML += `<option value="zairyo">資材: ${esc(TRIDGE_APPLIED.zairyo.tridgeName)}</option>`;
    }
    (TRIDGE_APPLIED.suppliers || []).forEach(s => {
      sel.innerHTML += `<option value="sup_${s.tridgeId}">仕入: ${esc(s.tridgeName)}</option>`;
    });
  }
}

// ===== 分類階層フィルタ =====
function initBunruiFilter() {
  const row = document.getElementById('bunruiFilterRow');
  if (!row) return;
  // 分類マスタがあり、かつ材料レコードに daiId が付与されている場合のみ表示
  const hasBunrui = BUNRUI_DB && BUNRUI_DB.rows && BUNRUI_DB.rows.length > 0
                    && MATERIAL_DB.some(m => m.daiId);
  row.style.display = hasBunrui ? 'flex' : 'none';
  if (!hasBunrui) return;

  // 大分類を重複なしで列挙
  const daiSel = document.getElementById('searchDaiFilter');
  const seen = new Map();
  BUNRUI_DB.rows.forEach(r => { if (!seen.has(r.daiId)) seen.set(r.daiId, r.daiName); });
  daiSel.innerHTML = '<option value="">大分類（全て）</option>' +
    Array.from(seen.entries()).map(([id, name]) =>
      `<option value="${id}">${id} ${name}</option>`
    ).join('');
  document.getElementById('searchChuFilter').innerHTML = '<option value="">中分類（全て）</option>';
  document.getElementById('searchShoFilter').innerHTML = '<option value="">小分類（全て）</option>';
}

function onDaiFilterChange() {
  const daiId = document.getElementById('searchDaiFilter').value;
  const chuSel = document.getElementById('searchChuFilter');
  const shoSel = document.getElementById('searchShoFilter');

  // 中分類を更新
  const seen = new Map();
  BUNRUI_DB.rows.forEach(r => {
    if ((!daiId || r.daiId === daiId) && !seen.has(r.chuId))
      seen.set(r.chuId, r.chuName);
  });
  chuSel.innerHTML = '<option value="">中分類（全て）</option>' +
    Array.from(seen.entries()).map(([id, name]) =>
      `<option value="${id}">${id} ${name}</option>`
    ).join('');
  shoSel.innerHTML = '<option value="">小分類（全て）</option>';
  searchMaterial();
}

function onChuFilterChange() {
  const chuId = document.getElementById('searchChuFilter').value;
  const daiId = document.getElementById('searchDaiFilter').value;
  const shoSel = document.getElementById('searchShoFilter');

  // 小分類を更新
  const filtered = BUNRUI_DB.rows.filter(r =>
    (!daiId || r.daiId === daiId) && (!chuId || r.chuId === chuId)
  );
  shoSel.innerHTML = '<option value="">小分類（全て）</option>' +
    filtered.map(r => `<option value="${r.shoId}">${r.shoName}（${r.count}件）</option>`).join('');
  searchMaterial();
}

function closeSearchModal() {
  document.getElementById('searchModal').classList.remove('show');
  searchTargetItemId = null;
}

// ===== 共通ヘルパー =====

/** 複数キーワードAND検索 */
function filterMaterialsByTerms(materials, query, limit = null) {
  if (!query || query.length < 1) return limit ? materials.slice(0, limit) : materials;
  const terms = norm(query).split(/\s+/);
  const filtered = materials.filter(m => {
    const text = norm(m.n + ' ' + m.s);
    return terms.every(t => text.includes(t));
  });
  return limit ? filtered.slice(0, limit) : filtered;
}

/** 材料を品目に反映（selectMaterial / applySuggestion 共通） */
function applyMaterialToItem(item, m) {
  item.name     = m.n;
  item.spec     = m.s;
  item.unit     = m.u;
  item.price    = m.ep;
  item.bukariki1 = findBukariki(m.n, m.s || '').value;
  if (item.qty) item.amount = (parseFloat(item.qty) || 0) * m.ep;
}

function searchMaterial() {
  const query = norm(document.getElementById('searchQuery').value).trim();
  const catFilter = document.getElementById('searchCatFilter').value;
  const sourceFilter = document.getElementById('searchSource')?.value || '';
  const shoId = document.getElementById('searchShoFilter')?.value || '';
  const chuId = document.getElementById('searchChuFilter')?.value || '';
  const daiId = document.getElementById('searchDaiFilter')?.value || '';

  // ソース別の検索対象を構築
  let searchPool;
  if (!sourceFilter) {
    // 全ソース: MATERIAL_DB（適用中の全品目）をそのまま検索
    searchPool = MATERIAL_DB.map(m => ({ ...m, _source: '' }));
  } else if (sourceFilter === 'zairyo' && typeof TRIDGE_APPLIED !== 'undefined' && TRIDGE_APPLIED.zairyo) {
    // 資材Tridgeのみ: localStorageから直接読み込み
    const rows = typeof tmLoadDbData === 'function' ? tmLoadDbData(TRIDGE_APPLIED.zairyo.tridgeId) : [];
    searchPool = rows.filter(r => parseFloat(r.ep) > 0).map(r => ({
      n: r.n, s: r.s, u: r.u, c: r.c, ep: parseFloat(r.ep) || 0,
      cp: parseFloat(r.cp) || 0, r: parseFloat(r.r) || 0.75,
      daiId: r.daiId, chuId: r.chuId, shoId: r.shoId, shoName: r.shoName,
      _source: '資材',
    }));
  } else if (sourceFilter.startsWith('sup_')) {
    // 特定の仕入れTridge
    const tridgeId = sourceFilter.slice(4);
    const rows = typeof tmLoadDbData === 'function' ? tmLoadDbData(tridgeId) : [];
    const sup = typeof TRIDGE_APPLIED !== 'undefined'
      ? TRIDGE_APPLIED.suppliers.find(s => s.tridgeId === tridgeId) : null;
    const sourceName = sup ? sup.tridgeName : '仕入れ';
    searchPool = rows.filter(r => parseFloat(r.ep) > 0).map(r => ({
      n: r.n, s: r.s, u: r.u, c: r.c, ep: parseFloat(r.ep) || 0,
      cp: parseFloat(r.cp) || 0, r: parseFloat(r.r) || 0.75,
      daiId: r.daiId, chuId: r.chuId, shoId: r.shoId, shoName: r.shoName,
      _source: sourceName,
    }));
  } else {
    searchPool = MATERIAL_DB.map(m => ({ ...m, _source: '' }));
  }

  let results = searchPool;

  if (catFilter) results = results.filter(m => m.c === catFilter);

  // 分類フィルタ（小→中→大の順で優先）
  if (shoId)      results = results.filter(m => m.shoId === shoId);
  else if (chuId) results = results.filter(m => m.chuId === chuId);
  else if (daiId) results = results.filter(m => m.daiId === daiId);

  results = filterMaterialsByTerms(results, query, 50);

  const totalCount = sourceFilter ? searchPool.length : MATERIAL_DB.length;
  document.getElementById('searchCount').textContent = `${results.length}件表示（全${totalCount}品目）`;
  document.getElementById('searchBody').innerHTML = results.map((m, i) => `
    <tr>
      <td style="font-size:11px;">
        ${m._source ? `<span class="tag" style="background:#fef3c7;color:#92400e;margin-right:3px;font-size:9px;">${esc(m._source)}</span>` : ''}
        <span class="tag tag-blue" style="margin-right:4px;">${CAT_LABELS[m.c]||m.c}</span>${esc(m.n)}
      </td>
      <td style="font-size:11px;color:var(--text-sub);">${esc(m.s)}</td>
      <td class="td-center" style="font-size:11px;">${m.u}</td>
      <td class="td-right" style="font-size:11px;">¥${formatNum(Math.round(m.ep))}</td>
      <td class="td-right" style="font-size:11px;">¥${formatNum(Math.round(m.cp))}</td>
      <td class="td-right" style="font-size:11px;">${(m.r*100).toFixed(0)}%</td>
      <td><button class="btn btn-primary btn-sm" style="padding:3px 8px;font-size:10px;" onclick="selectMaterial(${i})">選択</button></td>
    </tr>
  `).join('');
  _searchResults = results;
}

function selectMaterial(resultIdx) {
  const m = _searchResults[resultIdx];
  if (!m) return;

  saveUndoState();
  if (searchTargetItemId !== null) {
    const item = (items[currentCat] || []).find(i => i.id === searchTargetItemId);
    if (item) applyMaterialToItem(item, m);
  } else {
    items[currentCat].push(createBlankItem({
      name: m.n, spec: m.s, unit: m.u, price: m.ep,
      bukariki1: findBukariki(m.n, m.s || '').value,
    }));
  }

  closeSearchModal();
  renderItems();
  renderCatTabs();
  showToast(`${m.n} を選択しました`);
}

// ===== INLINE SUGGESTION (on name input) =====

function showSuggestions(itemId, query) {
  const el = document.getElementById('suggest-' + itemId);
  if (!el) return;

  const matches = filterMaterialsByTerms(MATERIAL_DB, query, 8);
  if (!query || query.length < 2 || matches.length === 0) {
    el.classList.remove('show');
    return;
  }

  el.innerHTML = matches.map((m, i) => `
    <div class="suggest-item" onmousedown="applySuggestion(${itemId}, ${i})">
      <span><span class="s-name">${m.n}</span> <span class="s-spec">${m.s}</span></span>
      <span class="s-price">¥${formatNum(Math.round(m.ep))}/${m.u}</span>
    </div>
  `).join('');
  el.classList.add('show');
  _suggestMatches = matches;
}

function hideSuggestions(itemId) {
  setTimeout(() => {
    const el = document.getElementById('suggest-' + itemId);
    if (el) el.classList.remove('show');
  }, 200);
}

function applySuggestion(itemId, matchIdx) {
  const m = _suggestMatches[matchIdx];
  if (!m) return;

  saveUndoState();
  const item = (items[currentCat] || []).find(i => i.id === itemId);
  if (item) applyMaterialToItem(item, m);
  renderItems();
  renderCatTabs();
}
