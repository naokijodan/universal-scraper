# プロンプト全体設計

**プロジェクト**: とりこみ君AI v0.1.0
**作成日**: 2026-05-07
**ゴール**: 商品ページの DOM データ + メイン画像を OpenAI Responses API に渡し、eBay 出品用のタイトル・説明・カテゴリ ID・Item Specifics を JSON で取得する

---

## 1. アーキテクチャ

```
[ユーザーが商品ページで「直接エクスポート」ボタンを押す]
   ↓
[とりこみ君AI が DOM 抽出]
   ↓
[プロンプト合成]
   共通プロンプト（system_common）
       +
   プラットフォーム別プロンプト（platform_mercari など）
       +
   （ユーザーカスタマイズ差分があれば適用）
       +
   商品データ（タイトル・説明・画像URL・カテゴリ・etc.）
   ↓
[OpenAI Responses API 呼び出し]
   - モデル: ユーザー選択（GPT-5.5 / 5.4 / 5.4-mini など）
   - tools: web_search 有効
   - 入力: 上記プロンプト + メイン画像（URL or base64）
   ↓
[JSON パース]
   ↓
[出力: シート転送 / クリップボード / プレビューモーダル]
```

---

## 2. JSON 出力スキーマ（API → 拡張機能）

OpenAI に「以下の JSON 形式で返せ」と指示する。`response_format: { type: "json_schema" }` で強制。

```json
{
  "title": "string (eBay Title, 80 字以内, 英語, 記号最小)",
  "description": "string (eBay Description, HTML フォーマット)",
  "categorySuggestions": [
    {
      "id": "string (eBay Category ID)",
      "path": "string (カテゴリパス, 例: Antiques > Asian Antiques > Japan > Tea Ceremony Items)",
      "recommended": "boolean",
      "reason": "string (なぜ推奨か / なぜ非推奨か, 日本語可)"
    }
  ],
  "itemSpecifics": {
    "string (Item Specific 名)": "string (値)"
  },
  "warnings": [
    "string (画像から確認できない情報、推測で補完した部分の注意書き)"
  ]
}
```

### スキーマ補足

- **`title`**: 80 字以内厳守。スペースを含む。コンマ・ハイフンなどの記号は使わない。
- **`description`**: HTML フォーマット必須。`<p>`、`<br>`、`<ul><li>` を活用。プレーンテキストは段落構造が eBay 登録時に消えるため不可。
- **`categorySuggestions`**: 1〜3 個の候補を推奨度付きで提示。1 個に絞らないことで椛島さんが最終判断できる。
- **`itemSpecifics`**: 項目は AI が商品カテゴリに応じて自由に判断（フェーズ 1 方針）。eBay カテゴリ別の必須項目スキーマへの厳密対応はフェーズ 2 で実装。
- **`warnings`**: ハルシネーション防止の透明性。「画像から確認できないため推測しました」等を明示。

---

## 3. プロンプト合成方針

### 3 層構造

```
1. 共通プロンプト (system_common)
   - 役割定義
   - 出力 JSON スキーマ強制
   - ハルシネーション抑制（画像で確認できない情報は推測しない、warnings に記載）
   - eBay の基本ルール（80字、HTML、SEO、禁止語）

2. プラットフォーム別プロンプト (platform_*)
   - そのプラットフォーム固有のノイズ除外
   - DOM 構造の特性を踏まえた読み取り指示
   - 例: メルカリ → 即購入OK・専用・コメント不要 等の出品者個人都合を翻訳対象から外す

3. ユーザーカスタマイズ差分 (任意)
   - ユーザーが options 画面で公式プロンプトを編集
   - 編集後は「ユーザー版」が優先される
   - リセットで公式版に戻せる
```

### API 呼び出し時のメッセージ構造

```
{
  "model": "<ユーザー選択>",
  "input": [
    {
      "role": "system",
      "content": "<共通プロンプト> + <プラットフォーム別プロンプト>"
    },
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "<商品データ JSON>" },
        { "type": "input_image", "image_url": "<メイン画像 URL>" }
      ]
    }
  ],
  "tools": [{ "type": "web_search" }],
  "response_format": { "type": "json_schema", "json_schema": <上記スキーマ> },
  "reasoning_effort": "low"
}
```

---

## 4. 入力データ（拡張機能 → API）

商品ページから抽出する情報:

```json
{
  "platform": "mercari",
  "url": "https://jp.mercari.com/item/m51808395803",
  "title": "<日本語タイトル>",
  "description": "<日本語商品説明>",
  "price": 12345,
  "seller": "<出品者名>",
  "categoryPath": "<メルカリ側のカテゴリパス, 取得できれば>",
  "condition": "<状態>",
  "imageUrl": "<メイン画像 URL>",
  "itemDetails": {
    "<DOM 抽出した詳細フィールド>": "<値>"
  }
}
```

---

## 5. 制約と要件

| 項目 | 仕様 |
|---|---|
| eBay Title | **80 文字**以内（スペース含む）|
| eBay Description | **HTML 必須**（`<p>`, `<br>`, `<ul>`, `<li>` を活用）|
| 出力言語 | 英語 |
| ハルシネーション | 画像で確認できない情報を推測した場合は `warnings` に明記 |
| 禁止語（タイトル）| free shipping / New / used / コンマ / ハイフン |
| キーワード配置 | メインキーワード+複合キーワードをタイトル左側に |
| Web 検索 | OpenAI の `web_search` ツールを有効化（GPTs に近い動作）|
| 画像入力 | メイン画像 1 枚を URL または base64 で渡す |

---

## 6. 出力品質の検証方針

メルカリで MVP 実装後、以下のサンプル商品で精度を確認する:

- 茶道具（Karakane Bronze Tea Ceremony Set）→ 既に GPTs サンプルあり
- カードゲーム（旧裏ピカチュウ なみのり）→ プロンプト検証_20260418.xlsx に既存
- アンティーク・骨董
- 衣類
- 電化製品

椛島さんが普段扱う商品ジャンルの代表例で 5〜10 件動かして、GPTs の精度に追いついているかを評価する。

---

## 7. 実装フェーズ

| Phase | スコープ |
|---|---|
| **Phase 1**（本タスク）| メルカリのみ・MVP 実装。タイトル+説明+カテゴリ ID 候補+Item Specifics（自由項目）の JSON 出力 |
| **Phase 2** | Item Specifics の eBay カテゴリ別スキーマ厳密対応、一括シート V4 並行開発 |
| **Phase 3** | 全プラットフォーム展開（楽天・Yahoo!・ハードオフ・ヤフオク・Amazon・ラクマ・PayPay）|
| **Phase 4** | ユーザープロンプトのカスタマイズ AI アシスト（メタプロンプト）|
