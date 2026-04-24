# 詳細設計書: 検索画面リンクバー対応 (v1.3.3 → v1.3.4)

**作成日**: 2026-04-24
**作成者**: child-a (設計専任、実装は Codex CLI が行う)
**対象ファイル**: `external-links.js`（新関数3本 + バグ修正1行）、`content.js`（early-return 約10行）、`manifest.json`（バージョンのみ）

---

## Fact / Inference / Unknown

| 項目 | 分類 | 内容 |
|---|---|---|
| manifest.json version = 1.3.3 | Fact | manifest.json 直接 Read 確認 |
| 全サイトの matches/host_permissions が搭載済み | Fact | manifest.json 直接 Read 確認（search.rakuten.co.jp も `*.rakuten.co.jp/*` でカバー） |
| external-links.js は content_scripts で external-links.js が content.js より先に読まれる | Fact | manifest.json L52 順序確認 |
| content.js L7354 で `initExternalLinksForProduct(currentSite)` を呼んでいる | Fact | content.js Read 確認 |
| content.js L200 の `let currentSite = null;` が商品ページ判定の開始点 | Fact | content.js Read 確認 |
| content.js の判定ブロックは商品ページのみ（検索ページで `return` される） | Fact | content.js Read 確認（L228: 非マッチで return） |
| PayPayフリマ検索URLのパス形式 `paypayfleamarket.yahoo.co.jp/search/<keyword>` | Inference | 親の情報による（実機未確認）|
| 楽天検索URLパス `search.rakuten.co.jp/search/mall/<keyword>/...` | Inference | 親の情報 + EXTERNAL_SITES の url パターンから推測 |
| ヤフオク検索パス `/search/search` | Inference | EXTERNAL_SITES の url パターンから推測 |
| eBay 検索パス `/sch/i.html` | Inference | EXTERNAL_SITES の url から推測 |
| SPA ナビゲーションでの再実行要否 | Unknown | メルカリ等の SPA で search↔product 遷移時の挙動は未確認 |
| 楽天検索URLの keyword エンコード状態 | Unknown | パス中のキーワードが percent-encoded か否か未確認（decodeURIComponent でガード） |

---

## 論点 A〜D 選択結果と根拠

### 論点 A: 検索画面の currentSite 扱い → **選択: (a-3) 変形版「early-return パターン」**

`currentSite` + `pageType` という変数を持つ案ではなく、**検索ページを検出したら `initExternalLinksForSearch` を呼んでから `return`** する early-return パターンを採用する。

**根拠**:
- (a-1)(a-2) はいずれも `currentSite` に検索・商品の区別を混ぜ込み、可読性が下がる
- (a-3) 変数 `pageType` 導入は正しいが、content.js の巨大なコードに変数を増やすより、early-return の方がスコープ影響が最小
- content.js の `async IIFE` は最後（L7354）で `initExternalLinksForProduct` を呼ぶ構造なので、検索ページはその前に抜けてよい
- 既存商品ページ判定コード7000行に一切触れずに済む

### 論点 B: 関数構造 → **選択: (b-2) 別関数 `initExternalLinksForSearch` を新設**

**根拠**:
- 商品ページは DOM からキーワードを待つため 2秒+4秒 の delay が必要
- 検索ページは URL パラメータから即座に取得できる（delay 不要）
- タイミング要件が根本的に違うため、1関数内で分岐するより別関数の方がシンプル
- 既存の `initExternalLinksForProduct` は一切変更しないため、回帰リスクがゼロ

### 論点 C: 検索キーワード抽出 → **選択: 新設 `getSearchKeyword(currentSite)` + `URL.searchParams`**

**根拠**:
- `URL.searchParams` はブラウザ標準 API で安全・確実
- クエリパラメータサイトは `.get('param')` で1行取得
- パスベース（PayPayフリマ・楽天）は `pathname.split('/')[N]` + `decodeURIComponent` で対応
- 取得失敗時は空文字 `''` を返し、既存の `!keyword` ガードでバー非表示になる

### 論点 D: SPA ナビゲーション対応 → **選択: 今回は未対応（hard-load のみ）**

**根拠**:
- 既存の商品ページバーも SPA ナビゲーション時は表示されない（同じ制限）
- ユーザーが検索ページを直接開いた場合（URLバー入力・新タブ・外部リンク）は hard-load なので機能する
- SPA 対応には `MutationObserver` で URL 変化を監視する設計が必要で、別 PR で扱う範囲
- 現状のユースケース（ブラウザで検索画面を開く）で十分効果がある

---

## 改修対象ファイル一覧

