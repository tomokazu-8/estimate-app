/**
 * 本丸EX 過去物件フォルダ → ナレッジDBインポートファイル変換スクリプト
 *
 * 使い方:
 *   node scripts/honmaru-to-knowledge.js <フォルダパス> [出力ファイル名]
 *
 * 例:
 *   node scripts/honmaru-to-knowledge.js "C:/Users/pal19/OneDrive/.../過去物件明細"
 *   → knowledge_import_20260307.xlsx が出力される
 *
 * 処理内容:
 *   - フォルダ内の .xlsx / .xls ファイルを全て読み込む（サブフォルダも対応）
 *   - 各ファイルを1物件として認識
 *   - シート名 → 工種名、行データ → 品目として取り込む
 *   - knowledge_import_YYYY-MM-DD.xlsx を出力（アプリからインポート可能）
 */

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ===== ヘルパー: ファイル一覧を再帰取得 =====
function getXlsxFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getXlsxFiles(fullPath));
    } else if (entry.isFile() && /\.(xlsx|xls)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ===== 自動計算行の判定（本丸EXのコード行を除外） =====
const AUTO_CODE_RE = /^[A-Z]\d+$/;
function isAutoRow(r) {
  const c0 = String(r[0] || '');
  const c1 = String(r[1] || '');
  if (AUTO_CODE_RE.test(c0) || AUTO_CODE_RE.test(c1)) return true;
  // 「＜自動計算」という文字列を含む行を除外
  return r.some(v => String(v || '').startsWith('＜自動計算'));
}

// ===== ヘッダー行・空行の判定 =====
const SKIP_KEYWORDS = ['集計','工種名','使用パターン','工事名','得意先','ｺｰﾄﾞ','品 名','品名','コード', '№'];
function isSkipRow(r) {
  if (r.every(v => v === '' || v === null || v === undefined)) return true;
  const c0 = String(r[0] || '');
  const c3 = String(r[3] || r[2] || '');
  return SKIP_KEYWORDS.some(kw => c0 === kw || c3 === kw);
}

// ===== 1行から明細データを抽出 =====
// 本丸EXの列レイアウト（2パターン対応）
function extractItem(r) {
  const isLayoutB = typeof r[0] === 'number';

  let name, spec, unit, qty, sellPrice;

  if (isLayoutB) {
    name      = String(r[3] || '').trim();
    spec      = String(r[9]  || '').trim();
    unit      = String(r[14] || '').trim();
    qty       = parseFloat(r[16]) || 1;
    sellPrice = parseFloat(r[20]) || 0;
  } else {
    name      = String(r[3] || r[2] || '').trim();
    spec      = String(r[10] || r[9] || '').trim();
    unit      = String(r[14] || r[13] || '').trim();
    qty       = parseFloat(r[15] || r[16]) || 1;
    sellPrice = parseFloat(r[19] || r[20]) || 0;
  }

  if (!name || !unit || sellPrice <= 0) return null;

  return {
    name,
    spec,
    qty,
    unit,
    price:  Math.round(sellPrice),
    amount: Math.round(qty * sellPrice),
  };
}

// ===== ファイル名から物件名を取得 =====
function projectNameFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  // 共通のプレフィックス/サフィックスを除去
  return base.replace(/^(見積書?_?|estimate_?)/i, '').replace(/_?\d{8}$/, '').trim() || base;
}

// ===== ファイルから物件ヘッダー情報を抽出 =====
// Sheet1（表紙）の先頭部分から物件名・金額を検索
function extractProjectMeta(wb, filePath) {
  const sheet1 = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet1, { header: 1, defval: '' });

  let projectName = projectNameFromFile(filePath);
  let grandTotal = 0;
  let dateStr = new Date(fs.statSync(filePath).mtime).toISOString().split('T')[0];

  // 先頭50行から物件名・合計金額を検索
  for (let i = 0; i < Math.min(50, rows.length); i++) {
    const r = rows[i];
    const rowText = r.join('');
    // 物件名候補: 「工事名」キーワードの隣のセル
    if (/工事名|物件名/.test(rowText)) {
      for (let j = 0; j < r.length; j++) {
        const cell = String(r[j] || '');
        if (/工事名|物件名/.test(cell)) {
          const next = String(r[j+1] || r[j+2] || '').trim();
          if (next && next.length > 2 && !/工事名|物件名/.test(next)) {
            projectName = next;
          }
        }
      }
    }
    // 合計金額候補: 大きな数値を含む行
    for (const v of r) {
      const n = parseFloat(String(v).replace(/[,¥￥]/g, ''));
      if (n > 100000 && n > grandTotal) grandTotal = n;
    }
  }

  return { projectName, grandTotal: Math.round(grandTotal), dateStr };
}

