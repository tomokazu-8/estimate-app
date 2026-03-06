/**
 * 本丸EX 明細チェックリスト → ナレッジDB一括インポートスクリプト
 *
 * 使い方:
 *   node scripts/import-honmaru-knowledge.js <フォルダパス>
 *   node scripts/import-honmaru-knowledge.js <ファイル1.xlsx> <ファイル2.xlsx> ...
 *
 * 出力:
 *   knowledge_import_YYYYMMDD.xlsx（2シート構成）
 *   → estimate-app の「ナレッジDBインポート」で読み込む
 *
 * 注意:
 *   構造・種別・用途・坪数は出力後Excelで記入してからインポートしてください
 */

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ===== 自動計算行の判定（convert-honmaru.js と同じ） =====
const AUTO_CODE_RE = /^[A-Z]\d+$/;
const AUTO_NAMES = [
  '雑材料消耗品', '電工労務費', '器具取付費', '器具取付け費', '器具取付け接続費',
  '埋込器具用天井材開口費', '天井材開口費', '運搬費', '機器取付費',
  '機器取付け及び試験調整費', 'UTPケーブル試験費',
];

function isAutoRow(r) {
  const c0 = String(r[0] || '');
  const c1 = String(r[1] || '');
  if (AUTO_CODE_RE.test(c0) || AUTO_CODE_RE.test(c1)) return true;
  const s9  = String(r[9]  || '');
  const s10 = String(r[10] || '');
  if (s9.startsWith('＜自動計算') || s10.startsWith('＜自動計算')) return true;
  const name = String(r[3] || '').trim();
  if (AUTO_NAMES.includes(name)) return true;
  return false;
}

// ===== ヘッダー行・空行の判定 =====
const HEADER_KEYWORDS = [
  '集計', '工種名', '使用パターン', '工事名', '工事名２',
  '得意先', 'ｺｰﾄﾞ', '品 名', '品名', '規格', '数量',
];
function isSkipRow(r) {
  const c0 = String(r[0] || '');
  const c3 = String(r[3] || '');
  if (HEADER_KEYWORDS.includes(c0) || HEADER_KEYWORDS.includes(c3)) return true;
  if (r.every(v => v === '' || v === null || v === undefined)) return true;
  return false;
}

// ===== ヘッダー行から物件情報を抽出 =====
function extractProjectInfo(r, info) {
  const c0 = String(r[0] || '').trim();
  const c3 = String(r[3] || '').trim();
  if (c0 === '工事名' || c0 === '工事名２') {
    if (!info.name && c3) info.name = c3;
  }
  if (c0 === '得意先') {
    if (!info.client && c3) info.client = c3;
  }
}

// ===== セクション行の判定（工種区切り） =====
function isSectionHeader(r) {
  const name = String(r[3] || '').trim();
  if (!name || name.length === 0 || name.length > 40) return false;

  // 価格がある行は品目行
  const isLayoutB = typeof r[0] === 'number';
  const prices = isLayoutB
    ? [r[20], r[28]]
    : [r[19], r[27]];
  if (prices.some(v => parseFloat(v) > 0)) return false;

  // 数量がある行も品目行
  const qty = isLayoutB ? r[16] : r[15];
  if (parseFloat(qty) > 0) return false;

  // 単位のある行も品目行
  const unit = String(r[14] || '').trim();
  if (unit) return false;

  // AUTO_NAMES に含まれる行は自動計算行
  if (AUTO_NAMES.includes(name)) return false;

  // HEADER_KEYWORDS に含まれる行はスキップ行
  if (HEADER_KEYWORDS.includes(name)) return false;

  return true;
}

// ===== 1行から品目データを抽出 =====
function extractItem(r) {
  const name = String(r[3] || '').trim();
  if (!name) return null;

  const isLayoutB = typeof r[0] === 'number';
  let spec, unit, qty, sellPrice, costPrice;

  if (isLayoutB) {
    spec      = String(r[9]  || '').trim();
    unit      = String(r[14] || '').trim();
    qty       = parseFloat(r[16]) || 0;
    sellPrice = parseFloat(r[20]) || 0;
    costPrice = parseFloat(r[28]) || 0;
  } else {
    spec      = String(r[10] || '').trim();
    unit      = String(r[14] || '').trim();
    qty       = parseFloat(r[15]) || 0;
    sellPrice = parseFloat(r[19]) || 0;
    costPrice = parseFloat(r[27]) || 0;
  }

  if (!unit || sellPrice <= 0) return null;

  return {
    name,
    spec,
    qty,
    unit,
    price:    sellPrice,
    costPrice,
    amount:   Math.round(qty * sellPrice),
    costAmount: Math.round(qty * costPrice),
  };
}

