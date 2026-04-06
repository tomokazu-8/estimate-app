# estimate-app 全体アーキテクチャ

> 最終更新: 2026-04-02

---

## 1. 全体コンセプト

```
┌─────────────────────────────────────────┐
│              Deck（本体）                │
│  estimate-app / GitHub Pages で動作     │
│  業種固有の知識を一切持たない            │
└──────────────┬──────────────────────────┘
               │ 差し込む
       ┌───────▼────────┐
       │  Tridge（Excel）│  ← 工種マスタ/資材マスタ/設定マスタ/キーワードマスタ
       └────────────────┘
```

- **Deck** = ゲーム機本体（プラットフォーム）= コネクタの雌側
- **Tridge** = ゲームカセット（Excel）= コネクタの雄側
- Tridgeを差し替えるだけで電気・空調・給排水・建築など任意業種に対応

---

## 2. UIパネル構成

サイドバーの3セクション・6パネル構成。AI・資材検索・保存管理はモーダルで提供。

```
[サイドバー]
  見積 ─────────────────────────
  ├── 物件情報 (project)   ← 得意先・工事名・構造・面積等
  ├── 内訳書   (summary)   ← 工種一覧の金額サマリー・Excel出力
  └── 明細入力 (items)     ← 品目の入力・計算・工種タブ切替

  参照 ─────────────────────────
  ├── 類似物件   (reference)  ← ナレッジDBから類似物件を検索
  └── 妥当性チェック (check)  ← 掛率・単価の妥当性検証

  データ ────────────────────────
  ├── ナレッジDB (database) ← 実績データ管理・本丸インポート・自動作成
  └── Tridgeマスタ (tridge) ← 工種/資材/設定マスタの管理・Deckへの適用
```

### モーダルで提供される機能
- **資材検索** (material-search.js) — 品目名入力時にDBから候補表示
- **AI提案** (ai-features.js) — AI提案作成（単価調査・掛率チェック廃止済み、仕入れ取込はTridgeマスタ内）
- **保存済み見積** (saved-estimates.js) — 複数スロット保存/読み込み
- **API設定** (ai-features.js) — Claude APIキーの設定
- **本丸インポート** (honmaru-import.js) — 過去物件フォルダ→ナレッジDB

---

## 3. モジュール構成と責務

### スクリプト読み込み順（index.html）

```
[CDN] SheetJS → ExcelJS
  ↓
data.js          — グローバル変数・共通ユーティリティ（norm/esc/genId）
  ↓
knowledge-db.js  — ナレッジDB（IndexedDB CRUD + Excel/JSON入出力）
honmaru-import.js — 本丸EXインポート（ブラウザ内解析）
  ↓
labor.js         — 労務費・歩掛計算（TRIDGE_KEYWORDS参照型）
material-search.js — 材料検索モーダル
calc-engine.js   — 自動計算行・雑材料費・運搬費エンジン
  ↓
excel-loader.js  — Tridge読み込み（4シート対応）
excel-template-export.js — テンプレート方式Excel出力（ExcelJS IIFE）
  ↓
saved-estimates.js — 見積番号採番・保存/読み込み
ai-features.js   — Claude API・AI提案作成
app.js           — メインUIロジック（~1600行）
  ↓
[CDN] JSZip
  ↓
tridge-manager.js — Tridgeマスタ管理UI（db-manager統合）
```

### 各モジュールの責務

