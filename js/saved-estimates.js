// ===== 見積バージョン管理・保存・読み込み =====
const ESTIMATE_NO_KEY    = 'estimateNoCounter';
const SAVED_ESTIMATES_KEY = 'hachitomo_estimates';
const MAX_SAVED_ESTIMATES = 200;

// 現在編集中の見積メタ情報（上書き保存で使用）
let _currentEstimateId = null;   // 保存済みリスト内のID
let _currentBaseNo     = '';     // 基番号
let _currentBranch     = 0;     // 枝番
let _currentIsFinal    = false; // 本見積フラグ

function _resetEstimateState() {
  _currentEstimateId = null;
  _currentBaseNo = '';
  _currentBranch = 0;
  _currentIsFinal = false;
  const badge = document.getElementById('finalBadge');
  if (badge) badge.style.display = 'none';
}

// 一覧UIの状態
let _estListMode   = 'date';    // 'date' | 'client'
let _estListQuery  = '';
let _estListFinalOnly = false;

// ===== 見積番号解析・採番 =====

/** NNNN-EE → { base:'NNNN', branch:EE } */
function parseEstimateNo(no) {
  const m = String(no || '').match(/^(\d+)-(\d+)$/);
  if (!m) return { base: no || '', branch: 0 };
  return { base: m[1], branch: parseInt(m[2], 10) };
}

/** 新規採番: counter+1 → NNNN-01 */
function _allocateNewNo() {
  const counter = parseInt(localStorage.getItem(ESTIMATE_NO_KEY) || '0', 10) + 1;
  localStorage.setItem(ESTIMATE_NO_KEY, String(counter));
  return String(counter).padStart(4, '0') + '-01';
}

/** 自動採番: 初回のみ開始番号を確認（保存時に呼ばれる） */
function generateEstimateNo() {
  let counter = parseInt(localStorage.getItem(ESTIMATE_NO_KEY) || '0', 10);
  if (counter === 0) {
    const input = prompt('見積番号の開始番号を入力してください（例: 358）\n※前回の最後の番号の次から始まります', '1');
    if (input === null) return;
    counter = parseInt(input, 10) - 1;
    if (isNaN(counter) || counter < 0) counter = 0;
    localStorage.setItem(ESTIMATE_NO_KEY, String(counter));
  }
  const no = _allocateNewNo();
  const parsed = parseEstimateNo(no);
  _currentBaseNo  = parsed.base;
  _currentBranch  = parsed.branch;
  _currentIsFinal = false;
  _currentEstimateId = null;
  document.getElementById('pj-number').value = no;
  updateProject();
  _updateEstimateHeader();
}

function setEstimateNoCounter() {
  const current = parseInt(localStorage.getItem(ESTIMATE_NO_KEY) || '0', 10);
  const input = prompt(
    `現在のカウンター: ${current}（次回発番: ${String(current + 1).padStart(4, '0')}-01）\n新しいカウンター値を入力:`,
    String(current)
  );
  if (input === null) return;
  const val = parseInt(input, 10);
  if (!isNaN(val) && val >= 0) {
    localStorage.setItem(ESTIMATE_NO_KEY, String(val));
    showToast(`見積番号カウンターを ${val} に設定しました（次回: ${String(val + 1).padStart(4, '0')}-01）`);
  }
}

// ===== マイグレーション（既存データ互換） =====

function migrateEstimate(est) {
  if (!est.baseNo) {
    const m = (est.project?.number || '').match(/^(\d+)-(\d+)$/);
    if (m) {
      est.baseNo = m[1];
      est.branch = parseInt(m[2], 10);
    } else {
      est.baseNo = est.project?.number || est.id;
      est.branch = 1;
    }
  }
  if (est.isFinal === undefined) est.isFinal = false;
  // grandTotal が未計算なら品目から算出
  if (est.grandTotal === undefined) {
    let total = 0;
    if (est.items) {
      Object.values(est.items).forEach(list => {
        (list || []).forEach(i => { total += parseFloat(i.amount) || 0; });
      });
    }
    est.grandTotal = Math.round(total);
  }
  return est;
}

