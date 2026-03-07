/**
 * 本丸EX 明細チェックリスト + 実行予算書（機器）→ ナレッジDB一括インポートスクリプト
 *
 * 使い方:
 *   node scripts/import-honmaru-knowledge.js <フォルダパス>
 *   node scripts/import-honmaru-knowledge.js <ファイル1.xls> <ファイル2.xls> ...
 *
 * 対応ファイル:
 *   - 明細チェックリスト (.xls/.xlsx)
 *   - 実行予算書（機器）(.xls/.xlsx) — 定価・掛率・原価を明細に付与
 *
 * 出力:
 *   knowledge_import_YYYYMMDD.xlsx（2シート構成）
 */

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ===== 自動計算行の判定 =====
const AUTO_CODE_RE = /^[A-Z]+\d+$/;
const AUTO_NAMES = [
  '雑材料消耗品', '電工労務費', '器具取付費', '器具取付け費', '器具取付け接続費',
  '埋込器具用天井材開口費', '天井材開口費', '運搬費', '機器取付費',
  '機器取付け及び試験調整費', 'UTPケーブル試験費',
];

// ===== 実行予算書（機器）判定 =====
function isJikkoFile(rows) {
  for (const r of rows.slice(0, 5)) {
    for (const cell of r) {
      if (String(cell).replace(/\s/g, '').includes('\u5b9f\u884c\u8a08\u7b97\u66f8')) return true;
    }
  }
  return false;
}

// ===== 実行予算書（表紙総括表）判定 =====
function isHyoshiFile(rows) {
  for (const r of rows.slice(0, 5)) {
    for (const cell of r) {
      if (String(cell).replace(/\s/g, '').includes('総括表')) return true;
    }
  }
  return false;
}

// ===== 実行予算書（表紙総括表）から工事名・見積合計・利益率を抽出 =====
// row[1]: col[8]='工事名', col[9]=工事名値
// 合計行: col[1]に「合計」を含む, col[13]=見積合計, col[20]=粗利率
function parseHyoshiFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let kojiName = '';
  let estimateNo = '';
  let grandTotal = 0;
  let profitRate = 0;

  for (const r of rows) {
    if (String(r[8] || '').trim() === '工事名' && !kojiName) {
      kojiName = String(r[9] || '').trim();
    }
    // 見積番号: col[19]='見積番号', col[21]=番号値
    if (String(r[19] || '').trim() === '見積番号' && !estimateNo) {
      estimateNo = String(r[21] || '').trim();
    }
    // 合計行: col[1]に「合計」を含み、col[13]が正の数値
    if (!grandTotal &&
        String(r[1] || '').replace(/[\s\u3000]/g, '').includes('合計') &&
        parseFloat(r[13]) > 0) {
      grandTotal = parseFloat(r[13]) || 0;
      profitRate = Math.round((parseFloat(r[20]) || 0) * 10) / 10;
    }
  }

  return { kojiName, estimateNo, grandTotal: Math.round(grandTotal), profitRate };
}

// ===== 工事名で対応する表紙総括表データを取得 =====
function findHyoshi(kojiName, hyoshiList) {
  const normA = normKoji(kojiName);
  if (!normA) return null;
  for (const h of hyoshiList) {
    const normB = normKoji(h.kojiName);
    if (normA.includes(normB) || normB.includes(normA)) return h;
  }
  return null;
}

