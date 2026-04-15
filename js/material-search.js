// ===== MATERIAL SEARCH =====
// CAT_LABELS は data.js で MATERIAL_CATEGORIES から一元定義済み

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
  initCatFilter();
  searchMaterial();
  setTimeout(() => document.getElementById('searchQuery').focus(), 100);
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

  let results = MATERIAL_DB;
  if (catFilter) results = results.filter(m => m.c === catFilter);
  results = filterMaterialsByTerms(results, query, 100);

  document.getElementById('searchCount').textContent = `${results.length}件表示（全${MATERIAL_DB.length}品目）`;
  document.getElementById('searchBody').innerHTML = results.map((m, i) => {
    const catLabel = CAT_LABELS[m.c] || m.c;
    const isSupplier = m._source === 'supplier';
    return `<tr>
      <td style="font-size:11px;">
        ${isSupplier ? '<span class="tag" style="background:#dbeafe;color:#1e40af;margin-right:3px;font-size:9px;">仕入</span>' : ''}
        <span class="tag tag-blue" style="margin-right:4px;font-size:9px;">${esc(catLabel)}</span>${esc(m.n)}
      </td>
      <td style="font-size:11px;color:var(--text-sub);" title="${esc(m.s)}">${esc(m.s)}</td>
      <td class="td-center" style="font-size:11px;">${m.u}</td>
      <td class="td-right" style="font-size:11px;">¥${formatNum(Math.round(m.ep))}</td>
      <td class="td-right" style="font-size:11px;">¥${formatNum(Math.round(m.cp || m.ep * 0.75))}</td>
      <td class="td-right" style="font-size:11px;">${m.r ? (m.r*100).toFixed(0) + '%' : '—'}</td>
      <td><button class="btn btn-primary btn-sm" style="padding:3px 8px;font-size:10px;" onclick="selectMaterial(${i})">選択</button></td>
    </tr>`;
  }).join('');
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
