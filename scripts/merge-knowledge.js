/**
 * merge-knowledge.js
 * 実績データベース_v3.xlsx（構造/㎡数/利益率あり）と
 * knowledge_import_20260307.xlsx（歩掛/定価/諸経費あり）を
 * 見積番号で照合してマージし、統合 knowledge_import_merged.xlsx を出力する
 *
 * Usage: node scripts/merge-knowledge.js
 */

const XLSX = require('xlsx');
const path = require('path');

// ===== パス設定 =====
const JISSEKI_PATH = 'C:/Users/pal19/Projects/見積書社内データ/AI→出力データ/実績データベース_v3.xlsx';
const KI_PATH = 'C:/Users/pal19/OneDrive/Goodreader one/見積りソフト作成プロジェクト/過去物件明細/knowledge_import_20260307.xlsx';
const OUT_DIR = 'C:/Users/pal19/OneDrive/Goodreader one/見積りソフト作成プロジェクト/過去物件明細';

// ===== ユーティリティ =====
function norm(s) {
  return String(s || '').normalize('NFKC').trim();
}

/** "0000016-01" → "16-01", "0016-01" → "16-01" */
function normNum(s) {
  const str = norm(s);
  if (!str || str === '0') return '';
  // ハイフンで分割して各部分の先頭ゼロを除去
  return str.split('-').map(p => String(parseInt(p, 10) || p)).join('-');
}

function n(v) { return Number(v) || 0; }
function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }

// ===== 実績DB 読み込み =====
function loadJisseki(filePath) {
  const wb = XLSX.readFile(filePath);

  // --- 物件マスタ (行index 3=ヘッダー, 4以降=データ) ---
  const ws1 = wb.Sheets['物件マスタ'];
  const pm = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: '' });
  const hdr1 = pm[3]; // ヘッダー行
  console.log('物件マスタ ヘッダー:', hdr1.filter(Boolean).join(', '));

  const projects = {};
  for (let i = 4; i < pm.length; i++) {
    const r = pm[i];
    if (!r[0] || String(r[0]).startsWith('※')) continue;
    const id = String(r[0]).trim();
    const raw番号 = String(r[2] || '').trim();
    projects[id] = {
      jissekiId: id,
      name: norm(r[1]),
      rawNum: raw番号,
      num: normNum(raw番号),
      struct: norm(r[3]),
      usage: norm(r[4]),
      floors: norm(r[5]),
      newOrRenew: norm(r[6]),
      client: norm(r[7]),
      manager: norm(r[8]),
      areaSqm: n(r[9]),
      areaTsubo: n(r[10]),
      grandTotal: n(r[13]),
      costTotal: n(r[14]),
      profitRate: n(r[15]),
      items: [],      // 明細データから格納
      koshuSummary: {}, // 工種サマリから格納
    };
  }

  // --- 工種サマリ (行index 3=ヘッダー, 4以降=データ) ---
  const ws3 = wb.Sheets['工種サマリ'];
  if (ws3) {
    const ks = XLSX.utils.sheet_to_json(ws3, { header: 1, defval: '' });
    const hdr3 = ks[3];
    console.log('工種サマリ ヘッダー:', hdr3.filter(Boolean).join(', '));
    for (let i = 4; i < ks.length; i++) {
      const r = ks[i];
      if (!r[0]) continue;
      const pid = String(r[0]).trim();
      if (!projects[pid]) continue;
      const koshuName = norm(r[1]);
      if (!koshuName) continue;
      // hdr3でcolumnを特定（柔軟に対応）
      const getCol = (...names) => {
        for (const nm of names) {
          const idx = hdr3.findIndex(h => norm(h).includes(norm(nm)));
          if (idx >= 0 && r[idx] !== '') return n(r[idx]);
        }
        return 0;
      };
      const total = getCol('見積合計', '見積金額', '金額');
      const costT = getCol('原価合計', '原価金額', '原価');
      const kosu = getCol('工数', '人工');
      projects[pid].koshuSummary[koshuName] = { total, costT, kosu };
    }
  }

  // --- 明細データ (行index 3=ヘッダー, 4以降=データ) ---
  const ws2 = wb.Sheets['明細データ'];
  const md = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
  const hdr2 = md[3];
  console.log('明細データ ヘッダー:', hdr2.filter(Boolean).join(', '));

  for (let i = 4; i < md.length; i++) {
    const r = md[i];
    if (!r[0]) continue;
    const pid = String(r[0]).trim();
    if (!projects[pid]) continue;
    const hinmei = norm(r[3]);
    if (!hinmei) continue;

    projects[pid].items.push({
      koshuName: norm(r[1]),
      name: hinmei,
      spec: norm(r[4]),
      unit: norm(r[5]),
      qty: n(r[6]),
      sellPrice: n(r[7]),
      sellAmt: n(r[8]),
      costQty: n(r[9]),
      costPrice: n(r[10]),
      costAmt: n(r[11]),
      // 実績DBには歩掛なし
      bukariki: '',
      kosu: 0,
      listPrice: 0,
      sellRate: 0,
      costRate: 0,
    });
  }

  console.log(`\n実績DB: ${Object.keys(projects).length}件 読み込み完了`);
  return projects;
}

