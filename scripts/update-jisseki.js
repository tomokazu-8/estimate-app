/**
 * update-jisseki.js
 * 1物件フォルダから本丸EX 3ファイルを読み込み、実績データベース_v4.xlsx を更新する
 *
 * Usage:
 *   node scripts/update-jisseki.js "<フォルダパス>"
 *
 * 例:
 *   node scripts/update-jisseki.js "C:\Users\pal19\OneDrive\...\(株)ユウコウ 照明器具取替え工事"
 */

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

const JISSEKI_PATH = 'C:/Users/pal19/OneDrive/Goodreader one/見積りソフト作成プロジェクト/過去物件明細/実績データベース_v4.xlsx';

// ===== ユーティリティ =====
function str(v)  { return String(v == null ? '' : v).trim(); }
function num(v)  { return parseFloat(v) || 0; }
function norm(s) { return str(s).normalize('NFKC'); }
function normKey(s) { return norm(s).toLowerCase().replace(/[\s\u3000　]+/g, ''); }
function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }

// ===== ファイル検索 =====
function findFile(dir, pattern) {
  const files = fs.readdirSync(dir);
  const found = files.find(f => f.match(pattern));
  return found ? path.join(dir, found) : null;
}

// ===== 表紙総括表 解析 =====
function parseSummary(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const result = {
    projectName: '', estNumber: '', client: '', manager: '',
    koshuList: [],         // { name, sellAmt, costAmt, laborHours, profitRate }
    miscExpenseAmt: 0,     // 諸経費 見積金額
    miscExpenseCost: 0,    // 諸経費 原価
    discountAmt: 0,        // 値引き（正値で格納）
    grandTotal: 0,         // 合計（値引き・諸経費込み）
    costTotal: 0,
  };

  let inKoshu = false;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c1 = norm(r[1] || '');
    const c8 = norm(r[8] || '');

    // ヘッダー情報
    if (c8 === '工事名')  result.projectName = norm(r[9]);
    if (norm(r[19]) === '見積番号') result.estNumber = norm(r[21]);
    if (c8 === '得意先')  result.client  = norm(r[9]);
    if (norm(r[19]) === '担当者名') result.manager = norm(r[21]);

    // 工種サマリ開始行（「工　　種　　名」ヘッダー）
    if (c1.replace(/\s+/g, '').includes('工種名')) { inKoshu = true; continue; }

    if (inKoshu && c1) {
      const sellAmt  = num(r[13]);
      const costAmt  = num(r[15]);
      const laborHrs = num(r[16]);
      const profRate = num(r[20]);

      if (c1.replace(/[\s　]+/g, '').includes('合計')) {
        // 合計行
        result.grandTotal = sellAmt;
        result.costTotal  = costAmt;
        inKoshu = false;
      } else if (c1.replace(/[\s　]+/g, '').includes('諸経費')) {
        result.miscExpenseAmt  = sellAmt;
        result.miscExpenseCost = costAmt;
      } else if (c1.replace(/[\s　]+/g, '').includes('値引')) {
        result.discountAmt = Math.abs(sellAmt);
      } else if (sellAmt !== 0 || costAmt !== 0) {
        result.koshuList.push({
          name: c1, sellAmt, costAmt, laborHours: laborHrs, profitRate: profRate,
        });
      }
    }
  }

  // 工事費合計 = 諸経費・値引き除いた工種合計
  result.workTotal = result.koshuList.reduce((s, k) => s + k.sellAmt, 0);

  return result;
}

