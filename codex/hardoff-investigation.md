# Hardoff HTML Investigation

対象HTML: [/tmp/hardoff-sample.html](/tmp/hardoff-sample.html:1)  
参考実装: [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:180), [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:2984), [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:3534), [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:6632)

**ページ構造サマリー**
- 静的レンダリング済み。商品名、価格、画像ギャラリー、店舗情報、商品詳細テーブルがHTML本体に埋め込まれている。主要DOMは [hardoff-sample.html](/tmp/hardoff-sample.html:845), [hardoff-sample.html](/tmp/hardoff-sample.html:1051), [hardoff-sample.html](/tmp/hardoff-sample.html:1218), [hardoff-sample.html](/tmp/hardoff-sample.html:1262) を参照。
- OGPあり。`og:title` `og:description` `og:image` `og:url` は存在。`og:price:amount` `og:price:currency` は存在しない。
- JSON-LDあり。`BreadcrumbList` と `Product` の2本。
- `window.dataLayer` あり。初期詳細表示用の `dataLayer.push(...)` と、`gtag(...)` 経由のイベント、`addToCart` 用の遅延 `dataLayer.push(...)` が定義されている。
- 価格に不整合あり。DOM表示と `gtag(view_item)` は `3300` 円（税込）だが、Product JSON-LD `offers.price` は `3000`。税込/税抜の差とみなすのが妥当。
- IDが複数系統ある。URL商品IDは `6087824`、WEB No./sku/item_id は `2081450000002628`。実装時に混同しないこと。

OGP:
- `<title>`: `TOMY|トミカ 日本製|【ハードオフ公式通販】オフモール|2081450000002628`
- `og:title`: `TOMY|トミカ 日本製|【ハードオフ公式通販】オフモール|2081450000002628`
- `og:description`: `TOMY|トミカ 日本製の商品詳細ページ。オフモール（オフモ）は、全国で中古品を扱うハードオフグループの公式総合中古通販サイトです。家電・オーディオ・パソコン・テレビ・デジカメ・時計・楽器・スマートフォンなど全国の中古商品を毎日更新中！売り切れにご注意ください！`
- `og:image`: `https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832566525.jpg`
- `og:url`: `https://netmall.hardoff.co.jp/product/6087824/`
- `og:price:amount`: なし
- `og:price:currency`: なし

JSON-LD 1:

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@id": "https://netmall.hardoff.co.jp/top/CSfTop.jsp",
        "name": "中古通販のオフモールTOP"
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@id": "https://netmall.hardoff.co.jp/cate/00010009/",
        "name": "玩具・ホビー"
      }
    },
    {
      "@type": "ListItem",
      "position": 3,
      "item": {
        "@id": "https://netmall.hardoff.co.jp/cate/000100090006/",
        "name": "フィギュア・ホビー・コレクション"
      }
    },
    {
      "@type": "ListItem",
      "position": 4,
      "item": {
        "@id": "https://netmall.hardoff.co.jp/cate/0001000900060003/",
        "name": "ミニカー"
      }
    },
    {
      "@type": "ListItem",
      "position": 5,
      "item": {
        "@id": "https://netmall.hardoff.co.jp/cate/00010009000600030011/",
        "name": "トミカ・ダイヤペット"
      }
    },
    {
      "@type": "ListItem",
      "position": 6,
      "item": {
        "@id": "https://netmall.hardoff.co.jp/product/6087824/",
        "name": "トミカ 日本製"
      }
    }
  ]
}
```

JSON-LD 2:

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "sku": "2081450000002628",
  "name": "トミカ 日本製",
  "description": "https://netmall.hardoff.co.jp/product/6087824/",
  "gtin13": "",
  "image": [
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832566525.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_33_19.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_33_28.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_33_34.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_33_41.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832585521.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832589538.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_34_16.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832599951.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_34_33.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832605001.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_34_56.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/2026_04_22_13_35_07.jpg",
    "https://p1-d9ebd2ee.imageflux.jp/c!/w=1280,h=1280,a=0,u=1,q=75/208145/IMG_1776832610069.jpg"
  ],
  "url": "https://netmall.hardoff.co.jp/product/6087824/",
  "brand": {
    "@type": "Brand",
    "name": "TOMY"
  },
  "offers": {
    "@context": "https://schema.org",
    "@type": "Offer",
    "url": "https://netmall.hardoff.co.jp/product/6087824/",
    "priceValidUntil": "2026-04-22",
    "price": "3000",
    "priceCurrency": "JPY",
    "itemCondition": "https://schema.org/UsedCondition",
    "availability": "https://schema.org/SoldOut",
    "sku": "2081450000002628",
    "seller": {
      "@type": "Organization",
      "url": "https://netmall.hardoff.co.jp/shop/208145/",
      "name": "ホビーオフ千葉おゆみ野店"
    }
  }
}
```

