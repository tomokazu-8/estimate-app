// ===== Tridge Manager (db-manager統合版) =====
// db-managerの全機能をestimate-appに統合したモジュール
// 全関数・変数は tm プレフィックス付き（グローバル汚染防止）

// ===== LOCAL STORAGE KEYS =====
const TM_LS_LIST     = 'dbm_db_list';
const TM_LS_DATA     = 'dbm_db_data_';
const TM_LS_KOSHU    = 'dbm_db_koshu_';
const TM_LS_SETTINGS = 'dbm_db_settings_';
const TM_LS_KEYWORDS = 'dbm_db_keywords_';
const TM_LS_BUNRUI   = 'dbm_db_bunrui_';

// ===== LOCAL STORAGE HELPERS =====
function tmLoadLocal(key, def) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : def; } catch { return def; } }
function tmLoadDbList() {
  const list = tmLoadLocal(TM_LS_LIST, []);
  // マイグレーション: type がない既存データを補完
  list.forEach(db => {
    if (!db.type) {
      const hasRows  = (tmLoadLocal(TM_LS_DATA + db.id, [])).length > 0;
      const hasKoshu = (tmLoadLocal(TM_LS_KOSHU + db.id, [])).length > 0;
      db.type = hasRows && hasKoshu ? 'mixed' : hasRows ? 'zairyo' : hasKoshu ? 'koshu' : 'mixed';
    }
  });
  return list;
}
function tmSaveDbList(list)        { safeLocalStorageSet(TM_LS_LIST, JSON.stringify(list)); }
function tmLoadDbData(id)          { return tmLoadLocal(TM_LS_DATA     + id, []); }
function tmSaveDbData(id, rows)    { safeLocalStorageSet(TM_LS_DATA     + id, JSON.stringify(rows)); }
function tmLoadKoshuData(id)       { return tmLoadLocal(TM_LS_KOSHU    + id, []); }
function tmSaveKoshuData(id, rows) { safeLocalStorageSet(TM_LS_KOSHU    + id, JSON.stringify(rows)); }
function tmLoadSettingsData(id)    { return tmLoadLocal(TM_LS_SETTINGS + id, null); }
function tmSaveSettingsData(id, s) { safeLocalStorageSet(TM_LS_SETTINGS + id, JSON.stringify(s)); }
function tmLoadKeywordsData(id)    { return tmLoadLocal(TM_LS_KEYWORDS + id, []); }
function tmSaveKeywordsData(id, r) { safeLocalStorageSet(TM_LS_KEYWORDS + id, JSON.stringify(r)); }
function tmLoadBunruiData(id)      { return tmLoadLocal(TM_LS_BUNRUI   + id, { rows: [], keywords: [] }); }
function tmSaveBunruiData(id, d)   { safeLocalStorageSet(TM_LS_BUNRUI   + id, JSON.stringify(d)); }
function tmDeleteDbData(id) {
  [TM_LS_DATA, TM_LS_KOSHU, TM_LS_SETTINGS, TM_LS_KEYWORDS, TM_LS_BUNRUI].forEach(k => localStorage.removeItem(k + id));
}

// ===== CONSTANTS =====
// カテゴリ参照はdata.jsのMATERIAL_CATEGORIES / CAT_LABELSを使用
// 後方互換エイリアス
const TM_CAT_MAP = typeof CAT_LABELS !== 'undefined' ? CAT_LABELS : {};

const TM_EXCEL_HEADERS = ['品目名称','規格名称','単位','基準単価','原価単価','原価率','歩掛1','中分類名','カテゴリ','大分類ID','中分類ID','小分類ID','小分類名'];

// 旧カテゴリ体系（TM_ENG_TO_CAT, TM_STANDARD_CATEGORY_MASTER）は廃止
// → MATERIAL_CATEGORIES（data.js）に統合済み

// ===== STATE =====
let tmDbList = [];
let tmCurrentDbId = null;
let tmCurrentRows = [];
let tmFilteredRows = [];
let tmIsDirty = false;
let tmCurrentKoshu = [];      // 後方互換（工種エクスポート用に保持）
let tmCurrentSettings = null; // 後方互換（労務設定エクスポート用に保持）
let tmRenameTargetId = null;
let tmDeleteTargetId = null;
let tmInitialized = false;

// ===== HELPERS =====
// esc() and genId() are shared globals from data.js
function tmDefaultSettings() {
  return { laborSell: 33000, laborCost: 12000 };
}
function tmDetectCategory(hinmei, kikaku, chuName) {
  return detectMaterialCategory((hinmei || '') + ' ' + (kikaku || '') + ' ' + (chuName || ''), '');
}
function tmNewRow() {
  return { id: genId(), n:'', s:'', u:'', ep:'', cp:'', r:'', b:'', c:'misc', daiId:'', chuId:'', shoId:'', shoName:'' };
}
function tmNewKoshuRow(order) {
  return { id:'cat'+String(order||1).padStart(3,'0'), name:'', short:'', rateMode:false, miscRate:5, order:order||1, autoRows:'' };
}
function tmNewKeywordRow() {
  return { keyword:'', laborType:'fixture', bukariki:0, copperLinked:false, ceilingOpening:false };
}
const tmYn = v => ['true','1','yes','有効','割合','はい','○'].includes(String(v||'').trim());

// Tridge種別のラベルとスタイル
function _tmTypeLabel(type) {
  switch (type) {
    case 'koshu':    return { text: '工種', style: 'background:#dcfce7;color:#16a34a;' };
    case 'zairyo':
    case 'supplier': return { text: '資材', style: 'background:#dbeafe;color:#2563eb;' };
    case 'mixed':    return { text: '統合', style: 'background:#f3e8ff;color:#7c3aed;' };
    default:         return { text: '他',   style: 'background:#f1f5f9;color:#64748b;' };
  }
}

// ===== INIT =====
function tmInit() {
  if (tmInitialized) return;
  tmInitialized = true;
  tmDbList = tmLoadDbList();
  tmRenderSidebar();
  if (tmDbList.length > 0) tmSelectDb(tmDbList[0].id);
}


