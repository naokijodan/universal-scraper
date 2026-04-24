# 詳細設計書: external-links 改修 (v1.3.2 → v1.3.3)

**作成日**: 2026-04-24
**作成者**: child-a (設計専任、実装は Codex CLI が行う)
**対象ファイル**: `external-links.js`（メイン）、`manifest.json`（バージョン更新のみ）

---

## Fact / Inference / Unknown

| 項目 | 分類 | 内容 |
|---|---|---|
| ラクマ現行URL `fril.jp/search/` が機能しない | Fact | 親 WebSearch + 公式ページで確認済み |
| ラクマ正URL `fril.jp/s?query=` | Fact | 親 WebSearch 確認済み |
| ハードオフ検索URL `netmall.hardoff.co.jp/search/?keyword=` | Fact | 親 WebFetch 200 確認済み |
| manifest.json に hardoff が matches/host_permissions 済み | Fact | manifest.json 直接 Read で確認 |
| external-links.js が content_scripts に含まれる | Fact | manifest.json L52 で確認 |
| content.js L225-226 で currentSite = 'hardoff' が設定される | Fact | content.js 直接 Read で確認 |
| content.js L7354 で `initExternalLinksForProduct(currentSite)` が呼ばれる | Fact | content.js 直接 Read で確認 |
| OGP タイトル形式 `ブランド\|商品名\|サイト名\|WEB No.` | Fact | HANDOVER.md L50 |
| ハードオフ色 #FFCC00 / textColor #333 | Fact | HANDOVER.md + hardoff-implementation-report.md |
| external-links.js のログは `console.log` スタイル（`_log` ではない） | Fact | external-links.js 全文 Read で確認（63行目等） |
| OGP titleタグが常に存在するか | Unknown | 実際の商品ページで未検証（h1 フォールバックで対応） |
| `parts[1]` に実際に商品名が入るか | Inference | HANDOVER.md の記述に基づく。OGP取得後 parts[1] を使用 |

---

## 改修1: ラクマ URL 修正

**ファイル**: `external-links.js`
**行番号**: L10

### Before
```javascript
  rakuma: {
    name: 'ラクマ',
    url: 'https://fril.jp/search/',
    color: '#e52618'
  },
```

### After
```javascript
  rakuma: {
    name: 'ラクマ',
    url: 'https://fril.jp/s?query=',
    color: '#e52618'
  },
```

**変更点**: `url` の値のみ。他は一切変更しない。

**動作確認**: `url + encodeURIComponent(keyword)` で `https://fril.jp/s?query=<encoded>` となり、ラクマ検索結果ページに直接遷移する。

---

## 改修2: ハードオフ追加

### 2-A: EXTERNAL_SITES へのエントリ追加

**ファイル**: `external-links.js`
**挿入位置**: `paypay` エントリの直後、`ebay` エントリの直前（L43-44 の間）

#### Before (該当部分)
```javascript
  paypay: {
    name: 'PayPayフリマ',
    url: 'https://paypayfleamarket.yahoo.co.jp/search/',
    color: '#ff8800'
  },
  ebay: {
    name: 'eBay',
    url: 'https://www.ebay.com/sch/i.html?_nkw=',
    color: '#0064d2'
  },
```

#### After (該当部分)
```javascript
  paypay: {
    name: 'PayPayフリマ',
    url: 'https://paypayfleamarket.yahoo.co.jp/search/',
    color: '#ff8800'
  },
  hardoff: {
    name: 'ハードオフ',
    url: 'https://netmall.hardoff.co.jp/search/?keyword=',
    color: '#FFCC00',
    textColor: '#333'
  },
  ebay: {
    name: 'eBay',
    url: 'https://www.ebay.com/sch/i.html?_nkw=',
    color: '#0064d2'
  },
```

**補足**:
- `color: '#FFCC00'` はハードオフ公式ブランドカラー（HANDOVER.md 確認済み）
- `textColor: '#333'` は黄背景での可読性確保（yahuoku と同パターン）
- `url + encodeURIComponent(keyword)` で `https://netmall.hardoff.co.jp/search/?keyword=<encoded>` となる

---

### 2-B: getProductKeyword への hardoff 分岐追加

**ファイル**: `external-links.js`
**挿入位置**: `ebay` 分岐（L163-170）の直後、`if (!keyword)` チェック（L173）の直前

