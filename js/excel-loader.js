// ===== Excel DB読み込み =====
let externalDbInfo = { materials: 0, bukariki: 0, source: '' };

// ===== 共通UI =====

function showDbOverlay() {
  document.getElementById('dbOverlay').style.display = 'flex';
}

function closeDbOverlay() {
  document.getElementById('dbOverlay').style.display = 'none';
  updateDbStatus();
}

// 2スロットの装着状態をバッジで表示
function updateDbStatus() {
  updateKoshuBadge();
  updateZairyoBadge();
}

function updateKoshuBadge() {
  const badge = document.getElementById('koshuBadge');
  const btn   = document.getElementById('ejectKoshuBtn');
  if (!badge) return;
  if (koshuTridgeLoaded) {
    badge.textContent = '⚙️ 工種Tridge装着';
    badge.style.background = '#dcfce7'; badge.style.color = '#16a34a';
    if (btn) btn.style.display = 'inline-block';
  } else {
    badge.textContent = '⚠ 工種Tridgeなし';
    badge.style.background = '#fef3c7'; badge.style.color = '#92400e';
    if (btn) btn.style.display = 'none';
  }
}

function updateZairyoBadge() {
  const badge = document.getElementById('zairyoBadge');
  const btn   = document.getElementById('ejectZairyoBtn');
  if (!badge) return;
  if (zairyoTridgeLoaded) {
    badge.textContent = '📦 資材Tridge: ' + MATERIAL_DB.length.toLocaleString() + '品目';
    badge.style.background = '#dcfce7'; badge.style.color = '#16a34a';
    if (btn) btn.style.display = 'inline-block';
  } else {
    badge.textContent = '⚠ 資材Tridgeなし';
    badge.style.background = '#fef3c7'; badge.style.color = '#92400e';
    if (btn) btn.style.display = 'none';
  }
}

// ===== 取り外し =====

function ejectKoshuTridge() {
  if (!confirm('工種Tridgeを取り外しますか？\n工種・労務・得意先マスタがクリアされます。\n現在の見積データ（品目）は保持されます。')) return;
  TRIDGE_CLIENTS.length = 0;
  koshuTridgeLoaded = false;
  localStorage.removeItem('activeCategories');
  activeCategories = [];
  const input = document.getElementById('dbFileInput');
  if (input) input.value = '';
  renderCatTabs();
  updateDbStatus();
  showDbOverlay();
}

function ejectZairyoTridge() {
  if (!confirm('資材Tridgeを取り外しますか？\n資材マスタ・カテゴリマスタがクリアされます。')) return;
  MATERIAL_DB.length = 0;
  BUKARIKI_DB.length = 0;
  BUNRUI_DB.rows = []; BUNRUI_DB.keywords = [];
  CATEGORY_MASTER.length = 0;
  zairyoTridgeLoaded = false;
  externalDbInfo = { materials: 0, bukariki: 0, source: '' };
  const input = document.getElementById('dbFileInput');
  if (input) input.value = '';
  const status = document.getElementById('dbLoadStatus');
  if (status) status.textContent = '';
  updateDbStatus();
  // カテゴリフィルタを再描画
  if (typeof initCatFilter === 'function') initCatFilter();
}

// ===== 列名の揺れ対応 =====
function getCol(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  }
  return undefined;
}

// ===== メインローダー（自動判別） =====
function loadExcelDB(file) {
  if (!file) return;
  const status = document.getElementById('dbLoadStatus');
  status.textContent = '読み込み中... ' + file.name;
  status.style.color = '#3b82f6';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheetNames = wb.SheetNames;

      // Tridge種別を自動判別（両方のシートがあれば両方読む）
      const hasKoshu   = sheetNames.includes('工種マスタ');
      const hasZairyo  = sheetNames.includes('資材マスタ');

      if (!hasKoshu && !hasZairyo) {
        status.innerHTML = '❌ 「工種マスタ」または「資材マスタ」シートが見つかりません<br>'
          + '<small style="color:#666;">検出シート: ' + sheetNames.join(', ') + '</small>';
        status.style.color = '#dc2626';
        return;
      }

      const msgs = [];
      if (hasKoshu)  msgs.push(loadKoshuSheets(wb));
      if (hasZairyo) msgs.push(loadZairyoSheets(wb, file.name));

      status.innerHTML = '✅ 読み込み完了!<br>' + msgs.join('<br>');
      status.style.color = '#16a34a';
      updateDbStatus();
      if (typeof initCatFilter === 'function') initCatFilter();

      setTimeout(() => closeDbOverlay(), 2000);

    } catch(err) {
      status.textContent = '❌ 読み込みエラー: ' + err.message;
      status.style.color = '#dc2626';
      console.error(err);
    }
  };
  reader.onerror = function() {
    document.getElementById('dbLoadStatus').textContent = '❌ ファイルを開けませんでした';
    document.getElementById('dbLoadStatus').style.color = '#dc2626';
  };
  reader.readAsArrayBuffer(file);
}

