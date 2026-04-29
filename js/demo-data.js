// ===== デモデータ（開発用） =====
// 動作確認用のサンプルTridge + 3パターンの物件データ

// ---------- デモTridge（工種マスタ） ----------
const DEMO_TRIDGE_CATEGORIES = [
  { id: 'electric',  name: '電気設備工事',         short: '電気',    rateMode: false, miscRate: 0.05 },
  { id: 'hvac',      name: '空調設備工事',         short: '空調',    rateMode: false, miscRate: 0.05 },
  { id: 'plumbing',  name: '給排水衛生設備工事',   short: '給排水',  rateMode: false, miscRate: 0.05 },
  { id: 'overhead',  name: '諸経費',               short: '諸経費',  rateMode: true,  miscRate: 0 },
];

// ---------- デモTridge（資材マスタ） ----------
// MATERIAL_DB 形式: { n:品名, s:規格, u:単位, ep:見積単価, cp:原価単価, r:掛率, b:歩掛, c:カテゴリID, a:有効フラグ }
const DEMO_TRIDGE_MATERIALS = [
  // 電線（低圧）
  { n:'VVF1.6×2C',         s:'100m', u:'巻',  p:6500,  b:0.05, c:'cable-lv' },
  { n:'VVF1.6×3C',         s:'100m', u:'巻',  p:9500,  b:0.05, c:'cable-lv' },
  { n:'VVF2.0×2C',         s:'100m', u:'巻',  p:9800,  b:0.06, c:'cable-lv' },
  { n:'VVF2.0×3C',         s:'100m', u:'巻',  p:13800, b:0.06, c:'cable-lv' },
  { n:'CV5.5sq×3C',        s:'100m', u:'巻',  p:42000, b:0.08, c:'cable-lv' },
  { n:'IV1.6mm',           s:'300m', u:'巻',  p:8500,  b:0.04, c:'cable-lv' },
  // 配管
  { n:'PF管16',            s:'30m',  u:'巻',  p:2200,  b:0.03, c:'conduit' },
  { n:'PF管22',            s:'30m',  u:'巻',  p:3200,  b:0.04, c:'conduit' },
  { n:'CD管16',            s:'50m',  u:'巻',  p:2800,  b:0.03, c:'conduit' },
  // 配線器具
  { n:'埋込スイッチ片切',   s:'WS5001MP',   u:'個', p:280,   b:0.08, c:'device' },
  { n:'埋込スイッチ3路',    s:'WS5002MP',   u:'個', p:320,   b:0.08, c:'device' },
  { n:'埋込コンセント2P',   s:'WS6002WP',   u:'個', p:280,   b:0.08, c:'device' },
  { n:'アースターミナル付コンセント', s:'WS6005WP', u:'個', p:380, b:0.08, c:'device' },
  { n:'プレート1連',        s:'WS7001W',    u:'枚', p:120,   b:0.02, c:'device' },
  // 照明器具
  { n:'シーリングライトLED', s:'LSEB1116K', u:'台', p:12000, b:0.15, c:'lighting' },
  { n:'ダウンライトLED',    s:'NNN61534LE1', u:'台', p:4500,  b:0.18, c:'lighting' },
  { n:'ペンダントライト',   s:'XLGB81593CE1', u:'台', p:18000, b:0.20, c:'lighting' },
  { n:'ベースライト40形',   s:'XLX430DELRX9', u:'台', p:14500, b:0.22, c:'lighting' },
  // 分電盤・制御盤
  { n:'分電盤住宅用',       s:'BQE34102', u:'面',   p:28000,  b:1.5,  c:'panel' },
  { n:'分電盤事務所用',     s:'BQR3520',  u:'面',   p:48000,  b:2.0,  c:'panel' },
  // ボックス
  { n:'スイッチボックス',   s:'1個用',    u:'個',   p:120,    b:0.06, c:'box' },
  { n:'プルボックス',       s:'200×200×100', u:'個', p:1800, b:0.15, c:'box' },
  // 通信・情報
  { n:'LANケーブルCat6',    s:'305m',     u:'箱',   p:18000,  b:0.05, c:'cable-weak' },
  { n:'モジュラジャックRJ45', s:'2口', u:'個',   p:850,    b:0.08, c:'device' },
  // 火災報知設備
  { n:'差動式煙感知器',     s:'BV4111',   u:'個',   p:4200,   b:0.20, c:'fire' },
  // 空調機器
  { n:'ルームエアコン2.2kW', s:'CS-228CF', u:'台',  p:78000,  b:2.5,  c:'equipment' },
  { n:'ルームエアコン4.0kW', s:'CS-408CF', u:'台',  p:128000, b:3.0,  c:'equipment' },
  // 換気
  { n:'パイプファン',       s:'FY-08PD9', u:'台',   p:6500,   b:0.5,  c:'equipment' },
  // 給排水
  { n:'塩ビ管VP25',         s:'4m',       u:'本',   p:850,    b:0.10, c:'misc' },
  { n:'塩ビ管VP40',         s:'4m',       u:'本',   p:1280,   b:0.15, c:'misc' },
  { n:'継手VP25 90度エルボ', s:'-',       u:'個',   p:120,    b:0.04, c:'misc' },
  // 副材
  { n:'ステップル',         s:'19mm',     u:'箱',   p:380,    b:0.01, c:'misc' },
  { n:'ビニルテープ',       s:'19mm',     u:'巻',   p:120,    b:0.005, c:'misc' },
];

