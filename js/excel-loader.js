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
    badge.textContent = '外部DB: ' + externalDbInfo.materials.toLocaleString() + '品目 / 歩掛' + externalDbInfo.bukariki.toLocaleString() + '件';
    badge.style.background = '#dcfce7'; badge.style.color = '#16a34a';
  } else {
    badge.textContent = '内蔵DB: ' + MATERIAL_DB.length + '品目 / 歩掛' + BUKARIKI_DB.length + '件';
    badge.style.background = '#fef3c7'; badge.style.color = '#92400e';
  }
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
      
      // Sheet 1: 資材マスタ
      const ws1 = wb.Sheets['資材マスタ'];
      if (!ws1) { status.textContent = '❌ 「資材マスタ」シートが見つかりません'; status.style.color = '#dc2626'; return; }
      const data1 = XLSX.utils.sheet_to_json(ws1);
      
      // Sheet 3: 労務単価マスタ
      const ws3 = wb.Sheets['労務単価マスタ'];
      let laborRates = {};
      if (ws3) {
        const data3 = XLSX.utils.sheet_to_json(ws3);
        data3.forEach(r => {
          if (r['労務区分'] && r['見積単価（円/人工）']) {
            laborRates[r['労務区分']] = { sell: r['見積単価（円/人工）'], cost: r['原価単価（円/人工）'] || 0 };
          }
        });
      }
      
      // Convert to MATERIAL_DB format + BUKARIKI_DB format
      const newMaterials = [];
      const newBukariki = [];
      const seen = new Set();
      
      for (const row of data1) {
        const hinmei = row['品目名称'] || '';
        const kikaku = row['規格名称'] || '';
        const unit = row['単位'] || '';
        const basePrice = parseFloat(row['基準単価']) || 0;
        const buk1 = parseFloat(row['歩掛1']) || 0;
        const roumu1 = (row['労務区分1'] || '001').toString();
        const chuCode = (row['中分類コード'] || '').toString();
        const chuName = row['中分類名'] || '';
        
        if (!hinmei) continue;
        
        // Classify into our categories
        let cat = 'fixture';
        const n = (hinmei + ' ' + kikaku + ' ' + chuName).toLowerCase();
        if (['電線','ｹｰﾌﾞﾙ','cv ','cvt','vv-f','iv ','cpev','同軸','utp','ae ','hp ','toev','fcpev'].some(k => n.includes(k))) cat = 'cable';
        else if (['電線管','pf-','ve ','fep','ﾈｼﾞﾅｼ','ﾎﾞｯｸｽ','ﾌﾟﾙﾎﾞ','ﾀﾞｸﾄ'].some(k => n.includes(k))) cat = 'conduit';
        else if (['ｺﾝｾﾝﾄ','ｽｲｯﾁ','ﾌﾟﾚｰﾄ','配線器具'].some(k => n.includes(k))) cat = 'device';
        else if (['分電盤','開閉器','制御盤'].some(k => n.includes(k))) cat = 'panel';
        else if (['火災','感知','報知','自火報'].some(k => n.includes(k))) cat = 'fire';
        else if (['接地'].some(k => n.includes(k))) cat = 'ground';
        else if (['調光','ﾃﾞｨﾏ'].some(k => n.includes(k))) cat = 'dimmer';
        
        // Material DB entry (with price)
        if (basePrice > 0) {
          const costRate = CAT_RATIOS[cat] || 0.75;
          newMaterials.push({
            n: hinmei, s: kikaku, u: unit, c: cat,
            ep: basePrice, cp: Math.round(basePrice * costRate), r: costRate, a: 1
          });
        }
        
        // Bukariki DB entry
        if (buk1 > 0) {
          const key = hinmei + '|' + kikaku;
          if (!seen.has(key)) {
            seen.add(key);
            newBukariki.push({ n: hinmei, s: kikaku, u: unit, b: buk1, c: cat });
          }
        }
      }
      
      // Update labor rates if found
      if (laborRates['001']) {
        LABOR_RATES.sell = laborRates['001'].sell;
        LABOR_RATES.cost = laborRates['001'].cost;
      }
      
      // Replace DBs
      if (newMaterials.length > 0) {
        MATERIAL_DB.length = 0;
        newMaterials.forEach(m => MATERIAL_DB.push(m));
      }
      if (newBukariki.length > 0) {
        BUKARIKI_DB.length = 0;
        newBukariki.forEach(b => BUKARIKI_DB.push(b));
      }
      
      externalDbLoaded = true;
      externalDbInfo = {
        materials: newMaterials.length,
        bukariki: newBukariki.length,
        source: file.name
      };
      
      status.innerHTML = '✅ 読み込み完了!<br>資材: ' + newMaterials.length.toLocaleString() + '品目 / 歩掛: ' + newBukariki.length.toLocaleString() + '件';
      status.style.color = '#16a34a';
      
      setTimeout(() => {
        closeDbOverlay();
        showToast('外部DB読み込み完了: ' + newMaterials.length.toLocaleString() + '品目');
      }, 1500);
      
    } catch(err) {
      status.textContent = '❌ 読み込みエラー: ' + err.message;
      status.style.color = '#dc2626';
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

