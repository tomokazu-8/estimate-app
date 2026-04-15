// ===== 見積データベース =====
// DB are loaded from JSON files or Excel, these are defaults

// 全角/半角カナ・英数字を統一して比較するための正規化（NFKC: 半角カナ→全角、全角英数→半角）
function norm(s) { return (s || '').normalize('NFKC').toLowerCase(); }

let MATERIAL_DB = [];  // Loaded in init
let BUKARIKI_DB = [];  // Loaded in init
let BUNRUI_DB = { rows: [], keywords: [] };  // 分類マスタ（Tridgeから読み込み）
let LABOR_RATES = { sell: 19000, cost: 12000 };

// ===== 資材カテゴリマスタ（17分類） =====
// 順序が重要: 具体的なカテゴリを先に、汎用的なものを後ろに配置
const MATERIAL_CATEGORIES = [
  // --- 具体的（型番・専門用語で確実に判定できるもの）---
  { id: 'intercom',   name: 'インターホン',         keywords: ['インターホン','ドアホン','チャイム','呼出','テレビドアホン','vl-s'] },
  { id: 'camera',     name: '防犯カメラ',           keywords: ['防犯カメラ','監視カメラ','nvr','dvr','レコーダー','wv-','bb-s'] },
  { id: 'fire',       name: '火災報知設備',         keywords: ['感知器','発信機','火災','報知','自火報','受信機','総合盤','光警報','bgf','bvf'] },
  { id: 'intake',     name: '引込み部材',           keywords: ['引込','引留','引き込み','引込みポール','引込み金物','引込管','ウェザーキャップ','メーターボックス'] },
  { id: 'ground',     name: '接地・避雷',           keywords: ['接地','アース棒','アース板','避雷','接地棒','接地板','接地線','接地極'] },
  { id: 'equipment',  name: '電気機器',             keywords: ['エアコン','換気扇','給湯','ev充電','室外機','パワコン','太陽光','蓄電池','電気温水','ルームエアコン'] },
  // --- 型番パターンで判定できるもの ---
  { id: 'lighting',   name: '照明器具',             keywords: ['ダウンライト','ベースライト','シーリングライト','ブラケットライト','スポットライト','ペンダントライト','非常灯','誘導灯','nnf','nnl','nnfb','nny','lgb','xlx','xnd','od','lzd','ledユニット'] },
  { id: 'panel',      name: '分電盤・制御盤',       keywords: ['分電盤','開閉器','ブレーカ','elb','mccb','漏電遮断','制御盤','bq ','bqe','bqr','bqw'] },
  { id: 'device',     name: '配線器具',             keywords: ['コンセント','スイッチ','プレート','タンブラ','配線器具','モジュラジャック','情報コンセント','wn ','wt ','ws ','wtf','wnp'] },
  // --- 通信・情報（LANケーブルは cable-weak で先に判定）---
  { id: 'tel',        name: '通信・情報機器',       keywords: ['スイッチングハブ','ルーター','情報盤','mdf','idf','lan機器','光ファイバ','otb','opスロット','光成端'] },
  // --- 電線（具体的な型番で先に弱電・高圧を判定）---
  { id: 'cable-weak', name: '電線（弱電）',         keywords: ['utp','cat5','cat6','lan ','lanケーブル','同軸','cpev','ae線','ae ','fcpev','警報線','hpf','電話線','aev','ティース','tpcc'] },
  { id: 'cable-hv',   name: '電線（高圧）',         keywords: ['cvt','高圧ケーブル','6600v','6.6kv','cv 3c×22','cv 3c×38','cv 3c×60','cv 3c×100','cv 3c×150','cv 3c×200','cv 3c×250','cv 3c×325'] },
  { id: 'cable-lv',   name: '電線（低圧）',         keywords: ['vvf','vvr','cv ','cv-','cv線','iv線','iv ','hiv','em-ce','vct ','vctf','vsf','600v','ケーブル','電線'] },
  // --- 配管系（汎用キーワード「コネクタ」は除外、具体的な表現のみ）---
  { id: 'raceway',    name: 'ラック・レースウェイ',   keywords: ['ケーブルラック','レースウェイ','配線ダクト','ワイヤーラック','ラック用','ラック本体'] },
  { id: 'box',        name: 'ボックス',             keywords: ['プルボックス','アウトレットボックス','スイッチボックス','ジョイントボックス','丸型ボックス','八角ボックス'] },
  { id: 'conduit',    name: '配管',                 keywords: ['pf管','cd管','ve管','電線管','ねじなし','薄鋼','厚鋼','金属管','フレキシブル管','pf-s','pf-d','ノーマルベンド','管用サドル','管用コネクタ'] },
  // --- デフォルト（上記全てに該当しないもの）---
  { id: 'misc',       name: '副材・消耗品',         keywords: ['サドル','バインド線','ビニルテープ','ステップル','ブッシング','消耗品','ビス','ボルト','ナット','ワッシャ','インシュロック'] },
];

