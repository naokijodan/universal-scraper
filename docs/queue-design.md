# とりこみ君 送信キュー方式 設計書

**作成日**: 2026-05-13
**対象バージョン**: v1.4.4（予定）
**ステータス**: 設計レビュー中

---

## 1. 背景・目的

### 1-1. 起きている問題（Fact）

- 椛島さんの実機ログ（2026-05-13 10:37〜10:45、Apps Script 実行ログ）で確認:
  - 10:37:42 の doPost が **361.237 秒** 動いて「タイムアウト」（= GAS の 6 分上限超え）
  - その後 10:43:25 までの **約 6 分間**、後続の doPost が全て **約 32 秒で完了**（= `LockService.waitLock(30000)` でロック取得失敗 → `lock_timeout` を返却 → クライアントには「失敗」、データは書き込まれず）
  - 10:43:59 以降、ようやくロックが解放されて正常復帰

### 1-2. 椛島さんの観察（重要なヒント）

- 「**以前の直接エクスポートではそんなに起こらなかった**」
- 「**V5用のデータは文字数が多い**」

→ V5 の AI 翻訳結果（タイトル / Description / カテゴリーID / Item Specifics / タグ）はデータ量が大きく、1件あたりの GAS 処理時間が伸びている。10 件くらいの連続送信で累積処理時間が 6 分を超えると、最後尾の doPost がハングしてロック詰まりを起こす。

### 1-3. 直接 POST 方式の限界（Fact + Inference）

- 現状: 1 商品 = 1 sendMessage = 1〜2 POST（即時発火）
- 連打すると並行 POST が GAS にぶつかる → LockService の取り合い
- GAS の Anti-abuse limit（公式ドキュメント）: 連続超過で **数分間ブロック**
- 失敗してもクライアントにフィードバックなし（fire-and-forget）→ ユーザーは気づかず再送 → 悪化

### 1-4. 目的

- 連続押下や大量送信に対して **詰まらない** とりこみ君に作り直す
- 失敗を **自動回復** する
- ユーザーがキューの状態を **可視化** できるようにする
- V5 勉強会（2026-05-16）に間に合わせる

---

## 1-5. スコープ（重要・椛島さん確認済み）

**変更するのは AI 翻訳実行後のエクスポート 2 ボタンのみ。それ以外の送信ルートは触らない。**

| 送信箇所 | ファイル / 行 | 扱い |
|---|---|---|
| 翻訳結果モーダル「⏩ 両方エクスポート」 | content.js:7796 | **キュー化対象** |
| 翻訳結果モーダル「📋 v5インポートのみ」 | content.js:7856 | **キュー化対象** |
| 旧来の直接エクスポート（V5 以前からある送信）| content.js:5447 周辺 | **現状維持・触らない** |
| AI 翻訳実行（`aiTranslate`） | content.js:7246 | **現状維持・触らない**（同期処理が必要） |
| AI 翻訳修正（`aiRefine`） | content.js:7292 | **現状維持・触らない**（同上） |
| `exportAi` 内の暫定実装 | content.js:8096 | **現状維持・触らない**（別フローからの呼び出し） |
| `exportAiToV5Import` 内の暫定実装 | content.js:8149 | **現状維持・触らない**（同上） |

理由: 旧来の直接送信は問題なく動いており、椛島さん運用上も支障がない。V5 / AI 翻訳が絡む大量データ送信だけがロック詰まりを起こしているため、改修範囲はそこに限定する。

---

## 2. 設計の根幹