// ===== 1ファイルの処理 =====
function processFile(filePath, projectId) {
  const wb = XLSX.readFile(filePath);
  const { projectName, grandTotal, dateStr } = extractProjectMeta(wb, filePath);

  const categories = [];

  // 各シートを工種として処理
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const items = [];
    for (const r of rows) {
      if (isSkipRow(r)) continue;
      if (isAutoRow(r)) continue;
      const item = extractItem(r);
      if (item) items.push(item);
    }

    if (items.length > 0) {
      categories.push({ name: sheetName, items });
    }
  }

  if (categories.length === 0) return null;

  // 合計金額の再計算（ヘッダーから取得できなかった場合）
  const calcTotal = categories
    .flatMap(c => c.items)
    .reduce((s, i) => s + i.amount, 0);
  const total = grandTotal > 0 ? grandTotal : calcTotal;

  return {
    id:          projectId,
    projectName,
    dateStr,
    grandTotal:  Math.round(total),
    categories,
  };
}

// ===== メイン =====
function main() {
  const inputDir = process.argv[2];
  if (!inputDir) {
    console.error('使い方: node scripts/honmaru-to-knowledge.js <フォルダパス>');
    process.exit(1);
  }

  const dirPath = path.resolve(inputDir);
  if (!fs.existsSync(dirPath)) {
    console.error('フォルダが見つかりません:', dirPath);
    process.exit(1);
  }

  console.log('フォルダ:', dirPath);
  const files = getXlsxFiles(dirPath);
  console.log('Excelファイル数:', files.length, '件');
  if (files.length === 0) {
    console.error('Excelファイルが見つかりません');
    process.exit(1);
  }

  // 各ファイルを処理
  const projects = [];
  let pid = 1;
  for (const f of files) {
    process.stdout.write('  処理中: ' + path.basename(f) + ' ... ');
    try {
      const proj = processFile(f, pid);
      if (proj) {
        projects.push(proj);
        console.log('OK (' + proj.categories.flatMap(c => c.items).length + '品目)');
        pid++;
      } else {
        console.log('スキップ（品目なし）');
      }
    } catch(e) {
      console.log('エラー: ' + e.message);
    }
  }

  if (projects.length === 0) {
    console.error('取り込み可能な物件がありませんでした');
    process.exit(1);
  }

  // ===== ナレッジDBインポートExcel を作成 =====
  const outWb = XLSX.utils.book_new();

  // Sheet1: プロジェクト一覧
  const rows1 = [['id','登録日','物件名','構造','種別','用途','坪数','合計金額','利益率','有効']];
  for (const p of projects) {
    rows1.push([p.id, p.dateStr, p.projectName, '', '', '', '', p.grandTotal, '', '○']);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [{wch:6},{wch:12},{wch:30},{wch:8},{wch:8},{wch:8},{wch:6},{wch:12},{wch:8},{wch:6}];
  XLSX.utils.book_append_sheet(outWb, ws1, 'プロジェクト一覧');

  // Sheet2: 明細
  const rows2 = [['project_id','工種名','品目名','規格','数量','単位','単価','金額']];
  for (const p of projects) {
    for (const cat of p.categories) {
      for (const item of cat.items) {
        rows2.push([p.id, cat.name, item.name, item.spec, item.qty, item.unit, item.price, item.amount]);
      }
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [{wch:8},{wch:20},{wch:30},{wch:20},{wch:8},{wch:6},{wch:10},{wch:12}];
  XLSX.utils.book_append_sheet(outWb, ws2, '明細');

  // 出力
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g,'');
  const outName = process.argv[3] || ('knowledge_import_' + dateStr + '.xlsx');
  const outPath = path.join(dirPath, outName);
  XLSX.writeFile(outWb, outPath);

  console.log('\n✅ 完了:', outPath);
  console.log('  物件数:', projects.length);
  console.log('  総品目数:', rows2.length - 1);
  console.log('\n次のステップ:');
  console.log('  1. 出力された', outName, 'をExcelで確認');
  console.log('  2. 「プロジェクト一覧」シートの 構造/種別/用途/坪数 を埋める（任意）');
  console.log('  3. estimate-app のナレッジDBパネルから「JSONインポート」ボタンでこのファイルを取り込む');
}

main();
