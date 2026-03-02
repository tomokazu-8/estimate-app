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

## トリッジのExcel構成

```
トリッジ（Excel）
├── 資材マスタ     — 材料マスタ（品目名称/規格/単位/基準単価/原価/原価率/歩掛/カテゴリ）
├── 工種マスタ     — 工種カテゴリ定義（Phase 1で実装）
├── 設定マスタ     — アプリ動作パラメーター（Phase 1で実装）
└── 労務単価マスタ  — 将来実装予定
```

### 設定マスタのパラメーター
| パラメーター | 説明 |
|------------|------|
| 銅建値補正 | 有効/無効（電気・空調トリッジのみ有効） |
| 銅建値基準（円/kg） | トリッジ作成時点の基準銅建値 |
| 銅連動率 | 材料価格に占める銅コスト比率 |
| 労務売単価（円/人工） | 労務費計算用 |
| 労務原価単価（円/人工） | 労務費計算用 |

## 現在の実装状態（Phase 0 完了）

### 完成済み機能
- トリッジ（Excel）の読み込み（excel-loader.js）
- 材料検索モーダル（material-search.js）
- 労務費自動計算（labor.js）※現在は電気専用ロジック
- 見積計算エンジン（calc-engine.js）
- 銅建値補正機能（app.js内）
- Excel出力
- 実績DB参照（PERF_DB）
- 工種の追加・有効/無効切り替え

### 内蔵DB
`data/material_db.json` と `data/bukariki_db.json` は空の`[]`。
トリッジを装着することで材料DBが有効になる。

## 汎用化フェーズ計画

### Phase 1（次に着手）：工種マスタをトリッジに移行

**変更内容：**
1. `excel-loader.js` に工種マスタ・設定マスタの読み込み処理を追加
2. `data.js` のCATEGORIES固定値を削除 → トリッジから動的ロード
3. 銅建値補正UIをトリッジ設定マスタで動的に表示/非表示
4. トリッジ未装着時は「工種が定義されていません」と表示

**削除・変更対象：**
- `data.js` の `CATEGORIES`（9種固定）→ 動的に
- `data.js` の `AUTO_CALC.copperBase/copperFraction` → 設定マスタへ
- `data.js` の `BUKARIKI_DEFAULTS` → トリッジ依存に（Phase 2）

**変更しないもの（Phase 1では触らない）：**
- `labor.js`（電気専用ロジック）→ Phase 2で汎用化
- `PERF_DB`（八友電工の実績DB）→ Phase 3で分離
- `AUTO_NAMES`（自動計算行名称）→ Phase 2で動的化

### Phase 2：労務費計算の汎用化
- `labor.js` の電気専用キーワードを廃止
- 歩掛はすべてトリッジのDB値のみ（自動判定廃止）
- AUTO_NAMESも工種マスタで定義

### Phase 3：軽量化・分離
- PERF_DBを八友電工専用ファイルに分離
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
    ├── app.js              ← メインUIロジック（1016行）
    ├── calc-engine.js      ← 見積計算エンジン
    ├── data.js             ← 定数・データモデル（CATEGORIES等）
    ├── excel-loader.js     ← トリッジ読み込み・Excelエクスポート
    ├── labor.js            ← 労務費計算（現在電気専用）
    └── material-search.js  ← 材料検索モーダル
```

## 重要な実装メモ

- `norm(s)`: NFKC正規化で全角/半角統一 → data.jsで定義、全ファイルで使用
- `cache: 'no-store'`: app.jsのfetch呼び出しに設定（ブラウザキャッシュ防止）
- `getCol(row, ...names)`: excel-loader.jsの柔軟な列名検索
- `activeCategories`: localStorage保存（旧データは起動時にマイグレーション）
- 銅建値補正: ケーブル行の金額をリアルタイム自動調整（現在は常時有効）
