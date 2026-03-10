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
// カラム定義（0始まりインデックス）:
//   r[1]  = 行種別ラベル
//   r[2]  = 集計コード
//   r[3]  = 品名
//   r[4]  = 工事名・見積番号値（ヘッダー行）
//   r[6]  = 管理番号値
//   r[7]  = 規格
//   r[9]  = 単位
//   r[10] = 見積数量
//   r[13] = 見積単価
//   r[15] = 見積金額
//   r[16] = 原価数量
//   r[17] = 原価単価
//   r[19] = 原価金額
//   r[20] = 利益率
//   r[22] = 歩掛
//   r[24] = 工数
//   r[26] = 備考
//   r[17] = 使用パターン（ヘッダーエリア）
//   r[22] = 職種名 / r[25] = 原価単価 / r[27] = 見積単価（ヘッダーエリア）
function hmParseChecklist(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let number = '', projectName = '', client = '', person = '', managementNumber = '';
  let usePattern = '';
  const laborRates = {};  // { '電工': { sell, cost }, ... }
  const categories = [];
  let currentCat = null;

  const LABOR_TYPES = ['電工', '弱電工', '機械工', 'ダクト工', '配管工'];

  for (const r of rows) {
    const c0 = hmStr(r[0]);
    const c1 = hmStr(r[1]);
    const c2 = hmStr(r[2]);

    // ページヘッダー行はスキップ（複数ページにまたがるためbreakしない）
    if (c0.includes('見積明細チェックリスト') || c1 === '見積明細チェックリスト') {
      continue;
    }

    // 労務単価ヘッダーエリア: 職種名が r[22] に入っている行
    const laborTypeName = hmStr(r[22]);
    if (LABOR_TYPES.some(t => laborTypeName === t)) {
      const cost = hmNum(r[25]);
      const sell = hmNum(r[27]);
      if (cost > 0 || sell > 0) {
        laborRates[laborTypeName] = { sell, cost };
      }
      // 使用パターンは最初の労務行の r[17] に入っている
      if (!usePattern && hmStr(r[17])) usePattern = hmStr(r[17]);
      continue;
    }

    // プロジェクト情報行
    if (c1 === '見積番号' && !number) {
      number = hmStr(r[4]);
      if (!managementNumber) managementNumber = hmStr(r[6]);
      continue;
    }
    if (c1 === '工事名'   && !projectName) { projectName = hmStr(r[4]); continue; }
    if (c1 === '工事名２') { person = hmStr(r[14]); continue; }
    if (c1 === '得意先'   && !client) { client = hmStr(r[4]); continue; }

    // 工種名行 → 新しいカテゴリ開始
    if (c1 === '工種名') {
      const catName  = hmStr(r[4]);
      const catTotal = hmNum(r[14]);
      const catCost  = hmNum(r[16]);
      if (catName) {
        currentCat = { name: catName, total: catTotal, costTotal: catCost,
                       profitRate: 0, laborHours: 0, qty: 0, unit: '', profitAmt: 0, items: [] };
        categories.push(currentCat);
      }
      continue;
    }

    // ヘッダー行・空行をスキップ
    if (!c2 && !hmStr(r[3])) continue;
    if (c2 === '集計' || hmStr(r[3]) === '品 名' || hmStr(r[3]) === '品名') continue;

    // 自動計算行をスキップ（コードが英字+数字）
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
    const costQty    = hmNum(r[16]);
    const costPrice  = hmNum(r[17]);
    const costAmount = hmNum(r[19]) || Math.round(qty * costPrice);
    const profitRate = hmNum(r[20]);
    const bukariki   = hmNum(r[22]);
    const laborHours = hmNum(r[24]);
    const note       = hmStr(r[26]);

    if (!unit || price <= 0) continue;

    currentCat.items.push({
      code: c2,
      name, spec, qty, unit,
      listPrice: 0, price: Math.round(price), sellRate: 0,
      costQty, costPrice: Math.round(costPrice), costRate: 0,
      amount: Math.round(amount), costAmount: Math.round(costAmount),
      profitRate, bukariki, laborHours, note,
    });
  }

  return { number, managementNumber, projectName, client, person, usePattern, laborRates, categories };
}

