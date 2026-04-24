# 設計書: SPA ナビゲーション MAIN world 修正

**バージョン**: v1.3.5 hotfix
**対象ファイル**: `spa-watcher.js`（新規）、`external-links.js`（修正）、`manifest.json`（修正）
**設計者**: child-a
**作成日**: 2026-04-24

---

## 1. 問題の根本原因

### Chrome content script の world 分離

Chrome MV3 の content script はデフォルトで **ISOLATED world** で動作する。

| 項目 | ISOLATED world | MAIN world |
|------|---------------|------------|
| 実行環境 | content script | ページの JavaScript と同じ |
| `window` オブジェクト | content script 専用の window | ページの window と同一 |
| `history` オブジェクト | content script が見るラッパー | ページが使う実物 |
| DOM イベント（`popstate`, カスタムイベント） | **共有** | **共有** |

### v1.3.5 の設計ミス

`external-links.js`（ISOLATED world）で以下のコードを実行しても、ページの React Router が使う MAIN world の `history` は書き換わらない:

```javascript
// external-links.js 内（ISOLATED world）— 効果なし
history.pushState = function(...args) {  // これは ISOLATED world の history
  _origPushState(...args);
  window.dispatchEvent(new Event('us-url-change'));  // 発火しない
};
```

React Router は MAIN world の `history.pushState` を呼ぶため、ISOLATED world でフックしても検知できない。
実機テストで `🔄 SPA ナビゲーション監視を開始しました` が表示されるが、その後 URL 変化ログが出なかった理由がこれ。

---

## 2. 解決策

### MAIN world content script の使用

Chrome 111+ (MV3) の content_scripts に `"world": "MAIN"` を指定することで、ページの MAIN world と同一のスコープでスクリプトを実行できる。

新ファイル `spa-watcher.js` を `"world": "MAIN"` で注入し、そこで `history.pushState`/`replaceState` をフック。フック時に `window.dispatchEvent(new Event('us-url-change'))` を発火させ、ISOLATED world の `external-links.js` が `addEventListener('us-url-change', ...)` で受信する。

```
MAIN world (spa-watcher.js):
  history.pushState → フック → window.dispatchEvent('us-url-change')
                                        ↓（DOM イベントは両 world 共有）
ISOLATED world (external-links.js):
  window.addEventListener('us-url-change', handleUrlChange)
  handleUrlChange → _doHandleUrlChange → バー更新
```

DOM イベント（`CustomEvent` / `Event`）は両 world 間で共有されるため、MAIN world から発火したイベントを ISOLATED world でも受信できる。`popstate`（ブラウザの戻る/進む）も DOM イベントのため、両 world で発火する。

---

## 3. 実装仕様

### 3-A. 新規ファイル: `spa-watcher.js`（MAIN world）

**役割**: `history.pushState`/`replaceState` をフックして `us-url-change` イベントを発火するだけ。

**注意点**:
- IIFE で囲んで `_origPushState` / `_origReplaceState` がグローバルに漏れないようにする
- `popstate` はここに書かない（DOM イベントは ISOLATED world の `external-links.js` が受信）
- `us-url-change` のリスナーはここに書かない（受信は ISOLATED world の役割）

```javascript
// spa-watcher.js — MAIN world で pushState/replaceState を監視し
// ISOLATED world (external-links.js) に us-url-change イベントを通知する
(function() {
  'use strict';
  const _origPushState = history.pushState.bind(history);
  const _origReplaceState = history.replaceState.bind(history);

  history.pushState = function(...args) {
    _origPushState(...args);
    window.dispatchEvent(new Event('us-url-change'));
  };

  history.replaceState = function(...args) {
    _origReplaceState(...args);
    window.dispatchEvent(new Event('us-url-change'));
  };
})();
```

**`run_at: "document_start"` が必須な理由**:
React Router は `document_idle`（DOMContentLoaded 後）より前に `history` を初期化する場合がある。
`document_start` は HTML パース開始直後に注入されるため、React Router より確実に先に実行される。

### 3-B. `manifest.json` の変更

既存の content_scripts エントリの後に新エントリを追加する:

```json
{
  "matches": [
    "https://*.ebay.com/*",
    "https://*.ebay.co.jp/*",
    "https://*.ebay.co.uk/*",
    "https://*.ebay.de/*",
    "https://*.ebay.fr/*",
    "https://*.ebay.it/*",
    "https://*.ebay.es/*",
    "https://*.ebay.ca/*",
    "https://*.ebay.com.au/*",
    "https://*.rakuten.co.jp/*",
    "https://www.amazon.co.jp/*",
    "https://*.mercari.com/*",
    "https://jp.mercari.com/*",
    "https://auctions.yahoo.co.jp/*",
    "https://page.auctions.yahoo.co.jp/*",
    "https://paypayfleamarket.yahoo.co.jp/*",
    "https://shopping.yahoo.co.jp/*",
    "https://store.shopping.yahoo.co.jp/*",
    "https://netmall.hardoff.co.jp/*",
    "https://*.fril.jp/*",
    "https://fril.jp/*",
    "https://item.fril.jp/*"
  ],
  "js": ["spa-watcher.js"],
  "world": "MAIN",
  "run_at": "document_start"
}
```

**`"version"` は変更しない。v1.3.5 のまま。**

### 3-C. `external-links.js` の `setupSpaNavigation` 修正

削除するブロック（元 L493-505 相当）:

