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
    const cats = activeCategories.filter(c => c.active).map(c => {
      const catItems = (items[c.id] || []).filter(i => i.name).map(i => ({
        name: i.name,
        spec: i.spec || '',
        qty: parseFloat(i.qty) || 0,
        unit: i.unit || '',
        price: parseFloat(i.price) || 0,
        amount: parseFloat(i.amount) || 0,
        bukariki: parseFloat(i.bukariki) || 0,
        note: i.note || '',
      }));
      return {
        id: c.id,
        name: c.name,
        short: c.short || c.name,
        rateMode: !!c.rateMode,
        items: catItems,
        subtotal: Math.round(getCatAmount(c.id)),
      };
    });

    let grandTotal = 0;
    cats.forEach(c => { grandTotal += c.subtotal; });

    const laborRate = (project.laborRate || 72) / 100;
    const profitRate = Math.round((1 - laborRate) * 1000) / 10;

    return {
      registeredAt: new Date().toISOString().split('T')[0],
      project: {
        name: project.name || '',
        number: project.number || '',
        date: project.date || '',
        client: project.client || '',
        struct: project.struct || '',
        usage: project.usage || '',
        type: project.type || '',
        floors: project.floors || '',
        areaSqm: project.areaSqm || '',
        areaTsubo: project.areaTsubo || '',
        location: project.location || '',
        person: project.person || '',
      },
      categories: cats,
      grandTotal: Math.round(grandTotal),
      profitRate: profitRate,
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

  // --- XLSXデータ構築ヘルパー（export / autoBackup 共有） ---
  function buildXLSX(all) {
    const wb = XLSX.utils.book_new();

    // Sheet1: プロジェクト一覧
    const rows1 = [['id','登録日','物件名','構造','種別','用途','坪数','合計金額','利益率','有効']];
    all.forEach(r => rows1.push([
      r.id, r.registeredAt, r.project.name, r.project.struct, r.project.type,
      r.project.usage, r.project.areaTsubo, r.grandTotal, r.profitRate,
      r.excluded ? '×' : '○',
    ]));
    const ws1 = XLSX.utils.aoa_to_sheet(rows1);
    ws1['!cols'] = [
      {wch:6},{wch:12},{wch:24},{wch:8},{wch:6},{wch:12},{wch:6},{wch:12},{wch:6},{wch:6},
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'プロジェクト一覧');

    // Sheet2: 明細
    const rows2 = [['project_id','工種名','品目名','規格','数量','単位','単価','金額']];
    all.forEach(r => {
      (r.categories || []).forEach(c => {
        (c.items || []).forEach(i => {
          rows2.push([r.id, c.name, i.name, i.spec, i.qty, i.unit, i.price, i.amount]);
        });
      });
    });
    const ws2 = XLSX.utils.aoa_to_sheet(rows2);
    ws2['!cols'] = [
      {wch:6},{wch:12},{wch:30},{wch:20},{wch:6},{wch:6},{wch:10},{wch:10},
    ];
    XLSX.utils.book_append_sheet(wb, ws2, '明細');

    return wb;
  }

  // --- Excelエクスポート（2シート: プロジェクト一覧 + 明細） ---
  async function exportXLSX() {
    const all = await getAll();
    downloadXLSX(buildXLSX(all), 'knowledge_db_' + new Date().toISOString().split('T')[0] + '.xlsx');
  }

  // --- 自動バックアップ（Excel出力時に呼ばれる）→ XLSX形式 ---
  async function autoBackup() {
    const all = await getAll();
    if (all.length === 0) return;
    downloadXLSX(buildXLSX(all), 'knowledge_backup_' + new Date().toISOString().split('T')[0] + '.xlsx');
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

  // --- XLSXインポート（プロジェクト一覧 + 明細シートから再構築） ---
  async function importXLSX(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const ws1 = wb.Sheets['プロジェクト一覧'];
    if (!ws1) throw new Error('「プロジェクト一覧」シートが見つかりません');
    const projects = XLSX.utils.sheet_to_json(ws1);

    const ws2 = wb.Sheets['明細'];
    const details = ws2 ? XLSX.utils.sheet_to_json(ws2) : [];

    // project_id → 工種名 → items[] のマップを構築
    const detailMap = {};
    details.forEach(row => {
      const pid = row['project_id'];
      if (!detailMap[pid]) detailMap[pid] = {};
      const catName = String(row['工種名'] || '');
      if (!detailMap[pid][catName]) detailMap[pid][catName] = [];
      detailMap[pid][catName].push({
        name: String(row['品目名'] || ''),
        spec: String(row['規格'] || ''),
        qty: parseFloat(row['数量']) || 0,
        unit: String(row['単位'] || ''),
        price: parseFloat(row['単価']) || 0,
        amount: parseFloat(row['金額']) || 0,
        bukariki: parseFloat(row['歩掛']) || 0,
      });
    });

    const db = await open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let cnt = 0;
    for (const row of projects) {
      const pid = row['id'];
      const catMap = detailMap[pid] || {};
      const categories = Object.entries(catMap).map(([name, itms]) => ({ name, items: itms }));

      const record = {
        registeredAt: String(row['登録日'] || ''),
        project: {
          name: String(row['物件名'] || ''),
          struct: String(row['構造'] || ''),
          type: String(row['種別'] || ''),
          usage: String(row['用途'] || ''),
          areaTsubo: String(row['坪数'] || ''),
          number: '', date: '', client: '', floors: '', areaSqm: '', location: '', person: '',
        },
        categories,
        grandTotal: parseFloat(row['合計金額']) || 0,
        profitRate: parseFloat(row['利益率']) || 0,
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
  };
})();
