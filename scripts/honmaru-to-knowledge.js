/**
 * 本丸EX 過去物件フォルダ → ナレッジDBインポートファイル変換スクリプト v2
 *
 * 3ファイルをクロスリファレンスして完全なナレッジレコードを生成:
 *   1. 見積明細チェックリスト → 品目詳細（品名/規格/数量/単位/見積/原価/歩掛）
 *   2. 実行予算書(表紙総括表) → 金額サマリー（諸経費/値引き/利益率/工種別工数）
 *   3. 実行予算書(機器)       → 定価・見積掛率・原価掛率（任意補完）
 *
 * 使い方:
 *   node scripts/honmaru-to-knowledge.js <フォルダパス>
 *
 * 出力:
 *   knowledge_import_YYYYMMDD.xlsx（プロジェクト一覧 + 明細 の2シート）
 *   → アプリのナレッジDBパネル → Excelインポートで読み込む
 */

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ===== ユーティリティ =====

function str(v) { return String(v == null ? '' : v).trim(); }
function num(v) { return parseFloat(v) || 0; }

// スペース（全角含む）を除去した正規化ラベル比較用
function normLabel(s) { return str(s).replace(/[\s\u3000]+/g, ''); }

// 品名マッチング用（NFKC + 半角化 + スペース除去）
function normName(s) { return str(s).normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, ''); }

// Excelシリアル日付 → 'YYYY-MM-DD'
function excelDate(n) {
  if (typeof n !== 'number' || n <= 0) return '';
  const d = XLSX.SSF.parse_date_code(n);
  if (!d || !d.y) return '';
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

// ===== フォルダスキャン =====

function getProjectFolders(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(dir, entry.name);
    const files = fs.readdirSync(folderPath);
    const checklist = files.find(f => /見積明細チェックリスト/i.test(f) && /\.(xls|xlsx)$/i.test(f));
    if (!checklist) continue;
    const summary = files.find(f => /実行予算書.*表紙/i.test(f) && /\.(xls|xlsx)$/i.test(f));
    const kiki    = files.find(f => /実行予算書.*機器/i.test(f) && /\.(xls|xlsx)$/i.test(f));
    results.push({
      folderName: entry.name,
      folderPath,
      checklistPath: path.join(folderPath, checklist),
      summaryPath:   summary ? path.join(folderPath, summary) : null,
      kikiPath:      kiki    ? path.join(folderPath, kiki)    : null,
    });
  }
  return results;
}

// ===== フォルダ名から物件情報を推定 =====

function parseFromFolderName(folderName) {
  const numMatch = folderName.match(/^(\d{4}-\d{2})/);
  const number = numMatch ? numMatch[1] : '';
  const projectName = folderName.replace(/^\d{4}-\d{2}/, '').trim() || folderName;

  let type = '';
  if (/新築/.test(folderName))                                        type = '新築';
  else if (/改修|リノベーション|現状回復|更新|取替/.test(folderName)) type = '改修';

  let usage = '';
  if (/保育|幼稚/.test(folderName))                    usage = '保育施設';
  else if (/病院|クリニック|サルーテ/.test(folderName)) usage = '医療';
  else if (/店舗|飲食|肉の/.test(folderName))           usage = '店舗';
  else if (/倉庫|工場|練習場/.test(folderName))         usage = '工場・倉庫';
  else if (/事務所/.test(folderName))                   usage = '事務所';
  else if (/邸|住宅|ハイツ|コーポ|ハウス|マンション|アパート|号室/.test(folderName)) usage = '住宅';

  return { number, projectName, type, usage };
}

// ===== 見積明細チェックリスト解析 =====
//
// カラム定義（0始まりインデックス）:
//   r[1]  = 行種別ラベル（見積番号/工事名/工事名２/得意先/工種名）
//   r[2]  = 集計コード（ZZZ=通常品目, A10/X89/XA5=自動計算行）
//   r[3]  = 品名
//   r[4]  = 工事名・見積番号値（ヘッダー行のみ）
//   r[7]  = 規格（＜自動計算で始まる場合はスキップ）
//   r[9]  = 単位
//   r[10] = 見積数量
//   r[13] = 見積単価
//   r[14] = 工種合計（工種名行のみ）
//   r[15] = 見積金額
//   r[17] = 原価単価
//   r[19] = 原価金額
//   r[22] = 歩掛
//   r[24] = 工数（= 歩掛 × 数量）

