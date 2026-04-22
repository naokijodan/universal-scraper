# image-cap-fix report

## 1. 各ファイルの修正箇所（行番号 + Before/After）

### [options.html](/Users/naokijodan/Desktop/torikomikun/options.html)

- L425-L431: 画像出力 `select` のデフォルトを `20枚` から `全ての画像（最大20枚）` に変更
  Before:
  ```html
  <option value="5">5枚</option>
  <option value="10">10枚</option>
  <option value="20" selected>20枚（デフォルト）</option>
  <option value="999">全ての画像</option>
  ```
  After:
  ```html
  <option value="5">5枚</option>
  <option value="10">10枚</option>
  <option value="999" selected>全ての画像（最大20枚）</option>
  ```

- L619: `hardoffLoadDelay` の UI デフォルトを `0` から `3` に変更
  Before:
  ```html
  <input type="number" id="hardoffLoadDelay" min="0" max="10" step="0.5" value="0">
  ```
  After:
  ```html
  <input type="number" id="hardoffLoadDelay" min="0" max="10" step="0.5" value="3">
  ```

### [default_setting_json.js](/Users/naokijodan/Desktop/torikomikun/default_setting_json.js)

- L218: `imageOutputCount` の既定値を `20` から `999` に変更
  Before:
  ```js
  imageOutputCount: 20, // 20枚固定
  ```
  After:
  ```js
  imageOutputCount: 999, // 全ての画像（最大20枚）
  ```

- L228: `hardoffLoadDelay: 3` は維持
  Before:
  ```js
  hardoffLoadDelay: 3,
  ```
  After:
  ```js
  hardoffLoadDelay: 3,
  ```

### [options.js](/Users/naokijodan/Desktop/torikomikun/options.js)

- L15: `defaultSettings.imageOutputCount` を `20` から `999` に変更
  Before:
  ```js
  imageOutputCount: 20, // 出力する画像枚数（デフォルト20枚）
  ```
  After:
  ```js
  imageOutputCount: 999, // 出力する画像枚数（全ての画像、最大20枚）
  ```

- L24: `defaultSettings.hardoffLoadDelay` を `0` から `3` に変更
  Before:
  ```js
  hardoffLoadDelay: 0,
  ```
  After:
  ```js
  hardoffLoadDelay: 3,
  ```

- L401: 保存時の `imageOutputCount` フォールバックを `20` から `999` に変更
  Before:
  ```js
  imageOutputCount: (() => { const v = parseInt(document.getElementById('imageOutputCount').value); return isNaN(v) ? 20 : v; })(),
  ```
  After:
  ```js
  imageOutputCount: (() => { const v = parseInt(document.getElementById('imageOutputCount').value); return isNaN(v) ? 999 : v; })(),
  ```

### [content.js](/Users/naokijodan/Desktop/torikomikun/content.js)

- L31-L45: 画像出力上限の共通定数と正規化ヘルパーを追加
  Before:
  ```js
  const _splitImageUrls = (urlStr) => {
    if (typeof urlStr !== 'string' || !urlStr) return [];
    return urlStr.split(',').map(url => url.trim()).filter(url => url);
  };
  ```
  After:
  ```js
  const _splitImageUrls = (urlStr) => {
    if (typeof urlStr !== 'string' || !urlStr) return [];
    return urlStr.split(',').map(url => url.trim()).filter(url => url);
  };

  // FIELD_DEFINITIONS.images.count=20 に合わせた画像出力上限
  const HARD_IMAGE_CAP = 20;
  const IMAGE_OUTPUT_ALL = 999;

  const _normalizeImageOutputCount = (value) => {
    const parsedCount = Number(value);
    if (!Number.isFinite(parsedCount)) return IMAGE_OUTPUT_ALL;
    if (parsedCount <= 0) return 0;
    return parsedCount === IMAGE_OUTPUT_ALL ? IMAGE_OUTPUT_ALL : Math.min(parsedCount, HARD_IMAGE_CAP);
  };

  const _getMaxImageCount = (imageUrls, value) => {
    const effectiveCount = _normalizeImageOutputCount(value);
    const requestedCount = effectiveCount === IMAGE_OUTPUT_ALL ? HARD_IMAGE_CAP : effectiveCount;
    return Math.min(imageUrls.length, requestedCount, HARD_IMAGE_CAP);
  };
  ```