| 項目 | 値（デフォルト） | 可変範囲 | 備考 |
|---|---|---|---|
| キュー保存先 | `chrome.storage.local`（5MB、永続、ブラウザ再起動後も残る） | — | — |
| ワーカー | `background.js` の Service Worker + `chrome.alarms` | — | — |
| **バルクサイズ** | **20 件 / POST** | **1〜50** | GAS 側 MAX_ROWS_PER_REQUEST=50 が上限（Fact） |
| **送信間隔** | **1 分（chrome.alarms 制約）** | **1〜120 秒**（alarms 用 / 内部キック用は別管理） | 公開拡張は alarms 最小 1 分（公式制約、Fact）。即時キックで体感は維持 |
| リトライ上限 | 0 回 | 0〜3 回 | §16 (v1.4.7): 既定では自動リトライせず、1回目の失敗で `failed` 固定 |
| リトライ間隔 | 5 → 15 → 45 秒（指数バックオフ） | 倍率 1.5〜5 倍 | — |
| fetch タイムアウト | 60 秒 | 10〜120 秒 | 通信遅延への保険 |
| 可視化 | 設定画面（options.html）のヘッダー直下にキュー進捗パネル | — | — |
| 互換性 | GAS 側は既に `{rows: […]}` 一括モード対応済み（2026-05-12 commit b93f7d1） | — | 改修不要 |

### 2-1. バルクサイズの設計判断（椛島さん協議済）

- GAS 側上限: **50件**（Fact、Main.js:272）
- GAS 側 4.5 分セーフティ: 50件で 1件 5秒だと 4.2 分（ぎりぎり）、1件 7秒で skipped 発生
- V5 データは文字数が大きいため、デフォルトは **20件** に絞って安全側
- skipped が出ても、クライアント側で自動的に再キュー（データ消失なし）
- 設定 UI から 1〜50 で可変、椛島さんが実機で最適値を測定可能

### 2-2. 送信間隔の設計判断（Gemini レビュー反映、椛島さん再協議済）

**重要な公式制約（Fact、Gemini レビューで判明）**:
- Chrome 公式: 「公開拡張機能 (Web Store にパックされた状態) の alarms は **最小 1 分間隔**」
- Unpacked では 15 秒等の短い間隔でも動くが、公開後は 1 分に強制される
- 出典: developer.chrome.com/docs/extensions/reference/api/alarms

**採用する設計**:
- `chrome.alarms` の周期 = **1 分**（公式制約準拠）
- ただし `handleEnqueueExport` 内で **即時 `processQueue()` キック** が実装済み
- これにより:
  - **ボタン押下 → 即送信開始**（1分待たない）
  - 1分タイマーは「ボタン押し忘れて放置されたキュー」や「リトライタイミング」のバックアップ
- 椛島さんの普段の使い方では体感ゼロ

**通信環境への調整**:
- alarms 周期は 1 分固定（Chrome 制約上、変えられない）
- 代わりに `queueConfig.fetchTimeoutMs` を 10〜120 秒で可変にして、通信遅延の保険として使う

---

## 3. 動作フロー

```
[ユーザー] 「両方エクスポート」or「v5インポートのみ」クリック
    ↓
[content.js] payloads を組み立てる
    ↓
[content.js] sendMessage({ action: 'enqueueExport', items: [...] })
    ↓
[background.js] chrome.storage.local.queue に push（status='waiting'）
    ↓
[content.js] ユーザーには「キューに追加しました（待機 N 件）」と即通知
    ────────────────────────────────────
    （ここから非同期、ユーザー操作は不要）
    ────────────────────────────────────
[chrome.alarms] 30 秒ごとに発火
    ↓
[background.js processQueue()]
    ↓
    isSending フラグを確認（mutex）
    ↓
    waiting / nextRetryAt が現在時刻を超えた item を最大20件抽出
    ↓
    同一 webhookUrl ごとにグループ化（複数のシートを使っている場合のため）
    ↓
    { rows: [{ values, sheetName }, …] } を組み立てて1 POST
    ↓
    [成功] → 各 item を status='sent' に。一定時間後にクリーンアップ
    [失敗] → maxRetry=0 なら status='failed'。maxRetry>0 なら retryCount++、nextRetryAt = 現在+待機時間、status='waiting' に戻す
    [上限超過] → status='failed' に。ユーザーが手動リトライするまで再送しない
    ↓
    isSending フラグを解除
```

