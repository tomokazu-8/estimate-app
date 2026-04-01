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
- **Tridgeマスタ管理UI**（tridge-manager.js）— db-manager の全機能を Deck 内に統合
- **AI機能**（ai-features.js）— たたき台作成・仕入れ見積インポート・単価調査・掛率チェック
- **保存済み見積管理**（saved-estimates.js）— 見積番号採番・複数スロット保存/読み込み

### 重要なグローバル変数（data.js）
- `TRIDGE_SETTINGS`: 設定マスタの値（copperEnabled/copperBase/copperFraction/laborSell/laborCost）
- `TRIDGE_KEYWORDS`: キーワードマスタの配列（keyword/laborType/bukariki/copperLinked/ceilingOpening）
- `koshuTridgeLoaded`: 工種Tridge装着フラグ
- `zairyoTridgeLoaded`: 資材Tridge装着フラグ
- `activeCategories`: 工種マスタから動的ロード（Tridge未装着時は[]）
- `TRIDGE_CLIENTS`: 得意先マスタ（工種Tridgeから読み込み）

### 内蔵DB
`data/material_db.json` と `data/bukariki_db.json` は空の`[]`。
トリッジを装着することで材料DBが有効になる。

## ナレッジDB（knowledge-db.js）

- IndexedDB `estimate-knowledge` に見積実績を蓄積（キャッシュ層）
- Excel出力時に自動登録（プロジェクト情報 + 全工種の全品目明細）
- `knowledgeDB.searchSimilar()`: 構造/種別/用途/面積で類似物件検索（スコア3以上を返却）
- `knowledgeDB.buildRecord()`: 現在の見積データからナレッジレコードを構築
- 見積自動作成: 類似物件の品目を面積比でスケーリングして自動投入（AUTO_NAMES行は除外）
- `knowledgeDB.setExcluded(id, bool)`: 自動見積りから除外するフラグ管理

### 永続化アーキテクチャ（移行中）
**現状の問題**: IndexedDBはブラウザのキャッシュクリアで消失するため、データの安全な蓄積には不十分。

**目標: Excel（knowledge_db.xlsx）を唯一の正データとする2層構造**
```
[登録時] IndexedDB に保存 + knowledge_db.xlsx を更新ダウンロード
[起動時] knowledge_db.xlsx を読み込んで IndexedDB に復元
[OneDrive保存] → 自動クラウドバックアップ + 複数PC共有
```
- 詳細は `ARCHITECTURE.md` セクション5・6を参照

### 本丸EXインポート（honmaru-import.js）
過去物件の3ファイルセット（見積明細チェックリスト / 実行予算書(表紙総括表) / 実行予算書(機器)）を
ブラウザ上で解析し、ナレッジDBに直接インポートする機能。
- フォルダ選択UIで1物件または複数物件の親フォルダを指定
- 構造・坪数・㎡数のみ手入力が必要（ファイルから取得不可）
- 解析元フォルダ: `OneDrive/見積りソフト作成プロジェクト/過去物件明細/`
- 関数プレフィックス: `hm`（`hmParseChecklist` / `hmParseSummary` / `hmParseKiki`）

### 自動バックアップ（実装済み）
- **タイミング**: Excel出力のたびに `knowledgeDB.autoBackup()` が自動実行
- **出力**: `knowledge_db.xlsx`（固定名・6シート構成）がダウンロードされる
- **OneDrive保存**: ユーザーがOneDriveフォルダに保存 → クラウドバックアップ＆複数PC共有
- **起動時復元チェック**: DB件数0件 + 最終バックアップ記録がある場合に復元バナーを表示

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

## 全体アーキテクチャ

詳細は **`ARCHITECTURE.md`** を参照（全体コンセプト・データフロー・ナレッジDB設計・実装予定）。

## 汎用化フェーズ計画

### Phase 1 ✅ 完了：Tridge主導アーキテクチャへの移行
- CATEGORIES・BUKARIKI_DEFAULTS を data.js から削除
- 工種マスタ・設定マスタ・キーワードマスタの読み込みを excel-loader.js に実装
- labor.js をTRIDGE_KEYWORDS参照型に書き換え
- 銅建値補正UIを設定マスタ連動に

### Phase 2 ✅ 完了：AUTO_NAMES・calc-engine テンプレートの動的化
- 工種マスタに「自動計算行」列を追加（パイプ区切り）→ db-manager側で編集・エクスポート
- excel-loader.js: `autoRows` フィールドを配列に変換して `activeCategories[*].autoRows` に格納
- calc-engine.js: `addAutoCalcRows` / `calcAutoRows` が `activeCategories[*].autoRows` を優先参照
- 後方互換: autoRowsが未設定の工種はAUTO_NAMESのフォールバックテンプレートを使用

### Phase 3：軽量化・分離
- ~~PERF_DBをdata.jsから完全削除~~ ✅ 完了
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
    ├── data.js                    ← 定数・グローバル変数・共通ユーティリティ（norm/esc/genId）
    ├── knowledge-db.js            ← ナレッジDB（IndexedDB CRUD + Excel/JSON入出力 + 見積自動作成）
    ├── honmaru-import.js          ← 本丸EXインポート（3ファイル解析→ナレッジDB登録）
    ├── labor.js                   ← 労務費計算（TRIDGE_KEYWORDS参照型）
    ├── material-search.js         ← 材料検索モーダル
    ├── calc-engine.js             ← 見積計算エンジン（自動計算行の追加・雑材料費等）
    ├── excel-loader.js            ← トリッジ読み込み（資材/工種/設定/キーワード4シート対応）
    ├── excel-template-export.js   ← テンプレート方式Excel出力（テンプレート読み込み→データ書き込み）
    ├── saved-estimates.js         ← 見積番号採番・複数スロット保存/読み込み/バックアップ
    ├── ai-features.js             ← AI設定・Claude API・たたき台/仕入れインポート/単価調査/掛率チェック
    ├── app.js                     ← メインUIロジック（exportEstimate: ExcelJS優先→SheetJSフォールバック）
    └── tridge-manager.js          ← Tridgeマスタ管理UI（db-manager統合、tmプレフィックス）
