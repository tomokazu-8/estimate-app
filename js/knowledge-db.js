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

  // --- 類似物件検索 ---
  // filters: { struct, type, usage, areaTsubo }
  // 戻り値: スコア付きの配列（降順ソート）
  async function searchSimilar(filters) {
    const all = await getAll();
    const { struct, type, usage, areaTsubo } = filters;

    return all.map(rec => {
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

  // --- JSONエクスポート ---
  async function exportJSON() {
    const all = await getAll();
    const json = JSON.stringify(all, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'knowledge_db_' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- JSONインポート ---
  async function importJSON(file) {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) throw new Error('不正なファイル形式です');

    const db = await open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let imported = 0;
    for (const rec of records) {
      // idを除去して新規レコードとして追加（重複回避）
      const { id, ...data } = rec;
      store.add(data);
      imported++;
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(imported); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // --- 自動バックアップ（Excel出力時に呼ばれる） ---
  async function autoBackup() {
    const all = await getAll();
    if (all.length === 0) return; // 空なら不要

    const json = JSON.stringify(all, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'knowledge_backup_' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);

    // 最終バックアップ日時を記録
    localStorage.setItem('knowledge_last_backup', new Date().toISOString());
  }

  // --- バックアップからの復元（ファイルを受け取る） ---
  async function restoreFromBackup(file) {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) throw new Error('不正なファイル形式です');

    const db = await open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let restored = 0;
    for (const rec of records) {
      const { id, ...data } = rec;
      store.add(data);
      restored++;
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(restored); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // --- PERF_DB → ナレッジDB移行 ---
  async function migratePerfDB(perfDB) {
    const migrated = localStorage.getItem('perf_db_migrated');
    if (migrated) return 0;

    let count = 0;
    for (const p of perfDB) {
      const record = {
        registeredAt: '2025-01-01', // レガシーデータとして固定日付
        project: {
          name: p.name || '',
          number: p.id || '',
          date: '',
          client: '',
          struct: p.struct || '',
          usage: p.usage || '',
          type: p.type || '',
          floors: '',
          areaSqm: p.area_tsubo ? String(Math.round(p.area_tsubo * 3.306)) : '',
          areaTsubo: p.area_tsubo ? String(p.area_tsubo) : '',
          location: '',
          person: '',
        },
        categories: [], // レガシーデータは品目明細なし
        grandTotal: Math.round(p.total || 0),
        profitRate: p.profit || 0,
        legacy: true, // レガシーフラグ
      };
      await save(record);
      count++;
    }

    localStorage.setItem('perf_db_migrated', '1');
    return count;
  }

  return {
    save,
    getAll,
    getById,
    remove,
    count,
    searchSimilar,
    buildRecord,
    exportJSON,
    importJSON,
    migratePerfDB,
    autoBackup,
    restoreFromBackup,
  };
})();