// ===== チェックリスト 解析 =====
function parseChecklist(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const items = []; // { koshuName, code, name, spec, unit, qty, sellPrice, sellAmt, costPrice, costAmt, bukariki, laborHours }
  let currentKoshu = '';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c1 = norm(r[1] || '');
    const c2 = norm(r[2] || '');
    const c3 = norm(r[3] || '');

    // 工種名行: r[1]==='工種名' かつ r[4]に工種名が入っている
    if (c1 === '工種名' && r[4]) {
      currentKoshu = norm(r[4]);
      continue;
    }

    // 品目行: r[2]が集計コード（数字または大文字+数字）
    if (c2 && c2.match(/^[A-Z0-9]{2,4}$/) && c3) {
      const name = norm(c3);
      // 自動計算行・ヘッダー行を除外
      if (!name || name.startsWith('品') || name.startsWith('集計')) continue;
      if (str(r[7]).includes('自動計算') || str(r[7]).includes('＜自動')) continue;

      items.push({
        koshuName:   currentKoshu,
        code:        c2,
        name:        name,
        spec:        norm(r[7]),
        unit:        norm(r[9]),
        qty:         num(r[10]),
        sellPrice:   num(r[13]),
        sellAmt:     num(r[15]),
        costPrice:   num(r[17]),
        costAmt:     num(r[19]),
        bukariki:    num(r[22]) || '',
        laborHours:  num(r[24]) || '',
        listPrice:   0,
        sellRate:    0,
        costRate:    0,
      });
    }
  }

  return items;
}

// ===== 機器ファイル 解析 =====
function parseKiki(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 品名＋規格 → { listPrice, sellRate, costRate }
  const map = new Map();

  for (const r of rows) {
    const name = normKey(r[1] || '');
    const spec = normKey(r[5] || '');
    const listPrice = num(r[13]);
    if (!name || listPrice === 0) continue;
    if (name.includes('小計') || name.includes('合計')) continue;

    const key = name + '|' + spec;
    map.set(key, {
      listPrice: listPrice,
      sellRate:  Math.round(num(r[15]) * 10) / 10,
      costRate:  Math.round(num(r[19]) * 10) / 10,
    });
  }

  return map;
}

// ===== 機器データで品目を補完 =====
function enrichWithKiki(items, kikiMap) {
  for (const it of items) {
    const key = normKey(it.name) + '|' + normKey(it.spec);
    const kd = kikiMap.get(key);
    if (kd) {
      it.listPrice = kd.listPrice;
      it.sellRate  = kd.sellRate;
      it.costRate  = kd.costRate;
    } else {
      // 規格なしでも検索
      const keyNoSpec = normKey(it.name) + '|';
      const kd2 = kikiMap.get(keyNoSpec);
      if (kd2) {
        it.listPrice = kd2.listPrice;
        it.sellRate  = kd2.sellRate;
        it.costRate  = kd2.costRate;
      }
    }
  }
  return items;
}

// ===== 実績データベース 読み込み =====
function loadJisseki(filePath) {
  const wb = XLSX.readFile(filePath);

  const readSheet = (name) => {
    const ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) : [];
  };

  return {
    wb,
    物件マスタ:   readSheet('物件マスタ'),
    工種サマリ:   readSheet('工種サマリ'),
    明細データ:   readSheet('明細データ'),
    自動計算:     readSheet('自動計算パラメータ'),
    分析:         readSheet('分析'),
  };
}

