# estimate-app — プロジェクト引継ぎ

## このアプリの位置づけ

八友電工の**見積プラットフォーム**。
「トリッジ（Tridge）」と呼ぶExcelファイルを差し込むことで、
電気・空調・給排水・建築など、どの業種の見積にも対応できる汎用設計を目指す。

## 関連リポジトリ

- GitHub: https://github.com/tomokazu-8/estimate-app
- GitHub Pages: https://tomokazu-8.github.io/estimate-app/
- トリッジ管理アプリ: `c:\Users\pal19\Projects\db-manager`

## トリッジ（Tridge）とは

見積アプリに差し込むExcelファイル。旧称「DBカセット」→現在は「トリッジ」に統一。
- 資材マスタ・工種マスタ・設定マスタをすべてトリッジで定義する
- 工種（幹線・照明・コンセント等）はトリッジから読み込む（ハードコードしない）
- 電気/空調トリッジには銅建値補正パラメーターを含める

## トリッジのExcel構成（Deck側の受け口 = コネクタ雌形状）

```
トリッジ（Excel）
├── 資材マスタ     — 品目名称/規格/単位/基準単価/原価/原価率/歩掛/カテゴリ
├── 工種マスタ     — 工種ID/工種名/略称/割合モード/雑材料率%/順序
├── 設定マスタ     — パラメーター名/値（銅建値補正等）
├── キーワードマスタ — キーワード/分類/歩掛/銅連動/天井開口
└── 労務単価マスタ  — 将来実装予定
```

### 設定マスタのパラメーター（パラメーター名/値 の2列）
| パラメーター名 | 説明 |
|------------|------|
| 銅建値補正 | ○/はい/1 で有効（電気・空調トリッジのみ） |
| 銅建値基準（円/kg） | トリッジ作成時点の基準銅建値 |
| 銅連動率 | 材料価格に占める銅コスト比率（0〜1） |
| 労務売単価（円/人工） | 労務費計算用 |
| 労務原価単価（円/人工） | 労務費計算用 |

### キーワードマスタの列
| 列名 | 説明 |
|------|------|
| キーワード | 品名に含まれる文字列（norm()適用） |
| 分類 | wiring / fixture / equipment |
| 歩掛 | デフォルト歩掛係数 |
| 銅連動 | ○で銅建値補正対象（ケーブル類） |
| 天井開口 | ○で天井開口カウント対象 |

## 現在の実装状態（Phase 1 完了）

### 完成済み機能
- トリッジ読み込み（4シート対応）→ excel-loader.js
- 工種マスタ → `applyTridgeCategories()` で activeCategories に動的ロード
- 設定マスタ → `TRIDGE_SETTINGS` に格納、銅建値補正UI連動
- キーワードマスタ → `TRIDGE_KEYWORDS` に格納、labor.js が参照
- 資材マスタの歩掛カラム → BUKARIKI_DB として labor.js が優先参照
- 銅建値補正: `TRIDGE_SETTINGS.copperEnabled` が true の時のみ有効
- 材料検索モーダル（material-search.js）
- 見積計算エンジン（calc-engine.js）
- Excel出力
- ナレッジDB（knowledge-db.js）— IndexedDB + JSONエクスポート/インポート
- 見積自動作成（ナレッジDBの類似物件から品目を面積比スケーリングで自動投入）

### 重要なグローバル変数（data.js）
- `TRIDGE_SETTINGS`: 設定マスタの値（copperEnabled/copperBase/copperFraction/laborSell/laborCost）
- `TRIDGE_KEYWORDS`: キーワードマスタの配列（keyword/laborType/bukariki/copperLinked/ceilingOpening）
- `tridgeLoaded`: Tridge装着フラグ
- `activeCategories`: 工種マスタから動的ロード（Tridge未装着時は[]）
- `PERF_DB`: レガシー実績データ（33件、初回起動時にナレッジDBに移行済み）

### 内蔵DB
`data/material_db.json` と `data/bukariki_db.json` は空の`[]`。
トリッジを装着することで材料DBが有効になる。

### ナレッジDB（knowledge-db.js）
- IndexedDB `estimate-knowledge` に見積実績を蓄積
- Excel出力時に自動登録（プロジェクト情報 + 全工種の全品目明細）
- JSONエクスポート/インポートで端末間共有可能
- `knowledgeDB.searchSimilar()`: 構造/種別/用途/面積で類似物件検索
- `knowledgeDB.buildRecord()`: 現在の見積データからナレッジレコードを構築
- 初回起動時に `PERF_DB` → ナレッジDB に自動移行（`perf_db_migrated` フラグで制御）
- 見積自動作成: 類似物件の品目を面積比でスケーリングして自動投入

## 汎用化フェーズ計画

### Phase 1 ✅ 完了：Tridge主導アーキテクチャへの移行
- CATEGORIES・BUKARIKI_DEFAULTS を data.js から削除
- 工種マスタ・設定マスタ・キーワードマスタの読み込みを excel-loader.js に実装
- labor.js をTRIDGE_KEYWORDS参照型に書き換え
- 銅建値補正UIを設定マスタ連動に

### Phase 2（次）：AUTO_NAMES・calc-engine テンプレートの動的化
- AUTO_NAMESを工種マスタの「自動計算行」列で定義
- calc-engine.js の addAutoCalcRows テンプレートを工種マスタ依存に
- labor.js の `classifyForLabor` をさらに精緻化（天井開口等）

### Phase 3：軽量化・分離
- PERF_DBをdata.jsから完全削除（ナレッジDBに移行済みのため）
- 電気専用UIの完全削除

## ファイル構成

```
estimate-app/
├── index.html
├── css/
├── data/
│   ├── material_db.json    ← 空の[] （トリッジで上書きされる）
│   └── bukariki_db.json    ← 空の[] （トリッジで上書きされる）
└── js/
    ├── app.js              ← メインUIロジック
    ├── calc-engine.js      ← 見積計算エンジン
    ├── data.js             ← 定数・データモデル
    ├── excel-loader.js     ← トリッジ読み込み・Excelエクスポート
    ├── knowledge-db.js     ← ナレッジDB（IndexedDB CRUD + JSON入出力 + 見積自動作成）
    ├── labor.js            ← 労務費計算（TRIDGE_KEYWORDS参照型）
    └── material-search.js  ← 材料検索モーダル
```

## 重要な実装メモ

- `norm(s)`: NFKC正規化で全角/半角統一 → data.jsで定義、全ファイルで使用
- `cache: 'no-store'`: app.jsのfetch呼び出しに設定（ブラウザキャッシュ防止）
- `getCol(row, ...names)`: excel-loader.jsの柔軟な列名検索
- `activeCategories`: Tridge装着時に `applyTridgeCategories()` で上書き、localStorageに保存
- 銅建値補正: `TRIDGE_SETTINGS.copperEnabled === true` の時のみ有効（Tridge設定マスタ連動）
- `isCableItem()`: TRIDGE_KEYWORDS の copperLinked フラグで判定（ハードコードなし）
- `miscRate`: activeCategories[*].miscRate に格納（工種マスタの「雑材料率%」列）