| ファイル | 責務 | 主要な公開API |
|---------|------|--------------|
| `data.js` | グローバル変数定義・共通関数 | `norm()` `esc()` `genId()` `downloadBlob()` `normItemKey()` |
| `knowledge-db.js` | ナレッジDBのCRUD・入出力 (IIFE) | `knowledgeDB.save()` `.getAll()` `.searchSimilar()` `.buildRecord()` `.exportXLSX()` `.importFile()` `.autoBackup()` `.setExcluded()` `.clearAll()` `.replaceFromFile()` `.getClientItemHistory()` |
| `honmaru-import.js` | 本丸EX 3ファイルの解析・ナレッジDB登録 | `honmaruOpenModal()` `honmaruHandleFiles()` `honmaruImportConfirm()` |
| `labor.js` | 品目ごとの歩掛検索・労務費計算 | `findBukariki(name, spec)` `calcLaborBreakdown(catId)` |
| `material-search.js` | 資材DB検索モーダル・候補表示 | `openSearchModal(itemId)` `searchMaterial()` `showSuggestions()` `filterMaterialsByTerms()` |
| `calc-engine.js` | 自動計算行追加・運搬費算出 | `addAutoCalcRows()` `calcAutoRows()` `calcTransport()` |
| `excel-loader.js` | Tridge（Excel）の読み込み・適用 | `loadExcelDB(file)` `getCol(row, ...names)` `showDbOverlay()` `updateDbStatus()` |
| `excel-template-export.js` | テンプレートへのデータ書き込み (IIFE) | `ExcelTemplateExport.exportFormatted()` |
| `saved-estimates.js` | 見積のバージョン管理・保存・読み込み・採番 | `generateEstimateNo()` `saveEstimate()` `saveAsNewBranch()` `loadSavedEstimate(id)` `setFinal(id)` `openSavedEstimatesModal()` |
| `ai-features.js` | Claude API呼び出し・AI機能 | `callClaude()` `aiDraftEstimate()` `aiQueryItem()` `checkSellRates()` `openSupplierImportModal()` |
| `app.js` | メインUI・イベント処理・工種合計計算 | `navigate()` `renderItems()` `exportEstimate()` `getCatTotal()` `getCatAmount()` `applyTridgeCategories()` `recalcAll()` `showToast()` `formatNum()` |
| `tridge-manager.js` | Tridgeマスタ管理・Deckへの適用 | `tmInit()` `tmLoadToEstimate()` |

---

## 4. データフロー

### 見積作成フロー

```
Tridgeを読み込む（excel-loader.js: loadExcelDB）
  → activeCategories に工種マスタを展開
  → MATERIAL_DB に資材マスタを展開
  → TRIDGE_KEYWORDS にキーワードマスタを展開
  → TRIDGE_SETTINGS に設定マスタを展開
  ↓
見積入力（app.js）
  → 品目を手入力 or 資材検索（openSearchModal）で追加
  → labor.js（findBukariki）が品名から歩掛を特定
  → calc-engine.js（addAutoCalcRows / calcAutoRows）が自動計算行・雑材料費・運搬費を算出
  ↓
Excel出力（app.js: exportEstimate）
  → ExcelTemplateExport.exportFormatted() でテンプレート書き込み
  → knowledgeDB.buildRecord() + save() でナレッジDBに自動登録
  → knowledgeDB.autoBackup() で knowledge_db.xlsx をダウンロード
```

### 見積保存・修正・流用フロー

```
新規作成
  → generateEstimateNo() → 1111-01（新規基番号-枝番01）
  → 入力・編集
  ├── 💾 上書き保存（saveEstimate）
  │     → 同じ 1111-01 の中身を更新（savedAt のみ更新）
  │     → 用途: 作業中断→再開、誤入力の修正
  │
  ├── 📝 版を上げて保存（saveAsNewBranch）
  │     → 1111-02 として新規保存（1111-01 はそのまま残る）
  │     → 用途: 得意先への再提出、仕様変更対応
  │
  ├── ★ 本見積にする（setFinal）
  │     → 1111-02 に isFinal=true をセット
  │     → 同一基番号(1111)の他版は isFinal=false に自動変更
  │     → 用途: この版が正式見積であることを明示
  │
  └── 📋 流用して新規作成（loadSavedEstimate + copy mode）
        → 2222-01 として新規基番号で保存
        → 用途: 類似物件の見積を別物件として作成

Excel出力（exportEstimate）
  → ナレッジDB自動登録（isFinal フラグも伝播）
```

