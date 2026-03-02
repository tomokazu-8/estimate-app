// ===== 見積データベース =====
// DB are loaded from JSON files or Excel, these are defaults

let MATERIAL_DB = [];  // Loaded in init
let BUKARIKI_DB = [];  // Loaded in init
let LABOR_RATES = { sell: 19000, cost: 12000 };

// 歩掛デフォルト値（DBに該当なし時のフォールバック）
const BUKARIKI_DEFAULTS = {
  cable:   0.01,  // 電線・ケーブル（m/本単位）
  conduit: 0.02,  // 電線管
  device:  0.05,  // 配線器具
  panel:   0.25,  // 分電盤
  fire:    0.08,  // 火災感知器
  ground:  0.15,  // 接地
  dimmer:  0.08,  // 調光器
  fixture: 0.07,  // 照明器具（デフォルト）
};


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
  miscRate: { trunk: 0.05, lighting_fix: 0.04, outlet: 0.03, weak: 0.10, fire: 0.05 },
  transportBase: { small: 12000, medium: 55000, large: 80000, xlarge: 161000 },
  laborCostRatio: 0.72, // default
};

// ===== DATA MODEL =====
const CATEGORIES = [
  { id: 'trunk',        name: '1　幹線・分電盤工事',       short: '幹線・分電盤',   rateMode: false },
  { id: 'lighting_fix', name: '2　照明器具供給取付工事',    short: '照明器具',       rateMode: false },
  { id: 'outlet',       name: '3　電灯コンセント設備工事',  short: '電灯コンセント', rateMode: false },
  { id: 'weak',         name: '4　弱電設備工事',           short: '弱電設備',       rateMode: false },
  { id: 'fire',         name: '5　住宅用火災報知器',       short: '火報',           rateMode: false },
  { id: 'apply',        name: '6　電力会社協議及び申請費',  short: '申請費',         rateMode: true  },
  { id: 'temp',         name: '7　仮設工事',               short: '仮設工事',       rateMode: true  },
  { id: 'overhead',     name: '8　諸経費',                 short: '諸経費',         rateMode: true  },
  { id: 'discount',     name: '△　値引き',                short: '値引き',         rateMode: true  },
];

const UNITS = ['式','ｍ','台','個','面','箇所','本','枚','組','ｾｯﾄ','系統'];

