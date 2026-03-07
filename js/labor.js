// ===== 労務費計算エンジン =====

// 歩掛を取得する（優先順位: 資材マスタの歩掛DB → キーワードマスタ）
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
  // 3. TRIDGE_KEYWORDS: キーワードマスタで一致（Tridge定義のフォールバック）
  for (const k of TRIDGE_KEYWORDS) {
    if (k.bukariki > 0 && n.includes(k.keyword))
      return { value: k.bukariki, source: 'KW' };
  }

  return { value: 0, source: 'なし' };
}

// 労務分類を判定（wiring / fixture / equipment）
// TRIDGE_KEYWORDS の「分類」列で決まる
function classifyForLabor(name, spec) {
  if (!TRIDGE_KEYWORDS.length) return 'fixture';
  const n = norm(name + ' ' + (spec || ''));
  const match = TRIDGE_KEYWORDS.find(k => n.includes(k.keyword));
  return match?.laborType || 'fixture';
}

// Compute labor breakdown for a category
function calcLaborBreakdown(catId) {
  const list = items[catId] || [];
  let wiringKosu = 0, fixtureKosu = 0, equipKosu = 0, ceilingCount = 0;
  let 撤去Kosu = 0, 開口Kosu = 0;
  const details = [];

  for (const item of list) {
    if (AUTO_NAMES.includes(item.name) || !item.qty) continue;
    const qty = parseFloat(item.qty) || 0;
    if (qty <= 0) continue;

    // 歩掛1: bukariki1（旧bukarikiから後方互換フォールバック）→ 電工労務費
    const buk1Raw = item.bukariki1 !== undefined ? item.bukariki1 : item.bukariki;
    const buk = (buk1Raw !== '' && buk1Raw !== undefined)
      ? { value: parseFloat(buk1Raw) || 0, source: '手入力' }
      : findBukariki(item.name, item.spec || '');
    const kosu = qty * buk.value;
    const laborType = classifyForLabor(item.name, item.spec);

    if (laborType === 'wiring') wiringKosu += kosu;
    else if (laborType === 'equipment') equipKosu += kosu;
    else fixtureKosu += kosu;

    // 歩掛2: bukariki2 → 既設器具撤去処分費
    const buk2 = parseFloat(item.bukariki2) || 0;
    撤去Kosu += qty * buk2;

    // 歩掛3: bukariki3 → 天井及び壁材開口費
    const buk3 = parseFloat(item.bukariki3) || 0;
    開口Kosu += qty * buk3;

    // Count ceiling openings（キーワードマスタに「天井開口」フラグがある品目）
    const n = norm(item.name + ' ' + (item.spec || ''));
    const kwMatch = TRIDGE_KEYWORDS.find(k => k.ceilingOpening && n.includes(k.keyword));
    if (kwMatch) ceilingCount += qty;

    details.push({ name: item.name, qty, bukariki: buk.value, kosu: Math.round(kosu*1000)/1000, type: laborType, source: buk.source });
  }

  // Material subtotal
  const materialTotal = list.filter(i => !AUTO_NAMES.includes(i.name))
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  return { wiringKosu, fixtureKosu, equipKosu, ceilingCount, 撤去Kosu, 開口Kosu,
    materialTotal, details, totalKosu: wiringKosu + fixtureKosu + equipKosu };
}