// ===== 実績DBを更新して保存 =====
function updateJisseki(db, summary, items, folderName) {
  const { 物件マスタ: pm, 工種サマリ: ks, 明細データ: md, 自動計算: ac, 分析: an } = db;

  const newName = summary.projectName;
  const newNum  = summary.estNumber;

  // 物件マスタで照合（物件名 or 見積番号）
  let matchIdx = -1; // 行インデックス（1行目=ヘッダー）
  for (let i = 1; i < pm.length; i++) {
    const rowName = normKey(str(pm[i][1]));
    const rowNum  = normKey(str(pm[i][2]));
    if ((newName && rowName === normKey(newName)) ||
        (newNum  && rowNum  === normKey(newNum))) {
      matchIdx = i;
      break;
    }
  }

  // 物件ID 決定
  let pid;
  if (matchIdx >= 0) {
    pid = str(pm[matchIdx][0]);
    console.log(`  既存レコード更新: ${pid} ${str(pm[matchIdx][1])}`);
  } else {
    // 新規: 最大IDの次番号
    const maxNum = pm.slice(1).reduce((max, r) => {
      const n = parseInt(str(r[0]).replace(/\D/g, ''), 10) || 0;
      return Math.max(max, n);
    }, 0);
    pid = 'P' + String(maxNum + 1).padStart(3, '0');
    console.log(`  新規レコード追加: ${pid} ${newName}`);
  }

  const today = new Date().toISOString().split('T')[0];
  const gt = summary.grandTotal || (summary.workTotal + summary.miscExpenseAmt - summary.discountAmt);
  const ct = summary.costTotal;
  const profRate = gt ? pct(gt - ct, gt) : 0;
  const miscPct  = gt ? pct(summary.miscExpenseAmt, gt) : 0;
  const discPct  = gt ? pct(summary.discountAmt, gt) : 0;

  // --- 物件マスタ行 ---
  const pmRow = [
    pid,
    summary.projectName,
    summary.estNumber,
    '',  // 構造（チェックリストには記載なし）
    '',  // 用途
    '',  // 階数
    '',  // 新築/改修
    summary.client,
    summary.manager,
    '', // 延床面積㎡（チェックリストには記載なし）
    '', // 延床面積坪
    gt, ct, profRate,
    '', // ㎡単価
    '', // 坪単価
    summary.miscExpenseAmt, miscPct,
    summary.discountAmt, discPct,
    '本丸EX', '○',
  ];

  // 既存行がある場合、構造/用途/㎡数などは既存値を保持
  if (matchIdx >= 0) {
    const ex = pm[matchIdx];
    pmRow[3]  = str(ex[3])  || pmRow[3];   // 構造
    pmRow[4]  = str(ex[4])  || pmRow[4];   // 用途
    pmRow[5]  = str(ex[5])  || pmRow[5];   // 階数
    pmRow[6]  = str(ex[6])  || pmRow[6];   // 新築/改修
    pmRow[9]  = str(ex[9])  || pmRow[9];   // 延床面積㎡
    pmRow[10] = str(ex[10]) || pmRow[10];  // 延床面積坪
    pmRow[14] = pmRow[9]  ? Math.round(gt / num(pmRow[9]))  : '';
    pmRow[15] = pmRow[10] ? Math.round(gt / num(pmRow[10])) : '';
    pmRow[21] = str(ex[21]) || '○';        // 有効フラグ保持
  }

  if (matchIdx >= 0) {
    pm[matchIdx] = pmRow;
  } else {
    pm.push(pmRow);
  }

  // --- 工種サマリ: 既存の同物件行を削除して再挿入 ---
  // ヘッダー行 (index 0) を保持、対象pid行を除去
  const ksHeader = ks[0];
  const ksOther  = ks.slice(1).filter(r => str(r[0]) !== pid);
  const ksNew = summary.koshuList.map(k => {
    const totalSell = summary.workTotal || 1;
    const totalCost = ct || 1;
    return [
      pid, summary.projectName, k.name,
      k.sellAmt, k.costAmt,
      k.profitRate || pct(k.sellAmt - k.costAmt, k.sellAmt),
      pct(k.sellAmt, totalSell),
      pct(k.costAmt, totalCost),
      k.laborHours || '',
    ];
  });
  ks.length = 0;
  ks.push(ksHeader, ...ksOther, ...ksNew);

  // --- 明細データ: 既存の同物件行を削除して再挿入 ---
  const mdHeader = md[0];
  const mdOther  = md.slice(1).filter(r => str(r[0]) !== pid);
  const mdNew = items.map(it => [
    pid,
    it.koshuName,
    it.name,
    it.spec,
    it.unit,
    it.qty,
    it.sellPrice,
    it.sellAmt,
    it.costPrice,
    it.costAmt,
    it.bukariki,
    it.laborHours,
    it.listPrice || '',
    it.sellRate  || '',
    it.costRate  || '',
  ]);
  md.length = 0;
  md.push(mdHeader, ...mdOther, ...mdNew);

  // --- 分析: 同物件行を削除して再挿入 ---
  const anHeader = an[0];
  const anOther  = an.slice(1).filter(r => normKey(str(r[0])) !== normKey(summary.projectName));
  const sqm  = num(pmRow[9]);
  const tsubo = num(pmRow[10]);
  const anNew = [[
    summary.projectName, pmRow[3], pmRow[4], pmRow[6],
    gt, ct, profRate,
    sqm || '', tsubo || '',
    sqm ? Math.round(gt / sqm) : '',
    tsubo ? Math.round(gt / tsubo) : '',
  ]];
  an.length = 0;
  an.push(anHeader, ...anOther, ...anNew);

  // --- 書き出し ---
  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(pm), '物件マスタ');
  XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(ks), '工種サマリ');
  XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(md), '明細データ');
  XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(ac), '自動計算パラメータ');
  XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(an), '分析');

  XLSX.writeFile(newWb, JISSEKI_PATH);

  console.log(`  物件マスタ: ${pm.length - 1}件`);
  console.log(`  工種サマリ: ${ks.length - 1}行`);
  console.log(`  明細データ: ${md.length - 1}行`);
  console.log(`  保存完了: ${JISSEKI_PATH}`);
}