#### Before (該当部分)
```javascript
    } else if (currentSite === 'ebay') {
      const titleEl = document.querySelector('.x-item-title__mainTitle') || document.querySelector('h1');
      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ eBay商品名:', keyword);
      } else {
        console.log('⚠️ eBay: タイトル要素が見つかりません');
      }
    }

    if (!keyword) {
```

#### After (該当部分)
```javascript
    } else if (currentSite === 'ebay') {
      const titleEl = document.querySelector('.x-item-title__mainTitle') || document.querySelector('h1');
      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ eBay商品名:', keyword);
      } else {
        console.log('⚠️ eBay: タイトル要素が見つかりません');
      }
    } else if (currentSite === 'hardoff') {
      // OGP タイトル形式: "ブランド|商品名|サイト名|WEB No." → parts[1] が商品名
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const content = ogTitle.getAttribute('content') || '';
        const parts = content.split('|');
        if (parts.length >= 2 && parts[1].trim()) {
          keyword = parts[1].trim();
          console.log('✅ ハードオフ商品名 (OGP):', keyword);
        } else {
          console.log('⚠️ ハードオフ: OGPパーツ不足、h1フォールバックへ');
        }
      } else {
        console.log('⚠️ ハードオフ: OGPタイトルなし、h1フォールバックへ');
      }
      // フォールバック: h1 要素
      if (!keyword) {
        const titleEl = document.querySelector('h1');
        if (titleEl && titleEl.textContent.trim()) {
          keyword = titleEl.textContent.trim();
          console.log('✅ ハードオフ商品名 (h1フォールバック):', keyword);
        } else {
          console.log('⚠️ ハードオフ: タイトル要素が見つかりません');
        }
      }
    }

    if (!keyword) {
```

**設計上の判断**:
- `getAttribute('content') || ''` で null ガード
- `parts.length >= 2` で配列範囲外アクセスを防止
- `parts[1].trim()` が空文字の場合も h1 フォールバックへ
- フォールバックは `!keyword` で制御（OGP成功時はフォールバックをスキップ）

---

### 2-C: sitesToShow フィルターへの hardoff 除外追加

**ファイル**: `external-links.js`
**挿入位置**: `ebay` 除外行（L240）の直後、`return true;` 行（L241）の直前

#### Before (該当部分)
```javascript
    if (currentSite === 'amazon' && site === 'amazon') return false;
    if (currentSite === 'rakuten' && site === 'rakuten') return false;
    if (currentSite === 'ebay' && site === 'ebay') return false;
    return true;
```

#### After (該当部分)
```javascript
    if (currentSite === 'amazon' && site === 'amazon') return false;
    if (currentSite === 'rakuten' && site === 'rakuten') return false;
    if (currentSite === 'ebay' && site === 'ebay') return false;
    if (currentSite === 'hardoff' && site === 'hardoff') return false;
    return true;
```

---

## 改修3: manifest.json バージョン更新

**ファイル**: `manifest.json`

### Before
```json
"version": "1.3.2",
```

### After
```json
"version": "1.3.3",
```

**補足**: manifest.json の他の項目（matches, host_permissions, content_scripts）は変更不要（hardoff は v1.3.2 時点で既に追加済み・Fact 確認済み）。

---

## リスク・懸念事項

| リスク | 深刻度 | 対策 |
|---|---|---|
| OGP タイトル形式が変わる可能性 | 中 | h1 フォールバックで対応済み。検索精度は下がるが機能は維持 |
| ラクマ検索URL変更で既存キャッシュが残る可能性 | 低 | 拡張機能は毎回 JS を実行するため影響なし |
| `yahooshopping` サイトのハードオフボタン | 低 | yahooshopping は getProductKeyword に分岐なし（既存制限）。keyword='' でバー非表示となる |
| `parts[1]` がブランド名のみになるケース | 低 | OGP タイトルが短い場合（ブランドのみの商品等）は商品名が不正確になる可能性。実運用テストで確認推奨 |

---

## テスト手順（椛島さんが手動確認するチェックリスト）

Chrome で拡張機能を再読み込みしてからテストする。

### ラクマ修正確認
- [ ] ラクマの任意の商品ページを開く
- [ ] ページ上部に他サイトリンクバーが表示される
- [ ] バーの「ラクマ」ボタンが**表示されない**（自サイト除外確認）
- [ ] 別のサイト（例: メルカリ）ボタンを1回クリックする → 新タブで検索結果が出る
- [ ] ラクマ商品ページで（バーではなく）他のサイトから来て「ラクマ」ボタンを押す → **一発で**ラクマ検索結果が表示される（再検索不要）

