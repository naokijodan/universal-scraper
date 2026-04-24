# 詳細設計書: SPA ナビゲーション対応 (v1.3.4 → v1.3.5)

**作成日**: 2026-04-24
**作成者**: child-a (設計専任、実装は Codex CLI が行う)
**対象ファイル**: `external-links.js`（変数2・関数2・既存1関数変更・自動呼出）、`manifest.json`（バージョンのみ）

---

## Fact / Inference / Unknown

| 項目 | 分類 | 内容 |
|---|---|---|
| manifest.json version = 1.3.4 | Fact | manifest.json Read 確認済み |
| external-links.js に `detectSearchPageSite` / `getSearchKeyword` / `initExternalLinksForSearch` が実装済み | Fact | external-links.js 全文 Read 確認 |
| `createProductLinksBar` に `document.getElementById('us-external-links-bar')` 存在チェック済み | Fact | external-links.js L223 確認 |
| `initExternalLinksForProduct` は 2s + 4s の setTimeout で DOM 待機する | Fact | external-links.js L343-358 確認 |
| content.js は external-links.js より後に読まれる (`document_idle`) | Fact | manifest.json content_scripts 順序確認 |
| content.js の search early-return でも external-links.js は常にロードされ `setupSpaNavigation()` が実行される | Fact | content script の仕組みとして確定 |
| content.js は変更不要（`setupSpaNavigation` が URL 変化を自律監視する） | Fact | 設計から導出 |
| メルカリが React SPA | Fact | 椛島さん観察（親タスク記載） |
| ラクマ / PayPayフリマ が SPA か | Unknown | 実機未確認。全サイト共通で監視するため無害 |
| ヤフオク / Amazon / 楽天 / ハードオフ / eBay が伝統 MPA か | Inference | 大半は MPA と思われる。MPA では pushState 発火しないため監視コストはゼロ |
| `history.pushState` が他の拡張に既にフックされているか | Unknown | 多重フックは動作するが、別の拡張の副作用は予測不能。実用上問題なし |
| SPA の replaceState 連続呼出頻度 | Unknown | React Router 等では URL 変化のたびに複数回呼ぶ場合がある。50ms debounce で対策済み |

---

## 論点 A〜E 選択結果と根拠

### 論点 A: URL 変化監視方法 → **選択: (1) pushState/replaceState フック + popstate**

**根拠**:
- background.js 経由 (option 2) は `webNavigation` 権限追加 + manifest 変更 + background.js 修正 + content↔background メッセージ設計が必要で変更範囲が大きい
- option 1 は `external-links.js` 内だけで完結。新規ファイル不要・新規権限不要
- `pushState`/`replaceState` フックは SPA URL 追跡の業界標準パターン（React Router, Vue Router 等が生成する URL 変化の両方をカバー）
- `popstate` で戻る/進むボタンもカバー

### 論点 B: 遷移時の挙動 → **選択: バー削除 + 検索ページのみ再表示**

- B-1 (検索→商品): 検索バーを削除し、商品バーは表示しない
- B-2 (商品→検索): 商品バー（あれば）を削除し、検索バーを表示
- B-3 (検索→別検索): 旧バーを削除し、新キーワードで検索バーを表示

**根拠**:
- 親のスコープ制約「商品データ抽出は SPA 遷移で再実行しない」を厳守
- `initExternalLinksForProduct` を SPA 遷移時に呼ばない（商品popup/ボタンが機能しないページに孤立したリンクバーを出すと混乱を招く）
- 検索→検索の更新は最重要ユースケース（キーワードを変えて再検索→バーも更新）

### 論点 C: 全サイト共通 vs SPA 限定 → **選択: (c-1) 全サイト共通**

**根拠**:
- 伝統的な MPA サイト（eBay, Amazon 等）ではブラウザがページを再ロードするため `pushState`/`replaceState` が発火しない。監視を設定しても `handleUrlChange` が呼ばれることはなく実質ノーコスト
- サイト別に SPA/MPA を判定するコードを追加するより、全サイト共通の方がシンプルで将来の MPA→SPA 移行にも自動対応できる

### 論点 D: 既存挙動への影響と対策 → **選択: キャンセルフラグ `_pendingProductBarCanceled` で対処**

