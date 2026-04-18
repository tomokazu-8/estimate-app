let _laborSellTotal = 0; // renderLaborSection → updateSummaryBar で参照
let _undoStack = [];
let _redoStack = [];

// ===== TRIDGE APPLY =====

// Tridgeの工種マスタをactiveCategoriesに反映する
function applyTridgeCategories(newCats) {
  const built = newCats.map(c => ({
    id:               c.id,
    name:             c.name,
    short:            c.short || c.name,
    rateMode:         c.rateMode || false,
    miscRate:         c.miscRate ?? 0.05,
    active:           true,
    custom:           false,
    ratePct:          0,
    rateIncludeLabor: false,
  }));
  built.forEach(c => { if (!items[c.id]) items[c.id] = []; });
  activeCategories = built;
  if (!currentCat || !activeCategories.find(c => c.id === currentCat && c.active)) {
    const first = activeCategories.find(c => c.active && !c.rateMode);
    if (first) currentCat = first.id;
  }
  saveActiveCategories();
  renderCatTabs();
  if (typeof syncLaborSettingsToForm === 'function') syncLaborSettingsToForm();
}


// ===== DB初期化（JSONファイルから読み込み） =====
async function loadDefaultDB() {
  try {
    const [matRes, bukRes] = await Promise.all([
      fetch('data/material_db.json', { cache: 'no-store' }),
      fetch('data/bukariki_db.json', { cache: 'no-store' })
    ]);
    if (matRes.ok) {
      const matData = await matRes.json();
      MATERIAL_DB.length = 0;
      matData.forEach(m => MATERIAL_DB.push(m));
    }
    if (bukRes.ok) {
      const bukData = await bukRes.json();
      BUKARIKI_DB.length = 0;
      bukData.forEach(b => BUKARIKI_DB.push(b));
    }
    updateDbStatus();
  } catch(e) {
    console.warn('DB load failed, using empty DB:', e);
  }
}

// ===== 見積アプリ メイン =====

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pj-date').value = project.date;
  // activeCategories の最初の有効工種を currentCat に設定
  const firstActive = activeCategories.find(c => c.active);
  if (firstActive) currentCat = firstActive.id;
  // カスタム工種の items を初期化（localStorage から復元した場合に必要）
  activeCategories.filter(c => c.custom).forEach(c => { if (!items[c.id]) items[c.id] = []; });
  renderCatTabs();
  _updateProjectBar();
  _updateStepIndicator('project');
  loadUserMaterialDB();
  showDbOverlay();
  loadDefaultDB().then(async () => {
    loadFromLocalStorage(); updateDbStatus(); recalcAll();
    renderDBTable();
    // ナレッジDB空チェック → 復元バナー表示
    checkKnowledgeRestore();
    // 保存済み見積空チェック → トースト通知
    checkEstimatesRestore();
    // 得意先サジェスト用リストをナレッジDBから読み込み
    loadClientList();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (!e.shiftKey && e.key === 'z') { e.preventDefault(); undoAction(); }
    if (e.key === 'y' || (e.shiftKey && e.key === 'Z')) { e.preventDefault(); redoAction(); }
  }
});

// ===== NAVIGATION =====
function navigate(panel, el) {
  // summary → confirm へのエイリアス（後方互換）
  if (panel === 'summary') panel = 'confirm';

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  document.getElementById('panel-' + panel).classList.add('active');
  if (el) {
    el.classList.add('active');
  } else {
    document.querySelectorAll('.sidebar-item').forEach(s => {
      if ((s.getAttribute('onclick') || '').includes(`'${panel}'`)) s.classList.add('active');
    });
  }

  // panel-items表示中は.contentのスクロール/paddingを無効化
  const contentEl = document.getElementById('content');
  if (contentEl) contentEl.classList.toggle('content-no-scroll', panel === 'items');

  _updateStepIndicator(panel);
  _updateProjectBar();

  if (panel === 'confirm') { renderCategoryManager(); renderSummary(); _updateConfirmSummary(); }
  if (panel === 'reference') searchSimilar();
  if (panel === 'items') { renderCatTabs(); renderItems(); }
  if (panel === 'ai') _populateAiProjectSummary();
}

// ===== STEP INDICATOR (sidebar flow cards + project bar pills) =====
const _stepPanels = ['project', 'ai', 'items', 'confirm'];
function _updateStepIndicator(activePanel) {
  // Sidebar flow cards
  const steps = document.querySelectorAll('#flowCards .flow-step');
  const activeIdx = _stepPanels.indexOf(activePanel);
  steps.forEach((step, i) => {
    step.classList.remove('flow-active', 'flow-done');
    if (i === activeIdx) step.classList.add('flow-active');
    else if (i < activeIdx) step.classList.add('flow-done');
  });
  // Project bar pills
  const pills = document.querySelectorAll('#stepPills .step-pill');
  pills.forEach((pill, i) => {
    pill.classList.remove('step-pill-active', 'step-pill-done');
    if (i === activeIdx) pill.classList.add('step-pill-active');
    else if (i < activeIdx) pill.classList.add('step-pill-done');
  });
}

// ===== PROJECT SUMMARY CARD (collapsible) =====
let _projectSummaryOpen = false;
function toggleProjectSummary() {
  _projectSummaryOpen = !_projectSummaryOpen;
  const body = document.getElementById('projectSummaryBody');
  const btn = document.getElementById('projectSummaryToggle');
  if (body) body.style.display = _projectSummaryOpen ? 'block' : 'none';
  if (btn) btn.textContent = _projectSummaryOpen ? '閉じる' : '詳細を開く';
  if (_projectSummaryOpen) _renderProjectSummary();
}
function _renderProjectSummary() {
  const grid = document.getElementById('projectSummaryGrid');
  if (!grid) return;
  const fields = [
    ['見積日', project.date || '未設定'],
    ['用途', project.usage || '未設定'],
    ['構造', project.struct || '未設定'],
    ['新築/改修', project.type || '未設定'],
    ['階数', project.floors ? project.floors + '階' : '未設定'],
    ['担当者', project.person || '未設定'],
  ];
  grid.innerHTML = fields.map(([label, val]) =>
    `<div class="psum-item"><div class="psum-item-label">${label}</div><div class="psum-item-value">${esc(val)}</div></div>`
  ).join('');
}

// ===== PROJECT BAR (mockup style) =====
function _updateProjectBar() {
  const name = project.name || '新規見積';
  document.getElementById('pbarName').textContent = name;
  // 見積番号バッジ
  const noEl = document.getElementById('pbarEstNo');
  if (noEl) {
    if (project.number) { noEl.textContent = project.number; noEl.style.display = 'inline-block'; }
    else { noEl.style.display = 'none'; }
  }
  // 得意先バッジ
  const clientEl = document.getElementById('pbarClient');
  if (clientEl) {
    if (project.client) { clientEl.textContent = project.client; clientEl.style.display = 'inline-block'; }
    else { clientEl.style.display = 'none'; }
  }
  // 施工場所バッジ
  const locEl = document.getElementById('pbarLocation');
  if (locEl) {
    if (project.location) { locEl.textContent = project.location; locEl.style.display = 'inline-block'; }
    else { locEl.style.display = 'none'; }
  }
}

// ===== AI PROJECT SUMMARY (panel-ai) =====
function _populateAiProjectSummary() {
  const el = document.getElementById('aiProjectSummary');
  if (!el) return;
  const p = project;
  if (!p.name && !p.struct) {
    el.innerHTML = '<span style="color:var(--text-dim);">物件情報を入力してからAI作成を実行してください。</span>';
    return;
  }
  const rows = [];
  if (p.name) rows.push(`<strong>${esc(p.name)}</strong>`);
  const meta = [];
  if (p.client) meta.push(esc(p.client));
  if (p.struct) meta.push(esc(p.struct));
  if (p.type) meta.push(esc(p.type));
  if (p.usage) meta.push(esc(p.usage));
  const tsubo = parseFloat(p.areaTsubo) || 0;
  const sqm = parseFloat(p.areaSqm) || 0;
  if (sqm > 0) meta.push(sqm + '㎡ / ' + tsubo.toFixed(1) + '坪');
  if (p.floors) meta.push(p.floors + '階');
  if (meta.length) rows.push(meta.join(' / '));
  if (p.memo) rows.push('<span style="color:var(--text-dim);font-size:12px;">' + esc(p.memo) + '</span>');
  el.innerHTML = rows.join('<br>');
}

// ===== CONFIRM SUMMARY (panel-confirm) =====
function _updateConfirmSummary() {
  let grandTotal = 0;
  activeCategories.filter(c => c.active).forEach(c => { grandTotal += getCatAmount(c.id); });
  grandTotal += _laborSellTotal;
  const tsubo = parseFloat(project.areaTsubo) || 0;
  const laborRate = (project.laborRate || 72) / 100;
  const estimatedCost = Math.round(grandTotal * laborRate);
  const profitRate = grandTotal > 0 ? ((grandTotal - estimatedCost) / grandTotal * 100).toFixed(1) : 0;

  const el = (id) => document.getElementById(id);
  if (el('confirmTotal')) el('confirmTotal').textContent = '¥' + formatNum(Math.round(grandTotal));
  if (el('confirmProfit')) el('confirmProfit').textContent = profitRate + '%';
  if (el('confirmTsubo')) el('confirmTsubo').textContent = tsubo > 0 ? '¥' + formatNum(Math.round(grandTotal / tsubo)) : '—';
}

// ===== UNDO / REDO =====
function _captureState() {
  return {
    items: JSON.parse(JSON.stringify(items)),
    itemIdCounter,
    activeCategories: JSON.parse(JSON.stringify(activeCategories)),
    customCatCounter,
  };
}

function saveUndoState() {
  _undoStack.push(_captureState());
  if (_undoStack.length > 50) _undoStack.shift();
  _redoStack = []; // 新しい操作でRedoスタックをクリア
  document.getElementById('backBtn').style.display = '';
  document.getElementById('redoBtn').style.display = 'none';
}

function toggleTopbarHelp() {
  const card = document.getElementById('topbarHelpCard');
  const show = card.style.display === 'none';
  card.style.display = show ? 'block' : 'none';
  if (show) {
    setTimeout(() => {
      document.addEventListener('click', _onClickOutsideHelp, { once: true });
    }, 0);
  }
}
function _onClickOutsideHelp(e) {
  const card = document.getElementById('topbarHelpCard');
  if (card && !card.contains(e.target) && !e.target.closest('[onclick*="toggleTopbarHelp"]')) {
    card.style.display = 'none';
  }
}

function undoAction() {
  if (_undoStack.length === 0) return;
  _redoStack.push(_captureState());
  const state = _undoStack.pop();
  Object.keys(state.items).forEach(k => items[k] = state.items[k]);
  itemIdCounter = state.itemIdCounter;
  if (state.activeCategories) {
    activeCategories = state.activeCategories;
    customCatCounter = state.customCatCounter;
  }
  renderItems();
  renderCatTabs();
  document.getElementById('backBtn').style.display = _undoStack.length > 0 ? '' : 'none';
  document.getElementById('redoBtn').style.display = '';
  showToast('元に戻しました');
}

function redoAction() {
  if (_redoStack.length === 0) return;
  _undoStack.push(_captureState());
  const state = _redoStack.pop();
  Object.keys(state.items).forEach(k => items[k] = state.items[k]);
  itemIdCounter = state.itemIdCounter;
  if (state.activeCategories) {
    activeCategories = state.activeCategories;
    customCatCounter = state.customCatCounter;
  }
  renderItems();
  renderCatTabs();
  document.getElementById('backBtn').style.display = '';
  document.getElementById('redoBtn').style.display = _redoStack.length > 0 ? '' : 'none';
  showToast('やり直しました');
}

// ===== PROJECT =====
function updateProject() {
  project.name = document.getElementById('pj-name').value;
  project.number = document.getElementById('pj-number').value;
  project.date = document.getElementById('pj-date').value;
  project.client = document.getElementById('pj-client').value;
  project.struct = document.getElementById('pj-struct').value;
  project.usage = document.getElementById('pj-usage').value;
  project.type = document.getElementById('pj-type').value;
  project.floors = document.getElementById('pj-floors').value;
  project.areaSqm = document.getElementById('pj-area-sqm').value;
  project.areaTsubo = document.getElementById('pj-area-tsubo').value;
  project.location = document.getElementById('pj-location').value;
  project.person = document.getElementById('pj-person').value;
  project.memo = (document.getElementById('pj-memo')?.value || '');
  project.laborRate = parseFloat(document.getElementById('pj-labor-rate').value) || 72;
  project.laborSell = parseFloat(document.getElementById('pj-labor-sell').value) || 33000;
  project.tax = parseFloat(document.getElementById('pj-tax').value) || 10;
  // LABOR_RATES を project 値と同期
  setLaborRates(project.laborSell, Math.round(project.laborSell * project.laborRate / 100));
  // プリセットラベル更新
  _updatePresetLabel();
  // プロジェクトバー更新
  _updateProjectBar();
}

function _updatePresetLabel() {
  const label = document.getElementById('presetLabel');
  if (!label) return;
  const preset = getKoshuPreset(project.type, project.usage, project.struct);
  if (project.type && project.usage) {
    label.textContent = `${project.type}・${project.usage}（${project.struct || '—'}）→ ${preset.length}工種`;
  } else {
    label.textContent = '— 構造・新築/改修・用途を選択すると自動で工種を設定します';
  }
}

function applyKoshuPreset() {
  if (!project.type) {
    showToast('「新築/改修」を選択してください');
    return;
  }
  const preset = getKoshuPreset(project.type, project.usage, project.struct);
  if (activeCategories.length > 0) {
    const existingItems = activeCategories.some(c => (items[c.id] || []).filter(i => i.name).length > 0);
    if (existingItems && !confirm('既存の工種を置き換えます。品目データは保持されますが、工種構成が変わります。\nよろしいですか？')) return;
  }
  applyTridgeCategories(preset);
  koshuTridgeLoaded = true;
  if (typeof updateKoshuBadge === 'function') updateKoshuBadge();
  showToast(`工種プリセットを適用しました（${preset.length}工種）`);
}

function syncArea(from) {
  const factor = 3.30579;
  if (from === 'sqm') {
    const sqm = parseFloat(document.getElementById('pj-area-sqm').value);
    if (!isNaN(sqm) && sqm > 0) document.getElementById('pj-area-tsubo').value = (sqm / factor).toFixed(1);
  } else {
    const tsubo = parseFloat(document.getElementById('pj-area-tsubo').value);
    if (!isNaN(tsubo) && tsubo > 0) document.getElementById('pj-area-sqm').value = (tsubo * factor).toFixed(1);
  }
}