### ハードオフ追加確認
- [ ] メルカリ等の商品ページを開く → バーに「ハードオフ」ボタンが新たに表示される
- [ ] 「ハードオフ」ボタンを押す → `https://netmall.hardoff.co.jp/search/?keyword=<商品名>` で検索結果が開く
- [ ] ハードオフの商品ページ（例: `https://netmall.hardoff.co.jp/product/12345/`）を開く → 他サイトリンクバーが表示される
- [ ] ハードオフ商品ページのバーに「ハードオフ」ボタン自身が**表示されない**（除外確認）
- [ ] バーの他サイトボタン（メルカリ、ヤフオク等）を押す → 各サイトの検索結果が出る

### 回帰確認
- [ ] メルカリ商品ページ → バー表示・「メルカリ」ボタンなし・他ボタン機能正常
- [ ] ヤフオク商品ページ → バー表示・「ヤフオク」ボタンなし・他ボタン機能正常
- [ ] PayPayフリマ商品ページ → バー表示・「PayPayフリマ」ボタンなし・他ボタン機能正常
- [ ] Amazon商品ページ → バー表示・「Amazon」ボタンなし・他ボタン機能正常
- [ ] 楽天商品ページ → バー表示・「楽天市場」ボタンなし・他ボタン機能正常
- [ ] eBay商品ページ → バー表示・「eBay」ボタンなし・他ボタン機能正常

---

## 推奨 Codex 実装プロンプト

```
external-links.js と manifest.json を修正してください。

以下の3点を変更します。変更する前に両ファイルを必ず全文読んでください。
実装は ~/Desktop/torikomikun/codex/external-links-fix-design.md の設計書に完全準拠してください。

【改修1: ラクマURL修正】
external-links.js の EXTERNAL_SITES.rakuma.url を変更:
- 変更前: 'https://fril.jp/search/'
- 変更後: 'https://fril.jp/s?query='

【改修2: ハードオフ追加】
external-links.js に以下の3箇所を追加:

(a) EXTERNAL_SITES の paypay エントリと ebay エントリの間に以下を追加:
  hardoff: {
    name: 'ハードオフ',
    url: 'https://netmall.hardoff.co.jp/search/?keyword=',
    color: '#FFCC00',
    textColor: '#333'
  },

(b) getProductKeyword 関数内の ebay 分岐の直後（if (!keyword) チェックの直前）に以下を追加:
  } else if (currentSite === 'hardoff') {
    // OGP タイトル形式: "ブランド|商品名|サイト名|WEB No." → parts[1] が商品名
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const content = ogTitle.getAttribute('content') || '';
      const parts = content.split('|');
      if (parts.length >= 2 && parts[1].trim()) {
        keyword = parts[1].trim();
        console.log('✅ ハードオフ商品名 (OGP):', keyword);
      } else {
        console.log('⚠️ ハードオフ: OGPパーツ不足、h1フォールバックへ');
      }
    } else {
      console.log('⚠️ ハードオフ: OGPタイトルなし、h1フォールバックへ');
    }
    // フォールバック: h1 要素
    if (!keyword) {
      const titleEl = document.querySelector('h1');
      if (titleEl && titleEl.textContent.trim()) {
        keyword = titleEl.textContent.trim();
        console.log('✅ ハードオフ商品名 (h1フォールバック):', keyword);
      } else {
        console.log('⚠️ ハードオフ: タイトル要素が見つかりません');
      }
    }

(c) sitesToShow フィルターの ebay 除外行の直後に以下を追加:
    if (currentSite === 'hardoff' && site === 'hardoff') return false;

【改修3: バージョン更新】
manifest.json の "version" を "1.3.2" から "1.3.3" に変更する。
それ以外の manifest.json の内容は一切変更しないこと（matches/host_permissions/content_scripts は変更不要）。

【ログスタイルの注意】
external-links.js は console.log を使っている（_log ではない）。既存パターンを踏襲すること。
catch ブロック内のエラーログは console.error を使うこと。

【git 操作】
変更完了後、以下のコミットを作成する:
  git add external-links.js manifest.json
  git commit -m "feat: ラクマURL修正、ハードオフ external-links 追加 (v1.3.3)"

git push はしないこと。
```
