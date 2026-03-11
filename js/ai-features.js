// ===== AI設定 =====
const ANTHROPIC_KEY_STORAGE = 'anthropic_api_key';

function getApiKey() {
  return localStorage.getItem(ANTHROPIC_KEY_STORAGE) || '';
}

function openApiSettings() {
  const current = getApiKey();
  const el = document.getElementById('apiKeyDisplay');
  if (el) el.textContent = current
    ? current.slice(0, 10) + '...' + current.slice(-4)
    : '未設定';
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('apiSettingsModal').classList.add('show');
}

function saveApiKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val.startsWith('sk-')) {
    showToast('有効なAPIキーを入力してください（sk- で始まる文字列）');
    return;
  }
  localStorage.setItem(ANTHROPIC_KEY_STORAGE, val);
  document.getElementById('apiSettingsModal').classList.remove('show');
  showToast('APIキーを保存しました');
}

function clearApiKey() {
  if (!confirm('保存済みのAPIキーを削除しますか？')) return;
  localStorage.removeItem(ANTHROPIC_KEY_STORAGE);
  document.getElementById('apiSettingsModal').classList.remove('show');
  showToast('APIキーを削除しました');
}

// --- Claude API 呼び出し ---
async function callClaude(prompt, maxTokens = 4096) {
  const apiKey = getApiKey();
  if (!apiKey) {
    openApiSettings();
    throw new Error('APIキーが設定されていません。設定後に再度お試しください。');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `APIエラー (${res.status})`;
    if (res.status === 401) throw new Error('APIキーが無効です。設定を確認してください。');
    throw new Error(msg);
  }

  const data = await res.json();
  return data.content[0].text;
}

// ===== AI たたき台作成 =====
async function aiDraftEstimate() {
  if (!koshuTridgeLoaded && activeCategories.length === 0) {
    showToast('先にトリッジを装着してください');
    return;
  }
  if (!project.struct && !project.type) {
    showToast('構造・種別を入力してください');
    return;
  }

  const btn = document.getElementById('aiDraftBtn');
  const origHtml = btn.innerHTML;
  btn.innerHTML = '⏳ AI生成中...';
  btn.disabled = true;

  try {
    // ナレッジDBから類似物件を取得（上位3件、明細付きのみ）
    const area = parseFloat(project.areaTsubo) || 0;
    let similar = [];
    try {
      const candidates = await knowledgeDB.searchSimilar({
        struct: project.struct,
        type: project.type,
        usage: project.usage,
        areaTsubo: area,
      });
      similar = candidates
        .filter(r => r.categories && r.categories.some(c => c.items && c.items.length > 0))
        .slice(0, 3);
    } catch (e) { /* DBなしでも続行 */ }

    const prompt = _buildAiDraftPrompt(similar, area);
    const responseText = await callClaude(prompt);

    // JSON抽出
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIの回答からJSONを取り出せませんでした');
    const draft = JSON.parse(jsonMatch[0]);
    if (!draft.categories || !Array.isArray(draft.categories)) throw new Error('不正なフォーマットです');

    _showAiDraftPreview(draft, similar.length);

  } catch (e) {
    showToast('AI生成エラー: ' + e.message);
  } finally {
    btn.innerHTML = origHtml;
    btn.disabled = false;
  }
}