// ===== メイン =====
const folderArg = process.argv[2];
if (!folderArg) {
  console.error('使い方: node scripts/update-jisseki.js "<フォルダパス>"');
  process.exit(1);
}

const folder = folderArg.replace(/\\/g, '/');
if (!fs.existsSync(folder)) {
  console.error('フォルダが見つかりません:', folder);
  process.exit(1);
}

console.log('フォルダ:', path.basename(folder));

try {
  const summaryFile = findFile(folder, /実行予算書.*表紙.*総括表.*\.xls/i) ||
                      findFile(folder, /表紙.*総括表.*\.xls/i);
  const checkFile   = findFile(folder, /見積明細チェックリスト.*\.xls/i) ||
                      findFile(folder, /チェックリスト.*\.xls/i);
  const kikiFile    = findFile(folder, /実行予算書.*機器.*\.xls/i) ||
                      findFile(folder, /機器.*\.xls/i);

  if (!checkFile)   { console.error('  見積明細チェックリストが見つかりません'); process.exit(1); }
  if (!summaryFile) { console.warn('  表紙総括表が見つかりません（諸経費・値引き情報なし）'); }

  console.log('  チェックリスト:', path.basename(checkFile));
  if (summaryFile) console.log('  表紙総括表:    ', path.basename(summaryFile));
  if (kikiFile)    console.log('  機器:          ', path.basename(kikiFile));

  // 解析
  const summary = summaryFile ? parseSummary(summaryFile) : { projectName: path.basename(folder), estNumber: '', client: '', manager: '', koshuList: [], miscExpenseAmt: 0, discountAmt: 0, grandTotal: 0, costTotal: 0, workTotal: 0 };
  let items = parseChecklist(checkFile);
  if (kikiFile) {
    const kikiMap = parseKiki(kikiFile);
    items = enrichWithKiki(items, kikiMap);
  }

  console.log(`  品目数: ${items.length}件`);
  console.log(`  諸経費: ${summary.miscExpenseAmt.toLocaleString()}円`);
  console.log(`  値引き: ${summary.discountAmt.toLocaleString()}円`);
  console.log(`  見積合計: ${summary.grandTotal.toLocaleString()}円`);

  // 実績DB更新
  const db = loadJisseki(JISSEKI_PATH);
  updateJisseki(db, summary, items, path.basename(folder));

} catch (e) {
  console.error('エラー:', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
}
