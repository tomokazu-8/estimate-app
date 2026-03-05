#!/usr/bin/env node
// ===== テンプレート自動生成スクリプト =====
// P邸新築工事.xls のレイアウトを再現した空テンプレートを生成する
// 実行: node scripts/generate-template.js

const ExcelJS = require('exceljs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'estimate_template.xlsx');

// ===== 共通定数 =====
const FONT_GOTHIC = 'ＭＳ Ｐゴシック';
const FONT_MINCHO = 'ＭＳ Ｐ明朝';

const B_THIN   = { style: 'thin',   color: { argb: 'FF000000' } };
const B_MEDIUM = { style: 'medium', color: { argb: 'FF000000' } };
const B_DOUBLE = { style: 'double', color: { argb: 'FF000000' } };
const B_NONE   = undefined;

// ボーダーヘルパー
function border(t, r, b, l) {
  const obj = {};
  if (t) obj.top = t;
  if (r) obj.right = r;
  if (b) obj.bottom = b;
  if (l) obj.left = l;
  return obj;
}

// 行全体にボーダーを引く（B〜I列）
function rowBorder(ws, row, top, bottom, left, right) {
  ['B','C','D','E','F','G','H','I'].forEach((col, i) => {
    const cell = ws.getCell(`${col}${row}`);
    cell.border = border(
      top,
      (i === 7 || col === 'I') ? right : B_THIN,
      bottom,
      (i === 0 || col === 'B') ? left : B_THIN,
    );
  });
}

// ===== ページ設定 =====
const PAGE_SETUP = {
  paperSize: 9, // A4
  orientation: 'landscape',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 1,
  margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
};

async function generate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = '八友電工 見積システム';
  wb.created = new Date();

  buildCoverSheet(wb);
  buildSummarySheet(wb);
  buildDetailSheet(wb);

  await wb.xlsx.writeFile(OUTPUT);
  console.log('テンプレート生成完了:', OUTPUT);
}