### 本丸EXインポートフロー

```
ナレッジDBパネル → 本丸インポートボタン → フォルダ選択（honmaru-import.js）
  ├── 見積明細チェックリスト.xls  → hmParseChecklist() → 品目明細・労務単価
  ├── 実行予算書(表紙総括表).xls → hmParseSummary()   → プロジェクト情報・工種サマリ
  └── 実行予算書(機器).xls      → hmParseKiki()      → 機器明細・掛率
  ↓
プレビュー表示（構造・坪数・㎡数を手入力）
  ↓
honmaruImportConfirm() → knowledgeDB.save() でナレッジDBに登録
```

### 自動見積作成フロー

```
ナレッジDBパネルで「実績から自動作成」（app.js: autoCreateEstimate）
  → knowledgeDB.searchSimilar() で類似物件検索
    （構造/種別/用途/面積でスコア3以上を抽出）
  → 類似物件の品目を面積比でスケーリング
  → 現在の工種マスタに品目を自動投入（AUTO_NAMES行は除外）
  → 明細入力パネルへ遷移（navigate('items')）
```

---

## 5. ナレッジDBの設計

### 永続化アーキテクチャ（案A: Excel永続化 実装済み）

```
[本丸インポート / 見積Excel出力]
        ↓ 登録
  IndexedDB（高速アクセス用キャッシュ）
        ↓ 同時に
  knowledge_db.xlsx（6シート構成）を自動ダウンロード
        ↓ ユーザーがOneDriveフォルダに保存
  OneDrive自動同期 → クラウドバックアップ

[次回アプリ起動時]
  IndexedDB空 → 復元バナー表示 → knowledge_db.xlsx を選択
  → importXLSX() でIndexedDBに完全復元
  → どのPCからでも同じデータで作業可能
```

### knowledge_db.xlsx のシート構成（6シート）

| シート名 | 内容 | 行数 |
|----------|------|------|
| 物件マスタ | 物件1件=1行。全プロジェクト情報+金額サマリー（37列） | 物件数 |
| 工種サマリ | 物件×工種ごとに1行。金額・粗利・工数（12列） | 物件数×工種数 |
| 明細データ | 品目1件=1行。集計コード・原価・歩掛・備考含む（19列） | 全品目数 |
| 機器明細 | 機器1品目=1行。定価・掛率・原価（14列） | 全機器数 |
| 労務単価 | 物件×職種ごとに1行（4列） | 物件数×職種数 |
| 分析 | 読み取り専用サマリー。㎡単価・坪単価（11列） | 物件数 |

### importXLSX() の対応フォーマット（自動検出）

| 形式 | 検出条件 | ピボットキー | `source`値 |
|------|---------|------------|------------|
| 集約ファイル（katsuyo） | `物件ヘッダー`シートあり | `見積番号` | `'katsuyo'` |
| knowledge_db.xlsx（新形式） | `物件マスタ`シートあり | `物件ID` | `''`（元の値） |
| レガシー | その他 | `id` | `''` |

工種サマリーシート名: 集約形式=`工種サマリー`（長音符あり）、その他=`工種サマリ`

### ナレッジレコードの構造

