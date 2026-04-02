// ===== 見積データベース =====
// DB are loaded from JSON files or Excel, these are defaults

// 全角/半角カナ・英数字を統一して比較するための正規化（NFKC: 半角カナ→全角、全角英数→半角）
function norm(s) { return (s || '').normalize('NFKC').toLowerCase(); }

let MATERIAL_DB = [];  // Loaded in init
let BUKARIKI_DB = [];  // Loaded in init
let BUNRUI_DB = { rows: [], keywords: [] };  // 分類マスタ（Tridgeから読み込み）
let LABOR_RATES = { sell: 19000, cost: 12000 };

// 自動計算行の名称リスト（labor.js / calc-engine.js / app.js で共有）
// 自動計算行の判定（LABOR_ROW_NAMESの現在値も含める）
function isAutoName(name) {
  const staticNames = [
    '雑材料消耗品', '電工労務費', '器具取付費', '器具取付け費', '器具取付け接続費',
    '埋込器具用天井材開口費', '天井材開口費', '天井及び壁材開口費', '運搬費', '機器取付費',
    '機器取付け及び試験調整費', 'UTPケーブル試験費', '既設器具撤去処分費',
  ];
  if (staticNames.includes(name)) return true;
  return _allLaborNames().has(name);
}
// 後方互換: 配列として参照される箇所向け
const AUTO_NAMES = new Proxy([], {
  get(target, prop) {
    if (prop === 'includes') return (name) => isAutoName(name);
    return target[prop];
  }
});

// 労務費・経費から自動算出され価格が固定される行（手動変更不可）
function isLaborLocked(name) {
  const staticNames = [
    '電工労務費', '器具取付費', '機器取付費',
    '機器取付け及び試験調整費', '埋込器具用天井材開口費',
    '既設器具撤去処分費', '天井及び壁材開口費',
  ];
  if (staticNames.includes(name)) return true;
  return _allLaborNames().has(name);
}
const LABOR_LOCKED_NAMES = new Proxy([], {
  get(target, prop) {
    if (prop === 'includes') return (name) => isLaborLocked(name);
    return target[prop];
  }
});

// ===== AUTO-CALC RULES =====
const AUTO_CALC = {
  transportBase: { small: 12000, medium: 55000, large: 80000, xlarge: 161000 },
  laborCostRatio: 0.72, // default
};

// 歩掛1/2/3 に対応する労務費行の名称デフォルト
const LABOR_ROW_DEFAULTS = {
  labor1: '電工労務費',
  labor2: '既設器具撤去処分費',
  labor3: '天井材開口費',
};

// 後方互換: グローバル LABOR_ROW_NAMES は currentCat の laborNames を返す動的プロキシ
const LABOR_ROW_NAMES = new Proxy({}, {
  get(_, prop) { return getLaborNames(currentCat)[prop]; },
  set(_, prop, val) { getLaborNames(currentCat)[prop] = val; return true; },
});

// 工種ごとの労務費名を取得（activeCategories に laborNames がなければデフォルト付与）
function getLaborNames(catId) {
  const cat = activeCategories.find(c => c.id === catId);
  if (!cat) return { ...LABOR_ROW_DEFAULTS };
  if (!cat.laborNames) cat.laborNames = { ...LABOR_ROW_DEFAULTS };
  return cat.laborNames;
}

// 全工種の laborNames を含めて isAutoName / isLaborLocked が正しく判定できるようにする
function _allLaborNames() {
  const names = new Set(Object.values(LABOR_ROW_DEFAULTS));
  activeCategories.forEach(c => {
    if (c.laborNames) Object.values(c.laborNames).forEach(n => names.add(n));
  });
  return names;
}

// ===== TRIDGE DATA (Tridge読み込み時に上書きされる) =====

// カテゴリマスタ（資材Tridgeから読み込む）
// { catId, catName, engKey, keywords: string[], isDefault: boolean }
let CATEGORY_MASTER = [];

// 得意先マスタ（工種Tridgeから読み込む）
// { clientId, edaban, clientName, zip, address, tel, email, personName, personTel, personEmail, personMemo }
let TRIDGE_CLIENTS = [];

// Tridge装着フラグ（2スロット）
let koshuTridgeLoaded = false;  // 工種Tridge（工種/労務/得意先）
let zairyoTridgeLoaded = false; // 資材Tridge（資材マスタ/カテゴリマスタ）

const UNITS = ['式','ｍ','台','個','面','箇所','本','枚','組','ｾｯﾄ','系統'];

// State
let project = {
  name:'', number:'', date: new Date().toISOString().split('T')[0], client:'',
  struct:'', usage:'', type:'', floors:'', areaSqm:'', areaTsubo:'',
  location:'', person:'八木橋　友和', laborRate:72, laborSell:33000, tax:10,
};

let items = {}; // { categoryId: [ {id, name, spec, qty, unit, price, amount, note} ] }
// items はTridge装着時・localStorage復元時に初期化される

let currentCat = ''; // Tridge装着時に最初の工種IDが設定される
let itemIdCounter = 1;

// 有効工種リスト（Tridgeから動的ロード、localStorageから復元）
let activeCategories = (function() {
  try {
    const saved = JSON.parse(localStorage.getItem('activeCategories'));
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map(c => ({
        ratePct: 0,
        rateIncludeLabor: false,
        rateMode: false,
        miscRate: 0.05,
        ...c,
      }));
    }
  } catch(e) {}
  return []; // Tridge未装着時は空
})();

let customCatCounter = parseInt(localStorage.getItem('customCatCounter') || '10', 10);

// ===== SHARED UTILITIES (used by app.js, tridge-manager.js, etc.) =====
// 品目オブジェクトの雛型を生成（全フィールドのデフォルト値を一元管理）
function createBlankItem(overrides) {
  return Object.assign({
    id: itemIdCounter++,
    name: '', spec: '', qty: '', unit: '式', price: '', amount: 0, note: '',
    bukariki1: '', bukariki2: '', bukariki3: '',
    listPrice: '', basePrice: '', costRate: '', sellRate: '',
  }, overrides);
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function normItemKey(name, spec) {
  const n = norm(name || '').trim();
  const s = norm(spec || '').replace(/<.*/, '').trim();
  return s ? `${n}|${s}` : n;
}