// ===== CATEGORY TABS =====
function renderCatTabs() {
  const el = document.getElementById('catTabs');
  // rateMode 工種は明細入力タブに表示しない
  const activeCats = activeCategories.filter(c => c.active && !c.rateMode);
  // currentCat が非表示になった場合は最初の有効工種に切り替える
  if (!activeCats.find(c => c.id === currentCat) && activeCats.length > 0) {
    currentCat = activeCats[0].id;
  }
  // サイドバー内の縦リスト形式
  el.innerHTML = activeCats.map(c => {
    const total = getCatTotal(c.id);
    const count = (items[c.id] || []).filter(i => !isAutoName(i.name)).length;
    const amountStr = total > 0 ? '¥' + formatNum(total) : '';
    return `<div class="cat-nav-item${c.id===currentCat?' active':''}" onclick="switchCat('${c.id}')">
      <div>
        <span class="cat-nav-name">${esc(c.short)}</span>
        <span class="cat-nav-amount">${amountStr}</span>
      </div>
      <span class="cat-nav-badge">${count}</span>
    </div>`;
  }).join('');
}

function switchCat(catId) {
  _selectedItems.clear();
  currentCat = catId;
  renderCatTabs();
  renderItems();
}

// ===== CATEGORY MANAGER =====
function saveActiveCategories() {
  localStorage.setItem('activeCategories', JSON.stringify(activeCategories));
  localStorage.setItem('customCatCounter', String(customCatCounter));
}

function renderCategoryManager() {
  const el = document.getElementById('catManagerList');
  if (!el) return;
  el.innerHTML = activeCategories.map((c, idx) => {
    const canUp = idx > 0;
    const canDown = idx < activeCategories.length - 1;
    const btnStyle = 'padding:0 5px;font-size:10px;line-height:1.6;border:1px solid var(--border);background:var(--bg);border-radius:3px;';
    const moveBtns = `
      <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0;">
        <button onclick="moveCat('${c.id}','up')" ${canUp ? '' : 'disabled'}
                style="${btnStyle}${canUp ? 'cursor:pointer;' : 'opacity:0.25;cursor:default;'}">▲</button>
        <button onclick="moveCat('${c.id}','down')" ${canDown ? '' : 'disabled'}
                style="${btnStyle}${canDown ? 'cursor:pointer;' : 'opacity:0.25;cursor:default;'}">▼</button>
      </div>`;

    const checkbox = `<input type="checkbox" ${c.active ? 'checked' : ''}
      onchange="toggleCategory('${c.id}', this.checked)"
      style="width:15px;height:15px;cursor:pointer;flex-shrink:0;">`;

    const nameSpan = `<span style="font-size:11px;color:#94a3b8;flex-shrink:0;width:16px;text-align:right;">${idx+1}</span><span style="font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</span>`;

    const deleteBtn = c.custom
      ? `<button class="btn btn-sm" onclick="removeCustomCategory('${c.id}')"
               style="padding:2px 8px;font-size:11px;color:#ef4444;border:1px solid #ef4444;background:transparent;flex-shrink:0;">削除</button>`
      : '';

    if (c.rateMode) {
      const base = calcRateBase(c.id);
      const pct = c.ratePct || 0;
      const rawAmt = Math.round(base * pct / 100);
      const isFixed = c.fixedAmount != null && c.fixedAmount !== '';
      const fixedVal = isFixed ? parseFloat(c.fixedAmount) : null;
      const displayAbs = isFixed ? Math.abs(fixedVal) : Math.abs(rawAmt);
      const amtColor = c.id === 'discount' ? '#ef4444' : 'var(--text)';
      const pctBorderColor = isFixed ? 'var(--border)' : 'var(--accent)';
      const amtBorderColor = isFixed ? 'var(--accent)' : 'var(--border)';
      const resetBtn = isFixed
        ? `<button onclick="clearRateFixedAmount('${c.id}')"
             title="%計算に戻す"
             style="padding:2px 6px;font-size:10px;border:1px solid var(--border);background:var(--bg-alt);border-radius:3px;cursor:pointer;color:var(--text-sub);white-space:nowrap;">%連動</button>`
        : '';
      const rateSection = `
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex-shrink:0;">
          <input type="number" value="${pct}" step="0.1" min="0"
                 onchange="updateRatePct('${c.id}', parseFloat(this.value)||0)"
                 title="％で金額を自動計算"
                 style="width:52px;text-align:right;padding:2px 4px;font-size:12px;border:1px solid ${pctBorderColor};border-radius:4px;${isFixed ? 'color:var(--text-sub);' : ''}">
          <span style="font-size:12px;">%</span>
          <label style="display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;color:var(--text-sub);white-space:nowrap;">
            <input type="checkbox" ${c.rateIncludeLabor ? 'checked' : ''}
                   onchange="updateRateIncludeLabor('${c.id}', this.checked)"
                   style="width:13px;height:13px;">労務費含む
          </label>
          <span style="font-size:12px;color:var(--text-sub);">= ${c.id === 'discount' ? '-' : ''}¥</span>
          <input type="number" value="${displayAbs}" min="0" step="1000"
                 onchange="updateRateFixedAmount('${c.id}', this.value)"
                 title="直接入力で金額を固定"
                 style="width:96px;text-align:right;padding:2px 4px;font-size:12px;font-weight:600;color:${amtColor};border:1px solid ${amtBorderColor};border-radius:4px;">
          ${resetBtn}
        </div>`;
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--bg-alt);background:#faf9f7;grid-column:1/-1;">
        ${moveBtns}${checkbox}${nameSpan}${rateSection}${deleteBtn}
      </div>`;
    }

    // 品目数と金額を表示
    const itemCount = (items[c.id] || []).filter(i => i.name && !isAutoName(i.name)).length;
    const catAmt = c.active ? Math.round(getCatAmount(c.id)) : 0;
    const infoSpan = `<span style="font-size:10px;color:${itemCount > 0 ? '#16a34a' : '#94a3b8'};white-space:nowrap;flex-shrink:0;">
      ${itemCount > 0 ? itemCount + '品目' : '空'}${catAmt > 0 ? ' ¥' + catAmt.toLocaleString() : ''}
    </span>`;

    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bg-alt);">
      ${moveBtns}${checkbox}${nameSpan}${infoSpan}${deleteBtn}
    </div>`;
  }).join('');
}

function toggleCategory(catId, checked) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.active = checked;
  saveActiveCategories();
  renderCatTabs();
  renderSummary();
  updateSummaryBar();
}

function addCustomCategory() {
  const nameEl = document.getElementById('customCatName');
  const rawName = nameEl.value.trim();
  if (!rawName) { showToast('工種名を入力してください'); return; }
  const id = 'custom_' + customCatCounter;
  const name = String(customCatCounter) + '\u3000' + rawName;
  const short = rawName.length > 8 ? rawName.slice(0, 8) + '…' : rawName;
  activeCategories.push({ id, name, short, active: true, custom: true, rateMode: false, ratePct: 0, rateIncludeLabor: false });
  if (!items[id]) items[id] = [];
  customCatCounter++;
  nameEl.value = '';
  saveActiveCategories();
  renderCategoryManager();
  renderCatTabs();
  showToast(`「${name}」を追加しました`);
}

function removeCustomCategory(catId) {
  const idx = activeCategories.findIndex(c => c.id === catId);
  if (idx === -1) return;
  const name = activeCategories[idx].name;
  activeCategories.splice(idx, 1);
  // currentCat が削除された工種なら最初の有効工種に切り替える
  if (currentCat === catId) {
    const first = activeCategories.find(c => c.active);
    if (first) currentCat = first.id;
  }
  saveActiveCategories();
  renderCategoryManager();
  renderCatTabs();
  showToast(`「${name}」を削除しました`);
}

// ===== CATEGORY ORDER / RATE OPERATIONS =====
function _refreshCatPanel() {
  renderCategoryManager();
  renderSummary();
  updateSummaryBar();
}

function moveCat(catId, direction) {
  const idx = activeCategories.findIndex(c => c.id === catId);
  if (idx === -1) return;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= activeCategories.length) return;
  [activeCategories[idx], activeCategories[newIdx]] = [activeCategories[newIdx], activeCategories[idx]];
  saveActiveCategories();
  renderCatTabs();
  _refreshCatPanel();
}

function updateRatePct(catId, value) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.ratePct = parseFloat(value) || 0;
  cat.fixedAmount = null; // % 変更時は手動金額をクリアして%連動に戻す
  saveActiveCategories();
  _refreshCatPanel();
}

function updateRateFixedAmount(catId, value) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  const trimmed = String(value).trim();
  cat.fixedAmount = (trimmed === '' || isNaN(parseFloat(trimmed))) ? null : parseFloat(trimmed);
  saveActiveCategories();
  _refreshCatPanel();
}

function clearRateFixedAmount(catId) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.fixedAmount = null;
  saveActiveCategories();
  _refreshCatPanel();
}

function updateRateIncludeLabor(catId, checked) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.rateIncludeLabor = checked;
  saveActiveCategories();
  _refreshCatPanel();
}

function getCatTotal(catId) {
  // Material items only (labor is tracked separately)
  return (items[catId] || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
}

// ===== 割合計算工種 ヘルパー =====
function calcRateBase(catId) {
  const idx = activeCategories.findIndex(c => c.id === catId);
  let base = 0;
  for (let i = 0; i < idx; i++) {
    const c = activeCategories[i];
    if (!c.active) continue;
    base += getCatAmount(c.id);
  }
  const cat = activeCategories[idx];
  if (cat && cat.rateIncludeLabor) base += _laborSellTotal;
  return base;
}

function getRateCatAmount(catId) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return 0;
  const base = calcRateBase(catId);
  const amt = Math.round(base * (cat.ratePct || 0) / 100);
  return cat.id === 'discount' ? -amt : amt;
}

function getCatAmount(catId) {
  const cat = activeCategories.find(c => c.id === catId);
  if (cat && cat.rateMode) {
    // fixedAmount が設定されている場合は手動金額を優先
    if (cat.fixedAmount != null && cat.fixedAmount !== '') {
      const fixed = parseFloat(cat.fixedAmount) || 0;
      return cat.id === 'discount' ? -fixed : fixed;
    }
    return getRateCatAmount(catId);
  }
  return getCatTotal(catId);
}

// ===== ITEM ENTRY =====


// 労務費・雑材料・運搬費の自動計算行を自動追加・更新する
// syncLaborItemPrices は廃止 — 経費・労務費は手動追加+自動再計算
function syncLaborItemPrices() {
  // 後方互換のため関数は残すが、自動追加はしない
  // 既存の経費・労務費行の金額を再計算するのみ
  if (!currentCat) return;
  recalcExpenseAndLaborRows(currentCat);
}

// ===== 経費・労務費行の再計算 =====
function recalcExpenseAndLaborRows(catId) {
  const list = items[catId] || [];

  list.forEach((item, idx) => {
    const rt = item.rowType || 'material';
    if (rt === 'expense') {
      _recalcExpenseRow(item, list, idx);
    } else if (rt === 'labor') {
      _recalcLaborRow(item, list, idx);
    }
  });
}

// 経費行の再計算
function _recalcExpenseRow(item, list, idx) {
  const method = item.expenseMethod || 'material_rate';
  const rate = parseFloat(item.expenseRate) || 0;

  if (method === 'fixed') {
    // 固定金額: price はユーザー入力のまま
    item.amount = parseFloat(item.price) || 0;
    item.note = '固定金額';
    return;
  }

  // 計算ベースを決定
  let base = 0;
  if (method === 'material_rate') {
    // この行より上の資材行の合計
    for (let i = 0; i < idx; i++) {
      if ((list[i].rowType || 'material') === 'material') base += parseFloat(list[i].amount) || 0;
    }
    item.note = '資材合計×' + rate + '%';
  } else if (method === 'total_rate') {
    // この行より上の全行（経費・労務費含む）の合計
    for (let i = 0; i < idx; i++) base += parseFloat(list[i].amount) || 0;
    item.note = '全体合計×' + rate + '%';
  } else if (method === 'above_rate') {
    // この行より上の全行の合計
    for (let i = 0; i < idx; i++) base += parseFloat(list[i].amount) || 0;
    item.note = '上記合計×' + rate + '%';
  }

  item.price = Math.round(base * rate / 100);
  item.amount = item.price;
  item.qty = 1;
  item.unit = '式';
}

// 労務費行の再計算
function _recalcLaborRow(item, list, idx) {
  // この行より上の資材行から歩掛を集計
  let totalKosu = 0;
  const details = [];

  for (let i = 0; i < idx; i++) {
    const row = list[i];
    if ((row.rowType || 'material') !== 'material') continue;
    const qty = parseFloat(row.qty) || 0;
    if (qty <= 0) continue;

    const buk1Raw = row.bukariki1 !== undefined ? row.bukariki1 : (row.bukariki ?? '');
    const buk = resolveBukariki(row.name, row.spec, buk1Raw);
    const kosu = qty * buk.value;
    totalKosu += kosu;
    if (buk.value > 0) {
      details.push({ name: row.name, qty, bukariki: buk.value, kosu });
    }
  }

  item.price = Math.round(totalKosu * LABOR_RATES.sell);
  item.amount = item.price;
  item.qty = 1;
  item.unit = '式';
  item.note = totalKosu.toFixed(2) + '人工';
  item._laborDetails = details; // 詳細表示用（内部データ）
  item._laborKosu = totalKosu;
}

// ===== LABOR SECTION (廃止 → _laborSellTotal の計算のみ残す) =====
function renderLaborSection() {
  // laborSectionカードは削除済み。経費・労務費行の合計を _laborSellTotal に反映
  const list = items[currentCat] || [];
  _laborSellTotal = 0;
  list.forEach(item => {
    const rt = item.rowType || 'material';
    if (rt === 'expense' || rt === 'labor') {
      _laborSellTotal += parseFloat(item.amount) || 0;
    }
  });
}