| ファイル | 変更内容 | 変更量 |
|---|---|---|
| `external-links.js` | 新関数3本追加 + yahooshopping 除外バグ修正1行 | +約50行 |
| `content.js` | 検索ページ early-return ブロック挿入（既存コード変更なし） | +約12行 |
| `manifest.json` | version: 1.3.3 → 1.3.4 のみ | 1行変更 |

---

## 各サイトの検索画面 URL & パラメータ

| サイト | currentSite値 | 検索画面 URL パターン | パラメータ/パス | 取得方法 |
|---|---|---|---|---|
| メルカリ | `mercari` | `jp.mercari.com/search?keyword=<kw>` | `keyword` | searchParams.get |
| ラクマ | `rakuma` | `fril.jp/s?query=<kw>` | `query` | searchParams.get |
| ヤフオク | `yahuoku` | `auctions.yahoo.co.jp/search/search?p=<kw>` | `p` | searchParams.get |
| PayPayフリマ | `paypayfurima` | `paypayfleamarket.yahoo.co.jp/search/<kw>` | pathname[2] | pathname split |
| Amazon | `amazon` | `www.amazon.co.jp/s?k=<kw>` | `k` | searchParams.get |
| 楽天市場 | `rakuten` | `search.rakuten.co.jp/search/mall/<kw>/...` | pathname[3] | pathname split + decodeURIComponent |
| ヤフショ | `yahooshopping` | `shopping.yahoo.co.jp/search?p=<kw>` | `p` | searchParams.get |
| ハードオフ | `hardoff` | `netmall.hardoff.co.jp/search/?q=<kw>` | `q` | searchParams.get |
| eBay | `ebay` | `www.ebay.com/sch/i.html?_nkw=<kw>` | `_nkw` | searchParams.get |

---

## 関数構造の before/after

```
【Before】
external-links.js:
  EXTERNAL_SITES              ← 定義
  getProductKeyword()         ← 商品ページ: DOM からキーワード取得
  createProductLinksBar()     ← バー描画（共通）
  initExternalLinksForProduct()  ← 商品ページ: 2秒+4秒遅延して呼ぶ

content.js:
  (IIFE) → 商品ページ判定 → currentSite 設定 → 商品データ抽出 → initExternalLinksForProduct(currentSite)

【After】
external-links.js:
  EXTERNAL_SITES              ← 定義（変更なし）
  getProductKeyword()         ← 商品ページ: DOM からキーワード取得（変更なし）
  createProductLinksBar()     ← バー描画（共通、変更なし）
  initExternalLinksForProduct()  ← 商品ページ（変更なし）
  ★ detectSearchPageSite()   ← NEW: hostname/pathname → サイトキー or null
  ★ getSearchKeyword()        ← NEW: 検索ページ: URL パラメータからキーワード取得
  ★ initExternalLinksForSearch() ← NEW: 検索ページ: 遅延なし即実行

content.js:
  (IIFE) → ★検索ページ判定(detectSearchPageSite) → 検索ページなら initExternalLinksForSearch して return
         → 既存商品ページ判定（変更なし） → currentSite 設定 → 商品データ抽出 → initExternalLinksForProduct(currentSite)
```

---

## 詳細 diff (擬似コード)

### [1] external-links.js — 3新関数 + yahooshopping バグ修正

#### 1-A: sitesToShow フィルターへの yahooshopping 除外追加（バグ修正 1行）

**挿入位置**: `ebay` 除外行の直後 / `hardoff` 除外行の直後（L272 付近）

```javascript
// Before (L271-274 付近):
    if (currentSite === 'ebay' && site === 'ebay') return false;
    if (currentSite === 'hardoff' && site === 'hardoff') return false;
    return true;

// After:
    if (currentSite === 'ebay' && site === 'ebay') return false;
    if (currentSite === 'hardoff' && site === 'hardoff') return false;
    if (currentSite === 'yahooshopping' && site === 'yahooshopping') return false;  // ★ バグ修正
    return true;
```

#### 1-B: ファイル末尾に3関数を追加

**挿入位置**: `initExternalLinksForProduct` 関数（L338-358）の直後