---

## 4. データ構造

### 4-1. `chrome.storage.local.queue`

```javascript
queue: [
  {
    id: 'uuid-v4',                     // 一意ID（衝突回避）
    createdAt: 1730000000000,          // 追加時刻（ms）
    webhookUrl: 'https://script.google.com/macros/s/.../exec',
    sheetName: 'v5インポート' | 'インポート用',
    values: [/* 1行分のセル配列 */],
    status: 'waiting' | 'sending' | 'sent' | 'failed',
    retryCount: 0,                     // リトライ回数
    nextRetryAt: 0,                    // 0なら即時、それ以外は再送可能時刻（ms）
    lastError: null | '...',           // 失敗理由
    completedAt: null | timestamp,     // 成功 or 永久失敗の時刻
    sourceLabel: 'メルカリ / 商品タイトル...'  // 監視UIで表示する人間可読ラベル
  },
  ...
]
```

### 4-2. `chrome.storage.local.queueStats`（派生、UI更新を軽くするためのキャッシュ）

```javascript
queueStats: {
  waiting: 5,      // 送信待ち
  sending: 1,      // いま GAS に送信中
  sent: 24,        // 直近の成功（24時間以内）
  failed: 0,       // 永久失敗（要手動対応）
  retrying: 2,     // リトライ待機中（nextRetryAt が未来）
  lastSyncAt: 1730000000000,
}
```

### 4-3. `chrome.storage.local.queueConfig`

```javascript
queueConfig: {
  batchSize: 20,            // バルクサイズ（変更可、デフォルト 20）
  intervalSec: 30,          // 送信サイクル（変更可、デフォルト 30 秒）
  maxRetry: 0,              // §16 (v1.4.7) リトライ上限。既定では自動リトライしない
  retryBackoffMs: [5000, 15000, 45000],  // 指数バックオフ
  cleanupAfterMs: 24 * 60 * 60 * 1000,   // sent を消すまでの時間（24時間）
  paused: false             // true なら送信を一時停止（手動制御）
}
```

---

## 5. UI 仕様

### 5-1. 設定画面（options.html）ヘッダー直下

新規セクション「📤 送信キュー」を **「担当者名」入力の前** に挿入。

```
┌─────────────────────────────────────────────────┐
│ 📤 送信キュー                              [⏸ 一時停止]  │
│                                                  │
│  待機: 5    送信中: 1    リトライ: 2             │
│  成功: 24   失敗: 0                              │
│                                                  │
│  [▶ 今すぐ送信] [↻ 失敗をリトライ] [🗑 失敗をクリア]│
│                                                  │
│  ─────────── 詳細を表示 ▾ ───────────           │
│  （展開時：個別キュー項目のリストを表示）         │
│   • [待機] メルカリ / iPhone 14 Pro...           │
│   • [送信中] 楽天 / フィギュア商品...           │
│   • [失敗 3回] Amazon / 時計... [↻ 再送][🗑]    │
└─────────────────────────────────────────────────┘
```

**表示する数値（リアルタイム更新、`chrome.storage.onChanged` で監視）**:
- 待機（status=waiting & nextRetryAt <= 現在）
- 送信中（status=sending）
- リトライ（status=waiting & nextRetryAt > 現在）
- 成功（status=sent）
- 失敗（status=failed）

**ボタン**:
- ⏸ 一時停止 / ▶ 再開
- ▶ 今すぐ送信（次のサイクルを待たず即実行）
- ↻ 失敗をリトライ（status=failed を waiting に戻して retryCount=0 リセット）
- 🗑 失敗をクリア（status=failed の item を完全削除）

**詳細表示**:
- アコーディオン展開
- 個別の項目を出す（最大 50 件）
- 各項目に [↻ 再送] [🗑 削除] ボタン

### 5-2. 翻訳結果モーダルの送信ボタン