function showLaborDetail() {
  const lb = calcLaborBreakdown(currentCat);
  if (lb.details.length === 0) { showToast('材料を先に入力してください'); return; }

  const hasBuk2 = lb.details.some(d => d.bukariki2 > 0);
  const hasBuk3 = lb.details.some(d => d.bukariki3 > 0);

  let html = '<div style="padding:12px 16px;max-height:450px;overflow-y:auto;font-size:12px;">';
  html += '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f0fdf4;">';
  html += '<th style="text-align:left;padding:4px;">品名</th>';
  html += '<th style="text-align:right;padding:4px;">数量</th>';
  html += '<th style="text-align:right;padding:4px;">歩掛1</th>';
  html += '<th style="text-align:right;padding:4px;">工数1</th>';
  if (hasBuk2) {
    html += '<th style="text-align:right;padding:4px;">歩掛2</th>';
    html += '<th style="text-align:right;padding:4px;">工数2</th>';
  }
  if (hasBuk3) {
    html += '<th style="text-align:right;padding:4px;">歩掛3</th>';
    html += '<th style="text-align:right;padding:4px;">工数3</th>';
  }
  html += '</tr></thead><tbody>';

  for (const d of lb.details) {
    html += '<tr style="border-bottom:1px solid #eee;">';
    html += '<td style="padding:3px 4px;">'+esc(d.name)+'</td>';
    html += '<td style="text-align:right;padding:3px 4px;">'+d.qty+'</td>';
    html += '<td style="text-align:right;padding:3px 4px;">'+d.bukariki.toFixed(3)+'</td>';
    html += '<td style="text-align:right;padding:3px 4px;">'+d.kosu.toFixed(3)+'</td>';
    if (hasBuk2) {
      html += '<td style="text-align:right;padding:3px 4px;color:#6366f1;">'+(d.bukariki2 > 0 ? d.bukariki2.toFixed(3) : '')+'</td>';
      html += '<td style="text-align:right;padding:3px 4px;color:#6366f1;">'+(d.kosu2 > 0 ? d.kosu2.toFixed(3) : '')+'</td>';
    }
    if (hasBuk3) {
      html += '<td style="text-align:right;padding:3px 4px;color:#d97706;">'+(d.bukariki3 > 0 ? d.bukariki3.toFixed(3) : '')+'</td>';
      html += '<td style="text-align:right;padding:3px 4px;color:#d97706;">'+(d.kosu3 > 0 ? d.kosu3.toFixed(3) : '')+'</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  // サマリー
  html += '<div style="margin-top:12px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:13px;">';
  html += '<b>'+esc(LABOR_ROW_NAMES.labor1)+':</b> '+lb.totalKosu.toFixed(2)+'人工 → ¥'+formatNum(calcLaborSell(lb.totalKosu));
  if (lb.撤去Kosu > 0) html += '<br><b>'+esc(LABOR_ROW_NAMES.labor2)+':</b> '+lb.撤去Kosu.toFixed(2)+'人工 → ¥'+formatNum(calcLaborSell(lb.撤去Kosu));
  if (lb.開口Kosu > 0) html += '<br><b>'+esc(LABOR_ROW_NAMES.labor3)+':</b> '+lb.開口Kosu.toFixed(2)+'人工 → ¥'+formatNum(calcLaborSell(lb.開口Kosu));
  const totalAllKosu = lb.totalKosu + lb.撤去Kosu + lb.開口Kosu;
  html += '<br><b>労務費合計:</b> '+totalAllKosu.toFixed(2)+'人工 → 見積 ¥'+formatNum(calcLaborSell(totalAllKosu))+' / 原価 ¥'+formatNum(Math.round(totalAllKosu*LABOR_RATES.cost));
  html += '</div></div>';

  document.getElementById('laborModalBody').innerHTML = html;
  document.getElementById('laborModal').classList.add('show');
}

function editLaborRowNames() {
  if (!currentCat) { showToast('工種を選択してください'); return; }
  const cat = activeCategories.find(c => c.id === currentCat);
  const n = getLaborNames(currentCat);

  function _row(key, enableKey, label) {
    const name = n[key] || '';
    const enabled = n[enableKey] !== false;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
      <input type="checkbox" id="lrn-${enableKey}" ${enabled ? 'checked' : ''} style="width:16px;height:16px;flex-shrink:0;">
      <span style="font-size:11px;color:#94a3b8;width:40px;flex-shrink:0;">${label}</span>
      <input id="lrn-${key}" class="form-input" value="${esc(name)}" style="flex:1;font-size:13px;padding:4px 8px;">
    </div>`;
  }

  const html = `<div style="padding:16px 20px;">
    <p style="font-size:13px;color:#555;margin:0 0 12px;">
      <b>「${esc(cat?.name || currentCat)}」</b>の自動計算行の設定<br>
      <span style="font-size:11px;color:#888;">チェックを外すと自動追加されません。名称は自由に変更できます。</span>
    </p>
    ${_row('labor1', 'enableLabor1', '歩掛1')}
    ${_row('labor2', 'enableLabor2', '歩掛2')}
    ${_row('labor3', 'enableLabor3', '歩掛3')}
    ${_row('misc', 'enableMisc', '経費1')}
    ${_row('transport', 'enableTransport', '経費2')}
    <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('laborNameModal').classList.remove('show')">キャンセル</button>
      <button class="btn btn-primary btn-sm" onclick="applyLaborRowNames()">適用</button>
    </div>
  </div>`;
  let modal = document.getElementById('laborNameModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'laborNameModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal" style="max-width:480px;"><div class="modal-header"><span class="modal-title">自動計算行の設定</span><button class="modal-close" onclick="this.closest(\'.modal-overlay\').classList.remove(\'show\')">✕</button></div><div id="laborNameModalBody"></div></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('laborNameModalBody').innerHTML = html;
  modal.classList.add('show');
}

function applyLaborRowNames() {
  if (!currentCat) return;
  const n = getLaborNames(currentCat);
  const oldNames = { labor1: n.labor1, labor2: n.labor2, labor3: n.labor3, misc: n.misc, transport: n.transport };

  // 名称を更新
  n.labor1    = document.getElementById('lrn-labor1').value.trim() || '電工労務費';
  n.labor2    = document.getElementById('lrn-labor2').value.trim() || '既設器具撤去処分費';
  n.labor3    = document.getElementById('lrn-labor3').value.trim() || '天井材開口費';
  n.misc      = document.getElementById('lrn-misc').value.trim() || '雑材料消耗品';
  n.transport = document.getElementById('lrn-transport').value.trim() || '運搬費';

  // 有効フラグを更新
  n.enableLabor1    = document.getElementById('lrn-enableLabor1').checked;
  n.enableLabor2    = document.getElementById('lrn-enableLabor2').checked;
  n.enableLabor3    = document.getElementById('lrn-enableLabor3').checked;
  n.enableMisc      = document.getElementById('lrn-enableMisc').checked;
  n.enableTransport = document.getElementById('lrn-enableTransport').checked;

  // 既存の明細行の名前を更新
  const list = items[currentCat] || [];
  list.forEach(item => {
    if (item.name === oldNames.labor1) item.name = n.labor1;
    if (item.name === oldNames.labor2) item.name = n.labor2;
    if (item.name === oldNames.labor3) item.name = n.labor3;
    if (item.name === oldNames.misc) item.name = n.misc;
    if (item.name === oldNames.transport) item.name = n.transport;
  });

  // 無効にされた行を明細から削除
  if (!n.enableLabor1)    { const idx = list.findIndex(i => i.name === n.labor1);    if (idx >= 0) list.splice(idx, 1); }
  if (!n.enableLabor2)    { const idx = list.findIndex(i => i.name === n.labor2);    if (idx >= 0) list.splice(idx, 1); }
  if (!n.enableLabor3)    { const idx = list.findIndex(i => i.name === n.labor3);    if (idx >= 0) list.splice(idx, 1); }
  if (!n.enableMisc)      { const idx = list.findIndex(i => i.name === n.misc);      if (idx >= 0) list.splice(idx, 1); }
  if (!n.enableTransport) { const idx = list.findIndex(i => i.name === n.transport); if (idx >= 0) list.splice(idx, 1); }

  if (typeof saveActiveCategories === 'function') saveActiveCategories();

  document.getElementById('laborNameModal').classList.remove('show');
  renderItems();
  showToast(`「${activeCategories.find(c=>c.id===currentCat)?.name||''}」の自動計算行を更新しました`);
}

function renderItems() {
  syncLaborItemPrices(); // 労務費セクションの計算値を固定行に自動反映

  const cat = activeCategories.find(c => c.id === currentCat);
  document.getElementById('catTitle').textContent = cat ? cat.name : '';

  const tbody = document.getElementById('itemBody');
  const list = items[currentCat] || [];

  // 全品目の単位を正規化（半角m→全角ｍ等）
  list.forEach(i => { if (i.unit) i.unit = _normalizeUnit(i.unit); });

  // 歩掛列の表示判定：資材入力行があれば3列とも常時表示
  const hasItems = list.some(i => !isAutoName(i.name));
  const showBuk1 = hasItems, showBuk2 = hasItems, showBuk3 = hasItems;
  const tbl = document.getElementById('itemTable');
  tbl.classList.toggle('hide-buk1', !showBuk1);
  tbl.classList.toggle('hide-buk2', !showBuk2);
  tbl.classList.toggle('hide-buk3', !showBuk3);

  tbody.innerHTML = list.map((item) => {
    const isAuto = isAutoName(item.name);
    const isLaborLockedRow = isLaborLocked(item.name);

    // 歩掛1: bukariki1 優先、旧bukarikiに後方互換フォールバック
    const buk1Raw = item.bukariki1 !== undefined ? item.bukariki1 : (item.bukariki ?? '');
    const buk1Resolved = !isAuto ? resolveBukariki(item.name, item.spec, buk1Raw) : null;
    const buk1IsAuto = buk1Resolved && buk1Resolved.source !== '手入力';

    // 原価・見積 計算（表示用、保存しない）
    const listP  = parseFloat(item.listPrice)  || 0;
    const baseP  = parseFloat(item.basePrice)  || 0;
    const effBase = listP > 0 ? listP : baseP;
    const cRate  = parseFloat(item.costRate)   || 0;
    const costPr = (effBase > 0 && cRate > 0) ? Math.round(effBase * cRate) : null;
    const qty    = parseFloat(item.qty) || 0;
    const costAm = (costPr !== null && qty > 0) ? Math.round(costPr * qty) : null;

    const disabledAuto = isAuto ? 'disabled' : '';
    const dimCell = 'style="background:var(--bg-alt);color:var(--text-sub);font-size:11px;"';

    const isSelected = _selectedItems.has(item.id);
    return `
    <tr data-id="${item.id}" draggable="true" ondragstart="_onRowDragStart(event)" ondragover="_onRowDragOver(event)" ondrop="_onRowDrop(event)" ondragend="_onRowDragEnd(event)" class="${isAuto ? 'auto-calc' : ''}${item.rowType === 'expense' ? ' row-expense' : ''}${item.rowType === 'labor' ? ' row-labor' : ''}${isSelected ? ' row-selected' : ''}">
      <td class="col-check td-center" style="padding:0 4px;">
        <input type="checkbox" id="chk-${item.id}" ${isSelected ? 'checked' : ''}
          onchange="toggleSelectItem(${item.id})" style="cursor:pointer;width:14px;height:14px;">
      </td>
      <td class="suggest-wrap">
        <input value="${esc(item.name)}" title="${esc(item.name)}" onchange="updateItem(${item.id},'name',this.value)" oninput="showSuggestions(${item.id},this.value)" onblur="hideSuggestions(${item.id})" placeholder="品名（入力で候補表示）">
        <div class="suggest-list" id="suggest-${item.id}"></div>
      </td>
      <td class="spec-wrap"><input value="${esc(item.spec)}" title="${esc(item.spec)}" onchange="updateItem(${item.id},'spec',this.value)" placeholder="規格"></td>
      <td><input class="num" value="${item.qty||''}" onchange="updateItem(${item.id},'qty',this.value)" type="number" step="any"></td>
      <td><select onchange="updateItem(${item.id},'unit',this.value)">${UNITS.map(u=>`<option${u===_normalizeUnit(item.unit)?' selected':''}>${u}</option>`).join('')}</select></td>
      <td class="col-detail"><input class="num" value="${item.listPrice||''}" onchange="updateItem(${item.id},'listPrice',this.value)" type="number" step="any" placeholder="定価" ${disabledAuto}></td>
      <td class="col-detail"><input class="num" value="${item.basePrice||''}" onchange="updateItem(${item.id},'basePrice',this.value)" type="number" step="any" placeholder="基準価格" ${disabledAuto}></td>
      <td class="col-detail"><input class="num" value="${item.costRate||''}" onchange="updateItem(${item.id},'costRate',this.value)" type="number" step="0.01" placeholder="掛率" ${disabledAuto}></td>
      <td class="col-detail"><input class="num" value="${item.sellRate||''}" onchange="updateItem(${item.id},'sellRate',this.value)" type="number" step="0.01" placeholder="掛率" ${disabledAuto}></td>
      <td class="col-detail td-right" ${dimCell}>${costPr !== null ? formatNum(costPr) : ''}</td>
      <td class="col-detail td-right" ${dimCell}>${costAm !== null ? '¥'+formatNum(costAm) : ''}</td>
      <td class="col-detail col-buk1"><input class="num" value="${buk1Raw !== '' ? buk1Raw : ''}" onchange="updateItem(${item.id},'bukariki1',this.value)" type="number" step="0.001"
        placeholder="${buk1IsAuto ? (buk1Resolved.value > 0 ? buk1Resolved.value.toFixed(3) : '―') : ''}"
        title="${buk1Resolved ? (buk1IsAuto ? (buk1Resolved.value > 0 ? 'DB自動検出（'+buk1Resolved.source+'）: '+buk1Resolved.value.toFixed(3)+'人工/単位' : 'DB未登録') : '手入力値') : ''}"
        style="${buk1IsAuto && buk1Resolved.value === 0 && item.name ? 'border-color:#f59e0b;' : ''}"
        ${disabledAuto}></td>
      <td class="col-detail col-buk2"><input class="num" value="${item.bukariki2||''}" onchange="updateItem(${item.id},'bukariki2',this.value)" type="number" step="0.001" placeholder="" ${disabledAuto}></td>
      <td class="col-detail col-buk3"><input class="num" value="${item.bukariki3||''}" onchange="updateItem(${item.id},'bukariki3',this.value)" type="number" step="0.001" placeholder="" ${disabledAuto}></td>
      <td><input class="num" value="${item.price||''}" onchange="updateItem(${item.id},'price',this.value)" type="number" step="any" ${isLaborLockedRow ? 'disabled style="background:var(--bg-alt);color:var(--text-sub);"' : ''}></td>
      <td class="td-right" style="font-weight:500;">${item.amount ? '¥'+formatNum(Math.round(item.amount)) : ''}</td>
      <td><input value="${esc(item.note)}" onchange="updateItem(${item.id},'note',this.value)" placeholder="${isLaborLockedRow ? '自動計算' : isAutoName(item.name) ? '例: 5.0%' : '備考'}" style="font-size:11px;color:var(--text-sub);" ${isLaborLockedRow ? 'readonly' : ''}></td>
      <td>
        <span style="display:flex;gap:1px;flex-wrap:nowrap;">
          <button class="row-move" onclick="moveItemUp(${item.id})" title="上へ移動">▲</button>
          <button class="row-move" onclick="moveItemDown(${item.id})" title="下へ移動">▼</button>
          <button class="row-delete" onclick="insertItemAfter(${item.id})" title="この行の下に新規行を挿入" style="opacity:0.6;color:#059669;">＋</button>
          <button class="row-delete" onclick="copyItem(${item.id})" title="この行をコピー" style="opacity:0.6;color:#d97706;">⧉</button>
          <button class="row-delete" onclick="deleteItem(${item.id})">✕</button>
        </span>
      </td>
    </tr>`;
  }).join('');

  // tfoot のcolspan を可視列数に合わせて更新
  const isExpanded = _itemViewMode === 'expand';
  const batchVisible = _batchMode ? 1 : 0;
  // 基本表示: (check) + 品名 + 規格 + 数量 + 単位 + 見積単価 = 合計列の前まで
  // 拡張表示: + 定価 + 基準 + 原価掛 + 見積掛 + 原価単価 + 原価金額 + 歩掛1〜3
  const detailCols = isExpanded ? (9 + (showBuk1?1:0) + (showBuk2?1:0) + (showBuk3?1:0)) : 0;
  const colsBefore = batchVisible + 4 + detailCols; // check? + 品名〜単位(4) + detail列
  const tfoot = document.querySelector('#itemTable tfoot tr');
  if (tfoot) {
    tfoot.innerHTML = `
      <td colspan="${colsBefore}" style="text-align:right;padding-right:12px;font-weight:600;">合　計</td>
      <td class="td-right" id="catTotal" style="font-weight:700;"></td>
      <td colspan="2"></td>`;
  }
  document.getElementById('catTotal').textContent = '¥' + formatNum(Math.round(getCatTotal(currentCat)));

  // ツールバー更新
  _updateBatchToolbar();
  renderLaborSection();
  updateSummaryBar();
  _updateRightSummary();
  // 詳細ペイン再描画（選択中の行があれば）
  if (_selectedDetailId) renderDetailPane(_selectedDetailId);
}

// ===== 妥当性チェック =====

// 工種別チェック（ボタン押下で実行）
function runCategoryValidation() {
  const el = document.getElementById('validationHints');
  if (!el) return;
  const hints = [];
  const list = items[currentCat] || [];
  const materialRows = list.filter(i => (i.rowType || 'material') === 'material' && i.name);
  const expenseRows = list.filter(i => i.rowType === 'expense');
  const laborRows = list.filter(i => i.rowType === 'labor');

  // 1. 見積金額が定価を超えている
  materialRows.forEach(i => {
    const listP = parseFloat(i.listPrice) || 0;
    const price = parseFloat(i.price) || 0;
    if (listP > 0 && price > listP) {
      hints.push({ type: 'error', text: `「${i.name}」の見積単価(¥${formatNum(price)})が定価(¥${formatNum(listP)})を超えています` });
    }
  });

  // 2. 同名の経費・労務費が複数
  const expNames = {};
  expenseRows.forEach(i => { expNames[i.name] = (expNames[i.name] || 0) + 1; });
  Object.entries(expNames).filter(([,c]) => c > 1).forEach(([name, count]) => {
    hints.push({ type: 'warn', text: `経費「${name}」が${count}件重複しています` });
  });
  const labNames = {};
  laborRows.forEach(i => { labNames[i.name] = (labNames[i.name] || 0) + 1; });
  Object.entries(labNames).filter(([,c]) => c > 1).forEach(([name, count]) => {
    hints.push({ type: 'warn', text: `労務費「${name}」が${count}件重複しています` });
  });

  // 3. 歩掛未設定
  const noBuk = materialRows.filter(i => {
    const b = parseFloat(i.bukariki1) || 0;
    if (b > 0) return false;
    const resolved = resolveBukariki(i.name, i.spec, i.bukariki1);
    return resolved.value <= 0;
  });
  if (noBuk.length > 0) {
    hints.push({ type: 'warn', text: `${noBuk.length}品目の歩掛が未設定です` });
  }

  // 4. 単価未入力
  const noPrice = materialRows.filter(i => !(parseFloat(i.price) > 0));
  if (noPrice.length > 0) {
    hints.push({ type: 'warn', text: `${noPrice.length}品目の見積単価が未入力です` });
  }

  // 5. 単位の不一致
  const wireKeywords = ['ケーブル', 'VVF', 'IV', 'CV', 'EM-', '電線', 'UTP', 'CPEV', 'AE'];
  materialRows.forEach(i => {
    const n = norm(i.name);
    const isWire = wireKeywords.some(k => n.includes(norm(k)));
    if (isWire && i.unit && !['m', 'ｍ', 'M'].includes(i.unit)) {
      hints.push({ type: 'warn', text: `「${i.name}」は電線類ですが単位が「${i.unit}」です（通常はm）` });
    }
  });

  // 6. 単位未入力
  const noUnit = materialRows.filter(i => !i.unit || i.unit.trim() === '');
  if (noUnit.length > 0) {
    hints.push({ type: 'warn', text: `${noUnit.length}品目の単位が未入力です` });
  }

  // 7. 経費・労務費の有無
  if (materialRows.length > 0 && expenseRows.length === 0) {
    hints.push({ type: 'warn', text: '経費行がありません' });
  }
  if (materialRows.length > 0 && laborRows.length === 0) {
    hints.push({ type: 'warn', text: '労務費行がありません' });
  }

  // --- 描画 ---
  _renderValidationHints(el, hints);
  const cat = activeCategories.find(c => c.id === currentCat);
  showToast(`「${cat ? cat.name : ''}」のチェックが完了しました（${hints.length}件）`);
}

// 全体チェック（確認・出力画面のボタンで実行）
function runGlobalValidation() {
  const el = document.getElementById('globalValidationHints');
  if (!el) return;
  const hints = [];

  // 8. 同じ資材が工種間で金額・歩掛が異なる
  const allMaterials = {};
  activeCategories.filter(c => c.active).forEach(c => {
    (items[c.id] || []).forEach(i => {
      if ((i.rowType || 'material') !== 'material' || !i.name) return;
      const key = norm(i.name + (i.spec || ''));
      if (!allMaterials[key]) allMaterials[key] = { name: i.name, entries: [] };
      allMaterials[key].entries.push({ cat: c.short, price: parseFloat(i.price) || 0, buk: parseFloat(i.bukariki1) || 0 });
    });
  });
  Object.values(allMaterials).forEach(({ name, entries }) => {
    if (entries.length < 2) return;
    const prices = [...new Set(entries.map(e => e.price))];
    const buks = [...new Set(entries.map(e => e.buk))];
    const cats = entries.map(e => e.cat).join('・');
    if (prices.length > 1) {
      hints.push({ type: 'warn', text: `「${name}」の単価が工種間で異なります（${cats}）` });
    }
    if (buks.length > 1) {
      hints.push({ type: 'warn', text: `「${name}」の歩掛が工種間で異なります（${cats}）` });
    }
  });

  // 9. 坪単価の妥当性（ナレッジDB比較 — 将来実装）

  // 10. 空の工種
  activeCategories.filter(c => c.active && !c.rateMode).forEach(c => {
    const catItems = (items[c.id] || []).filter(i => i.name);
    if (catItems.length === 0) {
      hints.push({ type: 'warn', text: `工種「${c.short}」に品目がありません` });
    }
  });

  // 11. 利益率
  let grandTotal = 0;
  activeCategories.filter(c => c.active).forEach(c => { grandTotal += getCatAmount(c.id); });
  grandTotal += _laborSellTotal;
  if (grandTotal > 0) {
    const laborRate = (project.laborRate || 72) / 100;
    const profitRate = (1 - laborRate) * 100;
    if (profitRate >= 20) {
      hints.push({ type: 'ok', text: `利益率は適正です（${profitRate.toFixed(1)}%）` });
    } else if (profitRate >= 10) {
      hints.push({ type: 'warn', text: `利益率がやや低めです（${profitRate.toFixed(1)}%）` });
    } else {
      hints.push({ type: 'error', text: `利益率が低すぎます（${profitRate.toFixed(1)}%）` });
    }
  }

  _renderValidationHints(el, hints);
  showToast(`全体チェックが完了しました（${hints.length}件）`);
}

// チェック結果の描画
function _renderValidationHints(el, hints) {
  if (hints.length === 0) {
    el.innerHTML = '<div style="color:var(--green);font-size:12px;padding:8px 0;">✅ チェック項目に問題はありません</div>';
    return;
  }
  el.innerHTML = hints.map(h => {
    const colors = { ok: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', icon: '✅' },
                     warn: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', icon: '⚠' },
                     error: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', icon: '❌' } };
    const c = colors[h.type] || colors.warn;
    return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:12px;color:${c.text};">${c.icon} ${esc(h.text)}</div>`;
  }).join('');
}

// ===== RIGHT SUMMARY (mockup style) =====
function _updateRightSummary() {
  let grandTotal = 0;
  activeCategories.filter(c => c.active).forEach(c => { grandTotal += getCatAmount(c.id); });
  grandTotal += _laborSellTotal;
  const tsubo = parseFloat(project.areaTsubo) || 0;
  const laborRate = (project.laborRate || 72) / 100;
  const estimatedCost = Math.round(grandTotal * laborRate);
  const gross = grandTotal - estimatedCost;
  const profitRate = grandTotal > 0 ? ((gross) / grandTotal * 100).toFixed(1) : 0;
  const el = (id) => document.getElementById(id);
  if (el('rsum-total')) el('rsum-total').textContent = '¥' + formatNum(Math.round(grandTotal));
  if (el('rsum-cost')) el('rsum-cost').textContent = '¥' + formatNum(estimatedCost);
  if (el('rsum-gross')) el('rsum-gross').textContent = '¥' + formatNum(Math.round(gross));
  if (el('rsum-profit')) el('rsum-profit').textContent = profitRate + '%';
  if (el('rsum-tsubo')) el('rsum-tsubo').textContent = tsubo > 0 ? '¥' + formatNum(Math.round(grandTotal / tsubo)) : '—';
  // 件数ラベル
  const countEl = document.getElementById('itemCountLabel');
  if (countEl) {
    const cat = activeCategories.find(c => c.id === currentCat);
    const count = (items[currentCat] || []).filter(i => !isAutoName(i.name)).length;
    countEl.textContent = count + '件 / ' + (cat ? cat.name : '');
  }
}

// ===== BATCH MODE (一括操作モード切替) =====
let _batchMode = false;
function toggleBatchMode() {
  _batchMode = !_batchMode;
  const tbl = document.getElementById('itemTable');
  if (tbl) tbl.classList.toggle('batch-mode', _batchMode);
  const btn = document.getElementById('btnBatchMode');
  if (btn) btn.className = _batchMode ? 'pbar-action-btn pbar-btn-dark' : 'pbar-action-btn pbar-btn-outline';
  if (!_batchMode) {
    clearSelection();
    const tb = document.getElementById('batchToolbar');
    if (tb) tb.style.display = 'none';
  }
}

// ===== ROW REORDER (行入れ替え) =====
function moveItemUp(id) {
  const list = items[currentCat];
  if (!list) return;
  const idx = list.findIndex(i => i.id === id);
  if (idx <= 0) return;
  saveUndoState();
  [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
  renderItems();
}
function moveItemDown(id) {
  const list = items[currentCat];
  if (!list) return;
  const idx = list.findIndex(i => i.id === id);
  if (idx < 0 || idx >= list.length - 1) return;
  saveUndoState();
  [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]];
  renderItems();
}

// ===== ROW DRAG & DROP =====
let _dragRowId = null;
function _onRowDragStart(e) {
  // input/select/textarea内からのドラッグは無効（テキスト選択を優先）
  if (e.target.closest('input, select, textarea, button')) { e.preventDefault(); return; }
  const tr = e.target.closest('tr');
  if (!tr) return;
  _dragRowId = parseInt(tr.dataset.id, 10);
  tr.classList.add('row-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _dragRowId);
}
function _onRowDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const tr = e.target.closest('#itemBody tr');
  if (!tr) return;
  // ドロップ先のハイライト
  document.querySelectorAll('#itemBody tr.row-drop-target').forEach(r => r.classList.remove('row-drop-target'));
  tr.classList.add('row-drop-target');
}
function _onRowDrop(e) {
  e.preventDefault();
  const tr = e.target.closest('#itemBody tr');
  if (!tr) return;
  const dropId = parseInt(tr.dataset.id, 10);
  if (isNaN(_dragRowId) || isNaN(dropId) || _dragRowId === dropId) return;
  const list = items[currentCat];
  if (!list) return;
  const fromIdx = list.findIndex(i => i.id === _dragRowId);
  const toIdx = list.findIndex(i => i.id === dropId);
  if (fromIdx < 0 || toIdx < 0) return;
  saveUndoState();
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  recalcExpenseAndLaborRows(currentCat);
  renderItems();
}
function _onRowDragEnd(e) {
  _dragRowId = null;
  document.querySelectorAll('#itemBody tr.row-dragging, #itemBody tr.row-drop-target').forEach(r => {
    r.classList.remove('row-dragging', 'row-drop-target');
  });
}

// ===== VIEW MODE (基本/拡張 切替) =====
let _itemViewMode = 'basic';
function setItemViewMode(mode) {
  _itemViewMode = mode;
  const mainEl = document.querySelector('.items-main');
  if (!mainEl) return;
  if (mode === 'expand') {
    mainEl.classList.add('show-detail-cols');
  } else {
    mainEl.classList.remove('show-detail-cols');
  }
  // ボタンのアクティブ表示
  const btnBasic = document.getElementById('btnBasicView');
  const btnExpand = document.getElementById('btnExpandView');
  if (btnBasic) { btnBasic.className = mode === 'basic' ? 'pbar-action-btn pbar-btn-dark' : 'pbar-action-btn pbar-btn-outline'; }
  if (btnExpand) { btnExpand.className = mode === 'expand' ? 'pbar-action-btn pbar-btn-dark' : 'pbar-action-btn pbar-btn-outline'; }
}

// ===== DETAIL PANE (right column) =====
let _selectedDetailId = null;

function selectDetailRow(id) {
  _selectedDetailId = id;
  // ハイライト更新
  document.querySelectorAll('#itemBody tr').forEach(tr => tr.classList.remove('detail-selected'));
  const row = document.querySelector(`#itemBody tr[data-id="${id}"]`);
  if (row) row.classList.add('detail-selected');
  renderDetailPane(id);
}

function renderDetailPane(itemId) {
  const pane = document.getElementById('detailPane');
  if (!pane) return;
  const list = items[currentCat] || [];
  const item = list.find(i => i.id === itemId);
  if (!item) {
    pane.innerHTML = '<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:20px 0;">行をクリックすると<br>詳細編集ができます</div>';
    _selectedDetailId = null;
    return;
  }

  const rt = item.rowType || 'material';
  if (rt === 'expense') { _renderExpenseDetail(pane, item, itemId, list); return; }
  if (rt === 'labor') { _renderLaborDetail(pane, item, itemId, list); return; }

  // === パターンA: 資材行 ===
  const isAuto = isAutoName(item.name, item);
  const dis = isAuto ? 'disabled style="background:var(--bg);color:var(--text-dim);"' : '';
  const listP = parseFloat(item.listPrice) || 0;
  const baseP = parseFloat(item.basePrice) || 0;
  const effBase = listP > 0 ? listP : baseP;
  const cRate = parseFloat(item.costRate) || 0;
  const costPr = (effBase > 0 && cRate > 0) ? Math.round(effBase * cRate) : null;
  const qty = parseFloat(item.qty) || 0;
  const costAm = (costPr !== null && qty > 0) ? Math.round(costPr * qty) : null;

  // 基準単価 or 定価（排他: 定価があれば基準価格は無効、逆も同様）
  const hasListP = listP > 0;
  const hasBaseP = baseP > 0;
  // 原価単価 = effBase × costRate、見積単価 = effBase × sellRate（自動計算表示）
  const sRate = parseFloat(item.sellRate) || 0;
  const sellPr = (effBase > 0 && sRate > 0) ? Math.round(effBase * sRate) : null;

  pane.innerHTML = `
    <div class="detail-form">
      <div class="form-group">
        <label class="form-label">品名</label>
        <input class="form-input" value="${esc(item.name)}" onchange="updateDetailField(${itemId},'name',this.value)">
      </div>
      <div class="form-group">
        <label class="form-label">規格</label>
        <input class="form-input" value="${esc(item.spec)}" onchange="updateDetailField(${itemId},'spec',this.value)">
      </div>
      <div class="detail-grid-2">
        <div class="form-group">
          <label class="form-label">数量</label>
          <input class="form-input num" value="${item.qty||''}" onchange="updateDetailField(${itemId},'qty',this.value)" type="number" step="any">
        </div>
        <div class="form-group">
          <label class="form-label">単位</label>
          <select class="form-select" onchange="updateDetailField(${itemId},'unit',this.value)" style="border-radius:10px;padding:8px 10px;">
            ${UNITS.map(u=>`<option${u===_normalizeUnit(item.unit)?' selected':''}>${u}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="detail-separator"></div>
      <div class="detail-grid-2">
        <div class="form-group">
          <label class="form-label">定価</label>
          <input class="form-input num" value="${item.listPrice||''}"
            onchange="updateDetailField(${itemId},'listPrice',this.value); if(this.value) updateDetailField(${itemId},'basePrice','')"
            type="number" step="any" ${dis} ${hasBaseP && !hasListP ? 'placeholder="基準価格が優先"' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">基準価格</label>
          <input class="form-input num" value="${item.basePrice||''}"
            onchange="updateDetailField(${itemId},'basePrice',this.value); if(this.value) updateDetailField(${itemId},'listPrice','')"
            type="number" step="any" ${dis} ${hasListP && !hasBaseP ? 'placeholder="定価が優先"' : ''}>
        </div>
      </div>
      <div class="detail-grid-2">
        <div class="form-group">
          <label class="form-label">原価掛</label>
          <input class="form-input num" value="${item.costRate||''}" onchange="updateDetailField(${itemId},'costRate',this.value)" type="number" step="0.01" ${dis}>
        </div>
        <div class="form-group">
          <label class="form-label">見積掛</label>
          <input class="form-input num" value="${item.sellRate||''}" onchange="updateDetailField(${itemId},'sellRate',this.value)" type="number" step="0.01" ${dis}>
        </div>
      </div>
      <div class="detail-grid-2">
        <div class="form-group">
          <label class="form-label">原価単価 <span style="font-size:10px;color:var(--text-dim);">自動</span></label>
          <div class="detail-calc-value">${costPr !== null ? '¥'+formatNum(costPr) : '—'}</div>
        </div>
        <div class="form-group">
          <label class="form-label">見積単価 <span style="font-size:10px;color:var(--text-dim);">自動</span></label>
          <div class="detail-calc-value">${sellPr !== null ? '¥'+formatNum(sellPr) : (item.price ? '¥'+formatNum(Math.round(parseFloat(item.price))) : '—')}</div>
        </div>
      </div>
      <div class="detail-separator"></div>
      <div class="detail-grid-3">
        <div class="form-group">
          <label class="form-label">歩掛1</label>
          <input class="form-input num" value="${item.bukariki1||''}" onchange="updateDetailField(${itemId},'bukariki1',this.value)" type="number" step="0.001" ${dis}>
        </div>
        <div class="form-group">
          <label class="form-label">歩掛2</label>
          <input class="form-input num" value="${item.bukariki2||''}" onchange="updateDetailField(${itemId},'bukariki2',this.value)" type="number" step="0.001" ${dis}>
        </div>
        <div class="form-group">
          <label class="form-label">歩掛3</label>
          <input class="form-input num" value="${item.bukariki3||''}" onchange="updateDetailField(${itemId},'bukariki3',this.value)" type="number" step="0.001" ${dis}>
        </div>
      </div>
      <div class="detail-separator"></div>
      <div class="form-group">
        <label class="form-label">備考</label>
        <textarea class="form-input" onchange="updateDetailField(${itemId},'note',this.value)" style="min-height:64px;resize:vertical;border-radius:10px;">${esc(item.note || '')}</textarea>
      </div>
      <div class="detail-grid-2" style="padding-top:4px;">
        <button class="pbar-action-btn pbar-btn-outline" style="padding:7px 4px;font-size:12px;width:100%;" onclick="openSearchModal(${itemId})">DB検索</button>
        <button class="pbar-action-btn" style="padding:7px 4px;font-size:12px;width:100%;background:var(--accent);border-color:var(--accent);color:#fff;" onclick="registerItemToUserDB(${itemId})">DBに登録</button>
      </div>
    </div>`;
}

function updateDetailField(itemId, field, value) {
  updateItem(itemId, field, value);
  // renderItems() -> renderDetailPane() は自動で呼ばれる
}

// === パターンB: 経費行の詳細パネル ===
function _renderExpenseDetail(pane, item, itemId, list) {
  const idx = list.indexOf(item);
  const method = item.expenseMethod || 'material_rate';
  const rate = item.expenseRate || '';
  const isFixed = method === 'fixed';

  // 算出根拠を計算
  let base = 0;
  if (method === 'material_rate') {
    for (let i = 0; i < idx; i++) { if ((list[i].rowType || 'material') === 'material') base += parseFloat(list[i].amount) || 0; }
  } else if (method === 'total_rate' || method === 'above_rate') {
    for (let i = 0; i < idx; i++) base += parseFloat(list[i].amount) || 0;
  }
  const methodLabel = EXPENSE_METHODS.find(m => m.id === method)?.label || '';
  const basisText = isFixed ? '手動入力金額' : `${methodLabel} ¥${formatNum(Math.round(base))} × ${rate}%`;

  pane.innerHTML = `
    <div class="detail-form">
      <div class="form-group">
        <label class="form-label">経費項目名</label>
        <input class="form-input" value="${esc(item.name)}" onchange="updateDetailField(${itemId},'name',this.value)">
      </div>
      <div class="detail-separator"></div>
      <div class="form-group">
        <label class="form-label">算出方法</label>
        <select class="form-select" onchange="updateDetailField(${itemId},'expenseMethod',this.value)" style="border-radius:10px;padding:8px 10px;">
          ${EXPENSE_METHODS.map(m => `<option value="${m.id}"${m.id === method ? ' selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </div>
      ${isFixed ? `
      <div class="form-group">
        <label class="form-label">金額</label>
        <input class="form-input num" value="${item.price||''}" onchange="updateDetailField(${itemId},'price',this.value)" type="number" step="any">
      </div>` : `
      <div class="form-group">
        <label class="form-label">経費率（%）</label>
        <input class="form-input num" value="${rate}" onchange="updateDetailField(${itemId},'expenseRate',this.value)" type="number" step="0.1">
      </div>`}
      <div class="detail-separator"></div>
      <div class="form-group">
        <label class="form-label">算出根拠</label>
        <div class="detail-calc-value" style="font-size:11px;">${basisText}</div>
      </div>
      <div class="detail-grid-2">
        <div class="form-group">
          <label class="form-label">見積金額</label>
          <div class="detail-calc-value">¥${formatNum(Math.round(parseFloat(item.amount) || 0))}</div>
        </div>
        <div class="form-group">
          <label class="form-label">原価金額</label>
          <div class="detail-calc-value">¥${formatNum(Math.round((parseFloat(item.amount) || 0) * (AUTO_CALC.laborCostRatio || 0.72)))}</div>
        </div>
      </div>
    </div>`;
}

// === パターンC: 労務費行の詳細パネル ===
function _renderLaborDetail(pane, item, itemId, list) {
  const laborType = item.laborType || item.name || '';
  const kosu = item._laborKosu || 0;
  const details = item._laborDetails || [];

  pane.innerHTML = `
    <div class="detail-form">
      <div class="form-group">
        <label class="form-label">労務費名称</label>
        <select class="form-select" onchange="updateDetailField(${itemId},'laborType',this.value);updateDetailField(${itemId},'name',this.value)" style="border-radius:10px;padding:8px 10px;">
          ${LABOR_TYPE_OPTIONS.map(t => `<option${t === laborType ? ' selected' : ''}>${t}</option>`).join('')}
          <option value="_custom"${!LABOR_TYPE_OPTIONS.includes(laborType) && laborType ? ' selected' : ''}>手動入力</option>
        </select>
      </div>
      ${!LABOR_TYPE_OPTIONS.includes(laborType) && laborType !== '_custom' ? `
      <div class="form-group">
        <label class="form-label">カスタム名称</label>
        <input class="form-input" value="${esc(laborType)}" onchange="updateDetailField(${itemId},'laborType',this.value);updateDetailField(${itemId},'name',this.value)">
      </div>` : ''}
      <div class="detail-separator"></div>
      <div class="form-group">
        <label class="form-label">歩掛合計</label>
        <div class="detail-calc-value">${kosu.toFixed(2)} 人工</div>
      </div>
      <div class="detail-separator"></div>
      <div class="form-group">
        <label class="form-label">歩掛の内訳</label>
        <div style="max-height:160px;overflow-y:auto;font-size:11px;color:var(--text-sub);line-height:1.8;">
          ${details.length > 0 ? details.map(d =>
            `<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-light);padding:2px 0;">
              <span>${esc(d.name)}</span>
              <span style="font-family:'JetBrains Mono',monospace;">${d.qty}×${d.bukariki.toFixed(3)}=${d.kosu.toFixed(2)}</span>
            </div>`
          ).join('') : '<div style="color:var(--text-dim);text-align:center;padding:8px 0;">この行より上に資材行がありません</div>'}
        </div>
      </div>
      <div class="detail-separator"></div>
      <div class="detail-grid-2">
        <div class="form-group">
          <label class="form-label">見積金額</label>
          <div class="detail-calc-value">¥${formatNum(Math.round(parseFloat(item.amount) || 0))}</div>
        </div>
        <div class="form-group">
          <label class="form-label">原価金額</label>
          <div class="detail-calc-value">¥${formatNum(Math.round(kosu * LABOR_RATES.cost))}</div>
        </div>
      </div>
    </div>`;
}

// ===== DBに登録（ユーザー品目DB） =====
function registerItemToUserDB(itemId) {
  const list = items[currentCat] || [];
  const item = list.find(i => i.id === itemId);
  if (!item || !item.name) { showToast('品名を入力してください'); return; }

  // カテゴリ自動判定
  const autoCategory = detectMaterialCategory(item.name, item.spec);
  const catLabel = CAT_LABELS[autoCategory] || '副材・消耗品';

  // カテゴリ確認ダイアログ
  const allCats = MATERIAL_CATEGORIES.map(c => c.id + ':' + (CAT_LABELS[c.id] || c.id));
  const catChoice = prompt(
    `カテゴリを確認してください（自動判定: ${catLabel}）\n\n変更する場合はIDを入力:\n${allCats.join('\n')}`,
    autoCategory
  );
  if (catChoice === null) return; // キャンセル
  const finalCategory = catChoice || autoCategory;

  const entry = {
    name: item.name,
    spec: item.spec || '',
    unit: item.unit || '',
    listPrice: parseFloat(item.listPrice) || 0,
    basePrice: parseFloat(item.basePrice) || 0,
    costRate: parseFloat(item.costRate) || 0,
    sellRate: parseFloat(item.sellRate) || 0,
    bukariki1: parseFloat(item.bukariki1) || 0,
    category: finalCategory,
    source: 'user',
  };

  const result = upsertUserMaterial(entry);
  if (result === 'added') showToast(`「${item.name}」をユーザーDBに登録しました`);
  else if (result === 'updated') showToast(`「${item.name}」を上書き更新しました`);
}

// 行クリック・フォーカスイベント — inputにフォーカスしても行選択する
document.addEventListener('DOMContentLoaded', () => {
  // クリック: 行のどこをクリックしても選択（ボタン・チェックボックス除外）
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('#itemBody tr');
    if (!tr) return;
    // 削除等のアクションボタンとチェックボックスは除外
    if (e.target.closest('button, input[type="checkbox"]')) return;
    const id = parseInt(tr.dataset.id, 10);
    if (!isNaN(id)) selectDetailRow(id);
  });
  // フォーカス: input/selectにフォーカスしたときも行選択
  document.addEventListener('focusin', (e) => {
    const tr = e.target.closest('#itemBody tr');
    if (!tr) return;
    if (!e.target.closest('input, select, textarea')) return;
    const id = parseInt(tr.dataset.id, 10);
    if (!isNaN(id) && _selectedDetailId !== id) selectDetailRow(id);
  });
});

function addItem(rowType) {
  if (!currentCat) { showToast('工種タブを選択してください'); return; }
  if (!rowType) rowType = 'material';
  try {
    saveUndoState();
    if (!items[currentCat]) items[currentCat] = [];
    const overrides = { rowType };
    if (rowType === 'expense') {
      overrides.name = '経費';
      overrides.qty = 1;
      overrides.unit = '式';
      overrides.expenseMethod = 'material_rate';
      overrides.expenseRate = 5;
    } else if (rowType === 'labor') {
      overrides.name = '電工労務費';
      overrides.qty = 1;
      overrides.unit = '式';
      overrides.laborType = '電工労務費';
    }
    // 同名チェック（経費・労務費）
    if (rowType !== 'material') {
      const existing = items[currentCat].find(i => i.name === overrides.name && (i.rowType || 'material') === rowType);
      if (existing) {
        if (!confirm(`「${overrides.name}」は既にこの工種に存在します。追加しますか？`)) return;
      }
    }
    const newItem = createBlankItem(overrides);
    items[currentCat].push(newItem);
    recalcExpenseAndLaborRows(currentCat);
    renderItems();
    setTimeout(() => {
      const rows = document.querySelectorAll('#itemBody tr');
      if (rows.length) {
        const lastRow = rows[rows.length - 1];
        lastRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        selectDetailRow(newItem.id);
      }
    }, 50);
  } catch(e) {
    console.error('addItem error:', e);
    showToast('エラー: ' + e.message);
  }
}

// 行追加メニュー表示
function _showAddItemMenu() {
  // シンプルなドロップダウンメニュー
  const existing = document.getElementById('addItemMenu');
  if (existing) { existing.remove(); return; }
  const btn = document.querySelector('[onclick="addItem()"]');
  if (!btn) { addItem('material'); return; }
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'addItemMenu';
  menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.15);z-index:500;min-width:180px;padding:6px;`;
  menu.innerHTML = `
    <div class="add-menu-item" onclick="document.getElementById('addItemMenu').remove();addItem('material')">📦 資材行</div>
    <div class="add-menu-item" onclick="document.getElementById('addItemMenu').remove();addItem('expense')">📊 経費行</div>
    <div class="add-menu-item" onclick="document.getElementById('addItemMenu').remove();addItem('labor')">👷 労務費行</div>`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function _close(e) {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', _close); }
  }), 10);
}

// addAutoCalcRows is in calc-engine.js

function updateItem(id, field, value) {
  const list = items[currentCat];
  const item = list.find(i => i.id === id);
  if (!item) return;
  saveUndoState();
  item[field] = value;

  // 品名変更時：歩掛・単位をDBから再検索してセット
  if (field === 'name') {
    const buk = resolveBukariki(item.name, item.spec, '');
    item.bukariki1 = buk.value > 0 ? buk.value : '';
    // 単位をDBから補完（手入力で「式」以外に変更済みならスキップ）
    if (!item.unit || item.unit === '式') {
      const nName = norm(item.name);
      const match = MATERIAL_DB.find(m => norm(m.n) === nName)
        || MATERIAL_DB.find(m => nName.includes(norm(m.n)) && norm(m.n).length >= 3);
      if (match && match.u) item.unit = _normalizeUnit(match.u);
    }
  }
  // 規格変更時：歩掛が未設定の場合のみDB再検索
  if (field === 'spec' && !item.bukariki1) {
    const buk = resolveBukariki(item.name, item.spec, '');
    if (buk.value > 0) item.bukariki1 = buk.value;
  }

  // 定価・基準価格・掛率 → 見積単価を自動計算
  if (['listPrice', 'basePrice', 'costRate', 'sellRate'].includes(field)) {
    const listP  = parseFloat(item.listPrice)  || 0;
    const baseP  = parseFloat(item.basePrice)  || 0;
    const effBase = listP > 0 ? listP : baseP;
    const sRate  = parseFloat(item.sellRate)   || 0;
    if (effBase > 0 && sRate > 0) {
      item.price  = Math.round(effBase * sRate);
      const qty   = parseFloat(item.qty) || 0;
      item.amount = qty * item.price ;
    }
    // 定価入力時に備考へ自動記載
    if (field === 'listPrice' && listP > 0) {
      item.note = '定価¥' + formatNum(Math.round(listP));
    }
  }

  // Auto calc amount
  if (field === 'qty' || field === 'price') {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    item.amount = qty * price ;

    // 雑材料消耗品・運搬費：価格変更時に有効％をnoteへ自動反映
    if (field === 'price' && isAutoName(item.name)) {
      const matTotal = calcMaterialTotal(currentCat);
      if (matTotal > 0 && price > 0) item.note = (price / matTotal * 100).toFixed(1) + '%';
    }
  }

  // 雑材料消耗品・運搬費：note に %値を入力したら価格を千円丸めで再計算
  if (field === 'note' && (item.name === '雑材料消耗品' || item.name === '運搬費')) {
    const m = value.trim().match(/^(\d+\.?\d*)%?$/);
    if (m) {
      const pct = parseFloat(m[1]);
      const matTotal = calcMaterialTotal(currentCat);
      if (matTotal > 0 && pct > 0) {
        const rounded = Math.round(matTotal * pct / 100 / 1000) * 1000;
        item.price  = rounded;
        item.amount = rounded;
        item.note   = pct.toFixed(1) + '%';
      }
    }
  }

  renderItems();
  renderCatTabs();
}

function deleteItem(id) {
  saveUndoState();
  _selectedItems.delete(id);
  items[currentCat] = items[currentCat].filter(i => i.id !== id);
  renderItems();
  renderCatTabs();
}

// ===== 行操作: 途中挿入 / コピー =====
function insertItemAfter(id) {
  if (!currentCat) return;
  saveUndoState();
  const list = items[currentCat] || [];
  const idx  = list.findIndex(i => i.id === id);
  list.splice(idx + 1, 0, createBlankItem());
  renderItems();
  setTimeout(() => {
    const rows = document.querySelectorAll('#itemBody tr');
    if (rows[idx + 1]) rows[idx + 1].querySelector('input').focus();
  }, 50);
}

function copyItem(id) {
  if (!currentCat) return;
  saveUndoState();
  const list = items[currentCat] || [];
  const idx  = list.findIndex(i => i.id === id);
  const src  = list[idx];
  list.splice(idx + 1, 0, { ...src, id: itemIdCounter++ });
  renderItems();
}

// ===== 選択・一括編集 =====
let _selectedItems = new Set();

function toggleSelectItem(id) {
  if (_selectedItems.has(id)) _selectedItems.delete(id);
  else _selectedItems.add(id);
  // チェックボックスとツールバーのみ更新（全再レンダリングしない）
  const cb = document.getElementById('chk-' + id);
  if (cb) cb.checked = _selectedItems.has(id);
  const row = document.querySelector(`#itemBody tr[data-id="${id}"]`);
  if (row) row.classList.toggle('row-selected', _selectedItems.has(id));
  _updateBatchToolbar();
}