// ===== 工種Tridgeシート読み込み =====
function loadKoshuSheets(wb) {
  const msgs = [];

  // ----- 工種マスタ -----
  const wsKoshu = wb.Sheets['工種マスタ'];
  let newCategories = [];
  if (wsKoshu) {
    const dataKoshu = XLSX.utils.sheet_to_json(wsKoshu);
    newCategories = dataKoshu.map(r => ({
      id:       String(getCol(r, '工種ID') || '').trim(),
      name:     String(getCol(r, '工種名') || '').trim(),
      short:    String(getCol(r, '略称') || '').trim(),
      rateMode: ['true','1','yes','割合','はい','○'].includes(String(getCol(r, '割合モード') || '').trim()),
      miscRate:      parseFloat(getCol(r, '雑材料率%', '雑材料率') || 0) / 100,
      transportRate: parseFloat(getCol(r, '運搬費率%', '運搬費率') || 0) / 100,
      order:    parseInt(getCol(r, '順序') || 0),
      autoRows: String(getCol(r, '自動計算行') || '').trim().split('|').filter(Boolean),
    })).filter(c => c.id && c.name);
    msgs.push('工種: ' + newCategories.length + '件');
  }

  // ----- 労務単価マスタ -----
  const wsLabor = wb.Sheets['労務単価マスタ'];
  if (wsLabor) {
    const dataLabor = XLSX.utils.sheet_to_json(wsLabor);
    const first = dataLabor[0];
    if (first) {
      const sell = parseFloat(getCol(first, '見積単価（円/人工）', '見積単価', '売単価') || 0);
      const cost = parseFloat(getCol(first, '原価単価（円/人工）', '原価単価', '原価') || 0);
      if (sell > 0) setLaborRates(sell, cost);
    }
    msgs.push('労務: ' + dataLabor.length + '区分');
  }

  // ----- 得意先マスタ -----
  const wsClients = wb.Sheets['得意先マスタ'];
  if (wsClients) {
    const dataClients = XLSX.utils.sheet_to_json(wsClients);
    TRIDGE_CLIENTS.length = 0;
    dataClients.forEach(r => {
      const clientName = String(getCol(r, '得意先名') || '').trim();
      if (!clientName) return;
      TRIDGE_CLIENTS.push({
        clientId:   String(getCol(r, '得意先ID') || '').trim(),
        edaban:     parseInt(getCol(r, '枝番') ?? 0),
        clientName,
        zip:        String(getCol(r, '郵便番号') || '').trim(),
        address:    String(getCol(r, '住所') || '').trim(),
        tel:        String(getCol(r, '代表電話') || '').trim(),
        email:      String(getCol(r, '代表メール') || '').trim(),
        personName: String(getCol(r, '担当者名') || '').trim(),
        personTel:  String(getCol(r, '担当者電話') || '').trim(),
        personEmail:String(getCol(r, '担当者メール') || '').trim(),
        personMemo: String(getCol(r, '担当者メモ') || '').trim(),
      });
    });
    msgs.push('得意先: ' + TRIDGE_CLIENTS.length + '社');
  }

  // 工種マスタ適用
  koshuTridgeLoaded = true;
  if (newCategories.length > 0 && typeof applyTridgeCategories === 'function') {
    applyTridgeCategories(newCategories);
  }

  return '<b>工種Tridge</b>: ' + msgs.join(' / ');
}

