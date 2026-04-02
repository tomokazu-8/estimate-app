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
function tmSaveDbList(list)        { localStorage.setItem(TM_LS_LIST, JSON.stringify(list)); }
function tmLoadDbData(id)          { return tmLoadLocal(TM_LS_DATA     + id, []); }
function tmSaveDbData(id, rows)    { localStorage.setItem(TM_LS_DATA     + id, JSON.stringify(rows)); }
function tmLoadKoshuData(id)       { return tmLoadLocal(TM_LS_KOSHU    + id, []); }
function tmSaveKoshuData(id, rows) { localStorage.setItem(TM_LS_KOSHU    + id, JSON.stringify(rows)); }
function tmLoadSettingsData(id)    { return tmLoadLocal(TM_LS_SETTINGS + id, null); }
function tmSaveSettingsData(id, s) { localStorage.setItem(TM_LS_SETTINGS + id, JSON.stringify(s)); }
function tmLoadKeywordsData(id)    { return tmLoadLocal(TM_LS_KEYWORDS + id, []); }
function tmSaveKeywordsData(id, r) { localStorage.setItem(TM_LS_KEYWORDS + id, JSON.stringify(r)); }
function tmLoadBunruiData(id)      { return tmLoadLocal(TM_LS_BUNRUI   + id, { rows: [], keywords: [] }); }
function tmSaveBunruiData(id, d)   { localStorage.setItem(TM_LS_BUNRUI   + id, JSON.stringify(d)); }
function tmDeleteDbData(id) {
  [TM_LS_DATA, TM_LS_KOSHU, TM_LS_SETTINGS, TM_LS_KEYWORDS, TM_LS_BUNRUI].forEach(k => localStorage.removeItem(k + id));
}

// ===== CONSTANTS =====
const TM_DEFAULT_CATEGORIES = [
  { id: 'C001', label: '電線管・ダクト' },
  { id: 'C002', label: '電線・ケーブル' },
  { id: 'C003', label: '配線器具' },
  { id: 'C004', label: '分電盤・制御盤' },
  { id: 'C005', label: '火災報知設備' },
  { id: 'C006', label: '接地・避雷' },
  { id: 'C007', label: '副材・消耗品' },
  { id: 'C008', label: '照明・その他' },
];
let TM_CATEGORIES = [...TM_DEFAULT_CATEGORIES];
let TM_CAT_MAP = Object.fromEntries(TM_CATEGORIES.map(c => [c.id, c.label]));

function tmRebuildCatMap() {
  TM_CAT_MAP = Object.fromEntries(TM_CATEGORIES.map(c => [c.id, c.label]));
}

const TM_EXCEL_HEADERS = ['品目名称','規格名称','単位','基準単価','原価単価','原価率','歩掛1','中分類名','カテゴリ','大分類ID','中分類ID','小分類ID','小分類名'];

const TM_ENG_TO_CAT = {
  conduit:     { id: 'C001', name: '電線管・ダクト' },
  cable:       { id: 'C002', name: '電線・ケーブル' },
  device:      { id: 'C003', name: '配線器具' },
  panel:       { id: 'C004', name: '分電盤・制御盤' },
  fire:        { id: 'C005', name: '火災報知設備' },
  ground:      { id: 'C006', name: '接地・避雷' },
  accessories: { id: 'C007', name: '副材・消耗品' },
  fixture:     { id: 'C008', name: '照明・その他' },
  box:         { id: 'C001', name: '電線管・ダクト' },
  dimmer:      { id: 'C008', name: '照明・その他' },
};

const TM_STANDARD_CATEGORY_MASTER = [
  ['カテゴリID','カテゴリ名','英語キー','自動判定キーワード','備考'],
  ['C001','電線管・ダクト',   'conduit',     '電線管|PF管|VE管|FEP管|ねじなし管|プルボックス|ダクト|ボックス','管路材・収納'],
  ['C002','電線・ケーブル',   'cable',       '電線|ケーブル|CV|CVT|VVF|VVR|IV線|CPEV|同軸|UTP|AE線|光ファイバ','導体・線材'],
  ['C003','配線器具',         'device',      'コンセント|スイッチ|プレート|配線器具','壁面器具・プレート類'],
  ['C004','分電盤・制御盤',   'panel',       '分電盤|開閉器|制御盤|配電盤','盤類'],
  ['C005','火災報知設備',     'fire',        '感知器|発信機|受信機|音響|自火報|火災報知|火災警報','自火報・警報設備'],
  ['C006','接地・避雷',       'ground',      '接地|アース|避雷','接地工事材'],
  ['C007','副材・消耗品',     'accessories', 'サドル|バインド|コネクタ|ブッシング|テープ|キャップ|副材|消耗品','小物・固定材'],
  ['C008','照明・その他',     'fixture',     '（上記以外すべて）','デフォルトカテゴリ'],
];

