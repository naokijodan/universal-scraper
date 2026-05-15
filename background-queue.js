// Universal Product Scraper (AI 版) - 送信キュー実装
// Phase 1+2 統合: 最小キュー + バルク20送信 + 任意の指数バックオフ自動リトライ（Gemini 再レビュー反映版）
// + §15 (2026-05-13) 並列 fetch バグ修正: processQueue の single-flight 化 + sendingStartedAt
// + §17 (v1.4.8) reviveOrphanedSending を failed(unknown_remote_state) 固定 + payload に clientItemId 布石
//
// 仕様: docs/queue-design.md §9 Phase 1+2 統合
//   - chrome.storage.local.queue に積む
//   - chrome.alarms で 1 分ごとに processQueue を起動（公開拡張の最小周期、Fact）
//   - enqueue 時に即時キックで体感の待ちはゼロ
//   - 最大 20 件をまとめて 1 POST で送信
//   - 失敗時は既定で即 failed 固定。設定時のみ指数バックオフ自動リトライ（§16 (v1.4.7)）
//   - 並行制御はメモリ内 Promise チェーン（withStorageLock）で直列化
//   - processQueue は single-flight (in-progress + rerunRequested) で複数呼び出しを統合
//   - withStorageLock のエラー時は一貫したエラーオブジェクトを返してクラッシュ防止
//   - 起動時に「2 分以上 sending のまま」の item は failed(unknown_remote_state) に固定
//   - UI は Phase 3 で追加
//
// このファイルは background.js から importScripts で読み込まれる。
// 全ての関数・定数は service worker のグローバルスコープに公開される。

const QUEUE_KEYS = Object.freeze({
  queue: 'queue',
  config: 'queueConfig',
  stats: 'queueStats',
  lastError: 'lastError'
});

const QUEUE_CONFIG_DEFAULTS = Object.freeze({
  batchSize: 5,                             // §2 デフォルト 5（GAS LockService 競合回避のため、椛島さん判断 2026-05-13）
  intervalSec: 60,                          // §2-2 公開拡張の alarms 制約により 1 分
  maxRetry: 0,                              // §16 (v1.4.7) 二重送信防止のため既定で自動リトライしない
  retryBackoffMs: [5000, 15000, 45000],     // Phase 2 で使用
  cleanupAfterMs: 24 * 60 * 60 * 1000,      // sent を消すまでの時間
  paused: false
});

const QUEUE_MAX_LENGTH = 500;               // §11 リスク: 5MB 上限への保険
const QUEUE_FETCH_TIMEOUT_MS = 60_000;      // §2 fetch タイムアウト 60 秒
const QUEUE_ALARM_NAME = 'processQueue';
const QUEUE_ALARM_PERIOD_MIN = 1.0;         // §2-2 公開拡張は最小 1 分（Fact: Chrome 公式）
const STALE_SENDING_MS = 2 * 60 * 1000;     // §15 (2026-05-13) sending が古いとみなす閾値（2 分）

// §7-3 メモリ内 Promise チェーンによる直列化
// Service Worker は単一インスタンスなので、グローバル変数で十分機能する（Fact: MV3 仕様）
let currentOperation = Promise.resolve();

function withStorageLock(work) {
  // §15 問題5: .catch で undefined を返すと呼び出し側が result.success にアクセスして
  // TypeError でクラッシュする。一貫したエラーオブジェクトを返してクラッシュを防ぐ。
  const next = currentOperation.then(work).catch((e) => {
    console.error('[queue] withStorageLock work error:', e?.message || e);
    return { success: false, error: e?.message || 'キュー処理でエラーが発生しました' };
  });
  currentOperation = next;
  return next;
}

function makeQueueId() {
  // crypto.randomUUID は MV3 service worker でも利用可（Fact: MDN）
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isValidItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!Array.isArray(item.values) || item.values.length === 0) return false;
  if (typeof item.sheetName !== 'string' || !item.sheetName.trim()) return false;
  return true;
}

