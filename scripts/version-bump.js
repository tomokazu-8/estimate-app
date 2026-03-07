// 使い方: node scripts/version-bump.js minor|major
const fs = require('fs');
const path = require('path');

const type = process.argv[2];
if (type !== 'minor' && type !== 'major') {
  console.error('使い方: node scripts/version-bump.js minor|major');
  console.error('  minor: UI修正・バグ修正・既存機能改善（小数点以下をインクリメント）');
  console.error('  major: 新主要機能追加・画面構成大幅変更・データ構造変更（整数部分をインクリメント）');
  process.exit(1);
}

const indexPath = path.join(__dirname, '../index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const match = html.match(/見積管理システム v(\d+)\.(\d+)/);
if (!match) {
  console.error('index.html に「見積管理システム vX.Y」が見つかりません');
  process.exit(1);
}

let major = parseInt(match[1], 10);
let minor = parseInt(match[2], 10);
const oldVersion = `v${major}.${minor}`;

if (type === 'major') {
  major += 1;
  minor = 0;
} else {
  minor += 1;
}

const newVersion = `v${major}.${minor}`;
html = html.replace(`見積管理システム ${oldVersion}`, `見積管理システム ${newVersion}`);
fs.writeFileSync(indexPath, html, 'utf8');

console.log(`バージョンを更新しました: ${oldVersion} → ${newVersion}`);