- L251-L260: 未保存時の既定値を `imageOutputCount: 999` に変更し、`hardoffLoadDelay` も `3` に統一
  Before:
  ```js
  hardoffLoadDelay: 0,
  ...
  imageOutputCount: 20,
  ```
  After:
  ```js
  hardoffLoadDelay: 3,
  ...
  imageOutputCount: 999,
  ```

- L2755, L2791: クリップボード出力時の画像数計算を共通ヘルパーへ置換
  Before:
  ```js
  const maxImages = settings.imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, typeof settings.imageOutputCount === 'number' ? settings.imageOutputCount : 5);
  ```
  After:
  ```js
  const maxImages = _getMaxImageCount(imageUrls, settings.imageOutputCount);
  ```

- L4967: スプレッドシート出力前の設定値フォールバックを `5` から `999` 相当に変更
  Before:
  ```js
  const imageOutputCount = typeof syncSettings.imageOutputCount === 'number' ? syncSettings.imageOutputCount : 5;
  ```
  After:
  ```js
  const imageOutputCount = _normalizeImageOutputCount(syncSettings.imageOutputCount);
  ```

- L5031-L5034: フリマ系20画像フィールドの判定とループを共通定数化
  Before:
  ```js
  const maxImages = imageOutputCount === 0 ? 0 :
                    imageOutputCount === 999 ? 20 :
                    Math.min(imageOutputCount, 20);

  for (let i = 0; i < 20; i++) {
  ```
  After:
  ```js
  const maxImages = _getMaxImageCount(imageUrls, imageOutputCount);

  for (let i = 0; i < HARD_IMAGE_CAP; i++) {
  ```

- L5064, L5084, L5104: eBay / 楽天・Yahoo!ショッピング・Hardoff / Amazon の画像数計算を共通ヘルパーへ置換
  Before:
  ```js
  const maxImages = imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, imageOutputCount);
  ```
  After:
  ```js
  const maxImages = _getMaxImageCount(imageUrls, imageOutputCount);
  ```

## 2. content.js の画像クランプロジックを統一した箇所一覧

- L31-L45: `HARD_IMAGE_CAP = 20`, `IMAGE_OUTPUT_ALL = 999`, `_normalizeImageOutputCount()`, `_getMaxImageCount()` を追加
- L2755: Amazon クリップボード出力
- L2791: eBay / 楽天 / Yahoo!ショッピング クリップボード出力
- L4967: スプレッドシート出力前の設定値正規化
- L5032: フリマ系20画像フィールドの出力数決定
- L5064: eBay スプレッドシート出力
- L5084: 楽天 / Yahoo!ショッピング / Hardoff スプレッドシート出力
- L5104: Amazon スプレッドシート出力

統一後の挙動:

- `imageOutputCount === 0` は 0 枚
- `imageOutputCount === 999` は最大 20 枚
- 数値指定は `min(指定値, 実画像数, 20)`
- 無効値は `999` 扱いになり最大 20 枚

## 3. 既存プラットフォームの画像出力に副作用がないか確認した結果

- eBay: 画像URLの分割、`=IMAGE()` 生成、出力配列構造はそのまま。画像数判定だけ `_getMaxImageCount()` に統一。
- 楽天 / Yahoo!ショッピング: 既存の出力列順・`=IMAGE()` 生成は維持。`999` や 20 超入力時も 20 枚を超えないことを保証。
- Amazon: 既存のクリップボード・スプレッドシート出力構造は維持。画像枚数だけ統一ロジックを適用。
- メルカリ / ヤフオク / PayPayフリマ / ラクマ: 20 固定画像フィールドの空欄埋め仕様は維持。`maxImages` 判定のみ共通化したため、列数は従来どおり 20 枚分固定。
- Hardoff: 楽天 / Yahoo!ショッピングと同じ出力分岐内で `_getMaxImageCount()` を使うようになり、他プラットフォームと同じ 20 枚上限に揃った。

## 4. 懸念点

- 画像出力の 20 枚上限は `content.js` 側で `HARD_IMAGE_CAP = 20` として明示し、`default_setting_json.js` の `FIELD_DEFINITIONS.images.count = 20` と同じ値に揃えた。今回は同期済みだが、将来どちらか一方だけ変更すると再び乖離するので、変更時は両方を同時に更新する必要がある。