// ===== 実行予算書から工事名・品目を抽出 =====
// col[1]=品名, col[5]=規格, col[8]=単位, col[9]=数量
// col[13]=定価, col[15]=見積掛率(%), col[20]=原価単価, col[21]=原価金額
function parseJikkoFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let kojiName = '';
  const items = [];
  for (const r of rows) {
    const c1 = String(r[1] || '').trim();
    if (c1 === '\u5de5\u4e8b\u540d' || c1 === '\u5de5\u4e8b\u540d\uff12') {
      const val = String(r[2] || '').trim();
      if (!kojiName && val) kojiName = val;
      continue;
    }
    const name = String(r[1] || '').trim();
    if (!name) continue;
    if (/\uff3c|\u5c0f\u3000\u3000\u8a08|\u5408\u3000\u3000\u8a08/.test(name)) continue;
    if (['\u54c1\u3000\u540d', '\u54c1\u540d', '\u5f97\u610f\u5148', '\u898b\u7a4d\u756a\u53f7', '\u62c5\u5f53\u8005\u540d'].includes(name)) continue;
    const unit      = String(r[8] || '').trim();
    const listPrice = parseFloat(r[13]) || 0;
    if (!unit || listPrice <= 0) continue;
    const spec       = String(r[5] || '').trim();
    const qty        = parseFloat(r[9])  || 0;
    const sellRate   = parseFloat(r[15]) || 0;
    const costPrice  = parseFloat(r[20]) || 0;
    const costAmount = parseFloat(r[21]) || 0;
    items.push({ name, spec, unit, qty, listPrice, sellRate, costPrice, costAmount });
  }
  return { kojiName, items };
}

// ===== 工事名正規化（照合用）=====
function normKoji(s) {
  return String(s).replace(/[\s\u3000]/g, '').replace(/\uff08[^\uff09]*\uff09/g, '').replace(/\([^)]*\)/g, '');
}

// ===== 品目照合キー（品名+規格の<以前）=====
function normKey(name, spec) {
  const n = String(name).replace(/[\s\u3000]/g, '');
  const s = String(spec).split('<')[0].replace(/[\s\u3000]/g, '');
  return n + '|' + s;
}

// ===== 実行予算書マップを構築 =====
function buildJikkoMap(items) {
  const map = {};
  for (const item of items) {
    const key = normKey(item.name, item.spec);
    if (!map[key]) {
      map[key] = { listPrice: item.listPrice, sellRate: item.sellRate, costPrice: item.costPrice, costAmount: item.costAmount };
    }
  }
  return map;
}

// ===== 工事名で対応する実行予算書マップを取得 =====
function findJikkoMap(kojiName, jikkoList) {
  const normA = normKoji(kojiName);
  if (!normA) return null;
  for (const { kojiName: jKoji, jikkoMap } of jikkoList) {
    const normB = normKoji(jKoji);
    if (normA.includes(normB) || normB.includes(normA)) return jikkoMap;
  }
  return null;
}

// ===== レイアウト自動検出 =====
function detectLayout(rows) {
  for (const r of rows.slice(0, 30)) {
    const c1 = String(r[1] || '').trim();
    if (['工事名', '得意先', '工種名'].includes(c1)) return 'old';
    const c0 = String(r[0] || '').trim();
    if (['工事名', '得意先', '工種名'].includes(c0)) return 'new';
  }
  return 'old'; // デフォルト
}

// ===== 旧形式: 自動計算行の判定 =====
// col[2] にコード(A10, X89...)、col[7] にスペック、col[3] に名称
function isAutoRowOld(r) {
  const code = String(r[2] || '').trim();
  if (AUTO_CODE_RE.test(code)) return true;
  if (String(r[7] || '').startsWith('＜自動計算')) return true;
  if (AUTO_NAMES.includes(String(r[3] || '').trim())) return true;
  return false;
}

// ===== 新形式: 自動計算行の判定 =====
function isAutoRowNew(r) {
  const c0 = String(r[0] || '');
  const c1 = String(r[1] || '');
  if (AUTO_CODE_RE.test(c0) || AUTO_CODE_RE.test(c1)) return true;
  if (String(r[9]  || '').startsWith('＜自動計算')) return true;
  if (String(r[10] || '').startsWith('＜自動計算')) return true;
  if (AUTO_NAMES.includes(String(r[3] || '').trim())) return true;
  return false;
}

// ===== 空行判定（共通） =====
function isEmptyRow(r) {
  return r.every(v => v === '' || v === null || v === undefined);
}

