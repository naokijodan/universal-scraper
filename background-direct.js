// Universal Product Scraper (AI 版) - 直接送信（direct-send）耐障害キュー実装 v1.6.6
//
// 背景（3者協議で確認済みの事実）:
//   - 「直接送信」は今まで chrome.runtime.sendMessage → background.js の handleExportToSheet が
//     mode:'no-cors' で fetch し、GAS の応答（成否）を一切読まずに常に {success:true} を返していた。
//   - GAS 側は LockService で直列化しており、複数タブが同時に送ると 30 秒待って lock_timeout
//     （＝何も書き込まれない）になることがある。また 30 分以上アイドル後の初回リクエストは
//     コールドスタートで 45〜60 秒かかることがある（Fact: ユーザー運用ログ）。
//   - 既存の AI 翻訳キュー（background-queue.js）は同じ GAS に対して mode:'cors' + JSON 応答解析 +
//     60 秒タイムアウトで本番稼働している。直接送信もこのパターンを踏襲する（ただし single モード
//     ペイロード {values, sheetName, topImagesBase64?} は変えない＝GAS 側の分岐に手を入れない）。
//
// このファイルは background.js から importScripts で background-queue.js の直後に読み込まれる。
// withStorageLock / isHttpsUrl / makeQueueId は background-queue.js のグローバル関数を再利用する。
// fetchImageAsBase64(url, signal) は background.js 側で定義される（このファイルのトップレベル実行時点
// ではまだ定義されていないが、実際に呼び出すのは非同期メッセージ処理後なので問題ない＝importScripts は
// 同期実行だが、呼び出しタイミングがずれるため background.js 側の関数定義が先に完了している）。

const DIRECT_KEYS = Object.freeze({
  queue: 'directQueue',
  warmup: 'directWarmup'
});

const DIRECT_SENT_KEEP = 100;                        // 仕様: 成功(sent)は最新100件だけ保持し、古いものは自動的に間引く
const DIRECT_ERROR_CEILING = 500;                    // 仕様: 失敗(failed)・不明(unknown)はユーザーが設定画面で
                                                      // クリア/再送するまで自動では間引かない。ただし保存容量を
                                                      // 守るための安全上限として合計500件を超えたら古いものから間引く
const DIRECT_FETCH_TIMEOUT_MS = 120_000;             // コールドスタート(45〜60s) + lock 待ち(最大30s) を見込んで 120 秒
const DIRECT_IMAGE_TIMEOUT_MS = 10_000;              // 画像 base64 化タイムアウト（1枚あたり）
const DIRECT_RETRY_DELAYS_MS = [10_000];             // 合計2回試行＝自動再送は1回、10秒後
const DIRECT_STALE_SENDING_MS = 5 * 60 * 1000;       // 想定最大の処理時間（画像10枚×10秒 + fetch 120秒 ≈ 220秒）に
                                                      // 余裕を持たせて5分超 sending のまま = SW 停止の可能性 → unknown
const DIRECT_WARMUP_DEDUPE_MS = 10 * 60 * 1000;      // ウォームアップは 10 分に 1 回まで
const DIRECT_TIMEOUT_MESSAGE = 'タイムアウト（120秒）。シートを確認してください';

// テスト用フック（本番では self.DIRECT_TEST_HOOKS は未定義のまま＝挙動は変わらない）。
// node の vm サンドボックスから注入してタイムアウト等を短縮するために使う。
// 例: self.DIRECT_TEST_HOOKS = { fetchTimeoutMs: 50, imageTimeoutMs: 20 };