```javascript
{
  id,              // IndexedDB自動採番
  registeredAt,    // 登録日（YYYY-MM-DD）。row['登録日'] || row['更新日'] || row['見積日付'] で取得
  source,          // 'honmaru' | 'app' | 'katsuyo'（登録元）
  excluded,        // boolean（自動見積りから除外するフラグ）

  project: {
    number,          // 見積番号
    managementNumber,// 管理番号
    name,            // 物件名
    date,            // 見積日付
    updatedAt,       // 更新日
    client,          // 得意先名
    person,          // 担当者名
    struct,          // 構造（RC/S/W造等）★手入力
    type,            // 種別（新築/改修等）
    usage,           // 用途（住宅/事務所等）
    floors,          // 階数 ★手入力
    areaTsubo,       // 延べ床面積（坪）★手入力
    areaSqm,         // 延べ床面積（㎡）★手入力
    location,        // 施工場所
    workStart,       // 工期_着工日
    workEnd,         // 工期_竣工日
    paymentTerms,    // 支払条件
    validUntil,      // 有効期限
    memo,            // 見積メモ
    usePattern,      // 使用パターン（労務単価種別）
    laborRates,      // { '電工': { sell, cost }, '弱電工': {...}, ... }
  },

  // 金額サマリー
  grandTotal,      // 見積合計
  costTotal,       // 原価合計
  profitRate,      // 粗利率%
  profitTotal,     // 粗利額
  workTotal,       // 工事費合計（諸経費・値引き前）
  miscExpenseAmt,  // 諸経費金額
  miscExpenseCost, // 諸経費原価（本丸インポート時のみ）
  miscExpensePct,  // 諸経費率%
  discountAmt,     // 値引き額
  discountPct,     // 値引き率%
  totalLaborHours, // 総工数（人工）
  legalWelfare,    // 法定福利費

  // 工種別明細
  categories: [{
    name,       // 工種名
    total,      // 見積金額
    costTotal,  // 原価金額
    profitRate, // 粗利率%
    profitAmt,  // 粗利額
    laborHours, // 工数
    qty,        // 数量
    unit,       // 単位
    items: [{
      code,       // 集計コード（101, 162 等）
      name,       // 品名
      spec,       // 規格
      qty,        // 見積数量
      unit,       // 単位
      price,      // 見積単価
      amount,     // 見積金額
      listPrice,  // 定価（機器ファイルから補完）
      sellRate,   // 見積掛率（機器ファイルから補完）
      costQty,    // 原価数量
      costPrice,  // 原価単価
      costRate,   // 原価掛率
      costAmount, // 原価金額
      profitRate, // 利益率%
      bukariki,   // 歩掛
      laborHours, // 工数
      note,       // 備考
    }],
  }],

  // 機器明細（実行予算書(機器)から。本丸インポート時のみ）
  kikiList: [{
    name,       // 品名
    spec,       // 規格
    unit,       // 単位
    qty,        // 数量
    basePrice,  // 基準単価
    listPrice,  // 定価
    sellRate,   // 見積掛率%
    sellPrice,  // 見積単価
    sellAmount, // 見積金額
    costRate,   // 原価掛率%
    costPrice,  // 原価単価
    costAmount, // 原価金額
    targetCost, // 目標原価
  }],
}
```

---

## 6. 見積バージョン管理の設計

### コンセプト

```
1つの物件に対して複数の版（バージョン）を管理し、
どの版が本見積（正式版）かを一目で判別できるようにする。
```

### 見積番号の構造

```
  1111 - 02
  ├──┘   └── 枝番（branch）: 同一物件の版番号
  └──────── 基番号（baseNo）: 物件を識別するグループキー
```

- **基番号**: 新規物件ごとに採番。流用時も新規基番号。
- **枝番**: 同一物件の修正回数。01 → 02 → 03 と増える。
- **本見積フラグ（isFinal）**: 同一基番号の中で1つだけ true。

### 保存済み見積のデータ構造

```javascript
{
  id:       "1712345678901",    // 一意ID（Date.now()）
  baseNo:   "1111",             // 基番号（グループキー）
  branch:   2,                  // 枝番
  isFinal:  true,               // ★本見積フラグ
  savedAt:  "2026-04-02T...",   // 保存日時
  project:  {                   // 物件情報
    number: "1111-02",          // 見積番号（= baseNo + '-' + branch）
    name: "山田邸 電気設備工事",
    client: "○○建設", ...
  },
  items:    { cat001: [...], ... },  // 工種別品目明細
  itemIdCounter: 123
}
```

### 既存データとの後方互換

baseNo / branch / isFinal を持たない既存保存データは、
読み込み時に `project.number` から自動補完する。