async function initQueueState() {
  return withStorageLock(async () => {
    try {
      const stored = await chrome.storage.local.get([
        QUEUE_KEYS.queue, QUEUE_KEYS.config, QUEUE_KEYS.stats
      ]);

      const patch = {};
      if (!Array.isArray(stored[QUEUE_KEYS.queue])) {
        patch[QUEUE_KEYS.queue] = [];
      }
      if (!stored[QUEUE_KEYS.config] || typeof stored[QUEUE_KEYS.config] !== 'object') {
        patch[QUEUE_KEYS.config] = { ...QUEUE_CONFIG_DEFAULTS };
      } else {
        // 既存設定を尊重しつつ、欠けているキーだけデフォルトで補う
        const merged = { ...QUEUE_CONFIG_DEFAULTS, ...stored[QUEUE_KEYS.config] };
        // §16 (v1.4.7) 旧範囲 (1〜5) からのマイグレーション: 0〜3 に clamp
        if (typeof merged.maxRetry === 'number') {
          merged.maxRetry = Math.max(0, Math.min(3, Math.round(merged.maxRetry)));
        } else {
          merged.maxRetry = QUEUE_CONFIG_DEFAULTS.maxRetry;
        }
        patch[QUEUE_KEYS.config] = merged;
      }
      if (!stored[QUEUE_KEYS.stats] || typeof stored[QUEUE_KEYS.stats] !== 'object') {
        patch[QUEUE_KEYS.stats] = { waiting: 0, sending: 0, sent: 0, failed: 0, lastSyncAt: 0 };
      }
      if (Object.keys(patch).length > 0) {
        await chrome.storage.local.set(patch);
      }

      // §7-3 旧 mutex のゴミデータが残っている可能性があるので念のため除去
      await chrome.storage.local.remove(['isSending', 'isSendingAt']);

      console.log('[queue] state initialized');
    } catch (e) {
      console.error('[queue] initQueueState failed:', e?.message || e);
    }
  });
}

// §7-4 Service Worker 起動時の孤児リカバリ
// processQueue 中に SW が停止すると sending マークが永久に残るため、起動時に処理する。
// §15 (2026-05-13): 2 分以内に sending マークされた item は「Step B fetch 進行中の可能性」が
//                    あるため触らない（並列 fetch / 二重送信を避ける）。
// §17 (v1.4.8): 2 分超 sending は「GAS で書き込み成功した可能性がある不明状態」のため、
//               waiting に戻さず failed(unknown_remote_state) 固定にする。
//               これで二重送信を構造的に防ぐ。ユーザーは UI で Sheets を確認してから手動再送する。
//               3者協議 (2026-05-16) 結論。
async function reviveOrphanedSending() {
  return withStorageLock(async () => {
    try {
      const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
      const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
      const now = Date.now();
      let quarantinedCount = 0;
      let skippedCount = 0;
      const quarantined = queue.map((q) => {
        if (q?.status !== 'sending') return q;
        const startedAt = Number(q.sendingStartedAt) || 0;
        // §17 (v1.4.8) sendingStartedAt 未記録（旧データ）or 2 分超経過 → failed(unknown) 固定
        //              waiting に戻すと二重送信になるため、必ず手動確認を強制する
        if (!startedAt || now - startedAt > STALE_SENDING_MS) {
          quarantinedCount++;
          return {
            ...q,
            status: 'failed',
            sendingStartedAt: null,
            lastError: 'unknown_remote_state',
            completedAt: now
          };
        }
        // 2 分未満 = Step B fetch が進行中の可能性 → 触らない
        skippedCount++;
        return q;
      });
      if (quarantinedCount > 0) {
        await chrome.storage.local.set({ [QUEUE_KEYS.queue]: quarantined });
        console.log('[queue] quarantined', quarantinedCount, 'orphaned sending items as failed(unknown_remote_state), skipped', skippedCount, 'in-flight');
      } else if (skippedCount > 0) {
        console.log('[queue] reviveOrphanedSending: skipped', skippedCount, 'in-flight sending items (within 2min)');
      }
    } catch (e) {
      console.error('[queue] reviveOrphanedSending failed:', e?.message || e);
    }
  });
}

function ensureQueueAlarm() {
  try {
    chrome.alarms.get(QUEUE_ALARM_NAME, (existing) => {
      if (!existing) {
        chrome.alarms.create(QUEUE_ALARM_NAME, { periodInMinutes: QUEUE_ALARM_PERIOD_MIN });
        console.log('[queue] alarm created');
      }
    });
  } catch (e) {
    console.error('[queue] ensureQueueAlarm failed:', e?.message || e);
  }
}

// 起動時に1回、キュー初期化と孤児リカバリとアラーム登録
initQueueState().then(reviveOrphanedSending).then(ensureQueueAlarm);