// ===== knowledge_import 読み込み（新旧フォーマット両対応）=====
function loadKI(filePath) {
  const wb = XLSX.readFile(filePath);

  // Sheet1: プロジェクト一覧
  const ws1 = wb.Sheets['プロジェクト一覧'];
  if (!ws1) throw new Error('「プロジェクト一覧」シートが見つかりません: ' + filePath);
  const proj = XLSX.utils.sheet_to_json(ws1);
  const sampleKeys = Object.keys(proj[0] || {});
  console.log('\nKI Sheet1 列:', sampleKeys.join(', '));

  // フォーマット検出: 新フォーマットは '見積番号' 列を持つ
  const isNewFormat = sampleKeys.includes('見積番号');
  console.log('フォーマット:', isNewFormat ? '新（見積番号あり）' : '旧（物件名照合）');

  // Sheet2: 明細
  const ws2 = wb.Sheets['明細'];
  if (!ws2) throw new Error('「明細」シートが見つかりません: ' + filePath);
  const items = XLSX.utils.sheet_to_json(ws2);
  console.log('KI Sheet2 列:', Object.keys(items[0] || {}).join(', '));
  console.log(`KI: ${proj.length}件, 明細${items.length}行 読み込み完了`);

  // project_id→items のマップ
  const itemsByPid = {};
  for (const row of items) {
    const pid = String(row['project_id'] || row['id'] || '').trim();
    if (!pid) continue;
    if (!itemsByPid[pid]) itemsByPid[pid] = [];
    itemsByPid[pid].push(normalizeKIItem(row, isNewFormat));
  }

  // プロジェクト一覧を id→record に変換
  const kiMap = {};
  for (const p of proj) {
    const id = String(p['id'] || '').trim();
    const rawNum = isNewFormat ? String(p['見積番号'] || '').trim() : '';
    kiMap[id] = {
      id,
      rawNum,
      num: normNum(rawNum),
      name: norm(p['物件名']),
      client: norm(p['得意先'] || p['得意先（参考）'] || ''),
      manager: norm(p['担当者'] || ''),
      struct: norm(p['構造'] || ''),
      type: norm(p['種別'] || ''),
      usage: norm(p['用途'] || ''),
      areaTsubo: n(p['坪数']),
      areaSqm: n(p['㎡数'] || 0),
      workTotal: n(p['工事費合計'] || p['合計金額'] || 0),
      miscExpenseAmt: n(p['諸経費金額'] || 0),
      miscExpensePct: n(p['諸経費率%'] || 0),
      discountAmt: n(p['値引き金額'] || 0),
      discountPct: n(p['値引き率%'] || 0),
      grandTotal: n(p['税抜合計'] || p['合計金額'] || 0),
      costTotal: n(p['原価合計'] || 0),
      profitRate: n(p['利益率%'] || p['利益率'] || 0),
      source: norm(p['データソース'] || '本丸EX'),
      items: itemsByPid[id] || [],
      registeredAt: p['登録日'] || new Date().toISOString().split('T')[0],
    };
  }
  return { kiMap, isNewFormat };
}

/** 旧/新フォーマットの明細行を出力形式に統一 */
function normalizeKIItem(row, isNewFormat) {
  if (isNewFormat) return row; // 新フォーマットはそのまま
  // 旧フォーマット列名 → 出力形式にマッピング
  return {
    '工種名':     row['工種名']       || '',
    '工種合計':   0, // 旧フォーマットには工種サマリ列がないため0
    '工種原価合計': 0,
    '工種工数':   0,
    '工種粗利率%': 0,
    '品目名':     row['品目名']       || '',
    '規格':       row['規格']         || '',
    '数量':       n(row['数量']),
    '単位':       row['単位']         || '',
    '定価':       row['定価']         || '',
    '見積単価':   n(row['単価']),
    '見積掛率%':  n(row['見積掛率(%)'] || row['見積掛率%']),
    '原価単価':   n(row['原価単価']),
    '原価掛率%':  '',
    '見積金額':   n(row['金額']),
    '原価金額':   n(row['原価金額']),
    '歩掛':       row['歩掛']         || '',
    '工数':       '',
  };
}