function _directFetchTimeoutMs() {
  return (typeof self !== 'undefined' && self.DIRECT_TEST_HOOKS && Number(self.DIRECT_TEST_HOOKS.fetchTimeoutMs) > 0)
    ? Number(self.DIRECT_TEST_HOOKS.fetchTimeoutMs)
    : DIRECT_FETCH_TIMEOUT_MS;
}
function _directImageTimeoutMs() {
  return (typeof self !== 'undefined' && self.DIRECT_TEST_HOOKS && Number(self.DIRECT_TEST_HOOKS.imageTimeoutMs) > 0)
    ? Number(self.DIRECT_TEST_HOOKS.imageTimeoutMs)
    : DIRECT_IMAGE_TIMEOUT_MS;
}
function _directWarmupDedupeMs() {
  return (typeof self !== 'undefined' && self.DIRECT_TEST_HOOKS && Number(self.DIRECT_TEST_HOOKS.warmupDedupeMs) >= 0)
    ? Number(self.DIRECT_TEST_HOOKS.warmupDedupeMs)
    : DIRECT_WARMUP_DEDUPE_MS;
}
function _directRetryDelaysMs() {
  return (typeof self !== 'undefined' && self.DIRECT_TEST_HOOKS && Array.isArray(self.DIRECT_TEST_HOOKS.retryDelaysMs))
    ? self.DIRECT_TEST_HOOKS.retryDelaysMs
    : DIRECT_RETRY_DELAYS_MS;
}

// webhookUrl はログに全文出さない（先頭40文字のみ）
// webhookUrl は GAS のデプロイ ID（事実上の秘密情報）を含むため、ログには構造的にマスクした
// 形のみを出す（生の文字列の先頭を切り出すだけだと、短い他ドメインの URL では ID がそのまま
// 残ってしまうことがあるため）。
function maskUrl(u) {
  if (typeof u !== 'string') return String(u);
  try {
    const parsed = new URL(u);
    if (/^\/macros\/s\/[^/]+\/exec\/?$/.test(parsed.pathname)) {
      return parsed.origin + '/macros/s/***/exec';
    }
    return parsed.origin + '/***';
  } catch (_) {
    // URL としてパースできない文字列の保険（通常は到達しない）
    return u.length > 40 ? u.slice(0, 40) + '…' : u;
  }
}

// ------------------------------------------
// 単純な直列 single-flight ループ（processQueue と同じ技法）
// ------------------------------------------
let directQueueInProgress = false;
let directRerunRequested = false;

async function processDirectQueue() {
  if (directQueueInProgress) {
    directRerunRequested = true;
    console.log('[direct] processDirectQueue already in progress, rerun queued');
    return;
  }
  directQueueInProgress = true;
  try {
    // 1分ごとの alarms バックアップキックからも呼ばれるため、ここで毎回
    // 「stale な sending（DIRECT_STALE_SENDING_MS 超）」だけを unknown に戻す。
    // all:false なので SW 再起動直後の一括回収（bootDirectQueue 側）とは独立して安全に動く。
    // withStorageLock は reviveDirectQueue 内部で取得するため、ここではロックの外から呼ぶ。
    await reviveDirectQueue({ all: false }).catch((e) => console.error('[direct] revive (alarm-triggered) failed:', e?.message || e));

    let keepGoing = true;
    while (keepGoing) {
      directRerunRequested = false;
      const processed = await processDirectQueueOnce();
      keepGoing = processed || directRerunRequested;
    }
  } finally {
    directQueueInProgress = false;
  }
}