```javascript
function migrateEstimate(est) {
  if (!est.baseNo) {
    const m = (est.project?.number || '').match(/^(\d+)-(\d+)$/);
    if (m) {
      est.baseNo = m[1];
      est.branch = parseInt(m[2]);
    } else {
      est.baseNo = est.project?.number || est.id;
      est.branch = 1;
    }
  }
  if (est.isFinal === undefined) est.isFinal = false;
  return est;
}
```

### 操作と動作

| 操作 | 基番号 | 枝番 | 本見積 | 説明 |
|------|--------|------|--------|------|
| 新規作成 | 新規採番 | 01 | false | 作成中はまだ本見積ではない |
| 上書き保存 | 変更なし | 変更なし | 変更なし | 同じ版の内容を更新 |
| 版を上げて保存 | 同じ | +1 | false | 旧版はそのまま残る |
| 本見積にする | — | — | true | 同一基番号の他版は自動で false |
| 流用して新規作成 | 新規採番 | 01 | false | 別物件として新規扱い |

### 保存済み見積一覧のUI

ツールバーで**表示切替**（更新日順 / 得意先別）と**検索・フィルタ**を提供する。
どちらの表示でも、同一基番号の版は折りたたみグループで表示する。

```
保存済み見積一覧
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 [検索: 得意先・物件名・見積番号      ]  表示: [更新日順 ▼]  [本見積のみ ☐]
                                                ├ 更新日順
                                                └ 得意先別
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 更新日順（デフォルト）

最終更新日が新しい物件グループが上に来る。直近の作業にすぐアクセスできる。

```
▼ 1111  山田邸 電気設備工事  ○○建設    04/02  3版
  ★ 1111-03  本見積  04/02  ¥2,450,000  [開く] [Excel出力]
     1111-02          03/28  ¥2,380,000  [開く]
     1111-01          03/20  ¥2,100,000  [開く]

▼ 3333  佐藤マンション  △△工務店       04/01  1版
     3333-01          04/01  ¥3,200,000  [開く] [★本見積にする]

▼ 2222  田中ビル 照明改修  □□建設      03/28  2版
  ★ 2222-02  本見積  03/28  ¥900,000   [開く] [Excel出力]
     2222-01          03/15  ¥850,000   [開く]
```

#### 得意先別

得意先ごとにグループ化。「あの得意先の過去見積」を探すときに使う。

```
▼ ○○建設（2物件）
  ▼ 1111  山田邸 電気設備工事        04/02  3版 ★
  ▼ 4444  鈴木邸 電気工事            03/15  1版 ★

▼ △△工務店（1物件）
  ▼ 3333  佐藤マンション            04/01  1版

▼ □□建設（1物件）
  ▼ 2222  田中ビル 照明改修          03/28  2版 ★
```

#### 検索・フィルタ

| 機能 | 動作 |
|------|------|
| 検索ボックス | 得意先名・物件名・見積番号をインクリメンタル検索 |
| 「本見積のみ」チェック | isFinal=true の版を持つ物件グループのみ表示 |
| 表示切替 | 更新日順 ↔ 得意先別をワンクリックで切り替え |

### 見積編集中のヘッダーUI

```
┌─────────────────────────────────────────────┐
│  見積番号: 1111-02          ★本見積         │
│  山田邸 電気設備工事                         │
│                                              │
│  [💾 上書き保存] [📝 版上げ保存] [★ 本見積]  │
└─────────────────────────────────────────────┘
```

### ナレッジDBとの連携

Excel出力時にナレッジDBへ自動登録する際、isFinal フラグを伝播する。

```
Excel出力
  → knowledgeDB.buildRecord()
    → record.isFinal = 現在の見積の isFinal 値
  → knowledgeDB.save(record)