**根拠**:
- `initExternalLinksForProduct` は 2s + 4s の `setTimeout` を2本仕掛ける。SPA 遷移が 2秒以内に発生すると、遷移後のページでタイマーが発火し旧ページのキーワードでバーが作られる危険がある
- `_pendingProductBarCanceled = true` を `handleUrlChange` の冒頭でセットすることで、pending タイマーを安全にキャンセルできる
- AbortController より軽量・単純で外部依存なし

### 論点 E: スコープ明文化 → **Sprint Contract と設計書両方に明記**

商品データ抽出（`getProductData`/`extractHardoffProductData` 等）・ポップアップUI・chrome.storage・エクスポート機能は SPA 遷移時に再実行しない。

---

## 改修対象ファイル一覧

| ファイル | 変更内容 | 変更量 |
|---|---|---|
| `external-links.js` | モジュール変数2追加 + `initExternalLinksForProduct` 変更 + 新関数2本 + 自動呼出 | 既存3行変更、+約55行追加 |
| `manifest.json` | version: 1.3.4 → 1.3.5 のみ | 1行変更 |
| `content.js` | **変更なし** | 0行 |

---

## 関数構造 before/after

```
【Before v1.3.4】
external-links.js:
  EXTERNAL_SITES
  getProductKeyword()
  createProductLinksBar()            ← 既存バー存在チェック付き
  initExternalLinksForProduct()      ← 2s+4s delay, キャンセルなし
  detectSearchPageSite()
  getSearchKeyword()
  initExternalLinksForSearch()

content.js:
  early-return (search page) → initExternalLinksForSearch
  product page → initExternalLinksForProduct

【After v1.3.5】
external-links.js:
  EXTERNAL_SITES
  ★ let _pendingProductBarCanceled = false   ← NEW
  ★ let _urlChangeTimer = null               ← NEW
  getProductKeyword()
  createProductLinksBar()
  initExternalLinksForProduct()      ← ★ キャンセルフラグ対応に変更
  detectSearchPageSite()
  getSearchKeyword()
  initExternalLinksForSearch()
  ★ handleUrlChange()                ← NEW: debounce ラッパー
  ★ _doHandleUrlChange()             ← NEW: バー削除 + 再評価
  ★ setupSpaNavigation()             ← NEW: pushState/popstate フック
  ★ setupSpaNavigation();            ← NEW: 自動呼出

content.js: 変更なし
```

---

## 詳細 diff (擬似コード)

### [1] モジュール変数の追加

**挿入位置**: `const EXTERNAL_SITES = {...};` の直後、`function getProductKeyword` の直前

```javascript
// SPA ナビゲーション用状態
let _pendingProductBarCanceled = false; // 商品ページの pending setTimeout キャンセル用
let _urlChangeTimer = null;             // URL 変化 debounce タイマー
```

---

### [2] `initExternalLinksForProduct` の変更（3箇所追加）

**ファイル**: `external-links.js` L339-358

```javascript
// Before:
function initExternalLinksForProduct(currentSite) {
  console.log('🔗 外部リンク機能を初期化:', currentSite);

  setTimeout(() => {
    const keyword = getProductKeyword(currentSite);
    if (keyword) {
      createProductLinksBar(currentSite, keyword);
    }
  }, 2000);

  setTimeout(() => {
    if (!document.getElementById('us-external-links-bar')) {
      const keyword = getProductKeyword(currentSite);
      if (keyword) {
        createProductLinksBar(currentSite, keyword);
      }
    }
  }, 4000);
}

// After:
function initExternalLinksForProduct(currentSite) {
  console.log('🔗 外部リンク機能を初期化:', currentSite);
  _pendingProductBarCanceled = false; // ★ SPA 遷移時キャンセルをリセット

  setTimeout(() => {
    if (_pendingProductBarCanceled) return; // ★ SPA 遷移で中断された場合はスキップ
    const keyword = getProductKeyword(currentSite);
    if (keyword) {
      createProductLinksBar(currentSite, keyword);
    }
  }, 2000);

  setTimeout(() => {
    if (_pendingProductBarCanceled) return; // ★ SPA 遷移で中断された場合はスキップ
    if (!document.getElementById('us-external-links-bar')) {
      const keyword = getProductKeyword(currentSite);
      if (keyword) {
        createProductLinksBar(currentSite, keyword);
      }
    }
  }, 4000);
}
```

