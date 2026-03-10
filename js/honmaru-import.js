// ===== 本丸EX インポート（ブラウザ版） =====
// 見積明細チェックリスト + 実行予算書(表紙総括表) + 実行予算書(機器) の
// 3ファイルセットをブラウザ上で解析し、ナレッジDBに直接インポートする

// ===== ユーティリティ =====
function hmStr(v)  { return String(v == null ? '' : v).trim(); }
function hmNum(v)  { return parseFloat(v) || 0; }
function hmNormLabel(s) { return hmStr(s).replace(/[\s\u3000]+/g, ''); }
function hmNormName(s)  { return hmStr(s).normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, ''); }

function hmExcelDate(n) {
  if (typeof n !== 'number' || n <= 0) return '';
  try {
    const d = XLSX.SSF.parse_date_code(n);
    if (!d || !d.y) return '';
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  } catch { return ''; }
}

// ===== フォルダ名から物件情報を推定 =====
function hmParseFromFolderName(folderName) {
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
function hmParseChecklist(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let number = '', projectName = '', client = '', person = '';
  const categories = [];
  let currentCat = null;
  let headerCount = 0;

  for (const r of rows) {
    const c0 = hmStr(r[0]);
    const c1 = hmStr(r[1]);
    const c2 = hmStr(r[2]);

    // ページ繰り返し検出（2ページ目以降はスキップ）
    if (c0.includes('見積明細チェックリスト') || c1 === '見積明細チェックリスト') {
      headerCount++;
      if (headerCount >= 2) break;
      continue;
    }

    // プロジェクト情報行
    if (c1 === '見積番号' && !number) { number = hmStr(r[4]); continue; }
    if (c1 === '工事名'   && !projectName) { projectName = hmStr(r[4]); continue; }
    if (c1 === '工事名２') { person = hmStr(r[14]); continue; }
    if (c1 === '得意先'   && !client) { client = hmStr(r[4]); continue; }

    // 工種名行 → 新しいカテゴリ開始
    if (c1 === '工種名') {
      const catName  = hmStr(r[4]);
      const catTotal = hmNum(r[14]);
      const catCost  = hmNum(r[16]);
      if (catName) {
        currentCat = { name: catName, total: catTotal, costTotal: catCost, profitRate: 0, laborHours: 0, items: [] };
        categories.push(currentCat);
      }
      continue;
    }

    // ヘッダー行・空行をスキップ
    if (!c2 && !hmStr(r[3])) continue;
    if (c2 === '集計' || hmStr(r[3]) === '品 名' || hmStr(r[3]) === '品名') continue;

    // 自動計算行をスキップ
    if (/^[A-Z]{1,3}\d+$/.test(c2)) continue;
    const specRaw = hmStr(r[7]);
    if (specRaw.startsWith('＜自動計算') || specRaw.startsWith('<自動計算')) continue;

    if (!currentCat) continue;
    const name = hmStr(r[3]);
    if (!name) continue;

    const spec       = specRaw.replace(/[＜<][^>]*$/, '').trim();
    const unit       = hmStr(r[9]);
    const qty        = hmNum(r[10]);
    const price      = hmNum(r[13]);
    const amount     = hmNum(r[15]) || Math.round(qty * price);
    const costPrice  = hmNum(r[17]);
    const costAmount = hmNum(r[19]) || Math.round(qty * costPrice);
    const bukariki   = hmNum(r[22]);
    const laborHours = hmNum(r[24]);

    if (!unit || price <= 0) continue;

    currentCat.items.push({
      name, spec, qty, unit,
      listPrice: 0, price: Math.round(price), sellRate: 0,
      costPrice: Math.round(costPrice), costRate: 0,
      amount: Math.round(amount), costAmount: Math.round(costAmount),
      bukariki, laborHours,
    });
  }

  return { number, projectName, client, person, categories };
}

// ===== 実行予算書(表紙総括表)解析 =====
function hmParseSummary(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let number = '', projectName = '', client = '', person = '', date = '';
  let workTotal = 0, miscExpenseAmt = 0, discountAmt = 0;
  let grandTotal = 0, costTotal = 0, profitRate = 0;
  const cats = [];
  let inBody = false;

  for (const r of rows) {
    const c1label = hmNormLabel(hmStr(r[1]));

    if (!inBody) {
      if (hmStr(r[8]) === '工事名' && hmStr(r[19]) === '見積番号') {
        projectName = hmStr(r[9]);
        number = hmStr(r[21]);
      }
      if (hmStr(r[8]) === '得意先' && hmStr(r[19]) === '担当者名') {
        client = hmStr(r[9]);
        person = hmStr(r[21]);
      }
      if (hmStr(r[1]) === '見積日付') date = hmExcelDate(r[2]);
      if (c1label === '工種名') { inBody = true; }
      continue;
    }

    if (c1label.includes('合計') && c1label !== '工種名') {
      grandTotal = hmNum(r[13]);
      costTotal  = hmNum(r[15]);
      profitRate = Math.round(hmNum(r[20]) * 10) / 10;
      break;
    }

    const catName = hmStr(r[1]);
    if (!catName) continue;

    const rowTotal  = hmNum(r[13]);
    const rowCost   = hmNum(r[15]);
    const rowHours  = hmNum(r[16]);
    const rowProfit = Math.round(hmNum(r[20]) * 10) / 10;

    if (hmNormLabel(catName) === '諸経費') {
      miscExpenseAmt = rowTotal;
    } else if (catName.startsWith('△') || hmNormLabel(catName).includes('値引')) {
      discountAmt = Math.abs(rowTotal);
    } else {
      workTotal += rowTotal;
      cats.push({ name: catName, total: rowTotal, costTotal: rowCost, laborHours: rowHours, profitRate: rowProfit });
    }
  }

  const miscExpensePct = workTotal > 0 ? Math.round(miscExpenseAmt / workTotal * 1000) / 10 : 0;
  const base = workTotal + miscExpenseAmt;
  const discountPct = base > 0 ? Math.round(discountAmt / base * 1000) / 10 : 0;

  return { number, projectName, client, person, date, workTotal, miscExpenseAmt, miscExpensePct, discountAmt, discountPct, grandTotal, costTotal, profitRate, cats };
}

// ===== 実行予算書(機器)解析 =====
function hmParseKiki(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const map = new Map();
  let inBody = false;

  for (const r of rows) {
    const c7 = hmStr(r[7]);
    if (c7.includes('実 行 計 算 書') || hmNormLabel(c7).includes('実行計算書')) {
      inBody = false;
      continue;
    }
    if (hmNormLabel(hmStr(r[1])) === '品名' && hmNormLabel(hmStr(r[13])).includes('定価')) {
      inBody = true;
      continue;
    }
    if (!inBody) continue;

    const c1 = hmStr(r[1]);
    if (!c1 || hmNormLabel(c1).includes('小計') || c1.includes('＊')) continue;

    const listPrice = hmNum(r[13]);
    const sellRate  = hmNum(r[15]);
    const costRate  = hmNum(r[19]);
    if (!c1 || listPrice <= 0) continue;

    const key = hmNormName(c1);
    if (!map.has(key)) {
      map.set(key, {
        listPrice,
        sellRate: Math.round(sellRate * 10) / 10,
        costRate: Math.round(costRate * 10) / 10,
      });
    }
  }
  return map;
}

// ===== ファイルをグループ化（1物件 or 複数物件の親フォルダ対応） =====
function hmGroupFiles(files) {
  // webkitRelativePath: "parentFolder/projectFolder/file.xlsx" or "projectFolder/file.xlsx"
  const groups = {};

  for (const file of files) {
    if (!/\.(xls|xlsx)$/i.test(file.name)) continue;
    const parts = file.webkitRelativePath.split('/');
    // 深さ2(直下のファイル) → 単一物件モード
    // 深さ3以上(サブフォルダ) → 親フォルダモード
    const key = parts.length >= 3 ? parts[1] : parts[0];
    if (!groups[key]) groups[key] = { folderName: key, checklist: null, summary: null, kiki: null };
    if (/見積明細チェックリスト/i.test(file.name)) groups[key].checklist = file;
    else if (/実行予算書.*表紙/i.test(file.name))   groups[key].summary   = file;
    else if (/実行予算書.*機器/i.test(file.name))    groups[key].kiki      = file;
  }

  return Object.values(groups).filter(g => g.checklist);
}

// ===== ArrayBufferからWBを読み込み =====
async function hmReadFile(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array' });
}

// ===== メイン処理 =====
async function honmaruHandleFiles(files) {
  const groups = hmGroupFiles(files);
  if (groups.length === 0) {
    showToast('見積明細チェックリストが見つかりません');
    return;
  }

  document.getElementById('hmProgressArea').style.display = '';
  document.getElementById('hmProgressText').textContent = `0 / ${groups.length} 件処理中...`;
  document.getElementById('hmPreviewArea').style.display = 'none';

  const records = [];
  let done = 0;

  for (const g of groups) {
    try {
      const clWb = await hmReadFile(g.checklist);
      const cl   = hmParseChecklist(clWb);

      let summary = null;
      if (g.summary) {
        try { summary = hmParseSummary(await hmReadFile(g.summary)); } catch {}
      }

      let kikiMap = new Map();
      if (g.kiki) {
        try { kikiMap = hmParseKiki(await hmReadFile(g.kiki)); } catch {}
      }

      // 機器データを品目に補完
      for (const cat of cl.categories) {
        for (const item of cat.items) {
          const kd = kikiMap.get(hmNormName(item.name));
          if (kd) { item.listPrice = kd.listPrice; item.sellRate = kd.sellRate; item.costRate = kd.costRate; }
        }
      }

      // 工種別工数・原価を表紙総括表から補完
      if (summary && summary.cats.length > 0) {
        for (const cat of cl.categories) {
          const sc = summary.cats.find(c => hmNormLabel(c.name) === hmNormLabel(cat.name));
          if (sc) {
            cat.laborHours = sc.laborHours;
            if (sc.total > 0)     cat.total      = sc.total;
            if (sc.costTotal > 0) cat.costTotal  = sc.costTotal;
            if (sc.profitRate > 0) cat.profitRate = sc.profitRate;
          }
        }
      }

      const { number: folderNum, projectName: folderName, type, usage } = hmParseFromFolderName(g.folderName);
      const number      = cl.number      || (summary && summary.number)      || folderNum;
      const projectName = cl.projectName || (summary && summary.projectName) || folderName;
      const client      = cl.client      || (summary && summary.client)      || '';
      const person      = cl.person      || (summary && summary.person)      || '';
      const date        = (summary && summary.date) || '';

      const grandTotal     = (summary && summary.grandTotal > 0) ? summary.grandTotal : cl.categories.reduce((s, c) => s + c.total, 0);
      const costTotal      = (summary && summary.costTotal)      || 0;
      const workTotal      = (summary && summary.workTotal)      || grandTotal;
      const miscExpenseAmt = (summary && summary.miscExpenseAmt) || 0;
      const miscExpensePct = (summary && summary.miscExpensePct) || 0;
      const discountAmt    = (summary && summary.discountAmt)    || 0;
      const discountPct    = (summary && summary.discountPct)    || 0;
      const profitRate     = (summary && summary.profitRate)     || 0;

      const itemCount = cl.categories.reduce((s, c) => s + c.items.length, 0);
      if (itemCount === 0) { done++; continue; }

      records.push({
        folderName: g.folderName,
        registeredAt: new Date().toISOString().split('T')[0],
        source: 'honmaru',
        project: {
          number, name: projectName, date, client, person,
          struct: '', type, usage,
          floors: '', areaTsubo: '', areaSqm: '',
        },
        workTotal: Math.round(workTotal), miscExpenseAmt: Math.round(miscExpenseAmt), miscExpensePct,
        discountAmt: Math.round(discountAmt), discountPct,
        grandTotal: Math.round(grandTotal), costTotal: Math.round(costTotal), profitRate,
        categories: cl.categories,
      });
    } catch(e) {
      console.warn('本丸インポート エラー:', g.folderName, e);
    }
    done++;
    document.getElementById('hmProgressText').textContent = `${done} / ${groups.length} 件処理中...`;
  }

  document.getElementById('hmProgressArea').style.display = 'none';

  if (records.length === 0) {
    showToast('取り込み可能な物件がありませんでした');
    return;
  }

  hmShowPreview(records);
}

// ===== プレビュー表示 =====
function hmShowPreview(records) {
  // records を DOM に保持
  document.getElementById('hmPreviewArea')._records = records;

  const tbody = document.getElementById('hmPreviewBody');
  tbody.innerHTML = records.map((r, i) => {
    const p = r.project;
    const itemCount = r.categories.reduce((s, c) => s + c.items.length, 0);
    return `<tr>
      <td style="font-size:11px;">${esc(p.name || r.folderName)}</td>
      <td style="font-size:11px;">${esc(p.type||'—')}</td>
      <td style="font-size:11px;">${esc(p.usage||'—')}</td>
      <td style="font-size:11px;">
        <input type="text" value="${esc(p.struct)}" placeholder="RC造"
          oninput="document.getElementById('hmPreviewArea')._records[${i}].project.struct=this.value"
          style="width:60px;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;">
      </td>
      <td style="font-size:11px;">
        <input type="number" value="${p.areaTsubo}" placeholder="坪"
          oninput="document.getElementById('hmPreviewArea')._records[${i}].project.areaTsubo=this.value"
          style="width:55px;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;">
      </td>
      <td class="td-right" style="font-size:11px;">¥${formatNum(r.grandTotal)}</td>
      <td class="td-right" style="font-size:11px;">${r.profitRate}%</td>
      <td class="td-right" style="font-size:11px;">${itemCount}品目</td>
    </tr>`;
  }).join('');

  document.getElementById('hmPreviewCount').textContent = records.length;
  document.getElementById('hmPreviewArea').style.display = '';
}

// ===== ナレッジDBに一括インポート =====
async function honmaruImportConfirm() {
  const records = document.getElementById('hmPreviewArea')._records;
  if (!records || records.length === 0) return;

  let imported = 0;
  for (const rec of records) {
    try {
      const { folderName, ...data } = rec; // folderName は保存しない
      await knowledgeDB.save(data);
      imported++;
    } catch(e) { console.warn('保存失敗:', e); }
  }

  showToast(`${imported}件をナレッジDBに登録しました`);
  document.getElementById('hmImportModal').classList.remove('show');
  renderDBTable();
}

// ===== モーダルを開く =====
function honmaruOpenModal() {
  document.getElementById('hmProgressArea').style.display = 'none';
  document.getElementById('hmPreviewArea').style.display = 'none';
  document.getElementById('hmFolderInput').value = '';
  document.getElementById('hmImportModal').classList.add('show');
}