chrome.runtime.onInstalled.addListener(() => {
  initQueueState().then(reviveOrphanedSending).then(ensureQueueAlarm);
});

chrome.runtime.onStartup?.addListener(() => {
  initQueueState().then(reviveOrphanedSending).then(ensureQueueAlarm);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === QUEUE_ALARM_NAME) {
    processQueue().catch((e) => console.error('[queue] processQueue error:', e?.message || e));
  }
});

// ------------------------------------------
// enqueueExport: items を waiting で push
// ------------------------------------------
async function handleEnqueueExport(request) {
  try {
    const { webhookUrl, items, sourceLabel } = request || {};
    if (!isHttpsUrl(webhookUrl)) {
      return { success: false, error: 'Webhook URL が不正です' };
    }
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'items が空です' };
    }
    const valid = items.filter(isValidItem);
    if (valid.length === 0) {
      return { success: false, error: 'items にスプレッドシート行データが含まれていません' };
    }

    const result = await enqueueExport(valid, webhookUrl, sourceLabel);
    if (!result.success) return result;

    // alarms は 1 分ごとだが、即座に 1 回キックする
    // §15 (2026-05-13): processQueue は single-flight 化済みなので、走行中なら rerun 予約に変わる（並行 fetch にならない）
    processQueue().catch((e) => console.error('[queue] immediate kick failed:', e?.message || e));

    return result;
  } catch (e) {
    console.error('[queue] handleEnqueueExport failed:', e?.message || e);
    return { success: false, error: 'キューへの追加に失敗しました' };
  }
}

async function enqueueExport(items, webhookUrl, sourceLabel) {
  // §7-3 read → modify → write を withStorageLock で直列化
  return withStorageLock(async () => {
    const now = Date.now();
    const newItems = items.map((it) => Object.freeze({
      id: makeQueueId(),
      createdAt: now,
      webhookUrl,
      sheetName: String(it.sheetName),
      values: it.values.slice(),  // 浅いコピー（行配列の中身は string/number のみと想定）
      status: 'waiting',
      retryCount: 0,
      nextRetryAt: 0,
      lastError: null,
      completedAt: null,
      sourceLabel: typeof sourceLabel === 'string' ? sourceLabel.slice(0, 200) : ''
    }));

    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const currentQueue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];

    if (currentQueue.length + newItems.length > QUEUE_MAX_LENGTH) {
      return {
        success: false,
        error: `送信キューが満杯です（最大 ${QUEUE_MAX_LENGTH} 件）。設定画面で待ちを減らしてから再度お試しください。`
      };
    }

    const nextQueue = [...currentQueue, ...newItems];
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: nextQueue });
    await writeStats(nextQueue);

    console.log('[queue] enqueued', newItems.length, 'items, total=', nextQueue.length);
    return {
      success: true,
      enqueued: newItems.length,
      waiting: countByStatus(nextQueue, 'waiting')
    };
  });
}

// 旧 exportBoth 呼び出しは、新キュー API に転送するブリッジに置き換え
async function handleExportBothBridgeToQueue(request) {
  const { webhookUrl, payloads } = request || {};
  if (!isHttpsUrl(webhookUrl)) {
    return { success: false, error: 'Webhook URL が不正です' };
  }
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return { success: false, error: 'payloads が空です' };
  }
  return handleEnqueueExport({
    webhookUrl,
    items: payloads.map((p) => ({ sheetName: p?.sheetName, values: p?.values }))
  });
}

// ------------------------------------------
// processQueue: alarms 1 分ごと + enqueue 即時キックで動く本体
// 構造（§7-3 Gemini レビュー反映 + §15 (2026-05-13) single-flight 化）:
//   外側 (processQueue): single-flight 制御
//     - 走行中の呼び出しは rerunRequested を立てて即 return（並列 fetch を絶対に起こさない）
//     - 1 サイクル終わったら rerunRequested を見て、立っていれば再度 processQueueOnce を回す
//   内側 (processQueueOnce): Step A/B/C の 1 サイクル
//     Step A: withStorageLock 内で waiting → sending マークと batch 確定 + sendingStartedAt 記録
//     Step B: withStorageLock の外で fetch（長時間ブロックを避ける）
//     Step C: withStorageLock 内で結果反映 + クリーンアップ + stats 更新
// 二重実行防止:
//   - メモリ内フラグで「processQueue は 1 系列だけ走る」を保証
//   - Step A で「すでに sending マークされた item は対象外」にする（バッチ重複防止）
// ------------------------------------------
let processQueueInProgress = false;
let rerunRequested = false;

