// ===== MATERIAL SEARCH =====
let searchTargetItemId = null;
let _searchResults = [];
let _suggestMatches = [];

function openSearchModal(itemId) {
  searchTargetItemId = itemId;
  document.getElementById('searchModal').classList.add('show');
  document.getElementById('searchQuery').value = '';
  document.getElementById('searchCatFilter').value = '';
  searchMaterial();
  setTimeout(() => document.getElementById('searchQuery').focus(), 100);
}

function closeSearchModal() {
  document.getElementById('searchModal').classList.remove('show');
  searchTargetItemId = null;
}

function searchMaterial() {
  const query = document.getElementById('searchQuery').value.toLowerCase().trim();
  const catFilter = document.getElementById('searchCatFilter').value;
  
  let results = MATERIAL_DB;
  
  if (catFilter) {
    results = results.filter(m => m.c === catFilter);
  }
  
  if (query.length >= 1) {
    const terms = query.split(/\s+/);
    results = results.filter(m => {
      const text = (m.n + ' ' + m.s).toLowerCase();
      return terms.every(t => text.includes(t));
    });
  }
  
  results = results.slice(0, 50); // Limit display
  
  document.getElementById('searchCount').textContent = `${results.length}件表示（全${MATERIAL_DB.length}品目）`;
  
  const CAT_LABELS = {cable:'電線',conduit:'管',device:'器具',box:'BOX',panel:'盤',fixture:'照明',dimmer:'調光',fire:'火報',ground:'接地',accessories:'付属'};
  
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
  
  // Store filtered results for selection
  _searchResults = results;
}

function selectMaterial(resultIdx) {
  const m = _searchResults[resultIdx];
  if (!m) return;
  
  if (searchTargetItemId !== null) {
    // Update existing item
    const list = items[currentCat];
    const item = list.find(i => i.id === searchTargetItemId);
    if (item) {
      item.name = m.n;
      item.spec = m.s;
      item.unit = m.u;
      item.price = m.ep;
      item.note = m.ep !== m.cp ? '' : '';
      if (item.qty) item.amount = (parseFloat(item.qty) || 0) * m.ep;
    }
  } else {
    // Add new item
    const id = itemIdCounter++;
    items[currentCat].push({
      id, name: m.n, spec: m.s, qty: '', unit: m.u,
      price: m.ep, amount: 0, note: ''
    });
  }
  
  closeSearchModal();
  renderItems();
  renderCatTabs();
  showToast(`${m.n} を追加しました`);
}

// ===== INLINE SUGGESTION (on name input) =====
let activeSuggestId = null;

function showSuggestions(itemId, query) {
  const el = document.getElementById('suggest-' + itemId);
  if (!el) return;
  
  if (!query || query.length < 2) {
    el.classList.remove('show');
    return;
  }
  
  const terms = query.toLowerCase().split(/\s+/);
  const matches = MATERIAL_DB.filter(m => {
    const text = (m.n + ' ' + m.s).toLowerCase();
    return terms.every(t => text.includes(t));
  }).slice(0, 8);
  
  if (matches.length === 0) {
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
  activeSuggestId = itemId;
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
  
  const list = items[currentCat];
  const item = list.find(i => i.id === itemId);
  if (item) {
    item.name = m.n;
    item.spec = m.s;
    item.unit = m.u;
    item.price = m.ep;
    if (item.qty) item.amount = (parseFloat(item.qty) || 0) * m.ep;
  }
  renderItems();
  renderCatTabs();
}