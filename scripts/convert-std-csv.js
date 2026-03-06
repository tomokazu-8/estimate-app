/**
 * 本丸EX 標準マスタCSV → Tridge変換スクリプト
 *
 * 使い方:
 *   node scripts/convert-std-csv.js <品目規格マスタ.csv> [中分類名マスタ.csv] [オプション]
 *
 * オプション:
 *   --all           全大分類を含む（省略時は電気のみ: 大分類01+02）
 *   --dai=01,02,42  大分類コードをカンマ区切りで指定
 *   --out=ファイル名  出力ファイル名（省略時は自動生成）
 *
 * 例:
 *   node scripts/convert-std-csv.js 標準マスタ-標準マスタ-品目規格マスタ.csv 外堀-外堀-中分類名マスタ.csv
 */

const XLSX  = require('xlsx');
const iconv = require('iconv-lite');
const path  = require('path');
const fs    = require('fs');

// ===== 中分類コード → Tridgeカテゴリ =====
const CHUCODE_TO_CAT = {
  // 電線管・配管系
  '101': 'conduit', '103': 'conduit', '104': 'conduit', '105': 'conduit',
  '106': 'conduit', '120': 'conduit', '126': 'conduit', '133': 'conduit',
  '851': 'conduit',
  // ボックス系
  '108': 'box', '110': 'box', '111': 'box',
  '853': 'box', '855': 'box',
  // ケーブルラック・支持材
  '115': 'accessories', '116': 'accessories',
  // 電線・ケーブル系
  '160': 'cable', '162': 'cable', '163': 'cable', '165': 'accessories',
  '167': 'accessories',
  '861': 'cable', '862': 'cable', '863': 'cable',
  // ダクト
  '154': 'accessories', '155': 'accessories', '156': 'accessories',
  '363': 'accessories',
  // 盤・機器
  '213': 'panel', '215': 'panel', '217': 'panel',
  '262': 'panel', '263': 'panel', '265': 'panel', '266': 'panel', '267': 'panel',
  '271': 'panel', '273': 'dimmer', '275': 'dimmer',
  // 照明
  '301': 'fixture', '302': 'fixture', '303': 'fixture', '306': 'fixture',
  '3011': 'fixture',
  // 配線器具・弱電
  '461': 'device', '494': 'device',
  '865': 'device', '868': 'device',
  // 接地
  '595': 'ground',
  // 火報・防災
  '746': 'fire',
  // その他
  '556': 'accessories', '558': 'accessories', '565': 'accessories',
  '580': 'accessories', '297': 'accessories', '520': 'accessories',
};

// CAT_RATIOS（data.jsと同値）
const CAT_RATIOS = {
  accessories: 0.807, box: 0.767, cable: 0.721, conduit: 0.756,
  device: 0.728, dimmer: 0.834, fire: 0.802, fixture: 0.77,
  ground: 0.718, panel: 0.761,
};

// ===== 品目名・小分類名からカテゴリを推定（フォールバック） =====
function guessCategory(name, subName) {
  const n = (name + ' ' + subName).toLowerCase();
  if (/cv|vv|iv|em|エコ|電線|ｹｰﾌﾞﾙ|cable/.test(n))      return 'cable';
  if (/pf|cd管|ve管|電線管|可とう|硬質|ﾈｼﾞﾅｼ|ﾈｼﾞｱﾘ/.test(n)) return 'conduit';
  if (/分電盤|制御盤|動力盤|開閉器|遮断器|変圧器/.test(n))       return 'panel';
  if (/コンセント|ｺﾝｾﾝﾄ|スイッチ|ｽｲｯﾁ|プレート|ﾌﾟﾚｰﾄ/.test(n))  return 'device';
  if (/ボックス|ﾎﾞｯｸｽ|box|プルボックス|ﾌﾟﾙﾎﾞｯｸｽ/.test(n))       return 'box';
  if (/照明|ライト|led|ランプ|灯具|器具|ﾗｲﾄ|ﾗﾝﾌﾟ/.test(n))      return 'fixture';
  if (/接地|アース|ｱｰｽ/.test(n))                                return 'ground';
  if (/火報|感知器|発信機|受信機|ｶﾞｽ漏れ/.test(n))               return 'fire';
  if (/調光|dimmer/.test(n))                                    return 'dimmer';
  return 'accessories';
}

// ===== Shift-JIS CSVをパース（ダブルクォート囲み前提） =====
function parseCsvLine(line) {
  // 簡易パース: "val","val"... 形式
  return line.split('","').map(f => f.replace(/^"|"$/g, ''));
}