function selectAllItems() {
  const list = items[currentCat] || [];
  list.forEach(i => _selectedItems.add(i.id));
  renderItems();
}

function clearSelection() {
  _selectedItems.clear();
  renderItems();
}

function _updateBatchToolbar() {
  const bar = document.getElementById('batchToolbar');
  if (!bar) return;
  const count = _selectedItems.size;
  if (count > 0) {
    bar.style.display = 'flex';
    bar.querySelector('.batch-count').textContent = count + '件選択中';
  } else {
    bar.style.display = 'none';
  }
}

function deleteSelectedItems() {
  if (_selectedItems.size === 0) return;
  if (!confirm(_selectedItems.size + '件の行を削除しますか？')) return;
  saveUndoState();
  items[currentCat] = (items[currentCat] || []).filter(i => !_selectedItems.has(i.id));
  _selectedItems.clear();
  renderItems();
  renderCatTabs();
}

function batchSetRate(field) {
  const label = field === 'sellRate' ? '見積掛率' : '原価掛率';
  const val = prompt(label + 'を入力（例: 0.85 = 85%）');
  if (val === null || val.trim() === '') return;
  const rate = parseFloat(val);
  if (isNaN(rate) || rate <= 0 || rate > 2) { showToast('有効な掛率を入力してください'); return; }
  saveUndoState();
  (items[currentCat] || []).forEach(item => {
    if (!_selectedItems.has(item.id)) return;
    item[field] = rate;
    if (field === 'sellRate') {
      const listP  = parseFloat(item.listPrice) || 0;
      const baseP  = parseFloat(item.basePrice) || 0;
      const effBase = listP > 0 ? listP : baseP;
      if (effBase > 0) {
        item.price  = Math.round(effBase * rate);
        const qty   = parseFloat(item.qty) || 0;
        item.amount = qty * item.price ;
      }
    }
  });
  renderItems();
  showToast(label + 'を ' + rate + ' に一括設定しました');
}