// ===== STATE =====
let tmDbList = [];
let tmCurrentDbId = null;
let tmCurrentRows = [];
let tmFilteredRows = [];
let tmIsDirty = false;
let tmCurrentKoshu = [];
let tmCurrentSettings = null;
let tmCurrentKeywords = [];
let tmCurrentBunrui = { rows: [], keywords: [] };
let tmCurrentTab = 'material';
let tmRenameTargetId = null;
let tmDeleteTargetId = null;
let tm_bunruiFiltered = [];
let tmInitialized = false;

// ===== HELPERS =====
// esc() and genId() are shared globals from data.js
function tmDefaultSettings() {
  return { laborSell: 33000, laborCost: 12000 };
}
function tmDetectCategory(hinmei, kikaku, chuName) {
  const n = norm((hinmei || '') + ' ' + (kikaku || '') + ' ' + (chuName || ''));
  if (['電線管','pf-','ve ','fep','ねじなし','プルボックス','ダクト','ボックス'].some(k => n.includes(norm(k)))) return 'C001';
  if (['電線','ケーブル','cv ','cvt','vv-f','iv ','cpev','同軸','utp','ae ','toev','fcpev'].some(k => n.includes(norm(k)))) return 'C002';
  if (['コンセント','スイッチ','プレート','配線器具'].some(k => n.includes(norm(k)))) return 'C003';
  if (['分電盤','開閉器','制御盤'].some(k => n.includes(norm(k)))) return 'C004';
  if (['火災','感知','報知','自火報'].some(k => n.includes(norm(k)))) return 'C005';
  if (['接地','アース','避雷'].some(k => n.includes(norm(k)))) return 'C006';
  if (['サドル','バインド','テープ','キャップ','副材','消耗品'].some(k => n.includes(norm(k)))) return 'C007';
  return 'C008';
}
function tmNewRow() {
  return { id: genId(), n:'', s:'', u:'', ep:'', cp:'', r:'', b:'', c:'C008', daiId:'', chuId:'', shoId:'', shoName:'' };
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
    case 'zairyo':   return { text: '資材', style: 'background:#dbeafe;color:#2563eb;' };
    case 'supplier': return { text: '仕入', style: 'background:#fef3c7;color:#92400e;' };
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

// ===== TAB SWITCHING =====
function tmSwitchTab(tab) {
  tmCurrentTab = tab;
  document.querySelectorAll('.tm-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tm-tab-content').forEach(el => {
    el.classList.toggle('active', el.id === 'tm-tab-' + tab);
  });
  document.getElementById('tm-toolbarRight').style.display = tab === 'material' ? 'flex' : 'none';
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

  tmUpdateCategoriesFromKoshu();
  tmApplyFilter();
  tmRenderSidebar();
  tmUpdateToolbar();
  tmUpdateUnsavedBadge();
  tmRenderKoshuTable();
  tmRenderSettingsPanel();
  tmRenderKeywordTable();
  tmRenderBunruiPanel();
  tmUpdateCatFilterOptions();
}

function tmUpdateCategoriesFromKoshu() {
  if (tmCurrentKoshu.length > 0) {
    TM_CATEGORIES = tmCurrentKoshu.map(k => ({ id: k.id, label: k.name }));
  } else {
    TM_CATEGORIES = [...TM_DEFAULT_CATEGORIES];
  }
  tmRebuildCatMap();
}

function tmUpdateCatFilterOptions() {
  const sel = document.getElementById('tm-catFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="">全カテゴリ</option>' +
    TM_CATEGORIES.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
}

function tmUpdateToolbar() {
  const db = tmDbList.find(d => d.id === tmCurrentDbId);
  const nameEl = document.getElementById('tm-currentDbName');
  if (nameEl) nameEl.textContent = db ? db.name : 'トリッジを選択してください';
  const btnExport = document.getElementById('tm-btnExport');
  const btnApply  = document.getElementById('tm-btnApply');
  if (btnExport) btnExport.disabled = !tmCurrentDbId;
  if (btnApply)  btnApply.disabled  = !tmCurrentDbId;
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
          ${TM_CATEGORIES.map(c => `<option value="${c.id}" ${row.c === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
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

// ===== 工種マスタ =====
function tmRenderKoshuTable() {
  const tbody = document.getElementById('tm-koshuBody');
  const empty = document.getElementById('tm-koshuEmpty');
  if (!tbody) return;
  if (!tmCurrentDbId || tmCurrentKoshu.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  tbody.innerHTML = tmCurrentKoshu.map((k, idx) => `
    <tr>
      <td><input class="tm-cell-input num" type="number" min="1" value="${k.order}" style="width:44px;"
        onchange="tmOnKoshuChange(${idx},'order',this.value)"></td>
      <td><input class="tm-cell-input" value="${esc(k.id)}" placeholder="trunk"
        onchange="tmOnKoshuChange(${idx},'id',this.value)"></td>
      <td><input class="tm-cell-input" value="${esc(k.name)}" placeholder="幹線・分電盤工事"
        onchange="tmOnKoshuChange(${idx},'name',this.value)"></td>
      <td><input class="tm-cell-input" value="${esc(k.short)}" placeholder="幹線・分電盤"
        onchange="tmOnKoshuChange(${idx},'short',this.value)"></td>
      <td style="text-align:center;">
        <input type="checkbox" ${k.rateMode ? 'checked' : ''}
          onchange="tmOnKoshuChange(${idx},'rateMode',this.checked)">
      </td>
      <td><input class="tm-cell-input num" type="number" min="0" max="100" value="${k.miscRate}" style="width:60px;"
        onchange="tmOnKoshuChange(${idx},'miscRate',this.value)"></td>
      <td><input class="tm-cell-input" value="${esc(k.autoRows || '')}" placeholder="雑材料消耗品|電工労務費|運搬費"
        onchange="tmOnKoshuChange(${idx},'autoRows',this.value)"></td>
      <td><button class="row-delete" title="削除" onclick="tmDeleteKoshuRow(${idx})">✕</button></td>
    </tr>
  `).join('');
}

function tmAddKoshuRow() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  const order = tmCurrentKoshu.length > 0 ? Math.max(...tmCurrentKoshu.map(k => k.order)) + 1 : 1;
  tmCurrentKoshu.push(tmNewKoshuRow(order));
  tmMarkDirty();
  tmRenderKoshuTable();
}

function tmDeleteKoshuRow(idx) {
  tmCurrentKoshu.splice(idx, 1);
  tmUpdateCategoriesFromKoshu();
  tmMarkDirty();
  tmRenderKoshuTable();
  tmUpdateCatFilterOptions();
  tmRenderTable();
}

function tmOnKoshuChange(idx, field, value) {
  if (field === 'order' || field === 'miscRate') {
    tmCurrentKoshu[idx][field] = parseFloat(value) || 0;
  } else {
    tmCurrentKoshu[idx][field] = value;
  }
  tmUpdateCategoriesFromKoshu();
  tmMarkDirty();
  if (field === 'id' || field === 'name') {
    tmUpdateCatFilterOptions();
    tmRenderTable();
  }
}

// ===== 設定マスタ（労務単価のみ）=====
function tmRenderSettingsPanel() {
  if (!tmCurrentSettings) tmCurrentSettings = tmDefaultSettings();
  const sell = document.getElementById('tm-settLaborSell');
  const cost = document.getElementById('tm-settLaborCost');
  if (sell) sell.value = tmCurrentSettings.laborSell || 33000;
  if (cost) cost.value = tmCurrentSettings.laborCost || 12000;
}

function tmOnSettingsChange() {
  if (!tmCurrentDbId) return;
  tmCurrentSettings = {
    laborSell: parseFloat(document.getElementById('tm-settLaborSell').value) || 33000,
    laborCost: parseFloat(document.getElementById('tm-settLaborCost').value) || 12000,
  };
  tmMarkDirty();
}

// ===== キーワードマスタ =====
function tmRenderKeywordTable() {
  const tbody = document.getElementById('tm-keywordBody');
  const empty = document.getElementById('tm-keywordEmpty');
  if (!tbody) return;
  if (!tmCurrentDbId || tmCurrentKeywords.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  tbody.innerHTML = tmCurrentKeywords.map((k, idx) => `
    <tr>
      <td class="td-center" style="font-size:11px;color:var(--text-dim);">${idx + 1}</td>
      <td><input class="tm-cell-input" value="${esc(k.keyword)}" placeholder="ケーブル"
        onchange="tmOnKeywordChange(${idx},'keyword',this.value)"></td>
      <td>
        <select class="tm-cell-select" onchange="tmOnKeywordChange(${idx},'laborType',this.value)">
          <option value="wiring" ${k.laborType==='wiring'?'selected':''}>wiring</option>
          <option value="fixture" ${k.laborType==='fixture'?'selected':''}>fixture</option>
          <option value="equipment" ${k.laborType==='equipment'?'selected':''}>equipment</option>
        </select>
      </td>
      <td><input class="tm-cell-input num" type="number" step="0.001" min="0" value="${k.bukariki}" style="width:60px;"
        onchange="tmOnKeywordChange(${idx},'bukariki',this.value)"></td>
      <td style="text-align:center;">
        <input type="checkbox" ${k.copperLinked?'checked':''} onchange="tmOnKeywordChange(${idx},'copperLinked',this.checked)">
      </td>
      <td style="text-align:center;">
        <input type="checkbox" ${k.ceilingOpening?'checked':''} onchange="tmOnKeywordChange(${idx},'ceilingOpening',this.checked)">
      </td>
      <td><button class="row-delete" title="削除" onclick="tmDeleteKeywordRow(${idx})">✕</button></td>
    </tr>
  `).join('');
}

function tmAddKeywordRow() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  tmCurrentKeywords.push(tmNewKeywordRow());
  tmMarkDirty();
  tmRenderKeywordTable();
}

function tmDeleteKeywordRow(idx) {
  tmCurrentKeywords.splice(idx, 1);
  tmMarkDirty();
  tmRenderKeywordTable();
}

function tmOnKeywordChange(idx, field, value) {
  tmCurrentKeywords[idx][field] = field === 'bukariki' ? parseFloat(value) || 0 : value;
  tmMarkDirty();
}

// ===== 分類マスタ表示 =====
function tmRenderBunruiPanel() {
  const rows    = tmCurrentBunrui?.rows || [];
  const kwCount = tmCurrentBunrui?.keywords?.length || 0;
  const summary = document.getElementById('tm-bunruiSummary');
  const empty   = document.getElementById('tm-bunruiEmpty');
  const table   = document.getElementById('tm-bunruiTable');
  if (rows.length === 0) {
    if (summary) summary.textContent = '';
    if (empty) empty.style.display = 'block';
    if (table) table.style.display = 'none';
    return;
  }
  const daiSet = new Set(rows.map(r => r.daiId));
  const chuSet = new Set(rows.map(r => r.chuId));
  if (summary) summary.textContent = `大分類: ${daiSet.size}件 / 中分類: ${chuSet.size}件 / 小分類: ${rows.length}件 / キーワード: ${kwCount}件`;
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = '';
  tm_bunruiFiltered = rows;
  tmRenderBunruiTable(tm_bunruiFiltered);
}

function tmFilterBunrui() {
  const searchEl = document.getElementById('tm-bunruiSearch');
  const q = norm(searchEl ? searchEl.value : '').trim();
  const rows = tmCurrentBunrui?.rows || [];
  tm_bunruiFiltered = !q ? rows : rows.filter(r =>
    norm(r.chuName).includes(q) || norm(r.shoName).includes(q) || norm(r.daiName).includes(q)
  );
  tmRenderBunruiTable(tm_bunruiFiltered);
}

function tmRenderBunruiTable(rows) {
  const tbody = document.getElementById('tm-bunruiBody');
  if (!tbody) return;
  const display = rows.slice(0, 200);
  tbody.innerHTML = display.map(r => `
    <tr>
      <td style="font-size:11px;color:var(--text-sub);">${esc(r.daiId)}</td>
      <td style="font-size:11px;">${esc(r.daiName)}</td>
      <td style="font-size:11px;color:var(--text-sub);">${esc(r.chuId)}</td>
      <td style="font-size:11px;">${esc(r.chuName)}</td>
      <td style="font-size:11px;color:var(--text-sub);">${esc(r.shoId)}</td>
      <td style="font-size:11px;">${esc(r.shoName)}</td>
      <td style="font-size:11px;text-align:right;">${r.count || 0}</td>
    </tr>
  `).join('');
  if (rows.length > 200) {
    tbody.innerHTML += `<tr><td colspan="7" style="text-align:center;color:var(--text-sub);font-size:11px;">...他 ${rows.length - 200}件（検索で絞り込んでください）</td></tr>`;
  }
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
    TM_CATEGORIES = [...TM_DEFAULT_CATEGORIES];
    tmRebuildCatMap();
    tmUpdateToolbar();
    tmUpdateUnsavedBadge();
    tmUpdateCatFilterOptions();
    const tb = document.getElementById('tm-tableBody');
    const rc = document.getElementById('tm-rowCount');
    if (tb) tb.innerHTML = '';
    if (rc) rc.textContent = '';
    tmRenderKoshuTable();
    tmRenderSettingsPanel();
    tmRenderKeywordTable();
    tmRenderBunruiPanel();
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
    const catInfo = TM_ENG_TO_CAT[r.c] || { id: r.c || 'C008', name: TM_CAT_MAP[r.c] || '照明・その他' };
    sheetRows.push([
      r.n || '', r.s || '', r.u || '',
      r.ep !== '' ? parseFloat(r.ep) || 0 : '',
      r.cp !== '' ? parseFloat(r.cp) || 0 : '',
      r.r  !== '' ? parseFloat(r.r)  || 0 : '',
      r.b  !== '' ? parseFloat(r.b)  || 0 : '',
      catInfo.name, catInfo.id,
      r.daiId || '', r.chuId || '', r.shoId || '', r.shoName || '',
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(sheetRows);
  ws1['!cols'] = [{wch:30},{wch:28},{wch:6},{wch:10},{wch:10},{wch:7},{wch:7},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8},{wch:24}];
  XLSX.utils.book_append_sheet(wb, ws1, '資材マスタ');

  // Sheet 2: カテゴリマスタ
  const wsCat = XLSX.utils.aoa_to_sheet(TM_STANDARD_CATEGORY_MASTER);
  wsCat['!cols'] = [{wch:12},{wch:18},{wch:14},{wch:60},{wch:22}];
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
  reader.onload = function(e) {
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

      // 資材も工種もなければエラー
      if (rows.length === 0 && koshu.length === 0) {
        alert('取り込めるデータが見つかりませんでした。\n「資材マスタ」または「工種マスタ」シートが必要です。\n検出シート: ' + wb.SheetNames.join(', '));
        return;
      }

      // 設定（労務単価マスタ）
      let settings = tmDefaultSettings();
      const wsLabor = wb.Sheets['労務単価マスタ'] ? XLSX.utils.sheet_to_json(wb.Sheets['労務単価マスタ']) : null;
      if (wsLabor && wsLabor.length > 0) {
        const first = wsLabor[0];
        const sell = parseFloat(getCol(first,'見積単価（円/人工）','見積単価','売単価')||0);
        const cost = parseFloat(getCol(first,'原価単価（円/人工）','原価単価','原価')||0);
        if (sell > 0) { settings.laborSell = sell; settings.laborCost = cost; }
      }

      // 設定マスタ
      const wsSettei = wb.Sheets['設定マスタ'] ? XLSX.utils.sheet_to_json(wb.Sheets['設定マスタ']) : null;
      if (wsSettei) {
        wsSettei.forEach(r => {
          const pName = String(getCol(r, 'パラメーター名', 'パラメータ名') || '').trim();
          const pVal  = getCol(r, '値');
          if (pName === '労務売単価（円/人工）' && parseFloat(pVal) > 0) settings.laborSell = parseFloat(pVal);
          if (pName === '労務原価単価（円/人工）' && parseFloat(pVal) > 0) settings.laborCost = parseFloat(pVal);
        });
      }

      // 得意先マスタ
      const wsClients = wb.Sheets['得意先マスタ'] ? XLSX.utils.sheet_to_json(wb.Sheets['得意先マスタ']) : null;

      const name = file.name.replace(/\.(xlsx?|csv)$/i, '');
      const memo = rows.length > 0
        ? `インポート (${rows.length}品目)`
        : `インポート (${koshu.length}工種)`;
      tmSaveImportedTridge(name, memo, rows, skipped, koshu, kw, bunrui, settings);
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
  const id = genId();
  // type 自動判定: 資材あり+工種あり→mixed、資材のみ→zairyo、工種のみ→koshu
  const type = overrideType || (rows.length > 0 && koshu.length > 0 ? 'mixed'
    : rows.length > 0 ? 'zairyo'
    : koshu.length > 0 ? 'koshu' : 'mixed');
  tmDbList.push({ id, name, type, memo, rowCount: rows.length, updatedAt: new Date().toISOString() });
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
function tmLoadToEstimate() {
  if (!tmCurrentDbId) { showToast('先にトリッジを選択してください'); return; }
  tmAutoSave();

  const db = tmDbList.find(d => d.id === tmCurrentDbId);

  // === 資材マスタ → MATERIAL_DB + BUKARIKI_DB ===
  const newMaterials = [];
  const newBukariki  = [];
  const seen = new Set();

  tmCurrentRows.forEach(r => {
    const ep = parseFloat(r.ep) || 0;
    if (ep > 0) {
      const cp  = parseFloat(r.cp) > 0 ? parseFloat(r.cp) : Math.round(ep * 0.75);
      const rat = parseFloat(r.cp) > 0 ? Math.round(parseFloat(r.cp) / ep * 100) / 100 : 0.75;
      newMaterials.push({
        n: r.n, s: r.s, u: r.u, c: r.c,
        ep, cp, r: rat, a: 1,
        daiId: r.daiId||'', chuId: r.chuId||'', shoId: r.shoId||'', shoName: r.shoName||'',
      });
    }
    const b = parseFloat(r.b) || 0;
    if (b > 0) {
      const key = r.n + '|' + r.s;
      if (!seen.has(key)) {
        seen.add(key);
        newBukariki.push({ n: r.n, s: r.s, u: r.u, b, c: r.c });
      }
    }
  });

  MATERIAL_DB.length = 0;
  newMaterials.forEach(m => MATERIAL_DB.push(m));
  if (newBukariki.length > 0) {
    BUKARIKI_DB.length = 0;
    newBukariki.forEach(b => BUKARIKI_DB.push(b));
  }

  // === 分類マスタ → BUNRUI_DB ===
  BUNRUI_DB.rows     = [...(tmCurrentBunrui.rows || [])];
  BUNRUI_DB.keywords = [...(tmCurrentBunrui.keywords || [])];

  // === カテゴリマスタ → CATEGORY_MASTER ===
  CATEGORY_MASTER.length = 0;
  TM_STANDARD_CATEGORY_MASTER.slice(1).forEach(r => {
    const kwStr = r[3];
    const keywords = kwStr === '（上記以外すべて）' ? [] : kwStr.split('|').map(k => k.trim()).filter(Boolean);
    CATEGORY_MASTER.push({ catId: r[0], catName: r[1], engKey: r[2], keywords, isDefault: keywords.length === 0 });
  });

  // === 工種マスタ → activeCategories ===
  if (tmCurrentKoshu.length > 0) {
    const cats = tmCurrentKoshu.map(k => ({
      id: k.id, name: k.name, short: k.short,
      rateMode: k.rateMode, ratePct: 0, rateIncludeLabor: false,
      miscRate: (parseFloat(k.miscRate) || 5) / 100,
      order: k.order,
      autoRows: k.autoRows ? k.autoRows.split('|').filter(Boolean) : [],
    }));
    if (typeof applyTridgeCategories === 'function') applyTridgeCategories(cats);
    koshuTridgeLoaded = true;
    updateKoshuBadge();
  }

  // === キーワードマスタ → TRIDGE_KEYWORDS (labor.js用) ===
  if (typeof TRIDGE_KEYWORDS !== 'undefined' && Array.isArray(TRIDGE_KEYWORDS)) {
    TRIDGE_KEYWORDS.length = 0;
    tmCurrentKeywords.forEach(k => TRIDGE_KEYWORDS.push(k));
  }

  // === 労務単価 → LABOR_RATES ===
  const s = tmCurrentSettings || tmDefaultSettings();
  if (s.laborSell > 0) {
    LABOR_RATES.sell = s.laborSell;
    LABOR_RATES.cost = s.laborCost;
  }

  zairyoTridgeLoaded = true;
  updateZairyoBadge();
  if (typeof initCatFilter === 'function') initCatFilter();

  const count = newMaterials.length;
  showToast(`「${db ? db.name : 'Tridge'}」を適用しました（${count}品目）`);
  if (typeof navigate === 'function') navigate('project');
}

// ===== キーボードショートカット（Tridgeパネル用）=====
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
