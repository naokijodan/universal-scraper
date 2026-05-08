# ユーザーカスタマイズ仕様

**ゴール**: ユーザーが options 画面でプロンプトを自由に編集・保存・リセットできるようにする。

---

## 1. 編集可能範囲

| 編集対象 | 編集可否 | 備考 |
|---|---|---|
| 共通プロンプト（system_common）| ✅ 編集可 | 全プラットフォーム共通の指示 |
| プラットフォーム別プロンプト（platform_mercari など）| ✅ 編集可 | プラットフォームごとに独立して編集 |
| JSON 出力スキーマ | ❌ 編集不可 | コードでパースする前提のため固定 |
| API キー / モデル選択 | ✅ 設定可 | プロンプトとは別の設定欄 |

---

## 2. options 画面の UI

```
┌─ AI翻訳設定 ─────────────────────────────────────┐
│                                                    │
│ □ AI翻訳を使う（OFF にすると従来モード）         │
│                                                    │
│ OpenAI API キー:                                   │
│ [_________________________________________]        │
│                                                    │
│ モデル:                                            │
│ ◯ GPT-5.5（最高精度）                             │
│ ◯ GPT-5.4（バランス）                             │
│ ● GPT-5.4 mini（コスト重視・推奨）                │
│ ◯ カスタム: [________________]                    │
│                                                    │
│ Web 検索ツール: ☑ 有効化（推奨）                  │
│                                                    │
│ 対応プラットフォーム:                              │
│ ☑ メルカリ  ☐ 楽天  ☐ ハードオフ  ☐ ヤフオク...  │
│                                                    │
└─ プロンプト編集 ─────────────────────────────────┐
│                                                    │
│ ▼ 共通プロンプト [リセット]                      │
│ ┌────────────────────────────────────────────────┐│
│ │ あなたは eBay 出品の専門家です。              ││
│ │ ...                                            ││
│ │ ...                                            ││
│ └────────────────────────────────────────────────┘│
│                                                    │
│ ▼ メルカリ用プロンプト [リセット]                │
│ ┌────────────────────────────────────────────────┐│
│ │ メルカリ特有のノイズ除外:                     ││
│ │ ...                                            ││
│ └────────────────────────────────────────────────┘│
│                                                    │
│ [すべてのプロンプトを公式に戻す]                  │
│                                                    │
└────────────────────────────────────────────────────┘
```

### UI の動作

- **`▼ プロンプト名`**: アコーディオン形式で開閉できる
- **`[リセット]`**: そのプロンプトだけ公式版に戻す（確認ダイアログあり）
- **`[すべてのプロンプトを公式に戻す]`**: 全カスタムプロンプトを公式に戻す（確認ダイアログあり）
- **textarea**: ユーザーが直接編集（行数自動拡張）
- **保存**: options 画面上部の「設定を保存」ボタン押下時に他の設定と一緒に保存

---

## 3. ストレージ設計

### ストレージの分割（セキュリティ最優先）

**API キーは `chrome.storage.local` に保存し、`chrome.storage.sync` には絶対に置かない**。理由:
- `sync` は Google アカウント越しに他端末へ同期される → 端末紛失や同期先漏洩のリスク
- `local` は端末ローカルのみで保持される

#### chrome.storage.local（同期しない、APIキー専用）

```javascript
{
  aiApiKey: "",                       // OpenAI API キー（マスク表示・端末ローカルのみ）
}
```

#### chrome.storage.sync（同期する、設定とプロンプト）

```javascript
{
  // AI 機能の基本設定
  aiTranslationEnabled: false,        // AI 翻訳を使うか（デフォルト OFF）
  aiModel: "gpt-5.4-mini",            // 使用モデル
  aiCustomModel: "",                  // カスタムモデル名（aiModel === "custom" のとき使用）
  aiWebSearchEnabled: true,           // Web 検索ツール
  aiPlatforms: {                      // プラットフォームごとに ON/OFF
    mercari: true,
    rakuten: false,
    hardoff: false,
    // ...
  },

  // ユーザーカスタムプロンプト（ユーザーが編集した場合のみ存在）
  // 存在しなければ公式版を使う
  aiPromptOverride_common: "",        // 共通プロンプトの上書き
  aiPromptOverride_mercari: "",       // メルカリ用プロンプトの上書き
  // 他プラットフォームは Phase 3 で追加
}
```

---

## 3.5. APIキーセキュリティ（最重要）

### 漏洩防止の徹底ルール

| ルール | 実装上の対応 |
|---|---|
| **保存先**: `chrome.storage.local` のみ | 別端末への自動同期なし |
| **UI マスキング**: `<input type="password">` | 表示ボタンを別途用意（クリック時のみ平文）|
| **ログ出力禁止** | `console.log` / エラーメッセージにキーを書かない。マスク `sk-***` を使う |
| **送信先**: `https://api.openai.com` のみ | manifest.json の `host_permissions` に必要最小限のみ追加 |
| **HTTPS 強制** | 拡張機能側でも `https://` でない URL は弾く |
| **メモリ最小化** | API リクエスト時のみ変数で保持。グローバル変数禁止。リクエスト後は破棄 |
| **API 呼び出しは background.js 経由** | content.js から直接 OpenAI に投げない（ページ JS と完全分離するため）|
| **第三者ライブラリ禁止** | OpenAI API 呼び出しは fetch のみ。SDK / npm パッケージを使わない |
| **CSP 維持** | manifest.json の `content_security_policy` に `script-src 'self'` を維持 |
| **テレメトリー禁止** | 取り込み内容・APIキー・利用状況などを OpenAI 以外の第三者に送信しない |