// ===== 保存済み見積の取得・永続化 =====

function getSavedEstimates() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_ESTIMATES_KEY) || '[]').map(migrateEstimate);
  } catch { return []; }
}

function _persistEstimates(list) {
  safeLocalStorageSet(SAVED_ESTIMATES_KEY, JSON.stringify(list));
  safeLocalStorageSet('hachitomo_estimate', JSON.stringify({ project, items, itemIdCounter }));
}

// ===== 現在の見積の金額合計を算出 =====
function _calcCurrentGrandTotal() {
  let total = 0;
  if (typeof activeCategories !== 'undefined') {
    activeCategories.forEach(cat => {
      if (typeof getCatAmount === 'function') {
        total += getCatAmount(cat.id);
      }
    });
  }
  return Math.round(total);
}

// ===== 保存レコード生成 =====
function _buildSaveRecord() {
  return {
    id:             _currentEstimateId || Date.now().toString(),
    baseNo:         _currentBaseNo,
    branch:         _currentBranch,
    isFinal:        _currentIsFinal,
    savedAt:        new Date().toISOString(),
    grandTotal:     _calcCurrentGrandTotal(),
    project:        { ...project },
    items:          JSON.parse(JSON.stringify(items)),
    itemIdCounter,
  };
}

// ===== 保存ボタン（トップバーから呼ばれる） =====
function smartSave() {
  if (!_currentEstimateId) {
    saveEstimate();
    return;
  }
  const noSpan = document.getElementById('saveChoiceCurrentNo');
  if (noSpan) noSpan.textContent = project.number || '';
  document.getElementById('saveChoiceModal').classList.add('show');
}

function _closeSaveChoiceModal() {
  document.getElementById('saveChoiceModal').classList.remove('show');
}

// ===== 上書き保存 =====
function saveEstimate() {
  // 見積番号未設定なら自動採番
  if (!project.number) {
    generateEstimateNo();
    if (!project.number) return; // キャンセルされた
  }

  // 初回保存（まだメタ情報なし）
  if (!_currentBaseNo) {
    const parsed = parseEstimateNo(project.number);
    _currentBaseNo = parsed.base;
    _currentBranch = parsed.branch || 1;
  }

  const list   = getSavedEstimates();
  const record = _buildSaveRecord();

  // 同じIDがあれば上書き、なければ先頭に追加
  const idx = list.findIndex(e => e.id === record.id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    _currentEstimateId = record.id;
    list.unshift(record);
    if (list.length > MAX_SAVED_ESTIMATES) list.splice(MAX_SAVED_ESTIMATES);
  }

  _persistEstimates(list);
  autoBackupEstimates(list);
  _updateEstimateHeader();
  showToast(`見積を保存しました（${project.number}）`);
}

// ===== 別名で保存（枝番を上げて新版作成） =====
function saveAsNewBranch() {
  if (!project.number) {
    saveEstimate(); // まだ一度も保存していない場合は通常保存
    return;
  }

  // 同一基番号の最大枝番を取得
  const list = getSavedEstimates();
  const maxBranch = list
    .filter(e => e.baseNo === _currentBaseNo)
    .reduce((max, e) => Math.max(max, e.branch || 0), 0);

  _currentBranch = maxBranch + 1;
  _currentEstimateId = Date.now().toString(); // 新しいID
  _currentIsFinal = false;

  // 見積番号を更新
  project.number = _currentBaseNo.padStart(4, '0') + '-' + String(_currentBranch).padStart(2, '0');
  document.getElementById('pj-number').value = project.number;

  const record = _buildSaveRecord();
  list.unshift(record);
  if (list.length > MAX_SAVED_ESTIMATES) list.splice(MAX_SAVED_ESTIMATES);

  _persistEstimates(list);
  autoBackupEstimates(list);
  _updateEstimateHeader();
  showToast(`別名で保存しました（${project.number}）`);
}

