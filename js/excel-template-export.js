// ===== テンプレート方式Excel出力（本丸EXプレースホルダー置換） =====
// data/estimate_template.xlsx を読み込み、**プレースホルダーをデータで置換して出力
// テンプレートは scripts/prepare-template.js で生成（Sheet2が20ページに展開済み）

const ExcelTemplateExport = (() => {

  const TEMPLATE_URL = 'data/estimate_template.xlsx';
  const PAGE_ROWS    = 35;  // Sheet2: 1ページあたりの行数（**PageEnd が行35）
  const ITEMS_PER_PAGE = 26; // **m_hin01〜**m_hin26
  const TOTAL_ROW_IN_PAGE = 33; // 各ページ内の合計行（1始まり）
  const PAGENO_ROW_IN_PAGE = 34; // 各ページ内のページ番号行

  // ===== メインエクスポート =====
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
      return false;
    }

    const sheet1 = wb.getWorksheet('Sheet1');
    const sheet2 = wb.getWorksheet('Sheet2');

    if (!sheet1 || !sheet2) {
      console.warn('Sheet1 / Sheet2 が見つかりません');
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

    // ----- Sheet2: ページ割り付け -----
    const pages = buildPages(cats);

    // ----- 各シートを埋める -----
    fillSheet1(sheet1, grandTotal, catData);
    fillSheet2(sheet2, pages);

    // ----- ダウンロード -----
    const buffer = await wb.xlsx.writeBuffer();
    downloadFile(buffer);
    return true;
  }

  // ================================================================
  // Sheet2 ページ割り付け
  // 各工種をITEMS_PER_PAGE行ごとにページに分割
  // ================================================================
  function buildPages(cats) {
    const pages = [];
    let catIdx = 1;

    cats.filter(c => !c.rateMode).forEach(cat => {
      const catItems = (items[cat.id] || []).filter(i => i.name);
      if (!catItems.length) return;

      const catLabel = `${catIdx}　${cat.name}`;
      catIdx++;
      const catTotal = Math.round(getCatTotal(cat.id));

      for (let s = 0; s < catItems.length; s += ITEMS_PER_PAGE) {
        const chunk = catItems.slice(s, s + ITEMS_PER_PAGE);
        const isLast = (s + ITEMS_PER_PAGE >= catItems.length);
        pages.push({
          catLabel,
          items: chunk,
          total: isLast ? catTotal : null,
          pageNum: pages.length + 2, // 表紙が1ページ目
        });
      }
    });

    return pages;
  }

  // ================================================================
  // Sheet1（見積書・表紙）— **h_* プレースホルダーを置換
  // ================================================================
  function fillSheet1(ws, grandTotal, catData) {
    const tax      = Math.floor(grandTotal * 0.1);
    const taxTotal = grandTotal + tax;

    // 日付フォーマット
    let dateStr = '';
    if (project.date) {
      dateStr = project.date.replace(
        /^(\d{4})-(\d+)-(\d+)$/,
        (_, y, m, d) => `${y}年${parseInt(m)}月${parseInt(d)}日`
      );
    }

    // 表紙の基本データマップ
    const map = {
      '**h_mno':       project.number  || '',
      '**h_mdate2':    dateStr,
      '**h_tok':       project.client  ? project.client + '　御中' : '',
      '**h_tok02':     '',
      '**h_mkin':      grandTotal,
      '**h_zei':       tax,
      '**h_zeikomi':   taxTotal,
      '**h_kouji01':   project.name    || '',
      '**hl_kouji01':  '工　事　名',
      '**h_kouji02':   project.name    || '',
      '**h_sekou':     project.location || '',
      '**hl_sekou':    '施　工　場　所',
      '**hl_koukidate':'工　　　期',
      '**h_kouki':     '',
      '**hl_siharai':  '支　払　条　件',
      '**h_siharai':   '',
      '**hl_kigen':    '見積有効期限',
      '**h_kigen':     '',
      '**h_jisya01':   '',
      '**h_jisya02':   '',
      '**h_jisya03':   '',
      '**h_jisya04':   '',
      '**h_jisya05':   '',
      '**h_jisya06':   '',
      '**h_hbikou01':  '',
      '**h_hbikou02':  '',
      '**h_hbikou03':  '',
      '**h_hbikou04':  '',
      '**h_hbikou05':  '',
      '**h_page':      1,
      '**PageEnd':     '',
    };

    // 工種一覧（**h_hin01〜**h_hin12）
    catData.forEach(({ cat, total }, i) => {
      if (i >= 12) return;
      const n = String(i + 1).padStart(2, '0');
      map[`**h_hin${n}`]    = `${i + 1}　${cat.name}`;
      map[`**h_kik${n}`]    = '';
      map[`**h_suu${n}`]    = 1;
      map[`**h_tani${n}`]   = '式';
      map[`**h_tanka${n}`]  = total;
      map[`**h_kin${n}`]    = total;
      map[`**h_mbikou${n}`] = cat.rateMode ? `${(cat.ratePct || 0).toFixed(1)}%` : '';
    });

    // セルを走査してプレースホルダーを置換
    replacePlaceholders(ws, (placeholder) => map[placeholder] ?? '');
  }

  // ================================================================
  // Sheet2（内訳明細書）— **m_* プレースホルダーをページ別に置換
  // ================================================================
  function fillSheet2(ws, pages) {
    ws.eachRow((row, rowNum) => {
      const pageIdx = Math.floor((rowNum - 1) / PAGE_ROWS); // 0始まり
      const rowInPage = ((rowNum - 1) % PAGE_ROWS) + 1;     // 1始まり

      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        if (typeof v !== 'string' || !v.startsWith('**')) return;

        if (pageIdx < pages.length) {
          cell.value = resolveSheet2Placeholder(v, pages[pageIdx]);
        } else {
          cell.value = ''; // 未使用ページ: クリア
        }
      });

      // 合計行・ページ番号行を直接書き込み
      if (rowInPage === TOTAL_ROW_IN_PAGE && pageIdx < pages.length) {
        const pg = pages[pageIdx];
        if (pg.total !== null) {
          // 合計金額セルを探して書き込む（G列 = 列7）
          const cell = row.getCell(7);
          if (!cell.value || typeof cell.value === 'string') {
            cell.value = pg.total;
          }
        }
      }
    });

    // 使用ページに改ページを設定
    for (let p = 0; p < pages.length; p++) {
      const breakRow = (p + 1) * PAGE_ROWS;
      if (breakRow < pages.length * PAGE_ROWS) {
        ws.getRow(breakRow).addPageBreak();
      }
    }

    // 印刷範囲を使用分のみに設定
    if (pages.length > 0) {
      ws.pageSetup = ws.pageSetup || {};
      ws.pageSetup.printArea = `A1:H${pages.length * PAGE_ROWS}`;
    }
  }

  // Sheet2 プレースホルダーを1ページ分のデータで解決
  function resolveSheet2Placeholder(placeholder, page) {
    if (placeholder === '**m_kousyu') return page.catLabel;
    if (placeholder === '**m_mno')    return project.number || '';
    if (placeholder === '**m_page')   return page.pageNum;
    if (placeholder === '**PageEnd')  return '';

    // 品目行: **m_hin01, **m_kik01, ...
    const match = placeholder.match(/^\*\*m_(hin|kik|suu|tani|tanka|kin|mbikou)(\d{2})$/);
    if (match) {
      const field   = match[1];
      const itemIdx = parseInt(match[2]) - 1;
      const item    = page.items[itemIdx];
      if (!item) return '';
      switch (field) {
        case 'hin':    return item.name  || '';
        case 'kik':    return item.spec  || '';
        case 'suu':    { const q = parseFloat(item.qty);   return isNaN(q) ? '' : q; }
        case 'tani':   return item.unit  || '';
        case 'tanka':  { const p = parseFloat(item.price); return isNaN(p) ? '' : p; }
        case 'kin':    return item.amount ? Math.round(item.amount) : '';
        case 'mbikou': return item.note  || '';
      }
    }

    return ''; // 未知プレースホルダーはクリア
  }

  // ================================================================
  // 共通: シート内の ** プレースホルダーを置換関数で一括置換
  // ================================================================
  function replacePlaceholders(ws, resolver) {
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: true }, cell => {
        const v = cell.value;
        if (typeof v === 'string' && v.startsWith('**')) {
          cell.value = resolver(v);
        }
      });
    });
  }

  // ================================================================
  // ファイルダウンロード
  // ================================================================
  function downloadFile(buffer) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    const safeName = (project.name || '新規').replace(/[\/\\:*?"<>|]/g, '');
    a.download = '見積書_' + safeName + '_' + (project.date || '') + '.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  return { exportFormatted };
})();