---

### [3] 新関数をファイル末尾に追加

**挿入位置**: `initExternalLinksForSearch` 関数（L429-438）の直後

```javascript
/**
 * URL 変化の実処理
 * バーを削除し、新 URL を評価する（検索ページならバーを再表示）
 * ★ 商品データ抽出（getProductData等）は呼ばない（スコープ制約）
 */
function _doHandleUrlChange() {
  // pending の商品ページバーをキャンセル
  _pendingProductBarCanceled = true;

  // 既存バーを削除
  const existingBar = document.getElementById('us-external-links-bar');
  if (existingBar) {
    existingBar.remove();
    console.log('🗑️ SPA: 既存バーを削除しました');
  }

  // 新 URL を評価: 検索ページなら検索バーを表示
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  const searchSite = detectSearchPageSite(hostname, pathname);

  if (searchSite) {
    console.log('🔍 SPA: 検索ページへ遷移:', searchSite, window.location.href);
    initExternalLinksForSearch(searchSite);
  } else {
    // 商品ページや他のページ: バーなし
    // （スコープ制約: 商品データ抽出は SPA 遷移で再実行しない）
    console.log('📦 SPA: 非検索ページへ遷移、バーなし:', pathname);
  }
}

/**
 * URL 変化ハンドラ（50ms debounce）
 * replaceState の連続呼出によるチラつきを防ぐ
 */
function handleUrlChange() {
  clearTimeout(_urlChangeTimer);
  _urlChangeTimer = setTimeout(_doHandleUrlChange, 50);
}

/**
 * SPA ナビゲーション監視をセットアップする
 * history.pushState / replaceState フック + popstate リスナー
 * ★ content.js の変更不要。このスクリプトのロード時に自動実行される
 */
function setupSpaNavigation() {
  // pushState / replaceState をフック（これらは popstate を発火しないため個別に対応）
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

  // 戻る / 進むボタン対応
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('us-url-change'));
  });

  // 統一ハンドラ（debounce 付き）
  window.addEventListener('us-url-change', handleUrlChange);

  console.log('🔄 SPA ナビゲーション監視を開始しました');
}

// スクリプト読み込み時に自動セットアップ
setupSpaNavigation();
```

---

### [4] manifest.json — バージョンのみ変更

```json
// Before:
"version": "1.3.4",

// After:
"version": "1.3.5",
```

---

## SPA 遷移シナリオ別動作表

| シナリオ | 起動経路 | 結果 |
|---|---|---|
| Hard-load: 商品ページ | content.js → `initExternalLinksForProduct` | 2s 後に商品バー表示 ✅ |
| Hard-load: 検索ページ | content.js early-return → `initExternalLinksForSearch` | 即座に検索バー表示 ✅ |
| SPA: 商品→検索（2s以内） | `handleUrlChange` → `_doHandleUrlChange` | `_pendingProductBarCanceled=true`、旧バーなし、新検索バー表示 ✅ |
| SPA: 商品→検索（2s以降） | `handleUrlChange` → `_doHandleUrlChange` | 旧バー削除（あれば）、新検索バー表示 ✅ |
| SPA: 検索→商品 | `handleUrlChange` → `_doHandleUrlChange` | 検索バー削除、商品バーなし（スコープ制約） ✅ |
| SPA: 検索→別検索（キーワード変更） | `handleUrlChange` → `_doHandleUrlChange` | 旧バー削除、新キーワードで検索バー表示 ✅ |
| SPA: 戻る（popstate） | `popstate` → `us-url-change` → `_doHandleUrlChange` | バー削除 → 新URL再評価 ✅ |
| MPA サイト (pushState未発火) | `setupSpaNavigation` は登録済みだがイベント発火なし | 何も起きない、既存挙動のまま ✅ |
| `replaceState` 連続3回（SPA router） | `handleUrlChange` × 3回、50ms debounce で1回に収束 | バーチラつきなし ✅ |

---

## リスク・懸念事項