function parseChecklist(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let number = '', projectName = '', client = '', person = '';
  const categories = [];
  let currentCat = null;
  let headerCount = 0;

  for (const r of rows) {
    const c0 = str(r[0]);
    const c1 = str(r[1]);
    const c2 = str(r[2]);

    // ページ繰り返し検出（2ページ目以降はスキップ）
    if (c0.includes('見積明細チェックリスト') || c1 === '見積明細チェックリスト') {
      headerCount++;
      if (headerCount >= 2) break;
      continue;
    }

    // プロジェクト情報行
    if (c1 === '見積番号' && !number) { number = str(r[4]); continue; }
    if (c1 === '工事名'  && !projectName) { projectName = str(r[4]); continue; }
    if (c1 === '工事名２') { person = str(r[14]); continue; }
    if (c1 === '得意先'  && !client) { client = str(r[4]); continue; }

    // 工種名行 → 新しいカテゴリ開始
    if (c1 === '工種名') {
      const catName   = str(r[4]);
      const catTotal  = num(r[14]);
      const catCost   = num(r[16]);
      const catProfit = Math.round(num(r[18]) * 10) / 10;
      if (catName) {
        currentCat = { name: catName, total: catTotal, costTotal: catCost, profitRate: catProfit, laborHours: 0, items: [] };
        categories.push(currentCat);
      }
      continue;
    }

    // ヘッダー行・空行をスキップ
    if (!c2 && !str(r[3])) continue;
    if (c2 === '集計' || str(r[3]) === '品 名' || str(r[3]) === '品名') continue;

    // 自動計算行をスキップ（コードが英字+数字、または規格が「＜自動計算」）
    if (/^[A-Z]{1,3}\d+$/.test(c2)) continue;
    const specRaw = str(r[7]);
    if (specRaw.startsWith('＜自動計算') || specRaw.startsWith('<自動計算')) continue;

    // 品目行（currentCat がなければスキップ）
    if (!currentCat) continue;
    const name = str(r[3]);
    if (!name) continue;

    // 規格から参照記号（＜... や <...）を除去
    const spec = specRaw.replace(/[＜<][^>]*$/, '').trim();

    const unit       = str(r[9]);
    const qty        = num(r[10]);
    const price      = num(r[13]);
    const amount     = num(r[15]) || Math.round(qty * price);
    const costPrice  = num(r[17]);
    const costAmount = num(r[19]) || Math.round(qty * costPrice);
    const bukariki   = num(r[22]);
    const laborHours = num(r[24]);

    if (!unit || price <= 0) continue;

    currentCat.items.push({
      name,
      spec,
      qty,
      unit,
      listPrice:   0,   // 機器ファイルで補完
      price:       Math.round(price),
      sellRate:    0,   // 機器ファイルで補完
      costPrice:   Math.round(costPrice),
      costRate:    0,   // 機器ファイルで補完
      amount:      Math.round(amount),
      costAmount:  Math.round(costAmount),
      bukariki,
      laborHours,
    });
  }

  return { number, projectName, client, person, categories };
}

// ===== 実行予算書(表紙総括表)解析 =====
//
// カラム定義（0始まり）:
//   Row1: r[8]="工事名", r[9]=工事名, r[19]="見積番号", r[21]=見積番号
//   Row3: r[8]="得意先", r[9]=得意先名, r[19]="担当者名", r[21]=担当者名
//   Row5: r[1]="見積日付", r[2]=Excelシリアル日付
//   BodyRow: r[1]=工種名, r[13]=見積金額, r[15]=実行金額(原価), r[16]=工数, r[18]=粗利, r[20]=粗利率%
//   合計行: r[1]="　　合　計"（スペース多め → normLabelで "合計"）

