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

  // --- DB操作共通ラッパー ---
  async function _withStore(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      tx.oncomplete = () => db.close();
      tx.onerror   = () => { db.close(); reject(tx.error); };
      fn(store, resolve, reject);
    });
  }

  // --- 保存 ---
  function save(record) {
    return _withStore('readwrite', (store, resolve, reject) => {
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // --- 全件取得 ---
  function getAll() {
    return _withStore('readonly', (store, resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });
  }

  // --- 1件取得 ---
  function getById(id) {
    return _withStore('readonly', (store, resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
    });
  }

  // --- 削除 ---
  function remove(id) {
    return _withStore('readwrite', (store, resolve) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
    });
  }

  // --- 全件削除 ---
  function clearAll() {
    return _withStore('readwrite', (store, resolve) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
    });
  }

  // --- 全件削除してからインポート（置き換え） ---
  async function replaceFromFile(file) {
    await clearAll();
    return importFile(file);
  }

  // --- 除外フラグ更新 ---
  function setExcluded(id, bool) {
    return _withStore('readwrite', (store, resolve) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result;
        rec.excluded = bool;
        store.put(rec);
        resolve();
      };
    });
  }

  // --- 件数取得 ---
  function count() {
    return _withStore('readonly', (store, resolve) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
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
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  }

  // --- XLSXデータ構築ヘルパー（export / autoBackup 共有）---
  // 6シート: 物件マスタ / 工種サマリ / 明細データ / 機器明細 / 労務単価 / 分析
  function buildXLSX(all) {
    const wb = XLSX.utils.book_new();

    // ===== Sheet1: 物件マスタ（全フィールド対応） =====
    const rows1 = [[
      '物件ID','登録日','データソース','物件名','見積番号','管理番号',
      '得意先','担当者','構造','用途','新築/改修','延床面積㎡','延床面積坪','階数','施工場所',
      '工期_着工日','工期_竣工日','支払条件','有効期限','見積メモ','使用パターン',
      '見積日付','更新日',
      '見積合計','原価合計','利益率%','粗利額','工事費合計','諸経費','諸経費率%','値引金額','値引率%',
      '総工数','法定福利費','㎡単価','坪単価','有効',
    ]];
    all.forEach(r => {
      const p = r.project || {};
      const sqm   = parseFloat(p.areaSqm)   || 0;
      const tsubo = parseFloat(p.areaTsubo) || 0;
      const gt    = r.grandTotal || 0;
      rows1.push([
        r.id, r.registeredAt || '', r.source || '',
        p.name || '', p.number || '', p.managementNumber || '',
        p.client || '', p.person || '', p.struct || '', p.usage || '', p.type || '',
        sqm || '', tsubo || '', p.floors || '', p.location || '',
        p.workStart || '', p.workEnd || '', p.paymentTerms || '', p.validUntil || '',
        p.memo || '', p.usePattern || '',
        p.date || '', p.updatedAt || '',
        gt, r.costTotal || 0, r.profitRate || 0, r.profitTotal || 0,
        r.workTotal || 0, r.miscExpenseAmt || 0, r.miscExpensePct || 0,
        r.discountAmt || 0, r.discountPct || 0,
        r.totalLaborHours || 0, r.legalWelfare || 0,
        sqm   ? Math.round(gt / sqm)   : '',
        tsubo ? Math.round(gt / tsubo) : '',
        r.excluded ? '×' : '○',
      ]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(rows1);
    ws1['!cols'] = [
      {wch:6},{wch:10},{wch:10},{wch:28},{wch:10},{wch:10},
      {wch:18},{wch:10},{wch:6},{wch:10},{wch:8},{wch:8},{wch:8},{wch:4},{wch:20},
      {wch:10},{wch:10},{wch:12},{wch:10},{wch:20},{wch:12},
      {wch:10},{wch:10},
      {wch:12},{wch:12},{wch:8},{wch:12},{wch:12},{wch:10},{wch:8},{wch:10},{wch:8},
      {wch:6},{wch:10},{wch:10},{wch:10},{wch:4},
    ];
    XLSX.utils.book_append_sheet(wb, ws1, '物件マスタ');

    // ===== Sheet2: 工種サマリ（粗利額・数量・単位を追加） =====
    const rows2 = [[
      '物件ID','物件名','工種名',
      '見積金額','原価金額','利益率%','粗利額','工数','数量','単位',
      '見積構成比%','原価構成比%',
    ]];
    all.forEach(r => {
      const cats      = r.categories || [];
      const totalSell = cats.reduce((s, c) => s + (c.total || 0), 0) || r.grandTotal || 0;
      const totalCost = cats.reduce((s, c) => s + (c.costTotal || 0), 0) || r.costTotal || 0;
      cats.forEach(c => {
        const ct = c.total || 0;
        const cc = c.costTotal || 0;
        rows2.push([
          r.id, (r.project || {}).name || '', c.name,
          ct, cc,
          c.profitRate || (ct ? Math.round((ct - cc) / ct * 1000) / 10 : 0),
          c.profitAmt  || Math.round(ct - cc),
          c.laborHours || '', c.qty || '', c.unit || '',
          totalSell ? Math.round(ct / totalSell * 1000) / 10 : '',
          totalCost ? Math.round(cc / totalCost * 1000) / 10 : '',
        ]);
      });
    });
    const ws2 = XLSX.utils.aoa_to_sheet(rows2);
    ws2['!cols'] = [
      {wch:6},{wch:28},{wch:20},
      {wch:12},{wch:12},{wch:8},{wch:12},{wch:6},{wch:6},{wch:4},
      {wch:10},{wch:10},
    ];
    XLSX.utils.book_append_sheet(wb, ws2, '工種サマリ');

    // ===== Sheet3: 明細データ（集計コード・原価数量・利益率・備考を追加） =====
    const rows3 = [[
      '物件ID','工種名','集計コード','品名','規格','単位',
      '見積数量','見積単価','見積金額',
      '原価数量','原価単価','原価金額','利益率%',
      '歩掛','工数','備考',
      '定価','見積掛率%','原価掛率%',
    ]];
    all.forEach(r => {
      (r.categories || []).forEach(c => {
        (c.items || []).forEach(i => {
          rows3.push([
            r.id, c.name,
            i.code || '', i.name || '', i.spec || '', i.unit || '',
            i.qty || 0, i.price || 0, i.amount || 0,
            i.costQty || '', i.costPrice || '', i.costAmount || '', i.profitRate || '',
            i.bukariki || '', i.laborHours || '', i.note || '',
            i.listPrice || '', i.sellRate || '', i.costRate || '',
          ]);
        });
      });
    });
    const ws3 = XLSX.utils.aoa_to_sheet(rows3);
    ws3['!cols'] = [
      {wch:6},{wch:20},{wch:8},{wch:30},{wch:20},{wch:6},
      {wch:8},{wch:10},{wch:12},
      {wch:8},{wch:10},{wch:12},{wch:8},
      {wch:6},{wch:6},{wch:20},
      {wch:10},{wch:8},{wch:8},
    ];
    XLSX.utils.book_append_sheet(wb, ws3, '明細データ');

    // ===== Sheet4: 機器明細（新規） =====
    const rows4 = [[
      '物件ID','品名','規格','単位','数量','基準単価','定価',
      '見積掛率%','見積単価','見積金額',
      '原価掛率%','原価単価','原価金額','目標原価',
    ]];
    all.forEach(r => {
      (r.kikiList || []).forEach(k => {
        rows4.push([
          r.id, k.name || '', k.spec || '', k.unit || '',
          k.qty || 0, k.basePrice || 0, k.listPrice || 0,
          k.sellRate || 0, k.sellPrice || 0, k.sellAmount || 0,
          k.costRate || 0, k.costPrice || 0, k.costAmount || 0, k.targetCost || 0,
        ]);
      });
    });
    const ws4 = XLSX.utils.aoa_to_sheet(rows4);
    ws4['!cols'] = [
      {wch:6},{wch:30},{wch:20},{wch:6},{wch:6},{wch:10},{wch:10},
      {wch:8},{wch:10},{wch:12},
      {wch:8},{wch:10},{wch:12},{wch:10},
    ];
    XLSX.utils.book_append_sheet(wb, ws4, '機器明細');

    // ===== Sheet5: 労務単価（新規） =====
    const rows5 = [['物件ID','職種名','見積単価','原価単価']];
    all.forEach(r => {
      const lr = (r.project || {}).laborRates || {};
      Object.entries(lr).forEach(([type, rates]) => {
        rows5.push([r.id, type, rates.sell || 0, rates.cost || 0]);
      });
    });
    const ws5 = XLSX.utils.aoa_to_sheet(rows5);
    ws5['!cols'] = [{wch:6},{wch:10},{wch:10},{wch:10}];
    XLSX.utils.book_append_sheet(wb, ws5, '労務単価');

    // ===== Sheet6: 分析（読み取り専用サマリー） =====
    const rows6 = [[
      '物件名','構造','用途','新築/改修',
      '見積合計','原価合計','利益率%',
      '延床㎡','延床坪','㎡単価','坪単価',
    ]];
    all.forEach(r => {
      const p    = r.project || {};
      const sqm  = parseFloat(p.areaSqm)   || 0;
      const tsubo= parseFloat(p.areaTsubo) || 0;
      const gt   = r.grandTotal || 0;
      rows6.push([
        p.name || '', p.struct || '', p.usage || '', p.type || '',
        gt, r.costTotal || '', r.profitRate || '',
        sqm || '', tsubo || '',
        sqm   ? Math.round(gt / sqm)   : '',
        tsubo ? Math.round(gt / tsubo) : '',
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows6), '分析');

    return wb;
  }

  // --- Excelエクスポート（2シート: プロジェクト一覧 + 明細） ---
  async function exportXLSX() {
    const all = await getAll();
    downloadXLSX(buildXLSX(all), '実績データベース_' + new Date().toISOString().split('T')[0] + '.xlsx');
  }

  // --- 自動バックアップ（Excel出力時に呼ばれる）→ 固定名 knowledge_db.xlsx ---
  // OneDriveフォルダに保存すればそのままクラウドバックアップ＆複数PC共有が可能
  async function autoBackup() {
    const all = await getAll();
    if (all.length === 0) return;
    downloadXLSX(buildXLSX(all), 'knowledge_db.xlsx');
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

  // --- XLSXインポート（6シート新形式 / 5シート旧形式 / 2シート旧旧形式 自動判別） ---
  async function importXLSX(file) {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });

    // フォーマット検出
    const isKatsuyo = !!wb.Sheets['物件ヘッダー']; // 集約ファイル形式（見積番号キー）
    const hasKiki   = !!wb.Sheets['機器明細'];
    const isNewFmt  = !!wb.Sheets['物件マスタ'];    // knowledge_db.xlsx形式
    const projSheet   = isKatsuyo ? '物件ヘッダー' : isNewFmt ? '物件マスタ' : 'プロジェクト一覧';
    const detailSheet = isKatsuyo ? '明細行'        : isNewFmt ? '明細データ' : '明細';
    const koshuSheet  = isKatsuyo ? '工種サマリー'  : '工種サマリ';
    // 集約形式は見積番号をキーとして使う
    const pidKey      = isKatsuyo ? '見積番号'      : isNewFmt ? '物件ID' : 'id';

    const ws1 = wb.Sheets[projSheet];
    if (!ws1) throw new Error('「' + projSheet + '」シートが見つかりません');
    const projects = XLSX.utils.sheet_to_json(ws1);

    // ===== 工種サマリ =====
    const koshuMap = {}; // pid → catName → { total, costTotal, profitRate, profitAmt, laborHours, qty, unit }
    if (wb.Sheets[koshuSheet]) {
      XLSX.utils.sheet_to_json(wb.Sheets[koshuSheet]).forEach(row => {
        const pid = row[pidKey];
        if (!pid) return;
        if (!koshuMap[pid]) koshuMap[pid] = {};
        koshuMap[pid][String(row['工種名'] || '')] = {
          total:      parseFloat(row['見積金額'])  || parseFloat(row['見積金額(円)']) || 0,
          costTotal:  parseFloat(row['実行金額'])  || parseFloat(row['原価金額'])     || parseFloat(row['原価金額(円)']) || 0,
          profitRate: parseFloat(row['粗利率'])    || parseFloat(row['利益率%'])      || 0,
          profitAmt:  parseFloat(row['粗利'])      || parseFloat(row['粗利額'])       || 0,
          laborHours: parseFloat(row['工数'])      || 0,
          qty:        parseFloat(row['数量'])      || 0,
          unit:       String(row['単位'] || ''),
        };
      });
    }

    // ===== 機器明細 =====
    const kikiMap = {}; // pid → kiki[]
    if (hasKiki) {
      XLSX.utils.sheet_to_json(wb.Sheets['機器明細']).forEach(row => {
        const pid = row[pidKey];
        if (!pid) return;
        if (!kikiMap[pid]) kikiMap[pid] = [];
        kikiMap[pid].push({
          name:       String(row['品名']    || ''),
          spec:       String(row['規格']    || ''),
          unit:       String(row['単位']    || ''),
          qty:        parseFloat(row['数量'])      || 0,
          basePrice:  parseFloat(row['基準単価'])  || 0,
          listPrice:  parseFloat(row['定価'])      || 0,
          sellRate:   parseFloat(row['見積掛率%']) || parseFloat(row['見積掛率']) || 0,
          sellPrice:  parseFloat(row['見積単価'])  || 0,
          sellAmount: parseFloat(row['見積金額'])  || 0,
          costRate:   parseFloat(row['原価掛率%']) || parseFloat(row['原価掛率']) || 0,
          costPrice:  parseFloat(row['原価単価'])  || 0,
          costAmount: parseFloat(row['原価金額'])  || 0,
          targetCost: parseFloat(row['目標原価'])  || 0,
        });
      });
    }

    // ===== 労務単価 =====
    const laborMap = {}; // pid → { 職種名: { sell, cost } }
    if (wb.Sheets['労務単価']) {
      XLSX.utils.sheet_to_json(wb.Sheets['労務単価']).forEach(row => {
        const pid  = row['物件ID'];
        const type = String(row['職種名'] || '');
        if (!pid || !type) return;
        if (!laborMap[pid]) laborMap[pid] = {};
        laborMap[pid][type] = {
          sell: parseFloat(row['見積単価']) || 0,
          cost: parseFloat(row['原価単価']) || 0,
        };
      });
    }

    // ===== 明細データ =====
    const ws3 = wb.Sheets[detailSheet];
    const detailMap = {}; // pid → catName → { items[] }
    if (ws3) {
      XLSX.utils.sheet_to_json(ws3).forEach(row => {
        const pid     = row[pidKey] || (isNewFmt ? row['物件ID'] : row['project_id']);
        if (!pid) return;
        if (!detailMap[pid]) detailMap[pid] = {};
        const catName = String(row['工種名'] || '');
        if (!detailMap[pid][catName]) detailMap[pid][catName] = { items: [] };
        const sellAmt = parseFloat(row['見積金額']) || 0;
        const costAmt = parseFloat(row['原価金額']) || 0;
        detailMap[pid][catName].items.push({
          code:       String(row['集計コード'] || ''),
          name:       String(row['品名'] || row['品目名'] || ''),
          spec:       String(row['規格']       || ''),
          qty:        parseFloat(row['見積数量'] || row['数量']) || 0,
          unit:       String(row['単位']       || ''),
          price:      parseFloat(row['見積単価'])  || parseFloat(row['単価']) || 0,
          amount:     sellAmt,
          costQty:    parseFloat(row['原価数量'])   || 0,
          costPrice:  parseFloat(row['原価単価'])   || 0,
          costAmount: costAmt,
          profitRate: parseFloat(row['利益率%'])    || parseFloat(row['利益率']) || 0,
          bukariki:   parseFloat(row['歩掛'])       || 0,
          laborHours: parseFloat(row['工数'])       || 0,
          note:       String(row['備考']        || ''),
          listPrice:  parseFloat(row['定価'])       || 0,
          sellRate:   parseFloat(row['見積掛率%'])  || parseFloat(row['見積掛率']) || 0,
          costRate:   parseFloat(row['原価掛率%'])  || parseFloat(row['原価掛率']) || 0,
        });
      });
    }

    const db    = await open();
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let cnt = 0;
    for (const row of projects) {
      const pid    = row[pidKey];
      if (!pid) continue;
      const ksData = koshuMap[pid]  || {};
      const dMap   = detailMap[pid] || {};

      // 工種一覧: 工種サマリ優先、明細データで補完
      const catNames = new Set([...Object.keys(ksData), ...Object.keys(dMap)]);
      const categories = [...catNames].map(name => {
        const ks   = ksData[name] || {};
        const data = dMap[name]   || { items: [] };
        return {
          name,
          total:      ks.total      || 0,
          costTotal:  ks.costTotal  || 0,
          profitRate: ks.profitRate || 0,
          profitAmt:  ks.profitAmt  || 0,
          laborHours: ks.laborHours || 0,
          qty:        ks.qty        || 0,
          unit:       ks.unit       || '',
          items:      data.items,
        };
      });

      const record = {
        registeredAt: String(row['登録日'] || row['更新日'] || row['見積日付'] || ''),
        source:       String(row['データソース'] || (isKatsuyo ? 'katsuyo' : '')),
        excluded:     row['有効'] === '×',
        project: {
          number:          String(row['見積番号']    || ''),
          managementNumber:String(row['管理番号']    || ''),
          name:            String(row['物件名'] || row['工事名'] || ''),
          date:            String(row['見積日付']    || ''),
          updatedAt:       String(row['更新日']      || ''),
          client:          String(row['得意先']      || ''),
          person:          String(row['担当者名'] || row['担当者'] || ''),
          struct:          String(row['構造']        || ''),
          type:            String(row['新築/改修'] || row['種別'] || ''),
          usage:           String(row['用途']        || ''),
          areaTsubo:       String(row['延床面積坪'] || row['坪数'] || ''),
          areaSqm:         String(row['延床面積㎡'] || row['㎡数'] || ''),
          floors:          String(row['階数']        || ''),
          location:        String(row['施工場所']    || ''),
          workStart:       String(row['工期_着工日'] || ''),
          workEnd:         String(row['工期_竣工日'] || ''),
          paymentTerms:    String(row['支払条件']    || ''),
          validUntil:      String(row['有効期限']    || ''),
          memo:            String(row['見積メモ']    || ''),
          usePattern:      String(row['使用パターン'] || ''),
          laborRates:      laborMap[pid] || {},
        },
        grandTotal:     parseFloat(row['見積合計'])    || parseFloat(row['見積合計(円)']) || 0,
        costTotal:      parseFloat(row['原価合計'])    || parseFloat(row['実行合計'])     || parseFloat(row['原価合計(円)']) || 0,
        profitRate:     parseFloat(row['利益率%'])     || parseFloat(row['粗利率'])       || parseFloat(row['利益率(%)'])    || 0,
        profitTotal:    parseFloat(row['粗利額'])      || parseFloat(row['粗利合計'])     || 0,
        workTotal:      parseFloat(row['工事費合計'])  || 0,
        miscExpenseAmt: parseFloat(row['諸経費'])      || parseFloat(row['諸経費金額'])   || 0,
        miscExpensePct: parseFloat(row['諸経費率%'])   || 0,
        discountAmt:    parseFloat(row['値引き'])      || parseFloat(row['値引金額'])    || parseFloat(row['値引き金額'])   || 0,
        discountPct:    parseFloat(row['値引率%'])     || parseFloat(row['値引き率%'])    || 0,
        totalLaborHours:parseFloat(row['工数合計'])    || parseFloat(row['総工数'])       || 0,
        legalWelfare:   parseFloat(row['法定福利費'])  || 0,
        categories,
        kikiList: kikiMap[pid] || [],
      };
      store.add(record);
      cnt++;
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(cnt); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
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
            const key = normItemKey(item.name, item.spec);
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
    clearAll,
    replaceFromFile,
    getClientItemHistory,
  };
})();
