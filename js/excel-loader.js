// ===== Excel DB読み込み =====

// CAT_RATIOS defined in data.js

// ===== EXCEL DB LOADING =====
let externalDbLoaded = false;
let externalDbInfo = { materials: 0, bukariki: 0, source: '' };

function showDbOverlay() {
  document.getElementById('dbOverlay').style.display = 'flex';
}

function closeDbOverlay() {
  document.getElementById('dbOverlay').style.display = 'none';
  updateDbStatus();
}

function updateDbStatus() {
  const badge = document.getElementById('dbBadge');
  if (!badge) return;
  if (externalDbLoaded) {
    badge.textContent = '📊 ' + externalDbInfo.source.replace(/\.xlsx?$/i,'') + '（' + externalDbInfo.materials.toLocaleString() + '品目）';
    badge.style.background = '#dcfce7'; badge.style.color = '#16a34a';
  } else if (MATERIAL_DB.length > 0) {
    badge.textContent = 'DB: ' + MATERIAL_DB.length + '品目';
    badge.style.background = '#fef3c7'; badge.style.color = '#92400e';
  } else {
    badge.textContent = '⚠ DBなし（クリックで読込）';
    badge.style.background = '#fee2e2'; badge.style.color = '#dc2626';
  }
}

// 列名の揺れに対応：複数の候補名から最初に見つかった値を返す
function getCol(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  }
  return undefined;
}

