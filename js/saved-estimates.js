// ===== 見積番号自動採番 =====
const ESTIMATE_NO_KEY    = 'estimateNoCounter';
const SAVED_ESTIMATES_KEY = 'hachitomo_estimates';
const MAX_SAVED_ESTIMATES = 50;

/** NNNN-EE → { base:'NNNN', branch:EE } */
function parseEstimateNo(no) {
  const m = String(no || '').match(/^(\d+)-(\d+)$/);
  if (!m) return { base: no || '', branch: 0 };
  return { base: m[1], branch: parseInt(m[2], 10) };
}

/** 同物件修正: 枝番+1 → 1111-01 → 1111-02 */
function incrementBranch(no) {
  const { base, branch } = parseEstimateNo(no);
  if (!base) return no;
  return base.padStart(4, '0') + '-' + String(branch + 1).padStart(2, '0');
}

/** 新規採番（流用・自動発番共通）: counter+1 → NNNN-01 */
function _allocateNewNo() {
  const counter = parseInt(localStorage.getItem(ESTIMATE_NO_KEY) || '0', 10) + 1;
  localStorage.setItem(ESTIMATE_NO_KEY, String(counter));
  return String(counter).padStart(4, '0') + '-01';
}

/** 「自動発番」ボタン: 初回のみ開始番号を確認 */
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
  document.getElementById('pj-number').value = no;
  updateProject();
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

// ===== 複数見積スロット保存・読み込み =====
function getSavedEstimates() {
  try { return JSON.parse(localStorage.getItem(SAVED_ESTIMATES_KEY) || '[]'); }
  catch { return []; }
}

function saveEstimateToList() {
  const list = getSavedEstimates();
  const record = {
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
    project: { ...project },
    items: JSON.parse(JSON.stringify(items)),
    itemIdCounter,
  };
  // 同じ見積番号があれば上書き（番号なしは常に新規追加）
  const idx = project.number
    ? list.findIndex(e => e.project.number === project.number)
    : -1;
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
    if (list.length > MAX_SAVED_ESTIMATES) list.splice(MAX_SAVED_ESTIMATES);
  }
  localStorage.setItem(SAVED_ESTIMATES_KEY, JSON.stringify(list));
  // auto-restore用スロットも更新
  localStorage.setItem('hachitomo_estimate', JSON.stringify({ project, items, itemIdCounter }));
  autoBackupEstimates(list);
  showToast('見積を保存しました');
}

function openSavedEstimatesModal() {
  renderSavedEstimatesList();
  document.getElementById('savedEstimatesModal').classList.add('show');
}

function closeSavedEstimatesModal() {
  document.getElementById('savedEstimatesModal').classList.remove('show');
}