// ===== 1つのExcelファイルから物件データを抽出 =====
function parseHonmaruFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const info = { name: '', client: '' };
  const sections = {};   // 工種名 → items[]
  let currentSection = '一式';
  let sellTotal = 0;
  let costTotal = 0;

  for (const r of rows) {
    // 実際のレイアウト: 工事名・得意先・工種名は col[0] にキー、col[4] に値
    const c0 = String(r[0] || '').trim();
    const c4 = String(r[4] || '').trim();

    if (c0 === '工事名' || c0 === '工事名２') {
      if (!info.name && c4) info.name = c4;
      continue;
    }
    if (c0 === '得意先') {
      if (!info.client && c4) info.client = c4;
      continue;
    }
    if (c0 === '工種名') {
      // 工種切替（isSkipRow より先に処理する）
      if (c4) currentSection = c4;
      continue;
    }

    if (isSkipRow(r)) continue;
    if (isAutoRow(r)) continue;

    // セクション行（工種名以外での区切り検出）
    const c3 = String(r[3] || '').trim();
    if (isSectionHeader(r)) {
      currentSection = c3 || currentSection;
      continue;
    }

    // 品目行
    const item = extractItem(r);
    if (!item) continue;

    if (!sections[currentSection]) sections[currentSection] = [];
    sections[currentSection].push(item);
    sellTotal += item.amount;
    costTotal += item.costAmount;
  }

  // 利益率計算
  const profitRate = sellTotal > 0
    ? Math.round((1 - costTotal / sellTotal) * 1000) / 10
    : 0;

  // ファイル名から物件名をフォールバック
  if (!info.name) {
    info.name = path.basename(filePath, path.extname(filePath));
  }

  return {
    name:       info.name,
    client:     info.client,
    sections,   // { 工種名: [ items ] }
    grandTotal: Math.round(sellTotal),
    profitRate,
    itemCount:  Object.values(sections).reduce((n, items) => n + items.length, 0),
  };
}

// ===== メイン =====
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('使い方: node scripts/import-honmaru-knowledge.js <フォルダ or ファイル...>');
    process.exit(1);
  }

  // 対象ファイルを収集
  const targetFiles = [];
  for (const arg of args) {
    const resolved = path.resolve(arg);
    if (fs.statSync(resolved).isDirectory()) {
      fs.readdirSync(resolved)
        .filter(f => f.match(/\.xlsx?$/i) && !f.startsWith('~'))
        .forEach(f => targetFiles.push(path.join(resolved, f)));
    } else if (arg.match(/\.xlsx?$/i)) {
      targetFiles.push(resolved);
    }
  }

  if (targetFiles.length === 0) {
    console.error('Excelファイルが見つかりません');
    process.exit(1);
  }

  console.log(`処理対象: ${targetFiles.length} 件`);

  // ===== 各ファイルを変換 =====
  const projects = [];
  let idCounter = 1;

  for (const filePath of targetFiles) {
    const fname = path.basename(filePath);
    try {
      const data = parseHonmaruFile(filePath);
      console.log(`  [${idCounter}] ${data.name} — ${data.itemCount}品目 / 合計: ¥${data.grandTotal.toLocaleString()} / 利益率: ${data.profitRate}%`);
      projects.push({ id: idCounter++, ...data });
    } catch (e) {
      console.warn(`  [スキップ] ${fname}: ${e.message}`);
    }
  }

  if (projects.length === 0) {
    console.error('変換できたファイルがありません');
    process.exit(1);
  }

  // ===== ナレッジDB XLSX を生成 =====
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0];

  // Sheet1: プロジェクト一覧
  const rows1 = [['id', '登録日', '物件名', '構造', '種別', '用途', '坪数', '合計金額', '利益率', '有効', '得意先（参考）']];
  projects.forEach(p => rows1.push([
    p.id, today, p.name,
    '',   // 構造 ← 記入してください
    '',   // 種別 ← 記入してください
    '',   // 用途 ← 記入してください
    '',   // 坪数 ← 記入してください
    p.grandTotal, p.profitRate, '○', p.client,
  ]));
  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 8 },
    { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'プロジェクト一覧');

  // Sheet2: 明細
  const rows2 = [['project_id', '工種名', '品目名', '規格', '数量', '単位', '単価', '金額']];
  projects.forEach(p => {
    Object.entries(p.sections).forEach(([catName, items]) => {
      items.forEach(i => {
        rows2.push([p.id, catName, i.name, i.spec, i.qty, i.unit, i.price, i.amount]);
      });
    });
  });
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [
    { wch: 5 }, { wch: 16 }, { wch: 30 }, { wch: 20 },
    { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '明細');

  // 出力
  const outName = `knowledge_import_${today.replace(/-/g, '')}.xlsx`;
  const outDir = path.dirname(targetFiles[0]);
  const outPath = path.join(outDir, outName);

  XLSX.writeFile(wb, outPath);

  console.log(`\n✅ 出力完了: ${outPath}`);
  console.log(`  ${projects.length} 件の物件データを変換しました`);
  console.log(`  ${rows2.length - 1} 行の明細データ`);
  console.log('\n次のステップ:');
  console.log('  1. 出力されたExcelを開く');
  console.log('  2.「プロジェクト一覧」シートの 構造・種別・用途・坪数 を記入');
  console.log('     例: 構造=RC, 種別=新築, 用途=事務所, 坪数=120');
  console.log('  3. estimate-app のナレッジDB画面 → 「インポート」で読み込む');
}

main();