function loadExcelDB(file) {
  if (!file) return;
  const status = document.getElementById('dbLoadStatus');
  status.textContent = '読み込み中... ' + file.name;
  status.style.color = '#3b82f6';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });

      // ===== Sheet: 工種マスタ =====
      const wsKoshu = wb.Sheets['工種マスタ'];
      let newCategories = [];
      if (wsKoshu) {
        const dataKoshu = XLSX.utils.sheet_to_json(wsKoshu);
        newCategories = dataKoshu.map(r => ({
          id:       String(getCol(r, '工種ID') || '').trim(),
          name:     String(getCol(r, '工種名') || '').trim(),
          short:    String(getCol(r, '略称') || '').trim(),
          rateMode: ['true','1','yes','割合','はい','○'].includes(String(getCol(r, '割合モード') || '').trim()),
          miscRate: parseFloat(getCol(r, '雑材料率%', '雑材料率') || 0) / 100,
          order:    parseInt(getCol(r, '順序') || 0),
        })).filter(c => c.id && c.name);
        console.log('[Tridge] 工種マスタ:', newCategories.length, '件');
      }

      // ===== Sheet: 設定マスタ =====
      const wsSettings = wb.Sheets['設定マスタ'];
      let newSettings = { ...TRIDGE_SETTINGS };
      if (wsSettings) {
        const dataSettings = XLSX.utils.sheet_to_json(wsSettings);
        const map = {};
        dataSettings.forEach(r => {
          const key = String(getCol(r, 'パラメーター名', 'パラメータ', '設定名') || '').trim();
          const val = getCol(r, '値', 'value');
          if (key) map[key] = val;
        });
        const yn = v => ['true','1','yes','有効','○','はい'].includes(String(v || '').trim());
        if (map['銅建値補正']          !== undefined) newSettings.copperEnabled  = yn(map['銅建値補正']);
        if (map['銅建値基準（円/kg）'] !== undefined) newSettings.copperBase     = parseFloat(map['銅建値基準（円/kg）']) || 1000;
        if (map['銅連動率']            !== undefined) newSettings.copperFraction = parseFloat(map['銅連動率']) || 0.50;
        if (map['労務売単価（円/人工）']!== undefined) newSettings.laborSell     = parseFloat(map['労務売単価（円/人工）']) || 19000;
        if (map['労務原価単価（円/人工）']!==undefined) newSettings.laborCost    = parseFloat(map['労務原価単価（円/人工）']) || 12000;
        console.log('[Tridge] 設定マスタ:', newSettings);
      }

      // ===== Sheet: キーワードマスタ =====
      const wsKw = wb.Sheets['キーワードマスタ'];
      let newKeywords = [];
      if (wsKw) {
        const dataKw = XLSX.utils.sheet_to_json(wsKw);
        const yn = v => ['true','1','yes','○','はい'].includes(String(v || '').trim());
        newKeywords = dataKw.map(r => ({
          keyword:       norm(String(getCol(r, 'キーワード') || '').trim()),
          laborType:     String(getCol(r, '分類', '労務分類') || 'fixture').trim(),
          bukariki:      parseFloat(getCol(r, '歩掛', '歩掛値') || 0),
          copperLinked:  yn(getCol(r, '銅連動', '銅連動フラグ')),
          ceilingOpening: yn(getCol(r, '天井開口', '天井開口フラグ')),
        })).filter(k => k.keyword);
        console.log('[Tridge] キーワードマスタ:', newKeywords.length, '件');
      }

      // ===== Sheet: 資材マスタ =====
      const ws1 = wb.Sheets['資材マスタ'];
      if (!ws1) { status.textContent = '❌ 「資材マスタ」シートが見つかりません'; status.style.color = '#dc2626'; return; }
      const data1 = XLSX.utils.sheet_to_json(ws1);

      // 実際の列名を確認（デバッグ用）
      if (data1.length > 0) {
        console.log('[DB読込] 検出した列名:', Object.keys(data1[0]));
      } else {
        status.textContent = '❌ 「資材マスタ」シートにデータがありません';
        status.style.color = '#dc2626';
        return;
      }

      // Sheet 3: 労務単価マスタ
      const ws3 = wb.Sheets['労務単価マスタ'];
      let laborRates = {};
      if (ws3) {
        const data3 = XLSX.utils.sheet_to_json(ws3);
        data3.forEach(r => {
          const kubun = getCol(r, '労務区分');
          const sell   = getCol(r, '見積単価（円/人工）', '見積単価', '売単価');
          const cost   = getCol(r, '原価単価（円/人工）', '原価単価', '原価');
          if (kubun && sell) {
            laborRates[String(kubun)] = { sell: parseFloat(sell), cost: parseFloat(cost) || 0 };
          }
        });
      }

      // Convert to MATERIAL_DB format + BUKARIKI_DB format
      const newMaterials = [];
      const newBukariki = [];
      const seen = new Set();
      let skippedNoName = 0, skippedNoPrice = 0;

      for (const row of data1) {
        // 列名の揺れに対応：複数の候補を試みる
        const hinmei   = String(getCol(row, '品目名称', '品名', '名称', '材料名', '品目') || '').trim();
        const kikaku   = String(getCol(row, '規格名称', '規格', '仕様', '型番', '規格・型番') || '').trim();
        const unit     = String(getCol(row, '単位') || '').trim();
        const basePrice = parseFloat(getCol(row, '基準単価', '単価', '見積単価', '仕切単価', '仕切価格', '定価') || 0);
        const buk1     = parseFloat(getCol(row, '歩掛1', '歩掛', '人工', '取付人工') || 0);
        const chuName  = String(getCol(row, '中分類名', '分類名', '分類') || '').trim();

        if (!hinmei) { skippedNoName++; continue; }

        // カテゴリ判定（norm()で全角/半角を統一、電線管を先にチェック）
        let cat = 'fixture';
        const n = norm(hinmei + ' ' + kikaku + ' ' + chuName);
        if (['電線管','pf-','ve ','fep','ねじなし','プルボックス','ダクト','ボックス'].some(k => n.includes(norm(k)))) cat = 'conduit';
        else if (['電線','ケーブル','cv ','cvt','vv-f','iv ','cpev','同軸','utp','ae ','hp ','toev','fcpev'].some(k => n.includes(norm(k)))) cat = 'cable';
        else if (['コンセント','スイッチ','プレート','配線器具'].some(k => n.includes(norm(k)))) cat = 'device';
        else if (['分電盤','開閉器','制御盤'].some(k => n.includes(norm(k)))) cat = 'panel';
        else if (['火災','感知','報知','自火報'].some(k => n.includes(norm(k)))) cat = 'fire';
        else if (['接地'].some(k => n.includes(norm(k)))) cat = 'ground';
        else if (['調光','ディマ'].some(k => n.includes(norm(k)))) cat = 'dimmer';

        // 資材DB登録（単価あり行のみ）
        if (basePrice > 0) {
          const costRate = CAT_RATIOS[cat] || 0.75;
          newMaterials.push({
            n: hinmei, s: kikaku, u: unit, c: cat,
            ep: basePrice, cp: Math.round(basePrice * costRate), r: costRate, a: 1
          });
        } else {
          skippedNoPrice++;
        }

        // 歩掛DB登録（歩掛あり行のみ）
        if (buk1 > 0) {
          const key = hinmei + '|' + kikaku;
          if (!seen.has(key)) {
            seen.add(key);
            newBukariki.push({ n: hinmei, s: kikaku, u: unit, b: buk1, c: cat });
          }
        }
      }

      // カテゴリ別内訳をコンソールに出力（デバッグ用）
      const catCount = {};
      newMaterials.forEach(m => catCount[m.c] = (catCount[m.c] || 0) + 1);
      console.log('[DB読込] カテゴリ別件数:', catCount);
      console.log('[DB読込] 品名なしスキップ:', skippedNoName, '件 / 単価なしスキップ:', skippedNoPrice, '件');

      // 0件の場合は警告
      if (newMaterials.length === 0) {
        status.innerHTML = '⚠️ 資材が0件でした。列名を確認してください。<br>'
          + '<small style="color:#666;">検出列: ' + Object.keys(data1[0]).join(', ') + '</small><br>'
          + '<small>必要列: 品目名称(or品名), 規格名称(or規格), 基準単価(or単価)</small>';
        status.style.color = '#d97706';
        return;
      }

      // ===== Tridge設定・キーワード・工種を適用 =====
      // 設定マスタ → TRIDGE_SETTINGS
      Object.assign(TRIDGE_SETTINGS, newSettings);
      // キーワードマスタ → TRIDGE_KEYWORDS
      TRIDGE_KEYWORDS.length = 0;
      newKeywords.forEach(k => TRIDGE_KEYWORDS.push(k));
      // 労務単価を同期（設定マスタ優先、なければ労務単価マスタ）
      if (newSettings.laborSell) {
        LABOR_RATES.sell = TRIDGE_SETTINGS.laborSell;
        LABOR_RATES.cost = TRIDGE_SETTINGS.laborCost;
      } else if (laborRates['001']) {
        LABOR_RATES.sell = laborRates['001'].sell;
        LABOR_RATES.cost = laborRates['001'].cost;
      }
      tridgeLoaded = true;

      // Replace DBs
      MATERIAL_DB.length = 0;
      newMaterials.forEach(m => MATERIAL_DB.push(m));
      if (newBukariki.length > 0) {
        BUKARIKI_DB.length = 0;
        newBukariki.forEach(b => BUKARIKI_DB.push(b));
      }

      // 工種マスタがあれば activeCategories を更新
      if (newCategories.length > 0 && typeof applyTridgeCategories === 'function') {
        applyTridgeCategories(newCategories);
      }
      // 銅建値補正UIの表示切り替え
      if (typeof updateCopperUI === 'function') updateCopperUI();

      externalDbLoaded = true;
      externalDbInfo = {
        materials: newMaterials.length,
        bukariki:  newBukariki.length,
        categories: newCategories.length,
        keywords:  newKeywords.length,
        source: file.name
      };

      // カテゴリ別内訳の表示
      const CAT_JA = {cable:'電線',conduit:'電線管',device:'器具',box:'BOX',panel:'盤',fixture:'照明/その他',dimmer:'調光',fire:'火報',ground:'接地',accessories:'付属'};
      const catSummary = Object.entries(catCount).map(([c,n]) => `${CAT_JA[c]||c}:${n}`).join(' / ');
      const catInfo    = newCategories.length > 0 ? ` / 工種: ${newCategories.length}件` : '';
      const kwInfo     = newKeywords.length   > 0 ? ` / KW: ${newKeywords.length}件`    : '';
      const copperInfo = TRIDGE_SETTINGS.copperEnabled ? ' ⚡銅建値補正有効' : '';

      status.innerHTML = '✅ 読み込み完了!<br>'
        + `資材: ${newMaterials.length.toLocaleString()}品目 / 歩掛: ${newBukariki.length.toLocaleString()}件`
        + catInfo + kwInfo + '<br>'
        + `<small style="color:#555;">${catSummary}${copperInfo}</small>`;
      status.style.color = '#16a34a';

      setTimeout(() => {
        closeDbOverlay();
        showToast('Tridge読み込み完了: ' + newMaterials.length.toLocaleString() + '品目');
      }, 2000);

    } catch(err) {
      status.textContent = '❌ 読み込みエラー: ' + err.message;
      status.style.color = '#dc2626';
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ===== 内蔵DBをExcelとしてエクスポート =====
function exportBuiltinDB() {
  if (!window.XLSX) { alert('SheetJSが読み込まれていません'); return; }

  const CAT_LABEL = {cable:'電線・ケーブル',conduit:'電線管',box:'ボックス',device:'配線器具',
    panel:'分電盤',fixture:'照明器具',dimmer:'調光器',fire:'火災報知器',ground:'接地',accessories:'付属品'};

  // 歩掛DBをマップ化（品名+規格 → 歩掛値）
  const bukMap = {};
  BUKARIKI_DB.forEach(b => { bukMap[b.n + '|' + b.s] = b.b; });

  // 資材マスタシート
  const header = ['品目名称','規格名称','単位','基準単価','原価単価','原価率','歩掛1','中分類名','カテゴリ'];
  const rows = [header];
  MATERIAL_DB.forEach(m => {
    const buk = bukMap[m.n + '|' + m.s] || bukMap[m.n + '|'] || '';
    rows.push([
      m.n, m.s, m.u,
      m.ep, m.cp, m.r,
      buk,
      CAT_LABEL[m.c] || m.c,
      m.c
    ]);
  });

  // 歩掛マスタシート（材料DBにない歩掛エントリ）
  const bukHeader = ['品目名称','規格名称','単位','歩掛1','中分類名'];
  const bukRows = [bukHeader];
  BUKARIKI_DB.forEach(b => {
    bukRows.push([b.n, b.s, b.u, b.b, CAT_LABEL[b.c] || b.c]);
  });

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  // 列幅設定
  ws1['!cols'] = [
    {wch:30},{wch:28},{wch:6},{wch:10},{wch:10},{wch:7},{wch:7},{wch:16},{wch:12}
  ];
  XLSX.utils.book_append_sheet(wb, ws1, '資材マスタ');

  const ws2 = XLSX.utils.aoa_to_sheet(bukRows);
  ws2['!cols'] = [{wch:30},{wch:28},{wch:6},{wch:7},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws2, '歩掛マスタ');

  XLSX.writeFile(wb, '見積マスタDB_内蔵.xlsx');
  showToast('内蔵DBをダウンロードしました（' + MATERIAL_DB.length + '品目）');
}