// ===== 資材Tridgeシート読み込み =====
function loadZairyoSheets(wb, fileName) {
  const msgs = [];

  // ----- カテゴリマスタ（先に読む：資材判定に使うため）-----
  const wsCat = wb.Sheets['カテゴリマスタ'];
  if (wsCat) {
    const dataCat = XLSX.utils.sheet_to_json(wsCat);
    CATEGORY_MASTER.length = 0;
    dataCat.forEach(r => {
      const catId   = String(getCol(r, 'カテゴリID') || '').trim();
      const catName = String(getCol(r, 'カテゴリ名') || '').trim();
      const engKey  = String(getCol(r, '英語キー') || '').trim();
      const kwStr   = String(getCol(r, '自動判定キーワード') || '').trim();
      if (!catId || !catName) return;
      const keywords = kwStr === '（上記以外すべて）' ? [] : kwStr.split('|').map(k => k.trim()).filter(Boolean);
      CATEGORY_MASTER.push({ catId, catName, engKey, keywords, isDefault: keywords.length === 0 });
    });
    msgs.push('カテゴリ: ' + CATEGORY_MASTER.length + '件');
  }

  // ----- 分類マスタ -----
  const wsBunrui = wb.Sheets['分類マスタ'];
  if (wsBunrui) {
    const dataBunrui = XLSX.utils.sheet_to_json(wsBunrui);
    BUNRUI_DB.rows = dataBunrui.map(r => ({
      daiId:   String(getCol(r, '大分類ID') || '').trim(),
      daiName: String(getCol(r, '大分類名') || '').trim(),
      chuId:   String(getCol(r, '中分類ID') || '').trim(),
      chuName: String(getCol(r, '中分類名') || '').trim(),
      shoId:   String(getCol(r, '小分類ID') || '').trim(),
      shoName: String(getCol(r, '小分類名') || '').trim(),
      count:   parseInt(getCol(r, '品目数') || 0),
    })).filter(r => r.shoId);
  }

  // ----- 資材マスタ -----
  const ws1 = wb.Sheets['資材マスタ'];
  if (!ws1) return '<b>資材Tridge</b>: ❌ 資材マスタシートなし';

  const data1 = XLSX.utils.sheet_to_json(ws1);
  if (data1.length === 0) return '<b>資材Tridge</b>: ❌ 資材マスタにデータなし';


  const newMaterials = [];
  const newBukariki  = [];
  const seen = new Set();
  let skippedNoName = 0, skippedNoPrice = 0;

  // カテゴリ判定: Excel列の明示値を優先 → detectMaterialCategory（data.js）でキーワード判定
  function detectCatId(hinmei, kikaku, chuName, existingCatCol) {
    // 1. Excelのカテゴリ列に明示値があればそのまま使用
    if (existingCatCol) {
      const cv = String(existingCatCol).trim();
      if (cv) return cv;
    }
    // 2. MATERIAL_CATEGORIESのキーワードで自動判定（data.jsの共通関数）
    return detectMaterialCategory(hinmei + ' ' + (kikaku || '') + ' ' + (chuName || ''), '');
  }

  for (const row of data1) {
    const hinmei    = String(getCol(row, '品目名称', '品名', '名称', '材料名', '品目') || '').trim();
    const kikaku    = String(getCol(row, '規格名称', '規格', '仕様', '型番', '規格・型番') || '').trim();
    const unit      = String(getCol(row, '単位') || '').trim();
    const basePrice = parseFloat(getCol(row, '基準単価', '単価', '見積単価', '仕切単価', '仕切価格', '定価') || 0);
    const costPrice = parseFloat(getCol(row, '原価単価', '原価') || 0);
    const buk1      = parseFloat(getCol(row, '歩掛1', '歩掛', '人工', '取付人工') || 0);
    const chuName   = String(getCol(row, '中分類名', '分類名', '分類') || '').trim();
    const daiId     = String(getCol(row, '大分類ID') || '').trim();
    const chuId     = String(getCol(row, '中分類ID') || '').trim();
    const shoId     = String(getCol(row, '小分類ID') || '').trim();
    const shoName   = String(getCol(row, '小分類名') || '').trim();
    const catCol    = getCol(row, 'カテゴリID', 'カテゴリ');

    if (!hinmei) { skippedNoName++; continue; }

    const catId = detectCatId(hinmei, kikaku, chuName, catCol);

    // 資材DB登録（単価あり行のみ）
    if (basePrice > 0) {
      const cp = costPrice > 0 ? costPrice : Math.round(basePrice * 0.75);
      const r  = costPrice > 0 ? Math.round(costPrice / basePrice * 100) / 100 : 0.75;
      newMaterials.push({
        n: hinmei, s: kikaku, u: unit, c: catId,
        ep: basePrice, cp, r, a: 1,
        daiId, chuId, shoId, shoName,
      });
    } else {
      skippedNoPrice++;
    }

    // 歩掛DB登録（歩掛あり行のみ）
    if (buk1 > 0) {
      const key = hinmei + '|' + kikaku;
      if (!seen.has(key)) {
        seen.add(key);
        newBukariki.push({ n: hinmei, s: kikaku, u: unit, b: buk1, c: catId });
      }
    }
  }

  // カテゴリ別内訳
  const catCount = {};
  newMaterials.forEach(m => catCount[m.c] = (catCount[m.c] || 0) + 1);

  if (newMaterials.length === 0) {
    return '<b>資材Tridge</b>: ⚠️ 資材が0件（列名を確認してください）';
  }

  // DBを置換
  MATERIAL_DB.length = 0;
  newMaterials.forEach(m => MATERIAL_DB.push(m));
  if (newBukariki.length > 0) {
    BUKARIKI_DB.length = 0;
    newBukariki.forEach(b => BUKARIKI_DB.push(b));
  }

  zairyoTridgeLoaded = true;
  externalDbInfo = { materials: newMaterials.length, bukariki: newBukariki.length, source: fileName };

  msgs.push('資材: ' + newMaterials.length.toLocaleString() + '品目 / 歩掛: ' + newBukariki.length.toLocaleString() + '件');

  if (typeof showToast === 'function') {
    setTimeout(() => showToast('資材Tridge読み込み完了: ' + newMaterials.length.toLocaleString() + '品目'), 2100);
  }

  return '<b>資材Tridge</b>: ' + msgs.join(' / ');
}