// 1件だけ処理する。処理対象が無ければ false を返す。
async function processDirectQueueOnce() {
  // Step A: 1件だけ 'sending' にマーク（直列化）
  const item = await withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const now = Date.now();
    const idx = queue.findIndex((q) => q && q.status === 'waiting' && (q.nextRetryAt || 0) <= now);
    if (idx === -1) return null;

    const attempts = (queue[idx].attempts || 0) + 1;
    const updatedItem = { ...queue[idx], status: 'sending', attempts, startedAt: now };
    const nextQueue = queue.map((q, i) => (i === idx ? updatedItem : q));
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: nextQueue });
    updateDirectBadge(nextQueue);
    return updatedItem;
  });

  if (!item || item.success === false) {
    return false;
  }

  console.log('[direct] processing id=', String(item.id).slice(0, 8),
    'sheet=', item.sheetName, 'attempts=', item.attempts, 'url=', maskUrl(item.webhookUrl));

  // Step B: 画像取得 + POST（lock の外＝長時間ブロックしない）
  const { topImagesBase64, imageMs } = await buildDirectImages(item.topImageUrls);
  const body = { values: item.values, sheetName: item.sheetName };
  if (topImagesBase64.some(Boolean)) {
    body.topImagesBase64 = topImagesBase64;
  }

  const fetchStart = Date.now();
  const outcome = await postDirectSend(item.webhookUrl, body);
  const fetchMs = Date.now() - fetchStart;

  console.log('[direct] result id=', String(item.id).slice(0, 8), 'kind=', outcome.kind,
    'error=', outcome.error || null, 'imageMs=', imageMs, 'fetchMs=', fetchMs);

  // 受け口を実際に叩けた（＝GAS に到達した可能性が高い）ので、成否問わずウォームアップ時刻を更新。
  // タイムアウト時も「リクエストは送られた」ため同様に扱う。
  recordWarmupPing(item.webhookUrl).catch((e) => console.warn('[direct] recordWarmupPing failed:', e?.message || e));

  // Step C: 結果反映（直列化）
  const applyResult = await withStorageLock(async () => {
    const stored2 = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue2 = Array.isArray(stored2[DIRECT_KEYS.queue]) ? stored2[DIRECT_KEYS.queue] : [];
    const idx2 = queue2.findIndex((q) => q && q.id === item.id);
    if (idx2 === -1) {
      console.warn('[direct] item disappeared before Step C, id=', String(item.id).slice(0, 8));
      return null;
    }
    const current = queue2[idx2];
    const now = Date.now();
    const swWaitMs = (current.startedAt || now) - (current.enqueuedAt || now);
    const totalMs = now - (current.startedAt || now);
    const timing = { swWaitMs, imageMs, fetchMs, totalMs };

    let updated;
    let retryDelayMs = 0;

    if (outcome.kind === 'success') {
      updated = { ...current, status: 'sent', completedAt: now, lastError: null, timing };
    } else if (outcome.kind === 'timeout') {
      // タイムアウト = 書き込まれたか不明。自動リトライはしない（二重送信防止）。
      updated = { ...current, status: 'unknown', completedAt: now, lastError: DIRECT_TIMEOUT_MESSAGE, timing };
    } else {
      // definite_failure（GAS success:false / HTTP非2xx / JSON解析失敗 / ネットワークエラー）
      // v1.6.10: 自動再送を廃止（二重送信の根絶）。
      // 失敗応答（特にコールドスタート/一時制限時の HTTP 404）が返っても、その裏で GAS は
      // 既に1行書き込んでいることがある。ここで自動再送すると2行目が書かれ重複になる（実ログで確認）。
      // よって「書けたか不明」として unknown に固定し、自動では送り直さない。
      // 送り直しは options の履歴パネルの「再送」ボタンでユーザーが手動で行う（シート確認後）。
      const isLockTimeout = outcome.error === 'lock_timeout';
      updated = {
        ...current,
        status: 'unknown',
        completedAt: now,
        lastError: isLockTimeout
          ? 'シートが混雑して書き込めなかった可能性（lock_timeout）。シートを確認し、無ければ再送してください'
          : ((outcome.error || '不明なエラー') + '（書き込まれたか不明。シートを確認してください）'),
        timing
      };
    }

    let nextQueue = queue2.map((q, i) => (i === idx2 ? updated : q));
    nextQueue = capDirectQueue(nextQueue);
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: nextQueue });
    updateDirectBadge(nextQueue);
    return { updated, retryDelayMs };
  });

  if (applyResult && applyResult.updated) {
    const { updated, retryDelayMs } = applyResult;

    if (updated.tabId) {
      try {
        chrome.tabs.sendMessage(updated.tabId, {
          action: 'directSendResult',
          id: updated.id,
          status: updated.status,
          sheetName: updated.sheetName,
          message: outcome.message || null,
          error: updated.lastError || null
        }).catch(() => {});
      } catch (_) {
        // タブが閉じられている等は無視
      }
    }

    if (updated.status === 'waiting' && retryDelayMs > 0) {
      // 注意: この setTimeout は「早く再送したい」ための最適化に過ぎず、耐障害性の
      // 本体ではない（SW が眠って setTimeout が発火しなくても失われない）。
      // 実際の耐障害性は以下の2つで担保されている:
      //   (a) background-queue.js の chrome.alarms（1分周期）バックアップキック
      //       → processDirectQueue() が nextRetryAt を過ぎた waiting item を拾う
      //   (b) SW 再起動時の bootDirectQueue()（トップレベルで毎回実行）
      //       → 'sending' のまま止まっていた item を revive してから waiting/失敗分をキック
      setTimeout(() => {
        processDirectQueue().catch((e) => console.error('[direct] retry kick failed:', e?.message || e));
      }, retryDelayMs);
    }
  }

  return true;
}