// ---------- デモTridge設定 ----------
const DEMO_TRIDGE_SETTINGS = {
  copperEnabled: true,
  copperBase: 1200,
  copperFraction: 0.4,
  laborSell: 29000,
  laborCost: 19500,
};

// ---------- デモTridgeキーワード ----------
const DEMO_TRIDGE_KEYWORDS = [
  { keyword: 'vvf',         laborType: 'wiring',    bukariki: 0.05, copperLinked: true,  ceilingOpening: false },
  { keyword: 'cv ',         laborType: 'wiring',    bukariki: 0.04, copperLinked: true,  ceilingOpening: false },
  { keyword: 'iv',          laborType: 'wiring',    bukariki: 0.04, copperLinked: true,  ceilingOpening: false },
  { keyword: 'pf管',        laborType: 'wiring',    bukariki: 0.03, copperLinked: false, ceilingOpening: false },
  { keyword: 'cd管',        laborType: 'wiring',    bukariki: 0.03, copperLinked: false, ceilingOpening: false },
  { keyword: 'ダウンライト', laborType: 'fixture',   bukariki: 0.18, copperLinked: false, ceilingOpening: true },
  { keyword: 'シーリング',  laborType: 'fixture',   bukariki: 0.15, copperLinked: false, ceilingOpening: false },
  { keyword: 'コンセント',  laborType: 'fixture',   bukariki: 0.08, copperLinked: false, ceilingOpening: false },
  { keyword: 'スイッチ',    laborType: 'fixture',   bukariki: 0.08, copperLinked: false, ceilingOpening: false },
  { keyword: '分電盤',      laborType: 'equipment', bukariki: 1.5,  copperLinked: false, ceilingOpening: false },
  { keyword: 'エアコン',    laborType: 'equipment', bukariki: 2.5,  copperLinked: false, ceilingOpening: false },
  { keyword: 'ルームエアコン', laborType: 'equipment', bukariki: 2.5, copperLinked: false, ceilingOpening: false },
];