// ===== メイン =====
function main() {
  // 引数解析
  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith('--'));
  const files = args.filter(a => !a.startsWith('--'));

  const csvPath = files[0];
  const chuCsvPath = files[1];  // 中分類名マスタ（省略可）

  if (!csvPath) {
    console.error('使い方: node scripts/convert-std-csv.js <品目規格マスタ.csv> [中分類名マスタ.csv]');
    process.exit(1);
  }

  const includeAll = flags.includes('--all');
  const daiFlag = flags.find(f => f.startsWith('--dai='));
  let allowedDai = null;
  if (daiFlag) {
    allowedDai = new Set(daiFlag.replace('--dai=', '').split(',').map(s => s.trim()));
  } else if (!includeAll) {
    allowedDai = new Set(['01', '02']);  // デフォルト: 電気のみ
  }

  const outFlag = flags.find(f => f.startsWith('--out='));
  const outName = outFlag ? outFlag.replace('--out=', '') : null;

  // ===== 中分類名マスタ読み込み（あれば）=====
  const chuNameMap = new Map();  // 中分類コード → { dai, name }
  if (chuCsvPath) {
    const chuPath = path.resolve(chuCsvPath);
    if (fs.existsSync(chuPath)) {
      const buf = fs.readFileSync(chuPath);
      const text = iconv.decode(buf, 'Shift_JIS');
      text.split('\n').slice(1).filter(l => l.trim()).forEach(l => {
        const f = parseCsvLine(l);
        if (f[1]) chuNameMap.set(f[1], { dai: f[0], name: f[2] });
      });
      console.log('[中分類マスタ] 読み込み:', chuNameMap.size, '件');
    } else {
      console.warn('[警告] 中分類名マスタが見つかりません:', chuPath);
    }
  }

  // ===== 品目規格マスタ読み込み =====
  const inputPath = path.resolve(csvPath);
  if (!fs.existsSync(inputPath)) {
    console.error('ファイルが見つかりません:', inputPath);
    process.exit(1);
  }

  console.log('読み込み中:', inputPath);
  const buf = fs.readFileSync(inputPath);
  const text = iconv.decode(buf, 'Shift_JIS');
  const lines = text.split('\n').filter(l => l.trim());
  console.log('総行数:', lines.length - 1);

  // ===== データ変換 =====
  const seen = new Map();  // 重複排除: 品目名称+規格名称+単位
  let skippedNoPrice = 0;
  let skippedDai = 0;

  lines.slice(1).forEach(line => {
    const f = parseCsvLine(line);
    if (f.length < 12) return;

    const chuCode  = f[1]  || '';
    const subName  = f[3]  || '';  // 小分類名称
    const itemName = f[5]  || '';  // 品目名称
    const spec     = f[6]  || '';  // 規格名称
    const unit     = f[7]  || '';  // 単位
    const price    = parseFloat(f[8]) || 0;  // 基準単価
    const buk      = parseFloat(f[11]) || 0; // 歩掛1

    if (price <= 0) { skippedNoPrice++; return; }
    if (!itemName || !unit) return;

    // 大分類フィルタ（中分類マスタで解決、なければchuCodeの先頭で推定）
    if (allowedDai) {
      const info = chuNameMap.get(chuCode);
      if (info) {
        if (!allowedDai.has(info.dai)) { skippedDai++; return; }
      } else {
        // 中分類マスタなし: コード800番台は大42相当なのでデフォルトでは除外（重複回避）
        const chuNum = parseInt(chuCode) || 0;
        if (chuNum >= 800 && !allowedDai.has('42')) { skippedDai++; return; }
      }
    }

    // 重複排除
    const key = itemName + '|' + spec + '|' + unit;
    if (seen.has(key)) return;

    // カテゴリ決定
    const cat = CHUCODE_TO_CAT[chuCode] || guessCategory(itemName, subName);

    // 原価推定
    const ratio = CAT_RATIOS[cat] || 0.75;
    const cost  = Math.round(price * ratio);
    const costRate = Math.round(ratio * 1000) / 1000;

    seen.set(key, {
      品目名称: itemName,
      規格名称: spec,
      単位:     unit,
      基準単価: price,
      原価:     cost,
      原価率:   costRate,
      歩掛:     buk,
      カテゴリ: cat,
    });
  });

  const materials = Array.from(seen.values());
  console.log('抽出品目:', materials.length, '件');
  console.log('  単価なし除外:', skippedNoPrice, '件');
  console.log('  大分類除外:', skippedDai, '件');

  // ===== Tridge Excel 生成 =====
  const outWb = XLSX.utils.book_new();

  // --- 資材マスタ ---
  const matHeader = ['品目名称', '規格名称', '単位', '基準単価', '原価', '原価率', '歩掛', 'カテゴリ'];
  const matRows = [matHeader, ...materials.map(m => [
    m.品目名称, m.規格名称, m.単位,
    m.基準単価, m.原価, m.原価率, m.歩掛, m.カテゴリ,
  ])];
  const wsMat = XLSX.utils.aoa_to_sheet(matRows);
  wsMat['!cols'] = [
    { wch: 32 }, { wch: 28 }, { wch: 6 }, { wch: 10 },
    { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(outWb, wsMat, '資材マスタ');

  // --- 工種マスタ（テンプレート）---
  const catRows = [
    ['工種ID', '工種名', '略称', '割合モード', '雑材料率%', '順序', '自動計算行'],
    ['trunk',      '幹線・分電盤工事',        '幹線',   '', 5, 1, '雑材料消耗品|電工労務費|運搬費'],
    ['wiring',     '配線・配管工事',          '配管',   '', 5, 2, '雑材料消耗品|電工労務費|運搬費'],
    ['lighting',   '照明器具工事',            '照明',   '', 5, 3, '雑材料消耗品|器具取付費|埋込器具用天井材開口費|運搬費'],
    ['outlet',     'コンセント工事',          'コンセント', '', 5, 4, '雑材料消耗品|電工労務費|運搬費'],
    ['weak',       '弱電工事',               '弱電',   '', 3, 5, '雑材料消耗品|電工労務費|UTPケーブル試験費|運搬費'],
    ['fire',       '自動火災報知設備工事',     '自火報',  '', 5, 6, '雑材料消耗品|機器取付け及び試験調整費|運搬費'],
  ];
  const wsCat = XLSX.utils.aoa_to_sheet(catRows);
  wsCat['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 6 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(outWb, wsCat, '工種マスタ');

  // --- 設定マスタ ---
  const settingRows = [
    ['パラメーター名', '値'],
    ['銅建値補正',                '○'],
    ['銅建値基準（円/kg）',        1200],
    ['銅連動率',                  0.5],
    ['労務売単価（円/人工）',      29370],
    ['労務原価単価（円/人工）',     19200],
  ];
  const wsSet = XLSX.utils.aoa_to_sheet(settingRows);
  wsSet['!cols'] = [{ wch: 24 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(outWb, wsSet, '設定マスタ');

  // --- キーワードマスタ ---
  const kwRows = [
    ['キーワード', '分類', '歩掛', '銅連動', '天井開口'],
    ['cv',        'wiring',  0.025, '○', ''],
    ['vv',        'wiring',  0.020, '○', ''],
    ['iv',        'wiring',  0.015, '○', ''],
    ['em',        'wiring',  0.020, '○', ''],
    ['pf',        'wiring',  0.045, '',  ''],
    ['電線管',    'wiring',  0.045, '',  ''],
    ['照明',      'fixture', 0.25,  '',  '○'],
    ['コンセント', 'fixture', 0.07,  '',  ''],
    ['ｺﾝｾﾝﾄ',    'fixture', 0.07,  '',  ''],
    ['スイッチ',  'fixture', 0.07,  '',  ''],
    ['ｽｲｯﾁ',     'fixture', 0.07,  '',  ''],
  ];
  const wsKw = XLSX.utils.aoa_to_sheet(kwRows);
  wsKw['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(outWb, wsKw, 'キーワードマスタ');

  // --- 出力 ---
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const label = includeAll ? '全業種' : (allowedDai ? Array.from(allowedDai).join('+') : '電気');
  const fileName = outName || `tridge_${label}_${dateStr}.xlsx`;
  const outPath = path.join(path.dirname(inputPath), fileName);

  XLSX.writeFile(outWb, outPath);
  console.log('\n✅ Tridge出力完了:', outPath);
  console.log('  ├ 資材マスタ:', materials.length, '品目');
  console.log('  ├ 工種マスタ: 6工種（内容を確認・修正してください）');
  console.log('  ├ 設定マスタ: 銅建値補正=○, 労務売=29370, 労務原価=19200');
  console.log('  └ キーワードマスタ: 基本テンプレート（必要に応じて追加）');
  console.log('\n次のステップ:');
  console.log('  1. 出力されたExcelを開いて内容を確認');
  console.log('  2. 工種マスタの工種を実際の運用に合わせて修正');
  console.log('  3. 設定マスタの労務単価を実際の単価に修正');
  console.log('  4. estimate-app でTridgeとして読み込む');
}

main();