// ===== マージ処理 =====
function merge(jisseki, kiMap, isNewFormat) {
  // normalized 見積番号 → 実績DBプロジェクト
  const jissekiByNum = {};
  const jissekiByName = {};
  for (const [id, p] of Object.entries(jisseki)) {
    if (p.num) jissekiByNum[p.num] = p;
    if (p.name) jissekiByName[p.name] = p;
  }

  // KI の照合インデックス構築
  const kiByNum = {};
  const kiByName = {};
  for (const [id, p] of Object.entries(kiMap)) {
    if (p.num) kiByNum[p.num] = p;
    if (p.name) kiByName[p.name] = p;
  }

  const merged = []; // 出力レコード配列
  const handledJissekiIds = new Set();
  const handledKiIds = new Set();
  let matchCount = 0;

  // --- KI を一次ソースとして処理（歩掛/定価/諸経費の情報源として優先）---
  for (const [kiId, ki] of Object.entries(kiMap)) {
    // 見積番号で照合（新フォーマット）、なければ物件名で照合（旧フォーマット）
    let jp = null;
    if (isNewFormat && ki.num) {
      jp = jissekiByNum[ki.num] || null;
    }
    if (!jp && ki.name) {
      jp = jissekiByName[ki.name] || null;
    }

    if (jp) {
      matchCount++;
      handledJissekiIds.add(jp.jissekiId);
      // 実績DBで補完できる項目
      const struct = jp.struct || ki.struct;
      const usage = jp.usage || ki.usage;
      const areaSqm = jp.areaSqm || ki.areaSqm;
      const areaTsubo = jp.areaTsubo || ki.areaTsubo;

      merged.push({
        source: 'merged',
        kiId: ki.id,
        jissekiId: jp.jissekiId,
        num: ki.rawNum || jp.rawNum,
        name: ki.name || jp.name,
        client: ki.client || jp.client,
        manager: ki.manager || jp.manager,
        struct,
        type: ki.type,
        usage,
        areaTsubo,
        areaSqm,
        workTotal: ki.workTotal || jp.grandTotal,
        miscExpenseAmt: ki.miscExpenseAmt,
        miscExpensePct: ki.miscExpensePct,
        discountAmt: ki.discountAmt,
        discountPct: ki.discountPct,
        grandTotal: ki.grandTotal || jp.grandTotal,
        costTotal: ki.costTotal || jp.costTotal,
        profitRate: ki.profitRate || jp.profitRate,
        registeredAt: ki.registeredAt,
        items: ki.items, // KIの明細（歩掛/定価あり）をそのまま使用
        koshuSummary: jp.koshuSummary,
      });
    } else {
      // KIのみ（実績DBに対応なし）
      merged.push({
        source: '本丸EX',
        kiId: ki.id,
        jissekiId: null,
        num: ki.rawNum,
        name: ki.name,
        client: ki.client,
        manager: ki.manager,
        struct: ki.struct,
        type: ki.type,
        usage: ki.usage,
        areaTsubo: ki.areaTsubo,
        areaSqm: ki.areaSqm,
        workTotal: ki.workTotal,
        miscExpenseAmt: ki.miscExpenseAmt,
        miscExpensePct: ki.miscExpensePct,
        discountAmt: ki.discountAmt,
        discountPct: ki.discountPct,
        grandTotal: ki.grandTotal,
        costTotal: ki.costTotal,
        profitRate: ki.profitRate,
        registeredAt: ki.registeredAt,
        items: ki.items,
        koshuSummary: {},
      });
    }
    handledKiIds.add(kiId);
  }

  // --- 実績DBのみ（KIに対応なし）を追記 ---
  let jissekiOnlyCount = 0;
  for (const [jid, jp] of Object.entries(jisseki)) {
    if (handledJissekiIds.has(jid)) continue;
    jissekiOnlyCount++;

    // 実績DBの明細を KI の Sheet2 形式に変換
    const items = [];
    // 工種サマリから工種一覧を取得
    const koshuNames = [...new Set(jp.items.map(it => it.koshuName).filter(Boolean))];
    // 工種サマリがなければ items から収集
    const allKoshu = koshuNames.length > 0 ? koshuNames :
      [...new Set(jp.items.map(it => it.koshuName).filter(Boolean))];

    for (const koshuName of allKoshu) {
      const ks = jp.koshuSummary[koshuName] || {};
      const koshuItems = jp.items.filter(it => it.koshuName === koshuName);
      const koshuTotal = ks.total || koshuItems.reduce((s, it) => s + it.sellAmt, 0);
      const koshuCostTotal = ks.costT || koshuItems.reduce((s, it) => s + it.costAmt, 0);

      for (const it of koshuItems) {
        items.push({
          '工種名': koshuName,
          '工種合計': koshuTotal,
          '工種原価合計': koshuCostTotal,
          '工種工数': ks.kosu || 0,
          '工種粗利率%': pct(koshuTotal - koshuCostTotal, koshuTotal),
          '品目名': it.name,
          '規格': it.spec,
          '数量': it.qty,
          '単位': it.unit,
          '定価': '',
          '見積単価': it.sellPrice,
          '見積掛率%': '',
          '原価単価': it.costPrice,
          '原価掛率%': '',
          '見積金額': it.sellAmt,
          '原価金額': it.costAmt,
          '歩掛': '',
          '工数': '',
        });
      }
    }

    merged.push({
      source: '実績DB',
      kiId: null,
      jissekiId: jid,
      num: jp.rawNum,
      name: jp.name,
      client: jp.client,
      manager: jp.manager,
      struct: jp.struct,
      type: '',
      usage: jp.usage,
      areaTsubo: jp.areaTsubo,
      areaSqm: jp.areaSqm,
      workTotal: jp.grandTotal,
      miscExpenseAmt: 0,
      miscExpensePct: 0,
      discountAmt: 0,
      discountPct: 0,
      grandTotal: jp.grandTotal,
      costTotal: jp.costTotal,
      profitRate: jp.profitRate,
      registeredAt: new Date().toISOString().split('T')[0],
      items,
      koshuSummary: jp.koshuSummary,
    });
  }

  console.log(`\n=== マージ結果 ===`);
  console.log(`照合一致: ${matchCount}件`);
  console.log(`KIのみ: ${Object.keys(kiMap).length - matchCount}件`);
  console.log(`実績DBのみ: ${jissekiOnlyCount}件`);
  console.log(`合計出力: ${merged.length}件`);

  return merged;
}

