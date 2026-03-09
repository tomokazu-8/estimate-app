// ===== MATERIAL SEARCH =====
const CAT_LABELS = {cable:'電線',conduit:'管',device:'器具',box:'BOX',panel:'盤',fixture:'照明',dimmer:'調光',fire:'火報',ground:'接地',accessories:'付属'};

let searchTargetItemId = null;
let _searchResults = [];
let _suggestMatches = [];

// カテゴリフィルタを CATEGORY_MASTER から動的生成
function initCatFilter() {
  const sel = document.getElementById('searchCatFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">全カテゴリ</option>';
  if (CATEGORY_MASTER && CATEGORY_MASTER.length > 0) {
    CATEGORY_MASTER.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.catId;
      opt.textContent = cat.catName;
      sel.appendChild(opt);
    });
  }
  // 値を復元（あれば）
  if (current) sel.value = current;
}

function openSearchModal(itemId) {
  searchTargetItemId = itemId;
  document.getElementById('searchModal').classList.add('show');
  document.getElementById('searchQuery').value = '';
  document.getElementById('searchCatFilter').value = '';
  initBunruiFilter();
  searchMaterial();
  setTimeout(() => document.getElementById('searchQuery').focus(), 100);
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
  item.bukariki = findBukariki(m.n, m.s || '').value;
  if (item.qty) item.amount = (parseFloat(item.qty) || 0) * m.ep;
}

function searchMaterial() {
  const query = norm(document.getElementById('searchQuery').value).trim();
  const catFilter = document.getElementById('searchCatFilter').value;
  const shoId = document.getElementById('searchShoFilter')?.value || '';
  const chuId = document.getElementById('searchChuFilter')?.value || '';
  const daiId = document.getElementById('searchDaiFilter')?.value || '';

  let results = MATERIAL_DB;

  if (catFilter) results = results.filter(m => m.c === catFilter);

  // 分類フィルタ（小→中→大の順で優先）
  if (shoId)      results = results.filter(m => m.shoId === shoId);
  else if (chuId) results = results.filter(m => m.chuId === chuId);
  else if (daiId) results = results.filter(m => m.daiId === daiId);

  results = filterMaterialsByTerms(results, query, 50);

  document.getElementById('searchCount').textContent = `${results.length}件表示（全${MATERIAL_DB.length}品目）`;
  document.getElementById('searchBody').innerHTML = results.map((m, i) => `
    <tr>
      <td style="font-size:11px;"><span class="tag tag-blue" style="margin-right:4px;">${CAT_LABELS[m.c]||m.c}</span>${esc(m.n)}</td>
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
    items[currentCat].push({
      id: itemIdCounter++, name: m.n, spec: m.s, qty: '', unit: m.u,
      price: m.ep, amount: 0, note: '', bukariki: findBukariki(m.n, m.s || '').value
    });
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