### コード上の典型パターン

#### マスク表示

```javascript
function maskApiKey(key) {
  if (!key) return '';
  if (key.length < 12) return 'sk-***';
  return key.slice(0, 7) + '***' + key.slice(-4);
}
console.log('Using API key:', maskApiKey(apiKey));  // ログには絶対にマスクしたものだけ
```

#### options.html の入力欄

```html
<label for="aiApiKey">OpenAI API キー</label>
<div style="display: flex; gap: 8px;">
  <input type="password" id="aiApiKey" autocomplete="off" spellcheck="false">
  <button type="button" id="aiApiKeyToggle">表示</button>
</div>
<div class="info-box">
  ⚠️ API キーは <strong>あなたのブラウザのローカルストレージのみ</strong>に保存されます。
  他端末への同期や外部送信は一切行いません。OpenAI への正規 API リクエスト時のみ使用されます。
</div>
```

#### background.js での API 呼び出し

```javascript
// content.js から chrome.runtime.sendMessage で background に依頼
// background.js が chrome.storage.local からキーを取得して fetch
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type === 'AI_TRANSLATE') {
    const { aiApiKey } = await chrome.storage.local.get('aiApiKey');
    if (!aiApiKey) {
      sendResponse({ error: 'API キーが設定されていません' });
      return true;
    }
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiApiKey}`
        },
        body: JSON.stringify(msg.payload)
      });
      const json = await response.json();
      sendResponse({ data: json });
    } catch (e) {
      // エラーメッセージにキーを含めない
      sendResponse({ error: 'API 呼び出しに失敗しました: ' + e.message });
    }
    return true;
  }
});
```

### ユーザーへの透明性

options 画面と README にセキュリティ説明を明記:

> 🔒 **API キーの取り扱いについて**
> - お客様の API キーは、お使いのブラウザの**ローカルストレージのみに保存されます**。
> - 他の端末への自動同期は行いません。
> - OpenAI 社の正規 API（https://api.openai.com）への通信時のみ使用されます。
> - 当拡張機能の開発者を含む第三者へキーを送信することはありません。
> - キーが心配な場合はいつでも options 画面で削除できます。
> - OpenAI の利用料金はお客様の OpenAI アカウントに直接課金されます。

### 公式プロンプトの配布

- 公式プロンプトは拡張機能のコード内に同梱（`prompts/system_common.txt`、`prompts/platform_mercari.txt`）
- アップデート時はコードのプロンプトが新版に置き換わる
- ユーザーが編集していない（`aiPromptOverride_*` が空）場合は新版が反映される
- ユーザーが編集している場合は **編集版が優先される**（公式版は古いまま使われる可能性 → リセットボタンで最新版に戻せる）

---

## 4. プロンプト合成ロジック（コード側）

```javascript
function buildSystemPrompt(platform, settings, defaultPrompts) {
  // 共通プロンプト（カスタム > 公式）
  const common = settings.aiPromptOverride_common?.trim()
    || defaultPrompts.common;

  // プラットフォーム別プロンプト（カスタム > 公式）
  const platformKey = `aiPromptOverride_${platform}`;
  const platformPrompt = settings[platformKey]?.trim()
    || defaultPrompts[platform];

  // 連結（共通 → プラットフォーム別）
  return `${common}\n\n---\n\n${platformPrompt}`;
}
```

---

## 5. リセット動作

### 個別リセット

```javascript
async function resetPromptToOfficial(platformKey) {
  // 例: platformKey = 'common' or 'mercari'
  const storageKey = `aiPromptOverride_${platformKey}`;
  await chrome.storage.sync.remove(storageKey);  // または空文字に上書き
  // UI を再描画して公式プロンプトを textarea に反映
}
```

### 全リセット

```javascript
async function resetAllPromptsToOfficial() {
  const keys = Object.keys(await chrome.storage.sync.get(null))
    .filter(k => k.startsWith('aiPromptOverride_'));
  await chrome.storage.sync.remove(keys);
}
```

---

## 6. AI アシスト（Phase 4）

将来構想: ユーザーが自然言語で「もっとSEOを意識したタイトルにしたい」「説明文を短くしたい」と書くと、AI がプロンプトを自動修正・提案する仕組み。

### 想定 UI

```
┌─ メルカリ用プロンプト ──────────────────────────────┐
│ [textarea：現在のプロンプト]                       │
│                                                      │
│ 改善したい内容を書いてください:                    │
│ [_________________________________________________] │
│ [AI に提案させる]                                  │
│                                                      │
│ ▼ AI からの提案                                     │
│ [textarea：AI の修正案]                            │
│ [採用] [破棄] [部分採用]                            │
└──────────────────────────────────────────────────────┘
```

### 実装メモ

- メタプロンプト用に別のシステムプロンプトを用意（「あなたはプロンプトエンジニアリングの専門家です...」）
- 編集対象プロンプトを context として渡す
- 修正案を返してもらい、ユーザーが採用判断

Phase 4 で別途設計書を作る。Phase 1 では UI のスペースだけ確保（実装は後回し）も可。

---

## 7. 実装の優先度

| Phase | 内容 |
|---|---|
| **Phase 1**（本タスク）| API キー設定、モデル選択、AI 翻訳 ON/OFF、プラットフォーム別 ON/OFF、プロンプト編集（共通+メルカリ）、リセット |
| **Phase 2** | Item Specifics の eBay カテゴリ別スキーマ厳密対応、一括シート V4 |
| **Phase 3** | 他プラットフォームのプロンプト追加（楽天・Yahoo・ハードオフ etc.）|
| **Phase 4** | AI アシスト（メタプロンプト）|
