// ===== 自動計算エンジン =====

function addAutoCalcRows() {
  saveUndoState();
  const cat = activeCategories.find(c => c.id === currentCat);
  const lb  = calcLaborBreakdown(currentCat);
  const miscRate = cat?.miscRate ?? 0.05;
  const list = items[currentCat];

  if (lb.materialTotal <= 0 && lb.totalKosu <= 0 && lb.撤去Kosu <= 0 && lb.開口Kosu <= 0) {
    showToast('材料を先に入力してください');
    return;
  }

  // 追加する行を決定（値 > 0 の場合のみ追加、locked=trueは既存行も上書き）
  const toAdd = [];

  if (lb.materialTotal > 0) {
    toAdd.push({ name: '雑材料消耗品', price: Math.round(lb.materialTotal * miscRate),
      note: (miscRate * 100).toFixed(1) + '%', locked: false });
  }
  if (lb.totalKosu > 0) {
    toAdd.push({ name: LABOR_ROW_NAMES.labor1, price: Math.round(lb.totalKosu * LABOR_RATES.sell),
      note: lb.totalKosu.toFixed(2) + '人工', locked: true });
  }
  if (lb.撤去Kosu > 0) {
    toAdd.push({ name: LABOR_ROW_NAMES.labor2, price: Math.round(lb.撤去Kosu * LABOR_RATES.sell),
      note: lb.撤去Kosu.toFixed(2) + '人工', locked: true });
  }
  if (lb.開口Kosu > 0) {
    toAdd.push({ name: LABOR_ROW_NAMES.labor3, price: Math.round(lb.開口Kosu * LABOR_RATES.sell),
      note: lb.開口Kosu.toFixed(2) + '人工', locked: true });
  }
  if (lb.materialTotal > 0) {
    const transport = calcTransportForCat(cat, lb.materialTotal);
    toAdd.push({ name: '運搬費', price: transport,
      note: (transport / lb.materialTotal * 100).toFixed(1) + '%', locked: false });
  }

  toAdd.forEach(({ name, price, note, locked }) => {
    const exists = list.find(i => i.name === name);
    if (!exists) {
      list.push(createBlankItem({ name, qty: 1, price, amount: price, note }));
    } else if (locked) {
      exists.price  = price;
      exists.amount = price;
      exists.note   = note;
    }
  });

  renderItems();
  showToast('自動計算行を追加しました');
}

// 材料費規模から運搬費を算出（規模別概算・フォールバック用）
function calcTransport(materialTotal) {
  const { small, medium, large, xlarge } = AUTO_CALC.transportBase;
  if (materialTotal > 3000000) return xlarge;
  if (materialTotal > 1000000) return large;
  if (materialTotal > 500000)  return medium;
  return small;
}

// 工種の運搬費率%があれば率計算、なければ規模別概算
function calcTransportForCat(cat, materialTotal) {
  const rate = cat?.transportRate ?? 0;
  if (rate > 0) return Math.round(materialTotal * rate);
  return calcTransport(materialTotal);
}

// ===== AUTO-CALC ENGINE (再計算) =====
function calcAutoRows() {
  saveUndoState();
  const list = items[currentCat];
  const cat  = activeCategories.find(c => c.id === currentCat);

  const materialTotal = list
    .filter(i => !isAutoName(i.name))
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  const lb = calcLaborBreakdown(currentCat);

  if (materialTotal <= 0 && lb.totalKosu <= 0) return;

  // 雑材料消耗品
  const miscRate = cat?.miscRate ?? 0.05;
  const miscItem = list.find(i => i.name === '雑材料消耗品');
  if (miscItem && materialTotal > 0) {
    miscItem.qty = 1; miscItem.unit = '式';
    miscItem.price  = Math.round(materialTotal * miscRate);
    miscItem.amount = miscItem.price;
    miscItem.note   = (miscRate * 100).toFixed(1) + '%';
  }

  // 労務費1 (歩掛1)
  _updateLaborRow(list, LABOR_ROW_NAMES.labor1, lb.totalKosu);

  // 労務費2 (歩掛2)
  _updateLaborRow(list, LABOR_ROW_NAMES.labor2, lb.撤去Kosu);

  // 労務費3 (歩掛3)
  _updateLaborRow(list, LABOR_ROW_NAMES.labor3, lb.開口Kosu);

  // 運搬費
  const transportItem = list.find(i => i.name === '運搬費');
  if (transportItem && materialTotal > 0) {
    const transport = calcTransportForCat(cat, materialTotal);
    transportItem.qty = 1; transportItem.unit = '式';
    transportItem.price  = transport;
    transportItem.amount = transport;
    transportItem.note   = (transport / materialTotal * 100).toFixed(1) + '%';
  }

  renderItems();
  renderCatTabs();
  showToast('自動計算行を更新しました');
}

// 労務費行の更新ヘルパー
function _updateLaborRow(list, name, kosu) {
  const item = list.find(i => i.name === name);
  if (!item) return;
  item.qty = 1; item.unit = '式';
  item.price  = Math.round(kosu * LABOR_RATES.sell);
  item.amount = item.price;
  item.note   = kosu.toFixed(2) + '人工';
}