```

ナレッジDBの類似物件検索（searchSimilar）では、
isFinal=true のレコードを優先的にスコアリングする（将来拡張）。

---

## 7. データ永続化の設計

| データ | 保存場所 | 消失リスク | 復元方法 |
|--------|---------|-----------|----------|
| 工種マスタ・設定 | localStorage | ブラウザ設定リセットで消失 | Tridgeを再読み込み |
| 現在の見積 | localStorage | 同上 | `hachitomo_estimate` キー |
| 保存済み見積 | localStorage | 同上 | バックアップJSONから復元 |
| ナレッジDB（実績） | IndexedDB + knowledge_db.xlsx | IndexedDB消失は復元可能 | knowledge_db.xlsx から復元 |
| Excelテンプレート | `data/estimate_template.xlsx` | 永続（ファイル） | GitHubから再取得 |
| Tridgeファイル | ユーザーのPC | 永続（ファイル） | db-managerで再生成 |

### ナレッジDB永続化の実装状況

| ステータス | 内容 |
|-----------|------|
| ✅ 実装済み | **案A**: knowledge_db.xlsx（6シート）のエクスポート / インポート / 自動バックアップ |
| 未実装 | **案B**: File System Access API でOneDriveフォルダ直接読み書き（ダウンロード操作不要に） |

---

## 8. 外部依存

| ライブラリ | バージョン | 用途 |
|-----------|----------|------|
| SheetJS | xlsx@0.18.5 | Tridge読み込み・フォールバックExcel出力・本丸インポート・ナレッジDB入出力 |
| ExcelJS | exceljs@4.4.0 | テンプレート方式Excel出力（メイン） |
| JSZip | jszip@3.10.1 | tridge-manager.jsのXLSXエクスポート |
| Claude API | claude-sonnet-4-6 | AI提案作成 |

---

## 9. 重要な設計ルール

- **Deckに業種固有知識を持たせない** → 全てTridgeに委ねる
- **コネクタ仕様（Tridgeシート構成）を安易に変えない** → 既存Tridgeが全て使えなくなる
- **globalスコープの命名規則**:
  - tridge-manager.js: 関数・変数は `tm` プレフィックス、HTML IDは `tm-` プレフィックス
  - honmaru-import.js: 関数・変数は `hm` プレフィックス
- **共通ユーティリティ**（data.jsで定義、全モジュールで使用）:
  - `norm(s)`: NFKC正規化（全角/半角統一）
  - `esc(s)`: HTMLエスケープ（XSS防止）
  - `genId()`: ユニークID生成
  - `downloadBlob(blob, filename)`: ファイルダウンロード（revokeURL遅延付き）
  - `normItemKey(name, spec)`: 品目の正規化キー生成（検索用）
  - `createBlankItem(overrides)`: 品目オブジェクトの雛型生成（全フィールドのデフォルト値を一元管理）
  - `resolveBukariki(name, spec, explicitValue)`: 歩掛解決（明示値→DB検索の優先順位）
  - `getLaborNames(catId)`: 工種ごとの自動計算行名称・有効フラグを取得
- **IIFE パターン**: `knowledge-db.js`（knowledgeDB）と `excel-template-export.js`（ExcelTemplateExport）はIIFEでカプセル化。他のモジュールはグローバル関数。

---

## 10. 今後の実装予定

| 優先度 | 内容 | ステータス |
|--------|------|-----------|
| ~~高~~ | ~~見積バージョン管理（基番号+枝番+本見積フラグ）~~ | ✅ 実装済み |
| ~~高~~ | ~~自動計算行の完全自動化（ボタン廃止）~~ | ✅ 実装済み |
| ~~高~~ | ~~労務費・経費名の工種別カスタマイズ + 有効/無効フラグ~~ | ✅ 実装済み |
| ~~中~~ | ~~法定福利費・値引き~~ | ✅ 実装済み |
| ~~中~~ | ~~ナレッジDB重複防止（upsert + importチェック）~~ | ✅ 実装済み |
| **高** | **Tridgeマスタ大幅拡張** | 次期feature |
|  | ├ 複数Tridge同時適用 + 適用中表示 | 未着手 |
|  | ├ 仕入れ見積のTridgeマスタ統合 | 未着手 |
|  | ├ DB検索 + Tridgeマスタ検索の統合 | 未着手 |
|  | └ サイドバー操作パネル再設計 | 未着手 |
| 中 | ナレッジDB永続化 案B: File System Access API | 未着手 |
| 低 | Tridgeイジェクトボタン | 未着手 |

---

## 11. Tridgeマスタ拡張設計

### 現状の問題

```
現在のTridgeマスタ
├── Tridgeリスト（左ペイン）: 複数のTridgeを管理
├── 編集UI（右ペイン）: 資材/工種/労務/キーワード/分類の5タブ
├── 「Deckに適用」: 1つのTridgeのみ適用可能（前のTridgeは上書き）
└── 仕入れ見積インポート: 明細ツールバーの別ボタン（AI解析）