```

### スクリプト読み込み順（index.html）
```
SheetJS CDN → ExcelJS CDN
→ data.js → knowledge-db.js → honmaru-import.js → labor.js → material-search.js → calc-engine.js
→ excel-loader.js → excel-template-export.js
→ saved-estimates.js → ai-features.js → app.js
→ JSZip CDN → tridge-manager.js
```

## 重要な実装メモ

- `norm(s)`: NFKC正規化で全角/半角統一 → data.jsで定義、全ファイルで使用
- `esc(s)`: フルHTMLエスケープ（&/</>/") → data.jsで定義、全ファイルで使用
- `genId()`: ユニークID生成 → data.jsで定義、全ファイルで使用
- `cache: 'no-store'`: app.jsのfetch呼び出しに設定（ブラウザキャッシュ防止）
- `getCol(row, ...names)`: excel-loader.jsの柔軟な列名検索（グローバル）
- `activeCategories`: Tridge装着時に `applyTridgeCategories()` で上書き、localStorageに保存
- 銅建値補正: `TRIDGE_SETTINGS.copperEnabled === true` の時のみ有効（Tridge設定マスタ連動）
- `isCableItem()`: TRIDGE_KEYWORDS の copperLinked フラグで判定（ハードコードなし）
- `miscRate`: activeCategories[*].miscRate に格納（工種マスタの「雑材料率%」列）
- `getCatTotal(catId)`: 品目金額の合計（items配列のamountを集計）
- `getCatAmount(catId)`: 割合モード込みの金額（rateModeの場合は前工種合計×割合%で算出）
- `exportEstimate()`: async関数、ExcelJS版を試行→失敗時SheetJSフォールバック→ナレッジDB自動登録
- **tridge-manager.js の命名規則**: 状態変数・関数は `tm` プレフィックス、HTML要素IDは `tm-` プレフィックス
- **tmLoadToEstimate()**: TridgeデータをDeckグローバル変数に直接書き込む（Excelエクスポート不要）

## 外部ライブラリ（CDN）

- **SheetJS** (`xlsx@0.18.5`): トリッジ読み込み・フォールバック用Excel出力
- **ExcelJS** (`exceljs@4.4.0`): テンプレート方式Excel出力（メイン）
- **JSZip** (`jszip@3.10.1`): tridge-manager.js のXLSXエクスポートに使用
- npm `exceljs`: テンプレート生成スクリプト用（`node_modules/`、.gitignore済み）

---

## クラウド公開・マルチデバイス対応・サービス化ロードマップ

### 背景

現在のestimate-appは静的サイト（HTML+JS）でGitHub Pagesから配信中。
データはブラウザのlocalStorageに保存されるため、以下の課題がある：

- デバイス間でデータが同期されない（PC/スマホ/iPadそれぞれ別データ）
- ブラウザのキャッシュ削除でデータが消える
- APIキーがブラウザ側に露出している

### 関連プロジェクト

- **議事録アプリ** (`C:\Users\pal19\Projects\preparing-meeting`)
  - FastAPI + React + SQLite 構成で、サーバーサイド完備済み
  - PDF生成・Markdown編集・履歴機能あり
  - こちらも同じロードマップで進行中

### Phase 1: 現状（完了）

- ✅ アプリの基本機能が動作
- ✅ GitHub Pagesで公開中
- ✅ 自分だけのローカル/ブラウザ利用

### Phase 2: クラウドデプロイ（自分がどこからでも使える）

- サーバー構成への移行
  - バックエンド追加（FastAPI + SQLite or PostgreSQL）
  - データをサーバー側DBに保存（localStorage依存からの脱却）
  - APIキーをサーバー側で管理（ブラウザに露出させない）
- Railway にデプロイ
  - 議事録アプリと同じRailwayアカウントで運用可能
  - 2アプリ合計で月$5枠内に収まる見込み
- スマホ・iPad・別PCから同じデータにアクセス可能に

### Phase 3: 身内・友人への公開

- ログイン機能を追加（ユーザー認証）
- ユーザーごとのデータ分離（AさんはAさんの見積だけ見える）
- トリッジ（Tridge）のユーザー別管理

### Phase 4: 有料サービス化

- 想定価格: 月500円/ユーザー
- 収支シミュレーション:
  - ユーザー5人: 収入2,500円 - 支出約1,250〜2,250円 = 利益250〜1,250円
  - ユーザー10人: 収入5,000円 - 支出約1,500〜3,000円 = 利益2,000〜3,500円
- 追加で必要なもの:
  - 支払い管理（Stripe等の決済サービス）
  - 利用規約・プライバシーポリシー
  - サポート体制

### デプロイ先候補

| サービス | 月額 | 特徴 |
|---|---|---|
| Railway | $5〜 | GitHubと連携して自動デプロイ。おすすめ |
| Render | 無料枠あり | 無料枠は起動が遅い |
| Vercel + 外部DB | 無料〜 | フロントエンド向き |

### 費用構成（議事録アプリと共通）

| 費用 | 何に払う | 目安 |
|---|---|---|
| Railway | アプリを動かすサーバー代 | 月$5〜10（2アプリ合計） |
| Anthropic API | Claude AIの利用料 | 使った分だけ（従量課金） |
| ドメイン（任意） | 独自URL | 年1,000〜2,000円 |