現状: 「⏩ 両方へ一括エクスポート」「📋 v5インポートのみ」
変更後:
- ラベルは同じ（ユーザーから見える挙動は「これまで通り押せばいい」）
- 内部的に「即送信」→「キューに積む」に変わる
- 通知文言: 「**キューに追加しました（待機 N 件）。設定画面で進捗を確認できます。**」

### 5-3. 失敗時のユーザー通知

- Chrome 通知 API で「**N 件の送信に失敗しました**」を表示（連続失敗 3 件以上）
- クリックで設定画面の「送信キュー」セクションを開く

---

## 6. リトライポリシー

| 失敗回数 | 次回送信までの待機 | 状態 |
|---|---|---|
| 1回目（maxRetry=0 の既定） | — | `failed` 固定。手動操作待ち |
| 1回目（maxRetry>=1） | 5 秒 | `waiting`（nextRetryAt 設定） |
| 2回目（maxRetry>=2） | 15 秒 | 同上 |
| 3回目（maxRetry=3） | 45 秒 | 同上 |
| 上限超過 | — | `failed` 固定。手動操作待ち |

**指数バックオフの根拠**: Google 公式の rate limit エラー対処の推奨パターン（「Service invoked too many times in a short time」発生時は `Utilities.sleep` を挟んでリトライ）に倣う。

---

## 7. スケジューリング

### 7-1. アラーム

```javascript
chrome.alarms.create('processQueue', { periodInMinutes: 0.5 });  // 30 秒
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'processQueue') await processQueue();
});
```

### 7-2. processQueue() の擬似コード

```javascript
async function processQueue() {
  const lock = await acquireLock();           // chrome.storage の isSending フラグで mutex
  if (!lock) return;                          // 既に動いていればスキップ
  try {
    const { queue, queueConfig } = await chrome.storage.local.get(['queue', 'queueConfig']);
    if (queueConfig.paused) return;

    const now = Date.now();
    const eligible = queue.filter(q =>
      q.status === 'waiting' && (q.nextRetryAt || 0) <= now
    );
    if (eligible.length === 0) return;

    // webhookUrl ごとにまとめる
    const byUrl = groupBy(eligible, q => q.webhookUrl);
    for (const [url, items] of Object.entries(byUrl)) {
      const batch = items.slice(0, queueConfig.batchSize);   // 最大20件
      const rows = batch.map(i => ({ values: i.values, sheetName: i.sheetName }));

      // 送信中マーク
      await markAs(batch, 'sending');
      try {
        const res = await fetch(url, {
          method: 'POST',
          mode: 'cors',                                       // ← レスポンス読みたいので no-cors やめる
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows })
        });
        const json = await res.json();
        // GAS は results[] を返すので、個別の成否を反映
        await applyResults(batch, json);
      } catch (err) {
        await markAsFailed(batch, err);                       // retryCount++ または failed
      }
    }
  } finally {
    await releaseLock();
  }
  await updateStats();                                        // queueStats を再計算
}
```

### 7-3. mutex（並行送信防止）— Gemini レビュー反映で方針変更

**旧案（chrome.storage ベース）**: `isSending` フラグを get → 判定 → set。
**問題（Fact）**: `await` 境界で割り込みが起きる → mutex 自体に race condition がある（Gemini 指摘）。

**新案（メモリ内 Promise チェーン）**:

```javascript
// service worker のグローバルスコープに保持
let currentOperation = Promise.resolve();

function withStorageLock(work) {
  // 直列化キュー: 前の処理が終わるまで次は待つ
  const next = currentOperation.then(work).catch((e) => {
    console.error('[queue] withStorageLock work error:', e);
  });
  currentOperation = next;
  return next;
}
```

- `enqueueExport` / `processQueue` / `applyResults` / `initQueueState` 等、**chrome.storage を変更するすべての処理**を `withStorageLock(...)` で包む
- Service Worker は単一インスタンス → メモリ内変数で十分機能する（Fact: MV3 仕様）
- `acquireLock` / `releaseLock` は **削除**（不要になる）
- `isSending` / `isSendingAt` キーも削除（Service Worker は単一インスタンスなので不要）