function parseSummary(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let number = '', projectName = '', client = '', person = '', date = '';
  let workTotal = 0, miscExpenseAmt = 0, discountAmt = 0;
  let grandTotal = 0, costTotal = 0, profitRate = 0;
  const cats = [];
  let inBody = false;

  for (const r of rows) {
    const c1label = normLabel(str(r[1]));

    if (!inBody) {
      // Row1: 工事名・見積番号
      if (str(r[8]) === '工事名' && str(r[19]) === '見積番号') {
        projectName = str(r[9]);
        number = str(r[21]);
      }
      // Row3: 得意先・担当者
      if (str(r[8]) === '得意先' && str(r[19]) === '担当者名') {
        client = str(r[9]);
        person = str(r[21]);
      }
      // Row5: 見積日付
      if (str(r[1]) === '見積日付') {
        date = excelDate(r[2]);
      }
      // Body開始: 工種名ヘッダー行
      if (c1label === '工種名') {
        inBody = true;
      }
      continue;
    }

    // 合計行（スペース除去後に "合計" を含む）
    if (c1label.includes('合計') && c1label !== '工種名') {
      grandTotal = num(r[13]);
      costTotal  = num(r[15]);
      profitRate = Math.round(num(r[20]) * 10) / 10;
      break;
    }

    const catName = str(r[1]);
    if (!catName) continue;

    const rowTotal  = num(r[13]);
    const rowCost   = num(r[15]);
    const rowHours  = num(r[16]);
    const rowProfit = Math.round(num(r[20]) * 10) / 10;

    // 諸経費
    if (normLabel(catName) === '諸経費') {
      miscExpenseAmt = rowTotal;
    }
    // 値引き（「△」始まり or 「値引」を含む）
    else if (catName.startsWith('△') || normLabel(catName).includes('値引')) {
      discountAmt = Math.abs(rowTotal);
    }
    // 通常工種
    else {
      workTotal += rowTotal;
      cats.push({ name: catName, total: rowTotal, costTotal: rowCost, laborHours: rowHours, profitRate: rowProfit });
    }
  }

  const miscExpensePct = workTotal > 0 ? Math.round(miscExpenseAmt / workTotal * 1000) / 10 : 0;
  const base = workTotal + miscExpenseAmt;
  const discountPct = base > 0 ? Math.round(discountAmt / base * 1000) / 10 : 0;

  return { number, projectName, client, person, date, workTotal, miscExpenseAmt, miscExpensePct, discountAmt, discountPct, grandTotal, costTotal, profitRate, cats };
}

// ===== 実行予算書(機器)解析 → 品名をキーにした価格辞書 =====
//
// カラム定義（0始まり）:
//   BodyRow: r[1]=品名, r[5]=規格, r[8]=単位, r[9]=数量, r[13]=定価,
//            r[15]=見積掛率%, r[16]=見積単価, r[18]=見積金額,
//            r[19]=原価掛率%, r[20]=原価単価, r[21]=原価金額