// ===== 実行予算書(表紙総括表)解析 =====
// カラム定義（0始まり）:
//   Row1: r[8]="工事名", r[9]=工事名, r[19]="見積番号", r[21]=見積番号
//   Row2: r[8]="工事名２", r[19]="見積管理番号", r[21]=管理番号値
//   Row3: r[8]="得意先", r[9]=得意先名, r[19]="担当者名", r[21]=担当者名
//   Row5: r[1]="見積日付", r[2]=シリアル日付, r[5]="更新日", r[6]=シリアル日付
//         r[8]="見積メモ", r[9]=メモ値
//   Row7: r[1]="工　期", r[2]=着工日, r[12]="施工場所", r[13]=施工場所値
//   Row8: r[1]="支払条件", r[2]=値, r[12]="有効期限", r[14]=値
//   工種ボディ行: r[1]=工種名, r[10]=数量, r[11]=単位, r[13]=見積金額,
//                r[15]=実行金額, r[16]=工数, r[17]=粗利額, r[18]=粗利率, r[22]=明細数
function hmParseSummary(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let number = '', managementNumber = '', projectName = '', client = '', person = '';
  let date = '', updatedAt = '', location = '', workStart = '', workEnd = '';
  let paymentTerms = '', validUntil = '', memo = '';
  let workTotal = 0, miscExpenseAmt = 0, miscExpenseCost = 0, discountAmt = 0;
  let grandTotal = 0, costTotal = 0, profitRate = 0, legalWelfare = 0;
  const cats = [];
  let inBody = false;

  for (const r of rows) {
    const c1label = hmNormLabel(hmStr(r[1]));

    if (!inBody) {
      // 工事名・見積番号行
      if (hmStr(r[8]) === '工事名' && hmStr(r[19]) === '見積番号') {
        projectName = hmStr(r[9]);
        number = hmStr(r[21]);
      }
      // 工事名２・管理番号行
      if (hmStr(r[8]) === '工事名２' && hmNormLabel(hmStr(r[19])).includes('管理番号')) {
        managementNumber = hmStr(r[21]);
      }
      // 得意先・担当者行
      if (hmStr(r[8]) === '得意先' && hmStr(r[19]) === '担当者名') {
        client = hmStr(r[9]);
        person = hmStr(r[21]);
      }
      // 見積日付・更新日・見積メモ行
      if (hmStr(r[1]) === '見積日付') {
        date      = hmExcelDate(r[2]);
        if (hmStr(r[5]) === '更新日') updatedAt = hmExcelDate(r[6]);
        if (hmStr(r[8]) === '見積メモ') memo = hmStr(r[9]);
      }
      // 工期・施工場所行
      if (c1label.includes('工期')) {
        workStart = typeof r[2] === 'number' ? hmExcelDate(r[2]) : hmStr(r[2]);
        workEnd   = typeof r[3] === 'number' ? hmExcelDate(r[3]) : hmStr(r[3]);
        if (hmStr(r[12]) === '施工場所') location = hmStr(r[13]);
      }
      // 支払条件・有効期限行
      if (c1label.includes('支払条件')) {
        paymentTerms = hmStr(r[2]);
        if (hmNormLabel(hmStr(r[12])).includes('有効期限')) validUntil = hmStr(r[14]);
      }
      // Body開始
      if (c1label === '工種名') { inBody = true; }
      continue;
    }

    // 法定福利費行（ボディ内）
    if (c1label.includes('法定福利費') || c1label.includes('法廷福利費')) {
      legalWelfare = hmNum(r[13]);
      continue;
    }

    // 合計行
    if (c1label.includes('合計') && c1label !== '工種名') {
      grandTotal = hmNum(r[13]);
      costTotal  = hmNum(r[15]);
      profitRate = Math.round(hmNum(r[20]) * 10) / 10;
      break;
    }

    const catName = hmStr(r[1]);
    if (!catName) continue;

    const rowTotal   = hmNum(r[13]);
    const rowCost    = hmNum(r[15]);
    const rowHours   = hmNum(r[16]);
    const rowProfit  = Math.round(hmNum(r[20]) * 10) / 10;
    const rowQty     = hmNum(r[10]);
    const rowUnit    = hmStr(r[11]);
    const rowProfAmt = hmNum(r[17]) || Math.round(rowTotal - rowCost);
    const rowItems   = hmNum(r[22]);

    if (hmNormLabel(catName) === '諸経費') {
      miscExpenseAmt  = rowTotal;
      miscExpenseCost = rowCost;
    } else if (catName.startsWith('△') || hmNormLabel(catName).includes('値引')) {
      discountAmt = Math.abs(rowTotal);
    } else {
      workTotal += rowTotal;
      cats.push({ name: catName, total: rowTotal, costTotal: rowCost,
                  laborHours: rowHours, profitRate: rowProfit,
                  qty: rowQty, unit: rowUnit, profitAmt: rowProfAmt, itemCount: rowItems });
    }
  }

  const miscExpensePct = workTotal > 0 ? Math.round(miscExpenseAmt / workTotal * 1000) / 10 : 0;
  const base = workTotal + miscExpenseAmt;
  const discountPct = base > 0 ? Math.round(discountAmt / base * 1000) / 10 : 0;
  const profitTotal = Math.round(grandTotal - costTotal);
  const totalLaborHours = cats.reduce((s, c) => s + (c.laborHours || 0), 0);

  return {
    number, managementNumber, projectName, client, person,
    date, updatedAt, location, workStart, workEnd,
    paymentTerms, validUntil, memo,
    workTotal, miscExpenseAmt, miscExpenseCost, miscExpensePct,
    discountAmt, discountPct,
    grandTotal, costTotal, profitRate, profitTotal,
    totalLaborHours, legalWelfare, cats,
  };
}

