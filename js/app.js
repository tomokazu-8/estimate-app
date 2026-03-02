let _laborSellTotal = 0; // renderLaborSection → updateSummaryBar で参照
let _navHistory = [];
let _currentPanel = 'project';

// ===== DB初期化（JSONファイルから読み込み） =====
async function loadDefaultDB() {
  try {
    const [matRes, bukRes] = await Promise.all([
      fetch('data/material_db.json'),
      fetch('data/bukariki_db.json')
    ]);
    if (matRes.ok) {
      const matData = await matRes.json();
      MATERIAL_DB.length = 0;
      matData.forEach(m => MATERIAL_DB.push(m));
    }
    if (bukRes.ok) {
      const bukData = await bukRes.json();
      BUKARIKI_DB.length = 0;
      bukData.forEach(b => BUKARIKI_DB.push(b));
    }
    console.log('DB loaded: ' + MATERIAL_DB.length + ' materials, ' + BUKARIKI_DB.length + ' bukariki');
    updateDbStatus();
  } catch(e) {
    console.warn('DB load failed, using empty DB:', e);
  }
}

// ===== 見積アプリ メイン =====

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pj-date').value = project.date;
  renderCatTabs();
  renderDBTable();
  showDbOverlay();
  loadDefaultDB().then(() => { loadFromLocalStorage(); updateDbStatus(); recalcAll(); });
});

// ===== NAVIGATION =====
function navigate(panel, el, isBack = false) {
  if (!isBack && _currentPanel !== panel) _navHistory.push(_currentPanel);
  _currentPanel = panel;

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
  document.getElementById('panel-' + panel).classList.add('active');
  if (el) {
    el.classList.add('active');
  } else {
    document.querySelectorAll('.sidebar-item').forEach(s => {
      if ((s.getAttribute('onclick') || '').includes(`'${panel}'`)) s.classList.add('active');
    });
  }

  const titles = { project:'物件情報', items:'明細入力', summary:'内訳書', reference:'類似物件参照', check:'妥当性チェック', database:'実績DB' };
  document.getElementById('topbarTitle').textContent = titles[panel] || '';
  document.getElementById('topbarBread').textContent = project.name || '新規見積作成';
  document.getElementById('backBtn').style.display = _navHistory.length > 0 ? '' : 'none';

  if (panel === 'summary') renderSummary();
  if (panel === 'reference') searchSimilar();
  if (panel === 'items') { renderCatTabs(); renderItems(); }
}

function navigateBack() {
  if (_navHistory.length === 0) return;
  navigate(_navHistory.pop(), null, true);
}

// ===== PROJECT =====
function updateProject() {
  project.name = document.getElementById('pj-name').value;
  project.number = document.getElementById('pj-number').value;
  project.date = document.getElementById('pj-date').value;
  project.client = document.getElementById('pj-client').value;
  project.struct = document.getElementById('pj-struct').value;
  project.usage = document.getElementById('pj-usage').value;
  project.type = document.getElementById('pj-type').value;
  project.floors = document.getElementById('pj-floors').value;
  project.areaSqm = document.getElementById('pj-area-sqm').value;
  project.areaTsubo = document.getElementById('pj-area-tsubo').value;
  project.location = document.getElementById('pj-location').value;
  project.person = document.getElementById('pj-person').value;
  project.laborRate = parseFloat(document.getElementById('pj-labor-rate').value) || 72;
  project.laborSell = parseFloat(document.getElementById('pj-labor-sell').value) || 33000;
  project.tax = parseFloat(document.getElementById('pj-tax').value) || 10;
  project.copper = document.getElementById('pj-copper').value;

  // LABOR_RATES / laborCostRatio を project 値と同期
  LABOR_RATES.sell = project.laborSell;
  LABOR_RATES.cost = Math.round(project.laborSell * project.laborRate / 100);
  AUTO_CALC.laborCostRatio = project.laborRate / 100;
}

function syncArea(from) {
  const factor = 3.30579;
  if (from === 'sqm') {
    const sqm = parseFloat(document.getElementById('pj-area-sqm').value);
    if (!isNaN(sqm) && sqm > 0) document.getElementById('pj-area-tsubo').value = (sqm / factor).toFixed(1);
  } else {
    const tsubo = parseFloat(document.getElementById('pj-area-tsubo').value);
    if (!isNaN(tsubo) && tsubo > 0) document.getElementById('pj-area-sqm').value = (tsubo * factor).toFixed(1);
  }
}