/** カテゴリID→名称マップ（検索UI・テーブル表示用） */
const CAT_LABELS = Object.fromEntries(MATERIAL_CATEGORIES.map(c => [c.id, c.name]));

/** カテゴリIDから品名+規格で判定する共通関数 */
function detectMaterialCategory(name, spec) {
  const n = norm((name || '') + ' ' + (spec || ''));
  for (const cat of MATERIAL_CATEGORIES) {
    if (cat.keywords.some(k => n.includes(norm(k)))) return cat.id;
  }
  return 'misc'; // デフォルト
}

// ===== 物件タイプ別 工種プリセット =====
const KOSHU_PRESETS = {
  '新築_住宅_木造':    ['trunk','power','outlet','lighting','tv','tel','intercom','fire','security'],
  '新築_住宅_S造':     ['trunk','power','outlet','lighting','tv','tel','intercom','fire','security'],
  '新築_住宅_RC造':    ['trunk','power','panel','outlet','lighting','tv','tel','intercom','fire','security'],
  '新築_事務所':       ['trunk','power','panel','outlet','lighting','tv','tel','intercom','fire','security','camera'],
  '新築_倉庫':         ['trunk','power','outlet','lighting','fire'],
  '新築_店舗':         ['trunk','power','outlet','lighting','tel','fire','security'],
  '新築_集合住宅':     ['trunk','power','panel','outlet','lighting','tv','tel','intercom','fire','security'],
  '改修_住宅':         ['outlet','lighting'],
  '改修_住宅_大規模':  ['trunk','outlet','lighting','demolish'],
  '改修_事務所':       ['trunk','outlet','lighting','tel','demolish'],
  '改修_倉庫':         ['trunk','outlet','lighting','demolish'],
};

// 工種IDと名称・略称のマスタ（プリセット用）
const KOSHU_MASTER = [
  { id: 'trunk',     name: '幹線・分電盤設備工事',       short: '幹線・分電盤',   miscRate: 0.05 },
  { id: 'power',     name: '幹線・動力設備工事',         short: '幹線・動力',     miscRate: 0.05 },
  { id: 'panel',     name: '分電盤設備工事',             short: '分電盤',         miscRate: 0.05 },
  { id: 'outlet',    name: '電灯コンセント設備工事',     short: '電灯コンセント', miscRate: 0.05 },
  { id: 'lighting',  name: '照明器具取付工事',           short: '照明器具',       miscRate: 0.03 },
  { id: 'tv',        name: 'テレビ共聴設備工事',         short: 'テレビ共聴',     miscRate: 0.05 },
  { id: 'tel',       name: '電話・情報設備工事',         short: '電話・情報',     miscRate: 0.05 },
  { id: 'intercom',  name: 'インターホン設備工事',       short: 'インターホン',   miscRate: 0.05 },
  { id: 'fire',      name: '住宅用火災警報設備工事',     short: '火災警報',       miscRate: 0.05 },
  { id: 'camera',    name: '防犯カメラ設備工事',         short: '防犯カメラ',     miscRate: 0.05 },
  { id: 'security',  name: 'セキュリティ設備工事',       short: 'セキュリティ',   miscRate: 0.05 },
  { id: 'demolish',  name: '既設撤去工事',               short: '撤去',           miscRate: 0.03 },
  { id: 'aircon',    name: 'エアコン設備工事',           short: 'エアコン',       miscRate: 0.05 },
  { id: 'solar',     name: '太陽光発電設備工事',         short: '太陽光',         miscRate: 0.05 },
  { id: 'ev',        name: 'EV充電設備工事',             short: 'EV充電',         miscRate: 0.05 },
];