// ===== 本見積フラグ =====
function setFinal(id) {
  const list = getSavedEstimates();
  const target = list.find(e => e.id === id);
  if (!target) return;

  // 同一基番号の全版を false に
  list.forEach(e => {
    if (e.baseNo === target.baseNo) e.isFinal = false;
  });
  target.isFinal = true;

  _persistEstimates(list);

  // 現在編集中の見積が対象なら反映
  if (_currentEstimateId === id) {
    _currentIsFinal = true;
    _updateEstimateHeader();
  }
  // 現在編集中が同一基番号の別版なら解除
  if (_currentBaseNo === target.baseNo && _currentEstimateId !== id) {
    _currentIsFinal = false;
    _updateEstimateHeader();
  }

  renderSavedEstimatesList();
  showToast(`${target.project.number || target.baseNo} を本見積に設定しました`);
}

function toggleCurrentFinal() {
  if (!_currentEstimateId) {
    showToast('先に保存してください');
    return;
  }
  if (_currentIsFinal) {
    // 解除
    const list = getSavedEstimates();
    const target = list.find(e => e.id === _currentEstimateId);
    if (target) {
      target.isFinal = false;
      _persistEstimates(list);
    }
    _currentIsFinal = false;
    _updateEstimateHeader();
    showToast('本見積を解除しました');
  } else {
    setFinal(_currentEstimateId);
  }
}

// ===== トップバーのヘッダー表示更新 =====
function _updateEstimateHeader() {
  const badge = document.getElementById('finalBadge');
  if (badge) {
    badge.style.display = _currentIsFinal ? 'inline-flex' : 'none';
  }
  // プロジェクトバー更新
  if (typeof _updateProjectBar === 'function') _updateProjectBar();
}

// ===== 一覧モーダル =====

function openSavedEstimatesModal() {
  renderSavedEstimatesList();
  document.getElementById('savedEstimatesModal').classList.add('show');
}

function closeSavedEstimatesModal() {
  document.getElementById('savedEstimatesModal').classList.remove('show');
}

// ===== 一覧レンダリング =====

