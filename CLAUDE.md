# estimate-app — プロジェクト引継ぎ

## このアプリの位置づけ

八友電工の**見積プラットフォーム**（通称 Deck）。
「トリッジ（Tridge）」と呼ぶExcelファイルを差し込むことで、
電気・空調・給排水・建築など、どの業種の見積にも対応できる汎用設計。

- Deck = ゲーム機本体（プラットフォーム）= コネクタの雌側
- Tridge = ゲームカセット（Excel）= コネクタの雄側
- Deckには業種固有知識を一切持たせない（全てTridgeに委ねる）

## 関連リポジトリ

- GitHub: https://github.com/tomokazu-8/estimate-app
- GitHub Pages: https://tomokazu-8.github.io/estimate-app/
- トリッジ管理アプリ: `c:\Users\pal19\Projects\db-manager`

## トリッジ（Tridge）とは

見積アプリに差し込むExcelファイル。旧称「DBカセット」→現在は「トリッジ」に統一。
- 資材マスタ・工種マスタ・設定マスタをすべてトリッジで定義する
- 工種（幹線・照明・コンセント等）はトリッジから読み込む（ハードコードしない）
- 電気/空調トリッジには銅建値補正パラメーターを含める

### トリッジ運用方針
- **1スロット1トリッジ**: 同時に1つのトリッジのみ受け付ける（複数スロット不可）
- **差しっぱなし可**: localStorage に工種・設定が保存されるため、毎回読み込む必要なし
- **抜き差し自由**: 別トリッジを読み込めば全マスタが上書きされる
- **複数業種対応**: db-manager側でトリッジを「合成」して1本にまとめる
- **コネクタ仕様は安易に変えない**: 変えると既存トリッジが全て使えなくなる

### トリッジのExcel構成（Deck側の受け口 = コネクタ雌形状）

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

## 現在の実装状態

### 完成済み機能
- トリッジ読み込み（4シート対応）→ excel-loader.js
- 工種マスタ → `applyTridgeCategories()` で activeCategories に動的ロード
- 設定マスタ → `TRIDGE_SETTINGS` に格納、銅建値補正UI連動
- キーワードマスタ → `TRIDGE_KEYWORDS` に格納、labor.js が参照
- 資材マスタの歩掛カラム → BUKARIKI_DB として labor.js が優先参照
- 銅建値補正: `TRIDGE_SETTINGS.copperEnabled` が true の時のみ有効
- 材料検索モーダル（material-search.js）
- 見積計算エンジン（calc-engine.js）
- テンプレート方式Excel出力（excel-template-export.js）
- ナレッジDB（knowledge-db.js）
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

## ナレッジDB（knowledge-db.js）

- IndexedDB `estimate-knowledge` に見積実績を蓄積
- Excel出力時に自動登録（プロジェクト情報 + 全工種の全品目明細）
- JSONエクスポート/インポートで端末間共有可能
- `knowledgeDB.searchSimilar()`: 構造/種別/用途/面積で類似物件検索（スコア3以上を返却）
- `knowledgeDB.buildRecord()`: 現在の見積データからナレッジレコードを構築
- 初回起動時に `PERF_DB` → ナレッジDB に自動移行（`perf_db_migrated` フラグで制御）
- 見積自動作成: 類似物件の品目を面積比でスケーリングして自動投入（AUTO_NAMES行は除外）

### 自動バックアップ
- **タイミング**: Excel出力のたびに `knowledgeDB.autoBackup()` が自動実行
- **出力**: `knowledge_backup_YYYY-MM-DD.json` がダウンロードされる
- **最終バックアップ記録**: `localStorage['knowledge_last_backup']` に日時を保存
- **起動時復元チェック**: DB件数が0件かつ最終バックアップ記録がある場合、復元バナーを表示
- **復元バナー**: 画面上部に表示、バックアップJSONファイルを選択して `restoreFromBackup()` で復元
- **リスク対策**: IndexedDBはブラウザのキャッシュクリアで消失するため、バックアップファイルが唯一の永続的データ保存先

## テンプレート方式Excel出力

### 概要
`data/estimate_template.xlsx` を読み込み、所定セルにデータを書き込む方式。
レイアウト修正 = テンプレートをExcelで直接編集するだけ（コード変更不要）。

### テンプレートファイル
- **場所**: `data/estimate_template.xlsx`
- **生成**: `node scripts/generate-template.js`（再生成が必要な場合のみ）
- **ページ設定**: A4横向き、fitToPage有効
- **3シート構成**: 表紙 / 内訳書 / 内訳明細書
- ユーザーがExcelで直接編集・関数追加できる

### テンプレートのセルマップ（Deck→テンプレートの書き込み先）