// ===== CATEGORY TABS =====
function renderCatTabs() {
  const el = document.getElementById('catTabs');
  el.innerHTML = CATEGORIES.map(c => {
    const total = getCatTotal(c.id);
    const amountStr = total > 0 ? ` ¥${formatNum(total)}` : '';
    return `<div class="cat-tab${c.id===currentCat?' active':''}" onclick="switchCat('${c.id}')">${c.short}<span class="cat-amount">${amountStr}</span></div>`;
  }).join('');
}

function switchCat(catId) {
  currentCat = catId;
  renderCatTabs();
  renderItems();
}

function getCatTotal(catId) {
  // Material items only (labor is tracked separately)
  return (items[catId] || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
}

// ===== ITEM ENTRY =====

// ===== LABOR SECTION RENDERING (本丸EX準拠) =====
function renderLaborSection() {
  const lb = calcLaborBreakdown(currentCat);
  
  if (lb.materialTotal <= 0 && lb.totalKosu <= 0) {
    document.getElementById('laborSection').style.display = 'none';
    _laborSellTotal = 0;
    return;
  }
  document.getElementById('laborSection').style.display = '';
  
  const rows = [];
  const lr = AUTO_CALC.laborCostRatio; // 0.72
  
  const laborSellStr = '¥' + formatNum(LABOR_RATES.sell);

  // 1. 電工労務費 (配線工事労務)
  if (lb.wiringKosu > 0) {
    const sell = Math.round(lb.wiringKosu * LABOR_RATES.sell);
    rows.push({ name: '電工労務費', basis: lb.wiringKosu.toFixed(2) + '人工 × ' + laborSellStr, sell, cost: Math.round(sell * lr) });
  }

  // 2. 器具取付費 (器具・配線器具の取付工事)
  if (lb.fixtureKosu > 0) {
    const sell = Math.round(lb.fixtureKosu * LABOR_RATES.sell);
    rows.push({ name: '器具取付費', basis: lb.fixtureKosu.toFixed(2) + '人工 × ' + laborSellStr, sell, cost: Math.round(sell * lr) });
  }

  // 3. 機器取付費 (盤類・大型機器)
  if (lb.equipKosu > 0) {
    const sell = Math.round(lb.equipKosu * LABOR_RATES.sell);
    rows.push({ name: '機器取付費', basis: lb.equipKosu.toFixed(2) + '人工 × ' + laborSellStr, sell, cost: Math.round(sell * lr) });
  }
  
  // 4. 埋込器具用天井材開口費
  if (lb.ceilingCount > 0) {
    const unitPrice = 1410; // ¥1,410/箇所 (実績平均)
    const sell = Math.round(lb.ceilingCount * unitPrice);
    rows.push({ name: '埋込器具用天井材開口費', basis: lb.ceilingCount + '箇所 × ¥' + formatNum(unitPrice), sell, cost: Math.round(sell * lr) });
  }
  
  // 5. 雑材料消耗品
  if (lb.materialTotal > 0) {
    const rate = AUTO_CALC.miscRate[currentCat] || 0.05;
    const sell = Math.round(lb.materialTotal * rate);
    rows.push({ name: '雑材料消耗品', basis: '材料費 × ' + (rate*100).toFixed(0) + '%', sell, cost: Math.round(sell * lr) });
  }
  
  // 6. 運搬費
  if (lb.materialTotal > 0) {
    const t = calcTransport(lb.materialTotal);
    rows.push({ name: '運搬費', basis: '材料費規模別', sell: t, cost: Math.round(t * lr) });
  }
  
  // Render table
  let sellSum = 0, costSum = 0;
  document.getElementById('laborBody').innerHTML = rows.map((r, i) => {
    sellSum += r.sell; costSum += r.cost;
    const ratio = r.sell > 0 ? (r.cost / r.sell * 100).toFixed(0) + '%' : '-';
    return '<tr style="border-bottom:1px solid #e5e7eb;">' +
      '<td class="td-center" style="font-size:11px;color:#6b7280;">'+(i+1)+'</td>' +
      '<td style="font-weight:500;padding:6px 8px;">'+r.name+'</td>' +
      '<td style="font-size:11px;color:#6b7280;padding:6px 4px;">'+r.basis+'</td>' +
      '<td class="td-right" style="padding:6px 8px;">¥'+formatNum(r.sell)+'</td>' +
      '<td class="td-right" style="padding:6px 8px;color:#6b7280;">¥'+formatNum(r.cost)+'</td>' +
      '<td class="td-right" style="padding:6px 4px;font-size:11px;">'+ratio+'</td></tr>';
  }).join('');
  
  document.getElementById('laborSellTotal').textContent = '¥' + formatNum(sellSum);
  document.getElementById('laborCostTotal').textContent = '¥' + formatNum(costSum);
  document.getElementById('laborRatioTotal').textContent = sellSum > 0 ? (costSum/sellSum*100).toFixed(0)+'%' : '-';
  _laborSellTotal = sellSum;
}

function showLaborDetail() {
  const lb = calcLaborBreakdown(currentCat);
  if (lb.details.length === 0) { showToast('材料を先に入力してください'); return; }
  const typeNames = { wiring: '配線工事', fixture: '器具取付', equipment: '機器取付' };
  let html = '<div style="padding:12px 16px;max-height:450px;overflow-y:auto;font-size:12px;">';
  html += '<table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f0fdf4;"><th style="text-align:left;padding:4px;">品名</th><th style="text-align:right;padding:4px;">数量</th><th style="text-align:right;padding:4px;">歩掛</th><th style="text-align:right;padding:4px;">工数</th><th style="padding:4px;">分類</th><th style="padding:4px;">根拠</th></tr></thead><tbody>';
  for (const d of lb.details) {
    html += '<tr style="border-bottom:1px solid #eee;"><td style="padding:3px 4px;">'+d.name+'</td><td style="text-align:right;padding:3px 4px;">'+d.qty+'</td><td style="text-align:right;padding:3px 4px;">'+d.bukariki.toFixed(3)+'</td><td style="text-align:right;padding:3px 4px;">'+d.kosu.toFixed(3)+'</td><td style="padding:3px 4px;"><span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:10px;">'+(typeNames[d.type]||d.type)+'</span></td><td style="padding:3px 4px;font-size:10px;color:#888;">'+d.source+'</td></tr>';
  }
  html += '</tbody></table>';
  html += '<div style="margin-top:12px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:13px;">';
  html += '<b>配線工事:</b> '+lb.wiringKosu.toFixed(2)+'人工　<b>器具取付:</b> '+lb.fixtureKosu.toFixed(2)+'人工　<b>機器取付:</b> '+lb.equipKosu.toFixed(2)+'人工';
  html += '<br><b>合計:</b> '+lb.totalKosu.toFixed(2)+'人工 → 見積 ¥'+formatNum(Math.round(lb.totalKosu*LABOR_RATES.sell))+' / 原価 ¥'+formatNum(Math.round(lb.totalKosu*LABOR_RATES.cost));
  html += '</div></div>';
  document.getElementById('laborModalBody').innerHTML = html;
  document.getElementById('laborModal').classList.add('show');
}

function renderItems() {
  const cat = CATEGORIES.find(c => c.id === currentCat);
  document.getElementById('catTitle').textContent = cat ? cat.name : '';

  const tbody = document.getElementById('itemBody');
  const list = items[currentCat] || [];

  tbody.innerHTML = list.map((item, idx) => {
    const isAuto = AUTO_NAMES.includes(item.name);
    return `
    <tr data-id="${item.id}" class="${isAuto ? 'auto-calc' : ''}">
      <td class="td-center" style="color:var(--text-dim);font-size:11px;">${idx+1}</td>
      <td class="suggest-wrap">
        <input value="${esc(item.name)}" onchange="updateItem(${item.id},'name',this.value)" oninput="showSuggestions(${item.id},this.value)" onblur="hideSuggestions(${item.id})" placeholder="品名（入力で候補表示）">
        <div class="suggest-list" id="suggest-${item.id}"></div>
      </td>
      <td><input value="${esc(item.spec)}" onchange="updateItem(${item.id},'spec',this.value)" placeholder="規格"></td>
      <td><input class="num" value="${item.qty||''}" onchange="updateItem(${item.id},'qty',this.value)" type="number" step="any"></td>
      <td><select onchange="updateItem(${item.id},'unit',this.value)">${UNITS.map(u=>`<option${u===item.unit?' selected':''}>${u}</option>`).join('')}</select></td>
      <td><input class="num" value="${item.bukariki !== '' && item.bukariki !== undefined ? item.bukariki : ''}" onchange="updateItem(${item.id},'bukariki',this.value)" type="number" step="0.001" placeholder="自動" ${isAuto ? 'disabled' : ''}></td>
      <td><input class="num" value="${item.price||''}" onchange="updateItem(${item.id},'price',this.value)" type="number" step="any"></td>
      <td class="td-right" style="font-weight:500;">${item.amount ? '¥'+formatNum(Math.round(item.amount)) : ''}</td>
      <td><input value="${esc(item.note)}" onchange="updateItem(${item.id},'note',this.value)" placeholder="定価" style="font-size:11px;color:var(--text-sub);"></td>
      <td>
        <span style="display:flex;gap:2px;">
          <button class="row-delete" onclick="openSearchModal(${item.id})" title="材料DBから検索" style="opacity:0.5;color:var(--accent);">🔍</button>
          <button class="row-delete" onclick="deleteItem(${item.id})">✕</button>
        </span>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('catTotal').textContent = '¥' + formatNum(Math.round(getCatTotal(currentCat)));
  renderLaborSection();
  updateSummaryBar();
}

function addItem() {
  const id = itemIdCounter++;
  items[currentCat].push({ id, name:'', spec:'', qty:'', unit:'式', price:'', amount:0, note:'', bukariki:'' });
  renderItems();
  // Focus the new row's name input
  setTimeout(() => {
    const rows = document.querySelectorAll('#itemBody tr');
    if (rows.length) rows[rows.length-1].querySelector('input').focus();
  }, 50);
}

// addAutoCalcRows is in calc-engine.js

function updateItem(id, field, value) {
  const list = items[currentCat];
  const item = list.find(i => i.id === id);
  if (!item) return;
  
  item[field] = value;
  
  // Auto calc amount
  if (field === 'qty' || field === 'price') {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    item.amount = qty * price;
  }
  
  renderItems();
  renderCatTabs();
}

function deleteItem(id) {
  items[currentCat] = items[currentCat].filter(i => i.id !== id);
  renderItems();
  renderCatTabs();
}

function recalcAll() {
  updateProject();
  renderItems();
}

// ===== SUMMARY BAR =====
function updateSummaryBar() {
  let grandTotal = 0;
  CATEGORIES.forEach(c => { grandTotal += getCatTotal(c.id); });
  grandTotal += _laborSellTotal; // 労務費・経費を加算
  
  const tsubo = parseFloat(project.areaTsubo) || 0;
  const sqm = parseFloat(project.areaSqm) || 0;
  
  document.getElementById('sum-total').textContent = '¥' + formatNum(Math.round(grandTotal));
  document.getElementById('sum-tsubo').textContent = tsubo > 0 ? '¥' + formatNum(Math.round(grandTotal / tsubo)) : '—';
  document.getElementById('sum-sqm').textContent = sqm > 0 ? '¥' + formatNum(Math.round(grandTotal / sqm)) : '—';
  
  // Estimate cost (using labor rate)
  const laborRate = (project.laborRate || 72) / 100;
  const estimatedCost = Math.round(grandTotal * laborRate); // simplified
  const profitRate = grandTotal > 0 ? ((grandTotal - estimatedCost) / grandTotal * 100).toFixed(1) : 0;
  document.getElementById('sum-cost').textContent = '¥' + formatNum(estimatedCost);
  document.getElementById('sum-profit').textContent = profitRate + '%';
}

// ===== SUMMARY VIEW (内訳書) =====
function renderSummary() {
  const tbody = document.getElementById('summaryBody');
  let rows = '';
  let grandTotal = 0;

  CATEGORIES.forEach(c => {
    const total = getCatTotal(c.id);
    if (total === 0 && c.id !== 'discount') return; // Skip empty unless discount
    grandTotal += total;
    rows += `<tr>
      <td>${c.name}</td>
      <td class="td-right">1</td>
      <td class="td-center">式</td>
      <td class="td-right" style="font-weight:500;">${formatNum(Math.round(total))}</td>
      <td></td>
    </tr>`;
  });

  tbody.innerHTML = rows;
  document.getElementById('summaryTotal').textContent = '¥' + formatNum(Math.round(grandTotal));
  document.getElementById('prev-projname').textContent = project.name || '（物件名未入力）';
}

// ===== SIMILAR PROJECTS =====
function searchSimilar() {
  const struct = project.struct;
  const type = project.type;
  const usage = project.usage;
  const area = parseFloat(project.areaTsubo) || 0;

  if (!struct && !type) {
    document.getElementById('refContent').innerHTML = '<p style="color:var(--text-sub);">物件情報を入力すると自動検索します。</p>';
    document.getElementById('refBadge').textContent = '0';
    return;
  }

  let matches = PERF_DB.filter(p => {
    let score = 0;
    if (struct && p.struct === struct) score += 3;
    if (type && p.type === type) score += 2;
    if (usage && p.usage === usage) score += 2;
    if (area > 0 && p.area_tsubo) {
      const diff = Math.abs(p.area_tsubo - area) / area;
      if (diff < 0.5) score += 1;
    }
    p._score = score;
    return score >= 2;
  }).sort((a,b) => b._score - a._score);

  document.getElementById('refBadge').textContent = matches.length;

  if (matches.length === 0) {
    document.getElementById('refContent').innerHTML = '<p style="color:var(--text-sub);">条件に合う類似物件が見つかりません。</p>';
    return;
  }

  // Stats
  const withArea = matches.filter(m => m.area_tsubo);
  const tsuboPrices = withArea.map(m => Math.round(m.total / m.area_tsubo));
  const profits = matches.map(m => m.profit);

  let html = '<div style="margin-bottom:16px;">';
  if (tsuboPrices.length > 0) {
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
      <div style="background:var(--accent-light);padding:12px;border-radius:8px;">
        <div style="font-size:10px;color:var(--accent);font-weight:500;">坪単価レンジ</div>
        <div style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--accent);">¥${formatNum(Math.min(...tsuboPrices))} ~ ¥${formatNum(Math.max(...tsuboPrices))}</div>
        <div style="font-size:10px;color:var(--text-sub);">平均 ¥${formatNum(Math.round(tsuboPrices.reduce((a,b)=>a+b,0)/tsuboPrices.length))}/坪</div>
      </div>
      <div style="background:var(--green-light);padding:12px;border-radius:8px;">
        <div style="font-size:10px;color:var(--green);font-weight:500;">利益率レンジ</div>
        <div style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--green);">${Math.min(...profits).toFixed(1)}% ~ ${Math.max(...profits).toFixed(1)}%</div>
        <div style="font-size:10px;color:var(--text-sub);">平均 ${(profits.reduce((a,b)=>a+b,0)/profits.length).toFixed(1)}%</div>
      </div>
      <div style="background:var(--amber-light);padding:12px;border-radius:8px;">
        <div style="font-size:10px;color:var(--amber);font-weight:500;">該当物件数</div>
        <div style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--amber);">${matches.length}件</div>
        <div style="font-size:10px;color:var(--text-sub);">面積入力済 ${withArea.length}件</div>
      </div>
    </div>`;
  }

  html += '<table><thead><tr><th>物件名</th><th>構造</th><th>新/改</th><th>用途</th><th style="text-align:right">見積合計</th><th style="text-align:right">坪単価</th><th style="text-align:right">利益率</th></tr></thead><tbody>';
  matches.forEach(m => {
    const tp = m.area_tsubo ? '¥'+formatNum(Math.round(m.total/m.area_tsubo)) : '—';
    html += `<tr><td>${m.name}</td><td>${m.struct}</td><td><span class="tag ${m.type==='新築'?'tag-blue':'tag-amber'}">${m.type}</span></td><td>${m.usage||''}</td><td class="td-right">¥${formatNum(m.total)}</td><td class="td-right">${tp}</td><td class="td-right">${m.profit}%</td></tr>`;
  });
  html += '</tbody></table></div>';

  document.getElementById('refContent').innerHTML = html;
}

// ===== VALIDATION =====
function runValidation() {
  let grandTotal = 0;
  CATEGORIES.forEach(c => { grandTotal += getCatTotal(c.id); });

  if (grandTotal === 0) {
    document.getElementById('checkContent').innerHTML = '<p style="color:var(--amber);">明細が入力されていません。</p>';
    return;
  }

  const tsubo = parseFloat(project.areaTsubo) || 0;
  const struct = project.struct;
  const type = project.type;
  
  let checks = [];

  // Tsubo price check
  if (tsubo > 0) {
    const tsuboPrice = grandTotal / tsubo;
    const similar = PERF_DB.filter(p => p.area_tsubo && p.struct === struct && p.type === type);
    if (similar.length > 0) {
      const prices = similar.map(p => p.total / p.area_tsubo);
      const avg = prices.reduce((a,b)=>a+b,0)/prices.length;
      const ratio = tsuboPrice / avg;
      const ok = ratio >= 0.7 && ratio <= 1.3;
      checks.push({
        label: '坪単価チェック',
        value: `¥${formatNum(Math.round(tsuboPrice))}/坪`,
        range: `類似物件 ¥${formatNum(Math.round(Math.min(...prices)))} ~ ¥${formatNum(Math.round(Math.max(...prices)))}（平均 ¥${formatNum(Math.round(avg))}）`,
        status: ok ? 'ok' : 'warn',
        message: ok ? '類似物件の範囲内です' : `平均と${Math.round(Math.abs(ratio-1)*100)}%の乖離があります`
      });
    }
  }

  // Profit check
  const laborRate = (project.laborRate || 72) / 100;
  const profitRate = (1 - laborRate) * 100;
  const targetProfit = type === '改修' ? 32.7 : 27.5;
  const profitOk = Math.abs(profitRate - targetProfit) < 10;
  checks.push({
    label: '利益率チェック',
    value: profitRate.toFixed(1) + '%',
    range: `${type || '全体'}平均 ${targetProfit.toFixed(1)}%`,
    status: profitOk ? 'ok' : 'warn',
    message: profitOk ? '目標範囲内です' : '利益率の調整を検討してください'
  });

  // Category balance check
  const catTotals = {};
  CATEGORIES.forEach(c => {
    const t = getCatTotal(c.id);
    if (t > 0) catTotals[c.short] = t;
  });

  let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
  checks.forEach(ch => {
    const color = ch.status === 'ok' ? 'var(--green)' : 'var(--amber)';
    const icon = ch.status === 'ok' ? '✓' : '⚠';
    html += `<div style="border:1px solid ${ch.status==='ok'?'var(--green-light)':'var(--amber-light)'};background:${ch.status==='ok'?'#f0fdf4':'#fffbeb'};border-radius:8px;padding:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="color:${color};font-size:16px;">${icon}</span>
        <span style="font-weight:600;">${ch.label}</span>
        <span style="font-family:'JetBrains Mono';font-weight:700;color:${color};margin-left:auto;">${ch.value}</span>
      </div>
      <div style="font-size:11px;color:var(--text-sub);">${ch.range}</div>
      <div style="font-size:11px;color:${color};margin-top:4px;">${ch.message}</div>
    </div>`;
  });

  // Composition
  if (Object.keys(catTotals).length > 0) {
    html += '<div style="border:1px solid var(--border);border-radius:8px;padding:14px;"><div style="font-weight:600;margin-bottom:8px;">工種別構成比</div>';
    Object.entries(catTotals).forEach(([name, total]) => {
      const pct = (total / grandTotal * 100).toFixed(1);
      html += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
        <span style="width:100px;font-size:11px;">${name}</span>
        <div style="flex:1;height:16px;background:var(--bg);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px;"></div>
        </div>
        <span style="font-family:'JetBrains Mono';font-size:11px;width:50px;text-align:right;">${pct}%</span>
        <span style="font-family:'JetBrains Mono';font-size:10px;color:var(--text-sub);width:90px;text-align:right;">¥${formatNum(Math.round(total))}</span>
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  document.getElementById('checkContent').innerHTML = html;
}

// ===== DB TABLE =====
function renderDBTable() {
  const tbody = document.getElementById('dbBody');
  tbody.innerHTML = PERF_DB.map(p => {
    const tp = p.area_tsubo ? '¥'+formatNum(Math.round(p.total/p.area_tsubo)) : '—';
    return `<tr>
      <td>${p.name}</td>
      <td>${p.struct}</td>
      <td><span class="tag ${p.type==='新築'?'tag-blue':'tag-amber'}">${p.type}</span></td>
      <td class="td-right">¥${formatNum(p.total)}</td>
      <td class="td-right">${p.profit}%</td>
      <td class="td-right">${tp}</td>
    </tr>`;
  }).join('');
}

// ===== PERSISTENCE =====
function saveToLocalStorage() {
  const data = { project, items, itemIdCounter };
  localStorage.setItem('hachitomo_estimate', JSON.stringify(data));
  showToast('保存しました');
}

function loadFromLocalStorage() {
  const raw = localStorage.getItem('hachitomo_estimate');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.project) {
      project = data.project;
      document.getElementById('pj-name').value = project.name || '';
      document.getElementById('pj-number').value = project.number || '';
      document.getElementById('pj-date').value = project.date || '';
      document.getElementById('pj-client').value = project.client || '';
      document.getElementById('pj-struct').value = project.struct || '';
      document.getElementById('pj-usage').value = project.usage || '';
      document.getElementById('pj-type').value = project.type || '';
      document.getElementById('pj-floors').value = project.floors || '';
      document.getElementById('pj-area-sqm').value = project.areaSqm || '';
      document.getElementById('pj-area-tsubo').value = project.areaTsubo || '';
      document.getElementById('pj-location').value = project.location || '';
      document.getElementById('pj-person').value = project.person || '';
      document.getElementById('pj-labor-rate').value = project.laborRate || 72;
      document.getElementById('pj-labor-sell').value = project.laborSell || 33000;
      document.getElementById('pj-tax').value = project.tax || 10;
      document.getElementById('pj-copper').value = project.copper || '';
    }
    if (data.items) {
      items = data.items;
      CATEGORIES.forEach(c => { if (!items[c.id]) items[c.id] = []; });
    }
    if (data.itemIdCounter) itemIdCounter = data.itemIdCounter;
    renderCatTabs();
    showToast('前回のデータを復元しました');
  } catch(e) {}
}

// ===== EXPORT =====
function exportEstimate() {
  if (!window.XLSX) { showToast('SheetJSが読み込まれていません'); return; }

  const wb = XLSX.utils.book_new();

  // Sheet 1: 内訳書
  const aoa = [];
  aoa.push(['八友電工　御見積書']);
  aoa.push([]);
  aoa.push(['物件名', project.name || '']);
  aoa.push(['見積番号', project.number || '', '見積日', project.date || '']);
  aoa.push(['得意先', project.client || '', '担当者', project.person || '']);
  aoa.push(['構造', project.struct || '', '用途/種別', [project.usage, project.type].filter(Boolean).join(' ')]);
  aoa.push([]);
  aoa.push(['工事内訳', '数量', '単位', '見積金額（税抜）', '備考']);

  let grandTotal = 0;
  CATEGORIES.forEach(c => {
    const total = getCatTotal(c.id);
    if (total === 0 && c.id !== 'discount') return;
    grandTotal += total;
    aoa.push([c.name, 1, '式', Math.round(total), '']);
  });
  aoa.push([]);
  aoa.push(['合　計', '', '', Math.round(grandTotal), '']);

  const tax = (project.tax || 10) / 100;
  aoa.push(['消費税（' + (project.tax || 10) + '%）', '', '', Math.round(grandTotal * tax), '']);
  aoa.push(['税込合計', '', '', Math.round(grandTotal * (1 + tax)), '']);

  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  ws1['!cols'] = [{wch:35},{wch:6},{wch:6},{wch:15},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws1, '内訳書');

  // Sheet per category
  CATEGORIES.forEach(c => {
    const list = (items[c.id] || []).filter(i => i.name);
    if (list.length === 0) return;

    const rows = [[c.name], [], ['品名', '規格', '数量', '単位', '見積単価', '見積金額', '備考']];
    list.forEach(item => {
      rows.push([
        item.name || '', item.spec || '',
        item.qty !== '' ? parseFloat(item.qty) || '' : '',
        item.unit || '',
        item.price !== '' ? parseFloat(item.price) || '' : '',
        item.amount ? Math.round(item.amount) : '',
        item.note || ''
      ]);
    });
    rows.push([]);
    rows.push(['', '', '', '', '小計', Math.round(getCatTotal(c.id)), '']);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:25},{wch:18},{wch:6},{wch:6},{wch:10},{wch:12},{wch:15}];
    XLSX.utils.book_append_sheet(wb, ws, c.short);
  });

  const safeName = (project.name || '新規').replace(/[\/\\:*?"<>|]/g, '');
  XLSX.writeFile(wb, '見積書_' + safeName + '_' + (project.date || '') + '.xlsx');
  showToast('Excel出力完了');
}

// ===== UTILS =====
function formatNum(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function esc(s) { return (s||'').replace(/"/g, '&quot;'); }
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}