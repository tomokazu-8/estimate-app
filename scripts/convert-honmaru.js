/**
 * 本丸EX 明細チェックリスト → Tridge変換スクリプト
 *
 * 使い方:
 *   node scripts/convert-honmaru.js <入力ファイル.xlsx> [出力ファイル名]
 *
 * 例:
 *   node scripts/convert-honmaru.js "明細チェックリスト_20260306.xlsx"
 *   → tridge_電気_20260306.xlsx が出力される
 */

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ===== 自動計算行の判定 =====
// 本丸EXのコード: A10=雑材料, X89=労務費, XA5=運搬費 など
const AUTO_CODE_RE = /^[A-Z]\d+$/;
function isAutoRow(r) {
  const c0 = String(r[0] || '');
  const c1 = String(r[1] || '');
  if (AUTO_CODE_RE.test(c0) || AUTO_CODE_RE.test(c1)) return true;
  const spec9  = String(r[9]  || '');
  const spec10 = String(r[10] || '');
  if (spec9.startsWith('＜自動計算') || spec10.startsWith('＜自動計算')) return true;
  return false;
}

// ===== ヘッダー行・空行の判定 =====
const HEADER_KEYWORDS = ['集計', '工種名', '使用パターン', '工事名', '工事名２',
                         '得意先', 'ｺｰﾄﾞ', '品 名', '品名'];
function isSkipRow(r) {
  const c0 = String(r[0] || '');
  const c3 = String(r[3] || '');
  if (HEADER_KEYWORDS.includes(c0) || HEADER_KEYWORDS.includes(c3)) return true;
  if (r.every(v => v === '' || v === null || v === undefined)) return true;
  return false;
}

// ===== 品名からカテゴリを自動推定 =====
function guessCategory(name) {
  const n = name.toLowerCase();
  if (/cv|vv|iv|em|エコ|電線|ケーブル/.test(n))   return 'cable';
  if (/pf|cd管|ve管|電線管|可とう|硬質/.test(n))  return 'conduit';
  if (/分電盤|制御盤|動力盤|開閉器/.test(n))       return 'panel';
  if (/コンセント|スイッチ|プレート|wt/.test(n))   return 'device';
  if (/ボックス|box|プルボックス/.test(n))          return 'box';
  if (/照明|ライト|led|ランプ|灯具/.test(n))        return 'fixture';
  if (/接地|アース/.test(n))                        return 'ground';
  if (/火報|感知器|発信機|受信機/.test(n))          return 'fire';
  if (/ポール|引込|碍子/.test(n))                  return 'accessories';
  return '';
}

// ===== 1行から材料データを抽出 =====
// Layout A: col[0]="" or string, col[10]=規格, col[15]=qty, col[19]=見積単価, col[27]=原価単価, col[33]=歩掛
// Layout B: col[0]=number,        col[9]=規格,  col[16]=qty, col[20]=見積単価, col[28]=原価単価, col[33]=歩掛
function extractItem(r) {
  const name = String(r[3] || '').trim();
  if (!name) return null;

  const isLayoutB = typeof r[0] === 'number';
  let spec, unit, sellPrice, costPrice, bukariki;

  if (isLayoutB) {
    spec      = String(r[9]  || '').trim();
    unit      = String(r[14] || '').trim();
    sellPrice = parseFloat(r[20]) || 0;
    costPrice = parseFloat(r[28]) || 0;
    bukariki  = parseFloat(r[33]) || 0;
  } else {
    spec      = String(r[10] || '').trim();
    unit      = String(r[14] || '').trim();
    sellPrice = parseFloat(r[19]) || 0;
    costPrice = parseFloat(r[27]) || 0;
    bukariki  = parseFloat(r[33]) || 0;
  }

  if (!unit || sellPrice <= 0) return null;

  const costRate = sellPrice > 0
    ? Math.round((costPrice / sellPrice) * 1000) / 1000
    : 0;

  return {
    品目名称: name,
    規格名称: spec,
    単位:     unit,
    基準単価: sellPrice,
    原価:     costPrice,
    原価率:   costRate,
    歩掛:     bukariki,
    カテゴリ: guessCategory(name),
  };
}

// ===== 設定マスタの労務単価を検出 =====
// コード行: [1,"","電  工","","",原価単価,"","",見積単価,...]
function extractLaborRates(rows) {
  const rates = {};
  for (const r of rows) {
    if (typeof r[0] !== 'number') continue;
    const name = String(r[2] || '').trim().replace(/\s+/g, '');
    const cost = parseFloat(r[5]) || 0;
    const sell = parseFloat(r[8]) || 0;
    if (name && cost > 0 && sell > 0) {
      rates[name] = { cost, sell };
    }
  }
  return rates;
}