```javascript
// 削除: これらは ISOLATED world では効果がない
const _origPushState = history.pushState.bind(history);
const _origReplaceState = history.replaceState.bind(history);
history.pushState = function(...args) {
  _origPushState(...args);
  window.dispatchEvent(new Event('us-url-change'));
};
history.replaceState = function(...args) {
  _origReplaceState(...args);
  window.dispatchEvent(new Event('us-url-change'));
};
```

修正後の `setupSpaNavigation`:

```javascript
function setupSpaNavigation() {
  // pushState/replaceState のフックは MAIN world の spa-watcher.js が担う
  // (ISOLATED world で history を書き換えてもページの MAIN world には効かないため)

  // 戻る / 進むボタン対応 (popstate は DOM イベントで両 world で発火)
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('us-url-change'));
  });

  // spa-watcher.js (MAIN) からの us-url-change を受信
  window.addEventListener('us-url-change', handleUrlChange);

  console.log('🔄 SPA ナビゲーション監視を開始しました (MAIN world 連携)');
}
```

**変更しないもの**（`setupSpaNavigation` 外のコード、ロジック変更なし）:
- `let _pendingProductBarCanceled = false;`
- `let _urlChangeTimer = null;`
- `handleUrlChange` 関数（50ms debounce）
- `_doHandleUrlChange` 関数（バー更新ロジック）
- `initExternalLinksForProduct` のキャンセルガード
- ファイル末尾の `setupSpaNavigation();` 自動呼出

---

## 4. 設計決定の根拠

### 決定 A: `spa-watcher.js` のスコープを最小限にする

`popstate` リスナーや `us-url-change` リスナーを `spa-watcher.js` に書かない。

**理由**: MAIN world スクリプトはページの JS と干渉するリスクがある。フックと dispatch 以外の処理は ISOLATED world に閉じ込めることで副作用を最小化する。

### 決定 B: matches は既存エントリと同一

**理由**: SPA 遷移が起きるのは特定サイト（メルカリ、PayPayフリマ等）だが、将来 MPA サイトが SPA に移行した場合でも自動対応できる。MPA サイトでは pushState が呼ばれないため実質コストゼロ。

### 決定 C: `run_at: "document_start"`

**理由**: SPA フレームワーク（React Router 等）はページ初期化時に `history.pushState` を内部管理する。`document_start` はブラウザが HTML パースを始める前にスクリプトを注入するため、ページの JS より確実に先行実行できる。`document_idle` では React がすでに history を制御した後になる可能性がある。

### 決定 D: `world: "MAIN"` の対応ブラウザ

- Chrome 111+（2023年3月リリース）で対応
- Firefox MV3 は content_scripts の `world` を未サポートの場合あり（ただし本拡張は Chrome 専用）
- Edge は Chromium ベースのため対応

---

## 5. 変更ファイル一覧

| ファイル | 種別 | 変更内容 |
|---------|------|---------|
| `spa-watcher.js` | 新規作成 | MAIN world の pushState/replaceState フック |
| `manifest.json` | 修正 | `spa-watcher.js` 用 content_scripts エントリ追加（version 変更なし） |
| `external-links.js` | 修正 | `setupSpaNavigation` から ISOLATED world フックを削除 |
| `content.js` | 変更なし | — |

---

## 6. 動作フロー（修正後）

### メルカリ内 SPA 遷移（検索 → 商品）

```
1. ユーザーが商品をクリック
2. React Router が history.pushState を呼ぶ（MAIN world）
3. spa-watcher.js がフックして window.dispatchEvent('us-url-change') を発火
4. external-links.js の handleUrlChange が 50ms debounce 後に呼ばれる
5. _doHandleUrlChange が実行:
   - 既存の検索バー (#us-external-links-bar) を削除
   - detectSearchPageSite で商品ページと判定 → バー非表示のまま終了
   - _pendingProductBarCanceled = true でタイムアウト中の商品バー生成をキャンセル
6. ページは検索バーなし・商品バーなしの状態
```

### メルカリ内 SPA 遷移（商品 → 検索）

```
1. ユーザーが「戻る」または検索ボタンをクリック
2. spa-watcher.js または popstate が us-url-change を発火
3. handleUrlChange → _doHandleUrlChange:
   - 既存バーを削除
   - detectSearchPageSite で検索ページと判定
   - initExternalLinksForSearch(site) を呼んで検索バーを再表示
```

### 商品ページへの hard-load（回帰確認）

```
1. ユーザーが商品ページに直接アクセス
2. content.js が initExternalLinksForProduct を呼ぶ
3. 2秒後・4秒後に商品バーが生成される（既存動作、変更なし）
4. spa-watcher.js は document_start で注入されるが、hard-load では
   pushState が呼ばれないため us-url-change は発火しない
5. 動作に変化なし ✅
```

---

## 7. 回帰リスク

| リスク | 評価 | 対策 |
|--------|------|------|
| spa-watcher.js がページの pushState を壊す | 低（bind で元関数を保存、呼び出し後にイベント発火） | IIFE + `'use strict'` でスコープ保護 |
| document_start の注入タイミングで DOM アクセス | なし（pushState フックのみ、DOM 操作なし） | — |
| MPA サイトでのパフォーマンス影響 | 実質ゼロ（pushState が呼ばれなければ何も起きない） | — |
| us-url-change イベント名の衝突 | 低（プレフィックス `us-` で独自性確保） | — |