// 単位をUNITSリストの値に正規化（半角m→全角ｍ等）
function _normalizeUnit(u) {
  if (!u) return '式';
  // まず完全一致
  if (UNITS.includes(u)) return u;
  // NFKC正規化で照合（半角→全角）
  const n = u.normalize('NFKC');
  const match = UNITS.find(unit => unit.normalize('NFKC') === n);
  if (match) return match;
  // 小文字照合（m→ｍ）
  const lower = n.toLowerCase();
  const match2 = UNITS.find(unit => unit.normalize('NFKC').toLowerCase() === lower);
  if (match2) return match2;
  // マッチしなければそのまま返す（UNITSにない単位もあり得る）
  return u;
}

function recalcAll() {
  updateProject();
  renderItems();
}

// 物件情報の労務設定フォームから LABOR_RATES を同期
function syncLaborSettingsFromForm() {
  const sell = parseFloat(document.getElementById('pj-labor-sell').value) || 0;
  const cost = parseFloat(document.getElementById('pj-labor-cost').value) || 0;
  setLaborRates(sell, cost);
  project.laborSell = sell || '';
  project.laborCost = cost || '';
  recalcAll();
}

// Tridge適用後にフォームの表示を更新
function syncLaborSettingsToForm() {
  const sellInput = document.getElementById('pj-labor-sell');
  const costInput = document.getElementById('pj-labor-cost');
  if (sellInput) sellInput.value = LABOR_RATES.sell || '';
  if (costInput) costInput.value = LABOR_RATES.cost || '';
}