async function processQueue() {
  if (processQueueInProgress) {
    // 走行中に来た呼び出しは、次の rerun として記録するだけ
    rerunRequested = true;
    console.log('[queue:proc] already in progress, rerun queued');
    return;
  }
  processQueueInProgress = true;
  try {
    do {
      rerunRequested = false;
      await processQueueOnce();
      if (rerunRequested) {
        console.log('[queue:proc] rerun');
      }
    } while (rerunRequested);
  } finally {
    processQueueInProgress = false;
  }
}

async function processQueueOnce() {
  const cycleId = Math.random().toString(36).slice(2, 8);
  console.log('[queue:proc]', cycleId, 'start');
  // Step A: バッチ抽出と sending マーク（直列化）
  const prepared = await withStorageLock(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue, QUEUE_KEYS.config]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    const config = { ...QUEUE_CONFIG_DEFAULTS, ...(stored[QUEUE_KEYS.config] || {}) };
    const breakdown = {
      total: queue.length,
      waiting: queue.filter((q) => q?.status === 'waiting').length,
      sending: queue.filter((q) => q?.status === 'sending').length,
      sent: queue.filter((q) => q?.status === 'sent').length,
      failed: queue.filter((q) => q?.status === 'failed').length
    };
    console.log('[queue:proc]', cycleId, 'Step A enter, queue=', breakdown, 'paused=', config.paused);
    if (config.paused === true) {
      console.log('[queue:proc]', cycleId, 'paused, skip');
      return null;
    }

    // §9 Phase 1+2 統合: nextRetryAt が現在時刻を過ぎた waiting のみ対象
    const now = Date.now();
    const eligible = queue.filter((q) =>
      q && q.status === 'waiting' && (q.nextRetryAt || 0) <= now
    );
    console.log('[queue:proc]', cycleId, 'eligible=', eligible.length, '/ waiting=', breakdown.waiting);
    if (eligible.length === 0) {
      console.log('[queue:proc]', cycleId, 'no eligible, skip');
      return null;
    }

    // webhookUrl ごとに分け、最初のグループを1サイクル分処理（次サイクルで残りを処理）
    const byUrl = new Map();
    for (const item of eligible) {
      const arr = byUrl.get(item.webhookUrl) || [];
      arr.push(item);
      byUrl.set(item.webhookUrl, arr);
    }
    const [firstUrl, firstItems] = byUrl.entries().next().value;
    const batchSize = Math.max(1, Math.min(50, Number(config.batchSize) || 20));
    const batch = firstItems.slice(0, batchSize);
    const batchIds = new Set(batch.map((b) => b.id));
    console.log('[queue:proc]', cycleId, 'Step A mark sending, batch=', batch.length,
      'firstIds=', batch.slice(0, 3).map((b) => b.id?.slice(0, 8)),
      'retryCounts=', batch.slice(0, 3).map((b) => b.retryCount || 0));

    // queue 内の対象 item を sending に。§15 (2026-05-13): sendingStartedAt も記録して
    // reviveOrphanedSending が「Step B 進行中」と「真の孤児」を区別できるようにする。
    const queueAfterMark = queue.map((q) => batchIds.has(q.id)
      ? { ...q, status: 'sending', sendingStartedAt: now }
      : q);
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: queueAfterMark });

    return { firstUrl, batch, config };
  });

  // §15 問題5 対応: withStorageLock がエラー時に { success: false, ... } を返すので
  // それを検出して安全に抜ける。firstUrl が無い場合も同様にスキップ。
  if (!prepared || prepared.success === false || !prepared.firstUrl) {
    console.log('[queue:proc]', cycleId, 'Step A returned no work, exit');
    return;
  }
  const { firstUrl, batch, config } = prepared;

  // Step B: 長時間 fetch は lock の外で実行
  // §17 (v1.4.8) GAS 側 idempotency（v2.0 実装予定）への布石として id を含める
  const rows = batch.map((b) => ({ id: b.id, values: b.values, sheetName: b.sheetName }));
  console.log('[queue:proc]', cycleId, 'Step B fetch start, rows=', rows.length);
  const sendResult = await sendBatch(firstUrl, rows);
  console.log('[queue:proc]', cycleId, 'Step B fetch end, ok=', sendResult.ok,
    'hasResults=', Array.isArray(sendResult.json?.results),
    'resultsLen=', sendResult.json?.results?.length,
    'jsonSuccess=', sendResult.json?.success,
    'error=', sendResult.error || null);

  // Step C: 結果反映（直列化）
  await withStorageLock(async () => {
    try {
      const stored2 = await chrome.storage.local.get([QUEUE_KEYS.queue]);
      const queueLatest = Array.isArray(stored2[QUEUE_KEYS.queue]) ? stored2[QUEUE_KEYS.queue] : [];
      const queueAfterResult = applyResults(queueLatest, batch, sendResult, config);
      const queueCleaned = cleanupOldSent(queueAfterResult, config.cleanupAfterMs);
      const newBreakdown = {
        total: queueCleaned.length,
        waiting: queueCleaned.filter((q) => q?.status === 'waiting').length,
        sending: queueCleaned.filter((q) => q?.status === 'sending').length,
        sent: queueCleaned.filter((q) => q?.status === 'sent').length,
        failed: queueCleaned.filter((q) => q?.status === 'failed').length
      };
      console.log('[queue:proc]', cycleId, 'Step C apply done, queue=', newBreakdown);
      await chrome.storage.local.set({ [QUEUE_KEYS.queue]: queueCleaned });
      await writeStats(queueCleaned);
    } catch (e) {
      console.error('[queue] processQueue apply failed:', e?.message || e, 'cycle=', cycleId);
      await chrome.storage.local.set({ [QUEUE_KEYS.lastError]: String(e?.message || e) });
    }
  });
  console.log('[queue:proc]', cycleId, 'end');
}