// ------------------------------------------
// 画像 base64 化（10秒タイムアウト付き、メルカリ CDN のみ）
// ------------------------------------------
async function buildDirectImages(topImageUrls) {
  const start = Date.now();
  const urls = Array.isArray(topImageUrls) ? topImageUrls : [];
  const topImagesBase64 = [];
  for (const url of urls) {
    if (
      typeof url === 'string' &&
      url.startsWith('https://static.mercdn.net/') &&
      typeof fetchImageAsBase64 === 'function'
    ) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), _directImageTimeoutMs());
      try {
        const dataUrl = await fetchImageAsBase64(url, controller.signal);
        topImagesBase64.push(dataUrl || null);
      } catch (e) {
        topImagesBase64.push(null);
      } finally {
        clearTimeout(timer);
      }
    } else {
      topImagesBase64.push(null);
    }
  }
  return { topImagesBase64, imageMs: Date.now() - start };
}

// ------------------------------------------
// GAS への POST（cors + JSON 応答解析 + 120秒タイムアウト）
// 戻り値: { kind: 'success'|'timeout'|'definite_failure', error?, message? }
// ------------------------------------------
async function postDirectSend(webhookUrl, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _directFetchTimeoutMs());
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { kind: 'definite_failure', error: 'HTTP ' + res.status };
    }
    let json;
    try {
      json = await res.json();
    } catch (_) {
      return { kind: 'definite_failure', error: '応答 JSON のパースに失敗しました' };
    }
    if (json && json.success === true) {
      return { kind: 'success', message: json.message || null };
    }
    return { kind: 'definite_failure', error: String((json && json.error) || '不明なエラー') };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    return { kind: 'definite_failure', error: (e && e.message) || 'ネットワークエラー' };
  }
}