// ===== Excel 出力 =====
function writeOutput(merged, outDir) {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

  // --- Sheet1: プロジェクト一覧 ---
  const rows1 = [[
    'id', '登録日', '見積番号', '物件名', '得意先', '担当者',
    '構造', '種別', '用途', '坪数', '㎡数',
    '工事費合計', '諸経費金額', '諸経費率%', '値引き金額', '値引き率%',
    '税抜合計', '原価合計', '利益率%', 'データソース', '有効'
  ]];
  merged.forEach((p, idx) => {
    rows1.push([
      idx + 1,
      p.registeredAt,
      p.num,
      p.name,
      p.client,
      p.manager,
      p.struct,
      p.type,
      p.usage,
      p.areaTsubo,
      p.areaSqm,
      p.workTotal,
      p.miscExpenseAmt,
      p.miscExpensePct,
      p.discountAmt,
      p.discountPct,
      p.grandTotal,
      p.costTotal,
      p.profitRate,
      p.source,
      '○',
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows1), 'プロジェクト一覧');

  // --- Sheet2: 明細 ---
  const rows2 = [[
    'project_id', '工種名', '工種合計', '工種原価合計', '工種工数', '工種粗利率%',
    '品目名', '規格', '数量', '単位',
    '定価', '見積単価', '見積掛率%', '原価単価', '原価掛率%',
    '見積金額', '原価金額', '歩掛', '工数'
  ]];
  merged.forEach((p, idx) => {
    const pid = idx + 1;
    for (const it of p.items) {
      // KI形式のオブジェクト or 実績DB変換済みオブジェクト両対応
      rows2.push([
        pid,
        it['工種名']    || '',
        it['工種合計']  || 0,
        it['工種原価合計'] || 0,
        it['工種工数']  || 0,
        it['工種粗利率%'] || 0,
        it['品目名']    || '',
        it['規格']      || '',
        it['数量']      || 0,
        it['単位']      || '',
        it['定価']      || '',
        it['見積単価']  || 0,
        it['見積掛率%'] || '',
        it['原価単価']  || 0,
        it['原価掛率%'] || '',
        it['見積金額']  || 0,
        it['原価金額']  || 0,
        it['歩掛']      || '',
        it['工数']      || '',
      ]);
    }
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows2), '明細');

  const outPath = path.join(outDir, `knowledge_import_merged_${today}.xlsx`);
  XLSX.writeFile(wb, outPath);
  console.log(`\n出力完了: ${outPath}`);
  console.log(`Sheet1 (プロジェクト一覧): ${rows1.length - 1}行`);
  console.log(`Sheet2 (明細): ${rows2.length - 1}行`);
}

// ===== メイン =====
try {
  console.log('=== 実績DB 読み込み ===');
  const jisseki = loadJisseki(JISSEKI_PATH);

  console.log('\n=== knowledge_import 読み込み ===');
  const { kiMap, isNewFormat } = loadKI(KI_PATH);

  console.log('\n=== マージ処理 ===');
  const merged = merge(jisseki, kiMap, isNewFormat);

  console.log('\n=== Excel 出力 ===');
  writeOutput(merged, OUT_DIR);
} catch (e) {
  console.error('エラー:', e.message);
  process.exit(1);
}