// ===== 実行予算書(機器)解析 =====
// カラム定義（0始まり）:
//   r[1] =品名, r[5]=規格, r[8]=単位, r[9]=数量, r[10]=基準単価,
//   r[13]=定価, r[15]=見積掛率, r[16]=見積単価, r[18]=見積金額,
//   r[19]=原価掛率, r[20]=原価単価, r[21]=原価金額, r[22]=目標原価
function hmParseKiki(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const map  = new Map();  // name → { listPrice, sellRate, costRate } (品目補完用)
  const list = [];         // 機器明細リスト（全フィールド）
  let inBody = false;

  for (const r of rows) {
    const c7 = hmStr(r[7]);
    if (c7.includes('実 行 計 算 書') || hmNormLabel(c7).includes('実行計算書')) {
      inBody = false; continue;
    }
    if (hmNormLabel(hmStr(r[1])) === '品名' && hmNormLabel(hmStr(r[13])).includes('定価')) {
      inBody = true; continue;
    }
    if (!inBody) continue;

    const c1 = hmStr(r[1]);
    if (!c1 || hmNormLabel(c1).includes('小計') || c1.includes('＊')) continue;

    const listPrice  = hmNum(r[13]);
    const sellRate   = hmNum(r[15]);
    const costRate   = hmNum(r[19]);
    if (!c1 || listPrice <= 0) continue;

    const key = hmNormName(c1);
    if (!map.has(key)) {
      map.set(key, {
        listPrice,
        sellRate:  Math.round(sellRate * 10) / 10,
        costRate:  Math.round(costRate * 10) / 10,
      });
    }

    list.push({
      name:        c1,
      spec:        hmStr(r[5]),
      unit:        hmStr(r[8]),
      qty:         hmNum(r[9]),
      basePrice:   hmNum(r[10]),
      listPrice:   Math.round(listPrice),
      sellRate:    Math.round(sellRate * 10) / 10,
      sellPrice:   Math.round(hmNum(r[16])),
      sellAmount:  Math.round(hmNum(r[18])),
      costRate:    Math.round(costRate * 10) / 10,
      costPrice:   Math.round(hmNum(r[20])),
      costAmount:  Math.round(hmNum(r[21])),
      targetCost:  Math.round(hmNum(r[22])),
    });
  }

  return { map, list };
}