// ===== メイン =====
function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('使い方: node scripts/convert-honmaru.js <入力ファイル.xlsx>');
    process.exit(1);
  }

  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    console.error('ファイルが見つかりません:', inputPath);
    process.exit(1);
  }

  console.log('読み込み中:', inputPath);
  const wb = XLSX.readFile(inputPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('総行数:', rows.length);

  // 労務単価を抽出
  const laborRates = extractLaborRates(rows);
  const electricCost = laborRates['電工']?.cost || 19200;
  const electricSell = laborRates['電工']?.sell || 29370;
  console.log('労務単価 検出: 電工原価=', electricCost, '/ 電工見積=', electricSell);

  // 材料行を抽出
  const seen = new Map(); // 重複排除: key = 品名+規格+単位
  let skipped = 0;

  for (const r of rows) {
    if (isSkipRow(r)) continue;
    if (isAutoRow(r)) { skipped++; continue; }
    const item = extractItem(r);
    if (!item) continue;
    const key = item.品目名称 + '|' + item.規格名称 + '|' + item.単位;
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }

  const materials = Array.from(seen.values());
  console.log('抽出品目:', materials.length, '件 / 自動計算行除外:', skipped, '件');

  // ===== Tridge Excel を作成 =====
  const outWb = XLSX.utils.book_new();

  // --- 資材マスタ ---
  const matHeader = ['品目名称','規格名称','単位','基準単価','原価','原価率','歩掛','カテゴリ'];
  const matRows = [matHeader, ...materials.map(m => [
    m.品目名称, m.規格名称, m.単位,
    m.基準単価, m.原価, m.原価率, m.歩掛, m.カテゴリ,
  ])];
  const wsMat = XLSX.utils.aoa_to_sheet(matRows);
  wsMat['!cols'] = [
    {wch:30},{wch:25},{wch:6},{wch:10},{wch:10},{wch:8},{wch:6},{wch:12},
  ];
  XLSX.utils.book_append_sheet(outWb, wsMat, '資材マスタ');

  // --- 工種マスタ（テンプレート） ---
  const catRows = [
    ['工種ID','工種名','略称','割合モード','雑材料率%','順序','自動計算行'],
    ['trunk',  '幹線・分電盤設備工事','幹線', '','5','1','雑材料消耗品|電工労務費|運搬費'],
    ['wiring', '配線・配管工事',      '配管', '','5','2','雑材料消耗品|電工労務費|運搬費'],
    ['lighting','照明設備工事',       '照明', '','5','3','雑材料消耗品|器具取付け接続費|運搬費'],
  ];
  const wsCat = XLSX.utils.aoa_to_sheet(catRows);
  wsCat['!cols'] = [{wch:16},{wch:24},{wch:8},{wch:10},{wch:8},{wch:6},{wch:40}];
  XLSX.utils.book_append_sheet(outWb, wsCat, '工種マスタ');

  // --- 設定マスタ ---
  const settingRows = [
    ['パラメーター名','値'],
    ['銅建値補正',       '○'],
    ['銅建値基準（円/kg）', 1200],
    ['銅連動率',         0.5],
    ['労務売単価（円/人工）', electricSell],
    ['労務原価単価（円/人工）', electricCost],
  ];
  const wsSet = XLSX.utils.aoa_to_sheet(settingRows);
  wsSet['!cols'] = [{wch:24},{wch:12}];
  XLSX.utils.book_append_sheet(outWb, wsSet, '設定マスタ');

  // --- キーワードマスタ（最低限のテンプレート） ---
  const kwRows = [
    ['キーワード','分類','歩掛','銅連動','天井開口'],
    ['cv','wiring',0.025,'○',''],
    ['vv','wiring',0.020,'○',''],
    ['iv','wiring',0.015,'○',''],
    ['pf','wiring',0.045,'',''],
    ['照明','fixture',0.25,'','○'],
    ['コンセント','fixture',0.07,'',''],
    ['スイッチ','fixture',0.07,'',''],
  ];
  const wsKw = XLSX.utils.aoa_to_sheet(kwRows);
  wsKw['!cols'] = [{wch:20},{wch:12},{wch:8},{wch:8},{wch:8}];
  XLSX.utils.book_append_sheet(outWb, wsKw, 'キーワードマスタ');

  // --- 出力 ---
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g,'');
  const baseName = path.basename(input, path.extname(input));
  const outName = `tridge_電気_${dateStr}.xlsx`;
  const outPath = path.join(path.dirname(inputPath), outName);

  XLSX.writeFile(outWb, outPath);
  console.log('\n✅ Tridge出力完了:', outPath);
  console.log('  ├ 資材マスタ:', materials.length, '品目');
  console.log('  ├ 工種マスタ: 3工種（内容を確認・修正してください）');
  console.log('  ├ 設定マスタ: 電工 売=' + electricSell + ' / 原価=' + electricCost);
  console.log('  └ キーワードマスタ: 基本テンプレート（必要に応じて追加）');
  console.log('\n次のステップ:');
  console.log('  1. 出力されたExcelを開いて内容を確認');
  console.log('  2. 工種マスタの工種IDを実際の運用に合わせて修正');
  console.log('  3. キーワードマスタにキーワードを追加');
  console.log('  4. estimate-app でTridgeとして読み込む');
}

main();