// ------------------------------------------
// enqueueDirectSend: 直接送信を耐障害キューへ即時受付
// ------------------------------------------
async function enqueueDirectSend(request, sender) {
  try {
    const webhookUrl = request && request.webhookUrl;
    const values = request && request.values;
    const sheetName = (typeof request?.sheetName === 'string' && request.sheetName.trim())
      ? request.sheetName
      : 'インポート用';

    if (!isHttpsUrl(webhookUrl)) {
      return { success: false, error: 'Webhook URL が不正です' };
    }
    if (!Array.isArray(values) || values.length === 0) {
      return { success: false, error: 'values が空です' };
    }

    const topImageUrls = Array.isArray(request.topImageUrls)
      ? request.topImageUrls.filter((u) => typeof u === 'string')
      : (typeof request.topImageUrl === 'string' && request.topImageUrl ? [request.topImageUrl] : []);

    const id = makeQueueId();
    const now = Date.now();
    const item = {
      id,
      status: 'waiting',
      webhookUrl,
      sheetName,
      sourceLabel: (typeof request.sourceLabel === 'string' && request.sourceLabel.trim())
        ? request.sourceLabel.trim().slice(0, 200)
        : deriveDirectSourceLabel(values),
      values: values.slice(),
      topImageUrls: topImageUrls.slice(),
      enqueuedAt: now,
      startedAt: null,
      completedAt: null,
      attempts: 0,
      nextRetryAt: 0,
      lastError: null,
      timing: { swWaitMs: null, imageMs: null, fetchMs: null, totalMs: null },
      tabId: (sender && sender.tab && typeof sender.tab.id === 'number') ? sender.tab.id : null
    };

    const pushResult = await pushDirectQueueItem(item);
    if (!pushResult || pushResult.success === false) {
      return { success: false, error: (pushResult && pushResult.error) || 'キューへの追加に失敗しました' };
    }

    // 即時キック（await しない＝レスポンスはすぐ返す。タブを閉じても続行する）
    processDirectQueue().catch((e) => console.error('[direct] immediate kick failed:', e?.message || e));

    return { success: true, accepted: true, id, message: '送信を受け付けました' };
  } catch (e) {
    console.error('[direct] enqueueDirectSend failed:', e?.message || e);
    return { success: false, error: e?.message || '直接送信の受付に失敗しました' };
  }
}

async function pushDirectQueueItem(item) {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const nextQueue = capDirectQueue([...queue, item]);
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: nextQueue });
    updateDirectBadge(nextQueue);
    console.log('[direct] enqueued id=', String(item.id).slice(0, 8), 'sheet=', item.sheetName,
      'values.len=', item.values.length, 'queue.len=', nextQueue.length);
    return { success: true };
  });
}

// 商品名っぽいフィールドをヒューリスティックに拾う（配列の先頭数フィールド、URL/IMAGE式は除外）。
// exportToSpreadsheet の主要サイト（mercari/ebay/rakuten/amazon 等）は values[3] が商品名。
function deriveDirectSourceLabel(values) {
  if (!Array.isArray(values)) return '';
  const isPlainText = (v) => typeof v === 'string' && v && !v.startsWith('=IMAGE(') && !/^https?:\/\//i.test(v);
  if (isPlainText(values[3]) && values[3].length >= 2) {
    return values[3].slice(0, 200);
  }
  for (let i = 0; i < Math.min(values.length, 12); i++) {
    if (isPlainText(values[i]) && values[i].length >= 4) {
      return values[i].slice(0, 200);
    }
  }
  return '';
}

// ------------------------------------------
// キュー整理（2026-09 見直し）:
//   - sent（成功）は新しい DIRECT_SENT_KEEP（100）件だけ残し、それより古い sent は自動的に間引く。
//   - failed（失敗）・unknown（不明）はユーザーが設定画面（options-direct.js）で
//     クリア／再送するまで自動では絶対に間引かない。ただしストレージを守るための
//     安全上限として、failed+unknown の合計が DIRECT_ERROR_CEILING（500）件を超えた
//     場合のみ、古いものから間引く（この場合のみログを残す）。
//   - waiting/sending は状態に関わらず絶対に落とさない。
//   - 間引きは対象を id で特定してから元の配列を filter するだけなので、
//     残った項目の並び順（enqueuedAt 昇順で格納されている現在の順序）は変えない。
// 変更なしの場合は引数の queue をそのまま返す（reviveDirectQueue 側で「変更があったか」の
// 判定に参照の一致を使っているため）。
// ------------------------------------------
function capDirectQueue(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return queue;

  const sortKey = (item) => (item && (item.completedAt || item.enqueuedAt)) || 0;
  const toDropIds = new Set();

  // sent: 新しい順に DIRECT_SENT_KEEP 件だけ残す
  const sentItems = queue.filter((q) => q && q.status === 'sent');
  if (sentItems.length > DIRECT_SENT_KEEP) {
    const sortedSent = sentItems.slice().sort((a, b) => sortKey(b) - sortKey(a));
    for (const q of sortedSent.slice(DIRECT_SENT_KEEP)) {
      toDropIds.add(q.id);
    }
  }

  // failed/unknown: 合計が DIRECT_ERROR_CEILING を超えた場合のみ、古いものから間引く（保険）
  const errorItems = queue.filter((q) => q && (q.status === 'failed' || q.status === 'unknown'));
  if (errorItems.length > DIRECT_ERROR_CEILING) {
    const sortedErrors = errorItems.slice().sort((a, b) => sortKey(b) - sortKey(a));
    const overflow = sortedErrors.slice(DIRECT_ERROR_CEILING);
    for (const q of overflow) {
      toDropIds.add(q.id);
    }
    console.log('[direct] capDirectQueue: failed/unknown が安全上限(' + DIRECT_ERROR_CEILING + ')を超えたため',
      overflow.length, '件（古いもの）を自動的に間引きました');
  }

  if (toDropIds.size === 0) return queue;
  return queue.filter((q) => !q || !toDropIds.has(q.id));
}

