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

// ===== AI提案作成 =====

/**
 * MATERIAL_DBから品名+規格で検索。
 * 仕入れデータ（_source:'supplier'）を最優先、次にトリッジ資材マスタ。
 * 検索順: 完全一致→品名一致→部分一致（各段階で仕入れ優先）
 */
function _findMaterialInDB(name, spec) {
  const nName = norm(name || '');
  const nSpec = norm(spec || '');
  if (!nName) return null;

  // 仕入れデータを先に検索（_source === 'supplier'）
  const suppliers = MATERIAL_DB.filter(m => m._source === 'supplier');
  const others    = MATERIAL_DB.filter(m => m._source !== 'supplier');

  for (const pool of [suppliers, others]) {
    const exact = pool.find(m => norm(m.n) === nName && norm(m.s) === nSpec);
    if (exact) return exact;
  }
  for (const pool of [suppliers, others]) {
    const nameMatch = pool.find(m => norm(m.n) === nName);
    if (nameMatch) return nameMatch;
  }
  for (const pool of [suppliers, others]) {
    const partial = pool.find(m => nName.includes(norm(m.n)) && norm(m.n).length >= 3)
      || pool.find(m => norm(m.n).includes(nName) && nName.length >= 3);
    if (partial) return partial;
  }
  return null;
}

/**
 * AI提案品目をDB基準で解決する。
 * 優先順位: 仕入れ単価 > トリッジ資材マスタ > AI推定値
 * 返り値: { price, bukariki, unit, priceSource, bukSource }
 *   priceSource/bukSource: 'supplier' | 'tridge' | 'ai' | 'none'
 */
function _resolveItemFromDB(item) {
  const dbMatch = _findMaterialInDB(item.name, item.spec);
  const aiPrice = parseFloat(item.price) || 0;
  const aiBuk   = parseFloat(item.bukariki) || 0;

  // 単価: 仕入れ > トリッジ > AI
  let price = aiPrice;
  let priceSource = aiPrice > 0 ? 'ai' : 'none';
  if (dbMatch && dbMatch.ep > 0) {
    price = dbMatch.ep;
    priceSource = dbMatch._source === 'supplier' ? 'supplier' : 'tridge';
  }

  // 歩掛: BUKARIKI_DB > AI
  const bukFromDB = resolveBukariki(item.name, item.spec, '');
  let bukariki = aiBuk;
  let bukSource = aiBuk > 0 ? 'ai' : 'none';
  if (bukFromDB.value > 0) {
    bukariki = bukFromDB.value;
    bukSource = 'tridge';
  }

  // 単位: DB > AI
  let unit = item.unit || '';
  if (dbMatch && dbMatch.u) unit = dbMatch.u;
  unit = typeof _normalizeUnit === 'function' ? _normalizeUnit(unit) : unit;

  return { price, bukariki, unit: unit || '式', priceSource, bukSource };
}

/** AI提案の工種名をactiveCategoriesから照合（完全一致→部分一致→正規化部分一致） */
function _matchCategory(catName) {
  return activeCategories.find(c =>
    c.active && (c.name === catName || c.name.includes(catName) || catName.includes(c.name))
  ) || activeCategories.find(c =>
    c.active && (norm(c.name).includes(norm(catName)) || norm(catName).includes(norm(c.name)))
  );
}

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
  _showAiLoadingOverlay();

  try {
    const area = parseFloat(project.areaTsubo) || 0;
    const similar = await _fetchSimilarProjects(area);
    const prompt = _buildAiDraftPrompt(similar, area);
    const responseText = await callClaude(prompt, 8192);
    const draft = _parseAiDraftResponse(responseText);
    _showAiDraftPreview(draft, similar.length);
  } catch (e) {
    showToast('AI生成エラー: ' + e.message);
  } finally {
    btn.innerHTML = origHtml;
    btn.disabled = false;
    _hideAiLoadingOverlay();
  }
}

/** ナレッジDBから類似物件を検索（エラー時は空配列） */
async function _fetchSimilarProjects(area) {
  try {
    const candidates = await knowledgeDB.searchSimilar({
      struct: project.struct, type: project.type,
      usage: project.usage, areaTsubo: area,
    });
    return candidates
      .filter(r => r.categories && r.categories.some(c => c.items && c.items.length > 0))
      .slice(0, 3);
  } catch (e) { return []; }
}

