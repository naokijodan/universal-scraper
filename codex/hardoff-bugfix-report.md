# hardoff bugfix report

## 1. 画像取得バグの原因

### 原因A: DOM画像の URL 候補選択順
- 対象コード: [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:6810)
- 旧実装は `img.getAttribute('src') || img.src || img.getAttribute('data-src')` の順で候補を作っていた。
- Hardoff の実 DOM では `.product-detail-images-main__image img` が存在し、DevTools では `img.src` として絶対 URL が 14 件見えている。
- しかし `getAttribute('src')` が相対 URL / protocol-relative / 未正規化文字列を返す構成だと、`addImageUrl()` 内の `^https?:` 判定で先に落ち、後続の `img.src` まで到達しない。
- つまり、セレクタ自体ではなく「候補 URL の優先順 + 正規化前判定」が原因で、DOM 側の画像が 0 件になり得る状態だった。

### 原因B: Hardoff の画像 URL はカンマを含む
- 対象コード: [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:6835)
- Hardoff の画像 URL は `.../c!/w=1280,h=1280,a=0,u=1,q=75/...jpg` のように URL 自体へカンマを含む。
- 旧実装は `imageUrls.join(',')` で保存し、共有側は `_splitImageUrls()` で単純に `split(',')` している。
- そのため Hardoff の画像 URL は後段で正しく再構成できず、プレビュー / 出力処理側で壊れる。
- これは DevTools で確認済みの URL 形式と既存コードの分割方式から確定で言える不整合。

## 2. 画像取得の修正内容

### Before
```js
const imageUrls = [];
const imageKeys = new Set();
const addImageUrl = (candidate) => {
  if (!candidate || !/^https?:/i.test(candidate)) return;
  // ...
};

Array.from(document.querySelectorAll('.product-detail-images-main__image img, .product-detail-images-wrapper img'))
  .forEach(img => addImageUrl(img.getAttribute('src') || img.src || img.getAttribute('data-src') || ''));
```

### After
```js
const imageUrls = [];
const imageUrlSet = new Set();
const normalizeImageUrl = (candidate) => {
  if (typeof candidate !== 'string') return '';
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  return new URL(trimmed, url).toString().replace(/,/g, '%2C');
};

const addImageUrl = (candidate) => {
  const normalizedUrl = normalizeImageUrl(candidate);
  if (!/^https?:/i.test(normalizedUrl) || imageUrlSet.has(normalizedUrl)) return;
  imageUrlSet.add(normalizedUrl);
  imageUrls.push(normalizedUrl);
};

Array.from(document.querySelectorAll('.product-detail-images-main__image img, .product-detail-images-wrapper img'))
  .forEach(img => {
    [img.currentSrc, img.src, img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-original')]
      .forEach(addImageUrl);
  });
```

### 修正ポイント
- `.product-detail-images-main__image img` は維持。
- `img.src` / `img.currentSrc` を先に使い、URL を `new URL(..., url)` で絶対 URL 化してから判定。
- 重複除去は「完全一致 URL」のみに簡素化。
- Hardoff 固有のカンマ入り URL は `%2C` 化して、既存の「カンマ区切り `imageUrl` 文字列」と両立。
- JSON-LD は文字列だけでなく object (`url` / `contentUrl`) も受けるようにした。

## 3. アラート除外の原因

- 対象コード: [content.js](/Users/naokijodan/Desktop/torikomikun/content.js:1657)
- `_getMissingFields(data, true)` がサイト種別を見ずに `reviewCount` と `listedFmt` を必須扱いしていた。
- エクスポート時の確認ダイアログはこの `_getMissingFields(..., true)` の結果をそのまま表示する。
- Hardoff の返却データは `platform, url, price, name, description, seller, imageUrl` で、`reviewCount` と `listedFmt` を返していない。
- そのため Hardoff では毎回 `評価件数` と `出品日時` が missing になり、確認ダイアログへ出続けていた。

## 4. アラート除外の修正内容

### Before
```js
if (includeDetail) {
  if (!data.description || data.description === '') {
    missing.push('説明文');
  }
  if (!data.reviewCount || data.reviewCount === '') {
    missing.push('評価件数');
  }
  if (!data.listedFmt || data.listedFmt === '') {
    missing.push('出品日時');
  }
}
```

### After
```js
const isHardoff = data.platform === 'hardoff';

if (includeDetail) {
  if (!data.description || data.description === '') {
    missing.push('説明文');
  }
  if (!isHardoff && (!data.reviewCount || data.reviewCount === '')) {
    missing.push('評価件数');
  }
  if (!isHardoff && (!data.listedFmt || data.listedFmt === '')) {
    missing.push('出品日時');
  }
}
```

## 5. 検証結果

- `node --check content.js`: 成功。構文エラーなし。
- `git diff -- content.js`: 今回追加した実質差分は以下の 2 箇所。
- `_getMissingFields()` に `isHardoff` 条件を追加。
- `extractHardoffProductData()` の画像 URL 正規化・重複除去・JSON-LD 画像追加処理を修正。
- 注意: 作業ツリーには未コミットの Hardoff 実装本体が既に含まれているため、`git diff` 全体にはそれら既存差分も表示される。今回の追加入力は上記 2 箇所に限定して確認した。

## 6. 残る懸念点

- 実ブラウザ再確認は未実施。特に `%2C` 化した ImageFlux URL を Chrome 拡張の実運用経路で再確認するのが安全。
- Hardoff 側が将来 `image` を object 配列以外の別形式へ変えた場合は、追加対応が必要になる可能性がある。