### 7-4. Service Worker 起動時の孤児リカバリ — Gemini レビュー反映で追加

**問題（Fact）**: Service Worker は ~30 秒のアイドルや突然のクラッシュで停止する。`sending` マーク中に停止すると、データが永遠に `sending` のまま放置される（ゾンビ化、ブラックホール現象）。

**対策**:
- `initQueueState()` 内で、起動時に **`sending` → `waiting` に戻す**
- 二度書きリスク: GAS Main.js は H 列マッチで上書きする設計 → 万一二度送信されても同内容で上書きされるだけで実害が小さい

```javascript
// 起動時クリーンアップ
async function reviveOrphanedSending() {
  const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
  const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
  const revived = queue.map((q) => q?.status === 'sending'
    ? { ...q, status: 'waiting', lastError: 'service worker reboot' }
    : q);
  await chrome.storage.local.set({ [QUEUE_KEYS.queue]: revived });
}
```

---

## 8. 影響範囲（変更ファイル）

| ファイル | 変更内容 | 規模 |
|---|---|---|
| `background.js` | `handleExportBoth` を廃止（または互換のためキューへ転送）。`enqueueExport` / `processQueue` / `acquireLock` / `applyResults` を新設 | 約 150 行追加 |
| `content.js` | **7796 / 7856 行のみ** の `action:'exportBoth'` を `action:'enqueueExport'` に変更。即時通知テキストを「キューに追加しました」に変更。**5447 / 8096 / 8149 など他の sendMessage は一切触らない** | 数行 |
| `options.html` | ヘッダー直下に「📤 送信キュー」セクションを追加 | 約 30 行 |
| `options.css` | キューパネルのスタイル（既存配色に合わせる） | 約 80 行 |
| `options.js` | パネルのデータ取得・更新・ボタン処理。`chrome.storage.onChanged` 監視 | 約 150 行 |
| `manifest.json` | permissions に `alarms`、`notifications`（既にあるか確認） | 1〜2 行 |

---

## 9. 段階的実装プラン（Gemini 再レビュー + 椛島さん協議で Phase 1/2 統合）

| Phase | 内容 | 確認方法 |
|---|---|---|
| **1+2 統合: キュー + バルク20 + 任意の自動リトライ** | enqueue / processQueue / withStorageLock / fetch bulk + **指数バックオフ自動リトライ**（§16 (v1.4.7): 既定 0 回、設定時 5s→15s→45s）+ クラッシュ防止 | 10件押しても詰まらない / 故意に失敗させて failed 遷移を確認 |
| **3. 設定画面に進捗パネル** | options.html / options.js のキューUI | 設定画面に正しい数値が出ること、各ボタンの動作確認 |

### 統合の理由

- Gemini 再レビューで「Phase 1 でリトライがないのはキューとして信頼性を著しく損なう」と指摘
- 設計書では Phase 2 計画だったが、椛島さん協議で「最終的に入るならまとめて実装」と決定
- 規模拡大のリスクは小（既存コードに `retryCount` / `retryBackoffMs` の定数が既にある）

### リトライ仕様

- `applyResults` での失敗判定:
  - §16 (v1.4.7): `maxRetry=0` なら1回目の失敗で status='failed' に固定
  - `nextRetryCount <= maxRetry` なら status='waiting' に戻して `nextRetryAt = now + retryBackoffMs[nextRetryCount - 1]`
  - `nextRetryCount > maxRetry` なら status='failed' に固定
- `processQueue` の eligible フィルタを「`status==='waiting' && (nextRetryAt || 0) <= now`」に変更
- 「全件失敗」と「個別行失敗」の両方でリトライ対象

---

## 10. テスト項目