function _buildAiDraftPrompt(similar, targetArea) {
  const catNames = activeCategories
    .filter(c => c.active && !c.rateMode)
    .map(c => c.name)
    .join('・');

  let pastSection = '';
  if (similar.length > 0) {
    pastSection = '\n【過去の類似物件】\n';
    similar.forEach((rec, i) => {
      const p = rec.project;
      const recArea = parseFloat(p.areaTsubo) || 0;
      const ratio = (targetArea > 0 && recArea > 0) ? (targetArea / recArea).toFixed(2) : '—';
      pastSection += `\n物件${i + 1}: ${p.name}（${p.struct}/${p.type}/${p.usage || '—'}/${recArea ? recArea + '坪' : '面積不明'}）合計¥${rec.grandTotal.toLocaleString()} ※面積比${ratio}倍\n`;
      rec.categories.forEach(cat => {
        if (!cat.items || cat.items.length === 0) return;
        pastSection += `[${cat.name}]\n`;
        cat.items.slice(0, 25).forEach(item => {
          if (AUTO_NAMES.includes(item.name)) return;
          pastSection += `  ${item.name}  ${item.spec || ''}  ${item.qty}${item.unit}  ¥${item.price}\n`;
        });
      });
    });
  } else {
    pastSection = '\n【過去の類似物件】\nナレッジDBに類似物件が登録されていないため、電気工事の一般的な知識に基づいて作成してください。\n';
  }

  const areaNote = targetArea > 0 ? `${targetArea}坪` : '未入力';

  return `あなたは電気工事会社の熟練見積担当者です。以下の物件情報と過去実績をもとに、見積のたたき台をJSON形式で作成してください。

【新規物件情報】
- 工事名: ${project.name || '未入力'}
- 得意先: ${project.client || '未入力'}
- 構造: ${project.struct || '未入力'}
- 種別: ${project.type || '未入力'}
- 用途: ${project.usage || '未入力'}
- 延床面積: ${areaNote}
- 施工場所: ${project.location || '未入力'}
${project.memo ? '- 工事概要・メモ: ' + project.memo + '\n' : ''}${pastSection}
【使用できる工種】（必ずこの一覧から選ぶこと）
${catNames}

【出力形式】JSONのみで回答してください（前後の説明文は不要）:
{
  "comment": "見積作成の根拠と注意点を1〜2文で",
  "categories": [
    {
      "name": "工種名（上記一覧から選ぶ）",
      "items": [
        {"name": "品目名", "spec": "規格・型番", "qty": 数値, "unit": "単位", "price": 単価数値}
      ]
    }
  ]
}

【注意事項】
- 工種名は必ず上記「使用できる工種」の中から選ぶこと
- qty・price は整数の数値型（文字列不可）
- 雑材料費・労務費・諸経費・小計 等の自動計算行は含めない（システムが自動追加する）
- 実際の電気工事に使用する材料・機器のみ列挙する
- 過去データがある場合は面積比を考慮して数量を調整する`;
}

function _showAiDraftPreview(draft, similarCount) {
  const body = document.getElementById('aiDraftBody');
  body._draft = draft;

  let html = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1e40af;">
    <strong>AI コメント:</strong> ${draft.comment || ''}
    <div style="font-size:11px;color:#3b82f6;margin-top:4px;">
      ${similarCount > 0 ? `ナレッジDBの類似物件 ${similarCount}件を参照して生成` : 'ナレッジDBに類似物件がないため一般知識から生成（実績が蓄積されると精度が向上します）'}
    </div>
  </div>`;

  let totalAmount = 0;
  (draft.categories || []).forEach(cat => {
    const catTotal = (cat.items || []).reduce((s, i) => s + ((i.qty || 0) * (i.price || 0)), 0);
    totalAmount += catTotal;
    html += `<div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-weight:600;font-size:13px;padding:6px 10px;background:#f0f4ff;border-radius:6px 6px 0 0;border:1px solid #dbeafe;border-bottom:none;">
        <span>${cat.name}</span>
        <span style="font-family:'JetBrains Mono';">¥${catTotal.toLocaleString()}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #dbeafe;font-size:12px;">
        <thead><tr style="background:#f8fafc;color:#64748b;">
          <th style="padding:5px 8px;text-align:left;font-weight:500;border-bottom:1px solid #e2e8f0;">品目</th>
          <th style="padding:5px 8px;text-align:left;font-weight:500;border-bottom:1px solid #e2e8f0;">規格</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">数量</th>
          <th style="padding:5px 8px;text-align:left;font-weight:500;border-bottom:1px solid #e2e8f0;">単位</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">単価</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">金額</th>
        </tr></thead>
        <tbody>`;
    (cat.items || []).forEach(item => {
      const amount = (item.qty || 0) * (item.price || 0);
      html += `<tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:4px 8px;">${item.name}</td>
        <td style="padding:4px 8px;color:#666;">${item.spec || ''}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';">${item.qty}</td>
        <td style="padding:4px 8px;">${item.unit || ''}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';">${(item.price || 0).toLocaleString()}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';">${amount.toLocaleString()}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });

  html += `<div style="text-align:right;padding:10px 8px 4px;font-size:14px;font-weight:700;color:var(--accent);border-top:2px solid #e2e8f0;">
    材料合計（自動計算行除く）: ¥${totalAmount.toLocaleString()}
  </div>`;

  body.innerHTML = html;
  body._draft = draft;  // innerHTML代入後も保持
  document.getElementById('aiDraftModal').classList.add('show');
}