// ===== SUMMARY BAR =====
function updateSummaryBar() {
  let grandTotal = 0;
  activeCategories.filter(c => c.active).forEach(c => { grandTotal += getCatAmount(c.id); });
  grandTotal += _laborSellTotal; // 労務費・経費を加算（rateIncludeLaborがONの場合は各割合工種に内包済み）
  
  const tsubo = parseFloat(project.areaTsubo) || 0;
  const sqm = parseFloat(project.areaSqm) || 0;
  
  document.getElementById('sum-total').textContent = '¥' + formatNum(Math.round(grandTotal));
  document.getElementById('sum-tsubo').textContent = tsubo > 0 ? '¥' + formatNum(Math.round(grandTotal / tsubo)) : '—';
  document.getElementById('sum-sqm').textContent = sqm > 0 ? '¥' + formatNum(Math.round(grandTotal / sqm)) : '—';
  
  // Estimate cost (using labor rate)
  const laborRate = (project.laborRate || 72) / 100;
  const estimatedCost = Math.round(grandTotal * laborRate); // simplified
  const profitRate = grandTotal > 0 ? ((grandTotal - estimatedCost) / grandTotal * 100).toFixed(1) : 0;
  document.getElementById('sum-cost').textContent = '¥' + formatNum(estimatedCost);
  document.getElementById('sum-profit').textContent = profitRate + '%';
}

// ===== SUMMARY VIEW (内訳書) =====
function renderSummary() {
  const tbody = document.getElementById('summaryBody');
  let rows = '';
  let workTotal = 0;

  activeCategories.filter(c => c.active).forEach(c => {
    const total = getCatAmount(c.id);
    if (total === 0 && !c.rateMode) return;
    workTotal += total;
    const noteCell = c.rateMode
      ? `<span style="font-size:11px;color:var(--text-sub);">${
          (c.fixedAmount != null && c.fixedAmount !== '')
            ? '手動入力'
            : (c.ratePct||0).toFixed(1) + '%' + (c.rateIncludeLabor ? '（労務含）' : '')
        }</span>`
      : '';
    const amtStyle = total < 0 ? 'font-weight:500;color:#ef4444;' : 'font-weight:500;';
    rows += `<tr>
      <td>${c.name}</td>
      <td class="td-right">1</td>
      <td class="td-center">式</td>
      <td class="td-right" style="${amtStyle}">${total < 0 ? '△ ' : ''}${formatNum(Math.abs(Math.round(total)))}</td>
      <td>${noteCell}</td>
    </tr>`;
  });

  tbody.innerHTML = rows;
  document.getElementById('summaryWorkTotal').textContent = '¥' + formatNum(Math.round(workTotal));

  // 法定福利費
  const enableLegal = document.getElementById('enableLegalWelfare')?.checked || false;
  const legalRow = document.getElementById('summaryLegalRow');
  let legalAmt = 0;
  if (enableLegal) {
    legalRow.style.display = '';
    const rate = parseFloat(document.getElementById('legalWelfareRate')?.value) || 15;
    // 全工種の労務費合計を算出
    let totalLaborSell = 0;
    activeCategories.filter(c => c.active && !c.rateMode).forEach(c => {
      const lb = calcLaborBreakdown(c.id);
      totalLaborSell += calcLaborSell(lb.totalKosu);
      totalLaborSell += calcLaborSell(lb.撤去Kosu);
      totalLaborSell += calcLaborSell(lb.開口Kosu);
    });
    legalAmt = Math.round(totalLaborSell * rate / 100);
    document.getElementById('summaryLegalAmt').textContent = '¥' + formatNum(legalAmt);
  } else {
    legalRow.style.display = 'none';
  }

  // 値引き
  const enableDiscount = document.getElementById('enableDiscount')?.checked || false;
  const discountRow = document.getElementById('summaryDiscountRow');
  let discountAmt = 0;
  if (enableDiscount) {
    discountRow.style.display = '';
    discountAmt = parseFloat(document.getElementById('discountAmount')?.value) || 0;
    document.getElementById('summaryDiscountAmt').textContent = discountAmt > 0 ? '△ ¥' + formatNum(discountAmt) : '¥0';
  } else {
    discountRow.style.display = 'none';
  }

  // 見積合計 = 工事費計 - 値引き + 法定福利費（法定福利費は値引き対象外）
  const grandTotal = workTotal - discountAmt + legalAmt;
  document.getElementById('summaryTotal').textContent = '¥' + formatNum(Math.round(grandTotal));
  document.getElementById('prev-projname').textContent = project.name || '（物件名未入力）';
}

