// ===== 見積データベース =====
// DB are loaded from JSON files or Excel, these are defaults

// 全角/半角カナ・英数字を統一して比較するための正規化（NFKC: 半角カナ→全角、全角英数→半角）
function norm(s) { return (s || '').normalize('NFKC').toLowerCase(); }

let MATERIAL_DB = [];  // Loaded in init
let BUKARIKI_DB = [];  // Loaded in init
let LABOR_RATES = { sell: 19000, cost: 12000 };

const CAT_RATIOS = {"accessories": 0.807, "box": 0.767, "cable": 0.721, "conduit": 0.756, "device": 0.728, "dimmer": 0.834, "fire": 0.802, "fixture": 0.77, "ground": 0.718, "panel": 0.761};

// 自動計算行の名称リスト（labor.js / calc-engine.js / app.js で共有）
const AUTO_NAMES = [
  '雑材料消耗品', '電工労務費', '器具取付費', '器具取付け費', '器具取付け接続費',
  '埋込器具用天井材開口費', '天井材開口費', '運搬費', '機器取付費',
  '機器取付け及び試験調整費', 'UTPケーブル試験費',
];

// 労務費・経費から自動算出され価格が固定される行（手動変更不可）
const LABOR_LOCKED_NAMES = [
  '電工労務費', '器具取付費', '機器取付費',
  '機器取付け及び試験調整費', '埋込器具用天井材開口費',
];

// ===== AUTO-CALC RULES =====
const AUTO_CALC = {
  transportBase: { small: 12000, medium: 55000, large: 80000, xlarge: 161000 },
  laborCostRatio: 0.72, // default
};

// ===== TRIDGE DATA (Tridge読み込み時に上書きされる) =====
let TRIDGE_SETTINGS = {
  copperEnabled:   false,  // 銅建値補正 有効/無効
  copperBase:      1000,   // 基準銅建値（円/kg）
  copperFraction:  0.50,   // ケーブル価格に占める銅連動比率
  laborSell:       19000,  // 労務売単価（円/人工）
  laborCost:       12000,  // 労務原価単価（円/人工）
};

// キーワードマスタ（Tridgeから読み込む）
// { keyword: string, laborType: 'wiring'|'fixture'|'equipment', bukariki: number, copperLinked: boolean }
let TRIDGE_KEYWORDS = [];

// Tridge装着フラグ
let tridgeLoaded = false;

const UNITS = ['式','ｍ','台','個','面','箇所','本','枚','組','ｾｯﾄ','系統'];

// State
let project = {
  name:'', number:'', date: new Date().toISOString().split('T')[0], client:'',
  struct:'', usage:'', type:'', floors:'', areaSqm:'', areaTsubo:'',
  location:'', person:'八木橋　友和', laborRate:72, laborSell:33000, tax:10, copper:''
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