```javascript
/**
 * 検索ページを判定してサイトキーを返す
 * content.js から呼ばれる（external-links.js が先に読まれるため利用可能）
 * @param {string} hostname - window.location.hostname
 * @param {string} pathname - window.location.pathname
 * @returns {string|null} サイトキー or null（非検索ページ）
 */
function detectSearchPageSite(hostname, pathname) {
  if (hostname.includes('mercari.com') && pathname === '/search') return 'mercari';
  if (hostname.includes('fril.jp') && pathname === '/s') return 'rakuma';
  if (hostname.includes('auctions.yahoo.co.jp') && pathname.includes('/search/search')) return 'yahuoku';
  if (hostname.includes('paypayfleamarket.yahoo.co.jp') && pathname.startsWith('/search')) return 'paypayfurima';
  if (hostname.includes('amazon.co.jp') && pathname === '/s') return 'amazon';
  if (hostname.includes('search.rakuten.co.jp') && pathname.startsWith('/search/mall/')) return 'rakuten';
  if (hostname.includes('shopping.yahoo.co.jp') && pathname === '/search') return 'yahooshopping';
  if (hostname.includes('netmall.hardoff.co.jp') && pathname.startsWith('/search')) return 'hardoff';
  if (hostname.includes('ebay.') && pathname.includes('/sch/')) return 'ebay';
  return null;
}

/**
 * 検索画面の URL からキーワードを抽出
 * @param {string} currentSite - detectSearchPageSite の戻り値
 * @returns {string} キーワード（取得失敗時は空文字）
 */
function getSearchKeyword(currentSite) {
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const pathname = url.pathname;

    if (currentSite === 'mercari') {
      return decodeURIComponent(params.get('keyword') || '');
    } else if (currentSite === 'rakuma') {
      return decodeURIComponent(params.get('query') || '');
    } else if (currentSite === 'yahuoku') {
      return decodeURIComponent(params.get('p') || '');
    } else if (currentSite === 'paypayfurima') {
      // URL: /search/<keyword> (パスベース)
      const parts = pathname.split('/');
      return decodeURIComponent(parts[2] || '');
    } else if (currentSite === 'amazon') {
      return decodeURIComponent(params.get('k') || '');
    } else if (currentSite === 'rakuten') {
      // URL: /search/mall/<keyword>/...  (パスベース)
      const parts = pathname.split('/');
      return decodeURIComponent(parts[3] || '');
    } else if (currentSite === 'yahooshopping') {
      return decodeURIComponent(params.get('p') || '');
    } else if (currentSite === 'hardoff') {
      return decodeURIComponent(params.get('q') || '');
    } else if (currentSite === 'ebay') {
      return decodeURIComponent(params.get('_nkw') || '');
    }
    console.log('⚠️ getSearchKeyword: 未知のサイト:', currentSite);
    return '';
  } catch (error) {
    console.error('❌ 検索キーワード取得エラー:', error);
    return '';
  }
}

/**
 * 検索画面にリンクバーを表示
 * URL パラメータは即時取得できるため setTimeout 不要
 * @param {string} currentSite - detectSearchPageSite の戻り値
 */
function initExternalLinksForSearch(currentSite) {
  console.log('🔍 検索画面リンクバーを初期化:', currentSite);
  const keyword = getSearchKeyword(currentSite);
  if (keyword) {
    createProductLinksBar(currentSite, keyword);
    console.log('✅ 検索画面リンクバーを表示:', currentSite, keyword);
  } else {
    console.log('⚠️ 検索キーワードが取得できませんでした:', currentSite);
  }
}
```

---

### [2] content.js — 検索ページ early-return 挿入

**挿入位置**: 既存の `let currentSite = null;`（現在 L200 付近）の直前

```javascript
// Before (現 L198-201 付近):
  let currentSite = null;

  if (hostname.includes('ebay.') && pathname.includes('/itm/')) {

// After:
  // ==========================================
  // 検索ページ判定（商品ページ判定より先に実行）
  // ==========================================
  if (typeof detectSearchPageSite === 'function') {
    const searchSite = detectSearchPageSite(hostname, pathname);
    if (searchSite) {
      _log('🔍 検索ページ検出:', searchSite, 'URL:', window.location.href);
      if (typeof initExternalLinksForSearch === 'function') {
        initExternalLinksForSearch(searchSite);
      }
      return; // 商品ページ抽出は不要
    }
  }

  // 既存の商品ページ判定（変更なし）
  let currentSite = null;

  if (hostname.includes('ebay.') && pathname.includes('/itm/')) {
```

**重要**: `_log` を使う（content.js のログスタイル。external-links.js の `console.log` とは別）

---

### [3] manifest.json — バージョンのみ変更

```json
// Before:
"version": "1.3.3",

// After:
"version": "1.3.4",
```

---

## リスク・懸念事項

| リスク | 深刻度 | 対策 |
|---|---|---|
| 楽天検索ページが product 判定ロジックにもマッチする | 中 | early-return が先に実行されるため無害（現状でも product 抽出が走っていたが、今回修正で正しく skip される） |
| PayPayフリマ検索 URL が実機で `/search/<keyword>` 形式でない場合 | 中 | キーワード空文字 → バー非表示（安全失敗）。実機テストで確認推奨 |
| eBay `/sch/` パス判定で他の eBay ページを誤検知 | 低 | eBay の `/sch/` は検索専用パス。他ページが `/sch/` を含む可能性は低い |
| SPA ナビゲーション（メルカリ等）でバーが出ない | 低 | 既存商品ページバーも同じ制限。「直接 URL を開く」ユースケースでは機能する |
| `decodeURIComponent` への空文字/undefined 渡し | 低 | `params.get() \|\| ''` でガード済み。空文字の decodeURIComponent は空文字を返す |
| `detectSearchPageSite` が外部 links.js で定義されない場合 | 低 | `typeof detectSearchPageSite === 'function'` ガードで安全（バー非表示で無害失敗） |