// ------------------------------------------
// バッジ: failed + unknown 件数
// ------------------------------------------
function updateDirectBadge(items) {
  try {
    const list = Array.isArray(items) ? items : [];
    const count = list.filter((q) => q && (q.status === 'failed' || q.status === 'unknown')).length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
  } catch (e) {
    console.error('[direct] updateDirectBadge failed:', e?.message || e);
  }
}

// ------------------------------------------
// リカバリ: 'sending' のまま止まっている item を 'unknown' に戻す。
//   all:true  … 全ての 'sending' を無条件で回収する。
//               SW インスタンス起動直後（bootDirectQueue）専用。新しい SW インスタンスには
//               絶対に進行中の fetch は存在し得ない（Step B は同一インスタンスのメモリ上でしか
//               継続しない）ため、'sending' が残っていれば必ず前インスタンスの孤児である。
//   all:false … startedAt から DIRECT_STALE_SENDING_MS（5分）を超えたものだけ回収する。
//               同一インスタンス内で 1 分ごとの alarms バックアップキック（processDirectQueue）
//               から呼ばれる想定。まだ Step B が進行中の可能性がある item には触らない。
// ------------------------------------------
async function reviveDirectQueue(opts) {
  const all = !!(opts && opts.all);
  return withStorageLock(async () => {
    try {
      const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
      const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
      const now = Date.now();
      let recovered = 0;
      const revived = queue.map((q) => {
        if (!q || q.status !== 'sending') return q;
        const startedAt = Number(q.startedAt) || 0;
        const isStale = all || !startedAt || (now - startedAt > DIRECT_STALE_SENDING_MS);
        if (isStale) {
          recovered++;
          return {
            ...q,
            status: 'unknown',
            completedAt: now,
            lastError: '送信中に裏方が停止した可能性。シートを確認してください'
          };
        }
        return q;
      });

      // all:true（SW インスタンス起動直後の boot）のときだけ capDirectQueue も通す。
      // これにより、キュー整理ルールの変更（例: 旧仕様の 300 件キャップで保存されたまま
      // アップグレードしてきた既存ユーザーのキュー）が起動時に新ルールへ揃う。
      // 参照が変わっていれば実際に間引きが発生したという意味（capDirectQueue の仕様）。
      const next = all ? capDirectQueue(revived) : revived;

      if (recovered > 0 || next !== revived) {
        await chrome.storage.local.set({ [DIRECT_KEYS.queue]: next });
        if (recovered > 0) {
          console.log('[direct] recovered', recovered, 'stale sending item(s) as unknown (all=' + all + ')');
        }
        if (next !== revived) {
          console.log('[direct] boot capDirectQueue trimmed', revived.length - next.length, 'item(s)');
        }
      }
      updateDirectBadge(next);
    } catch (e) {
      console.error('[direct] reviveDirectQueue failed:', e?.message || e);
    }
  });
}