function renderSavedEstimatesList() {
  const list = getSavedEstimates();
  const body = document.getElementById('savedEstimatesBody');
  if (list.length === 0) {
    body.innerHTML = '<p style="color:#666;text-align:center;padding:32px;">保存済みの見積がありません<br><small>「保存」ボタンで現在の見積を保存できます</small></p>';
    return;
  }
  const rows = list.map(e => {
    const date = e.savedAt ? new Date(e.savedAt).toLocaleDateString('ja-JP') : '';
    const no   = e.project.number || '—';
    const name = e.project.name   || '（物件名なし）';
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 10px;white-space:nowrap;font-weight:bold;">${no}</td>
      <td style="padding:8px 10px;">${name}</td>
      <td style="padding:8px 10px;white-space:nowrap;color:#888;font-size:12px;">${date}</td>
      <td style="padding:8px 10px;white-space:nowrap;">
        <button onclick="loadSavedEstimate('${e.id}','revise')" style="margin-right:4px;padding:4px 10px;font-size:12px;cursor:pointer;" title="同物件の修正版として読み込む（枝番+1）">修正</button>
        <button onclick="loadSavedEstimate('${e.id}','copy')" style="margin-right:4px;padding:4px 10px;font-size:12px;cursor:pointer;" title="別物件として流用（新規採番）">流用</button>
        <button onclick="deleteSavedEstimate('${e.id}')" style="padding:4px 10px;font-size:12px;cursor:pointer;color:#c00;">削除</button>
      </td>
    </tr>`;
  }).join('');
  body.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="border-bottom:2px solid #ddd;background:#f5f5f5;">
      <th style="padding:8px 10px;text-align:left;">見積番号</th>
      <th style="padding:8px 10px;text-align:left;">物件名</th>
      <th style="padding:8px 10px;text-align:left;">保存日</th>
      <th style="padding:8px 10px;text-align:left;">操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function loadSavedEstimate(id, mode) {
  const list = getSavedEstimates();
  const rec  = list.find(e => e.id === id);
  if (!rec) return;

  project       = { ...rec.project };
  items         = JSON.parse(JSON.stringify(rec.items));
  itemIdCounter = rec.itemIdCounter || 1;

  if (mode === 'revise') {
    // 同物件修正: 枝番+1
    project.number = incrementBranch(project.number);
  } else {
    // 流用: 新規採番（別物件扱い）
    project.number = _allocateNewNo();
    project.name   = project.name ? project.name + '（流用）' : '';
  }

  // フォームに反映
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
  document.getElementById('pj-labor-rate').value = project.laborRate || 72;
  document.getElementById('pj-labor-sell').value = project.laborSell || '';
  document.getElementById('pj-tax').value        = project.tax || 10;

  activeCategories.forEach(c => { if (!items[c.id]) items[c.id] = []; });
  recalcAll();
  renderCatTabs();
  closeSavedEstimatesModal();

  const label = mode === 'revise' ? `修正版 → ${project.number}` : `流用 → ${project.number}`;
  showToast(`見積を読み込みました（${label}）`);
}

function deleteSavedEstimate(id) {
  if (!confirm('この保存済み見積を削除しますか？')) return;
  const list = getSavedEstimates().filter(e => e.id !== id);
  localStorage.setItem(SAVED_ESTIMATES_KEY, JSON.stringify(list));
  renderSavedEstimatesList();
  showToast('削除しました');
}

/** 1日1回自動バックアップ（saveEstimateToList から呼ばれる） */
function autoBackupEstimates(list) {
  if (!list || list.length === 0) return;
  const today = new Date().toISOString().split('T')[0];
  const last  = localStorage.getItem('estimates_last_backup') || '';
  if (last.startsWith(today)) return;  // 今日はもう済んでいる
  const json = JSON.stringify(list, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `estimates_backup_${today}.json`; a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem('estimates_last_backup', new Date().toISOString());
}

function exportSavedEstimates() {
  const list = getSavedEstimates();
  if (list.length === 0) { showToast('保存済み見積がありません'); return; }
  const json = JSON.stringify(list, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().split('T')[0];
  a.href = url; a.download = `estimates_backup_${date}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast(`${list.length}件の見積をバックアップしました`);
}

function importSavedEstimates(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const incoming = JSON.parse(e.target.result);
      if (!Array.isArray(incoming)) throw new Error('フォーマットが正しくありません');
      const existing = getSavedEstimates();
      // 既存にないIDのみ追加（重複スキップ）、最新を先頭に
      const existingIds = new Set(existing.map(r => r.id));
      const newEntries  = incoming.filter(r => r.id && !existingIds.has(r.id));
      const merged = [...newEntries, ...existing]
        .slice(0, MAX_SAVED_ESTIMATES);
      localStorage.setItem(SAVED_ESTIMATES_KEY, JSON.stringify(merged));
      renderSavedEstimatesList();
      showToast(`${newEntries.length}件を復元しました（既存: ${existing.length}件）`);
    } catch(err) {
      showToast('復元に失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ===== 保存済み見積 起動時チェック =====
function checkEstimatesRestore() {
  const list       = getSavedEstimates();
  const lastBackup = localStorage.getItem('estimates_last_backup');
  if (list.length === 0 && lastBackup) {
    // localStorageが消えたが、バックアップ記録が残っている → 復元を促す
    setTimeout(() => {
      showToast('保存済み見積が見つかりません。「📂 保存済み」→「📤 復元」でバックアップから復元できます');
    }, 2000);
  }
}