// ===== SIDEBAR =====
function tmRenderSidebar() {
  const el = document.getElementById('tm-dbList');
  if (!el) return;
  if (tmDbList.length === 0) {
    el.innerHTML = '<div style="color:#64748b;font-size:11px;padding:8px 4px;text-align:center;">トリッジがありません</div>';
    return;
  }
  el.innerHTML = tmDbList.map(db => {
    const typeLabel = _tmTypeLabel(db.type);
    const countLabel = db.type === 'koshu'
      ? (tmLoadLocal(TM_LS_KOSHU + db.id, [])).length + '工種'
      : db.rowCount + '品目';
    return `
    <div class="tm-db-item ${db.id === tmCurrentDbId ? 'selected' : ''}" onclick="tmSelectDb('${db.id}')">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;white-space:nowrap;${typeLabel.style}">${typeLabel.text}</span>
          <span style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(db.name)}</span>
        </div>
        <div style="font-size:10px;color:var(--text-sub);margin-top:1px;">${countLabel}${db.memo ? ' · ' + esc(db.memo) : ''}</div>
      </div>
      <div style="display:flex;gap:2px;flex-shrink:0;">
        <button class="tm-menu-btn" title="編集" onclick="event.stopPropagation();tmShowRenameModal('${db.id}')">✏</button>
        <button class="tm-menu-btn" title="削除" onclick="event.stopPropagation();tmShowDeleteModal('${db.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ===== SELECT DB =====
function tmSelectDb(id) {
  if (tmIsDirty && tmCurrentDbId) {
    if (!confirm('保存していない変更があります。切り替えますか？')) return;
  }
  tmCurrentDbId = id;
  tmCurrentRows     = tmLoadDbData(id);
  tmCurrentKoshu    = tmLoadKoshuData(id);
  tmCurrentSettings = tmLoadSettingsData(id) || tmDefaultSettings();
  tmCurrentKeywords = tmLoadKeywordsData(id);
  tmCurrentBunrui   = tmLoadBunruiData(id);
  tmIsDirty = false;

  tmApplyFilter();
  tmRenderSidebar();
  tmUpdateToolbar();
  tmUpdateUnsavedBadge();
  tmUpdateCatFilterOptions();
}


function tmUpdateCatFilterOptions() {
  const sel = document.getElementById('tm-catFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="">全カテゴリ</option>' +
    MATERIAL_CATEGORIES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function tmUpdateToolbar() {
  const db = tmDbList.find(d => d.id === tmCurrentDbId);
  const nameEl = document.getElementById('tm-currentDbName');
  if (nameEl) nameEl.textContent = db ? db.name : 'トリッジを選択してください';
  const btnExport      = document.getElementById('tm-btnExport');
  const btnApply       = document.getElementById('tm-btnApply');
  const btnApplyKoshu  = document.getElementById('tm-btnApplyKoshu');
  const btnApplyZairyo = document.getElementById('tm-btnApplyZairyo');
  if (btnExport) btnExport.disabled = !tmCurrentDbId;
  if (btnApply)  btnApply.disabled  = !tmCurrentDbId;
  // 種別に応じてボタンの有効/無効を切り替え
  const type = db?.type || 'mixed';
  const hasKoshu  = type === 'koshu' || type === 'mixed';
  const hasZairyo = type === 'zairyo' || type === 'mixed' || type === 'supplier';
  if (btnApplyKoshu)  btnApplyKoshu.disabled  = !tmCurrentDbId || !hasKoshu;
  if (btnApplyZairyo) btnApplyZairyo.disabled = !tmCurrentDbId || !hasZairyo;
  const table = document.getElementById('tm-mainTable');
  const empty = document.getElementById('tm-emptyState');
  if (tmCurrentDbId) {
    if (table) table.style.display = '';
    if (empty) empty.style.display = 'none';
  } else {
    if (table) table.style.display = 'none';
    if (empty) empty.style.display = 'flex';
  }
}

// ===== FILTER & RENDER TABLE =====
function tmApplyFilter() {
  const searchEl = document.getElementById('tm-searchInput');
  const catEl    = document.getElementById('tm-catFilter');
  const query = norm((searchEl ? searchEl.value : '')).trim();
  const cat   = catEl ? catEl.value : '';

  tmFilteredRows = tmCurrentRows.filter(row => {
    if (cat && row.c !== cat) return false;
    if (query.length >= 1) {
      const terms = query.split(/\s+/);
      const text = norm((row.n || '') + ' ' + (row.s || ''));
      if (!terms.every(t => text.includes(t))) return false;
    }
    return true;
  });
  tmRenderTable();
  tmUpdateRowCount();
}

function tmRenderTable() {
  const tbody = document.getElementById('tm-tableBody');
  if (!tbody) return;
  if (tmFilteredRows.length === 0 && tmCurrentDbId) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-sub);">データがありません。「＋ 行追加」から追加してください。</td></tr>`;
    return;
  }
  tbody.innerHTML = tmFilteredRows.map((row, idx) => `
    <tr data-id="${row.id}">
      <td class="td-center" style="font-size:11px;color:var(--text-dim);">${idx + 1}</td>
      <td><input class="tm-cell-input" value="${esc(row.n)}" placeholder="品目名称"
        onchange="tmOnCellChange('${row.id}','n',this.value)"
        oninput="tmOnNameInput('${row.id}',this.value)"></td>
      <td><input class="tm-cell-input" value="${esc(row.s)}" placeholder="規格名称"
        onchange="tmOnCellChange('${row.id}','s',this.value)"></td>
      <td><input class="tm-cell-input" value="${esc(row.u)}" placeholder="本" style="width:44px;"
        onchange="tmOnCellChange('${row.id}','u',this.value)"></td>
      <td><input class="tm-cell-input num" type="number" step="1" min="0" value="${row.ep !== '' ? row.ep : ''}" placeholder="0"
        onchange="tmOnPriceChange('${row.id}',this.value)"></td>
      <td><input class="tm-cell-input num" type="number" step="1" min="0" value="${row.cp !== '' ? row.cp : ''}" placeholder="0"
        onchange="tmOnCellChange('${row.id}','cp',this.value)"></td>
      <td><input class="tm-cell-input num" type="number" step="1" min="0" max="100" value="${row.r !== '' ? Math.round(parseFloat(row.r||0)*100) : ''}" placeholder="75"
        onchange="tmOnRateChange('${row.id}',this.value)"></td>
      <td><input class="tm-cell-input num" type="number" step="0.001" min="0" value="${row.b !== '' ? row.b : ''}" placeholder="0"
        onchange="tmOnCellChange('${row.id}','b',this.value)"></td>
      <td>
        <select class="tm-cell-select" onchange="tmOnCellChange('${row.id}','c',this.value)">
          ${MATERIAL_CATEGORIES.map(c => `<option value="${c.id}" ${row.c === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </td>
      <td><button class="row-delete" title="行を削除" onclick="tmDeleteRow('${row.id}')">✕</button></td>
    </tr>
  `).join('');
}

function tmUpdateRowCount() {
  const el = document.getElementById('tm-rowCount');
  if (!el) return;
  const total = tmCurrentRows.length;
  const shown = tmFilteredRows.length;
  el.textContent = total === shown ? `${total}品目` : `${shown}件表示（全${total}品目）`;
}

// ===== CELL CHANGE HANDLERS =====
function tmOnCellChange(id, field, value) {
  const row = tmCurrentRows.find(r => r.id === id);
  if (!row) return;
  row[field] = value;
  tmMarkDirty();
}

function tmOnPriceChange(id, value) {
  const row = tmCurrentRows.find(r => r.id === id);
  if (!row) return;
  const ep = parseFloat(value) || 0;
  row.ep = ep;
  if (row.r !== '' && row.r !== undefined) {
    const rate = parseFloat(row.r) || 0;
    row.cp = Math.round(ep * rate);
    const tr = document.querySelector(`#tm-mainTable tr[data-id="${id}"]`);
    if (tr) { const inputs = tr.querySelectorAll('input'); if (inputs[4]) inputs[4].value = row.cp; }
  }
  tmMarkDirty();
}

function tmOnRateChange(id, value) {
  const row = tmCurrentRows.find(r => r.id === id);
  if (!row) return;
  const pct = parseFloat(value);
  if (isNaN(pct)) { row.r = ''; return; }
  row.r = pct / 100;
  const ep = parseFloat(row.ep) || 0;
  if (ep > 0) {
    row.cp = Math.round(ep * row.r);
    const tr = document.querySelector(`#tm-mainTable tr[data-id="${id}"]`);
    if (tr) { const inputs = tr.querySelectorAll('input'); if (inputs[4]) inputs[4].value = row.cp; }
  }
  tmMarkDirty();
}

function tmOnNameInput(id, value) {
  const row = tmCurrentRows.find(r => r.id === id);
  if (!row) return;
  row.n = value;
  if (!row.c || row.c === 'C008') {
    row.c = tmDetectCategory(value, row.s, '');
    const tr = document.querySelector(`#tm-mainTable tr[data-id="${id}"]`);
    if (tr) { const sel = tr.querySelector('select.tm-cell-select'); if (sel) sel.value = row.c; }
  }
  tmMarkDirty();
}

// ===== ADD / DELETE ROW =====
function tmAddRow() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  tmCurrentRows.push(tmNewRow());
  tmMarkDirty();
  tmApplyFilter();
  setTimeout(() => {
    const wrap = document.getElementById('tm-tableWrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }, 50);
}

function tmDeleteRow(id) {
  const idx = tmCurrentRows.findIndex(r => r.id === id);
  if (idx === -1) return;
  tmCurrentRows.splice(idx, 1);
  tmMarkDirty();
  tmApplyFilter();
}

// ===== DIRTY / SAVE =====
function tmMarkDirty() {
  tmIsDirty = true;
  tmUpdateUnsavedBadge();
  clearTimeout(tmMarkDirty._timer);
  tmMarkDirty._timer = setTimeout(tmAutoSave, 500);
}

function tmAutoSave() {
  if (!tmCurrentDbId || !tmIsDirty) return;
  tmSaveDbData(tmCurrentDbId, tmCurrentRows);
  tmSaveKoshuData(tmCurrentDbId, tmCurrentKoshu);
  tmSaveSettingsData(tmCurrentDbId, tmCurrentSettings);
  tmSaveKeywordsData(tmCurrentDbId, tmCurrentKeywords);
  tmSaveBunruiData(tmCurrentDbId, tmCurrentBunrui);
  const db = tmDbList.find(d => d.id === tmCurrentDbId);
  if (db) {
    db.rowCount = tmCurrentRows.length;
    db.updatedAt = new Date().toISOString();
    tmSaveDbList(tmDbList);
  }
  tmIsDirty = false;
  tmUpdateUnsavedBadge();
  tmSetStatus('保存しました');
  tmRenderSidebar();
}

function tmUpdateUnsavedBadge() {
  const el = document.getElementById('tm-unsavedBadge');
  if (el) el.style.display = tmIsDirty ? 'inline' : 'none';
}

function tmSetStatus(msg) {
  const el = document.getElementById('tm-statusMsg');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}


// ===== CREATE MODAL =====
function tmShowCreateModal() {
  document.getElementById('tm-newDbName').value = '';
  document.getElementById('tm-newDbMemo').value = '';
  document.getElementById('tm-createModal').style.display = 'flex';
  setTimeout(() => document.getElementById('tm-newDbName').focus(), 100);
}

function tmCloseCreateModal() {
  document.getElementById('tm-createModal').style.display = 'none';
}

function tmConfirmCreateDb() {
  const name = document.getElementById('tm-newDbName').value.trim();
  if (!name) { alert('トリッジ名称を入力してください'); return; }
  const memo = document.getElementById('tm-newDbMemo').value.trim();
  const type = document.getElementById('tm-newDbType')?.value || 'mixed';
  const id = genId();
  const db = { id, name, type, memo, rowCount: 0, updatedAt: new Date().toISOString() };
  tmDbList.push(db);
  tmSaveDbList(tmDbList);
  tmSaveDbData(id, []);
  tmSaveKoshuData(id, []);
  tmSaveSettingsData(id, tmDefaultSettings());
  tmSaveKeywordsData(id, []);
  tmSaveBunruiData(id, { rows: [], keywords: [] });
  tmCloseCreateModal();
  tmSelectDb(id);
  showToast(`「${name}」を作成しました`);
}

// ===== RENAME MODAL =====
function tmShowRenameModal(id) {
  tmRenameTargetId = id;
  const db = tmDbList.find(d => d.id === id);
  if (!db) return;
  document.getElementById('tm-renameDbName').value = db.name;
  document.getElementById('tm-renameDbMemo').value = db.memo || '';
  document.getElementById('tm-renameModal').style.display = 'flex';
  setTimeout(() => document.getElementById('tm-renameDbName').focus(), 100);
}

function tmCloseRenameModal() {
  document.getElementById('tm-renameModal').style.display = 'none';
  tmRenameTargetId = null;
}

function tmConfirmRenameDb() {
  const name = document.getElementById('tm-renameDbName').value.trim();
  if (!name) { alert('トリッジ名称を入力してください'); return; }
  const db = tmDbList.find(d => d.id === tmRenameTargetId);
  if (!db) return;
  db.name = name;
  db.memo = document.getElementById('tm-renameDbMemo').value.trim();
  tmSaveDbList(tmDbList);
  tmCloseRenameModal();
  tmRenderSidebar();
  if (tmCurrentDbId === db.id) {
    const el = document.getElementById('tm-currentDbName');
    if (el) el.textContent = db.name;
  }
  showToast('トリッジ名称を変更しました');
}

// ===== DELETE MODAL =====
function tmShowDeleteModal(id) {
  tmDeleteTargetId = id;
  const db = tmDbList.find(d => d.id === id);
  if (!db) return;
  document.getElementById('tm-deleteModalMsg').textContent =
    `「${db.name}」（${db.rowCount}品目）を削除します。この操作は元に戻せません。`;
  document.getElementById('tm-deleteModal').style.display = 'flex';
}

function tmCloseDeleteModal() {
  document.getElementById('tm-deleteModal').style.display = 'none';
  tmDeleteTargetId = null;
}

function tmConfirmDeleteDb() {
  const id = tmDeleteTargetId;
  if (!id) return;
  tmDeleteDbData(id);
  tmDbList = tmDbList.filter(d => d.id !== id);
  tmSaveDbList(tmDbList);
  tmCloseDeleteModal();
  if (tmCurrentDbId === id) {
    tmCurrentDbId = null;
    tmCurrentRows = [];
    tmFilteredRows = [];
    tmCurrentKoshu = [];
    tmCurrentSettings = tmDefaultSettings();
    tmCurrentKeywords = [];
    tmCurrentBunrui = { rows: [], keywords: [] };
    tmIsDirty = false;
    tmUpdateToolbar();
    tmUpdateUnsavedBadge();
    tmUpdateCatFilterOptions();
    const tb = document.getElementById('tm-tableBody');
    const rc = document.getElementById('tm-rowCount');
    if (tb) tb.innerHTML = '';
    if (rc) rc.textContent = '';
  }
  tmRenderSidebar();
  showToast('トリッジを削除しました');
}

// ===== EXCEL EXPORT =====
function tmExportCurrentDb() {
  if (!tmCurrentDbId || !window.XLSX) return;
  tmAutoSave();

  const db   = tmDbList.find(d => d.id === tmCurrentDbId);
  const rows = tmCurrentRows;
  const wb   = XLSX.utils.book_new();

  // Sheet 1: 資材マスタ
  const sheetRows = [TM_EXCEL_HEADERS];
  rows.forEach(r => {
    const catName = TM_CAT_MAP[r.c] || r.c || '';
    sheetRows.push([
      r.n || '', r.s || '', r.u || '',
      r.ep !== '' ? parseFloat(r.ep) || 0 : '',
      r.cp !== '' ? parseFloat(r.cp) || 0 : '',
      r.r  !== '' ? parseFloat(r.r)  || 0 : '',
      r.b  !== '' ? parseFloat(r.b)  || 0 : '',
      catName, r.c || '',
      r.daiId || '', r.chuId || '', r.shoId || '', r.shoName || '',
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(sheetRows);
  ws1['!cols'] = [{wch:30},{wch:28},{wch:6},{wch:10},{wch:10},{wch:7},{wch:7},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8},{wch:24}];
  XLSX.utils.book_append_sheet(wb, ws1, '資材マスタ');

  // Sheet 2: カテゴリマスタ（MATERIAL_CATEGORIESから動的生成）
  const catRows = [['カテゴリID','カテゴリ名','キーワード']];
  MATERIAL_CATEGORIES.forEach(c => catRows.push([c.id, c.name, c.keywords.join('|')]));
  const wsCat = XLSX.utils.aoa_to_sheet(catRows);
  wsCat['!cols'] = [{wch:14},{wch:20},{wch:60}];
  XLSX.utils.book_append_sheet(wb, wsCat, 'カテゴリマスタ');

  // Sheet 3: 工種マスタ（データがある場合）
  if (tmCurrentKoshu.length > 0) {
    const koshuRows = [['工種ID','工種名','略称','割合モード','雑材料率%','順序','自動計算行']];
    tmCurrentKoshu.forEach(k => koshuRows.push([k.id,k.name,k.short,k.rateMode?'○':'',k.miscRate,k.order,k.autoRows||'']));
    const wsKoshu = XLSX.utils.aoa_to_sheet(koshuRows);
    wsKoshu['!cols'] = [{wch:12},{wch:24},{wch:16},{wch:10},{wch:10},{wch:6},{wch:40}];
    XLSX.utils.book_append_sheet(wb, wsKoshu, '工種マスタ');

    // 労務単価マスタ
    const s = tmCurrentSettings || tmDefaultSettings();
    const wsLabor = XLSX.utils.aoa_to_sheet([
      ['見積単価（円/人工）','原価単価（円/人工）'],
      [s.laborSell, s.laborCost],
    ]);
    XLSX.utils.book_append_sheet(wb, wsLabor, '労務単価マスタ');
  }

  // Sheet: キーワードマスタ（データがある場合）
  if (tmCurrentKeywords.length > 0) {
    const kwRows = [['キーワード','分類','歩掛','銅連動','天井開口']];
    tmCurrentKeywords.forEach(k => kwRows.push([k.keyword,k.laborType,k.bukariki,k.copperLinked?'○':'',k.ceilingOpening?'○':'']));
    const wsKw = XLSX.utils.aoa_to_sheet(kwRows);
    wsKw['!cols'] = [{wch:24},{wch:12},{wch:8},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, wsKw, 'キーワードマスタ');
  }

  // Sheet: 分類マスタ（データがある場合）
  if (tmCurrentBunrui.rows.length > 0) {
    const bunruiRows = [['大分類ID','大分類名','中分類ID','中分類名','小分類ID','小分類名','品目数']];
    tmCurrentBunrui.rows.forEach(r => bunruiRows.push([r.daiId||'',r.daiName||'',r.chuId||'',r.chuName||'',r.shoId||'',r.shoName||'',r.count||0]));
    const ws3 = XLSX.utils.aoa_to_sheet(bunruiRows);
    ws3['!cols'] = [{wch:8},{wch:14},{wch:8},{wch:24},{wch:8},{wch:32},{wch:6}];
    XLSX.utils.book_append_sheet(wb, ws3, '分類マスタ');
  }

  const filename = (db ? db.name : '資材Tridge') + '.xlsx';
  XLSX.writeFile(wb, filename);
  const extras = [];
  if (tmCurrentKoshu.length > 0) extras.push(`${tmCurrentKoshu.length}工種`);
  if (tmCurrentKeywords.length > 0) extras.push(`${tmCurrentKeywords.length}キーワード`);
  showToast(`「${filename}」をエクスポートしました（${rows.length}品目${extras.length ? ' / ' + extras.join(' / ') : ''}）`);
}

// ===== IMPORT =====
function tmImportExcelAsNewDb() {
  document.getElementById('tm-importFileInput').click();
}

function tmHandleImportFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !window.XLSX) return;
  if (/\.zip$/i.test(file.name)) { tmHandleZipImport(file); return; }

  const isCsv = /\.csv$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const wb = isCsv
        ? XLSX.read(e.target.result.replace(/^\uFEFF/,''), { type:'string', codepage:65001 })
        : XLSX.read(e.target.result, { type:'array' });

      // 資材マスタの読み込み（あれば）
      let rows = [], skipped = 0;
      if (wb.SheetNames.includes('資材マスタ')) {
        const data = XLSX.utils.sheet_to_json(wb.Sheets['資材マスタ']);
        if (data && data.length > 0) {
          const parsed = tmParseZaihoSheet(data);
          rows = parsed.rows;
          skipped = parsed.skipped;
        }
      }

      // 工種・キーワード・分類マスタ
      const { koshu, kw, bunrui } = tmParseAllSheets(wb.Sheets);

      // 列名マッチで取り込めた場合 → そのまま保存
      if (rows.length > 0) {
        const name = file.name.replace(/\.(xlsx?|csv)$/i, '');
        tmSaveImportedTridge(name, `インポート (${rows.length}品目)`, rows, skipped, [], { v2:[], v3:[] }, [], tmDefaultSettings());
        return;
      }

      // 列名マッチで0件 → AIフォールバック
      showToast('列名が一致しないためAI解析を開始します...');
      await _tmAiParseExcel(wb, file.name);
    } catch(err) {
      alert('読み込みエラー: ' + err.message);
      console.error(err);
    }
  };
  if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

async function tmHandleZipImport(file) {
  if (!window.JSZip) { alert('JSZipが読み込まれていません。ページを再読み込みしてください。'); return; }
  try {
    showToast('ZIPを読み込み中...');
    const zip = await JSZip.loadAsync(file.arrayBuffer());
    const sheets = {};
    const entries = Object.entries(zip.files).filter(([,e]) => !e.dir && /\.csv$/i.test(e.name));
    for (const [path, entry] of entries) {
      const text = (await entry.async('text')).replace(/^\uFEFF/,'');
      const sn = path.replace(/.*\//,'').replace(/\.csv$/i,'');
      const wb = XLSX.read(text, { type:'string', codepage:65001 });
      sheets[sn] = wb.Sheets[wb.SheetNames[0]];
    }
    if (!sheets['資材マスタ']) { alert('ZIPに「資材マスタ.csv」が見つかりません。'); return; }

    const { rows, skipped } = tmParseZaihoSheet(XLSX.utils.sheet_to_json(sheets['資材マスタ']));
    if (rows.length === 0) { alert('資材マスタに取り込める品目がありませんでした。'); return; }

    const { koshu, kw, bunrui } = tmParseAllSheets(sheets);

    const name = file.name.replace(/\.zip$/i,'');
    tmSaveImportedTridge(name, `ZIPインポート (${rows.length}品目)`, rows, skipped, koshu, kw, bunrui, tmDefaultSettings());
  } catch(err) {
    alert('ZIPインポートエラー: ' + err.message);
    console.error(err);
  }
}

/** 工種・キーワード・分類マスタをシートオブジェクトから一括パース（2箇所の重複を統合） */
function tmParseAllSheets(sheets) {
  const sh = sn => sheets[sn] ? XLSX.utils.sheet_to_json(sheets[sn]) : null;
  return {
    koshu:  sh('工種マスタ')     ? tmParseKoshuSheet(sh('工種マスタ'))        : [],
    kw:     sh('キーワードマスタ') ? tmParseKeywordsSheet(sh('キーワードマスタ')) : { v2:[], v3:[] },
    bunrui: sh('分類マスタ')     ? tmParseBunruiSheet(sh('分類マスタ'))       : [],
  };
}

function tmParseZaihoSheet(data) {
  const rows = [];
  let skipped = 0;
  for (const row of data) {
    const hinmei = String(getCol(row,'品目名称','品名','名称','材料名','品目')||'').trim();
    if (!hinmei) { skipped++; continue; }
    const kikaku  = String(getCol(row,'規格名称','規格','仕様','型番','規格・型番')||'').trim();
    const unit    = String(getCol(row,'単位')||'').trim();
    const ep      = parseFloat(getCol(row,'基準単価','単価','見積単価','仕切単価','仕切価格','定価')||0);
    const cp      = parseFloat(getCol(row,'原価単価','原価')||0);
    const rRaw    = parseFloat(getCol(row,'原価率')||0);
    const r       = rRaw > 1 ? rRaw / 100 : rRaw;
    const buk     = parseFloat(getCol(row,'歩掛1','歩掛','人工','取付人工')||0);
    const chuName = String(getCol(row,'中分類名','分類名','分類')||'').trim();
    const catRaw  = String(getCol(row,'カテゴリ','カテゴリID')||'').trim();
    rows.push({
      id: genId(), n: hinmei, s: kikaku, u: unit,
      ep: ep||'', cp: cp||'', r: r||'', b: buk||'',
      c: catRaw || tmDetectCategory(hinmei, kikaku, chuName),
      daiId: String(getCol(row,'大分類ID')||'').trim(),
      chuId: String(getCol(row,'中分類ID')||'').trim(),
      shoId: String(getCol(row,'小分類ID')||'').trim(),
      shoName: String(getCol(row,'小分類名')||'').trim(),
    });
  }
  return { rows, skipped };
}

function tmParseKoshuSheet(data) {
  return data.map(r => ({
    id:       String(getCol(r,'工種ID')||'').trim(),
    name:     String(getCol(r,'工種名')||'').trim(),
    short:    String(getCol(r,'略称')||'').trim(),
    rateMode: tmYn(getCol(r,'割合モード')),
    miscRate: parseFloat(getCol(r,'雑材料率%','雑材料率')||0),
    order:    parseInt(getCol(r,'順序')||0),
    autoRows: String(getCol(r,'自動計算行')||'').trim(),
  })).filter(k => k.id && k.name);
}

function tmParseKeywordsSheet(data) {
  if (data.length > 0 && getCol(data[0],'キーワードID') !== undefined) {
    return { v2:[], v3: data.map(r => ({
      kwId:    String(getCol(r,'キーワードID')||'').trim(),
      keyword: String(getCol(r,'キーワード')||'').trim(),
      type:    String(getCol(r,'種別')||'').trim(),
      daiId:   String(getCol(r,'大分類ID')||'').trim(),
      daiName: String(getCol(r,'大分類名')||'').trim(),
      chuId:   String(getCol(r,'中分類ID')||'').trim(),
      chuName: String(getCol(r,'中分類名')||'').trim(),
      shoId:   String(getCol(r,'小分類ID')||'').trim(),
    })).filter(k => k.keyword) };
  }
  return {
    v2: data.map(r => ({
      keyword:        String(getCol(r,'キーワード')||'').trim(),
      laborType:      String(getCol(r,'分類','労務分類')||'fixture').trim(),
      bukariki:       parseFloat(getCol(r,'歩掛','歩掛値')||0),
      copperLinked:   tmYn(getCol(r,'銅連動','銅連動フラグ')),
      ceilingOpening: tmYn(getCol(r,'天井開口','天井開口フラグ')),
    })).filter(k => k.keyword),
    v3: [],
  };
}

function tmParseBunruiSheet(data) {
  return data.map(r => ({
    daiId:   String(getCol(r,'大分類ID')||'').trim(),
    daiName: String(getCol(r,'大分類名')||'').trim(),
    chuId:   String(getCol(r,'中分類ID')||'').trim(),
    chuName: String(getCol(r,'中分類名')||'').trim(),
    shoId:   String(getCol(r,'小分類ID')||'').trim(),
    shoName: String(getCol(r,'小分類名')||'').trim(),
    count:   parseInt(getCol(r,'品目数')||0),
  })).filter(r => r.shoId);
}

function tmSaveImportedTridge(name, memo, rows, skipped, koshu, kw, bunruiRows, settings, overrideType) {
  // 同名トリッジの重複チェック
  const existing = tmDbList.find(d => d.name === name);
  let id;
  if (existing) {
    const choice = confirm(`「${name}」は既に存在します。\nOK: 上書き更新 / キャンセル: 取込中止`);
    if (!choice) return;
    id = existing.id;
    // 既存データを上書き
    existing.memo = memo;
    existing.rowCount = rows.length;
    existing.updatedAt = new Date().toISOString();
  } else {
    id = genId();
  }
  // type 自動判定: 資材あり+工種あり→mixed、資材のみ→zairyo、工種のみ→koshu
  const type = overrideType || (rows.length > 0 && koshu.length > 0 ? 'mixed'
    : rows.length > 0 ? 'zairyo'
    : koshu.length > 0 ? 'koshu' : 'mixed');
  if (!existing) {
    tmDbList.push({ id, name, type, memo, rowCount: rows.length, updatedAt: new Date().toISOString() });
  } else {
    existing.type = type;
  }
  tmSaveDbList(tmDbList);
  tmSaveDbData(id, rows);
  tmSaveKoshuData(id, koshu);
  tmSaveSettingsData(id, settings);
  tmSaveKeywordsData(id, kw.v2);
  tmSaveBunruiData(id, { rows: bunruiRows, keywords: kw.v3 });
  tmSelectDb(id);
  const parts = [`${rows.length}品目`];
  if (koshu.length > 0)      parts.push(`${koshu.length}工種`);
  if (kw.v2.length > 0)      parts.push(`${kw.v2.length}キーワード`);
  if (bunruiRows.length > 0) parts.push(`分類${bunruiRows.length}件`);
  showToast(`「${name}」をインポートしました（${parts.join(' / ')}、${skipped}件スキップ）`);
}

// ===== INTEGRATION: Tridgeとして適用 =====

// 後方互換: 旧「Deckに適用」ボタン（type に応じて自動振り分け）
function tmLoadToEstimate() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  const db = tmDbList.find(d => d.id === tmCurrentDbId);
  if (!db) return;
  tmAutoSave();

  const type = db.type || 'mixed';
  const msgs = [];

  if (type === 'koshu' || type === 'mixed') {
    msgs.push(_tmApplyKoshu(db));
  }
  if (type === 'zairyo' || type === 'mixed' || type === 'supplier') {
    msgs.push(_tmApplyZairyo(db));
  }

  _tmRenderAppliedBadges();
  showToast(msgs.filter(Boolean).join(' / '));
  if (typeof navigate === 'function') navigate('project');
}

// 工種として適用
function tmApplyAsKoshu() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  const db = tmDbList.find(d => d.id === tmCurrentDbId);
  if (!db) return;
  tmAutoSave();
  const msg = _tmApplyKoshu(db);
  _tmRenderAppliedBadges();
  showToast(msg || '工種データがありません');
}

// 資材として適用
function tmApplyAsZairyo() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  const db = tmDbList.find(d => d.id === tmCurrentDbId);
  if (!db) return;
  tmAutoSave();
  const msg = _tmApplyZairyo(db);
  _tmRenderAppliedBadges();
  showToast(msg || '資材データがありません');
}

// --- 内部: 工種データの適用 ---
function _tmApplyKoshu(db) {
  if (tmCurrentKoshu.length === 0) return '';

  const cats = tmCurrentKoshu.map(k => ({
    id: k.id, name: k.name, short: k.short,
    rateMode: k.rateMode, ratePct: 0, rateIncludeLabor: false,
    miscRate: (parseFloat(k.miscRate) || 5) / 100,
    order: k.order,
    autoRows: k.autoRows ? k.autoRows.split('|').filter(Boolean) : [],
  }));
  if (typeof applyTridgeCategories === 'function') applyTridgeCategories(cats);
  koshuTridgeLoaded = true;
  if (typeof updateKoshuBadge === 'function') updateKoshuBadge();

  // キーワードマスタ
  if (typeof TRIDGE_KEYWORDS !== 'undefined' && Array.isArray(TRIDGE_KEYWORDS)) {
    TRIDGE_KEYWORDS.length = 0;
    tmCurrentKeywords.forEach(k => TRIDGE_KEYWORDS.push(k));
  }

  // 労務単価
  const s = tmCurrentSettings || tmDefaultSettings();
  if (s.laborSell > 0) {
    setLaborRates(s.laborSell, s.laborCost);
  }
  if (typeof syncLaborSettingsToForm === 'function') syncLaborSettingsToForm();

  TRIDGE_APPLIED.koshu = { tridgeId: db.id, tridgeName: db.name };
  return `工種: ${tmCurrentKoshu.length}工種`;
}

// --- 内部: 資材データの適用（マージ方式: 同名品目は後から適用したもので上書き） ---
function _tmApplyZairyo(db) {
  const rows = tmCurrentRows;
  const seen = new Set();
  let added = 0;

  rows.forEach(r => {
    if (!r.n) return;
    const ep = parseFloat(r.ep) || 0;
    const cp = parseFloat(r.cp) || (ep > 0 ? Math.round(ep * 0.75) : 0);
    const rat = (ep > 0 && cp > 0) ? Math.round(cp / ep * 100) / 100 : 0.75;

    // 既存品目（品名+規格が同じ）があれば上書き
    const existIdx = MATERIAL_DB.findIndex(m => m.n === r.n && m.s === r.s);
    if (existIdx >= 0) MATERIAL_DB.splice(existIdx, 1);

    MATERIAL_DB.push({
      n: r.n, s: r.s, u: r.u, c: r.c,
      ep: ep || cp, cp, r: rat, a: 1,
      daiId: r.daiId||'', chuId: r.chuId||'', shoId: r.shoId||'', shoName: r.shoName||'',
    });
    added++;

    const b = parseFloat(r.b) || 0;
    if (b > 0) {
      const key = r.n + '|' + r.s;
      if (!seen.has(key)) {
        // 歩掛も既存を上書き
        const bukIdx = BUKARIKI_DB.findIndex(bk => bk.n === r.n && bk.s === r.s);
        if (bukIdx >= 0) BUKARIKI_DB.splice(bukIdx, 1);
        BUKARIKI_DB.push({ n: r.n, s: r.s, u: r.u, b, c: r.c });
        seen.add(key);
      }
    }
  });

  if (added === 0) return '資材データがありません（品名のある行が0件です）';

  zairyoTridgeLoaded = true;
  if (typeof updateZairyoBadge === 'function') updateZairyoBadge();
  if (typeof initCatFilter === 'function') initCatFilter();

  // 適用スロットに追加（重複チェック）
  if (!TRIDGE_APPLIED.zairyo.find(s => s.tridgeId === db.id)) {
    TRIDGE_APPLIED.zairyo.push({ tridgeId: db.id, tridgeName: db.name, itemCount: added });
  }
  return `資材: ${added}品目を適用`;
}

// --- イジェクト ---

/** 特定の資材トリッジを取り外してMATERIAL_DBを再構築 */
function tmEjectZairyoById(tridgeId) {
  const idx = TRIDGE_APPLIED.zairyo.findIndex(s => s.tridgeId === tridgeId);
  if (idx < 0) return;
  TRIDGE_APPLIED.zairyo.splice(idx, 1);
  _tmRebuildMaterialDB();
  _tmRenderAppliedBadges();
  showToast('資材トリッジを取り外しました');
}

function tmEjectKoshu() {
  if (!TRIDGE_APPLIED.koshu) return;
  TRIDGE_APPLIED.koshu = null;
  koshuTridgeLoaded = false;
  activeCategories = [];
  localStorage.removeItem('activeCategories');
  if (typeof updateKoshuBadge === 'function') updateKoshuBadge();
  if (typeof renderCatTabs === 'function') renderCatTabs();
  _tmRenderAppliedBadges();
  showToast('工種Tridgeを取り外しました');
}

/** 全資材トリッジを取り外し */
function tmEjectZairyo() {
  TRIDGE_APPLIED.zairyo = [];
  MATERIAL_DB.length = 0;
  BUKARIKI_DB.length = 0;
  zairyoTridgeLoaded = false;
  if (typeof updateZairyoBadge === 'function') updateZairyoBadge();
  if (typeof initCatFilter === 'function') initCatFilter();
  _tmRenderAppliedBadges();
  showToast('全ての資材トリッジを取り外しました');
}

/** 適用中の全資材トリッジからMATERIAL_DB/BUKARIKI_DBを再構築 */
function _tmRebuildMaterialDB() {
  MATERIAL_DB.length = 0;
  BUKARIKI_DB.length = 0;
  TRIDGE_APPLIED.zairyo.forEach(slot => {
    const rows = tmLoadDbData(slot.tridgeId);
    const seen = new Set();
    rows.forEach(r => {
      if (!r.n) return;
      const ep = parseFloat(r.ep) || 0;
      const cp = parseFloat(r.cp) || (ep > 0 ? Math.round(ep * 0.75) : 0);
      const rat = (ep > 0 && cp > 0) ? Math.round(cp / ep * 100) / 100 : 0.75;
      const existIdx = MATERIAL_DB.findIndex(m => m.n === r.n && m.s === r.s);
      if (existIdx >= 0) MATERIAL_DB.splice(existIdx, 1);
      MATERIAL_DB.push({ n: r.n, s: r.s, u: r.u, c: r.c, ep: ep || cp, cp, r: rat, a: 1,
        daiId: r.daiId||'', chuId: r.chuId||'', shoId: r.shoId||'', shoName: r.shoName||'' });
      const b = parseFloat(r.b) || 0;
      const key = r.n + '|' + r.s;
      if (b > 0 && !seen.has(key)) {
        const bukIdx = BUKARIKI_DB.findIndex(bk => bk.n === r.n && bk.s === r.s);
        if (bukIdx >= 0) BUKARIKI_DB.splice(bukIdx, 1);
        BUKARIKI_DB.push({ n: r.n, s: r.s, u: r.u, b, c: r.c });
        seen.add(key);
      }
    });
  });
  zairyoTridgeLoaded = MATERIAL_DB.length > 0;
  if (typeof updateZairyoBadge === 'function') updateZairyoBadge();
}

// --- 適用中バッジの表示 ---
function _tmRenderAppliedBadges() {
  const el = document.getElementById('tm-appliedBadges');
  if (!el) return;
  let html = '';
  if (TRIDGE_APPLIED.koshu) {
    html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#dcfce7;border-radius:6px;font-size:11px;">
      <span style="font-weight:600;color:#16a34a;">工種:</span>
      <span>${esc(TRIDGE_APPLIED.koshu.tridgeName)}</span>
      <button onclick="tmEjectKoshu()" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:12px;padding:0 2px;" title="取り外す">✕</button>
    </div>`;
  }
  TRIDGE_APPLIED.zairyo.forEach(s => {
    html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#dbeafe;border-radius:6px;font-size:11px;">
      <span style="font-weight:600;color:#2563eb;">資材:</span>
      <span>${esc(s.tridgeName)}(${s.itemCount}品目)</span>
      <button onclick="tmEjectZairyoById('${s.tridgeId}')" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:12px;padding:0 2px;" title="取り外す">✕</button>
    </div>`;
  });
  el.innerHTML = html || '<div style="font-size:11px;color:#94a3b8;padding:4px;">適用中のTridgeはありません</div>';
}

// （仕入れ取込機能はExcel取込に統合済み）
// ===== Excel取込のAIフォールバック =====

/** 列名マッチで取り込めなかったExcelをAIで解析して資材トリッジに変換 */
async function _tmAiParseExcel(wb, filename) {
  if (typeof callClaude !== 'function') {
    alert('AI解析にはAPIキーの設定が必要です。サイドバー下部の「AI設定」からAPIキーを入力してください。');
    return;
  }

  _showAiLoadingOverlay();
  try {
    // 全シートをCSVテキスト化
    let csvText = '';
    wb.SheetNames.forEach(sheetName => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      csvText += `\n[シート: ${sheetName}]\n`;
      rows.slice(0, 150).forEach(row => {
        const line = row.map(c => String(c).replace(/\r\n|\n/g, '/')).join('\t');
        if (line.trim()) csvText += line + '\n';
      });
    });

    const prompt = _tmBuildExcelParsePrompt(csvText, filename);
    const responseText = await callClaude(prompt, 8192);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIの回答からJSONを取り出せませんでした');
    const result = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(result.items) || result.items.length === 0) {
      throw new Error('品目が検出できませんでした。ファイルの内容を確認してください。');
    }

    // Tridge行に変換
    const rows = result.items.map(item => {
      const name = String(item.name || '').trim();
      const spec = String(item.spec || item.partNo || '').trim();
      if (!name) return null;

      const buk = typeof resolveBukariki === 'function'
        ? resolveBukariki(name, spec, '').value : 0;
      const catId = tmDetectCategory(name, spec, '');

      return {
        id: genId(), n: name, s: spec,
        u: item.unit || '式',
        ep: parseFloat(item.price) || parseFloat(item.listPrice) || 0,
        cp: parseFloat(item.costPrice) || 0,
        r: 0.75, b: buk, c: catId,
        daiId: '', chuId: '', shoId: '', shoName: '',
      };
    }).filter(Boolean);

    if (rows.length === 0) throw new Error('変換可能な品目がありませんでした');

    const tridgeName = filename.replace(/\.(xlsx?|csv)$/i, '');
    tmSaveImportedTridge(tridgeName, `AI解析 (${rows.length}品目)`, rows, 0, [], { v2:[], v3:[] }, [], tmDefaultSettings());
    showToast(`AI解析完了: 「${tridgeName}」${rows.length}品目を取り込みました`);

  } catch(e) {
    alert('AI解析エラー: ' + e.message);
    console.error(e);
  } finally {
    _hideAiLoadingOverlay();
  }
}