// ------------------------------------------
// sendBatch: 実際の fetch
// 戻り値: { ok: true, json } | { ok: false, error }
// ------------------------------------------
async function sendBatch(webhookUrl, rows) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUEUE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: 'HTTP ' + res.status };
    }
    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      return { ok: false, error: '応答 JSON のパースに失敗しました' };
    }
    return { ok: true, json };
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e?.name === 'AbortError';
    return { ok: false, error: isAbort ? 'タイムアウト' : (e?.message || 'ネットワークエラー') };
  }
}

// ------------------------------------------
// markFailedOrRetry: 失敗 item を「リトライ待機」または「永久失敗」に振り分けるヘルパー
// §9 Phase 1+2 統合 + §16 (v1.4.7): nextRetryCount <= maxRetry なら waiting に戻し、
//                     retryBackoffMs[nextRetryCount - 1] 後に再試行。上限超過なら failed 固定。
// Immutability: 必ず新しいオブジェクトを返す
// ------------------------------------------
function markFailedOrRetry(item, errorMessage, config, now) {
  // §16 (v1.4.7) 多層防御: 想定外の値が入っても安全側に倒す
  const rawMaxRetry = Number.isInteger(config?.maxRetry) ? config.maxRetry : QUEUE_CONFIG_DEFAULTS.maxRetry;
  const maxRetry = Math.max(0, Math.min(3, rawMaxRetry));
  const nextRetryCount = (item.retryCount || 0) + 1;
  if (nextRetryCount > maxRetry) {
    console.log('[queue:retry] id=', item.id?.slice(0, 8), 'FAILED (max retry exceeded)', 'nextRetryCount=', nextRetryCount, 'err=', errorMessage);
    return {
      ...item,
      status: 'failed',
      lastError: errorMessage,
      completedAt: now
    };
  }
  const backoffArr = Array.isArray(config?.retryBackoffMs) && config.retryBackoffMs.length > 0
    ? config.retryBackoffMs
    : [5000, 15000, 45000];
  // nextRetryCount=1 のとき backoffArr[0] を使う
  const idx = Math.min(nextRetryCount - 1, backoffArr.length - 1);
  const backoff = Number(backoffArr[idx]) > 0 ? Number(backoffArr[idx]) : 45000;
  console.log('[queue:retry] id=', item.id?.slice(0, 8), 'RETRY scheduled', 'retryCount=', nextRetryCount, 'in=', backoff, 'ms', 'err=', errorMessage);
  return {
    ...item,
    status: 'waiting',
    retryCount: nextRetryCount,
    nextRetryAt: now + backoff,
    lastError: errorMessage
  };
}