問題:
1. 資材Tridgeと工種Tridgeが別ファイルの場合、どちらか一方しか適用できない
2. 仕入れ見積の品目がTridgeマスタと分離していて管理しづらい
3. DB検索は MATERIAL_DB（適用中Tridge）のみ。未適用のTridgeは検索できない
4. 適用中のTridgeがどれかUIで確認できない
5. サイドバーに物件操作とグローバル操作が混在
```

### ゴール

```
1つの見積に対して「資材Tridge + 工種Tridge + 仕入れ見積」を
組み合わせて適用でき、適用状況が一目でわかる。
品目検索は適用中の全ソースを横断できる。
```

### 11-1. 複数Tridge同時適用

#### 適用スロットの設計

```
Deck（見積本体）
├── 工種スロット: 工種マスタ + 労務設定 + キーワード（1つ）
├── 資材スロット: 資材マスタ + カテゴリ + 分類（1つ）
└── 仕入れスロット: 仕入れ業者見積（複数可）
```

- **工種スロット**: 工種マスタ・労務単価・キーワードマスタを保持するTridge。同時に1つ
- **資材スロット**: 資材マスタ・カテゴリマスタ・分類マスタを保持するTridge。同時に1つ
- **仕入れスロット**: 仕入れ業者の見積書をAI解析した品目リスト。複数同時に適用可能

#### 適用状態の管理

```javascript
// グローバル変数（data.js に追加）
let TRIDGE_APPLIED = {
  koshu:   null,  // { tridgeId, tridgeName } 工種Tridge
  zairyo:  null,  // { tridgeId, tridgeName } 資材Tridge
  suppliers: [],  // [{ tridgeId, tridgeName, itemCount }] 仕入れ見積
};
```

#### 適用中Tridgeの表示UI

Tridgeマスタパネルのヘッダーに適用状態バッジを表示：

```
Tridgeマスタ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  適用中: 🏷 工種: 電気設備工事_v1  [✕]
          🏷 資材: 電気資材_v2      [✕]
          🏷 仕入: ○○電材(25品目)  [✕]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 適用・イジェクトの操作

| 操作 | 動作 |
|------|------|
| Tridge選択 → 「工種として適用」 | 工種スロットに適用（前の工種Tridgeは解除） |
| Tridge選択 → 「資材として適用」 | 資材スロットに適用（前の資材Tridgeは解除） |
| 仕入れ見積 → 「仕入れとして追加」 | 仕入れスロットに追加（複数可） |
| バッジの [✕] | 該当スロットをイジェクト |

### 11-2. 仕入れ見積のTridgeマスタ統合

#### 現状のフロー

```
明細ツールバー → 「📋 仕入れ見積」→ AIが解析 → 品目を直接明細に投入
（Tridgeマスタとは無関係、品目データは保存されない）
```

#### 新しいフロー

```
Tridgeマスタ → 「📋 仕入れ見積読み込み」→ AIが解析
  → Tridgeマスタのリストに「仕入れ: ○○電材」として保存
  → 資材と同じように中身を閲覧・編集可能
  → 「仕入れとして適用」→ 品目が MATERIAL_DB に追加される
  → 明細入力のDB検索から仕入れ品目も検索可能に
```