// ------------------------------------------
// ウォームアップ（ジャブ）: GAS のコールドスタート対策
// ------------------------------------------
const directWarmupInFlight = new Set();

async function warmupWebhook(webhookUrl) {
  if (!isHttpsUrl(webhookUrl)) return;
  if (directWarmupInFlight.has(webhookUrl)) {
    console.log('[direct] warmup already in flight, skip:', maskUrl(webhookUrl));
    return;
  }
  // 同期的にフラグを立ててから await する（チェックと登録の間の競合を防ぐ）
  directWarmupInFlight.add(webhookUrl);
  try {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.warmup]);
    const warmupMap = stored[DIRECT_KEYS.warmup] || {};
    const lastAt = Number(warmupMap[webhookUrl]) || 0;
    const now = Date.now();
    if (now - lastAt < _directWarmupDedupeMs()) {
      console.log('[direct] warmup deduped (within window):', maskUrl(webhookUrl));
      return;
    }

    console.log('[direct] warmup ping start:', maskUrl(webhookUrl));
    const pingUrl = webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'action=ping';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _directFetchTimeoutMs());
    try {
      await fetch(pingUrl, { method: 'GET', mode: 'no-cors', signal: controller.signal });
    } catch (e) {
      // doGet 未実装 or タイムアウトでも問題ない（応答は完全に無視する仕様）
      console.log('[direct] warmup ping ignored error:', e?.message || e);
    } finally {
      clearTimeout(timer);
    }
    await recordWarmupPing(webhookUrl);
    console.log('[direct] warmup ping done:', maskUrl(webhookUrl));
  } finally {
    directWarmupInFlight.delete(webhookUrl);
  }
}

async function recordWarmupPing(webhookUrl) {
  if (!webhookUrl) return;
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.warmup]);
    const warmupMap = { ...(stored[DIRECT_KEYS.warmup] || {}) };
    warmupMap[webhookUrl] = Date.now();
    await chrome.storage.local.set({ [DIRECT_KEYS.warmup]: warmupMap });
  });
}

// warmupWebhook メッセージのハンドラ: 対象シートを解決してからキックする。
// content.js の exportToSpreadsheet の selectedSheet 解決ロジック（lastUsedSheetId 優先、
// 無ければ spreadsheets[0]）を踏襲する。
async function handleWarmupWebhookMessage() {
  try {
    const sync = await chrome.storage.sync.get(['spreadsheets']);
    const local = await chrome.storage.local.get(['lastUsedSheetId']);
    const spreadsheets = Array.isArray(sync.spreadsheets) ? sync.spreadsheets : [];
    if (spreadsheets.length === 0) {
      return { success: true, skipped: true };
    }
    let target = spreadsheets.find((s) => s && s.id === local.lastUsedSheetId);
    if (!target) target = spreadsheets[0];
    if (!target || !target.webhookUrl) {
      return { success: true, skipped: true };
    }
    warmupWebhook(target.webhookUrl).catch((e) => console.warn('[direct] warmupWebhook failed:', e?.message || e));
    return { success: true };
  } catch (e) {
    console.error('[direct] handleWarmupWebhookMessage failed:', e?.message || e);
    return { success: false, error: e?.message || 'ウォームアップに失敗しました' };
  }
}

// ------------------------------------------
// 管理メッセージ（options.js の「直接送信の履歴」パネルから呼ばれる）
// すべて withStorageLock 経由で processDirectQueue（Step A/C）との競合を防ぐ。
// ------------------------------------------
async function directRetryFailed() {
  const result = await withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    let retried = 0;
    const next = queue.map((q) => {
      if (!q || q.status !== 'failed') return q;
      retried++;
      return { ...q, status: 'waiting', attempts: 0, nextRetryAt: 0, lastError: null, completedAt: null };
    });
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: next });
    updateDirectBadge(next);
    console.log('[direct] directRetryFailed:', retried, '件（失敗のみ）を再送待機に戻しました');
    return { success: true, retried };
  });
  if (result && result.success) {
    processDirectQueue().catch((e) => console.error('[direct] retryFailed kick failed:', e?.message || e));
  }
  return result;
}