| # | テスト内容 | 期待結果 |
|---|---|---|
| 1 | 1 件だけ送信 | 30秒以内に GAS に書き込まれる |
| 2 | 10 件連打 | 1 POST にまとまり、1 サイクルで全件成功 |
| 3 | 25 件連打 | 20 件 + 5 件 の 2 サイクルで全件成功 |
| 4 | GAS を止めた状態で 5 件送信（maxRetry=0） | 1回目の失敗で failed 固定。重複送信しない |
| 5 | GAS が常に失敗を返す（maxRetry=3） | 3 回リトライ後に failed 固定。失敗通知が出る |
| 6 | failed 状態の item を「リトライ」ボタン | retryCount=0 でリトライ再開、成功すれば sent |
| 7 | タブを閉じて再起動 | キューは残っており、自動送信が再開 |
| 8 | 「一時停止」ボタン | サイクルが止まり、再開ボタンで戻る |
| 9 | 文字数の多い V5 データを 20 件 | GAS が 6 分以内に処理しきれること（要実測） |
| 10 | 旧版とりこみ君（直接POST）と新版（キュー）を併用 | GAS 側は両方を正しく処理（後方互換） |

---

## 11. リスク・注意点

| リスク | 対処 |
|---|---|
| Service Worker のアイドル化 | `chrome.alarms` で 30 秒ごとに強制起動 |
| mutex が解放されずスタック | メモリ内 Promise チェーンに変更したため、Service Worker 再起動で自動解消 |
| sending 状態の孤児化（Gemini 指摘） | 起動時に sending → waiting に戻す `reviveOrphanedSending()` を実装 |
| chrome.storage.local の 5MB 上限 | 1 件 ~5KB と仮定 → 1000 件で 5MB。上限を 500 件にして、超えたら新規 enqueue を拒否＋ユーザー通知 |
| sent 状態の item が溜まる | 24 時間経った sent はクリーンアップ |
| no-cors → cors への変更で GAS 側のレスポンス問題 | GAS の WebApp デプロイ設定で CORS 許可が必要。doPost は `ContentService.createTextOutput(JSON.stringify(...)).setMimeType('JSON')` を返しているので OK のはず（要確認） |
| 既存ユーザーへの影響 | manifest.json の version bump → 自動更新 → 起動時にキュー schema を初期化 |
| 旧版互換（一部の自動化が直接POSTを使っている可能性） | GAS Main.js は単一形式と rows形式 両方対応済み → 旧版が壊れることはない |
| V5 データ20件で 6 分を超えた場合 | バルクサイズを 10 件に下げる対応を可能にする（queueConfig.batchSize で調整） |

---

## 12. 互換性

- **GAS 側**: 改修不要。`Main.js` の doPost は既に `data.rows` 配列を受けて一括処理する分岐がある（2026-05-12 commit b93f7d1、Fact）
- **旧版とりこみ君**: GAS 側は単一形式 `{values, sheetName}` も維持しているので壊れない
- **楽々（rakuraku）**: 既に bulk 送信に対応済み、影響なし

---

## 13. ロールバック手順

新版で問題が出た場合:
1. Chrome Web Store で 1 つ前のバージョン（v1.4.3）に差し戻し
2. ローカルでは `chrome://extensions` から「以前のバージョンを再インストール」
3. `chrome.storage.local.queue` を手動でクリア（不要キューを除く）

---

## 14. 完了基準（勉強会 2026-05-16 までに）

- [ ] Phase 1 動作確認（10件連打で詰まらない）
- [ ] Phase 2 動作確認（自動リトライ）
- [ ] Phase 3 動作確認（設定画面で可視化）
- [ ] 椛島さんの実機テスト合格
- [ ] manifest.json version bump（v1.4.3 → v1.4.4）
- [ ] Chrome Web Store にアップロード
- [ ] 椛島さんと外注さんへの周知

---

## 15. 設計判断ポイント（椛島さん協議結果）