// ------------------------------------------
// applyResults: GAS の results[] を見て個別の sent/failed/retry を反映
// §9 Phase 1+2 統合 + §16 (v1.4.7): 失敗時は markFailedOrRetry で failed または任意リトライへ
// ------------------------------------------
function applyResults(queue, batch, sendResult, config) {
  const batchIds = new Set(batch.map((b) => b.id));
  const now = Date.now();

  if (!sendResult.ok) {
    // パターン1: バッチ全体が失敗（fetch エラー / HTTP エラー / タイムアウト）→ 全件リトライ判定
    const errMsg = sendResult.error || '送信失敗';
    console.log('[queue:apply] PATTERN 1 (sendResult.ok=false) all retry/fail, batch=', batch.length, 'err=', errMsg);
    return queue.map((q) => {
      if (!batchIds.has(q.id)) return q;
      return markFailedOrRetry(q, errMsg, config, now);
    });
  }

  const json = sendResult.json || {};
  const results = Array.isArray(json.results) ? json.results : null;

  // パターン2: 旧形式（single モード）: { success: true, message } / 全体成否のみ
  if (!results) {
    if (json.success === true) {
      console.log('[queue:apply] PATTERN 2a (no results, success=true) all sent, batch=', batch.length);
      return queue.map((q) => batchIds.has(q.id)
        ? { ...q, status: 'sent', completedAt: now, lastError: null }
        : q);
    }
    const errMsg = String(json.error || '不明なエラー');
    console.log('[queue:apply] PATTERN 2b (no results, success!=true) all retry/fail, batch=', batch.length,
      'json=', JSON.stringify(json).slice(0, 200));
    return queue.map((q) => {
      if (!batchIds.has(q.id)) return q;
      return markFailedOrRetry(q, errMsg, config, now);
    });
  }

  // パターン3: 一括モード: results[i] と batch[i] は順序対応 / 個別行ごとにリトライ判定
  console.log('[queue:apply] PATTERN 3 (results[]) batch=', batch.length, 'results=', results.length,
    'sample=', JSON.stringify(results.slice(0, 3)).slice(0, 300));
  const idToResult = new Map();
  for (let i = 0; i < batch.length; i++) {
    idToResult.set(batch[i].id, results[i]);
  }

  let sentCount = 0, retryCount = 0;
  const out = queue.map((q) => {
    if (!batchIds.has(q.id)) return q;
    const r = idToResult.get(q.id);
    if (r && r.ok === true) {
      sentCount++;
      return { ...q, status: 'sent', completedAt: now, lastError: null };
    }
    const errMsg = r?.error
      ? String(r.error)
      : '送信失敗(応答に結果が含まれていません)';
    retryCount++;
    return markFailedOrRetry(q, errMsg, config, now);
  });
  console.log('[queue:apply] PATTERN 3 done, sent=', sentCount, 'retry/fail=', retryCount);
  return out;
}

function cleanupOldSent(queue, cleanupAfterMs) {
  const threshold = Date.now() - (Number(cleanupAfterMs) || QUEUE_CONFIG_DEFAULTS.cleanupAfterMs);
  return queue.filter((q) => {
    if (!q) return false;
    if (q.status !== 'sent') return true;
    return (q.completedAt || 0) >= threshold;
  });
}

function countByStatus(queue, status) {
  let n = 0;
  for (const q of queue) if (q && q.status === status) n++;
  return n;
}

// withStorageLock の内側から呼ぶ stats 書き込み（自分は lock を取らない）
async function writeStats(queue) {
  try {
    const stats = {
      waiting: countByStatus(queue, 'waiting'),
      sending: countByStatus(queue, 'sending'),
      sent: countByStatus(queue, 'sent'),
      failed: countByStatus(queue, 'failed'),
      lastSyncAt: Date.now()
    };
    await chrome.storage.local.set({ [QUEUE_KEYS.stats]: stats });
  } catch (e) {
    console.error('[queue] writeStats failed:', e?.message || e);
  }
}

// lock 外から呼ぶ stats 更新（lock を取って queue を読み直す）
async function updateStats(queueOverride) {
  return withStorageLock(async () => {
    let queue = queueOverride;
    if (!queue) {
      const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
      queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    }
    await writeStats(queue);
  });
}

// ==========================================
// Phase 3 修正（指摘 8 対応）: options 画面からの書き込みを withStorageLock で守る
// すべて lock の内側で実行され、processQueue (Step A/C) との race condition を防ぐ。
// Immutability: 既存 queue/config を直接 mutate せず map/filter/spread のみ使う。
// ==========================================

