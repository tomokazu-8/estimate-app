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
}

// 銅建値補正UIをTridge設定マスタに連動して表示/非表示切り替え
function updateCopperUI() {
  const copperGroup = document.getElementById('pj-copper')?.closest('.form-group');
  if (copperGroup) copperGroup.style.display = TRIDGE_SETTINGS.copperEnabled ? '' : 'none';
  // 設定マスタの労務単価をフォームに反映
  if (TRIDGE_SETTINGS.laborSell) {
    const el = document.getElementById('pj-labor-sell');
    if (el && !project.laborSell) el.value = TRIDGE_SETTINGS.laborSell;
  }
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
    console.log('DB loaded: ' + MATERIAL_DB.length + ' materials, ' + BUKARIKI_DB.length + ' bukariki');
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
  updateCopperUI(); // 銅建値補正UI（Tridge未装着時は非表示）
  renderCatTabs();
  showDbOverlay();
  loadDefaultDB().then(async () => {
    loadFromLocalStorage(); updateDbStatus(); recalcAll();
    // PERF_DB → ナレッジDB移行（初回のみ）
    try {
      const migrated = await knowledgeDB.migratePerfDB(PERF_DB);
      if (migrated > 0) console.log('PERF_DB migrated: ' + migrated + ' records');
    } catch(e) { console.warn('PERF_DB migration failed:', e); }
    renderDBTable();
    // ナレッジDB空チェック → 復元バナー表示
    checkKnowledgeRestore();
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

  const titles = { project:'物件情報', items:'明細入力', summary:'内訳書', reference:'類似物件参照', check:'妥当性チェック', database:'ナレッジDB' };
  document.getElementById('topbarTitle').textContent = titles[panel] || '';
  document.getElementById('topbarBread').textContent = project.name || '新規見積作成';

  if (panel === 'summary') { renderCategoryManager(); renderSummary(); }
  if (panel === 'reference') searchSimilar();
  if (panel === 'items') { renderCatTabs(); renderItems(); }
}

// ===== UNDO / REDO =====
function saveUndoState() {
  _undoStack.push({
    items: JSON.parse(JSON.stringify(items)),
    itemIdCounter: itemIdCounter,
    activeCategories: JSON.parse(JSON.stringify(activeCategories)),
    customCatCounter: customCatCounter,
  });
  if (_undoStack.length > 50) _undoStack.shift();
  _redoStack = []; // 新しい操作でRedoスタックをクリア
  document.getElementById('backBtn').style.display = '';
  document.getElementById('redoBtn').style.display = 'none';
}

function undoAction() {
  if (_undoStack.length === 0) return;
  _redoStack.push({
    items: JSON.parse(JSON.stringify(items)),
    itemIdCounter: itemIdCounter,
    activeCategories: JSON.parse(JSON.stringify(activeCategories)),
    customCatCounter: customCatCounter,
  });
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
  _undoStack.push({
    items: JSON.parse(JSON.stringify(items)),
    itemIdCounter: itemIdCounter,
    activeCategories: JSON.parse(JSON.stringify(activeCategories)),
    customCatCounter: customCatCounter,
  });
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
  project.laborRate = parseFloat(document.getElementById('pj-labor-rate').value) || 72;
  project.laborSell = parseFloat(document.getElementById('pj-labor-sell').value) || 33000;
  project.tax = parseFloat(document.getElementById('pj-tax').value) || 10;
  project.copper = document.getElementById('pj-copper').value;

  // LABOR_RATES / laborCostRatio を project 値と同期
  LABOR_RATES.sell = project.laborSell;
  LABOR_RATES.cost = Math.round(project.laborSell * project.laborRate / 100);
  AUTO_CALC.laborCostRatio = project.laborRate / 100;

  // 銅建値変動分を全ケーブル行に反映
  recalcCopperAmounts();
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
  el.innerHTML = activeCats.map(c => {
    const total = getCatTotal(c.id);
    const amountStr = total > 0 ? ` ¥${formatNum(total)}` : '';
    return `<div class="cat-tab${c.id===currentCat?' active':''}" onclick="switchCat('${c.id}')">${c.short}<span class="cat-amount">${amountStr}</span></div>`;
  }).join('');
}

function switchCat(catId) {
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

    const nameSpan = `<span style="font-size:13px;flex:1;min-width:0;">${c.name}</span>`;

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
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--bg-alt);background:#faf9f7;">
        ${moveBtns}${checkbox}${nameSpan}${rateSection}${deleteBtn}
      </div>`;
    }

    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--bg-alt);">
      ${moveBtns}${checkbox}${nameSpan}${deleteBtn}
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
function moveCat(catId, direction) {
  const idx = activeCategories.findIndex(c => c.id === catId);
  if (idx === -1) return;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= activeCategories.length) return;
  [activeCategories[idx], activeCategories[newIdx]] = [activeCategories[newIdx], activeCategories[idx]];
  saveActiveCategories();
  renderCategoryManager();
  renderCatTabs();
  renderSummary();
  updateSummaryBar();
}

function updateRatePct(catId, value) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.ratePct = parseFloat(value) || 0;
  cat.fixedAmount = null; // % 変更時は手動金額をクリアして%連動に戻す
  saveActiveCategories();
  renderCategoryManager();
  renderSummary();
  updateSummaryBar();
}

function updateRateFixedAmount(catId, value) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  const trimmed = String(value).trim();
  cat.fixedAmount = (trimmed === '' || isNaN(parseFloat(trimmed))) ? null : parseFloat(trimmed);
  saveActiveCategories();
  renderCategoryManager();
  renderSummary();
  updateSummaryBar();
}

function clearRateFixedAmount(catId) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.fixedAmount = null;
  saveActiveCategories();
  renderCategoryManager();
  renderSummary();
  updateSummaryBar();
}

function updateRateIncludeLabor(catId, checked) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return;
  cat.rateIncludeLabor = checked;
  saveActiveCategories();
  renderCategoryManager();
  renderSummary();
  updateSummaryBar();
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

// ===== 銅建値補正 =====

// ケーブル品名かどうかを判定（キーワードマスタの銅連動フラグで決定）
function isCableItem(name, spec) {
  if (!TRIDGE_KEYWORDS.length) return false;
  const n = norm(name + ' ' + (spec || ''));
  return TRIDGE_KEYWORDS.some(k => k.copperLinked && n.includes(k.keyword));
}

// 銅建値乗数を返す（銅建値補正が無効またはケーブル以外は 1.0）
// 乗数 = 銅非連動分(1-f) + 銅連動分(f × 現在値/基準値)
function getCopperMultiplier(name, spec) {
  if (!TRIDGE_SETTINGS.copperEnabled) return 1.0;
  const currentCopper = parseFloat(project.copper);
  if (!currentCopper || currentCopper <= 0) return 1.0;
  if (!isCableItem(name, spec)) return 1.0;
  const r = currentCopper / TRIDGE_SETTINGS.copperBase;
  const f = TRIDGE_SETTINGS.copperFraction;
  return f * r + (1 - f);
}

// 全カテゴリの材料行 amount を銅建値乗数で再計算（銅建値変更時に呼ぶ）
function recalcCopperAmounts() {
  Object.keys(items).forEach(catId => {
    (items[catId] || []).forEach(item => {
      if (AUTO_NAMES.includes(item.name)) return;
      const qty   = parseFloat(item.qty);
      const price = parseFloat(item.price);
      if (isNaN(qty) || isNaN(price)) return;
      item.amount = qty * price * getCopperMultiplier(item.name, item.spec || '');
    });
  });
}

// 労務費セクションの計算値を、明細リスト内の固定行に自動反映する
function syncLaborItemPrices() {
  const lb = calcLaborBreakdown(currentCat);
  const priceMap = {
    '電工労務費':               Math.round(lb.totalKosu * LABOR_RATES.sell),
    '器具取付費':               Math.round(lb.fixtureKosu * LABOR_RATES.sell),
    '機器取付費':               Math.round(lb.equipKosu * LABOR_RATES.sell),
    '機器取付け及び試験調整費': Math.round(lb.totalKosu * LABOR_RATES.sell),
    '埋込器具用天井材開口費':   Math.round(lb.ceilingCount * 1410),
  };
  (items[currentCat] || []).forEach(item => {
    if (Object.prototype.hasOwnProperty.call(priceMap, item.name)) {
      item.price  = priceMap[item.name];
      item.amount = priceMap[item.name];
    }
  });
}

// ===== LABOR SECTION RENDERING (本丸EX準拠) =====
function renderLaborSection() {
  const lb = calcLaborBreakdown(currentCat);
  
  if (lb.materialTotal <= 0 && lb.totalKosu <= 0) {
    document.getElementById('laborSection').style.display = 'none';
    _laborSellTotal = 0;
    return;
  }
  document.getElementById('laborSection').style.display = '';
  
  const rows = [];
  const lr = AUTO_CALC.laborCostRatio; // 0.72
  
  const laborSellStr = '¥' + formatNum(LABOR_RATES.sell);

  // 1. 電工労務費 (配線工事労務)
  if (lb.wiringKosu > 0) {
    const sell = Math.round(lb.wiringKosu * LABOR_RATES.sell);
    rows.push({ name: '電工労務費', basis: lb.wiringKosu.toFixed(2) + '人工 × ' + laborSellStr, sell, cost: Math.round(sell * lr) });
  }

  // 2. 器具取付費 (器具・配線器具の取付工事)
  if (lb.fixtureKosu > 0) {
    const sell = Math.round(lb.fixtureKosu * LABOR_RATES.sell);
    rows.push({ name: '器具取付費', basis: lb.fixtureKosu.toFixed(2) + '人工 × ' + laborSellStr, sell, cost: Math.round(sell * lr) });
  }

  // 3. 機器取付費 (盤類・大型機器)
  if (lb.equipKosu > 0) {
    const sell = Math.round(lb.equipKosu * LABOR_RATES.sell);
    rows.push({ name: '機器取付費', basis: lb.equipKosu.toFixed(2) + '人工 × ' + laborSellStr, sell, cost: Math.round(sell * lr) });
  }
  
  // 4. 埋込器具用天井材開口費
  if (lb.ceilingCount > 0) {
    const unitPrice = 1410; // ¥1,410/箇所 (実績平均)
    const sell = Math.round(lb.ceilingCount * unitPrice);
    rows.push({ name: '埋込器具用天井材開口費', basis: lb.ceilingCount + '箇所 × ¥' + formatNum(unitPrice), sell, cost: Math.round(sell * lr) });
  }
  
  // 5. 雑材料消耗品
  if (lb.materialTotal > 0) {
    const _miscCat = activeCategories.find(c => c.id === currentCat);
    const rate = _miscCat?.miscRate ?? 0.05;
    const sell = Math.round(lb.materialTotal * rate);
    rows.push({ name: '雑材料消耗品', basis: '材料費 × ' + (rate*100).toFixed(0) + '%', sell, cost: Math.round(sell * lr) });
  }
  
  // 6. 運搬費
  if (lb.materialTotal > 0) {
    const t = calcTransport(lb.materialTotal);
    rows.push({ name: '運搬費', basis: '材料費規模別', sell: t, cost: Math.round(t * lr) });
  }
  
  // Render table
  let sellSum = 0, costSum = 0;
  document.getElementById('laborBody').innerHTML = rows.map((r, i) => {
    sellSum += r.sell; costSum += r.cost;
    const ratio = r.sell > 0 ? (r.cost / r.sell * 100).toFixed(0) + '%' : '-';
    return '<tr style="border-bottom:1px solid #e5e7eb;">' +
      '<td class="td-center" style="font-size:11px;color:#6b7280;">'+(i+1)+'</td>' +
      '<td style="font-weight:500;padding:6px 8px;">'+r.name+'</td>' +
      '<td style="font-size:11px;color:#6b7280;padding:6px 4px;">'+r.basis+'</td>' +
      '<td class="td-right" style="padding:6px 8px;">¥'+formatNum(r.sell)+'</td>' +
      '<td class="td-right" style="padding:6px 8px;color:#6b7280;">¥'+formatNum(r.cost)+'</td>' +
      '<td class="td-right" style="padding:6px 4px;font-size:11px;">'+ratio+'</td></tr>';
  }).join('');
  
  document.getElementById('laborSellTotal').textContent = '¥' + formatNum(sellSum);
  document.getElementById('laborCostTotal').textContent = '¥' + formatNum(costSum);
  document.getElementById('laborRatioTotal').textContent = sellSum > 0 ? (costSum/sellSum*100).toFixed(0)+'%' : '-';
  _laborSellTotal = sellSum;
}

function showLaborDetail() {
  const lb = calcLaborBreakdown(currentCat);
  if (lb.details.length === 0) { showToast('材料を先に入力してください'); return; }
  const typeNames = { wiring: '配線工事', fixture: '器具取付', equipment: '機器取付' };
  let html = '<div style="padding:12px 16px;max-height:450px;overflow-y:auto;font-size:12px;">';
  html += '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f0fdf4;"><th style="text-align:left;padding:4px;">品名</th><th style="text-align:right;padding:4px;">数量</th><th style="text-align:right;padding:4px;">歩掛</th><th style="text-align:right;padding:4px;">工数</th><th style="padding:4px;">分類</th><th style="padding:4px;">根拠</th></tr></thead><tbody>';
  for (const d of lb.details) {
    html += '<tr style="border-bottom:1px solid #eee;"><td style="padding:3px 4px;">'+d.name+'</td><td style="text-align:right;padding:3px 4px;">'+d.qty+'</td><td style="text-align:right;padding:3px 4px;">'+d.bukariki.toFixed(3)+'</td><td style="text-align:right;padding:3px 4px;">'+d.kosu.toFixed(3)+'</td><td style="padding:3px 4px;"><span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:10px;">'+(typeNames[d.type]||d.type)+'</span></td><td style="padding:3px 4px;font-size:10px;color:#888;">'+d.source+'</td></tr>';
  }
  html += '</tbody></table>';
  html += '<div style="margin-top:12px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:13px;">';
  html += '<b>配線工事:</b> '+lb.wiringKosu.toFixed(2)+'人工　<b>器具取付:</b> '+lb.fixtureKosu.toFixed(2)+'人工　<b>機器取付:</b> '+lb.equipKosu.toFixed(2)+'人工';
  html += '<br><b>合計:</b> '+lb.totalKosu.toFixed(2)+'人工 → 見積 ¥'+formatNum(Math.round(lb.totalKosu*LABOR_RATES.sell))+' / 原価 ¥'+formatNum(Math.round(lb.totalKosu*LABOR_RATES.cost));
  html += '</div></div>';
  document.getElementById('laborModalBody').innerHTML = html;
  document.getElementById('laborModal').classList.add('show');
}

function renderItems() {
  syncLaborItemPrices(); // 労務費セクションの計算値を固定行に自動反映

  const cat = activeCategories.find(c => c.id === currentCat);
  document.getElementById('catTitle').textContent = cat ? cat.name : '';

  const tbody = document.getElementById('itemBody');
  const list = items[currentCat] || [];

  tbody.innerHTML = list.map((item, idx) => {
    const isAuto = AUTO_NAMES.includes(item.name);
    const isLaborLocked = LABOR_LOCKED_NAMES.includes(item.name);
    const copperMult = (!isAuto && isCableItem(item.name, item.spec || '')) ? getCopperMultiplier(item.name, item.spec || '') : 1.0;
    const hasCopperAdj = Math.abs(copperMult - 1.0) > 0.001;
    const copperBadge = hasCopperAdj
      ? `<span style="display:block;font-size:9px;color:var(--amber);line-height:1.2;" title="銅建値補正（基準 ¥${TRIDGE_SETTINGS.copperBase}/kg → 現在 ¥${project.copper}/kg）">銅×${copperMult.toFixed(2)}</span>`
      : '';
    return `
    <tr data-id="${item.id}" class="${isAuto ? 'auto-calc' : ''}">
      <td class="td-center" style="color:var(--text-dim);font-size:11px;">${idx+1}</td>
      <td class="suggest-wrap">
        <input value="${esc(item.name)}" onchange="updateItem(${item.id},'name',this.value)" oninput="showSuggestions(${item.id},this.value)" onblur="hideSuggestions(${item.id})" placeholder="品名（入力で候補表示）">
        <div class="suggest-list" id="suggest-${item.id}"></div>
      </td>
      <td><input value="${esc(item.spec)}" onchange="updateItem(${item.id},'spec',this.value)" placeholder="規格"></td>
      <td><input class="num" value="${item.qty||''}" onchange="updateItem(${item.id},'qty',this.value)" type="number" step="any"></td>
      <td><select onchange="updateItem(${item.id},'unit',this.value)">${UNITS.map(u=>`<option${u===item.unit?' selected':''}>${u}</option>`).join('')}</select></td>
      <td><input class="num" value="${item.bukariki !== '' && item.bukariki !== undefined ? item.bukariki : ''}" onchange="updateItem(${item.id},'bukariki',this.value)" type="number" step="0.001" placeholder="自動" ${isAuto ? 'disabled' : ''}></td>
      <td><input class="num" value="${item.price||''}" onchange="updateItem(${item.id},'price',this.value)" type="number" step="any" ${isLaborLocked ? 'disabled style="background:var(--bg-alt);color:var(--text-sub);"' : ''}></td>
      <td class="td-right" style="font-weight:500;">${item.amount ? '¥'+formatNum(Math.round(item.amount)) : ''}${copperBadge}</td>
      <td><input value="${esc(item.note)}" onchange="updateItem(${item.id},'note',this.value)" placeholder="${isLaborLocked ? '自動計算' : (item.name==='雑材料消耗品'||item.name==='運搬費') ? '例: 5.0%' : '定価'}" style="font-size:11px;color:var(--text-sub);" ${isLaborLocked ? 'readonly' : ''}></td>
      <td>
        <span style="display:flex;gap:2px;">
          <button class="row-delete" onclick="openSearchModal(${item.id})" title="材料DBから検索" style="opacity:0.5;color:var(--accent);">🔍</button>
          <button class="row-delete" onclick="deleteItem(${item.id})">✕</button>
        </span>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('catTotal').textContent = '¥' + formatNum(Math.round(getCatTotal(currentCat)));
  renderLaborSection();
  updateSummaryBar();
}

function addItem() {
  saveUndoState();
  const id = itemIdCounter++;
  items[currentCat].push({ id, name:'', spec:'', qty:'', unit:'式', price:'', amount:0, note:'', bukariki:'' });
  renderItems();
  // Focus the new row's name input
  setTimeout(() => {
    const rows = document.querySelectorAll('#itemBody tr');
    if (rows.length) rows[rows.length-1].querySelector('input').focus();
  }, 50);
}

// addAutoCalcRows is in calc-engine.js

function updateItem(id, field, value) {
  const list = items[currentCat];
  const item = list.find(i => i.id === id);
  if (!item) return;
  saveUndoState();
  item[field] = value;

  // Auto calc amount
  if (field === 'qty' || field === 'price') {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    item.amount = qty * price * getCopperMultiplier(item.name, item.spec || '');

    // 雑材料消耗品・運搬費：価格変更時に有効％をnoteへ自動反映
    if (field === 'price' && (item.name === '雑材料消耗品' || item.name === '運搬費')) {
      const matTotal = list
        .filter(i => !AUTO_NAMES.includes(i.name))
        .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      if (matTotal > 0 && price > 0) {
        item.note = (price / matTotal * 100).toFixed(1) + '%';
      }
    }
  }

  // 雑材料消耗品・運搬費：note に %値を入力したら価格を千円丸めで再計算
  if (field === 'note' && (item.name === '雑材料消耗品' || item.name === '運搬費')) {
    const m = value.trim().match(/^(\d+\.?\d*)%?$/);
    if (m) {
      const pct = parseFloat(m[1]);
      const matTotal = list
        .filter(i => !AUTO_NAMES.includes(i.name))
        .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
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
  items[currentCat] = items[currentCat].filter(i => i.id !== id);
  renderItems();
  renderCatTabs();
}

function recalcAll() {
  updateProject();
  renderItems();
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
  let grandTotal = 0;

  activeCategories.filter(c => c.active).forEach(c => {
    const total = getCatAmount(c.id);
    // rateMode 工種は %=0 で金額ゼロでも表示（入力欄として存在させる）、非 rateMode は金額ゼロをスキップ
    if (total === 0 && !c.rateMode) return;
    grandTotal += total;
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
    const p = rec.project;
    const area = parseFloat(p.areaTsubo) || 0;
    const tp = area > 0 ? '¥'+formatNum(Math.round(rec.grandTotal / area)) : '—';
    const hasDetail = rec.categories && rec.categories.some(c => c.items && c.items.length > 0);
    return `<tr>
      <td style="font-size:11px;">${rec.registeredAt || '—'}</td>
      <td>${p.name}</td>
      <td>${p.struct}</td>
      <td><span class="tag ${p.type==='新築'?'tag-blue':'tag-amber'}">${p.type}</span></td>
      <td>${p.usage||''}</td>
      <td class="td-right">¥${formatNum(rec.grandTotal)}</td>
      <td class="td-right">${rec.profitRate}%</td>
      <td class="td-right">${tp}</td>
      <td style="text-align:center;">${hasDetail
        ? `<button class="btn btn-secondary btn-sm" style="font-size:10px;padding:2px 6px;" onclick="showKnowledgeDetail(${rec.id})">詳細</button>`
        : '<span style="font-size:10px;color:var(--text-dim);">なし</span>'}</td>
      <td><button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red);" onclick="deleteKnowledge(${rec.id})">×</button></td>
    </tr>`;
  }).join('');
}

// ナレッジ詳細表示
async function showKnowledgeDetail(id) {
  const rec = await knowledgeDB.getById(id);
  if (!rec) { showToast('レコードが見つかりません'); return; }

  const p = rec.project;
  let html = `<div style="margin-bottom:12px;">
    <div style="font-weight:600;font-size:15px;margin-bottom:4px;">${p.name}</div>
    <div style="font-size:11px;color:var(--text-sub);">${p.struct} / ${p.type} / ${p.usage || '—'} / ${p.areaTsubo ? p.areaTsubo+'坪' : '面積不明'}</div>
    <div style="font-size:11px;color:var(--text-sub);">登録日: ${rec.registeredAt} / 合計: ¥${formatNum(rec.grandTotal)} / 利益率: ${rec.profitRate}%</div>
  </div>`;

  if (rec.categories && rec.categories.length > 0) {
    rec.categories.forEach(cat => {
      if (!cat.items || cat.items.length === 0) return;
      html += `<div style="margin-bottom:12px;">
        <div style="font-weight:600;font-size:12px;background:var(--bg);padding:6px 10px;border-radius:4px;margin-bottom:4px;">
          ${cat.name}（小計: ¥${formatNum(cat.subtotal)}）
        </div>
        <table style="font-size:11px;"><thead><tr>
          <th>品名</th><th>規格</th><th style="text-align:right">数量</th><th>単位</th><th style="text-align:right">単価</th><th style="text-align:right">金額</th>
        </tr></thead><tbody>`;
      cat.items.forEach(i => {
        html += `<tr>
          <td>${i.name}</td><td>${i.spec||''}</td>
          <td class="td-right">${i.qty||''}</td><td>${i.unit||''}</td>
          <td class="td-right">${i.price ? '¥'+formatNum(i.price) : ''}</td>
          <td class="td-right">${i.amount ? '¥'+formatNum(Math.round(i.amount)) : ''}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    });
  } else {
    html += '<p style="color:var(--text-sub);font-size:12px;">品目明細なし（レガシーデータ）</p>';
  }

  document.getElementById('knowledgeDetailBody').innerHTML = html;
  document.getElementById('knowledgeDetailModal').classList.add('show');
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

// JSONエクスポート
async function knowledgeExportJSON() {
  try {
    await knowledgeDB.exportJSON();
    showToast('JSONエクスポート完了');
  } catch(e) { showToast('エクスポートに失敗しました'); }
}

// JSONインポート
async function knowledgeImportJSON(file) {
  if (!file) return;
  try {
    const count = await knowledgeDB.importJSON(file);
    showToast(count + '件インポートしました');
    renderDBTable();
  } catch(e) { showToast('インポートに失敗しました: ' + e.message); }
  // input をリセット
  document.getElementById('knowledgeImportFile').value = '';
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
      document.getElementById('pj-name').value = project.name || '';
      document.getElementById('pj-number').value = project.number || '';
      document.getElementById('pj-date').value = project.date || '';
      document.getElementById('pj-client').value = project.client || '';
      document.getElementById('pj-struct').value = project.struct || '';
      document.getElementById('pj-usage').value = project.usage || '';
      document.getElementById('pj-type').value = project.type || '';
      document.getElementById('pj-floors').value = project.floors || '';
      document.getElementById('pj-area-sqm').value = project.areaSqm || '';
      document.getElementById('pj-area-tsubo').value = project.areaTsubo || '';
      document.getElementById('pj-location').value = project.location || '';
      document.getElementById('pj-person').value = project.person || '';
      document.getElementById('pj-labor-rate').value = project.laborRate || 72;
      document.getElementById('pj-labor-sell').value = project.laborSell || 33000;
      document.getElementById('pj-tax').value = project.tax || 10;
      document.getElementById('pj-copper').value = project.copper || '';
    }
    if (data.items) {
      items = data.items;
      // プリセット工種 + 有効なカスタム工種の items を初期化
      activeCategories.forEach(c => { if (!items[c.id]) items[c.id] = []; });
    }
    if (data.itemIdCounter) itemIdCounter = data.itemIdCounter;
    renderCatTabs();
    showToast('前回のデータを復元しました');
  } catch(e) {}
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

  // ナレッジDBに自動登録
  try {
    const record = knowledgeDB.buildRecord();
    if (record.grandTotal > 0) {
      await knowledgeDB.save(record);
      showToast('ナレッジDBに登録しました');
      renderDBTable();
    }
  } catch(e) { console.warn('ナレッジDB登録失敗:', e); }

  // ナレッジDB自動バックアップ（JSONダウンロード）
  try {
    await knowledgeDB.autoBackup();
  } catch(e) { console.warn('ナレッジDBバックアップ失敗:', e); }
}

// ===== ナレッジDB復元バナー =====
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
function esc(s) { return (s||'').replace(/"/g, '&quot;'); }
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== 見積自動作成 =====
async function autoCreateEstimate() {
  if (!tridgeLoaded && activeCategories.length === 0) {
    showToast('先にトリッジを装着してください');
    return;
  }

  const struct = project.struct;
  const type = project.type;
  const usage = project.usage;
  const area = parseFloat(project.areaTsubo) || 0;

  if (!struct && !type) {
    showToast('構造・種別を入力してください');
    return;
  }

  // ナレッジDBから類似物件を検索
  let candidates;
  try {
    candidates = await knowledgeDB.searchSimilar({ struct, type, usage, areaTsubo: area });
  } catch(e) { candidates = []; }

  // 品目明細付きの候補のみ抽出
  const withDetail = candidates.filter(r =>
    r.categories && r.categories.some(c => c.items && c.items.length > 0)
  );

  if (withDetail.length === 0) {
    showToast('品目明細付きの類似物件がありません');
    return;
  }

  // 候補選択モーダル表示
  let html = '<div style="margin-bottom:12px;font-size:12px;color:var(--text-sub);">類似物件の品目を面積比で調整して自動投入します。候補を選んでください。</div>';

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

  rec.categories.forEach(srcCat => {
    if (!srcCat.items || srcCat.items.length === 0) return;

    // 現在のactiveCategoriesから一致する工種を探す
    const targetCat = activeCategories.find(c =>
      c.id === srcCat.id || c.name === srcCat.name
    );
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
      if (AUTO_NAMES.includes(srcItem.name)) return;

      const qty = areaRatio !== 1
        ? Math.ceil((srcItem.qty || 0) * areaRatio)
        : (srcItem.qty || 0);
      const price = srcItem.price || 0;
      const amount = qty * price;

      items[targetCat.id].push({
        id: itemIdCounter++,
        name: srcItem.name,
        spec: srcItem.spec || '',
        qty: qty,
        unit: srcItem.unit || '',
        price: price,
        amount: amount,
        bukariki: srcItem.bukariki || '',
        note: srcItem.note || '',
      });
      addedItems++;
    });
  });

  // 最初の工種を表示
  const firstCat = activeCategories.find(c => c.active && !c.rateMode && items[c.id] && items[c.id].length > 0);
  if (firstCat) currentCat = firstCat.id;

  renderCatTabs();
  renderItems();
  updateSummaryBar();
  showToast(`${addedItems}品目を自動投入しました（元: ${rec.project.name}）`);
}