// ---------- 3パターンのデモ物件 ----------
const DEMO_PROJECT_PATTERNS = [
  {
    id: 'pattern-a',
    label: 'パターンA: 木造新築住宅（小規模）',
    project: {
      name: '○○邸新築電気工事',
      client: '山田工務店',
      date: '2026-04-15',
      person: '八木橋　友和',
      struct: '木造',
      usage: '住宅',
      type: '新築',
      floors: '2',
      areaSqm: '120',
      areaTsubo: '36.3',
      location: '東京都世田谷区',
      memo: '2階建て木造住宅。LDK + 寝室3部屋 + 水回り。LED照明中心。',
      laborSell: 29000,
      laborCost: 19500,
      laborRate: 67,
      tax: 10,
    },
    items: {
      electric: [
        { name:'VVF1.6×2C',  spec:'100m', qty:8,  unit:'巻',  price:6500,  bukariki1:0.05 },
        { name:'VVF1.6×3C',  spec:'100m', qty:5,  unit:'巻',  price:9500,  bukariki1:0.05 },
        { name:'VVF2.0×2C',  spec:'100m', qty:3,  unit:'巻',  price:9800,  bukariki1:0.06 },
        { name:'埋込スイッチ片切', spec:'WS5001MP', qty:18, unit:'個', price:280, bukariki1:0.08 },
        { name:'埋込コンセント2P', spec:'WS6002WP', qty:32, unit:'個', price:280, bukariki1:0.08 },
        { name:'プレート1連', spec:'WS7001W', qty:30, unit:'枚', price:120, bukariki1:0.02 },
        { name:'シーリングライトLED', spec:'LSEB1116K', qty:6, unit:'台', price:12000, bukariki1:0.15 },
        { name:'ダウンライトLED', spec:'NNN61534LE1', qty:14, unit:'台', price:4500, bukariki1:0.18 },
        { name:'分電盤住宅用', spec:'BQE34102', qty:1, unit:'面', price:28000, bukariki1:1.5 },
        { name:'スイッチボックス', spec:'1個用', qty:50, unit:'個', price:120, bukariki1:0.06 },
      ],
      overhead: [],
    },
    overheadRate: 5,
  },
  {
    id: 'pattern-b',
    label: 'パターンB: RC造改修事務所（中規模）',
    project: {
      name: '△△ビル3階事務所改修工事',
      client: '株式会社△△商事',
      date: '2026-04-20',
      person: '八木橋　友和',
      struct: 'RC造',
      usage: '事務所',
      type: '改修',
      floors: '4',
      areaSqm: '320',
      areaTsubo: '96.8',
      location: '東京都港区',
      memo: '3階フロアの全面改修。OAフロア対応。LANケーブル敷設含む。',
      laborSell: 29000,
      laborCost: 19500,
      laborRate: 67,
      tax: 10,
    },
    items: {
      electric: [
        { name:'VVF2.0×2C',  spec:'100m', qty:6,  unit:'巻',  price:9800,  bukariki1:0.06 },
        { name:'VVF2.0×3C',  spec:'100m', qty:4,  unit:'巻',  price:13800, bukariki1:0.06 },
        { name:'CV5.5sq×3C', spec:'100m', qty:2,  unit:'巻',  price:42000, bukariki1:0.08 },
        { name:'PF管22',     spec:'30m',  qty:8,  unit:'巻',  price:3200,  bukariki1:0.04 },
        { name:'埋込スイッチ片切', spec:'WS5001MP', qty:24, unit:'個', price:280, bukariki1:0.08 },
        { name:'埋込スイッチ3路', spec:'WS5002MP', qty:8,  unit:'個', price:320, bukariki1:0.08 },
        { name:'埋込コンセント2P', spec:'WS6002WP', qty:60, unit:'個', price:280, bukariki1:0.08 },
        { name:'アースターミナル付コンセント', spec:'WS6005WP', qty:24, unit:'個', price:380, bukariki1:0.08 },
        { name:'ベースライト40形', spec:'XLX430DELRX9', qty:32, unit:'台', price:14500, bukariki1:0.22 },
        { name:'分電盤事務所用', spec:'BQR3520', qty:2, unit:'面', price:48000, bukariki1:2.0 },
        { name:'プルボックス', spec:'200×200×100', qty:6, unit:'個', price:1800, bukariki1:0.15 },
        { name:'LANケーブルCat6', spec:'305m', qty:3, unit:'箱', price:18000, bukariki1:0.05 },
        { name:'モジュラジャックRJ45', spec:'2口', qty:24, unit:'個', price:850, bukariki1:0.08 },
        { name:'差動式煙感知器', spec:'BV4111', qty:8, unit:'個', price:4200, bukariki1:0.20 },
      ],
      hvac: [
        { name:'ルームエアコン4.0kW', spec:'CS-408CF', qty:6, unit:'台', price:128000, bukariki1:3.0 },
        { name:'パイプファン', spec:'FY-08PD9', qty:4, unit:'台', price:6500, bukariki1:0.5 },
      ],
      plumbing: [],
      overhead: [],
    },
    overheadRate: 8,
  },
  {
    id: 'pattern-c',
    label: 'パターンC: S造新築工場（大規模）',
    project: {
      name: '××製作所新築工事 電気・空調設備',
      client: '××建設株式会社',
      date: '2026-05-01',
      person: '八木橋　友和',
      struct: 'S造',
      usage: '工場',
      type: '新築',
      floors: '1',
      areaSqm: '850',
      areaTsubo: '257.1',
      location: '埼玉県川口市',
      memo: '平屋鉄骨造の工場。動力電源・LED投光器・空調・換気を一式工事。',
      laborSell: 29000,
      laborCost: 19500,
      laborRate: 67,
      tax: 10,
    },
    items: {
      electric: [
        { name:'CV5.5sq×3C', spec:'100m', qty:8,  unit:'巻',  price:42000, bukariki1:0.08 },
        { name:'VVF2.0×3C',  spec:'100m', qty:12, unit:'巻',  price:13800, bukariki1:0.06 },
        { name:'VVF2.0×2C',  spec:'100m', qty:8,  unit:'巻',  price:9800,  bukariki1:0.06 },
        { name:'PF管22',     spec:'30m',  qty:24, unit:'巻',  price:3200,  bukariki1:0.04 },
        { name:'PF管16',     spec:'30m',  qty:20, unit:'巻',  price:2200,  bukariki1:0.03 },
        { name:'CD管16',     spec:'50m',  qty:12, unit:'巻',  price:2800,  bukariki1:0.03 },
        { name:'IV1.6mm',    spec:'300m', qty:6,  unit:'巻',  price:8500,  bukariki1:0.04 },
        { name:'埋込スイッチ片切', spec:'WS5001MP', qty:32, unit:'個', price:280, bukariki1:0.08 },
        { name:'埋込コンセント2P', spec:'WS6002WP', qty:80, unit:'個', price:280, bukariki1:0.08 },
        { name:'アースターミナル付コンセント', spec:'WS6005WP', qty:48, unit:'個', price:380, bukariki1:0.08 },
        { name:'ベースライト40形', spec:'XLX430DELRX9', qty:64, unit:'台', price:14500, bukariki1:0.22 },
        { name:'分電盤事務所用', spec:'BQR3520', qty:4, unit:'面', price:48000, bukariki1:2.0 },
        { name:'プルボックス', spec:'200×200×100', qty:18, unit:'個', price:1800, bukariki1:0.15 },
        { name:'差動式煙感知器', spec:'BV4111', qty:16, unit:'個', price:4200, bukariki1:0.20 },
        { name:'ステップル', spec:'19mm', qty:30, unit:'箱', price:380, bukariki1:0.01 },
      ],
      hvac: [
        { name:'ルームエアコン4.0kW', spec:'CS-408CF', qty:12, unit:'台', price:128000, bukariki1:3.0 },
        { name:'ルームエアコン2.2kW', spec:'CS-228CF', qty:6,  unit:'台', price:78000,  bukariki1:2.5 },
        { name:'パイプファン', spec:'FY-08PD9', qty:24, unit:'台', price:6500, bukariki1:0.5 },
      ],
      plumbing: [
        { name:'塩ビ管VP25', spec:'4m', qty:48, unit:'本', price:850,  bukariki1:0.10 },
        { name:'塩ビ管VP40', spec:'4m', qty:36, unit:'本', price:1280, bukariki1:0.15 },
        { name:'継手VP25 90度エルボ', spec:'-', qty:80, unit:'個', price:120, bukariki1:0.04 },
      ],
      overhead: [],
    },
    overheadRate: 10,
  },
];

