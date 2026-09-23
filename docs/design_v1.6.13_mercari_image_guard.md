# v1.6.13 設計: メルカリ商品写真の誤画像混入対策

作成: 2026-09-23

## 症状
メルカリから取り込んだ行で、たまにセル内画像（1枚目）が商品写真でない画像になる。同じ行は出品者IDと2枚目以降の画像URLも空。他の項目（タイトル・価格・説明）は正常。

## 原因（Fact / Inference）
- Fact: `content.js` `extractMercariProductData()` の画像取得は4段フォールバック。①`[data-testid="image-N"] img`（N=0〜19）→ ②カルーセル要素内の img → ③ページ全体の `picture img, picture source` → ④`meta[property="og:image"]`。前段が0枚のときだけ次へ進む。
- Fact: 採用条件は `url.startsWith('http')` のみ。商品写真かどうかは見ていない。
- Fact: DOM準備待ち `_isMercariReady()` は15秒で打ち切り、揃っていなくても抽出する。
- Fact（実ページ 2026-09-23 実測）:
  - 通常商品ページの商品写真 = `https://static.mercdn.net/item/detail/orig/photos/m<商品ID>_<n>.jpg`
  - 同ページには商品写真以外に `static.mercdn.net/thumb/members/webp/…`（出品者アイコン）、`static.mercdn.net/thumb/item/webp/…`（関連商品）、`assets.mercari-shops-static.com/-/small/plain/…`（関連Shops商品）が存在し、`picture` 要素は64個。
  - Shops商品ページの商品写真 = `https://assets.mercari-shops-static.com/-/large/plain/<id>.jpg@jpg`。関連商品は `/-/small/plain/`。
  - トップ・検索ページの og:image = `https://web-jp-assets-v2.mercdn.net/_next/static/media/ogp.<hash>.png`（メルカリロゴ入りの汎用画像）。商品ページを完全読込した場合の og:image は商品写真。
- Inference: 商品写真の枠が未描画のページで③または④が発動し、関連商品・アイコン・汎用OGP画像を拾った。

## 方針
「商品写真と確定できるURLだけ採用し、確定できなければ空にして再取得する」。誤画像より空欄の方が安全（既存の「画像 未取得」警告で気づける）。

## 変更内容（content.js のみ、権限・manifest変更なし）
1. `_isMercariProductImageUrl(url)` を追加。
   - `https://static.mercdn.net/item/detail/` で始まる → 採用
   - `https://assets.mercari-shops-static.com/-/large/` で始まる → 採用
   - それ以外 → 不採用（ログに捨てたURLを出す）
2. 画像取得の4段ブロックを `_mercariGetImageUrls()` に関数化し、①〜④すべての採用判定を `url.startsWith('http')` から `_isMercariProductImageUrl(url)` に変更。返り値は既存と同じ長さ20の配列。`extractMercariProductData()` はこれを呼ぶだけにする（既存の imageUrl 組み立て・ログ出力は変えない）。
3. `_hasAnyImageUrl(data)` を追加（レビュー指摘 2026-09-23 で追加）。メルカリの `imageUrl` は**長さ20の配列**（content.js 6610行）で、空でも配列自体は truthy のため、文字列前提の空判定は一度も発火しない。判定は「配列なら1つでも非空文字があれば true、文字列なら非空で true、それ以外 false」。
   - `_getMissingFields` の画像判定（content.js 1995行 `!data.imageUrl || data.imageUrl === ''`）をこの関数に置き換える（現状は配列のため「画像 未取得」警告が絶対に出ない不具合の修正）。
4. `_mercariRefillImages(extractedData)` を追加。`_hasAnyImageUrl(extractedData)` が false のとき `_mercariGetImageUrls()` で再取得し、1枚以上取れたら `extractedData.imageUrl` を新しい配列で置き換える。既存の `_mercariRefillDescription` と同じ形（同期・戻り値 boolean・補完時ログ）。
5. 呼び出し箇所は `_mercariRefillDescription` と同じ場所に並べる（内容確認・選択送信・直接送信の各ボタン押下時、および visibilitychange 再取得）。visibilitychange の起動条件・解除条件には `!_hasAnyImageUrl(extractedData)` を加える（文字列判定 `!extractedData.imageUrl` は配列に対して常に false なので使わない）。
6. バージョン表記を 1.6.13 に統一（manifest.json ほか版数表記箇所）。

## 変えないこと
- ①〜④のフォールバック順序、20枚上限、srcset優先の取り方。
- base64化の対象判定（`static.mercdn.net` のみ）。Shops商品のbase64非対応は従来どおり。
- `_isMercariReady()` の条件（画像を必須にすると読込遅延で全体が遅くなるため、再取得方式で対応）。
- 他プラットフォームの画像取得。

## リスクと対策
- 採用条件が厳しすぎて正常ページでも画像が空になる → 実測した2形式に一致させる。捨てたURLはログ出力し、実機で確認する。
- 再取得しても0枚 → 空欄のまま。既存の未取得警告が出る。

## 検証
- 通常商品ページ: 画像が従来どおり全枚数入る（機械で枚数比較）。
- Shops商品ページ: 同上。
- 汎用OGP画像 / 関連商品サムネ / 出品者アイコンのURLを `_isMercariProductImageUrl` に通して不採用になることを単体で確認。
- 改修版と公開版の同時有効化は禁止（アラート箱の競合、既知）。