// ===== ファイル名から 構造・種別・用途 を自動解析 =====
// 命名規則: 物件名（年）、種別、構造、階数（、用途）
function parseFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const parts = base.split('、').map(s => s.trim()).filter(Boolean);

  let struct = '', type = '', usage = '';

  for (const part of parts.slice(1)) {  // 最初の部分は物件名なのでスキップ
    // 種別
    if (/新築/.test(part))                      { type = type || '新築'; continue; }
    if (/改修|リノベ|リフォーム|現状回復/.test(part)) { type = type || '改修'; continue; }
    if (/増築/.test(part))                      { type = type || '増築'; continue; }

    // 構造
    if (/RC|鉄筋/.test(part))   { struct = struct || 'RC'; continue; }
    if (/SRC/.test(part))       { struct = struct || 'SRC'; continue; }
    if (/S造|鉄骨/.test(part))  { struct = struct || 'S'; continue; }
    if (/木造|木/.test(part) && !/複合/.test(part)) { struct = struct || 'W'; continue; }

    // 用途（構造・種別に当てはまらなかった部分）
    if (/住宅|邸|戸建|マンション|アパート|コーポ|集合住宅/.test(part)) { usage = usage || '住宅'; continue; }
    if (/事務所|オフィス|office/i.test(part))  { usage = usage || '事務所'; continue; }
    if (/店舗|ショップ|テナント/.test(part))    { usage = usage || '店舗'; continue; }
    if (/倉庫|作業場|工場|工業/.test(part))     { usage = usage || '倉庫'; continue; }
    if (/保育園|幼稚園|学校|教育/.test(part))   { usage = usage || '教育'; continue; }
    if (/病院|医療|クリニック/.test(part))       { usage = usage || '医療'; continue; }
  }

  // 物件名本体にも種別がある場合のフォールバック
  if (!type) {
    if (/新築/.test(parts[0]))            type = '新築';
    else if (/改修|リノベ/.test(parts[0])) type = '改修';
  }
  // 構造が複合（RC+木造など）
  if (!struct && parts.some(p => /RC.*(木造|S造)|(木造|S造).*RC/.test(p))) struct = 'RC';
  // S造のフォールバック（"S邸"など）
  if (!struct && /S邸/.test(parts[0])) struct = 'S';

  return { struct, type, usage };
}

// ===== 旧形式: 1行から品目データを抽出 =====
// col[2]=code, col[3]=品名, col[7]=規格, col[9]=単位,
// col[10]=見積数量, col[13]=見積単価, col[15]=見積金額,
// col[17]=原価単価, col[19]=原価金額
function extractItemOld(r) {
  const name = String(r[3] || '').trim();
  if (!name) return null;

  const spec      = String(r[7]  || '').trim();
  const unit      = String(r[9]  || '').trim();
  const qty       = parseFloat(r[10]) || 0;
  const sellPrice = parseFloat(r[13]) || 0;
  const sellAmt   = parseFloat(r[15]) || Math.round(qty * sellPrice);
  const costPrice = parseFloat(r[17]) || 0;
  const costAmt   = parseFloat(r[19]) || Math.round(qty * costPrice);
  const bukariki  = parseFloat(r[22]) || 0;  // 歩掛（人工/単位）

  if (!unit || sellPrice <= 0) return null;

  return {
    name, spec, qty, unit,
    price:      sellPrice,
    costPrice,
    amount:     Math.round(sellAmt),
    costAmount: Math.round(costAmt),
    bukariki,
  };
}

// ===== 新形式: 1行から品目データを抽出 =====
function extractItemNew(r) {
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
    name, spec, qty, unit,
    price:      sellPrice,
    costPrice,
    amount:     Math.round(qty * sellPrice),
    costAmount: Math.round(qty * costPrice),
  };
}