// Performance database (embedded from 33 projects)
const PERF_DB = [
  {id:'P001',name:'古橋邸新築工事',struct:'木造',type:'新築',usage:'住宅',area_tsubo:21.7,total:2394961,profit:31.2},
  {id:'P002',name:'さつき保育園',struct:'S造',type:'新築',usage:'保育園',area_tsubo:132.7,total:7441066,profit:33.4},
  {id:'P003',name:'品川P邸',struct:'RC+木造',type:'新築',usage:'住宅',area_tsubo:36.3,total:5488580,profit:24.3},
  {id:'P004',name:'北戸田スポーツ',struct:'S造',type:'新築',usage:'スポーツ施設',area_tsubo:263.0,total:20685965,profit:30.9},
  {id:'P005',name:'南荻窪ガレージハウス',struct:'RC造',type:'新築',usage:'住宅',area_tsubo:42.1,total:8305500,profit:32.7},
  {id:'P006',name:'西村邸',struct:'木造',type:'新築',usage:'住宅',area_tsubo:33.6,total:1218188,profit:21.8},
  {id:'P007',name:'戸田市美女木倉庫',struct:'S造',type:'改修',usage:'倉庫',area_tsubo:null,total:1838505,profit:43.3},
  {id:'P008',name:'まめぞう',struct:'木造',type:'改修',usage:'店舗',area_tsubo:null,total:346350,profit:27.2},
  {id:'P009',name:'中野徐邸LDK',struct:'RC造',type:'改修',usage:'住宅',area_tsubo:null,total:552490,profit:38.6},
  {id:'P010',name:'戸田即日庵',struct:'木造',type:'改修',usage:'住宅',area_tsubo:null,total:296485,profit:22.1},
  {id:'P012',name:'大野邸離れ',struct:'木造',type:'新築',usage:'住宅',area_tsubo:null,total:1817823,profit:26.5},
  {id:'P013',name:'バイパスPJ倉庫',struct:'S造',type:'新築',usage:'倉庫',area_tsubo:241.8,total:27078252,profit:30.0},
  {id:'P014',name:'代官山S邸',struct:'RC+木造',type:'新築',usage:'住宅',area_tsubo:null,total:6388657,profit:21.7},
  {id:'P015',name:'カスタリア上池台',struct:'RC+木造',type:'新築',usage:'集合住宅',area_tsubo:144.3,total:18439291,profit:28.8},
  {id:'P016',name:'荻窪の家',struct:'木造',type:'新築',usage:'住宅',area_tsubo:31.8,total:5148712,profit:27.4},
  {id:'P017',name:'肉の田じま',struct:'S造',type:'新築',usage:'店舗',area_tsubo:132.1,total:37256395,profit:25.5},
  {id:'P021',name:'メディカルサルーテ',struct:'S造',type:'改修',usage:'事務所',area_tsubo:null,total:2165703,profit:32.0},
  {id:'P023',name:'荻野コーポ',struct:'木造',type:'改修',usage:'住宅',area_tsubo:null,total:676567,profit:32.8},
  {id:'P024',name:'鎌倉石川邸',struct:'木造',type:'新築',usage:'住宅',area_tsubo:135.3,total:53103204,profit:22.3},
  {id:'P025',name:'銀座4丁目',struct:'木造',type:'改修',usage:'店舗',area_tsubo:24.8,total:5072061,profit:27.1},
  {id:'P026',name:'駒場徐邸',struct:'RC造',type:'改修',usage:'住宅',area_tsubo:null,total:7548350,profit:35.4},
  {id:'P028',name:'神谷金属工場',struct:'S造',type:'新築',usage:'工場',area_tsubo:164.6,total:3312360,profit:34.7},
  {id:'P029',name:'逗子倉田邸',struct:'木造',type:'改修',usage:'住宅',area_tsubo:null,total:2055524,profit:29.1},
  {id:'P030',name:'田所邸',struct:'RC造',type:'改修',usage:'住宅',area_tsubo:null,total:3157711,profit:29.4},
  {id:'P031',name:'橋邸',struct:'木造',type:'改修',usage:'住宅',area_tsubo:85.3,total:13035859,profit:34.3},
];

// State
let project = {
  name:'', number:'', date: new Date().toISOString().split('T')[0], client:'',
  struct:'', usage:'', type:'', floors:'', areaSqm:'', areaTsubo:'',
  location:'', person:'八木橋　友和', laborRate:72, laborSell:33000, tax:10, copper:''
};

let items = {}; // { categoryId: [ {id, name, spec, qty, unit, price, amount, note} ] }
CATEGORIES.forEach(c => items[c.id] = []);

let currentCat = 'trunk';
let itemIdCounter = 1;

// 有効工種リスト（プリセット＋カスタム、localStorageから復元）
let activeCategories = (function() {
  try {
    const saved = JSON.parse(localStorage.getItem('activeCategories'));
    if (Array.isArray(saved) && saved.length > 0) {
      // 旧データに rateMode/ratePct/rateIncludeLabor がない場合はマイグレーション
      return saved.map(c => {
        const preset = CATEGORIES.find(p => p.id === c.id);
        return {
          ratePct: 0,
          rateIncludeLabor: false,
          rateMode: preset ? preset.rateMode : false,
          ...c,
        };
      });
    }
  } catch(e) {}
  return CATEGORIES.map(c => ({ ...c, active: true, custom: false, ratePct: 0, rateIncludeLabor: false }));
})();

let customCatCounter = parseInt(localStorage.getItem('customCatCounter') || '10', 10);