#### Tridgeリストの種別

```
Tridgeマスタ（左ペイン）
├── [工種] 電気設備工事_工種_v1      ← 工種マスタ入り
├── [資材] 電気設備工事_資材_v2      ← 資材マスタ入り
├── [仕入] ○○電材 2026/04/02       ← AI解析済み仕入れ見積
└── [仕入] △△商事 2026/03/25       ← AI解析済み仕入れ見積
```

各Tridgeに `type` フィールドを追加：

```javascript
// tmDbList の各エントリ
{
  id: "xxx",
  name: "○○電材 2026/04/02",
  type: "supplier",  // "koshu" | "zairyo" | "mixed" | "supplier"
  memo: "仕入れ見積 AI解析 (25品目)",
  rowCount: 25,
  updatedAt: "..."
}
```

#### AIによる仕入れ品目の分類・歩掛設定

仕入れ見積のExcel/PDFをAIで解析する際に：

1. **品目名の正規化**: AIが品名を標準的な名称に変換
2. **カテゴリ分類**: CATEGORY_MASTERのキーワードでカテゴリIDを自動付与
3. **歩掛の推定**: BUKARIKI_DBの近似品目から歩掛を補完（確信度低い場合は0）
4. **単位の補完**: MATERIAL_DBの同名品目から単位を補完

### 11-3. DB検索の統合

#### 現状

```
明細ツールバー「🔍 DB検索」→ MATERIAL_DB（適用中の資材Tridgeのみ）を検索
```

#### 新しいDB検索

```
明細ツールバー「🔍 検索」→ 検索モーダル
  ├── ソース切替: [全ソース ▼]
  │                ├ 全ソース（横断検索）
  │                ├ 資材Tridge: 電気資材_v2
  │                ├ 仕入れ: ○○電材
  │                └ 仕入れ: △△商事
  └── キーワード検索 → 該当品目を一覧表示
```

- **全ソース**: MATERIAL_DB + 全仕入れTridgeの品目を統合検索
- **個別ソース**: 特定のTridge/仕入れ見積のみ検索
- 検索結果に「ソース名」列を追加して出典を明示

### 11-4. サイドバー操作パネルの再設計

#### 現状のサイドバー

```
見積
├── 物件情報
├── 内訳書
└── 明細入力

参照
├── 類似物件
└── 妥当性チェック

データ
├── ナレッジDB
└── Tridgeマスタ

操作（問題箇所）
├── 保存         ← 物件操作
├── 版上げ保存    ← 物件操作
├── 保存済み      ← 全体操作
├── 掛率チェック   ← 物件操作
├── Excel出力     ← 物件操作
└── 最新の変更点   ← 開発者向け
```

#### 新しいレイアウト

```
サイドバー（グローバル操作のみ）
━━━━━━━━━━━━━━━━━━
見積
├── 物件情報
├── 内訳書
└── 明細入力

参照
├── 類似物件
└── 妥当性チェック

データ
├── ナレッジDB
└── Tridgeマスタ

設定
└── AI設定（APIキー）
━━━━━━━━━━━━━━━━━━


トップバー（物件操作バー・常時表示）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1111-02 山田邸 電気設備工事  ★本見積
  [💾 保存] [📝 版上げ] [📊 Excel出力] [📂 保存済み]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


明細ツールバー（工種の品目操作のみ）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  幹線・分電盤設備工事
  [＋行追加] [🔍検索] [✨AI提案] [📋仕入れ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 11-5. 実装順序

| Phase | 内容 | 依存 |
|-------|------|------|
| A | Tridgeリストに type フィールド追加 + 種別バッジ表示 | なし |
| B | 複数スロット適用 + 適用中表示 + イジェクト | A |
| C | 仕入れ見積のTridgeマスタ統合（AI解析→保存→適用） | A, B |
| D | DB検索の統合（ソース切替・横断検索） | B, C |
| E | サイドバー再設計 + 明細ツールバー整理 | D |