// ================================================================
// Sheet1: 表紙（御見積書）
// ================================================================
function buildCoverSheet(wb) {
  const ws = wb.addWorksheet('表紙', {
    pageSetup: { ...PAGE_SETUP, fitToHeight: 1 },
    properties: { defaultRowHeight: 21.75 },
  });

  // 列幅 A〜R（A4横向き最適化）
  ws.columns = [
    { width: 2 },    // A
    { width: 5 },    // B
    { width: 7 },    // C
    { width: 7 },    // D
    { width: 8 },    // E
    { width: 8 },    // F
    { width: 8 },    // G
    { width: 6 },    // H
    { width: 6 },    // I
    { width: 6 },    // J
    { width: 6 },    // K
    { width: 6 },    // L
    { width: 4 },    // M
    { width: 4 },    // N
    { width: 7 },    // O
    { width: 10 },   // P
    { width: 10 },   // Q
    { width: 2 },    // R
  ];

  // ----- 行1: 上マージン -----
  ws.getRow(1).height = 30;

  // ----- 行2: メインタイトル用スペース -----
  ws.getRow(2).height = 37.5;

  // ----- 行3: 御見積書タイトル -----
  ws.mergeCells('B3:R3');
  const title = ws.getCell('B3');
  title.value = '御　見　積　書';
  title.font = { name: FONT_MINCHO, size: 22, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };

  // ----- 行4: 見積№ -----
  ws.mergeCells('P4:Q4');
  ws.getCell('O4').value = '見積№';
  ws.getCell('O4').font = { name: FONT_GOTHIC, size: 10 };
  ws.getCell('O4').alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell('P4').font = { name: FONT_GOTHIC, size: 10 };
  ws.getCell('P4').alignment = { horizontal: 'center', vertical: 'middle' };
  // データ: P4 に見積番号を書き込む

  // ----- 行5: スペーサー -----

  // ----- 行6: 得意先 / 日付 -----
  ws.mergeCells('C6:K6');
  const client = ws.getCell('C6');
  client.value = '　御中';
  client.font = { name: FONT_MINCHO, size: 14, bold: true };
  client.alignment = { vertical: 'middle' };
  client.border = border(B_NONE, B_NONE, B_MEDIUM, B_NONE);

  ws.mergeCells('O6:Q6');
  const dateCell = ws.getCell('O6');
  dateCell.font = { name: FONT_GOTHIC, size: 10 };
  dateCell.alignment = { horizontal: 'right', vertical: 'middle' };
  // データ: O6 に日付

  // ----- 行7: 下記の通り -----
  ws.mergeCells('C7:H7');
  const sub = ws.getCell('C7');
  sub.value = '下記の通り御見積申し上げます。';
  sub.font = { name: FONT_GOTHIC, size: 10 };

  // ----- 行8: スペーサー -----
  ws.getRow(8).height = 10;

  // ----- 行9: 税抜金額 -----
  buildCoverAmountRow(ws, 9, '税抜金額', false);
  ws.mergeCells('M9:Q9');

  // ----- 行10: 消費税額 -----
  buildCoverAmountRow(ws, 10, '消費税額', false);
  ws.mergeCells('M10:Q10');
  const compName = ws.getCell('M10');
  compName.value = '　八友電工株式会社';
  compName.font = { name: FONT_MINCHO, size: 12, bold: true };

  // ----- 行11: 御見積金額 -----
  buildCoverAmountRow(ws, 11, '御見積金額', true);
  ws.mergeCells('M11:Q11');
  ws.getCell('M11').value = '  362-0007';
  ws.getCell('M11').font = { name: FONT_GOTHIC, size: 9 };

  // ----- 行12: 住所 -----
  ws.mergeCells('E12:K12');
  ws.mergeCells('M12:Q12');
  ws.getCell('M12').value = '  埼玉県上尾市久保404番地5';
  ws.getCell('M12').font = { name: FONT_GOTHIC, size: 9 };

  // ----- 行13: TEL/FAX -----
  ws.mergeCells('E13:K13');
  ws.mergeCells('M13:Q13');
  ws.getCell('M13').value = '  TEL：048-776-9318　FAX：048-776-9319';
  ws.getCell('M13').font = { name: FONT_GOTHIC, size: 8.5 };

  // ----- 行14: 工事名 / MAIL -----
  ws.mergeCells('B14:C14');
  ws.getCell('B14').value = '工事名';
  ws.getCell('B14').font = { name: FONT_GOTHIC, size: 10 };
  ws.mergeCells('E14:K14');
  ws.getCell('E14').font = { name: FONT_GOTHIC, size: 10, bold: true };
  ws.getCell('E14').border = border(B_NONE, B_NONE, B_THIN, B_NONE);
  // データ: E14 に工事名

  ws.mergeCells('M14:Q14');
  ws.getCell('M14').value = '  MAIL：8hachitomo8.denko@gmail.com';
  ws.getCell('M14').font = { name: FONT_GOTHIC, size: 8.5 };

  // ----- 行15: 施工場所 / 担当 -----
  ws.mergeCells('B15:C15');
  ws.getCell('B15').value = '施工場所';
  ws.getCell('B15').font = { name: FONT_GOTHIC, size: 10 };
  ws.mergeCells('E15:K15');
  ws.getCell('E15').font = { name: FONT_GOTHIC, size: 10 };
  ws.getCell('E15').border = border(B_NONE, B_NONE, B_THIN, B_NONE);
  // データ: E15 に施工場所

  ws.getCell('N15').value = '担当：';
  ws.getCell('N15').font = { name: FONT_GOTHIC, size: 10 };
  ws.mergeCells('P15:Q15');
  ws.getCell('P15').font = { name: FONT_GOTHIC, size: 10 };
  // データ: P15 に担当者名

  // ----- 行16: 工期開始 -----
  ws.mergeCells('B16:C16');
  ws.getCell('B16').value = '工期開始';
  ws.getCell('B16').font = { name: FONT_GOTHIC, size: 10 };
  ws.mergeCells('E16:K16');
  ws.getCell('E16').border = border(B_NONE, B_NONE, B_THIN, B_NONE);

  // ----- 行17: 支払条件 -----
  ws.mergeCells('B17:C17');
  ws.getCell('B17').value = '支払条件';
  ws.getCell('B17').font = { name: FONT_GOTHIC, size: 10 };
  ws.mergeCells('E17:K17');
  ws.getCell('E17').border = border(B_NONE, B_NONE, B_THIN, B_NONE);

  // ----- 行18: 有効期限 -----
  ws.mergeCells('B18:C18');
  ws.getCell('B18').value = '有効期限';
  ws.getCell('B18').font = { name: FONT_GOTHIC, size: 10 };
  ws.mergeCells('E18:K18');
  ws.getCell('E18').value = '見積提出後1ヶ月';
  ws.getCell('E18').font = { name: FONT_GOTHIC, size: 10 };
  ws.getCell('E18').border = border(B_NONE, B_NONE, B_THIN, B_NONE);

  // 印刷範囲
  ws.pageSetup.printArea = 'A1:R20';
}