| # | 項目 | 椛島さん回答 | 反映 |
|---|---|---|---|
| 1 | バルクサイズ | デフォルト 20、設定で 1〜50 可変 | ✅ §2 で反映 |
| 2 | 送信間隔 | デフォルト 15 秒、設定で 5〜120 秒可変（通信環境で調整） | ✅ §2 で反映 |
| 3 | 「一時停止」ボタン | 必要 | ✅ §5-1 で配置 |
| 4 | 詳細表示（個別項目リスト） | 必要 | ✅ §5-1 アコーディオン |
| 5 | 失敗時の Chrome 通知 | 必要（連続失敗時） | ✅ §5-3 |

### 椛島さんの追加要望（記録）

- 「**翻訳実行後**のエクスポートのみキュー化、それ以外（直接送信・内容確認後送信）は触らない」 → §1-5 スコープに反映
- 「**バルクサイズと送信間隔は調整可能にしたい**」（通信環境で変わるので） → §2 で反映
- 「**設定画面のヘッダー直下**にキュー数表示と進捗（成功/失敗/リトライ/待機）」 → §5-1 で反映
- 「**慎重に・丁寧に**進める」 → §9 段階的実装プラン、§10 テスト項目、§13 ロールバック手順で担保

### 開発体制（rules/code-review-evaluator.md E-01〜E-02 準拠）

- **コード生成**: サブエージェント（general-purpose）に丁寧な指示書を渡して実装
- **レビュー**: 親 Claude + Gemini（mcp__gemini-bridge）の2者レビュー
- 採点基準: 安全性 / 仕様準拠 / 動作確認 / コード品質
- 片方でも FAIL → 議論 → 修正 → 再レビュー

### Phase 1 初回レビュー結果（2026-05-13）— Gemini 指摘で FAIL → 修正中

- 問題 1: Race condition（enqueue vs processQueue の get/set 割り込み） → Promise チェーン直列化で解決
- 問題 2: `chrome.alarms` の 15 秒は公開拡張で 1 分に強制される → 1 分間隔 + 即時キックに変更
- 問題 3: sending 状態の孤児化（SW 停止でゾンビ化） → 起動時 sending → waiting リカバリで解決
- 問題 4: `acquireLock` 自体の race condition → 問題 1 と同時解決（Promise チェーン）

### Phase 1 再レビュー結果（2026-05-13）— Gemini 4問題は完全解決と認定、新規3点指摘

- 問題 5: `withStorageLock` の `.catch` で例外握り潰し → undefined 返却で TypeError クラッシュリスク → **修正する**
- 問題 6: 再試行ロジック完全欠落 → 椛島さん協議で **Phase 1 と Phase 2 を統合**、今回まとめてリトライ実装
- 問題 7: Step B (fetch) lock 外による並列実行で順序逆転リスク → **椛島さん判断で許容**（GAS 側で仕入れ先コードマッチで上書き、最終データ同一）

### Phase 3 初回レビュー結果（2026-05-13）— Gemini FAIL、4点指摘

- 問題 8: storage 直接更新の race condition（HIGH）→ options-queue.js の retryFailed / clearFailed 等が withStorageLock を経由せず、background との衝突で送信成功データが消失するリスク → **修正する**（sendMessage 経由で background に依頼、withStorageLock で守る）
- 問題 9: DOM スラッシング（MEDIUM）→ setInterval(1000ms) で毎秒 DOM 全再生成 → **Phase 4 で対応**（実害は限定的、500件上限のため極端ケースは発生しない）
- 問題 10: 巨大キュー O(N) 負荷（MEDIUM）→ computeStats 全件ループ → **Phase 4 で対応**（500件上限のため実害なし）
- 問題 11: サイレントエラー（LOW）→ storage.set 失敗時にユーザー通知なし → **Phase 4 で対応**（容量オーバーは現実的に起きない、リアルタイム更新で目視確認可能）

### Phase 4 候補（将来対応）

- 問題 9: DOM 差分更新による設定画面の CPU 負荷削減
- 問題 10: 統計値のキャッシュ機構
- 問題 11: 保存失敗時のユーザー通知（トースト or バナー）
- Webhook URL のログマスク（Gemini 指摘、Phase 1+2 レビューより）
- 指数バックオフへのジッター追加（Gemini 指摘、Phase 1+2 レビューより）