// ---------- デモTridge読み込み ----------
function demoLoadTridge() {
  // 工種マスタ
  if (typeof applyTridgeCategories === 'function') {
    applyTridgeCategories(DEMO_TRIDGE_CATEGORIES);
  }
  koshuTridgeLoaded = true;

  // 資材マスタ（n/s/u/ep/cp/r/c/a 形式に変換）
  MATERIAL_DB.length = 0;
  DEMO_TRIDGE_MATERIALS.forEach(m => {
    // p (基準単価) を ep (見積単価) として、cp は r=70% で算出
    const ep = m.p;
    const cp = Math.round(ep * 0.7);
    MATERIAL_DB.push({ n:m.n, s:m.s, u:m.u, ep, cp, r:30, c:m.c, a:1 });
  });

  // 歩掛DB
  BUKARIKI_DB.length = 0;
  DEMO_TRIDGE_MATERIALS.filter(m => m.b > 0).forEach(m => {
    BUKARIKI_DB.push({ n:m.n, s:m.s, u:m.u, b:m.b, c:m.c });
  });

  // カテゴリマスタ
  if (typeof CATEGORY_MASTER !== 'undefined') {
    CATEGORY_MASTER.length = 0;
    if (typeof MATERIAL_CATEGORIES !== 'undefined') {
      MATERIAL_CATEGORIES.forEach(c => CATEGORY_MASTER.push({ id:c.id, name:c.name }));
    }
  }
  zairyoTridgeLoaded = true;

  // 設定マスタ
  if (typeof TRIDGE_SETTINGS !== 'undefined') {
    Object.assign(TRIDGE_SETTINGS, DEMO_TRIDGE_SETTINGS);
  }
  setLaborRates(DEMO_TRIDGE_SETTINGS.laborSell, DEMO_TRIDGE_SETTINGS.laborCost);

  // キーワードマスタ
  if (typeof TRIDGE_KEYWORDS !== 'undefined') {
    TRIDGE_KEYWORDS.length = 0;
    DEMO_TRIDGE_KEYWORDS.forEach(k => TRIDGE_KEYWORDS.push({ ...k }));
  }

  // 銅建値補正UI連動
  const cuChk = document.getElementById('copperAdjEnabled');
  if (cuChk) cuChk.checked = !!DEMO_TRIDGE_SETTINGS.copperEnabled;

  // UI更新
  if (typeof updateDbStatus === 'function') updateDbStatus();
  if (typeof hideDbOverlay === 'function') hideDbOverlay();
  if (typeof renderCatTabs === 'function') renderCatTabs();
  if (typeof updateKoshuBadge === 'function') updateKoshuBadge();

  showToast('デモTridgeを装着しました（資材' + MATERIAL_DB.length + '品目 / 工種' + DEMO_TRIDGE_CATEGORIES.length + '種）');
}