function applyAiDraft() {
  const draft = document.getElementById('aiDraftBody')._draft;
  if (!draft) { showToast('データがありません'); return; }

  saveUndoState();
  let addedItems = 0;

  let skippedCats = [];
  (draft.categories || []).forEach(cat => {
    // 工種名で照合（完全一致→部分一致→正規化部分一致の順）
    const targetCat = activeCategories.find(c =>
      c.active && (c.name === cat.name || c.name.includes(cat.name) || cat.name.includes(c.name))
    ) || activeCategories.find(c =>
      c.active && (norm(c.name).includes(norm(cat.name)) || norm(cat.name).includes(norm(c.name)))
    );
    if (!targetCat) { skippedCats.push(cat.name); return; }

    if (!items[targetCat.id]) items[targetCat.id] = [];
    const existing = items[targetCat.id].filter(i => i.name);
    if (existing.length > 0) {
      if (!confirm(`「${targetCat.name}」には既に${existing.length}件の品目があります。上書きしますか？\n（キャンセルでこの工種をスキップ）`)) return;
      items[targetCat.id] = [];
    }

    (cat.items || []).forEach(item => {
      const qty   = parseFloat(item.qty)   || 0;
      const price = parseFloat(item.price) || 0;
      items[targetCat.id].push({
        id:       itemIdCounter++,
        name:     item.name  || '',
        spec:     item.spec  || '',
        qty,
        unit:     item.unit  || '',
        price,
        amount:   qty * price,
        bukariki: '',
        note:     '',
      });
      addedItems++;
    });
  });

  document.getElementById('aiDraftModal').classList.remove('show');

  if (addedItems === 0) {
    const msg = skippedCats.length > 0
      ? `工種名が一致しませんでした: ${skippedCats.join('、')}\n装着中のトリッジの工種名を確認してください。`
      : 'AIの提案に品目がありませんでした。';
    showToast(msg);
    return;
  }

  const firstCat = activeCategories.find(
    c => c.active && !c.rateMode && items[c.id] && items[c.id].filter(i => i.name).length > 0
  );
  if (firstCat) currentCat = firstCat.id;

  navigate('items');
  renderCatTabs();
  renderItems();
  updateSummaryBar();
  showToast(`${addedItems}品目をAIたたき台として投入しました${skippedCats.length > 0 ? `（未一致工種: ${skippedCats.join('、')}）` : ''}`);
}

// ===== 仕入れ見積インポート =====

function openSupplierImportModal() {
  const sel = document.getElementById('supplierTargetCat');
  sel.innerHTML = '<option value="">-- 工種を選択 --</option>' +
    activeCategories
      .filter(c => c.active && !c.rateMode)
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join('');

  document.getElementById('supplierFileInput').value = '';
  document.getElementById('supplierNameSpan').textContent = '';
  document.getElementById('supplierTotalSpan').textContent = '';
  document.getElementById('supplierPreviewArea').innerHTML =
    '<p style="color:#aaa;text-align:center;padding:40px;">ファイルを選択するとAIが自動解析してプレビューを表示します</p>';
  document.getElementById('supplierImportModal')._result = null;
  document.getElementById('supplierImportModal').classList.add('show');
}