### Phase 3 再テスト結果（2026-05-13）— 並列 fetch バグ発覚、3者協議で single-flight 化

#### 発覚した症状（Fact）

- 椛島さんの実機テストで `sending` 状態が 17 件まで累積
- GAS の応答が `{"success":false,"error":"lock_timeout"}` を多発
- Service Worker ログに「Step B fetch start」が**短時間に複数連続**で出ていた → 並列 fetch が走っている

#### 確定した原因（Fact + Inference、3者協議で合意）

`withStorageLock` は Step A / Step C の **storage 操作だけ** を直列化していたが、
**Step B (fetch) は lock の外** にある（§7-3 設計どおり、長時間ブロック回避のため）。

複数の `processQueue()` が並列に走る経路:
1. ボタン連打 → `handleEnqueueExport` の即時キック × N 回
2. `chrome.alarms` の 1 分タイマー
3. `enqueueExport` 完了直後の同期キック

これらが重なると、各 `processQueue()` 実行が**自分の Step A を順番に終え**、
**Step B (fetch) を同時に発射**してしまう。GAS 側の `LockService` が競合して `lock_timeout` を多発。

#### 修正方針（3者協議の結論）

`processQueue` を **single-flight 化** する。インメモリ Promise + rerunRequested + while ループ:

```javascript
let processQueueInProgress = false;
let rerunRequested = false;

async function processQueue() {
  if (processQueueInProgress) {
    rerunRequested = true;       // 走行中に来た要求を記録
    return;
  }
  processQueueInProgress = true;
  try {
    do {
      rerunRequested = false;
      await processQueueOnce();  // 既存の Step A/B/C 1 サイクル
    } while (rerunRequested);    // 走行中に要求が来ていたら継続
  } finally {
    processQueueInProgress = false;
  }
}
```

これにより:
- 連打しても `processQueue` は **常に 1 系列だけ** 走る → Step B fetch も 1 つだけ
- 待機中の item は次のサイクル（rerunRequested）で確実に処理される
- `withStorageLock` の役割は今までどおり「storage 操作の直列化」のまま（変更不要）

#### sendingStartedAt の併用（reviveOrphanedSending 改修）

問題: SW 再起動時 `reviveOrphanedSending` は `sending` を全件 `waiting` に戻していたが、
これは **Step B fetch が進行中の item も巻き戻す**ため、二重送信のリスクがあった。

対策:
- Step A で sending マーク時に `sendingStartedAt: now` を記録
- `reviveOrphanedSending` は `STALE_SENDING_MS = 2 * 60 * 1000`（2 分）を超えた item のみ復帰
- 2 分未満は「Step B fetch 進行中の可能性」として触らない
- `sendingStartedAt` 未記録（旧データ）は孤児とみなして復帰

#### 変更ファイル

- `background-queue.js`: `processQueue` 分割 + `processQueueOnce` 新設 + `sendingStartedAt` + `reviveOrphanedSending` 改修

#### 動作の変化

| 状況 | 変更前 | 変更後 |
|---|---|---|
| ボタン連打 (N 件) | 並列 fetch が N 本同時に走る | 1 つの processQueue が rerun で連続処理 |
| alarms と即時キックが重複 | 並列 fetch 2 本 | 1 本目走行中、2 本目は rerun 予約 |
| GAS の `lock_timeout` | 多発 | 単一 fetch 経路なので発生しない |
| SW 再起動時の sending | 全件 waiting に戻す（二重送信リスク） | 2 分超のみ復帰、進行中は触らない |

#### 触らなかった箇所（既存ロジック維持）

- `applyResults` / `markFailedOrRetry` / `sendBatch` 本体
- `withStorageLock` 本体（Step A/C 内の直列化は維持）
- `content.js` / `background.js` / `options*.{js,html}` / `manifest.json`