---

## テスト手順（椛島さんが手動確認するチェックリスト）

拡張機能を「再読み込み」してからテストする（chrome://extensions/ → 更新ボタン）。

### 検索画面リンクバー 新機能確認

- [ ] メルカリで検索 (`jp.mercari.com/search?keyword=ポケモン`) → バー表示・「メルカリ」ボタンなし・他ボタンでポケモン検索
- [ ] ラクマで検索 (`fril.jp/s?query=...`) → バー表示・「ラクマ」ボタンなし
- [ ] ヤフオクで検索 (`auctions.yahoo.co.jp/search/search?p=...`) → バー表示・「ヤフオク」ボタンなし
- [ ] Amazon で検索 (`amazon.co.jp/s?k=...`) → バー表示・「Amazon」ボタンなし
- [ ] ハードオフで検索 (`netmall.hardoff.co.jp/search/?q=...`) → バー表示・「ハードオフ」ボタンなし
- [ ] eBay で検索 (`ebay.com/sch/...`) → バー表示・「eBay」ボタンなし
- [ ] 各バーのボタンを押すと正しいキーワードで他サイト検索が開く
- [ ] キーワードなしで検索画面を開いた場合はバーが表示されない

### 商品ページ 回帰確認（既存挙動が維持されているか）

- [ ] メルカリ商品ページ → バー表示・「メルカリ」ボタンなし（回帰なし）
- [ ] ラクマ商品ページ → バー表示・「ラクマ」ボタンなし（回帰なし）
- [ ] ヤフオク商品ページ → バー表示・「ヤフオク」ボタンなし（回帰なし）
- [ ] PayPayフリマ商品ページ → バー表示・「PayPayフリマ」ボタンなし（回帰なし）
- [ ] Amazon商品ページ → バー表示・「Amazon」ボタンなし（回帰なし）
- [ ] 楽天商品ページ → バー表示・「楽天市場」ボタンなし（回帰なし）
- [ ] ハードオフ商品ページ → バー表示・「ハードオフ」ボタンなし（回帰なし）
- [ ] eBay商品ページ → バー表示・「eBay」ボタンなし（回帰なし）

### yahooshopping バグ修正確認

- [ ] ヤフショ商品ページ → バーの「ヤフショ」ボタンが**表示されない**（旧バグ修正確認）

---

## 推奨 Codex 実装プロンプト

```
external-links.js、content.js、manifest.json を修正してください。
実装前に必ずこの設計書を全文読んでください:
~/Desktop/torikomikun/codex/search-page-bar-design.md

変更前に必ず対象ファイルを全文読んでください（external-links.js は全体、
content.js は L185-240 と L7340-7370 を必ず確認）。

【改修1: external-links.js — yahooshopping 除外バグ修正（1行）】
sitesToShow フィルターの hardoff 除外行の直後に追加:
    if (currentSite === 'yahooshopping' && site === 'yahooshopping') return false;

【改修2: external-links.js — 3関数を末尾に追加】
initExternalLinksForProduct 関数の直後に以下の3関数を追加する。
関数の内容は設計書の「1-B: ファイル末尾に3関数を追加」セクションに完全準拠すること。

追加する関数（順番通りに）:
1. detectSearchPageSite(hostname, pathname)
2. getSearchKeyword(currentSite)
3. initExternalLinksForSearch(currentSite)

ログスタイル: console.log を使うこと（external-links.js のスタイル）。
catch 内は console.error。

【改修3: content.js — 検索ページ early-return 挿入】
既存の `let currentSite = null;` 行の直前に、設計書の「[2] content.js」セクションの
コードブロックを挿入する。

注意:
- 挿入するコードの _log は変更しない（content.js のログスタイル）
- 既存の商品ページ判定ブロック（`let currentSite = null;` 以降）は一切変更しない
- 変更するのは「let currentSite = null;」の直前に数行挿入するだけ

【改修4: manifest.json — バージョン更新】
"version": "1.3.3" → "1.3.4" のみ変更。
他の項目（matches、host_permissions、content_scripts）は変更しないこと。

【git 操作】
変更完了後:
  git add external-links.js content.js manifest.json
  git commit -m "feat: 検索画面リンクバー対応 (v1.3.4)"

git push はしないこと。
```
