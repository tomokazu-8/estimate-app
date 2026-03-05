// ===== テンプレート方式Excel出力（ExcelJS） =====
// data/estimate_template.xlsx を読み込み、所定セルにデータを書き込む
// レイアウト・書式の修正はテンプレートファイルをExcelで編集するだけでOK

const ExcelTemplateExport = (() => {

  const TEMPLATE_URL = 'data/estimate_template.xlsx';

  // ===== 明細シートのページ構造（テンプレートと一致させる） =====
  const ROWS_PER_PAGE = 35;
  const DATA_ROW_OFFSET = 7;    // ページ内のデータ開始行オフセット
  const DATA_ROWS_PER_PAGE = 25; // 1ページあたりのデータ行数
  const TOTAL_ROW_OFFSET = 32;   // ページ内の合計行オフセット
  const PAGENO_ROW_OFFSET = 34;  // ページ内のページ番号オフセット
  const MAX_PAGES = 20;          // テンプレートに確保されたページ数

  // ===== メインエクスポート関数 =====
  async function exportFormatted() {
    if (typeof ExcelJS === 'undefined') {
      showToast('ExcelJSが読み込まれていません');
      return false;
    }

    // テンプレート読み込み
    let wb;
    try {
      const res = await fetch(TEMPLATE_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
    } catch (e) {
      console.warn('テンプレート読み込み失敗:', e);
      return false; // フォールバックへ
    }

    const wsCover   = wb.getWorksheet('表紙');
    const wsSummary = wb.getWorksheet('内訳書');
    const wsDetail  = wb.getWorksheet('内訳明細書');

    if (!wsCover || !wsSummary || !wsDetail) {
      console.warn('テンプレートに必要なシートがありません');
      return false;
    }

    // ----- 金額計算 -----
    const cats = activeCategories.filter(c => c.active);
    let grandTotal = 0;
    const catData = [];
    cats.forEach(c => {
      const total = Math.round(getCatAmount(c.id));
      grandTotal += total;
      catData.push({ cat: c, total });
    });

    // ----- Sheet1: 表紙 -----
    fillCoverSheet(wsCover, grandTotal);

    // ----- Sheet2: 内訳書 -----
    fillSummarySheet(wsSummary, catData);

    // ----- Sheet3: 内訳明細書 -----
    fillDetailSheet(wsDetail, cats);

    // ----- ファイル保存 -----
    const buffer = await wb.xlsx.writeBuffer();
    downloadFile(buffer);

    return true;
  }

  // ================================================================
  // Sheet1: 表紙 — 固定セルにデータを書き込む
  // ================================================================
  function fillCoverSheet(ws, grandTotal) {
    // 見積番号
    ws.getCell('P4').value = project.number || '';

    // 得意先
    ws.getCell('C6').value = (project.client || '') + '　御中';

    // 日付
    if (project.date) {
      const d = project.date.replace(/-/g, '/').replace(
        /^(\d{4})\/(\d+)\/(\d+)$/,
        '  $1年 $2月 $3日'
      );
      ws.getCell('O6').value = d;
    }

    // 税抜金額（G10消費税・G11合計はテンプレートの関数が計算）
    ws.getCell('G9').value = grandTotal;

    // 工事名
    ws.getCell('E14').value = project.name || '';

    // 施工場所
    ws.getCell('E15').value = project.location || '';

    // 担当者
    ws.getCell('P15').value = project.person || '';
  }

  // ================================================================
  // Sheet2: 内訳書 — カテゴリ行（7〜16行）にデータを書き込む
  // ================================================================
  function fillSummarySheet(ws, catData) {
    // 物件名
    ws.getCell('B4').value = project.name || '';

    // カテゴリ行（行7〜16、最大10工種）
    let row = 7;
    let catIndex = 1;
    catData.forEach(({ cat, total }) => {
      if (total === 0 && !cat.rateMode) return;
      if (row > 16) return; // テンプレートの確保行を超えたらスキップ

      ws.getCell(`B${row}`).value = `${catIndex}　${cat.name}`;
      ws.getCell(`D${row}`).value = 1;
      ws.getCell(`E${row}`).value = '式';
      ws.getCell(`G${row}`).value = total;

      if (cat.rateMode) {
        const note = `${(cat.ratePct || 0).toFixed(1)}%` +
          (cat.rateIncludeLabor ? '（労務費含）' : '');
        ws.getCell(`H${row}`).value = note;
      }

      row++;
      catIndex++;
    });

    // 合計行 G32 はテンプレートの SUM(G7:G16) 関数が計算 → 触らない
  }

  // ================================================================
  // Sheet3: 内訳明細書 — ページ単位でデータを埋める
  // ================================================================
  function fillDetailSheet(ws, cats) {
    const activeCats = cats.filter(c => !c.rateMode);
    let usedPages = 0;
    let catDisplayIndex = 1;

    activeCats.forEach(cat => {
      const catItems = (items[cat.id] || []).filter(i => i.name);
      if (catItems.length === 0) return;

      const catTotal = Math.round(getCatTotal(cat.id));
      const catLabel = `${catDisplayIndex}　${cat.name}`;
      catDisplayIndex++;

      // アイテムをページ単位に分割
      const pages = [];
      for (let i = 0; i < catItems.length; i += DATA_ROWS_PER_PAGE) {
        pages.push(catItems.slice(i, i + DATA_ROWS_PER_PAGE));
      }

      pages.forEach((pageItems, pageIdx) => {
        if (usedPages >= MAX_PAGES) return;
        const isLastPage = (pageIdx === pages.length - 1);
        const base = usedPages * ROWS_PER_PAGE;

        // カテゴリ名
        ws.getCell(`B${base + 4}`).value = catLabel;

        // データ行
        pageItems.forEach((item, i) => {
          const r = base + DATA_ROW_OFFSET + i;
          ws.getCell(`B${r}`).value = item.name || '';
          ws.getCell(`C${r}`).value = item.spec || '';

          const qty = parseFloat(item.qty);
          if (!isNaN(qty)) ws.getCell(`D${r}`).value = qty;

          ws.getCell(`E${r}`).value = item.unit || '';

          const price = parseFloat(item.price);
          if (!isNaN(price)) ws.getCell(`F${r}`).value = price;

          if (item.amount) ws.getCell(`G${r}`).value = Math.round(item.amount);

          if (item.note) ws.getCell(`H${r}`).value = item.note;
        });

        // 合計行
        const totalRow = base + TOTAL_ROW_OFFSET;
        if (isLastPage) {
          // 最終ページ: 工種合計を値で書き込む（複数ページの合算のため）
          ws.getCell(`G${totalRow}`).value = catTotal;
        } else {
          // 途中ページ: 合計行をクリア
          ws.getCell(`B${totalRow}`).value = '';
          ws.getCell(`G${totalRow}`).value = null;
        }

        // ページ番号（内訳書が1ページ目なので +2）
        ws.getCell(`B${base + PAGENO_ROW_OFFSET}`).value = usedPages + 2;

        usedPages++;
      });
    });

    // 未使用ページをクリア
    for (let page = usedPages; page < MAX_PAGES; page++) {
      const base = page * ROWS_PER_PAGE;
      clearPage(ws, base);
    }

    // 印刷範囲を使用分のみに設定
    if (usedPages > 0) {
      ws.pageSetup.printArea = `A1:I${usedPages * ROWS_PER_PAGE}`;
    }
  }

  // ページの内容をクリア（書式は残す）
  function clearPage(ws, base) {
    // タイトル
    ws.getCell(`B${base + 2}`).value = '';
    // カテゴリ名
    ws.getCell(`B${base + 4}`).value = '';
    // 見積№ラベル
    ws.getCell(`H${base + 4}`).value = '';
    // 列ヘッダー
    ['B','C','D','E','F','G','H'].forEach(col => {
      ws.getCell(`${col}${base + 6}`).value = '';
    });
    // データ行（念のためクリア）
    for (let i = 0; i < DATA_ROWS_PER_PAGE; i++) {
      ['B','C','D','E','F','G','H'].forEach(col => {
        ws.getCell(`${col}${base + DATA_ROW_OFFSET + i}`).value = null;
      });
    }
    // 合計行
    ws.getCell(`B${base + TOTAL_ROW_OFFSET}`).value = '';
    ws.getCell(`G${base + TOTAL_ROW_OFFSET}`).value = null;
    // ページ番号
    ws.getCell(`B${base + PAGENO_ROW_OFFSET}`).value = '';
  }

  // ファイルダウンロード
  function downloadFile(buffer) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (project.name || '新規').replace(/[\/\\:*?"<>|]/g, '');
    a.download = '見積書_' + safeName + '_' + (project.date || '') + '.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  return { exportFormatted };
})();