function _tmBuildExcelParsePrompt(csvText, filename) {
  return `あなたは電気工事会社の積算担当者です。以下のExcelデータから資材・機器の品目情報を抽出してJSONで返してください。

ファイル名: ${filename}

【Excelデータ（タブ区切り）】
${csvText}

以下のJSON形式のみで回答してください（前後の説明文不要）:
{
  "items": [
    {
      "name": "品目名称（商品名）",
      "spec": "規格・型番・仕様",
      "qty": 数量の数値（不明なら1）,
      "unit": "単位（m/個/台/巻/式等）",
      "price": 単価の数値（定価またはメーカー希望小売価格。不明なら0）,
      "costPrice": 原価・仕入れ単価の数値（不明なら0）
    }
  ]
}

【注意事項】
- 合計行・小計行・空行・ヘッダ行は除外すること
- 数値はカンマなしの整数（文字列不可）
- 品名と型番は分離すること（品名に型番を含めない）
- 定価が「オープン」「OP」「―」の場合は price=0
- 単位が不明の場合は「式」
- できるだけ多くの品目を抽出すること（ヘッダや説明行以外は全て対象）`;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    tmCloseCreateModal();
    tmCloseRenameModal();
    tmCloseDeleteModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && tmCurrentDbId) {
    const panel = document.getElementById('panel-tridge');
    if (panel && panel.classList.contains('active')) {
      e.preventDefault();
      tmAutoSave();
      showToast('保存しました');
    }
  }
});
