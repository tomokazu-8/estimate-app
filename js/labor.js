// ===== 労務費計算エンジン =====

// 歩掛を取得する（資材マスタの歩掛DBを参照）
function findBukariki(name, spec) {
  const n = norm(name + ' ' + (spec || ''));

  // 1. BUKARIKI_DB: 完全一致（資材マスタの歩掛カラムから生成）
  for (const b of BUKARIKI_DB) {
    if (n.includes(norm(b.n)) && (b.s === '' || n.includes(norm(b.s))))
      return { value: b.b, source: 'DB' };
  }
  // 2. BUKARIKI_DB: 先頭語の部分一致
  for (const b of BUKARIKI_DB) {
    const fw = norm(b.n).split(' ')[0];
    if (fw.length >= 3 && n.includes(fw))
      return { value: b.b, source: '近似' };
  }

  return { value: 0, source: 'なし' };
}

// 歩掛を解決する（明示値 → DB検索 の優先順位）
// explicitValue: bukariki1 フィールド値（'' = 未設定 → DB検索、数値 = 手入力を尊重）
function resolveBukariki(name, spec, explicitValue) {
  if (explicitValue !== '' && explicitValue !== undefined && explicitValue !== null) {
    return { value: parseFloat(explicitValue) || 0, source: '手入力' };
  }
  return findBukariki(name, spec || '');
}

// 労務費内訳を計算する
// 歩掛1 → 電工労務費（totalKosu）
// 歩掛2 → 既設器具撤去処分費（撤去Kosu）
// 歩掛3 → 天井材開口費（開口Kosu）
function calcLaborBreakdown(catId) {
  const list = items[catId] || [];
  let totalKosu = 0;
  let 撤去Kosu = 0, 開口Kosu = 0;
  const details = [];

  for (const item of list) {
    if (AUTO_NAMES.includes(item.name) || !item.qty) continue;
    const qty = parseFloat(item.qty) || 0;
    if (qty <= 0) continue;

    // 歩掛1: bukariki1 優先、旧 bukariki に後方互換フォールバック
    const buk1Raw = item.bukariki1 !== undefined ? item.bukariki1 : item.bukariki;
    const buk = resolveBukariki(item.name, item.spec, buk1Raw);
    const kosu = qty * buk.value;
    totalKosu += kosu;

    // 歩掛2: 既設器具撤去処分費
    const buk2 = parseFloat(item.bukariki2) || 0;
    撤去Kosu += qty * buk2;

    // 歩掛3: 天井材開口費
    const buk3 = parseFloat(item.bukariki3) || 0;
    開口Kosu += qty * buk3;

    details.push({
      name: item.name, qty,
      bukariki: buk.value,
      kosu: Math.round(kosu * 1000) / 1000,
      source: buk.source,
    });
  }

  // 自動計算行を除いた材料費小計
  const materialTotal = list
    .filter(i => !AUTO_NAMES.includes(i.name))
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  return {
    totalKosu, 撤去Kosu, 開口Kosu, materialTotal, details,
  };
}