/** 構造×新築/改修×用途からプリセットキーを生成 */
function _buildPresetKey(type, usage, struct) {
  if (type === '新築' && (usage === '住宅' || usage === '集合住宅')) {
    if (usage === '集合住宅') return '新築_集合住宅';
    return `新築_住宅_${struct || '木造'}`;
  }
  if (type === '新築') return `新築_${usage || '事務所'}`;
  if (type === '改修') {
    if (usage === '住宅') return '改修_住宅';
    return `改修_${usage || '事務所'}`;
  }
  return '';
}

/** プリセットキーから工種リストを生成 */
function getKoshuPreset(type, usage, struct) {
  const key = _buildPresetKey(type, usage, struct);
  const ids = KOSHU_PRESETS[key] || KOSHU_PRESETS['新築_住宅_木造'];
  return ids.map(id => KOSHU_MASTER.find(m => m.id === id)).filter(Boolean);
}

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

// ===== AUTO-CALC RULES =====
const AUTO_CALC = {
  transportBase: { small: 12000, medium: 55000, large: 80000, xlarge: 161000 },
  laborCostRatio: 0.72, // default
};

// 歩掛1/2/3 + 経費行の名称・有効フラグ デフォルト
const LABOR_ROW_DEFAULTS = {
  labor1: '電工労務費',
  labor2: '既設器具撤去処分費',
  labor3: '天井材開口費',
  misc:   '雑材料消耗品',
  transport: '運搬費',
  // 有効フラグ（工種ごとにON/OFF可能）
  enableLabor1: true,
  enableLabor2: true,
  enableLabor3: true,
  enableMisc: true,
  enableTransport: true,
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
  const names = new Set();
  // デフォルト名を追加（文字列のみ）
  Object.entries(LABOR_ROW_DEFAULTS).forEach(([k, v]) => {
    if (typeof v === 'string') names.add(v);
  });
  // 各工種のカスタム名を追加
  activeCategories.forEach(c => {
    if (c.laborNames) Object.entries(c.laborNames).forEach(([k, v]) => {
      if (typeof v === 'string') names.add(v);
    });
  });
  return names;
}

// ===== TRIDGE 適用状態 =====
let TRIDGE_APPLIED = {
  koshu:     null,  // { tridgeId, tridgeName } 工種スロット
  zairyo:    null,  // { tridgeId, tridgeName } 資材スロット
  suppliers: [],    // [{ tridgeId, tridgeName, itemCount }] 仕入れスロット（複数可）
};

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

// 指定工種の材料費小計（自動計算行を除く品目の amount 合計）
function calcMaterialTotal(catId) {
  return (items[catId] || [])
    .filter(i => !isAutoName(i.name))
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
}

// 労務費の見積金額を算出（人工数 × 売単価）
function calcLaborSell(kosu) {
  return Math.round(kosu * LABOR_RATES.sell);
}

// LABOR_RATES を安全に更新するセッター
function setLaborRates(sell, cost) {
  if (sell > 0) LABOR_RATES.sell = sell;
  if (cost > 0) LABOR_RATES.cost = cost;
  AUTO_CALC.laborCostRatio = (LABOR_RATES.sell > 0 && LABOR_RATES.cost > 0)
    ? LABOR_RATES.cost / LABOR_RATES.sell : 0.72;
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