// ===== SIMILAR PROJECTS (ナレッジDB参照) =====
async function searchSimilar() {
  const struct = project.struct;
  const type = project.type;
  const usage = project.usage;
  const area = parseFloat(project.areaTsubo) || 0;

  if (!struct && !type) {
    document.getElementById('refContent').innerHTML = '<p style="color:var(--text-sub);">物件情報を入力すると自動検索します。</p>';
    document.getElementById('refBadge').textContent = '0';
    return;
  }

  let allRecords;
  try { allRecords = await knowledgeDB.getAll(); } catch(e) { allRecords = []; }

  let matches = allRecords.map(rec => {
    let score = 0;
    const p = rec.project;
    if (struct && p.struct === struct) score += 3;
    if (type && p.type === type) score += 2;
    if (usage && p.usage === usage) score += 2;
    const pArea = parseFloat(p.areaTsubo) || 0;
    if (area > 0 && pArea > 0) {
      const diff = Math.abs(pArea - area) / area;
      if (diff < 0.5) score += 1;
    }
    return {
      name: p.name,
      struct: p.struct,
      type: p.type,
      usage: p.usage,
      area_tsubo: pArea || null,
      total: rec.grandTotal,
      profit: rec.profitRate,
      hasDetail: rec.categories && rec.categories.some(c => c.items && c.items.length > 0),
      _score: score,
    };
  }).filter(m => m._score >= 2).sort((a,b) => b._score - a._score);

  document.getElementById('refBadge').textContent = matches.length;

  if (matches.length === 0) {
    document.getElementById('refContent').innerHTML = '<p style="color:var(--text-sub);">条件に合う類似物件が見つかりません。</p>';
    return;
  }

  const withArea = matches.filter(m => m.area_tsubo);
  const tsuboPrices = withArea.map(m => Math.round(m.total / m.area_tsubo));
  const profits = matches.map(m => m.profit);

  let html = '<div style="margin-bottom:16px;">';
  if (tsuboPrices.length > 0) {
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
      <div style="background:var(--accent-light);padding:12px;border-radius:8px;">
        <div style="font-size:10px;color:var(--accent);font-weight:500;">坪単価レンジ</div>
        <div style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--accent);">¥${formatNum(Math.min(...tsuboPrices))} ~ ¥${formatNum(Math.max(...tsuboPrices))}</div>
        <div style="font-size:10px;color:var(--text-sub);">平均 ¥${formatNum(Math.round(tsuboPrices.reduce((a,b)=>a+b,0)/tsuboPrices.length))}/坪</div>
      </div>
      <div style="background:var(--green-light);padding:12px;border-radius:8px;">
        <div style="font-size:10px;color:var(--green);font-weight:500;">利益率レンジ</div>
        <div style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--green);">${Math.min(...profits).toFixed(1)}% ~ ${Math.max(...profits).toFixed(1)}%</div>
        <div style="font-size:10px;color:var(--text-sub);">平均 ${(profits.reduce((a,b)=>a+b,0)/profits.length).toFixed(1)}%</div>
      </div>
      <div style="background:var(--amber-light);padding:12px;border-radius:8px;">
        <div style="font-size:10px;color:var(--amber);font-weight:500;">該当物件数</div>
        <div style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--amber);">${matches.length}件</div>
        <div style="font-size:10px;color:var(--text-sub);">面積入力済 ${withArea.length}件</div>
      </div>
    </div>`;
  }

  html += '<table><thead><tr><th>物件名</th><th>構造</th><th>新/改</th><th>用途</th><th style="text-align:right">見積合計</th><th style="text-align:right">坪単価</th><th style="text-align:right">利益率</th></tr></thead><tbody>';
  matches.forEach(m => {
    const tp = m.area_tsubo ? '¥'+formatNum(Math.round(m.total/m.area_tsubo)) : '—';
    html += `<tr><td>${m.name}</td><td>${m.struct}</td><td><span class="tag ${m.type==='新築'?'tag-blue':'tag-amber'}">${m.type}</span></td><td>${m.usage||''}</td><td class="td-right">¥${formatNum(m.total)}</td><td class="td-right">${tp}</td><td class="td-right">${m.profit}%</td></tr>`;
  });
  html += '</tbody></table></div>';

  document.getElementById('refContent').innerHTML = html;
}

// ===== VALIDATION (ナレッジDB参照) =====
async function runValidation() {
  let grandTotal = 0;
  activeCategories.filter(c => c.active).forEach(c => { grandTotal += getCatAmount(c.id); });

  if (grandTotal === 0) {
    document.getElementById('checkContent').innerHTML = '<p style="color:var(--amber);">明細が入力されていません。</p>';
    return;
  }

  const tsubo = parseFloat(project.areaTsubo) || 0;
  const struct = project.struct;
  const type = project.type;

  let checks = [];

  // ナレッジDBから全件取得
  let allRecords;
  try { allRecords = await knowledgeDB.getAll(); } catch(e) { allRecords = []; }

  // Tsubo price check
  if (tsubo > 0) {
    const tsuboPrice = grandTotal / tsubo;
    const similar = allRecords.filter(rec => {
      const pArea = parseFloat(rec.project.areaTsubo) || 0;
      return pArea > 0 && rec.project.struct === struct && rec.project.type === type;
    });
    if (similar.length > 0) {
      const prices = similar.map(rec => rec.grandTotal / parseFloat(rec.project.areaTsubo));
      const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
      const ratio = tsuboPrice / avg;
      const ok = ratio >= 0.7 && ratio <= 1.3;
      checks.push({
        label: '坪単価チェック',
        value: `¥${formatNum(Math.round(tsuboPrice))}/坪`,
        range: `類似物件 ¥${formatNum(Math.round(Math.min(...prices)))} ~ ¥${formatNum(Math.round(Math.max(...prices)))}（平均 ¥${formatNum(Math.round(avg))}）`,
        status: ok ? 'ok' : 'warn',
        message: ok ? '類似物件の範囲内です' : `平均と${Math.round(Math.abs(ratio-1)*100)}%の乖離があります`
      });
    }
  }

  // Profit check
  const laborRate = (project.laborRate || 72) / 100;
  const profitRate = (1 - laborRate) * 100;
  // ナレッジDBから同種別の平均利益率を算出
  const sameType = allRecords.filter(rec => rec.project.type === type && rec.profitRate > 0);
  const targetProfit = sameType.length > 0
    ? Math.round(sameType.reduce((s,r) => s + r.profitRate, 0) / sameType.length * 10) / 10
    : (type === '改修' ? 32.7 : 27.5);
  const profitOk = Math.abs(profitRate - targetProfit) < 10;
  checks.push({
    label: '利益率チェック',
    value: profitRate.toFixed(1) + '%',
    range: `${type || '全体'}平均 ${targetProfit.toFixed(1)}%（${sameType.length}件の実績）`,
    status: profitOk ? 'ok' : 'warn',
    message: profitOk ? '目標範囲内です' : '利益率の調整を検討してください'
  });

  // Category balance check
  const catTotals = {};
  activeCategories.filter(c => c.active).forEach(c => {
    const t = getCatAmount(c.id);
    if (t !== 0) catTotals[c.short] = t;
  });

  let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
  checks.forEach(ch => {
    const color = ch.status === 'ok' ? 'var(--green)' : 'var(--amber)';
    const icon = ch.status === 'ok' ? '✓' : '⚠';
    html += `<div style="border:1px solid ${ch.status==='ok'?'var(--green-light)':'var(--amber-light)'};background:${ch.status==='ok'?'#f0fdf4':'#fffbeb'};border-radius:8px;padding:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="color:${color};font-size:16px;">${icon}</span>
        <span style="font-weight:600;">${ch.label}</span>
        <span style="font-family:'JetBrains Mono';font-weight:700;color:${color};margin-left:auto;">${ch.value}</span>
      </div>
      <div style="font-size:11px;color:var(--text-sub);">${ch.range}</div>
      <div style="font-size:11px;color:${color};margin-top:4px;">${ch.message}</div>
    </div>`;
  });

  // Composition
  if (Object.keys(catTotals).length > 0) {
    html += '<div style="border:1px solid var(--border);border-radius:8px;padding:14px;"><div style="font-weight:600;margin-bottom:8px;">工種別構成比</div>';
    Object.entries(catTotals).forEach(([name, total]) => {
      const pct = (total / grandTotal * 100).toFixed(1);
      html += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
        <span style="width:100px;font-size:11px;">${name}</span>
        <div style="flex:1;height:16px;background:var(--bg);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px;"></div>
        </div>
        <span style="font-family:'JetBrains Mono';font-size:11px;width:50px;text-align:right;">${pct}%</span>
        <span style="font-family:'JetBrains Mono';font-size:10px;color:var(--text-sub);width:90px;text-align:right;">¥${formatNum(Math.round(total))}</span>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  document.getElementById('checkContent').innerHTML = html;
}

// ===== ナレッジDB TABLE =====
async function renderDBTable() {
  let allRecords;
  try { allRecords = await knowledgeDB.getAll(); } catch(e) { allRecords = []; }

  // バッジ更新
  const badge = document.getElementById('knowledgeBadge');
  if (badge) badge.textContent = allRecords.length;

  // 統計更新
  const detailCount = allRecords.filter(r => r.categories && r.categories.some(c => c.items && c.items.length > 0)).length;
  const legacyCount = allRecords.filter(r => r.legacy).length;
  const countEl = document.getElementById('knowledgeCount');
  const detailEl = document.getElementById('knowledgeDetailCount');
  const legacyEl = document.getElementById('knowledgeLegacyCount');
  if (countEl) countEl.textContent = allRecords.length;
  if (detailEl) detailEl.textContent = detailCount;
  if (legacyEl) legacyEl.textContent = legacyCount;

  // テーブル描画
  const tbody = document.getElementById('dbBody');
  tbody.innerHTML = allRecords.map(rec => {
    const p = rec.project || {};
    const areaSqm   = parseFloat(p.areaSqm)   || 0;
    const areaTsubo = parseFloat(p.areaTsubo)  || 0;
    const areaForCalc = areaSqm > 0 ? areaSqm : areaTsubo * 3.30579; // 坪→㎡換算
    const sqmPrice = areaForCalc > 0 ? '¥'+formatNum(Math.round(rec.grandTotal / areaForCalc)) : '—';
    const areaStr  = areaSqm > 0 ? areaSqm+'㎡' : areaTsubo > 0 ? (areaTsubo*3.30579).toFixed(1)+'㎡' : '—';
    const laborStr = rec.totalLaborHours ? rec.totalLaborHours+'人工' : '—';
    const structType = [p.struct, p.type].filter(Boolean).join('/');
    const hasDetail = rec.categories && rec.categories.some(c => c.items && c.items.length > 0);
    const excluded = !!rec.excluded;
    const dateLabel = rec.registeredAt || (rec.source ? `（${rec.source}）` : '—');
    return `<tr style="${excluded ? 'opacity:0.4;' : ''}">
      <td style="font-size:11px;color:${rec.registeredAt ? '' : 'var(--text-sub)'};">${dateLabel}</td>
      <td>${esc(p.name||'')}</td>
      <td style="font-size:11px;color:var(--text-sub);">${esc(p.client||'')}</td>
      <td style="font-size:11px;">${esc(structType)}</td>
      <td>${esc(p.usage||'')}</td>
      <td class="td-right" style="font-size:11px;">${areaStr}</td>
      <td class="td-right">¥${formatNum(rec.grandTotal)}</td>
      <td class="td-right">${parseFloat(rec.profitRate).toFixed(1)}%</td>
      <td class="td-right">${sqmPrice}</td>
      <td class="td-right" style="font-size:11px;">${laborStr}</td>
      <td style="text-align:center;">${hasDetail
        ? `<button class="btn btn-secondary btn-sm" style="font-size:10px;padding:2px 6px;" onclick="showKnowledgeDetail(${rec.id})">詳細</button>`
        : '<span style="font-size:10px;color:var(--text-dim);">なし</span>'}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm" style="font-size:10px;padding:2px 6px;${excluded ? 'color:var(--red);' : 'color:var(--green);'}"
          title="${excluded ? '有効に戻す' : '自動見積りから除外'}"
          onclick="toggleExclude(${rec.id}, ${excluded})">${excluded ? '除外中' : '有効'}</button>
      </td>
      <td><button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red);" onclick="deleteKnowledge(${rec.id})">×</button></td>
    </tr>`;
  }).join('');
}

// 除外フラグ切り替え
async function toggleExclude(id, currentExcluded) {
  await knowledgeDB.setExcluded(id, !currentExcluded);
  renderDBTable();
}

// ナレッジ詳細表示
async function showKnowledgeDetail(id) {
  try {
    const rec = await knowledgeDB.getById(id);
    if (!rec) { showToast('レコードが見つかりません'); return; }

    const p = rec.project || {};
    const registeredAt = rec.registeredAt || '—';
    const areaTsubo = parseFloat(p.areaTsubo) || 0;
    const areaSqm   = parseFloat(p.areaSqm)   || 0;
    const areaStr   = areaSqm > 0
      ? `${areaSqm}㎡` + (areaTsubo > 0 ? ` / ${areaTsubo}坪` : '')
      : areaTsubo > 0 ? `${areaTsubo}坪` : '—';
    const profitStr  = rec.profitRate     ? `${parseFloat(rec.profitRate).toFixed(1)}%` : '—';
    const profitAmt  = rec.profitTotal    ? `¥${formatNum(rec.profitTotal)}` : '—';
    const costStr    = rec.costTotal      ? `¥${formatNum(rec.costTotal)}` : '—';
    const laborStr   = rec.totalLaborHours? `${rec.totalLaborHours}人工` : '—';
    const discStr    = rec.discountAmt    ? `¥${formatNum(rec.discountAmt)}` : '—';
    const welfareStr = rec.legalWelfare   ? `¥${formatNum(rec.legalWelfare)}` : '—';
    let html = `<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
      <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;">見積番号: ${esc(p.number||'—')}</div>
      <div style="font-weight:700;font-size:15px;margin-bottom:6px;">${esc(p.name || '（物件名なし）')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;color:var(--text-sub);">
        <div>得意先: <strong style="color:var(--text-main);">${esc(p.client||'—')}</strong></div>
        <div>担当者: ${esc(p.person||'—')}</div>
        <div>施工場所: ${esc(p.location||'—')}</div>
        <div>構造/種別: ${esc(p.struct||'—')} / <span class="tag ${p.type==='新築'?'tag-blue':'tag-amber'}" style="font-size:10px;">${esc(p.type||'—')}</span></div>
        <div>用途: ${esc(p.usage||'—')}${p.floors ? ` / ${p.floors}階` : ''}</div>
        <div>面積: ${areaStr}</div>
        <div>見積合計: <strong style="color:var(--accent);">¥${formatNum(rec.grandTotal||0)}</strong></div>
        <div>原価合計: ${costStr}</div>
        <div>粗利: ${profitAmt} / ${profitStr}</div>
        <div>工数: ${laborStr}</div>
        ${rec.discountAmt ? `<div>値引き: ${discStr}</div>` : ''}
        ${rec.legalWelfare ? `<div>法定福利費: ${welfareStr}</div>` : ''}
        <div>登録日: ${registeredAt}</div>
        ${p.memo ? `<div style="grid-column:1/-1;margin-top:4px;color:var(--text-main);">📝 ${esc(p.memo)}</div>` : ''}
      </div>
    </div>`;

    const cats = (rec.categories || []).filter(c => c.items && c.items.length > 0);
    if (cats.length > 0) {
      cats.forEach(cat => {
        const catTotal = cat.total || cat.subtotal || 0;
        const catCost  = cat.costTotal || 0;
        html += `<div style="margin-bottom:12px;">
          <div style="font-weight:600;font-size:12px;background:var(--bg);padding:6px 10px;border-radius:4px;margin-bottom:4px;display:flex;justify-content:space-between;">
            <span>${esc(cat.name||'')}</span>
            <span style="color:var(--accent);">¥${formatNum(catTotal)}${catCost > 0 ? ` <span style="font-size:10px;color:var(--text-sub);">（原価¥${formatNum(catCost)}）</span>` : ''}</span>
          </div>
          <table style="font-size:11px;"><thead><tr>
            <th>品名</th><th>規格</th><th style="text-align:right">数量</th><th>単位</th><th style="text-align:right">単価</th><th style="text-align:right">金額</th><th style="text-align:right">原価</th>
          </tr></thead><tbody>`;
        cat.items.forEach(i => {
          html += `<tr>
            <td>${esc(i.name||'')}</td><td>${esc(i.spec||'')}</td>
            <td class="td-right">${i.qty||''}</td><td>${esc(i.unit||'')}</td>
            <td class="td-right">${i.price ? '¥'+formatNum(i.price) : ''}</td>
            <td class="td-right">${i.amount ? '¥'+formatNum(Math.round(i.amount)) : ''}</td>
            <td class="td-right" style="color:var(--text-sub);">${i.costPrice ? '¥'+formatNum(i.costPrice) : ''}</td>
          </tr>`;
        });
        html += '</tbody></table></div>';
      });
    } else {
      html += '<p style="color:var(--text-sub);font-size:12px;">品目明細なし（レガシーデータ）</p>';
    }

    document.getElementById('knowledgeDetailBody').innerHTML = html;
    document.getElementById('knowledgeDetailModal').classList.add('show');
  } catch(e) {
    showToast('詳細の表示に失敗しました: ' + e.message);
  }
}

// ナレッジ削除
async function deleteKnowledge(id) {
  if (!confirm('この実績データを削除しますか？')) return;
  try {
    await knowledgeDB.remove(id);
    showToast('削除しました');
    renderDBTable();
  } catch(e) { showToast('削除に失敗しました'); }
}

// Excelエクスポート
async function knowledgeExportXLSX() {
  try {
    await knowledgeDB.exportXLSX();
    showToast('Excelエクスポート完了');
  } catch(e) { showToast('エクスポートに失敗しました'); }
}

// インポート（JSON / XLSX 自動判別）
async function knowledgeImportFile(file) {
  if (!file) return;
  try {
    const result = await knowledgeDB.importFile(file);
    const count = typeof result === 'object' ? result.added : result;
    const skip  = typeof result === 'object' ? result.skipped : 0;
    showToast(count + '件インポートしました' + (skip > 0 ? `（${skip}件は重複スキップ）` : ''));
    renderDBTable();
  } catch(e) { showToast('インポートに失敗しました: ' + e.message); }
  document.getElementById('knowledgeImportFile').value = '';
}

// 既存DBを全件削除してからインポート（置き換え）
async function knowledgeReplaceFile(file) {
  if (!file) return;
  const currentCount = await knowledgeDB.count();
  if (currentCount > 0 && !confirm(`既存の ${currentCount} 件を全て削除して新しいデータに置き換えます。\nよろしいですか？`)) {
    document.getElementById('knowledgeReplaceFile').value = '';
    return;
  }
  try {
    const count = await knowledgeDB.replaceFromFile(file);
    showToast(count + '件に置き換えました');
    renderDBTable();
  } catch(e) { showToast('置き換えに失敗しました: ' + e.message); }
  document.getElementById('knowledgeReplaceFile').value = '';
}

// ===== PERSISTENCE =====
function saveToLocalStorage() {
  const data = { project, items, itemIdCounter };
  localStorage.setItem('hachitomo_estimate', JSON.stringify(data));
  showToast('保存しました');
}

function loadFromLocalStorage() {
  const raw = localStorage.getItem('hachitomo_estimate');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.project) {
      project = data.project;
      if (typeof _restoreProjectForm === 'function') _restoreProjectForm();
    }
    if (data.items) {
      items = data.items;
      // プリセット工種 + 有効なカスタム工種の items を初期化
      activeCategories.forEach(c => { if (!items[c.id]) items[c.id] = []; });
    }
    if (data.itemIdCounter) itemIdCounter = data.itemIdCounter;
    renderCatTabs();
    showToast('前回のデータを復元しました');
  } catch(e) { console.warn('前回データの復元に失敗:', e.message); }
}

// ===== EXPORT =====
async function exportEstimate() {
  // ExcelJS テンプレート出力を試みる（フォールバック: SheetJS簡易版）
  let exported = false;
  if (typeof ExcelJS !== 'undefined' && typeof ExcelTemplateExport !== 'undefined') {
    try {
      exported = await ExcelTemplateExport.exportFormatted();
    } catch(e) {
      console.warn('ExcelJS出力エラー、SheetJSにフォールバック:', e);
    }
  }

  if (!exported) {
    // SheetJS簡易版（フォールバック）
    if (!window.XLSX) { showToast('SheetJSが読み込まれていません'); return; }

    const wb = XLSX.utils.book_new();
    const aoa = [];
    aoa.push(['八友電工　御見積書']);
    aoa.push([]);
    aoa.push(['物件名', project.name || '']);
    aoa.push(['見積番号', project.number || '', '見積日', project.date || '']);
    aoa.push(['得意先', project.client || '', '担当者', project.person || '']);
    aoa.push(['構造', project.struct || '', '用途/種別', [project.usage, project.type].filter(Boolean).join(' ')]);
    aoa.push([]);
    aoa.push(['工事内訳', '数量', '単位', '見積金額（税抜）', '備考']);

    let grandTotal = 0;
    activeCategories.filter(c => c.active).forEach(c => {
      const total = getCatAmount(c.id);
      if (total === 0 && !c.rateMode) return;
      grandTotal += total;
      const note = c.rateMode ? `${(c.ratePct||0).toFixed(1)}%${c.rateIncludeLabor ? '（労務費含）' : ''}` : '';
      aoa.push([c.name, 1, '式', Math.round(total), note]);
    });
    aoa.push([]);
    aoa.push(['合　計', '', '', Math.round(grandTotal), '']);

    const tax = (project.tax || 10) / 100;
    aoa.push(['消費税（' + (project.tax || 10) + '%）', '', '', Math.round(grandTotal * tax), '']);
    aoa.push(['税込合計', '', '', Math.round(grandTotal * (1 + tax)), '']);

    const ws1 = XLSX.utils.aoa_to_sheet(aoa);
    ws1['!cols'] = [{wch:35},{wch:6},{wch:6},{wch:15},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws1, '内訳書');

    activeCategories.filter(c => c.active && !c.rateMode).forEach(c => {
      const list = (items[c.id] || []).filter(i => i.name);
      if (list.length === 0) return;

      const rows = [[c.name], [], ['品名', '規格', '数量', '単位', '見積単価', '見積金額', '備考']];
      list.forEach(item => {
        rows.push([
          item.name || '', item.spec || '',
          item.qty !== '' ? parseFloat(item.qty) || '' : '',
          item.unit || '',
          item.price !== '' ? parseFloat(item.price) || '' : '',
          item.amount ? Math.round(item.amount) : '',
          item.note || ''
        ]);
      });
      rows.push([]);
      rows.push(['', '', '', '', '小計', Math.round(getCatTotal(c.id)), '']);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{wch:25},{wch:18},{wch:6},{wch:6},{wch:10},{wch:12},{wch:15}];
      XLSX.utils.book_append_sheet(wb, ws, c.short);
    });

    const safeName = (project.name || '新規').replace(/[\/\\:*?"<>|]/g, '');
    XLSX.writeFile(wb, '見積書_' + safeName + '_' + (project.date || '') + '.xlsx');
  }

  showToast('Excel出力完了');

  // 見積を自動保存
  try {
    saveEstimate();
  } catch(e) { console.warn('自動保存失敗:', e); }

  // ナレッジDBに自動登録（ダウンロードは抑制、DB保存のみ）
  try {
    const record = knowledgeDB.buildRecord();
    if (record.grandTotal > 0) {
      await knowledgeDB.save(record);
      showToast('保存 + ナレッジDB登録 完了');
      renderDBTable();
    }
  } catch(e) { console.warn('ナレッジDB登録失敗:', e); }
}

// ===== 最新の変更点（GitHub API） =====
async function showChangelog() {
  const modal = document.getElementById('changelogModal');
  const body  = document.getElementById('changelogBody');
  modal.classList.add('show');
  body.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">読み込み中...</p>';

  try {
    const res = await fetch(
      'https://api.github.com/repos/tomokazu-8/estimate-app/commits?per_page=5',
      { headers: { Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) throw new Error(`GitHub API エラー (${res.status})`);
    const commits = await res.json();

    body.innerHTML = commits.map(c => {
      const date = new Date(c.commit.author.date).toLocaleDateString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
      const sha    = c.sha.slice(0, 7);
      const lines  = c.commit.message.split('\n').filter(Boolean);
      const title  = lines[0];
      const detail = lines.slice(1).filter(l => l.trim() && !l.startsWith('Co-Authored'));
      return `<div style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:11px;color:#94a3b8;">${date}</span>
          <code style="font-size:10px;background:#f1f5f9;padding:1px 6px;border-radius:3px;color:#64748b;">${sha}</code>
        </div>
        <div style="font-size:13px;font-weight:500;color:#1e293b;">${title}</div>
        ${detail.length ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;color:#64748b;">
          ${detail.map(l => `<li style="margin-bottom:2px;">${l.replace(/^[-・]\s*/, '')}</li>`).join('')}
        </ul>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<p style="color:#c00;text-align:center;padding:24px;">取得に失敗しました: ${e.message}</p>`;
  }
}

// ===== ナレッジDB復元バナー =====
async function loadClientList() {
  try {
    const all = await knowledgeDB.getAll();
    const fromKnowledge = all.map(r => r.project && r.project.client).filter(c => c && c.trim());
    const fromTridge = TRIDGE_CLIENTS.map(c => c.clientName).filter(c => c);
    const clients = [...new Set([...fromTridge, ...fromKnowledge])].sort((a, b) => a.localeCompare(b, 'ja'));
    const dl = document.getElementById('clientList');
    if (dl) dl.innerHTML = clients.map(c => `<option value="${esc(c)}">`).join('');
  } catch (e) { /* サイレント失敗 */ }
}

function updatePersonList() {
  const clientName = (document.getElementById('pj-client')?.value || '').trim();
  const dl = document.getElementById('personList');
  if (!dl) return;
  if (!clientName || !TRIDGE_CLIENTS.length) { dl.innerHTML = ''; return; }
  // 枝番1以上 = 担当者個別レコード（枝番なしの旧形式も personName があれば対象）
  const contacts = TRIDGE_CLIENTS.filter(c =>
    c.clientName === clientName && c.personName && (c.edaban == null || c.edaban >= 1)
  );
  dl.innerHTML = contacts.map(c => `<option value="${esc(c.personName)}">`).join('');
}

async function checkKnowledgeRestore() {
  try {
    const cnt = await knowledgeDB.count();
    const lastBackup = localStorage.getItem('knowledge_last_backup');
    if (cnt === 0 && lastBackup) {
      document.getElementById('knowledgeRestoreBanner').style.display = '';
    }
  } catch(e) { console.warn('ナレッジDB復元チェック失敗:', e); }
}

async function restoreKnowledgeFromBanner(file) {
  if (!file) return;
  try {
    const restored = await knowledgeDB.restoreFromBackup(file);
    showToast(`ナレッジDB復元完了: ${restored}件`);
    document.getElementById('knowledgeRestoreBanner').style.display = 'none';
    renderDBTable();
  } catch(e) {
    showToast('復元に失敗しました: ' + e.message);
  }
}

function dismissRestoreBanner() {
  document.getElementById('knowledgeRestoreBanner').style.display = 'none';
}

// ===== UTILS =====
function formatNum(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
// esc() is now a shared global defined in data.js
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  // エラーメッセージは長めに表示
  const duration = (msg && (msg.includes('エラー') || msg.includes('Error') || msg.includes('❌'))) ? 8000 : 2500;
  setTimeout(() => t.classList.remove('show'), duration);
}

// ===== 見積自動作成 =====
async function autoCreateEstimate() {
  if (!koshuTridgeLoaded && activeCategories.length === 0) {
    showToast('先にトリッジを装着してください');
    return;
  }

  const struct = project.struct;
  const type = project.type;
  const usage = project.usage;
  const area = parseFloat(project.areaTsubo) || 0;
  const memo = (document.getElementById('pj-memo')?.value || '').trim();

  if (!struct && !type) {
    showToast('構造・種別を入力してください');
    return;
  }

  // ナレッジDBから類似物件を検索
  let candidates;
  try {
    candidates = await knowledgeDB.searchSimilar({ struct, type, usage, areaTsubo: area });
  } catch(e) { candidates = []; }

  // メモのキーワードでスコアブースト
  if (memo) {
    const keywords = memo.split(/[\s　、。・,，]+/).map(k => norm(k)).filter(k => k.length >= 2);
    candidates.forEach(rec => {
      const target = norm((rec.project.name || '') + (rec.project.usage || ''));
      keywords.forEach(kw => { if (target.includes(kw)) rec._score += 1; });
    });
    candidates.sort((a, b) => b._score - a._score);
  }

  // 品目明細付きの候補のみ抽出
  const withDetail = candidates.filter(r =>
    r.categories && r.categories.some(c => c.items && c.items.length > 0)
  );

  if (withDetail.length === 0) {
    showToast('品目明細付きの類似物件がありません');
    return;
  }

  // 候補選択モーダル表示
  let html = '';
  if (memo) {
    html += `<div style="margin-bottom:12px;padding:8px 12px;background:var(--accent-light);border-left:3px solid var(--accent);border-radius:4px;font-size:12px;color:var(--text-main);">
      <span style="font-weight:600;">メモ:</span> ${esc(memo)}
    </div>`;
  }
  html += '<div style="margin-bottom:12px;font-size:12px;color:var(--text-sub);">類似物件の品目を面積比で調整して自動投入します。候補を選んでください。</div>';

  html += '<div style="display:flex;flex-direction:column;gap:8px;">';
  withDetail.slice(0, 5).forEach(rec => {
    const p = rec.project;
    const recArea = parseFloat(p.areaTsubo) || 0;
    const ratio = (area > 0 && recArea > 0) ? (area / recArea) : 1;
    const catCount = rec.categories.filter(c => c.items && c.items.length > 0).length;
    const itemCount = rec.categories.reduce((s,c) => s + (c.items ? c.items.length : 0), 0);

    html += `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;cursor:pointer;transition:all 0.15s;"
                  onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--accent-light)'"
                  onmouseout="this.style.borderColor='var(--border)';this.style.background=''"
                  onclick="applyAutoCreate(${rec.id}, ${ratio})">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;font-size:13px;">${p.name}</div>
          <div style="font-size:11px;color:var(--text-sub);">
            ${p.struct} / ${p.type} / ${p.usage || '—'} / ${recArea ? recArea+'坪' : '面積不明'}
          </div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">
            ${catCount}工種 / ${itemCount}品目 / スコア: ${rec._score}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:'JetBrains Mono';font-weight:700;color:var(--accent);">¥${formatNum(rec.grandTotal)}</div>
          <div style="font-size:10px;color:var(--text-sub);">面積比: ${ratio.toFixed(2)}x</div>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';

  document.getElementById('autoCreateBody').innerHTML = html;
  document.getElementById('autoCreateModal').classList.add('show');
}