async function queueRetryFailed() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    // §17 (v1.4.8) unknown_remote_state は一括リトライ対象から除外する。
    let retriedCount = 0;
    let excludedUnknownCount = 0;
    const next = queue.map((q) => {
      if (q?.status !== 'failed') return q;
      if (q?.lastError === 'unknown_remote_state') {
        excludedUnknownCount++;
        return q;
      }
      retriedCount++;
      return { ...q, status: 'waiting', retryCount: 0, nextRetryAt: 0, lastError: null, completedAt: null };
    });
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: next });
    await writeStats(next);
    return { success: true, retried: retriedCount, excludedUnknown: excludedUnknownCount };
  });
}

async function queueClearFailed() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    // §17 (v1.4.8) unknown_remote_state は確認待ちリストとして一括削除対象外にする。
    let clearedCount = 0;
    let keptUnknownCount = 0;
    const next = queue.filter((q) => {
      if (q?.status !== 'failed') return true;
      if (q?.lastError === 'unknown_remote_state') {
        keptUnknownCount++;
        return true;
      }
      clearedCount++;
      return false;
    });
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: next });
    await writeStats(next);
    return { success: true, cleared: clearedCount, keptUnknown: keptUnknownCount };
  });
}

async function queueClearSent() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    const next = queue.filter((q) => q?.status !== 'sent');
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: next });
    await writeStats(next);
    return { success: true };
  });
}

async function queueClearWaiting() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    // status='waiting' のみ削除（sending は触らない＝二重送信防止のため）
    const next = queue.filter((q) => q?.status !== 'waiting');
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: next });
    await writeStats(next);
    return { success: true };
  });
}

async function queueRequeueOne(itemId) {
  return withStorageLock(async () => {
    if (!itemId || typeof itemId !== 'string') {
      return { success: false, error: 'itemId が不正です' };
    }
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    const next = queue.map((q) => q?.id !== itemId
      ? q
      : { ...q, status: 'waiting', retryCount: 0, nextRetryAt: 0, lastError: null, completedAt: null });
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: next });
    await writeStats(next);
    return { success: true };
  });
}

async function queueDeleteOne(itemId) {
  return withStorageLock(async () => {
    if (!itemId || typeof itemId !== 'string') {
      return { success: false, error: 'itemId が不正です' };
    }
    const stored = await chrome.storage.local.get([QUEUE_KEYS.queue]);
    const queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
    const next = queue.filter((q) => q?.id !== itemId);
    await chrome.storage.local.set({ [QUEUE_KEYS.queue]: next });
    await writeStats(next);
    return { success: true };
  });
}

async function queueTogglePause() {
  return withStorageLock(async () => {
    const stored = await chrome.storage.local.get([QUEUE_KEYS.config]);
    const cfg = { ...QUEUE_CONFIG_DEFAULTS, ...(stored[QUEUE_KEYS.config] || {}) };
    const nextCfg = { ...cfg, paused: !cfg.paused };
    await chrome.storage.local.set({ [QUEUE_KEYS.config]: nextCfg });
    return { success: true, paused: nextCfg.paused };
  });
}

async function queueSaveConfig(updates) {
  return withStorageLock(async () => {
    if (!updates || typeof updates !== 'object') {
      return { success: false, error: 'updates が不正です' };
    }
    const stored = await chrome.storage.local.get([QUEUE_KEYS.config]);
    const cfg = { ...QUEUE_CONFIG_DEFAULTS, ...(stored[QUEUE_KEYS.config] || {}) };
    // 受け入れるのは限定キーのみ（任意のキーを書き込ませない）
    const allowed = {};
    if (typeof updates.batchSize === 'number') {
      allowed.batchSize = Math.max(1, Math.min(50, Math.round(updates.batchSize)));
    }
    if (typeof updates.maxRetry === 'number') {
      allowed.maxRetry = Math.max(0, Math.min(3, Math.round(updates.maxRetry))); // §16 (v1.4.7)
    }
    if (typeof updates.fetchTimeoutMs === 'number') {
      const sec = Math.max(10, Math.min(120, Math.round(updates.fetchTimeoutMs / 1000)));
      allowed.fetchTimeoutMs = sec * 1000;
    }
    const next = { ...cfg, ...allowed };
    await chrome.storage.local.set({ [QUEUE_KEYS.config]: next });
    return { success: true };
  });
}