function renderSavedEstimatesList() {
  const allList = getSavedEstimates();
  const body    = document.getElementById('savedEstimatesBody');

  if (allList.length === 0) {
    body.innerHTML = '<p style="color:#666;text-align:center;padding:32px;">保存済みの見積がありません<br><small>「💾 保存」ボタンで現在の見積を保存できます</small></p>';
    return;
  }

  // 検索フィルタ
  const q = norm(_estListQuery);
  let filtered = allList;
  if (q) {
    filtered = allList.filter(e => {
      const text = norm((e.project.number || '') + ' ' + (e.project.name || '') + ' ' + (e.project.client || ''));
      return q.split(/\s+/).every(t => text.includes(t));
    });
  }

  // 本見積のみフィルタ
  if (_estListFinalOnly) {
    const finalBaseNos = new Set(filtered.filter(e => e.isFinal).map(e => e.baseNo));
    filtered = filtered.filter(e => finalBaseNos.has(e.baseNo));
  }

  // 基番号でグループ化
  const groups = new Map();
  filtered.forEach(e => {
    if (!groups.has(e.baseNo)) groups.set(e.baseNo, []);
    groups.get(e.baseNo).push(e);
  });

  // グループ内は枝番降順
  groups.forEach(list => list.sort((a, b) => (b.branch || 0) - (a.branch || 0)));

  // グループの並び順
  let sortedGroups;
  if (_estListMode === 'client') {
    // 得意先別 → 得意先名50音順、同一得意先内は更新日降順
    const clientMap = new Map();
    groups.forEach((list, baseNo) => {
      const client = list[0]?.project?.client || '（得意先なし）';
      if (!clientMap.has(client)) clientMap.set(client, []);
      clientMap.get(client).push({ baseNo, list, latestDate: list[0]?.savedAt || '' });
    });
    // 得意先名順
    const sortedClients = [...clientMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja'));

    let html = '';
    sortedClients.forEach(([client, items]) => {
      items.sort((a, b) => b.latestDate.localeCompare(a.latestDate));
      html += `<div style="margin-bottom:16px;">
        <div style="padding:6px 10px;background:#f1f5f9;border-radius:6px;font-weight:600;font-size:13px;color:#475569;margin-bottom:6px;">
          ${esc(client)}（${items.length}物件）
        </div>`;
      items.forEach(({ baseNo, list }) => {
        html += _renderGroup(baseNo, list);
      });
      html += '</div>';
    });
    body.innerHTML = html || '<p style="color:#666;text-align:center;padding:16px;">該当する見積がありません</p>';
    return;
  }

  // 更新日順（デフォルト）: グループの最新更新日降順
  sortedGroups = [...groups.entries()].sort((a, b) => {
    const dateA = a[1][0]?.savedAt || '';
    const dateB = b[1][0]?.savedAt || '';
    return dateB.localeCompare(dateA);
  });

  let html = '';
  sortedGroups.forEach(([baseNo, list]) => {
    html += _renderGroup(baseNo, list);
  });
  body.innerHTML = html || '<p style="color:#666;text-align:center;padding:16px;">該当する見積がありません</p>';
}

function _renderGroup(baseNo, list) {
  const latest    = list[0];
  const name      = latest.project.name || '（物件名なし）';
  const client    = latest.project.client || '';
  const hasFinal  = list.some(e => e.isFinal);
  const count     = list.length;
  const latestDate = latest.savedAt ? new Date(latest.savedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }) : '';

  // 現在編集中をハイライト
  const isCurrentGroup = _currentBaseNo === baseNo;

  let html = `<div style="margin-bottom:10px;border:1px solid ${isCurrentGroup ? '#3b82f6' : '#e2e8f0'};border-radius:8px;overflow:hidden;">`;

  // グループヘッダー
  html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${isCurrentGroup ? '#eff6ff' : '#f8fafc'};cursor:pointer;" onclick="this.parentElement.querySelector('.est-group-body').classList.toggle('est-collapsed')">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-weight:700;font-size:13px;color:#1e293b;">${esc(baseNo)}</span>
      <span style="font-size:13px;color:#334155;">${esc(name)}</span>
      ${client ? `<span style="font-size:11px;color:#64748b;">${esc(client)}</span>` : ''}
      ${hasFinal ? '<span style="color:#f59e0b;font-size:12px;" title="本見積あり">★</span>' : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#94a3b8;">
      <span>${latestDate}</span>
      <span>${count}版</span>
      <span style="font-size:10px;">▼</span>
    </div>
  </div>`;

  // 版リスト
  html += '<div class="est-group-body">';
  list.forEach(e => {
    const no   = e.project.number || `${e.baseNo}-${String(e.branch).padStart(2, '0')}`;
    const date = e.savedAt ? new Date(e.savedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }) : '';
    const total = e.grandTotal ? '¥' + e.grandTotal.toLocaleString() : '';
    const isCurrent = _currentEstimateId === e.id;

    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 24px;border-top:1px solid #f1f5f9;${isCurrent ? 'background:#fffbeb;' : ''}">
      <div style="display:flex;align-items:center;gap:8px;">
        ${e.isFinal ? '<span style="color:#f59e0b;font-weight:bold;font-size:12px;" title="本見積">★</span>' : '<span style="width:14px;display:inline-block;"></span>'}
        <span style="font-weight:600;font-size:12px;font-family:monospace;">${esc(no)}</span>
        ${e.isFinal ? '<span style="font-size:10px;color:#f59e0b;font-weight:600;">本見積</span>' : ''}
        ${isCurrent ? '<span style="font-size:10px;color:#3b82f6;font-weight:600;">編集中</span>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;color:#94a3b8;">${date}</span>
        <span style="font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:500;min-width:90px;text-align:right;">${total}</span>
        <div style="display:flex;gap:4px;">
          <button onclick="loadSavedEstimate('${e.id}')" style="padding:3px 10px;font-size:11px;cursor:pointer;border:1px solid #d1d5db;border-radius:4px;background:#fff;">開く</button>
          ${!e.isFinal ? `<button onclick="setFinal('${e.id}')" style="padding:3px 8px;font-size:11px;cursor:pointer;border:1px solid #fbbf24;border-radius:4px;background:#fffbeb;color:#92400e;" title="本見積に設定">★</button>` : ''}
          <button onclick="copyEstimate('${e.id}')" style="padding:3px 8px;font-size:11px;cursor:pointer;border:1px solid #d1d5db;border-radius:4px;background:#fff;" title="別物件としてコピーして新規作成">コピー</button>
          <button onclick="deleteSavedEstimate('${e.id}')" style="padding:3px 6px;font-size:11px;cursor:pointer;border:1px solid #fca5a5;border-radius:4px;background:#fff;color:#dc2626;" title="この版を削除">✕</button>
        </div>
      </div>
    </div>`;
  });
  html += '</div></div>';

  return html;
}