function buildCoverAmountRow(ws, row, label, isTotal) {
  ws.mergeCells(`D${row}:F${row}`);
  const lbl = ws.getCell(`D${row}`);
  lbl.value = label;
  lbl.font = { name: FONT_GOTHIC, size: 11, bold: !!isTotal };
  lbl.alignment = { horizontal: 'center', vertical: 'middle' };
  lbl.border = border(B_THIN, B_THIN, B_THIN, B_THIN);

  ws.mergeCells(`G${row}:I${row}`);
  const val = ws.getCell(`G${row}`);
  // データ: G9=税抜金額, G10=消費税, G11=御見積金額（関数）
  if (row === 10) {
    // 消費税 = 税抜金額 × 10%
    val.value = { formula: 'ROUNDDOWN(G9*0.1,0)', result: 0 };
  } else if (row === 11) {
    // 御見積金額 = 税抜 + 消費税
    val.value = { formula: 'G9+G10', result: 0 };
  }
  val.numFmt = '¥#,##0';
  val.font = { name: FONT_GOTHIC, size: 12, bold: !!isTotal };
  val.alignment = { horizontal: 'center', vertical: 'middle' };
  val.border = border(
    isTotal ? B_DOUBLE : B_THIN,
    B_THIN,
    isTotal ? B_DOUBLE : B_THIN,
    B_THIN,
  );
}