`window.dataLayer` / `gtag()`:

初期実行:

```js
window.dataLayer = window.dataLayer || [];
dataLayer.push({
  ecommerce: {
    detail: {
      products: [{ id: '6087824' }]
    }
  }
});

// GTM bootstrap
window.dataLayer.push({
  'gtm.start': new Date().getTime(),
  event: 'gtm.js'
});

function gtag(){ dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'UA-44406684-1');
gtag('config', 'AW-447993997');
gtag('config', 'G-ZLLDEH73EK');

gtag('event', 'view_item', {
  event_category: 'event',
  event_label: '商品詳細_商品閲覧時',
  currency: 'JPY',
  value: 3300,
  items: [{
    item_id: '2081450000002628',
    item_name: 'トミカ 日本製',
    affiliation: '208145',
    item_brand: 'TOMY',
    item_category: 'トミカ・ダイヤペット',
    item_category4: 'トミカ・ダイヤペット',
    item_category4_id: '00010009000600030011',
    price: 3300,
    currency: 'JPY',
    quantity: 1
  }]
});
```

関数呼び出し時のみ:

```js
gtag('event', 'exception', {
  description: message,
  fatal: false
});

gtag('event', 'click', {
  event_category: 'offmall',
  event_label: '商品詳細_検索条件登録',
  value: 'true'
});

gtag('event', 'click', {
  event_category: 'offmall',
  event_label: '商品詳細_送料計算',
  value: 'true'
});

gtag('event', 'add_to_cart', {
  event_category: 'event',
  event_label: '商品詳細_商品カート投入時',
  currency: 'JPY',
  value: 3300,
  items: [{
    item_id: '2081450000002628',
    item_name: 'トミカ 日本製',
    affiliation: '208145',
    item_brand: 'TOMY',
    item_category: 'トミカ・ダイヤペット',
    item_category4: 'トミカ・ダイヤペット',
    item_category4_id: '00010009000600030011',
    price: 3300,
    currency: 'JPY',
    quantity: 1
  }]
});

dataLayer.push({
  event: 'addToCart',
  ecommerce: {
    add: {
      products: [{
        id: '6087824',
        price: '3300',
        quantity: 1
      }]
    }
  }
});
```

**セレクタ候補一覧**

商品タイトル:
1. `.product-detail-name > h1`
2. `.product-detail-name h1`
3. `.product-detail-info h1`
4. `meta[property="og:title"]`
5. `script[type="application/ld+json"]` の Product `name`

価格:
1. `.product-detail-price__main`
2. `.product-detail-price`
3. `.product-detail-price__sub`
4. `gtag('event', 'view_item', ...)` の `value`
5. Product JSON-LD `offers.price`

価格メモ:
- DOMは `3,300` と `(税込)` を分けて保持しているので、`.product-detail-price__main` と `.product-detail-price__sub` をセットで見る。
- 送料DOMは [hardoff-sample.html](/tmp/hardoff-sample.html:1130) の `style="display: none;"` なので、静的HTMLだけでは取得できない場合がある。
- このサンプルでは Product JSON-LD が `3000`、DOM/analytics が `3300`。拡張機能に入れる販売価格は DOM/analytics の税込 `3300` を優先するのが安全。

商品説明本文:
1. `.product-detail-tab-panel#panel1 table`
2. `#panel1 table`
3. `.product-detail-tab-panel#panel1`
4. `.product-detail-images-main__text`
5. `.product-detail-hashtag_text`

商品説明メモ:
- このページには楽天やYahooのような長文説明本文は見当たらず、実質的な説明は `商品詳細` タブの表形式データ。
- `特徴・備考` 行が状態情報として重要。画像キャプションも補助情報に使える。

メイン画像URL / 画像ギャラリー全体:
1. `.product-detail-images-main__image img`
2. `.product-gallery-modal .swiper-slide img`
3. `.product-detail-images-wrapper img`
4. `meta[property="og:image"]`
5. Product JSON-LD `image`

商品状態（新品/中古/ランク ABC等）:
1. `.product-detail-price__rank img[alt*="RANK"]`
2. `.product-detail-price__rank img`
3. `#panel1 table tr`
4. `.product-detail-images-main__text`
5. Product JSON-LD `offers.itemCondition`

商品状態メモ:
- ランクは `B RANK` が画像 `alt` に入っている。
- 中古/新品判定は DOM の明示ラベルよりも JSON-LD `UsedCondition` が安定。
- 細かな状態は `特徴・備考` 行と画像キャプションから補完する。