// ===== 見積読み込み =====

/** 保存済みレコードを取得して確認ダイアログを表示する共通処理 */
function _findAndConfirm(id, message) {
  const list = getSavedEstimates();
  const rec  = list.find(e => e.id === id);
  if (!rec) return null;
  const no   = rec.project.number || rec.baseNo;
  const name = rec.project.name || '（物件名なし）';
  if (!confirm(`「${no} ${name}」${message}\n現在の編集内容は破棄されます。よろしいですか？`)) return null;
  closeSavedEstimatesModal();
  return rec;
}

/** レコードのデータをワークスペースに展開し、UIを再描画する */
function _applyEstimateRecord(rec) {
  project       = { ...rec.project };
  items         = JSON.parse(JSON.stringify(rec.items));
  itemIdCounter = rec.itemIdCounter || 1;
  _restoreProjectForm();
  activeCategories.forEach(c => { if (!items[c.id]) items[c.id] = []; });
  recalcAll();
  renderCatTabs();
  _updateEstimateHeader();
  if (typeof _updatePresetLabel === 'function') _updatePresetLabel();
  if (typeof showPresetSuggestion === 'function') showPresetSuggestion();
}

function loadSavedEstimate(id) {
  const rec = _findAndConfirm(id, 'を開きます。');
  if (!rec) return;

  _currentEstimateId = rec.id;
  _currentBaseNo     = rec.baseNo;
  _currentBranch     = rec.branch;
  _currentIsFinal    = rec.isFinal;

  _applyEstimateRecord(rec);
  showToast(`見積を読み込みました（${rec.project.number || rec.baseNo}）`);
}

// コピーして新規作成（別物件として新規採番）
function copyEstimate(id) {
  const rec = _findAndConfirm(id, 'をコピーして新規作成します。');
  if (!rec) return;

  _currentEstimateId = null;
  _currentIsFinal    = false;

  _applyEstimateRecord(rec);

  // 新規採番（_applyEstimateRecord後にproject を上書き）
  project.number = _allocateNewNo();
  project.name   = project.name ? project.name + '（コピー）' : '';
  const parsed   = parseEstimateNo(project.number);
  _currentBaseNo   = parsed.base;
  _currentBranch   = parsed.branch;

  _restoreProjectForm();
  _updateEstimateHeader();
  showToast(`コピーしました → ${project.number}（保存はまだされていません）`);
}