// 自動作成の実行
async function applyAutoCreate(knowledgeId, areaRatio) {
  document.getElementById('autoCreateModal').classList.remove('show');

  const rec = await knowledgeDB.getById(knowledgeId);
  if (!rec) { showToast('レコードが見つかりません'); return; }

  saveUndoState();

  let addedItems = 0;

  // 工種名の正規化（工事・工・設備 等の末尾語を除去してコア名を抽出）
  const normCatName = s => norm(s).replace(/工事$|工$|設備$/, '');

  rec.categories.forEach(srcCat => {
    if (!srcCat.items || srcCat.items.length === 0) return;

    const srcKey = normCatName(srcCat.name || '');

    // 現在のactiveCategoriesから一致する工種を探す（完全一致 → 部分一致の順）
    let targetCat = activeCategories.find(c =>
      c.id === srcCat.id || norm(c.name) === norm(srcCat.name)
    );
    if (!targetCat) {
      targetCat = activeCategories.find(c => {
        const tKey = normCatName(c.name || '');
        return tKey && srcKey && (tKey.includes(srcKey) || srcKey.includes(tKey));
      });
    }
    if (!targetCat || !targetCat.active) return;

    // items[catId] がなければ初期化
    if (!items[targetCat.id]) items[targetCat.id] = [];

    // 既存品目があれば確認
    const existing = items[targetCat.id].filter(i => i.name);
    if (existing.length > 0) {
      if (!confirm(`「${targetCat.name}」には既に${existing.length}件の品目があります。上書きしますか？\n（キャンセルでこの工種をスキップ）`)) {
        return;
      }
      items[targetCat.id] = [];
    }

    // AUTO_NAMESに該当する行は除外（自動計算行はaddAutoCalcRowsで再生成するため）
    srcCat.items.forEach(srcItem => {
      if (isAutoName(srcItem.name)) return;

      const qty = areaRatio !== 1
        ? Math.ceil((srcItem.qty || 0) * areaRatio)
        : (srcItem.qty || 0);
      const price = srcItem.price || 0;
      const amount = qty * price;

      const bukVal = srcItem.bukariki1 || srcItem.bukariki || '';
      const buk = resolveBukariki(srcItem.name, srcItem.spec, bukVal);
      items[targetCat.id].push(createBlankItem({
        name: srcItem.name, spec: srcItem.spec || '',
        qty, unit: srcItem.unit || '', price, amount,
        bukariki1: buk.value > 0 ? buk.value : '',
        note: srcItem.note || '',
      }));
      addedItems++;
    });
  });

  // 最初の工種を表示して明細入力パネルへ遷移
  const firstCat = activeCategories.find(c => c.active && !c.rateMode && items[c.id] && items[c.id].length > 0);
  if (firstCat) currentCat = firstCat.id;

  navigate('items');
  showToast(`${addedItems}品目を自動投入しました（元: ${rec.project.name}）`);
}