async function directClearDone() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const next = queue.filter((q) => q && q.status !== 'sent');
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: next });
    updateDirectBadge(next);
    return { success: true };
  });
}

async function directClearFailed() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const next = queue.filter((q) => q && q.status !== 'failed' && q.status !== 'unknown');
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: next });
    updateDirectBadge(next);
    return { success: true };
  });
}

async function directDeleteOne(id) {
  if (!id || typeof id !== 'string') return { success: false, error: 'id が不正です' };
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const next = queue.filter((q) => q && q.id !== id);
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: next });
    updateDirectBadge(next);
    return { success: true };
  });
}

async function directRequeueOne(id) {
  if (!id || typeof id !== 'string') return { success: false, error: 'id が不正です' };
  const result = await withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    let found = false;
    const next = queue.map((q) => {
      if (!q || q.id !== id) return q;
      found = true;
      return { ...q, status: 'waiting', attempts: 0, nextRetryAt: 0, lastError: null, completedAt: null };
    });
    if (!found) return { success: false, error: '対象が見つかりません' };
    await chrome.storage.local.set({ [DIRECT_KEYS.queue]: next });
    updateDirectBadge(next);
    return { success: true };
  });
  if (result && result.success) {
    processDirectQueue().catch((e) => console.error('[direct] requeueOne kick failed:', e?.message || e));
  }
  return result;
}

async function directGetState() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue, DIRECT_KEYS.warmup]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const warmup = stored[DIRECT_KEYS.warmup] || {};
    return { success: true, items: queue, warmup };
  });
}

// ポップアップ（popup.js）から呼ばれる軽量サマリ。読み取り専用なので withStorageLock は
// 必須ではないが、Step A/C の書き込みと同時に読んで中途半端な配列を見ないよう、
// 他のハンドラと同じく withStorageLock 経由に揃えておく。
async function directGetSummary() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([DIRECT_KEYS.queue]);
    const queue = Array.isArray(stored[DIRECT_KEYS.queue]) ? stored[DIRECT_KEYS.queue] : [];
    const counts = { failed: 0, unknown: 0, waiting: 0, sending: 0, sent: 0 };
    for (const q of queue) {
      if (q && Object.prototype.hasOwnProperty.call(counts, q.status)) {
        counts[q.status]++;
      }
    }
    return { success: true, ...counts };
  });
}

// ------------------------------------------
// 起動時初期化: 孤児リカバリ（全件回収）→ 待機分をキック
//
// この関数はスクリプトのトップレベルで1回だけ呼ぶ（下記）。MV3 の service worker は
// importScripts を含むスクリプト全体がインスタンス起動のたびに毎回最初から実行されるため、
// トップレベル呼び出しだけで「新しい SW インスタンスが起動するたび」に必ず実行される。
// そのため chrome.runtime.onInstalled / onStartup から改めて呼ぶ必要はない。
// むしろ同一インスタンス内で onStartup 等が別タイミングで発火すると、その時点で本当に
// 処理中（sending）の item まで all:true で誤って unknown 化してしまう危険がある
// （all:true は「このインスタンスに sending の in-flight fetch は絶対に存在しない」という
// 前提＝インスタンス起動直後にしか成り立たない前提に依存しているため）。
// ------------------------------------------
function bootDirectQueue() {
  reviveDirectQueue({ all: true })
    .then(() => processDirectQueue().catch((e) => console.error('[direct] startup kick failed:', e?.message || e)))
    .catch((e) => console.error('[direct] bootDirectQueue failed:', e?.message || e));
}

bootDirectQueue();
