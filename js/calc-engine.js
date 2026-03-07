// ===== 自動計算エンジン =====

function addAutoCalcRows() {
  saveUndoState();
  const cat = activeCategories.find(c => c.id === currentCat);
  // autoRows: Tridge工種マスタの「自動計算行」列。未設定時はAUTO_NAMESで後方互換フォールバック
  const tmpl = (cat?.autoRows?.length > 0) ? cat.autoRows : AUTO_NAMES.filter(n => {
    const fallbacks = {
      trunk:        ['雑材料消耗品','電工労務費','運搬費'],
      lighting_fix: ['雑材料消耗品','器具取付費','埋込器具用天井材開口費','運搬費'],
      outlet:       ['雑材料消耗品','電工労務費','運搬費'],
      weak:         ['雑材料消耗品','電工労務費','UTPケーブル試験費','運搬費'],
      fire:         ['雑材料消耗品','機器取付け及び試験調整費','運搬費'],
    };
    return (fallbacks[currentCat] || []).includes(n);
  });
  if (!tmpl || tmpl.length === 0) { showToast('この工種には自動計算行テンプレートがありません'); return; }

  // 労務費セクションと同じ計算値を取得
  const lb = calcLaborBreakdown(currentCat);
  const miscRate = cat?.miscRate ?? 0.05;

  const laborPrices = {
    '電工労務費':               Math.round(lb.totalKosu * LABOR_RATES.sell),
    '器具取付費':               Math.round(lb.fixtureKosu * LABOR_RATES.sell),
    '機器取付費':               Math.round(lb.equipKosu * LABOR_RATES.sell),
    '機器取付け及び試験調整費': Math.round(lb.totalKosu * LABOR_RATES.sell),
    '埋込器具用天井材開口費':   Math.round(lb.ceilingCount * 1410),
    '既設器具撤去処分費':       Math.round(lb.撤去Kosu * LABOR_RATES.sell),
    '天井及び壁材開口費':       Math.round(lb.開口Kosu * LABOR_RATES.sell),
    '雑材料消耗品':             Math.round(lb.materialTotal * miscRate),
    '運搬費':                   lb.materialTotal > 0 ? calcTransport(lb.materialTotal) : 0,
  };
  const laborNotes = {
    '電工労務費':               lb.totalKosu.toFixed(2) + '人工',
    '器具取付費':               lb.fixtureKosu.toFixed(2) + '人工',
    '機器取付費':               lb.equipKosu.toFixed(2) + '人工',
    '機器取付け及び試験調整費': lb.totalKosu.toFixed(2) + '人工',
    '埋込器具用天井材開口費':   lb.ceilingCount + '箇所',
    '既設器具撤去処分費':       lb.撤去Kosu.toFixed(2) + '人工',
    '天井及び壁材開口費':       lb.開口Kosu.toFixed(2) + '人工',
    '雑材料消耗品':             (miscRate * 100).toFixed(1) + '%',
    '運搬費':                   lb.materialTotal > 0
      ? (calcTransport(lb.materialTotal) / lb.materialTotal * 100).toFixed(1) + '%'
      : '0.0%',
  };

  tmpl.forEach(name => {
    // 歩掛2/3依存の行は、該当kosuが0なら追加しない
    if (name === '既設器具撤去処分費' && lb.撤去Kosu <= 0) return;
    if (name === '天井及び壁材開口費' && lb.開口Kosu <= 0) return;

    const exists = items[currentCat].find(i => i.name === name);
    const price = laborPrices[name] || 0;
    const note  = laborNotes[name]  || '';
    if (!exists) {
      // 新規追加：価格を自動入力
      const id = itemIdCounter++;
      items[currentCat].push({ id, name, spec:'', qty:1, unit:'式', price, amount:price, note, bukariki1:'', bukariki2:'', bukariki3:'' });
    } else if (LABOR_LOCKED_NAMES.includes(name)) {
      // 固定行（電工労務費等）は既存でも更新
      exists.price  = price;
      exists.amount = price;
      exists.note   = note;
    }
    // 雑材料消耗品・運搬費は既存行を上書きしない（手動変更を保持）
  });

  renderItems();
  showToast('自動計算行を追加しました');
}

// 材料費規模から運搬費を算出（renderLaborSection と共有）
function calcTransport(materialTotal) {
  const { small, medium, large, xlarge } = AUTO_CALC.transportBase;
  if (materialTotal > 3000000) return xlarge;
  if (materialTotal > 1000000) return large;
  if (materialTotal > 500000)  return medium;
  return small;
}

// ===== AUTO-CALC ENGINE =====
function calcAutoRows() {
  saveUndoState();
  const list = items[currentCat];

  // 自動計算行を除いた材料費小計（工種のautoRowsを優先、なければAUTO_NAMESにフォールバック）
  const cat = activeCategories.find(c => c.id === currentCat);
  const autoRowNames = (cat?.autoRows?.length > 0) ? cat.autoRows : AUTO_NAMES;
  const materialTotal = list
    .filter(i => !autoRowNames.includes(i.name))
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  if (materialTotal <= 0) return;

  // 雑材料消耗品：材料費 × 率
  const miscRate = cat?.miscRate ?? 0.05;
  const miscItem = list.find(i => i.name === '雑材料消耗品');
  if (miscItem) {
    miscItem.qty = 1;
    miscItem.unit = '式';
    miscItem.price = Math.round(materialTotal * miscRate);
    miscItem.amount = miscItem.price;
    miscItem.note = (miscRate * 100).toFixed(1) + '%';
  }

  // 運搬費：材料費規模別概算
  const transportItem = list.find(i => i.name === '運搬費');
  if (transportItem) {
    const transport = calcTransport(materialTotal);
    transportItem.qty = 1;
    transportItem.unit = '式';
    transportItem.price = transport;
    transportItem.amount = transport;
    transportItem.note = (transport / materialTotal * 100).toFixed(1) + '%';
  }
  
  renderItems();
  renderCatTabs();
  showToast('自動計算行を更新しました');
}