async function parseSupplierFile(file) {
  const area = document.getElementById('supplierPreviewArea');
  area.innerHTML = '<p style="text-align:center;padding:40px;color:#6366f1;">⏳ AI解析中... しばらくお待ちください</p>';

  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    let csvText = '';

    wb.SheetNames.forEach(sheetName => {
      const ws   = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      csvText += `\n[シート: ${sheetName}]\n`;
      rows.slice(0, 120).forEach(row => {
        const line = row.map(c => String(c).replace(/\r\n|\n/g, '/')).join('\t');
        if (line.trim()) csvText += line + '\n';
      });
    });

    const responseText = await callClaude(_buildSupplierParsePrompt(csvText, file.name), 8192);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIの回答からJSONを取り出せませんでした');
    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (jsonErr) {
      throw new Error('AIの回答が長すぎてJSONが途中で切れました。ファイルの品目数を減らすか、不要行を削除してから再試行してください。');
    }
    if (!Array.isArray(result.items)) throw new Error('品目データが取得できませんでした');

    document.getElementById('supplierImportModal')._result = result;
    _renderSupplierPreview(result);

  } catch (e) {
    area.innerHTML = `<p style="color:#c00;text-align:center;padding:32px;">エラー: ${e.message}</p>`;
  }
}

function _buildSupplierParsePrompt(csvText, filename) {
  return `あなたは電気工事会社の積算担当者です。以下は仕入れ業者から届いた見積書（Excel）のデータです。品目情報を抽出してJSONで返してください。

ファイル名: ${filename}

【見積書データ（タブ区切り）】
${csvText}

以下のJSON形式のみで回答してください（前後の説明文不要）:
{
  "supplier": "仕入れ業者名",
  "totalAmount": 総合計金額の数値（不明または0なら0）,
  "items": [
    {
      "symbol": "記号（F1/A5等。なければ空文字）",
      "name": "品名（商品名のみ。型番は含めない）",
      "partNo": "品番・型番",
      "maker": "メーカー名",
      "qty": 数量の数値,
      "unit": "単位（台/個/m/式等。不明は台）",
      "listPrice": 定価の数値（オープン価格・不明は0）,
      "costPrice": 仕入れ単価の数値（実際の請求単価）,
      "amount": 金額の数値
    }
  ]
}

【注意事項】
- 合計行・小計行・送料・フィッティング費用等の役務行は除外
- 数値はカンマなしの整数（文字列不可）
- 定価が「オープン」「OP」の場合は listPrice=0
- セル内改行は / で区切られている: 「品番/品名」の形式に注意
- qty・listPrice・costPrice・amount は数値型`;
}