// フォーム復元の共通処理
function _restoreProjectForm() {
  document.getElementById('pj-name').value       = project.name || '';
  document.getElementById('pj-number').value     = project.number || '';
  document.getElementById('pj-date').value       = project.date || '';
  document.getElementById('pj-client').value     = project.client || '';
  document.getElementById('pj-struct').value     = project.struct || '';
  document.getElementById('pj-usage').value      = project.usage || '';
  document.getElementById('pj-type').value       = project.type || '';
  document.getElementById('pj-floors').value     = project.floors || '';
  document.getElementById('pj-area-sqm').value   = project.areaSqm || '';
  document.getElementById('pj-area-tsubo').value = project.areaTsubo || '';
  document.getElementById('pj-location').value   = project.location || '';
  document.getElementById('pj-person').value     = project.person || '';
  document.getElementById('pj-labor-sell').value = project.laborSell || '';
  document.getElementById('pj-labor-cost').value = project.laborCost || '';
  document.getElementById('pj-tax').value        = project.tax || 10;
}

// ===== 削除 =====

function deleteSavedEstimate(id) {
  if (!confirm('この版を削除しますか？')) return;
  const list = getSavedEstimates().filter(e => e.id !== id);
  _persistEstimates(list);
  if (_currentEstimateId === id) {
    _currentEstimateId = null;
    _updateEstimateHeader();
  }
  renderSavedEstimatesList();
  showToast('削除しました');
}

// ===== 検索・表示切替 =====

function onEstListSearch(value) {
  _estListQuery = value;
  renderSavedEstimatesList();
}

function onEstListModeChange(value) {
  _estListMode = value;
  renderSavedEstimatesList();
}

function onEstListFinalToggle(checked) {
  _estListFinalOnly = checked;
  renderSavedEstimatesList();
}

// ===== バックアップ =====

/** 自動バックアップ（最終保存日時のみ記録、ダウンロードはしない） */
function autoBackupEstimates(list) {
  if (!list || list.length === 0) return;
  localStorage.setItem('estimates_last_backup', new Date().toISOString());
}

function exportSavedEstimates() {
  const list = getSavedEstimates();
  if (list.length === 0) { showToast('保存済み見積がありません'); return; }
  const json = JSON.stringify(list, null, 2);
  const date = new Date().toISOString().split('T')[0];
  downloadBlob(new Blob([json], { type: 'application/json' }), `estimates_backup_${date}.json`);
  showToast(`${list.length}件の見積をバックアップしました`);
}

function importSavedEstimates(fileInput, mode) {
  const file = fileInput instanceof HTMLInputElement ? fileInput.files[0] : fileInput;
  if (!file) return;
  if (mode === 'replace' && !confirm('既存の保存済み見積を全て削除して、バックアップファイルの内容で置き換えます。\nよろしいですか？')) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const incoming = JSON.parse(e.target.result);
      if (!Array.isArray(incoming)) throw new Error('フォーマットが正しくありません');
      const migrated = incoming.map(migrateEstimate);

      let result;
      if (mode === 'replace') {
        result = migrated.slice(0, MAX_SAVED_ESTIMATES);
        showToast(`${result.length}件で置き換えました`);
      } else {
        const existing    = getSavedEstimates();
        const existingIds = new Set(existing.map(r => r.id));
        const newEntries  = migrated.filter(r => r.id && !existingIds.has(r.id));
        result = [...newEntries, ...existing].slice(0, MAX_SAVED_ESTIMATES);
        showToast(`${newEntries.length}件を追加しました（既存: ${existing.length}件、重複スキップ: ${incoming.length - newEntries.length}件）`);
      }
      safeLocalStorageSet(SAVED_ESTIMATES_KEY, JSON.stringify(result));
      renderSavedEstimatesList();
    } catch(err) {
      showToast('復元に失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
  // 同じファイルを再選択できるようリセット
  if (fileInput instanceof HTMLInputElement) fileInput.value = '';
}

// ===== 起動時チェック =====
function checkEstimatesRestore() {
  const list       = getSavedEstimates();
  const lastBackup = localStorage.getItem('estimates_last_backup');
  if (list.length === 0 && lastBackup) {
    setTimeout(() => {
      showToast('保存済み見積が見つかりません。「📂 保存済み」→「📤 復元」でバックアップから復元できます');
    }, 2000);
  }
}
