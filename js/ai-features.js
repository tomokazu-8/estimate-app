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

// ===== AI AI提案作成 =====
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

  // 全画面ローディングオーバーレイを表示
  _showAiLoadingOverlay();

  try {
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
    const responseText = await callClaude(prompt, 8192);

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
    _hideAiLoadingOverlay();
  }
}

// AI処理中のローディングオーバーレイ
function _showAiLoadingOverlay() {
  let overlay = document.getElementById('aiLoadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'aiLoadingOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:40px 48px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:400px;">
        <div style="font-size:36px;margin-bottom:16px;animation:spin 2s linear infinite;">⚙️</div>
        <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:8px;">AI提案を生成中...</div>
        <div style="font-size:13px;color:#64748b;line-height:1.6;">Claude AIが見積の品目を提案しています。<br>通常 <b>30秒〜1分</b> ほどかかります。<br>しばらくお待ちください。</div>
      </div>
      <style>@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }</style>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
}

function _hideAiLoadingOverlay() {
  const overlay = document.getElementById('aiLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
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
          if (isAutoName(item.name)) return;
          pastSection += `  ${item.name}  ${item.spec || ''}  ${item.qty}${item.unit}  ¥${item.price}\n`;
        });
      });
    });
  } else {
    pastSection = '\n【過去の類似物件】\nナレッジDBに類似物件が登録されていないため、電気工事の一般的な知識に基づいて作成してください。\n';
  }

  const areaNote = targetArea > 0 ? `${targetArea}坪` : '未入力';

  // BUKARIKI_DBから代表的な歩掛をサンプルとしてプロンプトに渡す
  const bukSamples = BUKARIKI_DB.length > 0
    ? BUKARIKI_DB.slice(0, 30).map(b => `  ${b.n}${b.s ? ' ' + b.s : ''}: ${b.b}`).join('\n')
    : '  ケーブル類（m）: 0.04〜0.08\n  電線管（m）: 0.03〜0.05\n  コンセント・スイッチ（個）: 0.12〜0.15\n  照明器具（台）: 0.25〜0.40\n  分電盤（面）: 1.5〜2.0';

  return `あなたは電気工事会社の熟練見積担当者です。以下の物件情報と過去実績をもとに、見積のAI提案をJSON形式で作成してください。

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

【労務単価】
- 電工 見積単価: ¥${LABOR_RATES.sell.toLocaleString()}/人工
- 電工 原価単価: ¥${LABOR_RATES.cost.toLocaleString()}/人工

【歩掛の参考値（1単位あたりの取付人工数）】
${bukSamples}

【出力形式】JSONのみで回答してください（前後の説明文は不要）:
{
  "comment": "見積作成の根拠と注意点を1〜2文で",
  "categories": [
    {
      "name": "工種名（上記一覧から選ぶ）",
      "items": [
        {"name": "品目名", "spec": "規格・型番", "qty": 数値, "unit": "単位", "price": 単価数値, "bukariki": 歩掛数値}
      ]
    }
  ]
}

【注意事項】
- 工種名は必ず上記「使用できる工種」の中から選ぶこと（完全一致で使うこと、略称や別名は不可）
- qty・price・bukariki は数値型（文字列不可）
- bukariki は1単位あたりの取付人工数（電工労務費の算出根拠）。不明な品目は 0
- 雑材料費・電工労務費・運搬費・諸経費・小計 等の自動計算行は含めない（システムが自動追加する）
- 実際の電気工事に使用する材料・機器のみ列挙する（電線・ケーブル・幹線・配管・プルボックス・分電盤・照明器具・コンセント・スイッチ・電気機器等を適切に含めること）
- ケーブル・電線類（IV線・CV線・VVF・幹線ケーブル等）は電気工事に不可欠なため、必ず該当する工種の品目に含めること
- 過去データがある場合は面積比を考慮して数量を調整する
- 工事概要・メモに記載された内容（工事の範囲・特記事項・使用機器の指定等）を最優先で反映すること`;
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
  let totalKosu = 0;
  (draft.categories || []).forEach(cat => {
    const catTotal = (cat.items || []).reduce((s, i) => s + ((i.qty || 0) * (i.price || 0)), 0);
    // 歩掛合計（AI提案値→DBフォールバック）
    const catKosu = (cat.items || []).reduce((s, i) => {
      const qty = parseFloat(i.qty) || 0;
      const bukE = (parseFloat(i.bukariki) || 0) > 0 ? i.bukariki : '';
      return s + qty * resolveBukariki(i.name, i.spec, bukE).value;
    }, 0);
    totalAmount += catTotal;
    totalKosu += catKosu;
    const laborSell = Math.round(catKosu * LABOR_RATES.sell);
    html += `<div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px;padding:6px 10px;background:#f0f4ff;border-radius:6px 6px 0 0;border:1px solid #dbeafe;border-bottom:none;">
        <span>${cat.name}</span>
        <span style="display:flex;gap:16px;align-items:center;">
          ${catKosu > 0 ? `<span style="font-size:11px;font-weight:400;color:#6366f1;">電工 ${catKosu.toFixed(2)}人工 → ¥${laborSell.toLocaleString()}</span>` : ''}
          <span style="font-family:'JetBrains Mono';">¥${catTotal.toLocaleString()}</span>
        </span>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #dbeafe;font-size:12px;">
        <thead><tr style="background:#f8fafc;color:#64748b;">
          <th style="padding:5px 8px;text-align:left;font-weight:500;border-bottom:1px solid #e2e8f0;">品目</th>
          <th style="padding:5px 8px;text-align:left;font-weight:500;border-bottom:1px solid #e2e8f0;">規格</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">数量</th>
          <th style="padding:5px 8px;text-align:left;font-weight:500;border-bottom:1px solid #e2e8f0;">単位</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">単価</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">金額</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">歩掛</th>
          <th style="padding:5px 8px;text-align:right;font-weight:500;border-bottom:1px solid #e2e8f0;">人工数</th>
        </tr></thead>
        <tbody>`;
    (cat.items || []).forEach(item => {
      const qty    = parseFloat(item.qty)   || 0;
      const price  = parseFloat(item.price) || 0;
      const amount = qty * price;
      const bukE   = (parseFloat(item.bukariki) || 0) > 0 ? item.bukariki : '';
      const buk    = resolveBukariki(item.name, item.spec, bukE);
      const kosu   = qty * buk.value;
      const bukSource = buk.source !== '手入力' && buk.value > 0 ? ' style="color:#6366f1;" title="DB補完"' : '';
      html += `<tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:4px 8px;">${esc(item.name)}</td>
        <td style="padding:4px 8px;color:#666;">${esc(item.spec || '')}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';">${qty}</td>
        <td style="padding:4px 8px;">${esc(item.unit || '')}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';">${price.toLocaleString()}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';">${amount.toLocaleString()}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';"${bukSource}>${buk.value > 0 ? buk.value.toFixed(3) : '<span style="color:#ccc;">―</span>'}</td>
        <td style="padding:4px 8px;text-align:right;font-family:'JetBrains Mono';color:#6366f1;">${kosu > 0 ? kosu.toFixed(3) : ''}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });

  const totalLaborSell = Math.round(totalKosu * LABOR_RATES.sell);
  html += `<div style="text-align:right;padding:10px 8px 4px;font-size:13px;border-top:2px solid #e2e8f0;display:flex;justify-content:flex-end;gap:32px;">
    <span style="color:#6366f1;font-weight:600;">電工労務費（推計）: <span style="font-family:'JetBrains Mono';">${totalKosu.toFixed(2)}人工 → ¥${totalLaborSell.toLocaleString()}</span></span>
    <span style="font-weight:700;color:var(--accent);">材料合計: <span style="font-family:'JetBrains Mono';">¥${totalAmount.toLocaleString()}</span></span>
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
      // 歩掛: AI提案値(>0)を優先、なければDBから補完
      const bukExplicit = (parseFloat(item.bukariki) || 0) > 0 ? item.bukariki : '';
      const buk = resolveBukariki(item.name, item.spec, bukExplicit);
      // 単位: AI提案値を優先、なければDBから補完、UNITS正規化
      let unit = item.unit || '';
      if (!unit || unit === '式') {
        const nName = norm(item.name || '');
        const dbMatch = MATERIAL_DB.find(m => norm(m.n) === nName)
          || MATERIAL_DB.find(m => nName.includes(norm(m.n)) && norm(m.n).length >= 3);
        if (dbMatch && dbMatch.u) unit = dbMatch.u;
      }
      unit = typeof _normalizeUnit === 'function' ? _normalizeUnit(unit) : unit;
      items[targetCat.id].push(createBlankItem({
        name: item.name || '', spec: item.spec || '',
        qty, unit: unit || '式', price, amount: qty * price,
        bukariki1: buk.value > 0 ? buk.value : '',
      }));
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
  console.log('[AI Draft] Applied:', addedItems, 'items, currentCat:', currentCat, 'skipped:', skippedCats);

  // navigate('items') 内部で renderCatTabs() + renderItems() が呼ばれる
  navigate('items');
  updateSummaryBar();
  showToast(`${addedItems}品目をAIAI提案として投入しました${skippedCats.length > 0 ? `（未一致工種: ${skippedCats.join('、')}）` : ''}`);
}

// （仕入れ見積インポートはtridge-manager.jsに統合済み）
// （AI単価調査・掛率チェックは廃止済み — Tridgeマスタの市場価格連動で代替）


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
