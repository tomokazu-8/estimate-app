# 八友電工 見積システム

電気工事の見積作成を効率化するWebアプリケーションです。

## プロジェクト構成

```
estimate-app/
├── index.html              ← 画面構造（HTML）
├── css/
│   └── style.css           ← デザイン・レイアウト
├── js/
│   ├── data.js             ← データ定義（DB変数、原価率、自動計算ルール）
│   ├── labor.js            ← 労務費計算（歩掛検索、労務費集計）
│   ├── material-search.js  ← 資材検索・サジェスト機能
│   ├── calc-engine.js      ← 自動計算エンジン（付属品・支持材等）
│   ├── excel-loader.js     ← Excel D&D読み込み（マスタDB取込）
│   └── app.js              ← メインアプリ（画面制御・保存・出力）
├── data/
│   ├── material_db.json    ← 内蔵資材DB（540品目）
│   └── bukariki_db.json    ← 内蔵歩掛DB（109品目）
└── README.md               ← このファイル
```

## 各ファイルの役割

| ファイル | 役割 | 修正するとき |
|---------|------|------------|
| `style.css` | 色・サイズ・配置 | デザインを変えたい |
| `data.js` | DB変数・原価率テーブル | 原価率を変えたい |
| `labor.js` | 歩掛検索・労務費計算 | 労務費の計算方法を変えたい |
| `material-search.js` | DB検索・候補表示 | 検索の動作を変えたい |
| `calc-engine.js` | 付属品・支持材の自動計算 | 自動計算ルールを変えたい |
| `excel-loader.js` | ExcelファイルからDB読み込み | Excel取込の動作を変えたい |
| `app.js` | 画面遷移・保存・集計・出力 | 画面の動き全般を変えたい |

## 起動方法

### ローカルサーバーで起動（推奨）

ファイルを分割しているため、ローカルサーバーが必要です。

```bash
# Node.jsがインストールされている場合
npx serve .

# Pythonがインストールされている場合
python3 -m http.server 8000
```

ブラウザで `http://localhost:3000`（または `http://localhost:8000`）を開きます。

### VS Code Live Server（簡単）

1. VS Codeの拡張機能「Live Server」をインストール
2. index.html を右クリック → 「Open with Live Server」

## マスタDB（Excel）の使い方

1. アプリ起動時にDB読み込みダイアログが表示されます
2. `見積マスタDB.xlsx` をドラッグ＆ドロップ
3. 49,415品目 + 歩掛データが読み込まれます
4. 「内蔵DBで続行」を押すと540品目の内蔵DBで動作します

## 開発メモ

- 使用言語: HTML / CSS / JavaScript（フレームワークなし）
- 外部ライブラリ: SheetJS（Excel読み書き）のみ
- データ保存: localStorage（ブラウザ内保存）