/** AIレスポンスからJSONを抽出・検証 */
function _parseAiDraftResponse(responseText) {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AIの回答からJSONを取り出せませんでした');
  const draft = JSON.parse(jsonMatch[0]);
  if (!draft.categories || !Array.isArray(draft.categories)) throw new Error('不正なフォーマットです');
  return draft;
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
- price（単価）は参考値として記載する。システム側で資材マスタ（トリッジ）の登録単価がある品目は自動的にそちらで上書きされる
- bukariki（歩掛）も参考値として記載する。システム側で歩掛マスタの登録値がある品目は自動的にそちらで上書きされる
- 品名・規格は資材マスタに登録されている名称とできるだけ一致させること（マッチ精度に影響する）
- 雑材料費・電工労務費・運搬費・諸経費・小計 等の自動計算行は含めない（システムが自動追加する）
- 実際の電気工事に使用する材料・機器のみ列挙する（電線・ケーブル・幹線・配管・プルボックス・分電盤・照明器具・コンセント・スイッチ・電気機器等を適切に含めること）
- ケーブル・電線類（IV線・CV線・VVF・幹線ケーブル等）は電気工事に不可欠なため、必ず該当する工種の品目に含めること
- 過去データがある場合は面積比を考慮して数量を調整する
- 工事概要・メモに記載された内容（工事の範囲・特記事項・使用機器の指定等）を最優先で反映すること`;
}

function _showAiDraftPreview(draft, similarCount) {
  const body = document.getElementById('aiDraftBody');

  const sourceNote = similarCount > 0
    ? `ナレッジDBの類似物件 ${similarCount}件を参照して生成`
    : 'ナレッジDBに類似物件がないため一般知識から生成（実績が蓄積されると精度が向上します）';

  let html = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#1e40af;">
    <strong>AI コメント:</strong> ${draft.comment || ''}
    <div style="font-size:11px;color:#3b82f6;margin-top:4px;">${sourceNote}</div>
  </div>`;

  let totalAmount = 0;
  let totalKosu = 0;
  let supplierCount = 0, tridgeCount = 0, aiOnlyCount = 0;
  (draft.categories || []).forEach(cat => {
    const resolvedItems = (cat.items || []).map(item => {
      const resolved = _resolveItemFromDB(item);
      const qty = parseFloat(item.qty) || 0;
      if (resolved.priceSource === 'supplier') supplierCount++;
      else if (resolved.priceSource === 'tridge') tridgeCount++;
      else aiOnlyCount++;
      return { ...item, ...resolved, qty };
    });
    const catTotal = resolvedItems.reduce((s, i) => s + i.qty * i.price, 0);
    const catKosu  = resolvedItems.reduce((s, i) => s + i.qty * i.bukariki, 0);
    totalAmount += catTotal;
    totalKosu += catKosu;

    html += _renderPreviewCategory(cat.name, resolvedItems, catTotal, catKosu);
  });

  // 単価ソースのサマリーバナー
  const badges = [];
  if (supplierCount > 0) badges.push(`<span style="color:#1e40af;font-weight:600;">仕入れ単価: ${supplierCount}品目</span>`);
  if (tridgeCount > 0) badges.push(`<span style="color:#334155;">トリッジ単価: ${tridgeCount}品目</span>`);
  if (aiOnlyCount > 0) badges.push(`<span style="color:#d97706;">AI推定値: ${aiOnlyCount}品目</span>`);
  html = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:12px;color:#475569;display:flex;gap:16px;align-items:center;">
    <span>単価ソース:</span>${badges.join('<span style="color:#cbd5e1;">|</span>')}
  </div>` + html;
  if (aiOnlyCount > 0) {
    html = `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:#92400e;">
      ⚠ <strong>${aiOnlyCount}品目</strong>がトリッジ未登録のためAI推定値を使用（<span style="color:#d97706;">オレンジ色</span>で表示）。トリッジに品目を追加すると精度が向上します。
    </div>` + html;
  }

  const totalLaborSell = Math.round(totalKosu * LABOR_RATES.sell);
  html += `<div style="text-align:right;padding:10px 8px 4px;font-size:13px;border-top:2px solid #e2e8f0;display:flex;justify-content:flex-end;gap:32px;">
    <span style="color:#6366f1;font-weight:600;">電工労務費（推計）: <span style="font-family:'JetBrains Mono';">${totalKosu.toFixed(2)}人工 → ¥${totalLaborSell.toLocaleString()}</span></span>
    <span style="font-weight:700;color:var(--accent);">材料合計: <span style="font-family:'JetBrains Mono';">¥${totalAmount.toLocaleString()}</span></span>
  </div>`;

  body.innerHTML = html;
  body._draft = draft;
  document.getElementById('aiDraftModal').classList.add('show');
}

/** プレビュー: 1工種分のHTML生成（resolvedItems = _resolveItemFromDB適用済み） */
function _renderPreviewCategory(catName, resolvedItems, catTotal, catKosu) {
  const laborSell = Math.round(catKosu * LABOR_RATES.sell);
  const mono = "font-family:'JetBrains Mono';";
  const thStyle = 'padding:5px 8px;font-weight:500;border-bottom:1px solid #e2e8f0;';

  let html = `<div style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px;padding:6px 10px;background:#f0f4ff;border-radius:6px 6px 0 0;border:1px solid #dbeafe;border-bottom:none;">
      <span>${catName}</span>
      <span style="display:flex;gap:16px;align-items:center;">
        ${catKosu > 0 ? `<span style="font-size:11px;font-weight:400;color:#6366f1;">電工 ${catKosu.toFixed(2)}人工 → ¥${laborSell.toLocaleString()}</span>` : ''}
        <span style="${mono}">¥${catTotal.toLocaleString()}</span>
      </span>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #dbeafe;font-size:12px;">
      <thead><tr style="background:#f8fafc;color:#64748b;">
        <th style="${thStyle}text-align:left;">品目</th>
        <th style="${thStyle}text-align:left;">規格</th>
        <th style="${thStyle}text-align:right;">数量</th>
        <th style="${thStyle}text-align:left;">単位</th>
        <th style="${thStyle}text-align:right;">単価</th>
        <th style="${thStyle}text-align:right;">金額</th>
        <th style="${thStyle}text-align:right;">歩掛</th>
        <th style="${thStyle}text-align:right;">人工数</th>
      </tr></thead>
      <tbody>`;

  resolvedItems.forEach(item => {
    const kosu = item.qty * item.bukariki;
    const td = 'padding:4px 8px;';
    // 仕入れ = 青, トリッジ = デフォルト, AI推定 = オレンジ
    const priceColor = item.priceSource === 'supplier' ? 'color:#1e40af;font-weight:600;'
                     : item.priceSource === 'ai' ? 'color:#d97706;' : '';
    const priceTitle = item.priceSource === 'supplier' ? 'title="仕入れ単価（最優先）"'
                     : item.priceSource === 'tridge' ? 'title="トリッジ単価"'
                     : item.priceSource === 'ai' ? 'title="AI推定値"' : '';
    const bukColor   = item.bukSource === 'ai' ? 'color:#d97706;' : item.bukSource === 'tridge' ? 'color:#6366f1;' : '';
    const bukTitle   = item.bukSource === 'tridge' ? 'title="トリッジ歩掛"' : item.bukSource === 'ai' ? 'title="AI推定値"' : '';
    html += `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="${td}">${esc(item.name)}</td>
      <td style="${td}color:#666;">${esc(item.spec || '')}</td>
      <td style="${td}text-align:right;${mono}">${item.qty}</td>
      <td style="${td}">${esc(item.unit || '')}</td>
      <td style="${td}text-align:right;${mono}${priceColor}" ${priceTitle}>${item.price > 0 ? item.price.toLocaleString() : '—'}</td>
      <td style="${td}text-align:right;${mono}">${(item.qty * item.price).toLocaleString()}</td>
      <td style="${td}text-align:right;${mono}${bukColor}" ${bukTitle}>${item.bukariki > 0 ? item.bukariki.toFixed(3) : '<span style="color:#ccc;">―</span>'}</td>
      <td style="${td}text-align:right;${mono}color:#6366f1;">${kosu > 0 ? kosu.toFixed(3) : ''}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  return html;
}