function _renderSupplierPreview(result) {
  const area = document.getElementById('supplierPreviewArea');
  document.getElementById('supplierNameSpan').textContent = result.supplier || '（業者名不明）';
  document.getElementById('supplierTotalSpan').textContent =
    result.totalAmount > 0 ? `¥${result.totalAmount.toLocaleString()}` : '—';

  const rate = parseFloat(document.getElementById('supplierSellRate').value) || 70;

  const rows = (result.items || []).map((item, idx) => {
    const sellPrice = item.listPrice > 0
      ? Math.round(item.listPrice * rate / 100)
      : item.costPrice;
    const rowAmt = sellPrice * (item.qty || 1);
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:5px 6px;text-align:center;">
        <input type="checkbox" class="supplier-chk" data-idx="${idx}" checked>
      </td>
      <td style="padding:5px 6px;font-size:11px;color:#888;">${item.symbol || ''}</td>
      <td style="padding:5px 6px;">
        ${item.name}
        <div style="font-size:10px;color:#999;">${item.partNo || ''}</div>
      </td>
      <td style="padding:5px 6px;font-size:11px;color:#666;">${item.maker || ''}</td>
      <td style="padding:5px 6px;text-align:right;font-family:'JetBrains Mono';">${item.qty}</td>
      <td style="padding:5px 6px;">${item.unit || '台'}</td>
      <td style="padding:5px 6px;text-align:right;font-family:'JetBrains Mono';color:#888;">
        ${item.listPrice > 0 ? '¥' + item.listPrice.toLocaleString() : '<span style="color:#bbb;">OP</span>'}
      </td>
      <td style="padding:5px 6px;text-align:right;font-family:'JetBrains Mono';color:#1e40af;font-weight:600;">
        ¥${sellPrice.toLocaleString()}
      </td>
      <td style="padding:5px 6px;text-align:right;font-family:'JetBrains Mono';">
        ${rowAmt > 0 ? '¥' + rowAmt.toLocaleString() : '—'}
      </td>
    </tr>`;
  }).join('');

  area.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="border-bottom:2px solid #ddd;background:#f8fafc;">
        <th style="padding:6px;width:28px;">
          <input type="checkbox" checked onchange="document.querySelectorAll('.supplier-chk').forEach(c=>c.checked=this.checked)">
        </th>
        <th style="padding:6px;text-align:left;width:32px;">記号</th>
        <th style="padding:6px;text-align:left;">品名 / 型番</th>
        <th style="padding:6px;text-align:left;">メーカー</th>
        <th style="padding:6px;text-align:right;">数量</th>
        <th style="padding:6px;">単位</th>
        <th style="padding:6px;text-align:right;">定価</th>
        <th style="padding:6px;text-align:right;">見積単価</th>
        <th style="padding:6px;text-align:right;">金額</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function recalcSupplierPreview() {
  const result = document.getElementById('supplierImportModal')._result;
  if (result) _renderSupplierPreview(result);
}

function applySupplierImport() {
  const modal  = document.getElementById('supplierImportModal');
  const result = modal._result;
  if (!result || !result.items) { showToast('先にファイルを読み込んでください'); return; }

  const catId = document.getElementById('supplierTargetCat').value;
  if (!catId) { showToast('取り込み先の工種を選択してください'); return; }

  const rate    = parseFloat(document.getElementById('supplierSellRate').value) || 70;
  const checked = Array.from(document.querySelectorAll('.supplier-chk:checked'))
    .map(el => parseInt(el.dataset.idx));
  if (checked.length === 0) { showToast('取り込む品目にチェックを入れてください'); return; }

  saveUndoState();
  if (!items[catId]) items[catId] = [];

  let added = 0;
  checked.forEach(idx => {
    const item = result.items[idx];
    if (!item) return;

    const sellPrice = item.listPrice > 0
      ? Math.round(item.listPrice * rate / 100)
      : item.costPrice;

    const noteStr = item.listPrice > 0
      ? `定価¥${item.listPrice.toLocaleString()}（仕入¥${item.costPrice.toLocaleString()}）`
      : `仕入¥${item.costPrice.toLocaleString()}`;

    items[catId].push({
      id:       itemIdCounter++,
      name:     (item.symbol ? `[${item.symbol}]` : '') + item.name,
      spec:     item.partNo  || '',
      qty:      item.qty     || 1,
      unit:     item.unit    || '台',
      price:    sellPrice,
      amount:   sellPrice * (item.qty || 1),
      bukariki: '',
      note:     noteStr,
    });
    added++;
  });

  currentCat = catId;
  modal.classList.remove('show');
  renderCatTabs();
  renderItems();
  updateSummaryBar();
  const catName = activeCategories.find(c => c.id === catId)?.name || '';
  showToast(`${added}品目を「${catName}」に取り込みました`);
}

// ===== AI単価・仕様調査 =====

async function aiQueryItem(itemId) {
  const list = items[currentCat];
  const item = list && list.find(i => i.id === itemId);
  if (!item || !item.name) { showToast('品名を入力してからAI調査してください'); return; }

  // ボタンをローディング状態に
  const btn = document.getElementById(`aiQueryBtn-${itemId}`);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  try {
    const prompt = _buildItemQueryPrompt(item.name, item.spec || '');
    const responseText = await callClaude(prompt);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIの回答を解析できませんでした');
    const result = JSON.parse(jsonMatch[0]);

    _showItemQueryResult(itemId, item, result);
  } catch (e) {
    showToast('AI調査エラー: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '✨'; btn.disabled = false; }
  }
}

function _buildItemQueryPrompt(name, spec) {
  return `あなたは電気工事資材・設備機器の専門家です。以下の品目について詳しく調査してください。

品名: ${name}
規格・型番: ${spec || '（未入力）'}

以下のJSON形式のみで回答してください（前後の説明文は不要）:
{
  "maker": "代表的なメーカー名（複数ある場合はカンマ区切り）",
  "partNo": "標準的な品番・型番（わからない場合は空文字）",
  "listPrice": 標準定価の数値（円、メーカー希望小売価格。不明な場合は0）,
  "unit": "単価の単位（m/個/台/組/式等）",
  "spec": "定格・仕様・主要スペック（電圧/容量/寸法/色温度等）を簡潔に",
  "usage": "主な用途・適用場所",
  "alternatives": "代替品・類似品の品名（あれば）",
  "note": "見積上の注意点・補足（なければ空文字）"
}

注意事項:
- listPrice は整数の数値型（文字列不可）
- 電気工事で実際に使用される材料・機器の情報を優先する
- 不明な項目は空文字または0にする（推測で記入しない）`;
}

function _showItemQueryResult(itemId, item, result) {
  const modal = document.getElementById('itemQueryModal');
  const body  = document.getElementById('itemQueryBody');

  // モーダルにitemIdを記憶
  modal._itemId = itemId;
  modal._result = result;

  const listPriceStr = result.listPrice > 0
    ? `¥${result.listPrice.toLocaleString()} / ${result.unit || '—'}`
    : '不明';

  body.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;color:#888;margin-bottom:4px;">調査対象</div>
      <div style="font-weight:600;font-size:14px;">${item.name}${item.spec ? '　<span style="font-weight:400;color:#666;font-size:13px;">' + item.spec + '</span>' : ''}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${_qRow('メーカー', result.maker || '不明')}
      ${_qRow('品番・型番', result.partNo || '不明')}
      ${_qRow('標準定価', `<strong style="color:${result.listPrice > 0 ? '#1e40af' : '#999'};">${listPriceStr}</strong>`)}
      ${_qRow('仕様・スペック', result.spec || '—')}
      ${_qRow('用途', result.usage || '—')}
      ${result.alternatives ? _qRow('代替品', result.alternatives) : ''}
      ${result.note ? _qRow('注意・補足', `<span style="color:#c0392b;">${result.note}</span>`) : ''}
    </table>

    ${result.listPrice > 0 ? `
    <div style="margin-top:16px;padding:12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
      <div style="font-size:12px;color:#1e40af;margin-bottom:8px;font-weight:500;">単価に反映する</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button onclick="applyItemQueryPrice(${itemId}, ${result.listPrice}, 'note')"
          style="padding:7px 14px;font-size:12px;cursor:pointer;background:#fff;border:1px solid #93c5fd;border-radius:6px;color:#1e40af;">
          備考欄に定価を記録
        </button>
        <button onclick="applyItemQueryPrice(${itemId}, ${result.listPrice}, 'price')"
          style="padding:7px 14px;font-size:12px;cursor:pointer;background:#3b82f6;border:none;border-radius:6px;color:#fff;font-weight:600;">
          単価として反映（上書き）
        </button>
      </div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;">「備考欄に定価を記録」は現在の単価はそのままで定価をメモします</div>
    </div>` : ''}`;

  modal.classList.add('show');
}

function _qRow(label, value) {
  return `<tr style="border-bottom:1px solid #f1f5f9;">
    <td style="padding:8px 10px;color:#64748b;font-size:12px;white-space:nowrap;width:110px;">${label}</td>
    <td style="padding:8px 10px;">${value}</td>
  </tr>`;
}

function applyItemQueryPrice(itemId, listPrice, mode) {
  const list = items[currentCat];
  const item = list && list.find(i => i.id === itemId);
  if (!item) return;

  saveUndoState();
  if (mode === 'price') {
    item.price  = listPrice;
    item.amount = (parseFloat(item.qty) || 0) * listPrice;
    showToast(`単価を ¥${listPrice.toLocaleString()} に反映しました`);
  } else {
    item.note = `定価¥${listPrice.toLocaleString()}`;
    showToast(`備考欄に定価 ¥${listPrice.toLocaleString()} を記録しました`);
  }

  document.getElementById('itemQueryModal').classList.remove('show');
  renderItems();
  renderCatTabs();
}

// ===== 掛率チェック =====

async function checkSellRates() {
  if (!project.client) {
    showToast('得意先を入力してからチェックしてください');
    return;
  }

  let history;
  try {
    history = await knowledgeDB.getClientItemHistory(project.client);
  } catch (e) {
    showToast('ナレッジDB読み込みエラー: ' + e.message);
    return;
  }

  const alerts = [];
  activeCategories.forEach(cat => {
    (items[cat.id] || []).forEach(item => {
      const price = parseFloat(item.price);
      if (!item.name || !(price > 0)) return;
      const key  = normItemKey(item.name, item.spec);
      const past = history[key];
      if (!past || past.length === 0) return;

      const avgPrice = past.reduce((s, r) => s + r.price, 0) / past.length;
      const diff = (price - avgPrice) / avgPrice;
      if (Math.abs(diff) >= 0.05) {
        alerts.push({
          catName:     cat.name,
          name:        item.name,
          spec:        item.spec || '',
          currentPrice: price,
          avgPrice:    Math.round(avgPrice),
          diff,
          pastCount:   past.length,
          lastProject: past[past.length - 1].projectName,
        });
      }
    });
  });

  _renderSellRateCheck(alerts);
  document.getElementById('sellRateCheckModal').classList.add('show');
}

function _renderSellRateCheck(alerts) {
  const body = document.getElementById('sellRateCheckBody');
  if (alerts.length === 0) {
    body.innerHTML = '<p style="text-align:center;padding:40px;color:#27ae60;font-size:14px;">⭕ 過去単価との大きな乖離は検出されませんでした</p>';
    return;
  }
  const rows = alerts.map(a => {
    const pct   = (a.diff * 100).toFixed(1);
    const color = a.diff > 0 ? '#c0392b' : '#2471a3';
    const sign  = a.diff > 0 ? '▲' : '▼';
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:7px 10px;font-size:12px;color:#666;">${a.catName}</td>
      <td style="padding:7px 10px;">${a.name}${a.spec ? '<br><small style="color:#888;">' + a.spec + '</small>' : ''}</td>
      <td style="padding:7px 10px;text-align:right;">${a.currentPrice.toLocaleString()}</td>
      <td style="padding:7px 10px;text-align:right;color:#555;">${a.avgPrice.toLocaleString()}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:bold;color:${color};">${sign}${Math.abs(pct)}%</td>
      <td style="padding:7px 10px;font-size:11px;color:#888;">${a.pastCount}件 / ${a.lastProject}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <p style="margin:0 0 12px;font-size:13px;color:#555;">
      得意先「${project.client}」の過去見積と <strong>5%以上</strong> 乖離している品目:
      <strong style="color:#c0392b;">${alerts.length}件</strong>
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:2px solid #ddd;background:#f5f5f5;">
        <th style="padding:7px 10px;text-align:left;">工種</th>
        <th style="padding:7px 10px;text-align:left;">品目</th>
        <th style="padding:7px 10px;text-align:right;">現在単価</th>
        <th style="padding:7px 10px;text-align:right;">過去平均</th>
        <th style="padding:7px 10px;text-align:right;">差異</th>
        <th style="padding:7px 10px;text-align:left;">参照</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