// ---------- デモ物件読み込み ----------
async function demoLoadProject(patternId) {
  const pattern = DEMO_PROJECT_PATTERNS.find(p => p.id === patternId);
  if (!pattern) { showToast('パターンが見つかりません'); return; }

  // Tridge未装着なら先に装着
  if (!koshuTridgeLoaded || !zairyoTridgeLoaded) {
    demoLoadTridge();
  }

  // 既存データに上書きの確認
  const hasData = (project && project.name) || Object.values(items || {}).some(arr => (arr || []).some(i => i.name));
  if (hasData) {
    if (!(await customConfirm('現在の見積データを上書きします。よろしいですか？', {variant:'danger', confirmText:'上書き'}))) return;
  }

  // project に値を設定
  Object.keys(project).forEach(k => { project[k] = ''; });
  Object.assign(project, pattern.project);

  // items を初期化＋投入
  Object.keys(items).forEach(k => delete items[k]);
  activeCategories.forEach(c => { items[c.id] = []; });
  itemIdCounter = 1;
  Object.entries(pattern.items).forEach(([catId, list]) => {
    if (!items[catId]) items[catId] = [];
    list.forEach(it => {
      items[catId].push(createBlankItem({
        ...it,
        amount: (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0),
      }));
    });
  });

  // 諸経費（割合工種）の％設定
  const overhead = activeCategories.find(c => c.id === 'overhead');
  if (overhead && pattern.overheadRate) {
    overhead.ratePct = pattern.overheadRate;
  }

  // 状態リセット
  if (typeof _resetEstimateState === 'function') _resetEstimateState();
  if (typeof _restoreProjectForm === 'function') _restoreProjectForm();
  setLaborRates(project.laborSell, project.laborCost);
  if (typeof syncLaborSettingsToForm === 'function') syncLaborSettingsToForm();
  recalcAll();
  renderCatTabs();
  if (typeof _updateProjectBar === 'function') _updateProjectBar();
  if (typeof markDirty === 'function') markDirty();
  showToast('デモ物件を読み込みました: ' + pattern.label);
}

// ---------- デモデータクリア ----------
async function demoClearAll() {
  if (!(await customConfirm('全てのデータ（Tridge / 物件 / 明細 / 保存済み見積 / ナレッジDB）をクリアします。\nブラウザのlocalStorage / IndexedDBもリセットされます。よろしいですか？', {variant:'danger', confirmText:'全て削除'}))) return;

  // localStorage クリア（hachitomo_* keys）
  Object.keys(localStorage).filter(k => k.startsWith('hachitomo') || k === 'activeCategories' || k === 'estimate_no_counter' || k.startsWith('estimates_')).forEach(k => localStorage.removeItem(k));

  // ナレッジDBクリア（IndexedDB）
  try {
    if (typeof knowledgeDB !== 'undefined' && knowledgeDB.getAll) {
      const all = await knowledgeDB.getAll();
      for (const r of all) await knowledgeDB.remove(r.id);
    }
  } catch(e) { console.warn('IndexedDB clear failed:', e); }

  showToast('全データをクリアしました。ページを再読み込みします...');
  setTimeout(() => location.reload(), 800);
}
