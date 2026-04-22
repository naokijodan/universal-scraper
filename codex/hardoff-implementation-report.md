# Hardoff Implementation Report

## 1. 変更ファイル一覧（各ファイルの変更行数）

`git diff --numstat -- manifest.json content.js default_setting_json.js options.html options.js` の結果:

| ファイル | 追加 | 削除 |
| --- | ---: | ---: |
| `manifest.json` | 14 | 12 |
| `content.js` | 223 | 2 |
| `default_setting_json.js` | 8 | 6 |
| `options.html` | 32 | 0 |
| `options.js` | 11 | 0 |

## 2. 追加した関数・判定ロジックの概要

### `manifest.json`
- `content_scripts[0].matches` に `https://netmall.hardoff.co.jp/*` を追加
- `host_permissions` に `https://netmall.hardoff.co.jp/*` を追加
- `version` を `1.3.2` に更新

### `content.js`
- サイト判定に `netmall.hardoff.co.jp` の商品URL `/product/{数字}` を追加
- 設定読込デフォルトに `enableHardoff: true` と `hardoffLoadDelay: 0` を追加
- 無効化チェックに `enableHardoff` を追加
- ボタン色に `hardoff: { primary: '#FFCC00', hover: '#e6b800' }` を追加
- サイト別待機時間に `hardoffLoadDelay` を追加
- 抽出分岐に `extractHardoffProductData()` 呼び出しを追加
- 新規関数 `extractHardoffProductData()` を追加
  - JSON-LD を安全に収集し `Product` オブジェクトを特定
  - 商品名を DOM → JSON-LD → OGP の優先順で取得
  - 価格を DOM税込表示 → `gtag('event', 'view_item', ...)` の優先順で取得
  - `#panel1` 表、店舗情報、画像キャプションを `description` に統合
  - 画像URLをメイン画像・サムネイル・JSON-LD・OGPから収集し、画像ファイル単位で重複除去
  - 返却スキーマは `{ platform, url, price, name, description, seller, imageUrl }` のみ

### `default_setting_json.js`
- `enableHardoff: true`
- `hardoffLoadDelay: 0`

### `options.html` / `options.js`
- 対応サイト設定に `ハードオフ（オフモール）` の ON/OFF トグルを追加
- 画像読み込み待機時間設定に `hardoffLoadDelay` 入力欄を追加
- `loadSettings()` / `saveSettings()` / トグル表示更新 / changeイベントに `enableHardoff` と `hardoffLoadDelay` を追加

## 3. セレクタの優先順位

### 商品名
1. `.product-detail-name > h1`
2. `.product-detail-name h1`
3. `.product-detail-info h1`
4. JSON-LD `Product.name`
5. `meta[property="og:title"]` を `|` 分割して `parts[1]`、なければ `parts[0]`

### 価格
1. `.product-detail-price__main`
2. `gtag('event', 'view_item', ...)` の `value`
3. JSON-LD `offers.price` は意図的に未使用

### ブランド
1. JSON-LD `brand.name`
2. JSON-LD `brand` 文字列
3. `.product-detail-cate-name`
4. `og:title` の先頭要素

### 型番
1. `#panel1` 内の `型番` 行
2. `.product-detail-num` の `型番：...`

### 店舗名 / 都道府県
1. 店舗名: `.product-detail-store__name`
2. 店舗名: JSON-LD `offers.seller.name`
3. 店舗名: `.product-detail-postage-store__all` の `/` 前半
4. 都道府県: `.product-detail-postage-store__all` の `/` 後半
5. 都道府県: `.product-detail-store__address` から正規表現抽出

### ランク
1. `.product-detail-price__rank img` の `alt`

### 特徴・備考 / その他詳細
1. `#panel1 tr` を走査
2. `特徴・備考` はまとめて `特徴・備考: ...`
3. それ以外は `{th}: {td}` の改行連結

### 画像
1. `.product-detail-images-main__image img`
2. `.product-detail-images-wrapper img`
3. JSON-LD `image`
4. `meta[property="og:image"]`

## 4. 自分で確認した動作

- `node --check content.js` 実行: 構文エラーなし
- `node --check options.js` 実行: 構文エラーなし
- `node --check default_setting_json.js` 実行: 構文エラーなし
- `node -e "JSON.parse(...manifest.json...)"` 実行: `manifest ok`
- `rg` で以下の配線を確認
  - `manifest.json` に `netmall.hardoff.co.jp` が `matches` / `host_permissions` の両方へ追加済み
  - `content.js` に `currentSite = 'hardoff'`、`enableHardoff`、`hardoffLoadDelay`、色設定、抽出呼び出し、新関数が追加済み
  - `options.html` / `options.js` に `enableHardoff` と `hardoffLoadDelay` のUI・保存・復元処理が追加済み
- `/tmp/hardoff-sample.html` を参照し、今回使った主要セレクタ
  - `.product-detail-price__main`
  - `.product-detail-price__rank img`
  - `.product-detail-postage-store__all`
  - `.product-detail-store__address`
  - `.product-detail-images-main__text`
  - `#panel1 tr`
  - `meta[property="og:title"]`
  - `gtag('event', 'view_item', ...)`
  がサンプルHTMLに存在することを確認

## 5. 懸念点・限界

- 実ブラウザでのクリック検証は未実施。今回の確認は静的HTMLと構文チェックが中心
- ローカル環境に `jsdom` が無く、抽出関数をサンプルHTMLへ直接実行する自動検証までは未実施
- 価格の第2優先は `gtag('event', 'view_item', ...)` 依存。将来ハードオフ側が計測スクリプト形式を変えるとフォールバックが効かなくなる
- 都道府県は `.product-detail-postage-store__all` が無い場合、住所文字列から正規表現で推定する
- 送料は動的計算前提のため今回の出力には含めていない
- 画像の重複除去は画像ファイル名ベース。CDN仕様が大きく変わると重複判定精度が落ちる可能性がある

## 6. ユーザーが Chrome で確認すべきテスト手順

1. Chrome の拡張機能管理画面で「とりこみ君」を再読み込みする
2. `https://netmall.hardoff.co.jp/product/数字/` 形式のハードオフ商品ページを開く
3. ハードオフ色のボタンが表示されるか確認する
4. オプション画面で `ハードオフ（オフモール）` の ON/OFF と待機秒数が表示・保存できるか確認する
5. 商品ページでボタンを押し、商品名・税込価格・店舗名・説明文・画像URLが取得できるか確認する
6. 価格取得時に JSON-LD の税抜価格ではなく DOM 表示の税込価格が使われているか確認する

---

## 差し戻し修正（レビュー後）

### 修正1: content.js の catch ブロックの `_log` → `console.error`
- ファイル・行: `content.js:6845` 付近
- 理由: 既存他プラットフォームと揃える。`_log` は本番でエラーが見えなくなる

### 修正2: content.js の OGP フォールバックから `parts[0]` を除去
- ファイル・行: `content.js:6682` 付近
- 理由: `parts[0]` はブランド名。仕様書の厳守事項に抵触

### 修正3: default_setting_json.js を CRLF に統一
- ファイル全体
- 理由: 既存は CRLF、Codex 追加行が LF だったため git diff が汚れていた

### 再検証結果
- `node --check content.js`: 構文エラーなし
- `node --check default_setting_json.js`: 構文エラーなし
- `git diff content.js | head -50`: 差し戻し対象の変更が反映されていることを確認
- `git diff default_setting_json.js`: 意味のある変更は `enableHardoff: true` と `hardoffLoadDelay: 0` の追加2行のみ
