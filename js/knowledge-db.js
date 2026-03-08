// ===== ナレッジDB（IndexedDB ベース） =====
// 見積実績をブラウザ内に蓄積し、見積自動作成に活用する

const knowledgeDB = (() => {
  const DB_NAME = 'estimate-knowledge';
  const DB_VERSION = 1;
  const STORE_NAME = 'projects';

  // --- DB接続 ---
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('struct', 'project.struct', { unique: false });
          store.createIndex('type', 'project.type', { unique: false });
          store.createIndex('usage', 'project.usage', { unique: false });
          store.createIndex('registeredAt', 'registeredAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // --- 保存 ---
  async function save(record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  // --- 全件取得 ---
  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  // --- 1件取得 ---
  async function getById(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  // --- 削除 ---
  async function remove(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  // --- 除外フラグ更新 ---
  async function setExcluded(id, bool) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result;
        rec.excluded = bool;
        store.put(rec);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // --- 件数取得 ---
  async function count() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  // --- 類似物件検索（除外レコードを除く） ---
  // filters: { struct, type, usage, areaTsubo }
  // 戻り値: スコア付きの配列（降順ソート）
  async function searchSimilar(filters) {
    const all = await getAll();
    const { struct, type, usage, areaTsubo } = filters;

    return all
      .filter(rec => !rec.excluded)
      .map(rec => {
        let score = 0;
        const p = rec.project;
        if (struct && p.struct === struct) score += 3;
        if (type && p.type === type) score += 2;
        if (usage && p.usage === usage) score += 3;
        if (areaTsubo > 0 && p.areaTsubo) {
          const diff = Math.abs(parseFloat(p.areaTsubo) - areaTsubo) / areaTsubo;
          if (diff < 0.2) score += 2;
          else if (diff < 0.5) score += 1;
        }
        return { ...rec, _score: score };
      })
      .filter(r => r._score >= 3)
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        // 同スコアなら面積が近い方を優先
        if (areaTsubo > 0) {
          const da = Math.abs((parseFloat(a.project.areaTsubo) || 0) - areaTsubo);
          const db = Math.abs((parseFloat(b.project.areaTsubo) || 0) - areaTsubo);
          return da - db;
        }
        return 0;
      });
  }

  // --- 現在の見積データからナレッジレコードを構築 ---
  // project, items, activeCategories はグローバル変数を参照
  function buildRecord() {
    let workTotal = 0, miscExpenseAmt = 0, discountAmt = 0;

    const cats = activeCategories.filter(c => c.active).map(c => {
      const amount = Math.round(getCatAmount(c.id));
      const catItems = (items[c.id] || []).filter(i => i.name).map(i => {
        const listP  = parseFloat(i.listPrice) || 0;
        const priceP = parseFloat(i.price)     || 0;
        const crPct  = parseFloat(i.costRate)  || 0;
        const srPct  = parseFloat(i.sellRate)  || 0;
        const qtyP   = parseFloat(i.qty)       || 0;
        const amtP   = parseFloat(i.amount)    || 0;
        const costP  = listP > 0 && crPct > 0 ? Math.round(listP * crPct / 100) : 0;
        const costA  = costP > 0 ? Math.round(costP * qtyP) : 0;
        const buk    = parseFloat(i.bukariki1) || parseFloat(i.bukariki2) || parseFloat(i.bukariki3) || 0;
        return {
          name: i.name, spec: i.spec || '',
          qty: qtyP, unit: i.unit || '',
          listPrice: listP, price: priceP, sellRate: srPct,
          costPrice: costP, costRate: crPct,
          amount: amtP, costAmount: costA,
          bukariki: buk, laborHours: 0,
          note: i.note || '',
        };
      });

      const catCostTotal = catItems.reduce((s, i) => s + i.costAmount, 0);
      if (c.id === 'discount') {
        discountAmt = Math.abs(amount);
      } else if (c.rateMode) {
        miscExpenseAmt += amount;
      } else {
        workTotal += amount;
      }

      return {
        id: c.id, name: c.name, short: c.short || c.name,
        rateMode: !!c.rateMode, items: catItems,
        subtotal: amount, costTotal: Math.round(catCostTotal), laborHours: 0,
      };
    });

    const grandTotal = workTotal + miscExpenseAmt - discountAmt;
    const costTotalAll = cats.reduce((s, c) => s + (c.costTotal || 0), 0);
    const profitRate = costTotalAll > 0 && grandTotal > 0
      ? Math.round((grandTotal - costTotalAll) / grandTotal * 1000) / 10
      : Math.round((1 - (project.laborRate || 72) / 100) * 1000) / 10;

    return {
      registeredAt: new Date().toISOString().split('T')[0],
      source: 'app',
      project: {
        number: project.number || '', name: project.name || '',
        date: project.date || '', client: project.client || '',
        person: project.person || '', struct: project.struct || '',
        usage: project.usage || '', type: project.type || '',
        floors: project.floors || '', areaSqm: project.areaSqm || '',
        areaTsubo: project.areaTsubo || '', location: project.location || '',
      },
      workTotal:      Math.round(workTotal),
      miscExpenseAmt: Math.round(miscExpenseAmt),
      miscExpensePct: workTotal > 0 ? Math.round(miscExpenseAmt / workTotal * 1000) / 10 : 0,
      discountAmt:    Math.round(discountAmt),
      discountPct:    (workTotal + miscExpenseAmt) > 0
                        ? Math.round(discountAmt / (workTotal + miscExpenseAmt) * 1000) / 10 : 0,
      grandTotal:     Math.round(grandTotal),
      costTotal:      Math.round(costTotalAll),
      profitRate,
      categories: cats,
    };
  }

  // --- XLSXダウンロードヘルパー ---
  function downloadXLSX(wb, filename) {
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // --- XLSXデータ構築ヘルパー（export / autoBackup 共有）---
  // 実績DB形式 5シート: 物件マスタ / 工種サマリ / 明細データ / 自動計算パラメータ / 分析
  function buildXLSX(all) {
    const wb = XLSX.utils.book_new();

    // Sheet1: 物件マスタ
    const rows1 = [[
      '物件ID','物件名','見積番号','構造','用途','階数','新築/改修',
      '得意先','担当者',
      '延床面積㎡','延床面積坪',
      '見積合計(円)','原価合計(円)','利益率(%)',
      '㎡単価(円)','坪単価(円)',
      '諸経費金額','諸経費率%','値引き金額','値引き率%',
      'データソース','有効',
    ]];
    all.forEach(r => {
      const p = r.project || {};
      const sqm = parseFloat(p.areaSqm) || 0;
      const tsubo = parseFloat(p.areaTsubo) || 0;
      const gt = r.grandTotal || 0;
      rows1.push([
        r.id, p.name || '', p.number || '', p.struct || '', p.usage || '',
        p.floors || '', p.type || '',
        p.client || '', p.person || '',
        sqm || '', tsubo || '',
        gt, r.costTotal || '', r.profitRate || '',
        sqm ? Math.round(gt / sqm) : '', tsubo ? Math.round(gt / tsubo) : '',
        r.miscExpenseAmt || '', r.miscExpensePct || '',
        r.discountAmt || '', r.discountPct || '',
        r.source || '', r.excluded ? '×' : '○',
      ]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(rows1);
    ws1['!cols'] = [
      {wch:6},{wch:28},{wch:10},{wch:6},{wch:10},{wch:4},{wch:8},
      {wch:18},{wch:10},
      {wch:8},{wch:8},
      {wch:12},{wch:12},{wch:8},{wch:10},{wch:10},
      {wch:10},{wch:8},{wch:10},{wch:8},
      {wch:10},{wch:4},
    ];
    XLSX.utils.book_append_sheet(wb, ws1, '物件マスタ');

    // Sheet2: 工種サマリ
    const rows2 = [[
      '物件ID','物件名','工種名',
      '見積金額(円)','原価金額(円)','利益率(%)',
      '見積構成比(%)','原価構成比(%)','工数',
    ]];
    all.forEach(r => {
      const cats = r.categories || [];
      const totalSell = cats.reduce((s, c) => s + (c.total || 0), 0) || r.grandTotal || 0;
      const totalCost = cats.reduce((s, c) => s + (c.costTotal || 0), 0) || r.costTotal || 0;
      cats.forEach(c => {
        const ct = c.total || 0;
        const cc = c.costTotal || 0;
        rows2.push([
          r.id, (r.project || {}).name || '', c.name,
          ct, cc,
          ct ? Math.round((ct - cc) / ct * 1000) / 10 : 0,
          totalSell ? Math.round(ct / totalSell * 1000) / 10 : 0,
          totalCost ? Math.round(cc / totalCost * 1000) / 10 : 0,
          c.laborHours || '',
        ]);
      });
    });
    const ws2 = XLSX.utils.aoa_to_sheet(rows2);
    ws2['!cols'] = [{wch:6},{wch:28},{wch:20},{wch:12},{wch:12},{wch:8},{wch:10},{wch:10},{wch:6}];
    XLSX.utils.book_append_sheet(wb, ws2, '工種サマリ');

    // Sheet3: 明細データ
    const rows3 = [[
      '物件ID','工種名','品名','規格','単位',
      '見積数量','見積単価','見積金額',
      '原価単価','原価金額',
      '歩掛','工数',
      '定価','見積掛率%','原価掛率%',
    ]];
    all.forEach(r => {
      (r.categories || []).forEach(c => {
        (c.items || []).forEach(i => {
          rows3.push([
            r.id, c.name,
            i.name, i.spec || '', i.unit,
            i.qty, i.price, i.amount,
            i.costPrice || '', i.costAmount || '',
            i.bukariki || '', i.laborHours || '',
            i.listPrice || '', i.sellRate || '', i.costRate || '',
          ]);
        });
      });
    });
    const ws3 = XLSX.utils.aoa_to_sheet(rows3);
    ws3['!cols'] = [
      {wch:6},{wch:20},{wch:30},{wch:20},{wch:6},
      {wch:8},{wch:10},{wch:12},
      {wch:10},{wch:12},
      {wch:6},{wch:6},
      {wch:10},{wch:8},{wch:8},
    ];
    XLSX.utils.book_append_sheet(wb, ws3, '明細データ');

    // Sheet4: 自動計算パラメータ（ヘッダーのみ）
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['物件ID','工種名','項目名','計算ルール','備考'],
    ]), '自動計算パラメータ');

    // Sheet5: 分析
    const rows5 = [[
      '物件名','構造','用途','新築/改修',
      '見積合計','原価合計','利益率(%)',
      '延床㎡','延床坪','㎡単価','坪単価',
    ]];
    all.forEach(r => {
      const p = r.project || {};
      const sqm = parseFloat(p.areaSqm) || 0;
      const tsubo = parseFloat(p.areaTsubo) || 0;
      const gt = r.grandTotal || 0;
      rows5.push([
        p.name || '', p.struct || '', p.usage || '', p.type || '',
        gt, r.costTotal || '', r.profitRate || '',
        sqm || '', tsubo || '',
        sqm ? Math.round(gt / sqm) : '', tsubo ? Math.round(gt / tsubo) : '',
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows5), '分析');

    return wb;
  }

  // --- Excelエクスポート（2シート: プロジェクト一覧 + 明細） ---
  async function exportXLSX() {
    const all = await getAll();
    downloadXLSX(buildXLSX(all), '実績データベース_' + new Date().toISOString().split('T')[0] + '.xlsx');
  }

  // --- 自動バックアップ（Excel出力時に呼ばれる）→ XLSX形式 ---
  async function autoBackup() {
    const all = await getAll();
    if (all.length === 0) return;
    downloadXLSX(buildXLSX(all), '実績データベース_backup_' + new Date().toISOString().split('T')[0] + '.xlsx');
    localStorage.setItem('knowledge_last_backup', new Date().toISOString());
  }

  // --- JSONインポート（後方互換） ---
  async function importJSON(file) {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) throw new Error('不正なファイル形式です');

    const db = await open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let cnt = 0;
    for (const rec of records) {
      const { id, ...data } = rec;
      store.add(data);
      cnt++;
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(cnt); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // --- XLSXインポート（実績DB形式5シート or 旧2シート 自動判別） ---
  async function importXLSX(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    // フォーマット検出: 物件マスタシートがあれば新形式（5シート）
    const isNewFmt = !!wb.Sheets['物件マスタ'];
    const projSheet = isNewFmt ? '物件マスタ' : 'プロジェクト一覧';
    const detailSheet = isNewFmt ? '明細データ' : '明細';

    const ws1 = wb.Sheets[projSheet];
    if (!ws1) throw new Error('「' + projSheet + '」シートが見つかりません');
    const projects = XLSX.utils.sheet_to_json(ws1);

    const ws2 = wb.Sheets[detailSheet];
    const details = ws2 ? XLSX.utils.sheet_to_json(ws2) : [];

    // 工種サマリシートがあれば工数情報を取得
    const koshuMap = {}; // pid → catName → { laborHours }
    if (wb.Sheets['工種サマリ']) {
      const ksRows = XLSX.utils.sheet_to_json(wb.Sheets['工種サマリ']);
      ksRows.forEach(row => {
        const pid = row['物件ID'];
        if (!pid) return;
        if (!koshuMap[pid]) koshuMap[pid] = {};
        koshuMap[pid][String(row['工種名'] || '')] = {
          total: parseFloat(row['見積金額(円)']) || 0,
          costTotal: parseFloat(row['原価金額(円)']) || 0,
          laborHours: parseFloat(row['工数']) || 0,
        };
      });
    }

    // project_id → 工種名 → { catInfo, items[] }
    const detailMap = {};
    details.forEach(row => {
      const pid = isNewFmt ? row['物件ID'] : row['project_id'];
      if (!detailMap[pid]) detailMap[pid] = {};
      const catName = String(row['工種名'] || '');
      if (!detailMap[pid][catName]) {
        detailMap[pid][catName] = {
          total:      0,
          costTotal:  0,
          laborHours: 0,
          items: [],
        };
      }
      const sellAmt = parseFloat(isNewFmt ? row['見積金額'] : (row['見積金額'] || row['金額'])) || 0;
      const costAmt = parseFloat(row['原価金額']) || 0;
      detailMap[pid][catName].total += sellAmt;
      detailMap[pid][catName].costTotal += costAmt;
      detailMap[pid][catName].items.push({
        name:       String(isNewFmt ? (row['品名'] || '') : (row['品目名'] || '')),
        spec:       String(row['規格']     || ''),
        qty:        parseFloat(isNewFmt ? row['見積数量'] : row['数量']) || 0,
        unit:       String(row['単位']     || ''),
        listPrice:  parseFloat(row['定価'])      || 0,
        price:      parseFloat(row['見積単価'])  || parseFloat(row['単価']) || 0,
        sellRate:   parseFloat(row['見積掛率%']) || 0,
        costPrice:  parseFloat(row['原価単価'])  || 0,
        costRate:   parseFloat(row['原価掛率%']) || 0,
        amount:     sellAmt,
        costAmount: costAmt,
        bukariki:   parseFloat(row['歩掛'])      || 0,
        laborHours: parseFloat(row['工数'])      || 0,
      });
    });

    const db = await open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let cnt = 0;
    for (const row of projects) {
      const pid = isNewFmt ? row['物件ID'] : row['id'];
      const catMap = detailMap[pid] || {};
      // 工種サマリの工数情報で補完
      const ksData = koshuMap[pid] || {};
      const categories = Object.entries(catMap).map(([name, data]) => {
        const ks = ksData[name] || {};
        return {
          name,
          total:      ks.total || data.total,
          costTotal:  ks.costTotal || data.costTotal,
          laborHours: ks.laborHours || data.laborHours,
          items:      data.items,
        };
      });

      const record = {
        registeredAt: String(row['登録日'] || ''),
        source:       String(row['データソース'] || ''),
        project: isNewFmt ? {
          number:    String(row['見積番号'] || ''),
          name:      String(row['物件名']   || ''),
          client:    String(row['得意先']   || ''),
          person:    String(row['担当者']   || ''),
          struct:    String(row['構造']     || ''),
          type:      String(row['新築/改修'] || ''),
          usage:     String(row['用途']     || ''),
          areaTsubo: String(row['延床面積坪'] || ''),
          areaSqm:   String(row['延床面積㎡'] || ''),
          floors:    String(row['階数']     || ''),
          date: '', location: '',
        } : {
          number:    String(row['見積番号'] || ''),
          name:      String(row['物件名']   || ''),
          client:    String(row['得意先']   || ''),
          person:    String(row['担当者']   || ''),
          struct:    String(row['構造']     || ''),
          type:      String(row['種別'] || row['新築/改修'] || ''),
          usage:     String(row['用途']     || ''),
          areaTsubo: String(row['坪数'] || row['延床面積坪'] || ''),
          areaSqm:   String(row['㎡数'] || row['延床面積㎡'] || ''),
          date: '', floors: '', location: '',
        },
        workTotal:      parseFloat(row['工事費合計']) || parseFloat(row['見積合計(円)']) || 0,
        miscExpenseAmt: parseFloat(row['諸経費金額'])  || 0,
        miscExpensePct: parseFloat(row['諸経費率%'])   || 0,
        discountAmt:    parseFloat(row['値引き金額'])  || 0,
        discountPct:    parseFloat(row['値引き率%'])   || 0,
        grandTotal:     parseFloat(row['見積合計(円)'] || row['税抜合計'] || row['合計金額']) || 0,
        costTotal:      parseFloat(row['原価合計(円)'] || row['原価合計']) || 0,
        profitRate:     parseFloat(row['利益率(%)'] || row['利益率%'] || row['利益率']) || 0,
        categories,
        excluded: row['有効'] === '×',
      };
      store.add(record);
      cnt++;
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(cnt); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // --- ファイル形式を自動判別してインポート ---
  async function importFile(file) {
    if (file.name.match(/\.xlsx?$/i)) return importXLSX(file);
    return importJSON(file);
  }

  // --- 得意先名の正規化（株式会社等を除去） ---
  function _normClient(s) {
    if (!s) return '';
    return norm(s)
      .replace(/[\(（]?(株式会社|有限会社|合同会社|㈱|㈲)[\)）]?/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  // --- 品目キーの正規化（品名+規格、規格は<以降除去） ---
  function _normItemKey(name, spec) {
    const n = norm(name || '').trim();
    const s = norm(spec || '').replace(/<.*/, '').trim();
    return s ? `${n}|${s}` : n;
  }

  // --- 得意先別品目単価履歴取得 ---
  // 戻り値: { normKey → [{price, projectName, date}] }
  async function getClientItemHistory(clientName) {
    const normC = _normClient(clientName);
    const all = await getAll();
    const history = {};

    all
      .filter(rec => !rec.excluded && _normClient(rec.project.client) === normC)
      .forEach(rec => {
        (rec.categories || []).forEach(cat => {
          (cat.items || []).forEach(item => {
            if (!item.name || !(parseFloat(item.price) > 0)) return;
            const key = _normItemKey(item.name, item.spec);
            if (!history[key]) history[key] = [];
            history[key].push({
              price: parseFloat(item.price),
              sellRate: parseFloat(item.sellRate) || 0,
              projectName: rec.project.name || '',
              date: rec.registeredAt || '',
            });
          });
        });
      });

    return history;
  }

  return {
    save,
    getAll,
    getById,
    remove,
    count,
    setExcluded,
    searchSimilar,
    buildRecord,
    exportXLSX,
    importFile,
    autoBackup,
    restoreFromBackup: importFile,
    getClientItemHistory,
  };
})();
