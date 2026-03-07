/**
 * 本丸EXテンプレート変換スクリプト
 *
 * 使い方:
 *   node scripts/prepare-template.js <入力.xlsx>
 *
 * 例:
 *   node scripts/prepare-template.js "C:/Users/pal19/OneDrive/Goodreader one/見積りソフト作成プロジェクト/見積書テンプレート/見積書(明細付A4横消費税付).xlsx"
 *
 * 処理内容:
 *   - Sheet1（見積書）: そのまま保持
 *   - Sheet2（内訳明細書）: 1ページ分のテンプレートを MAX_PAGES 回分に展開
 *   - Sheet3（仕様書）: 削除（未使用）
 *   → data/estimate_template.xlsx として保存
 */

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const MAX_PAGES = 20;
const PAGE_ROWS = 35; // **PageEnd が行35にある

const OUTPUT = path.join(__dirname, '../data/estimate_template.xlsx');

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('使い方: node scripts/prepare-template.js <入力.xlsx>');
    process.exit(1);
  }
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) {
    console.error('ファイルが見つかりません:', sourcePath);
    process.exit(1);
  }

  console.log('読み込み中:', sourcePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);

  const sheet1 = wb.getWorksheet('Sheet1'); // 見積書（表紙）
  const sheet2 = wb.getWorksheet('Sheet2'); // 内訳明細書
  const sheet3 = wb.getWorksheet('Sheet3'); // 仕様書（不要）

  if (!sheet1 || !sheet2) {
    console.error('Sheet1またはSheet2が見つかりません');
    process.exit(1);
  }

  // Sheet3 を削除
  if (sheet3) {
    wb.removeWorksheet(sheet3.id);
    console.log('Sheet3（仕様書）を削除しました');
  }

  // ===== Sheet2: テンプレートページを記録 =====
  const templateRows = [];
  for (let r = 1; r <= PAGE_ROWS; r++) {
    const row = sheet2.getRow(r);
    const rowData = { height: row.height, cells: [] };
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      let value = cell.value;
      // 数式セルは値のみ保持（コピー後に数式参照がずれるため）
      if (value && typeof value === 'object' && value.formula) {
        value = value.result ?? null;
      }
      rowData.cells.push({
        col,
        value,
        style: JSON.parse(JSON.stringify(cell.style)),
        numFmt: cell.numFmt,
      });
    });
    templateRows.push(rowData);
  }
  console.log(`Sheet2テンプレート記録: ${templateRows.length}行`);

  // ===== Sheet2: マージセル情報を記録（1ページ目のみ） =====
  const templateMerges = [];
  if (sheet2.model && sheet2.model.merges) {
    sheet2.model.merges.forEach(m => {
      // "B2:H3" → { startCol, startRow, endCol, endRow }
      const match = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!match) return;
      const startRow = parseInt(match[2]);
      const endRow   = parseInt(match[4]);
      if (startRow >= 1 && endRow <= PAGE_ROWS) {
        templateMerges.push({
          startCol: match[1], startRow,
          endCol:   match[3], endRow,
        });
      }
    });
    console.log(`マージセル記録: ${templateMerges.length}個`);
  }

  // ===== Sheet2: ページを複製（ページ2〜MAX_PAGES） =====
  for (let page = 1; page < MAX_PAGES; page++) {
    for (let r = 0; r < PAGE_ROWS; r++) {
      const targetRow = sheet2.getRow(page * PAGE_ROWS + r + 1);
      const src = templateRows[r];
      if (src.height) targetRow.height = src.height;
      src.cells.forEach(({ col, value, style, numFmt }) => {
        const cell = targetRow.getCell(col);
        cell.value = value;
        cell.style = JSON.parse(JSON.stringify(style));
        if (numFmt) cell.numFmt = numFmt;
      });
      targetRow.commit();
    }

    // マージセルを複製
    templateMerges.forEach(({ startCol, startRow, endCol, endRow }) => {
      const newStart = page * PAGE_ROWS + startRow;
      const newEnd   = page * PAGE_ROWS + endRow;
      try {
        sheet2.mergeCells(`${startCol}${newStart}:${endCol}${newEnd}`);
      } catch (e) {
        // マージ済みの場合は無視
      }
    });
  }
  console.log(`Sheet2展開完了: ${MAX_PAGES}ページ (${MAX_PAGES * PAGE_ROWS}行)`);

  // ===== Sheet1: 印刷設定を確認 =====
  sheet1.pageSetup = sheet1.pageSetup || {};

  // ===== 保存 =====
  await wb.xlsx.writeFile(OUTPUT);
  console.log(`\n✅ テンプレート生成完了: ${OUTPUT}`);
  console.log('  Sheet1: 見積書（表紙）');
  console.log(`  Sheet2: 内訳明細書（${MAX_PAGES}ページ展開済み）`);
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