#### 表紙シート
| セル | 内容 |
|------|------|
| P4 | 見積番号 |
| C6 | 得意先名 +「　御中」 |
| O6 | 日付（yyyy年 m月 d日） |
| G9 | 税抜金額 |
| G10 | 消費税（テンプレート関数 `=ROUNDDOWN(G9*0.1,0)` を推奨） |
| G11 | 税込合計（テンプレート関数 `=G9+G10` を推奨） |
| E14 | 工事名 |
| E15 | 施工場所 |
| P15 | 担当者名 |

#### 内訳書シート
| セル | 内容 |
|------|------|
| B4 | 物件名 |
| 行7〜16 | カテゴリ行（最大10工種）: B=工種名, D=1, E=式, G=金額, H=備考 |
| G32 | 合計（テンプレート関数 `=SUM(G7:G16)` を推奨） |

#### 内訳明細書シート
- 20ページ分確保（各35行、1ページ=ヘッダー6行+データ25行+フッター4行）
- ページN（0始まり）の行オフセット: `base = N × 35`

| オフセット | 内容 |
|-----------|------|
| base+2 | タイトル「内訳明細書」 |
| base+4 | B: カテゴリ名, H:「見積№」 |
| base+6 | 列ヘッダー（品名/規格/数量/単位/単価/金額/備考） |
| base+7〜31 | データ行（25行）: B=品名, C=規格, D=数量, E=単位, F=単価, G=金額, H=備考 |
| base+32 | B:「合計」, G=工種合計金額 |
| base+34 | B: ページ番号 |

### 複数ページにまたがる工種の処理
- 25品目を超えた工種は自動で次のページに送る
- 途中ページ: 合計行をクリア
- 最終ページ: 工種全体の合計を値で書き込み（テンプレートのSUM関数を上書き）
- 未使用ページ: 自動クリア、印刷範囲も使用分のみに設定

### フォールバック
ExcelJS CDN読み込み失敗またはテンプレート読み込み失敗時は、SheetJS簡易版で出力。

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
│   └── style.css
├── data/
│   ├── material_db.json       ← 空の[] （トリッジで上書きされる）
│   ├── bukariki_db.json       ← 空の[] （トリッジで上書きされる）
│   └── estimate_template.xlsx ← Excel出力テンプレート（Excelで直接編集可、A4横）
├── scripts/
│   └── generate-template.js   ← テンプレート自動生成スクリプト（ExcelJS使用）
└── js/
    ├── app.js                     ← メインUIロジック（exportEstimate: ExcelJS優先→SheetJSフォールバック）
    ├── calc-engine.js             ← 見積計算エンジン（自動計算行の追加・雑材料費等）
    ├── data.js                    ← 定数・グローバル変数・PERF_DB
    ├── excel-loader.js            ← トリッジ読み込み（資材/工種/設定/キーワード4シート対応）
    ├── excel-template-export.js   ← テンプレート方式Excel出力（テンプレート読み込み→データ書き込み）
    ├── knowledge-db.js            ← ナレッジDB（IndexedDB CRUD + JSON入出力 + 見積自動作成）
    ├── labor.js                   ← 労務費計算（TRIDGE_KEYWORDS参照型）
    └── material-search.js         ← 材料検索モーダル
```

## 重要な実装メモ

- `norm(s)`: NFKC正規化で全角/半角統一 → data.jsで定義、全ファイルで使用
- `cache: 'no-store'`: app.jsのfetch呼び出しに設定（ブラウザキャッシュ防止）
- `getCol(row, ...names)`: excel-loader.jsの柔軟な列名検索
- `activeCategories`: Tridge装着時に `applyTridgeCategories()` で上書き、localStorageに保存
- 銅建値補正: `TRIDGE_SETTINGS.copperEnabled === true` の時のみ有効（Tridge設定マスタ連動）
- `isCableItem()`: TRIDGE_KEYWORDS の copperLinked フラグで判定（ハードコードなし）
- `miscRate`: activeCategories[*].miscRate に格納（工種マスタの「雑材料率%」列）
- `getCatTotal(catId)`: 品目金額の合計（items配列のamountを集計）
- `getCatAmount(catId)`: 割合モード込みの金額（rateModeの場合は前工種合計×割合%で算出）
- `exportEstimate()`: async関数、ExcelJS版を試行→失敗時SheetJSフォールバック→ナレッジDB自動登録

## 外部ライブラリ（CDN）

- **SheetJS** (`xlsx@0.18.5`): トリッジ読み込み・フォールバック用Excel出力
- **ExcelJS** (`exceljs@4.4.0`): テンプレート方式Excel出力（メイン）
- npm `exceljs`: テンプレート生成スクリプト用（`node_modules/`、.gitignore済み）