// ================================================================
// Sheet2: 内訳書
// ================================================================
function buildSummarySheet(wb) {
  const ws = wb.addWorksheet('内訳書', {
    pageSetup: { ...PAGE_SETUP, fitToHeight: 1 },
    properties: { defaultRowHeight: 18 },
  });

  // 列幅（A4横向き最適化）
  ws.columns = [
    { width: 2 },    // A
    { width: 38 },   // B: 工事内訳
    { width: 14 },   // C: （内訳名続き）
    { width: 9 },    // D: 数量
    { width: 8 },    // E: 単位
    { width: 16 },   // F: 単価
    { width: 18 },   // G: 金額
    { width: 14 },   // H: 備考
    { width: 7 },    // I: 備考続き
  ];

  // ----- 行1: スペーサー -----
  ws.getRow(1).height = 35;

  // ----- 行2: タイトル -----
  ws.mergeCells('B2:I2');
  const title = ws.getCell('B2');
  title.value = '内    訳    書';
  title.font = { name: FONT_MINCHO, size: 18, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 24;

  // ----- 行3: スペーサー -----

  // ----- 行4: 物件名 / 見積№ -----
  ws.mergeCells('B4:G4');
  ws.getCell('B4').font = { name: FONT_GOTHIC, size: 11, bold: true };
  // データ: B4 に物件名
  ws.getCell('H4').value = '見積№';
  ws.getCell('H4').font = { name: FONT_GOTHIC, size: 9 };
  ws.getCell('H4').alignment = { horizontal: 'right' };

  // ----- 行5: セパレーター -----
  ws.getRow(5).height = 6;

  // ----- 行6: ヘッダー -----
  ws.mergeCells('B6:C6');
  ws.mergeCells('H6:I6');
  const headers = [
    { col: 'B', val: '工　事　内　訳', width: 2 },
    { col: 'D', val: '数量' },
    { col: 'E', val: '単位' },
    { col: 'F', val: '単　価' },
    { col: 'G', val: '金　額' },
    { col: 'H', val: '備　考', width: 2 },
  ];
  headers.forEach(h => {
    const cell = ws.getCell(`${h.col}6`);
    cell.value = h.val;
    cell.font = { name: FONT_GOTHIC, size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  });
  // ヘッダー行ボーダー
  ['B','C','D','E','F','G','H','I'].forEach((col, i) => {
    const cell = ws.getCell(`${col}6`);
    cell.border = border(B_MEDIUM, i===7?B_MEDIUM:B_THIN, B_MEDIUM, i===0?B_MEDIUM:B_THIN);
    if (!cell.font) cell.font = { name: FONT_GOTHIC, size: 10, bold: true };
    if (!cell.alignment) cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (!cell.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  });

  // ----- 行7〜16: カテゴリ行（10行確保） -----
  const CAT_ROWS = 10;
  for (let i = 0; i < CAT_ROWS; i++) {
    const r = 7 + i;
    ws.mergeCells(`B${r}:C${r}`);
    ws.mergeCells(`H${r}:I${r}`);

    // B列: 工種名（データ書き込み先）
    ws.getCell(`B${r}`).font = { name: FONT_GOTHIC, size: 10 };
    ws.getCell(`B${r}`).border = border(B_NONE, B_NONE, B_THIN, B_THIN);

    // D列: 数量
    ws.getCell(`D${r}`).font = { name: FONT_GOTHIC, size: 10 };
    ws.getCell(`D${r}`).alignment = { horizontal: 'center' };
    ws.getCell(`D${r}`).border = border(B_NONE, B_NONE, B_THIN, B_THIN);

    // E列: 単位
    ws.getCell(`E${r}`).font = { name: FONT_GOTHIC, size: 10 };
    ws.getCell(`E${r}`).alignment = { horizontal: 'center' };
    ws.getCell(`E${r}`).border = border(B_NONE, B_NONE, B_THIN, B_THIN);

    // F列: 単価（空白）
    ws.getCell(`F${r}`).border = border(B_NONE, B_NONE, B_THIN, B_THIN);

    // G列: 金額
    ws.getCell(`G${r}`).numFmt = '#,##0';
    ws.getCell(`G${r}`).font = { name: FONT_GOTHIC, size: 10 };
    ws.getCell(`G${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`G${r}`).border = border(B_NONE, B_THIN, B_THIN, B_THIN);

    // H列: 備考
    ws.getCell(`H${r}`).font = { name: FONT_GOTHIC, size: 9 };
    ws.getCell(`H${r}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);
  }

  // ----- 行17〜30: 空白パディング -----
  for (let r = 7 + CAT_ROWS; r <= 30; r++) {
    ws.getCell(`B${r}`).border = border(B_NONE, B_NONE, B_NONE, B_THIN);
    ws.getCell(`G${r}`).border = border(B_NONE, B_THIN, B_NONE, B_NONE);
    ws.getCell(`I${r}`).border = border(B_NONE, B_THIN, B_NONE, B_NONE);
  }

  // ----- 行31: 空行（合計前） -----

  // ----- 行32: 合計行 -----
  const totalRow = 32;
  ws.mergeCells(`B${totalRow}:C${totalRow}`);
  ws.mergeCells(`H${totalRow}:I${totalRow}`);
  ws.getCell(`B${totalRow}`).value = '合　　計';
  ws.getCell(`B${totalRow}`).font = { name: FONT_GOTHIC, size: 11, bold: true };
  ws.getCell(`B${totalRow}`).alignment = { horizontal: 'center', vertical: 'middle' };

  // 合計 = SUM(G7:G16)
  ws.getCell(`G${totalRow}`).value = { formula: 'SUM(G7:G16)', result: 0 };
  ws.getCell(`G${totalRow}`).numFmt = '#,##0';
  ws.getCell(`G${totalRow}`).font = { name: FONT_GOTHIC, size: 11, bold: true };
  ws.getCell(`G${totalRow}`).alignment = { horizontal: 'right' };

  // 合計行ボーダー
  ['B','C','D','E','F','G','H','I'].forEach((col, i) => {
    ws.getCell(`${col}${totalRow}`).border = border(
      B_MEDIUM,
      i===7 ? B_MEDIUM : B_THIN,
      B_DOUBLE,
      i===0 ? B_MEDIUM : B_THIN,
    );
  });

  // ----- 行34: ページ番号 -----
  ws.getCell('B34').value = '1';
  ws.getCell('B34').font = { name: FONT_GOTHIC, size: 9 };
  ws.getCell('B34').alignment = { horizontal: 'center' };

  ws.pageSetup.printArea = 'A1:I35';
}

// ================================================================
// Sheet3: 内訳明細書
// ================================================================
function buildDetailSheet(wb) {
  const ws = wb.addWorksheet('内訳明細書', {
    pageSetup: { ...PAGE_SETUP },
    properties: { defaultRowHeight: 18 },
  });

  // 列幅（A4横向き最適化）
  ws.columns = [
    { width: 2 },    // A
    { width: 38 },   // B: 品名
    { width: 30 },   // C: 規格
    { width: 9 },    // D: 数量
    { width: 8 },    // E: 単位
    { width: 14 },   // F: 単価
    { width: 16 },   // G: 金額
    { width: 14 },   // H: 備考
    { width: 7 },    // I: 備考続き
  ];

  // 20ページ分を生成（各35行）
  const TOTAL_PAGES = 20;
  const ROWS_PER_PAGE = 35;
  const DATA_ROWS = 25;     // 1ページあたりのデータ行

  for (let page = 0; page < TOTAL_PAGES; page++) {
    const base = page * ROWS_PER_PAGE; // 0-indexed offset
    const r = (n) => base + n;         // 行番号（1-indexed）

    // ----- Row 1: スペーサー -----
    ws.getRow(r(1)).height = 35;

    // ----- Row 2: タイトル -----
    ws.mergeCells(`B${r(2)}:I${r(2)}`);
    const titleCell = ws.getCell(`B${r(2)}`);
    titleCell.value = '内　訳　明　細　書';
    titleCell.font = { name: FONT_MINCHO, size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(r(2)).height = 24;

    // ----- Row 3: スペーサー -----

    // ----- Row 4: カテゴリ名 / 見積№ -----
    ws.mergeCells(`B${r(4)}:G${r(4)}`);
    ws.getCell(`B${r(4)}`).font = { name: FONT_GOTHIC, size: 11, bold: true };
    // データ: B${r(4)} にカテゴリ名
    ws.getCell(`H${r(4)}`).value = '見積№';
    ws.getCell(`H${r(4)}`).font = { name: FONT_GOTHIC, size: 9 };
    ws.getCell(`H${r(4)}`).alignment = { horizontal: 'right' };

    // ----- Row 5: セパレーター -----
    ws.getRow(r(5)).height = 6;

    // ----- Row 6: 列ヘッダー -----
    ws.mergeCells(`H${r(6)}:I${r(6)}`);
    const colHeaders = {
      B: '品　名', C: '規　格', D: '数量', E: '単位',
      F: '単　価', G: '金　額', H: '備　考',
    };
    Object.entries(colHeaders).forEach(([col, val]) => {
      const cell = ws.getCell(`${col}${r(6)}`);
      cell.value = val;
      cell.font = { name: FONT_GOTHIC, size: 9, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    });
    ['B','C','D','E','F','G','H','I'].forEach((col, i) => {
      const cell = ws.getCell(`${col}${r(6)}`);
      cell.border = border(B_MEDIUM, i===7?B_MEDIUM:B_THIN, B_MEDIUM, i===0?B_MEDIUM:B_THIN);
      if (!cell.font) cell.font = { name: FONT_GOTHIC, size: 9, bold: true };
      if (!cell.alignment) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (!cell.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    });

    // ----- Row 7〜31: データ行（25行） -----
    for (let i = 0; i < DATA_ROWS; i++) {
      const dataRow = r(7 + i);
      ws.mergeCells(`H${dataRow}:I${dataRow}`);

      // B: 品名
      ws.getCell(`B${dataRow}`).font = { name: FONT_GOTHIC, size: 9 };
      ws.getCell(`B${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_THIN);

      // C: 規格
      ws.getCell(`C${dataRow}`).font = { name: FONT_GOTHIC, size: 8 };
      ws.getCell(`C${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);

      // D: 数量
      ws.getCell(`D${dataRow}`).font = { name: FONT_GOTHIC, size: 9 };
      ws.getCell(`D${dataRow}`).alignment = { horizontal: 'center' };
      ws.getCell(`D${dataRow}`).numFmt = '#,##0;-#,##0;""';
      ws.getCell(`D${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);

      // E: 単位
      ws.getCell(`E${dataRow}`).font = { name: FONT_GOTHIC, size: 9 };
      ws.getCell(`E${dataRow}`).alignment = { horizontal: 'center' };
      ws.getCell(`E${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);

      // F: 単価
      ws.getCell(`F${dataRow}`).font = { name: FONT_GOTHIC, size: 9 };
      ws.getCell(`F${dataRow}`).alignment = { horizontal: 'right' };
      ws.getCell(`F${dataRow}`).numFmt = '#,##0';
      ws.getCell(`F${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);

      // G: 金額
      ws.getCell(`G${dataRow}`).font = { name: FONT_GOTHIC, size: 9 };
      ws.getCell(`G${dataRow}`).alignment = { horizontal: 'right' };
      ws.getCell(`G${dataRow}`).numFmt = '#,##0';
      ws.getCell(`G${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);

      // H: 備考
      ws.getCell(`H${dataRow}`).font = { name: FONT_GOTHIC, size: 8 };
      ws.getCell(`H${dataRow}`).border = border(B_NONE, B_THIN, B_THIN, B_NONE);
    }

    // ----- Row 32: 合計行 -----
    const totalRow = r(32);
    ws.mergeCells(`B${totalRow}:C${totalRow}`);
    ws.mergeCells(`H${totalRow}:I${totalRow}`);
    ws.getCell(`B${totalRow}`).value = '合　　計';
    ws.getCell(`B${totalRow}`).font = { name: FONT_GOTHIC, size: 10, bold: true };
    ws.getCell(`B${totalRow}`).alignment = { horizontal: 'center', vertical: 'middle' };

    // 合計 = SUM(G7:G31) for this page
    const firstData = r(7);
    const lastData = r(31);
    ws.getCell(`G${totalRow}`).value = { formula: `SUM(G${firstData}:G${lastData})`, result: 0 };
    ws.getCell(`G${totalRow}`).numFmt = '#,##0';
    ws.getCell(`G${totalRow}`).font = { name: FONT_GOTHIC, size: 10, bold: true };
    ws.getCell(`G${totalRow}`).alignment = { horizontal: 'right' };

    // 合計行ボーダー
    ['B','C','D','E','F','G','H','I'].forEach((col, i) => {
      ws.getCell(`${col}${totalRow}`).border = border(
        B_MEDIUM,
        i===7 ? B_MEDIUM : B_THIN,
        B_DOUBLE,
        i===0 ? B_MEDIUM : B_THIN,
      );
    });

    // ----- Row 33: 空行 -----

    // ----- Row 34: ページ番号 -----
    ws.getCell(`B${r(34)}`).value = page + 2; // 内訳書が1ページ目なので+2
    ws.getCell(`B${r(34)}`).font = { name: FONT_GOTHIC, size: 9 };
    ws.getCell(`B${r(34)}`).alignment = { horizontal: 'center' };

    // ----- Row 35: 空行（次ページとの区切り） -----
  }

  // 改ページ設定
  ws.pageSetup.printArea = `A1:I${TOTAL_PAGES * ROWS_PER_PAGE}`;

  // 各ページの境界で改ページ
  for (let page = 1; page < TOTAL_PAGES; page++) {
    const breakRow = page * ROWS_PER_PAGE;
    ws.getRow(breakRow + 1).addPageBreak();
  }
}

// ===== 実行 =====
generate().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