// ===== 1つのExcelファイルから物件データを抽出 =====
function parseHonmaruFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const layout = detectLayout(rows);
  const isOld  = layout === 'old';

  const info = { name: '', client: '', estimateNo: '' };
  const sections = {};   // 工種名 → items[]
  let currentSection = '一式';
  let sellTotal = 0;
  let costTotal = 0;

  for (const r of rows) {
    if (isEmptyRow(r)) continue;

    // ヘッダーキーの位置はレイアウトで異なる（旧: col[1]、新: col[0]）
    const key = String(r[isOld ? 1 : 0] || '').trim();
    const val = String(r[4] || '').trim();

    if (key === '工事名' || key === '工事名２') {
      if (!info.name && val) info.name = val;
      continue;
    }
    if (key === '得意先') {
      if (!info.client && val) info.client = val;
      continue;
    }
    if (key === '見積番号') {
      if (!info.estimateNo && val) info.estimateNo = val;
      continue;
    }
    if (key === '工種名') {
      if (val) currentSection = val;
      continue;
    }

    // 自動計算行・ヘッダ列行をスキップ
    if (isOld ? isAutoRowOld(r) : isAutoRowNew(r)) continue;

    // 品目行
    const item = isOld ? extractItemOld(r) : extractItemNew(r);
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

  // ファイル名から物件名フォールバック + 構造・種別・用途を自動解析
  if (!info.name) {
    info.name = path.basename(filePath, path.extname(filePath)).split('、')[0].trim();
  }
  const meta = parseFilename(filePath);

  return {
    kojiName:   info.name,
    name:       info.name,
    estimateNo: info.estimateNo,
    client:     info.client,
    struct:     meta.struct,
    type:       meta.type,
    usage:      meta.usage,
    sections,
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

  // 対象ファイルを収集（スクリプト自身の出力ファイルは除外）
  const targetFiles = [];
  for (const arg of args) {
    const resolved = path.resolve(arg);
    if (fs.statSync(resolved).isDirectory()) {
      fs.readdirSync(resolved)
        .filter(f => f.match(/\.xlsx?$/i) && !f.startsWith('~') && !f.startsWith('knowledge_'))
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

  // ===== ファイル種別を判定して分類 =====
  const meisaiFiles = [];
  const jikkoList   = [];
  const hyoshiList  = [];

  for (const filePath of targetFiles) {
    const fname = path.basename(filePath);
    try {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (isHyoshiFile(rows)) {
        const h = parseHyoshiFile(filePath);
        hyoshiList.push(h);
        console.log(`  [表紙総括表] ${fname}: 「${h.kojiName}」見積合計¥${h.grandTotal.toLocaleString()} / 利益率${h.profitRate}%`);
      } else if (isJikkoFile(rows)) {
        const { kojiName, items } = parseJikkoFile(filePath);
        jikkoList.push({ kojiName, jikkoMap: buildJikkoMap(items) });
        console.log(`  [実行予算書] ${fname}: 「${kojiName}」(${items.length}品目)`);
      } else {
        meisaiFiles.push(filePath);
      }
    } catch (e) { console.warn(`  [スキップ] ${fname}: ${e.message}`); }
  }

  console.log(`\n明細チェックリスト: ${meisaiFiles.length} 件 / 実行予算書: ${jikkoList.length} 件 / 表紙総括表: ${hyoshiList.length} 件`);

  // ===== 各明細ファイルを変換 =====
  const projects = [];
  let idCounter = 1;

  for (const filePath of meisaiFiles) {
    const fname = path.basename(filePath);
    try {
      const data = parseHonmaruFile(filePath);
      const jikkoMap = findJikkoMap(data.kojiName, jikkoList);
      const hyoshi   = findHyoshi(data.kojiName, hyoshiList);

      // 表紙総括表があれば見積合計・利益率・見積番号を正確な値で上書き（諸経費・値引き込み）
      if (hyoshi && hyoshi.grandTotal > 0) {
        data.grandTotal = hyoshi.grandTotal;
        data.profitRate = hyoshi.profitRate;
      }
      // 見積番号: 表紙総括表 > 明細チェックリストの順で優先
      const estimateNo = (hyoshi && hyoshi.estimateNo) || data.estimateNo || '';
      data.estimateNo  = estimateNo;

      const meta = `${data.struct||'?'} ${data.type||'?'} ${data.usage||'?'}`;
      const notes = [jikkoMap ? '実行予算書照合済' : '', hyoshi ? '表紙総括表照合済' : ''].filter(Boolean).join(', ');
      const noteStr = notes ? ` [${notes}]` : '';
      console.log(`  [${idCounter}] ${data.name} [${meta}]${noteStr} — ${data.itemCount}品目 / ¥${data.grandTotal.toLocaleString()} / 利益率: ${data.profitRate}%`);
      projects.push({ id: idCounter++, ...data, jikkoMap });
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
  const rows1 = [['id', '登録日', '見積番号', '物件名', '構造', '種別', '用途', '坪数', '合計金額', '利益率', '有効', '得意先（参考）']];
  projects.forEach(p => {
    // 物件名は「見積番号 工事名」形式（見積番号がある場合）
    const dispName = p.estimateNo ? `${p.estimateNo} ${p.name}` : p.name;
    rows1.push([
      p.id, today, p.estimateNo, dispName,
      p.struct, p.type, p.usage,
      '',
      p.grandTotal, p.profitRate, '○', p.client,
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(rows1);
  ws1['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 36 }, { wch: 8 }, { wch: 8 },
    { wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'プロジェクト一覧');

  // Sheet2: 明細（原価・定価・掛率列追加）
  const rows2 = [['project_id', '工種名', '品目名', '規格', '数量', '単位', '単価', '金額', '歩掛', '原価単価', '原価金額', '定価', '見積掛率(%)']];
  projects.forEach(p => {
    Object.entries(p.sections).forEach(([catName, items]) => {
      items.forEach(i => {
        const key   = normKey(i.name, i.spec);
        const jikko = p.jikkoMap ? (p.jikkoMap[key] || null) : null;
        rows2.push([
          p.id, catName, i.name, i.spec, i.qty, i.unit, i.price, i.amount,
          i.bukariki || 0,
          i.costPrice  || (jikko ? jikko.costPrice  : 0),   // 原価単価
          i.costAmount || (jikko ? jikko.costAmount  : 0),  // 原価金額
          jikko ? jikko.listPrice : '',                       // 定価（機器のみ）
          jikko ? jikko.sellRate  : '',                       // 見積掛率(%)（機器のみ）
        ]);
      });
    });
  });
  const ws2 = XLSX.utils.aoa_to_sheet(rows2);
  ws2['!cols'] = [
    { wch: 5 }, { wch: 16 }, { wch: 30 }, { wch: 20 },
    { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 6 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '明細');

  // 出力
  const outName = `knowledge_import_${today.replace(/-/g, '')}.xlsx`;
  const outDir = path.dirname(targetFiles[0]);
  const outPath = path.join(outDir, outName);

  XLSX.writeFile(wb, outPath);

  const jikkoMatched  = projects.filter(p => p.jikkoMap).length;
  const hyoshiMatched = projects.filter(p => hyoshiList.some(h => normKoji(p.kojiName) && normKoji(h.kojiName) && (normKoji(p.kojiName).includes(normKoji(h.kojiName)) || normKoji(h.kojiName).includes(normKoji(p.kojiName))))).length;
  console.log(`\n✅ 出力完了: ${outPath}`);
  console.log(`  ${projects.length} 件の物件データを変換しました`);
  console.log(`  うち ${jikkoMatched} 件は実行予算書（機器）と照合済み（定価・掛率付与）`);
  console.log(`  うち ${hyoshiMatched} 件は表紙総括表と照合済み（見積合計・利益率を正確な値に更新）`);
  console.log(`  ${rows2.length - 1} 行の明細データ`);
  console.log('\n次のステップ:');
  console.log('  1. 出力されたExcelを開く');
  console.log('  2.「プロジェクト一覧」シートの 構造・種別・用途・坪数 を記入/確認');
  console.log('  3. estimate-app のナレッジDB画面 → 「インポート」で読み込む');
}

main();