店舗名 / 発送元 / 店舗所在地:
1. `.product-detail-store__name`
2. `.product-detail-postage-store__all`
3. `.product-detail-store__address`
4. `.product-detail-store__tel p`
5. Product JSON-LD `offers.seller.name`

店舗情報メモ:
- `.product-detail-postage-store__all` は `ホビーオフ千葉おゆみ野店 / 千葉県` のように店舗名と都道府県が1要素にまとまる。
- `.product-detail-store__name` と `.product-detail-store__address` は店舗セクションで分離されているので、最終的にはこちらの方が扱いやすい。

商品ID:
1. URL正規表現 `location.pathname.match(/\/product\/(\d+)\/?/)`
2. `button.item-fav-button[data-goodsno]`
3. `.cart-add-button[onclick*="addCart('"]`
4. 初期 `dataLayer.push({ ecommerce.detail.products[0].id })`
5. `_scq.push(['_setPage', {id: '6087824'}])`

商品IDメモ:
- URL商品ID `6087824` はサイト内部ID。
- `WEB No.2081450000002628` と Product JSON-LD `sku` は別ID。出品管理番号に近い扱い。
- 拡張機能の識別子としては、まずURL商品IDを採用し、補助フィールドとして `webNo` または `sku` を別保持する設計が安全。

**抽出戦略**
1. まず Product JSON-LD を探し、`name` `image[]` `offers.itemCondition` `offers.seller.name` `sku` を取る。
2. 次に OGP をフォールバックに使い、`og:title` `og:image` `og:url` を補う。
3. 次に `dataLayer` / `gtag(view_item)` から analytics 用価格 `3300` と item metadata を補う。
4. 最後に DOM セレクタで税込価格、ランク、特徴・備考、店舗住所などの見た目情報を取る。

優先順位の例外:
- 指定の原則は `JSON-LD → OGP → dataLayer → DOM` でよい。
- ただし価格だけは例外。JSON-LD `3000` と DOM/dataLayer `3300` が不一致なので、実際にクリップボードへ入れる販売価格は DOM or `view_item.value` の税込値を優先し、JSON-LD は補助扱いにする。
- 商品名も例外がある。`<title>` / `og:title` は `ブランド|商品名|サイト名|WEB No.` 形式なので、単純に `split('|')[0]` すると `TOMY` を拾ってしまう。DOM/JSON-LD優先が必須。

抽出時の正規化:
- タイトルは DOM `h1` または Product JSON-LD `name` をそのまま使う。
- 状態は `UsedCondition` を `中古` に正規化し、ランク `B` と特徴・備考配列を別で付与する。
- 説明文は `#panel1 table` の各行を `保証期間: 保証なし` のような改行区切りへ整形する。
- 画像は重複除去してカンマ区切りで返す。

**ハードオフ用抽出関数の骨子**

既存実装の流儀:
- [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:180) の `currentSite` 判定は `hostname` と `pathname` の分岐追加方式。
- [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:2984) の `getTextBySelectors()` と `extractNumber()` を再利用できる。
- [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:3534) と [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:6632) は、`try/catch`、優先順位付きフォールバック、`_log()`、最終的に `{ platform, url, price, name, description, seller, imageUrl }` を返す構成。

サイト判定の追加例:

```js
} else if (hostname.includes('netmall.hardoff.co.jp') && /^\/product\/\d+\/?$/.test(pathname)) {
  currentSite = 'hardoff';
}
```

抽出関数の骨子:

```js
function extractHardoffProductData() {
  _log('=== Hardoffデータ抽出開始 ===');

  try {
    const url = window.location.href;
    const pathname = window.location.pathname;
    const productId = pathname.match(/\/product\/(\d+)\/?/)?.[1] || '';

    const jsonLdObjects = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(el => {
        try {
          return JSON.parse(el.textContent);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    const productJsonLd = jsonLdObjects.find(obj => obj['@type'] === 'Product') || null;

    const nameSelectors = [
      '.product-detail-name > h1',
      '.product-detail-name h1',
      '.product-detail-info h1'
    ];
    let name = getTextBySelectors(nameSelectors)
      || productJsonLd?.name
      || '';

    if (!name) {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const parts = ogTitle.split('|').map(part => part.trim()).filter(Boolean);
      name = parts[1] || parts[0] || '';
    }

    const priceMain = getTextBySelectors([
      '.product-detail-price__main',
      '.product-detail-price'
    ]);
    const priceSub = getTextBySelectors([
      '.product-detail-price__sub'
    ]);

    let price = extractNumber(`${priceMain}${priceSub}`);

    // JSON-LDは3000、DOM/analyticsは3300なので税込DOMを優先
    if (!price || price === 0) {
      const viewItemScript = Array.from(document.scripts)
        .map(script => script.textContent || '')
        .find(text => text.includes("gtag('event', 'view_item'"));
      const analyticsPrice = viewItemScript?.match(/"value":\s*(\d+)/)?.[1];
      if (analyticsPrice) {
        price = parseInt(analyticsPrice, 10);
      }
    }

    if (!price || price === 0) {
      price = extractNumber(productJsonLd?.offers?.price || '');
    }

    const itemConditionUrl = productJsonLd?.offers?.itemCondition || '';
    const condition = /UsedCondition/.test(itemConditionUrl) ? '中古' : '';
    const rankText = document.querySelector('.product-detail-price__rank img')?.alt?.trim() || '';
    const rank = rankText.match(/([A-Z])\s*RANK/i)?.[1] || '';

    const detailRows = Array.from(document.querySelectorAll('#panel1 tr'));
    const detailLines = detailRows
      .map(row => {
        const th = row.querySelector('th')?.innerText?.trim() || '';
        const td = row.querySelector('td')?.innerText?.replace(/\s+/g, ' ').trim() || '';
        return th && td ? `${th}: ${td}` : '';
      })
      .filter(Boolean);

    const notes = detailRows
      .filter(row => row.querySelector('th')?.innerText?.includes('特徴・備考'))
      .map(row => row.querySelector('td')?.innerText?.replace(/\s+/g, ' ').trim() || '')
      .filter(Boolean);

    const captionNotes = Array.from(document.querySelectorAll('.product-detail-images-main__text'))
      .map(el => el.innerText?.trim() || '')
      .filter(Boolean);

    const description = [...detailLines, ...captionNotes]
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .join('\n');

    const seller = getTextBySelectors([
      '.product-detail-store__name',
      '.product-detail-postage-store__all'
    ]) || productJsonLd?.offers?.seller?.name || '出品者情報なし';

    const storeAddress = getTextBySelectors([
      '.product-detail-store__address'
    ]);

    const imageUrls = Array.from(document.querySelectorAll([
      '.product-detail-images-main__image img',
      '.product-gallery-modal .swiper-slide img',
      '.product-detail-images-wrapper img'
    ].join(',')))
      .map(img => img.src || img.getAttribute('data-src') || '')
      .filter(url => url && /^https?:/.test(url))
      .filter((url, index, array) => array.indexOf(url) === index);

    if (imageUrls.length === 0 && Array.isArray(productJsonLd?.image)) {
      imageUrls.push(...productJsonLd.image);
    }

    const imageUrl = imageUrls.join(',');
    const sku = productJsonLd?.sku || '';
    const webNo = document.querySelector('#panel1')?.innerText?.match(/WEB No\.(\d+)/)?.[1] || sku;

    _log('✅ Hardoff抽出結果', {
      productId,
      webNo,
      condition,
      rank,
      notesCount: notes.length,
      imageCount: imageUrls.length
    });

    if (!name) {
      return { error: '商品名が取得できませんでした。' };
    }

    if (!price || price === 0) {
      return { error: `価格が取得できませんでした。\\n\\n取得できたデータ:\\n商品名: ${name}` };
    }

    return {
      platform: 'hardoff',
      url,
      productId,
      webNo,
      sku,
      price,
      name,
      description: description || '商品詳細なし',
      seller,
      storeAddress,
      condition,
      rank,
      notes: notes.join(' | '),
      imageUrl
    };
  } catch (error) {
    console.error('❌ Hardoff抽出エラー:', error);
    return { error: 'データの抽出に失敗しました: ' + error.message };
  }
}
```

**懸念点・注意事項**
- 価格の税込/税抜がソースごとに不一致。JSON-LD `3000` と DOM/dataLayer `3300` のどちらを採用するかを明示しておく必要がある。
- Product JSON-LD `description` は説明文ではなく URL になっている。説明文ソースとしては使えない。
- `<title>` と `og:title` は `ブランド|商品名|サイト名|WEB No.` 形式。既存 `rakuten` / `yahooshopping` のような `split('|')[0]` 流用は危険。
- 送料は都道府県選択後に動的計算される構造で、静的HTMLでは未表示のケースがある。今回のHTMLからは送料確定値を取れない前提で設計した方がよい。
- 状態は `中古`、`Bランク`、`特徴・備考`、画像キャプションに分散している。単一文字列へ潰すより、`condition` `rank` `notes[]` に分けた方が扱いやすい。
- 商品詳細本文が表形式なので、単純 `innerText` だと整形が崩れやすい。`th`/`td` をペアにして組み立てる方が安定。
- 画像はメインスライダー、サムネイル、モーダル、JSON-LDに重複して存在する。重複除去が必要。
- URL商品ID `6087824` と WEB No./sku `2081450000002628` は別物。将来の照合で両方保持しておくと事故が減る。