| リスク | 深刻度 | 対策 |
|---|---|---|
| `history.pushState` フックが別拡張と競合 | 低 | `bind(history)` で元の関数を先に保存してから呼び出すため、多重フックは連鎖して動作する |
| debounce 50ms が短すぎる場合（URL変化直後にDOMが追いつかない） | 低 | 検索ページのキーワードは URL から取得するため DOM 待機不要。50ms は十分 |
| `setupSpaNavigation` が複数回呼ばれた場合 | 低 | content script は1ページ1回のみロードされる。複数回呼ばれる状況は発生しない |
| ユーザーが×でバーを閉じた直後に URL 変化 → バー再表示 | 低 | 新しいページへの遷移なので再表示は正しい動作。意図通り |
| `_pendingProductBarCanceled` のスコープ汚染 | 低 | モジュールスコープ変数として `let` で宣言（グローバル汚染なし）。外部から書き換えられるリスクは拡張環境では低い |
| 商品ページ SPA 遷移後にバーなし（意図的スコープ制約） | 設計上の制約 | Sprint Contract に明記済み。将来バージョンで解禁可能 |

---

## テスト手順（椛島さんが手動確認するチェックリスト）

拡張機能を「再読み込み」してからテストする（chrome://extensions/ → 更新ボタン）。

### SPA ナビゲーション 新機能確認（メルカリで実施）

- [ ] メルカリのどこかのページを開く → URLバーに `https://jp.mercari.com/search?keyword=ポケモン` を直接入力（hard-load）→ バー表示・「メルカリ」ボタンなし
- [ ] 検索キーワードを変えて再検索（メルカリ内部の検索ボックスで検索）→ バーのキーワードが更新される
- [ ] 検索結果から商品をクリック（SPA遷移）→ 検索バーが**消える**（バーなし）
- [ ] ブラウザの「戻る」ボタンで検索画面に戻る → バーが**再表示**される
- [ ] メルカリ商品ページを hard-load で開く → 2秒後に商品バー表示（回帰確認）
- [ ] 商品バー表示後にメルカリ内部で検索（SPA遷移）→ 商品バーが削除され、検索バーが表示される

### 既存機能の回帰確認

- [ ] メルカリ商品ページ → 2秒後バー表示・「メルカリ」ボタンなし（回帰なし）
- [ ] ラクマ検索ページ（hard-load）→ バー即表示（回帰なし）
- [ ] ラクマ商品ページ（hard-load）→ バー表示（回帰なし）
- [ ] ハードオフ商品ページ（hard-load）→ バー表示（回帰なし）
- [ ] eBay 検索ページ（hard-load）→ バー表示（回帰なし）

---

## 推奨 Codex 実装プロンプト

```
external-links.js と manifest.json を修正してください。
実装前に必ずこの設計書を全文読んでください:
~/Desktop/torikomikun/codex/spa-nav-design.md

変更前に external-links.js を全文読んでください。content.js は変更不要です。

【改修1: モジュール変数の追加】
external-links.js の `const EXTERNAL_SITES = {...};` の直後、
`function getProductKeyword` の直前に以下を追加:

let _pendingProductBarCanceled = false;
let _urlChangeTimer = null;

【改修2: initExternalLinksForProduct の変更】
既存の `initExternalLinksForProduct` 関数に3行追加する。設計書の「[2]」セクションの
before/after に完全準拠すること:
- 関数冒頭に `_pendingProductBarCanceled = false;` を追加
- 2s setTimeout の冒頭に `if (_pendingProductBarCanceled) return;` を追加
- 4s setTimeout の冒頭に `if (_pendingProductBarCanceled) return;` を追加

【改修3: 新関数3本 + 自動呼出をファイル末尾に追加】
`initExternalLinksForSearch` 関数の直後に、設計書の「[3]」セクションのコードを追加する。
追加する内容（順番通り）:
1. `_doHandleUrlChange()` 関数
2. `handleUrlChange()` 関数（debounce ラッパー）
3. `setupSpaNavigation()` 関数
4. `setupSpaNavigation();` の自動呼出1行（ファイル最末尾）

ログスタイル: console.log を使うこと（external-links.js のスタイル）。

【改修4: manifest.json バージョン更新】
"version": "1.3.4" → "1.3.5" のみ変更。他は変更しない。

【git 操作】
git add external-links.js manifest.json
git commit -m "feat: SPA ナビゲーション対応 (v1.3.5)"
git push はしないこと。
```