function applyAiDraft() {
  const draft = document.getElementById('aiDraftBody')._draft;
  if (!draft) { showToast('データがありません'); return; }

  saveUndoState();
  let addedItems = 0;

  let skippedCats = [];
  (draft.categories || []).forEach(cat => {
    const targetCat = _matchCategory(cat.name);
    if (!targetCat) { skippedCats.push(cat.name); return; }

    if (!items[targetCat.id]) items[targetCat.id] = [];
    const existing = items[targetCat.id].filter(i => i.name);
    if (existing.length > 0) {
      if (!confirm(`「${targetCat.name}」には既に${existing.length}件の品目があります。上書きしますか？\n（キャンセルでこの工種をスキップ）`)) return;
      items[targetCat.id] = [];
    }

    (cat.items || []).forEach(item => {
      const qty      = parseFloat(item.qty) || 0;
      const resolved = _resolveItemFromDB(item);
      items[targetCat.id].push(createBlankItem({
        name: item.name || '', spec: item.spec || '',
        qty, unit: resolved.unit, price: resolved.price,
        amount: qty * resolved.price,
        bukariki1: resolved.bukariki > 0 ? resolved.bukariki : '',
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
  // navigate('items') 内部で renderCatTabs() + renderItems() が呼ばれる
  navigate('items');
  updateSummaryBar();
  showToast(`${addedItems}品目をAI提案として投入しました${skippedCats.length > 0 ? `（未一致工種: ${skippedCats.join('、')}）` : ''}`);
}

// （仕入れ見積インポートはtridge-manager.jsに統合済み）
// （AI単価調査・掛率チェックは廃止済み — Tridgeマスタの市場価格連動で代替）
