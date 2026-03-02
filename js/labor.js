// ===== 労務費計算エンジン =====
function findBukariki(name, spec) {
  const n = (name + ' ' + (spec||'')).toLowerCase();
  for (const b of BUKARIKI_DB) {
    if (n.includes(b.n.toLowerCase()) && (b.s === '' || n.includes(b.s.toLowerCase())))
      return { value: b.b, source: 'DB' };
  }
  for (const b of BUKARIKI_DB) {
    const fw = b.n.toLowerCase().split(' ')[0];
    if (fw.length >= 3 && n.includes(fw))
      return { value: b.b, source: '近似' };
  }
  for (const [cat, kws] of [
    ['cable',['ｹｰﾌﾞﾙ','vv-f','cv ','cvt','iv ','同軸','cpev']],
    ['conduit',['電線管','pf-','ve ','fep','ﾈｼﾞﾅｼ']],
    ['device',['ｺﾝｾﾝﾄ','ｽｲｯﾁ','ﾌﾟﾚｰﾄ']],
    ['panel',['分電盤','開閉器']],
    ['fire',['火災','感知','報知']],
    ['ground',['接地']],
  ]) {
    if (kws.some(k => n.includes(k)))
      return { value: BUKARIKI_DEFAULTS[cat], source: 'ﾃﾞﾌｫﾙﾄ' };
  }
  return { value: BUKARIKI_DEFAULTS.fixture, source: 'ﾃﾞﾌｫﾙﾄ' };
}

// Classify items for labor split: wiring / fixture / equipment
function classifyForLabor(name, spec) {
  const n = (name + ' ' + (spec||'')).toLowerCase();
  if (['ｹｰﾌﾞﾙ','vv-f','cv ','cvt','iv ','同軸','cpev','導入線','ae ','hp ','toev','utp',
       '電線管','pf-','ve ','fep','ﾈｼﾞﾅｼ','ﾎﾞｯｸｽ','ﾌﾟﾙﾎﾞｯｸｽ','ﾀﾞｸﾄ'].some(k => n.includes(k)))
    return 'wiring';
  if (['分電盤','開閉器','制御盤','盤','ﾒｰﾀｰ','計器'].some(k => n.includes(k)))
    return 'equipment';
  return 'fixture';
}

// Compute labor breakdown for a category
function calcLaborBreakdown(catId) {
  const list = items[catId] || [];
  let wiringKosu = 0, fixtureKosu = 0, equipKosu = 0, ceilingCount = 0;
  const details = [];
  
  for (const item of list) {
    if (AUTO_NAMES.includes(item.name) || !item.qty) continue;
    const qty = parseFloat(item.qty) || 0;
    if (qty <= 0) continue;
    const buk = (item.bukariki !== '' && item.bukariki !== undefined)
      ? { value: parseFloat(item.bukariki) || 0, source: '手入力' }
      : findBukariki(item.name, item.spec || '');
    const kosu = qty * buk.value;
    const laborType = classifyForLabor(item.name, item.spec);
    
    if (laborType === 'wiring') wiringKosu += kosu;
    else if (laborType === 'equipment') equipKosu += kosu;
    else fixtureKosu += kosu;
    
    // Count ceiling openings
    const n = (item.name + ' ' + (item.spec||'')).toLowerCase();
    if (n.includes('ﾀﾞｳﾝﾗｲﾄ') || n.includes('ダウンライト') || n.includes('非常灯') || n.includes('非常照明') || n.includes('感知'))
      ceilingCount += qty;
    
    details.push({ name: item.name, qty, bukariki: buk.value, kosu: Math.round(kosu*1000)/1000, type: laborType, source: buk.source });
  }
  
  // Material subtotal
  const materialTotal = list.filter(i => !AUTO_NAMES.includes(i.name))
    .reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  
  return { wiringKosu, fixtureKosu, equipKosu, ceilingCount, materialTotal, details,
    totalKosu: wiringKosu + fixtureKosu + equipKosu };
}