function parseKiki(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const map = new Map(); // normName(品名) → { listPrice, sellRate, costRate }
  let inBody = false;

  for (const r of rows) {
    // ページヘッダー検出 → body リセット
    const c7 = str(r[7]);
    if (c7.includes('実 行 計 算 書') || normLabel(c7).includes('実行計算書')) {
      inBody = false;
      continue;
    }
    // ボディヘッダー行検出（品名 + 定価が揃う行）
    if (normLabel(str(r[1])) === '品名' && normLabel(str(r[13])).includes('定価')) {
      inBody = true;
      continue;
    }
    if (!inBody) continue;

    // 小計行・空行をスキップ
    const c1 = str(r[1]);
    if (!c1 || normLabel(c1).includes('小計') || c1.includes('＊')) continue;

    const listPrice = num(r[13]);
    const sellRate  = num(r[15]);
    const costRate  = num(r[19]);

    if (!c1 || listPrice <= 0) continue;

    const key = normName(c1);
    if (!map.has(key)) {
      map.set(key, { listPrice, sellRate: Math.round(sellRate * 10) / 10, costRate: Math.round(costRate * 10) / 10 });
    }
  }

  return map;
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
  const projects = getProjectFolders(dirPath);
  console.log('物件フォルダ数:', projects.length, '件\n');

  if (projects.length === 0) {
    console.error('見積明細チェックリストが見つかりません');
    process.exit(1);
  }

  const records = [];
  let pid = 1;

  for (const proj of projects) {
    process.stdout.write('  ' + proj.folderName + ' ... ');
    try {
      const { number: folderNum, projectName: folderName, type, usage } = parseFromFolderName(proj.folderName);

      // 1. チェックリスト解析（主データ）
      const cl = parseChecklist(proj.checklistPath);

      // 2. 表紙総括表解析（金額サマリー）
      let summary = null;
      if (proj.summaryPath) {
        try { summary = parseSummary(proj.summaryPath); } catch(e) { /* fallback */ }
      }

      // 3. 機器解析（価格補完）
      let kikiMap = new Map();
      if (proj.kikiPath) {
        try { kikiMap = parseKiki(proj.kikiPath); } catch(e) { /* fallback */ }
      }

      // 品目に機器データを補完（定価・見積掛率・原価掛率）
      for (const cat of cl.categories) {
        for (const item of cat.items) {
          const kd = kikiMap.get(normName(item.name));
          if (kd) {
            item.listPrice = kd.listPrice;
            item.sellRate  = kd.sellRate;
            item.costRate  = kd.costRate;
          }
        }
      }

      // 工種別工数・原価・粗利率を表紙総括表から補完
      if (summary && summary.cats.length > 0) {
        for (const cat of cl.categories) {
          const sc = summary.cats.find(c => normLabel(c.name) === normLabel(cat.name));
          if (sc) {
            cat.laborHours = sc.laborHours;
            if (sc.total > 0)    cat.total      = sc.total;
            if (sc.costTotal > 0) cat.costTotal  = sc.costTotal;
            if (sc.profitRate > 0) cat.profitRate = sc.profitRate;
          }
        }
      }

      // プロジェクト情報（優先: チェックリスト > 表紙総括表 > フォルダ名）
      const number      = cl.number      || (summary && summary.number)      || folderNum;
      const projectName = cl.projectName || (summary && summary.projectName) || folderName;
      const client      = cl.client      || (summary && summary.client)      || '';
      const person      = cl.person      || (summary && summary.person)      || '';
      const date        = (summary && summary.date) ||
                          new Date(fs.statSync(proj.checklistPath).mtime).toISOString().split('T')[0];

      // 金額サマリー（表紙総括表優先）
      const grandTotal     = (summary && summary.grandTotal > 0) ? summary.grandTotal
                           : cl.categories.reduce((s, c) => s + c.total, 0);
      const costTotal      = (summary && summary.costTotal)      || 0;
      const workTotal      = (summary && summary.workTotal)      || grandTotal;
      const miscExpenseAmt = (summary && summary.miscExpenseAmt) || 0;
      const miscExpensePct = (summary && summary.miscExpensePct) || 0;
      const discountAmt    = (summary && summary.discountAmt)    || 0;
      const discountPct    = (summary && summary.discountPct)    || 0;
      const profitRate     = (summary && summary.profitRate)     || 0;

      const itemCount = cl.categories.reduce((s, c) => s + c.items.length, 0);
      if (itemCount === 0) { console.log('スキップ（品目なし）'); continue; }

      records.push({
        id: pid++,
        source: 'honmaru',
        registeredAt: new Date().toISOString().split('T')[0],
        project: {
          number, name: projectName, date, client, person,
          struct: '', type, usage,
          floors: '', areaTsubo: '', areaSqm: '',
        },
        workTotal:      Math.round(workTotal),
        miscExpenseAmt: Math.round(miscExpenseAmt),
        miscExpensePct,
        discountAmt:    Math.round(discountAmt),
        discountPct,
        grandTotal:     Math.round(grandTotal),
        costTotal:      Math.round(costTotal),
        profitRate,
        categories: cl.categories,
      });

      const profitStr = profitRate > 0 ? ` 利益率${profitRate}%` : '';
      console.log(`OK (${itemCount}品目, ${cl.categories.length}工種, ¥${grandTotal.toLocaleString()}${profitStr})`);
    } catch(e) {
      console.log('エラー: ' + e.message);
      if (process.env.DEBUG) console.error(e.stack);
    }
  }

  if (records.length === 0) {
    console.error('\n取り込み可能な物件がありませんでした');
    process.exit(1);
  }

  // ===== XLSX出力 =====
  const outWb = XLSX.utils.book_new();

  // Sheet1: プロジェクト一覧
  const h1 = [
    'id','登録日','見積番号','物件名','得意先','担当者',
    '構造','種別','用途','坪数','㎡数',
    '工事費合計','諸経費金額','諸経費率%','値引き金額','値引き率%',
    '税抜合計','原価合計','利益率%','データソース','有効',
  ];
  const rows1 = [h1];
  for (const r of records) {
    const p = r.project;
    rows1.push([
      r.id, r.registeredAt, p.number, p.name, p.client, p.person,
      p.struct, p.type, p.usage, p.areaTsubo, p.areaSqm,
      r.workTotal, r.miscExpenseAmt, r.miscExpensePct, r.discountAmt, r.discountPct,
      r.grandTotal, r.costTotal, r.profitRate,
      r.source, '○',
    ]);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [
    {wch:4},{wch:12},{wch:10},{wch:30},{wch:20},{wch:10},
    {wch:6},{wch:6},{wch:10},{wch:6},{wch:6},
    {wch:12},{wch:10},{wch:8},{wch:10},{wch:8},{wch:12},{wch:12},{wch:8},
    {wch:10},{wch:4},
  ];
  XLSX.utils.book_append_sheet(outWb, ws1, 'プロジェクト一覧');

  // Sheet2: 明細
  const h2 = [
    'project_id','工種名','工種合計','工種原価合計','工種工数','工種粗利率%',
    '品目名','規格','数量','単位',
    '定価','見積単価','見積掛率%','原価単価','原価掛率%',
    '見積金額','原価金額','歩掛','工数',
  ];
  const rows2 = [h2];
  for (const r of records) {
    for (const cat of r.categories) {
      for (const item of cat.items) {
        rows2.push([
          r.id, cat.name, cat.total, cat.costTotal, cat.laborHours, cat.profitRate,
          item.name, item.spec, item.qty, item.unit,
          item.listPrice, item.price, item.sellRate, item.costPrice, item.costRate,
          item.amount, item.costAmount, item.bukariki, item.laborHours,
        ]);
      }
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [
    {wch:4},{wch:16},{wch:12},{wch:12},{wch:8},{wch:8},
    {wch:30},{wch:20},{wch:6},{wch:6},
    {wch:10},{wch:10},{wch:8},{wch:10},{wch:8},{wch:10},{wch:10},{wch:8},{wch:8},
  ];
  XLSX.utils.book_append_sheet(outWb, ws2, '明細');

  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g,'');
  const outName = 'knowledge_import_' + dateStr + '.xlsx';
  const outPath = path.join(dirPath, outName);
  XLSX.writeFile(outWb, outPath);

  const totalItems = rows2.length - 1;
  console.log('\n✅ 完了:', outPath);
  console.log('  物件数:', records.length);
  console.log('  総品目数:', totalItems);
  console.log('\n次のステップ:');
  console.log('  1. ' + outName + ' をExcelで開いて確認');
  console.log('  2. 「プロジェクト一覧」の 構造・坪数・㎡数 を手入力（任意）');
  console.log('  3. アプリ ナレッジDBパネル → Excelインポート → このファイルを選択');
}

main();