// ===== ファイルをグループ化（1物件 or 複数物件の親フォルダ対応） =====
function hmGroupFiles(files) {
  const groups = {};
  for (const file of files) {
    if (!/\.(xls|xlsx)$/i.test(file.name)) continue;
    const parts = file.webkitRelativePath.split('/');
    const key = parts.length >= 3 ? parts[1] : parts[0];
    if (!groups[key]) groups[key] = { folderName: key, checklist: null, summary: null, kiki: null };
    if (/見積明細チェックリスト/i.test(file.name)) groups[key].checklist = file;
    else if (/実行予算書.*表紙/i.test(file.name))   groups[key].summary   = file;
    else if (/実行予算書.*機器/i.test(file.name))    groups[key].kiki      = file;
  }
  return Object.values(groups).filter(g => g.checklist);
}

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
        try { summary = hmParseSummary(await hmReadFile(g.summary)); } catch(e) { console.warn('表紙解析エラー:', e); }
      }

      let kiki = { map: new Map(), list: [] };
      if (g.kiki) {
        try { kiki = hmParseKiki(await hmReadFile(g.kiki)); } catch(e) { console.warn('機器解析エラー:', e); }
      }

      // 機器データを品目に補完（定価・見積掛率・原価掛率）
      for (const cat of cl.categories) {
        for (const item of cat.items) {
          const kd = kiki.map.get(hmNormName(item.name));
          if (kd) { item.listPrice = kd.listPrice; item.sellRate = kd.sellRate; item.costRate = kd.costRate; }
        }
      }

      // 工種別工数・原価・粗利率を表紙総括表から補完
      if (summary && summary.cats.length > 0) {
        for (const cat of cl.categories) {
          const sc = summary.cats.find(c => hmNormLabel(c.name) === hmNormLabel(cat.name));
          if (sc) {
            cat.laborHours = sc.laborHours;
            cat.qty        = sc.qty;
            cat.unit       = sc.unit;
            cat.profitAmt  = sc.profitAmt;
            cat.profitRate = sc.profitRate;
            if (sc.total > 0)     cat.total     = sc.total;
            if (sc.costTotal > 0) cat.costTotal = sc.costTotal;
          }
        }
      }

      const { number: folderNum, projectName: folderName, type, usage } = hmParseFromFolderName(g.folderName);

      // プロジェクト情報（優先: チェックリスト > 表紙総括表 > フォルダ名）
      const number           = cl.number           || (summary && summary.number)           || folderNum;
      const managementNumber = cl.managementNumber || (summary && summary.managementNumber) || '';
      const projectName      = cl.projectName      || (summary && summary.projectName)      || folderName;
      const client           = cl.client           || (summary && summary.client)           || '';
      const person           = cl.person           || (summary && summary.person)           || '';
      const date             = (summary && summary.date)      || '';
      const updatedAt        = (summary && summary.updatedAt) || '';
      const location         = (summary && summary.location)  || '';
      const workStart        = (summary && summary.workStart) || '';
      const workEnd          = (summary && summary.workEnd)   || '';
      const paymentTerms     = (summary && summary.paymentTerms) || '';
      const validUntil       = (summary && summary.validUntil)   || '';
      const memo             = (summary && summary.memo)          || '';
      const usePattern       = cl.usePattern || '';
      const laborRates       = cl.laborRates || {};

      // 金額サマリー（表紙総括表優先）
      const grandTotal      = (summary && summary.grandTotal > 0) ? summary.grandTotal
                            : cl.categories.reduce((s, c) => s + c.total, 0);
      const costTotal       = (summary && summary.costTotal)       || 0;
      const workTotal       = (summary && summary.workTotal)       || grandTotal;
      const miscExpenseAmt  = (summary && summary.miscExpenseAmt)  || 0;
      const miscExpenseCost = (summary && summary.miscExpenseCost) || 0;
      const miscExpensePct  = (summary && summary.miscExpensePct)  || 0;
      const discountAmt     = (summary && summary.discountAmt)     || 0;
      const discountPct     = (summary && summary.discountPct)     || 0;
      const profitRate      = (summary && summary.profitRate)      || 0;
      const profitTotal     = (summary && summary.profitTotal)     || Math.round(grandTotal - costTotal);
      const totalLaborHours = (summary && summary.totalLaborHours) || cl.categories.reduce((s, c) => s + (c.laborHours || 0), 0);
      const legalWelfare    = (summary && summary.legalWelfare)    || 0;

      const itemCount = cl.categories.reduce((s, c) => s + c.items.length, 0);
      if (itemCount === 0) { done++; continue; }

      records.push({
        folderName: g.folderName,
        registeredAt: new Date().toISOString().split('T')[0],
        source: 'honmaru',
        project: {
          number, managementNumber, name: projectName,
          date, updatedAt, client, person,
          struct: '', type, usage,
          floors: '', areaTsubo: '', areaSqm: '',
          location, workStart, workEnd,
          paymentTerms, validUntil, memo,
          usePattern, laborRates,
        },
        workTotal:      Math.round(workTotal),
        miscExpenseAmt: Math.round(miscExpenseAmt),
        miscExpenseCost: Math.round(miscExpenseCost),
        miscExpensePct,
        discountAmt:    Math.round(discountAmt),
        discountPct,
        grandTotal:     Math.round(grandTotal),
        costTotal:      Math.round(costTotal),
        profitRate,
        profitTotal,
        totalLaborHours,
        legalWelfare:   Math.round(legalWelfare),
        categories: cl.categories,
        kikiList: kiki.list,
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
  document.getElementById('hmPreviewArea')._records = records;

  const tbody = document.getElementById('hmPreviewBody');
  tbody.innerHTML = records.map((r, i) => {
    const p = r.project;
    const itemCount = r.categories.reduce((s, c) => s + c.items.length, 0);
    const tsuboFactor = 3.30579;
    return `<tr>
      <td style="font-size:11px;">${esc(p.name || r.folderName)}</td>
      <td style="font-size:11px;">${esc(p.type||'—')}</td>
      <td style="font-size:11px;">${esc(p.usage||'—')}</td>
      <td style="font-size:11px;">
        <input type="text" value="${esc(p.struct)}" placeholder="RC造"
          oninput="document.getElementById('hmPreviewArea')._records[${i}].project.struct=this.value"
          style="width:55px;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;">
      </td>
      <td style="font-size:11px;">
        <input type="number" id="hmTsubo${i}" value="${p.areaTsubo}" placeholder="坪"
          oninput="(function(v){const r=document.getElementById('hmPreviewArea')._records[${i}];r.project.areaTsubo=v;const sqm=v?(+v*${tsuboFactor}).toFixed(1):'';r.project.areaSqm=sqm;document.getElementById('hmSqm${i}').value=sqm;})(this.value)"
          style="width:50px;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;">
        <input type="number" id="hmSqm${i}" value="${p.areaSqm}" placeholder="㎡"
          oninput="(function(v){const r=document.getElementById('hmPreviewArea')._records[${i}];r.project.areaSqm=v;const tsubo=v?(+v/${tsuboFactor}).toFixed(1):'';r.project.areaTsubo=tsubo;document.getElementById('hmTsubo${i}').value=tsubo;})(this.value)"
          style="width:50px;font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;">
      </td>
      <td class="td-right" style="font-size:11px;">¥${formatNum(r.grandTotal)}</td>
      <td class="td-right" style="font-size:11px;">${r.profitRate}%</td>
      <td class="td-right" style="font-size:11px;">${itemCount}品目 / 機器${r.kikiList.length}件</td>
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
      const { folderName, ...data } = rec;
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
