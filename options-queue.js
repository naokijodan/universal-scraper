// とりこみ君 設定画面 - 送信キュー進捗パネル制御
//
// 仕様: docs/queue-design.md §5-1 / §4 / §15 Phase 3 指摘 8 修正
// 役割:
//   - chrome.storage.local の queue / queueStats / queueConfig を「表示のみ」
//   - chrome.storage.onChanged でリアルタイム更新
//   - 全ての書き込み操作（kickQueue / リトライ / クリア / 一時停止 / 個別再送 / 個別削除 / 設定保存）は
//     chrome.runtime.sendMessage で background に依頼し、background 側で withStorageLock を経由する
//   - これにより processQueue (Step A/C) との race condition を排除する
//
// セキュリティ: DOM 挿入は textContent のみ。innerHTML は使わない。

(function () {
  'use strict';

  // ----- 定数 -----
  const QUEUE_KEYS = Object.freeze({
    queue: 'queue',
    config: 'queueConfig',
    stats: 'queueStats'
  });

  const CONFIG_DEFAULTS = Object.freeze({
    batchSize: 5,
    intervalSec: 60,
    maxRetry: 3,
    retryBackoffMs: [5000, 15000, 45000],
    cleanupAfterMs: 24 * 60 * 60 * 1000,
    paused: false
  });

  const FETCH_TIMEOUT_DEFAULT_SEC = 60;
  const LIST_LIMIT = 50;
  const SOURCE_LABEL_MAX = 60;
  const REFRESH_INTERVAL_MS = 1000;

  // ----- 状態（読み取り用キャッシュ。書き込みは常に chrome.storage 経由） -----
  const state = {
    queue: [],
    config: { ...CONFIG_DEFAULTS },
    stats: { waiting: 0, sending: 0, sent: 0, failed: 0, lastSyncAt: 0 },
    refreshTimer: null
  };

  // ==========================================
  // ユーティリティ
  // ==========================================

  function getNow() { return Date.now(); }

  function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function truncate(text, maxLen) {
    const s = (text == null) ? '' : String(text);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
  }

  function formatRelative(ms) {
    if (!ms || typeof ms !== 'number') return '';
    const diff = getNow() - ms;
    if (diff < 0) return '今';
    if (diff < 5000) return 'たった今';
    if (diff < 60_000) return Math.floor(diff / 1000) + ' 秒前';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分前';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 時間前';
    return Math.floor(diff / 86_400_000) + ' 日前';
  }

  function formatCountdown(ms) {
    const remain = ms - getNow();
    if (remain <= 0) return '間もなく再送';
    if (remain < 60_000) return Math.ceil(remain / 1000) + ' 秒後に再送';
    return Math.ceil(remain / 60_000) + ' 分後に再送';
  }

  function getStatusIcon(status, item) {
    if (status === 'sending') return '📡';
    if (status === 'sent') return '✅';
    if (status === 'failed') return '❌';
    if (status === 'waiting') {
      const now = getNow();
      if ((item?.nextRetryAt || 0) > now) return '⏳';
      return '⌛';
    }
    return '•';
  }

  function getStatusLabel(status, item) {
    if (status === 'sending') return '送信中';
    if (status === 'sent') return '成功';
    if (status === 'failed') return '失敗' + (item?.retryCount ? '（' + item.retryCount + '回）' : '');
    if (status === 'waiting') {
      const now = getNow();
      if ((item?.nextRetryAt || 0) > now) return 'リトライ待ち';
      return '待機';
    }
    return status || '?';
  }

  // ==========================================
  // 統計計算
  // ==========================================
  function computeStats(queue) {
    const now = getNow();
    let waiting = 0, sending = 0, sent = 0, failed = 0, retrying = 0;
    for (const q of (Array.isArray(queue) ? queue : [])) {
      if (!q || typeof q !== 'object') continue;
      if (q.status === 'sending') sending++;
      else if (q.status === 'sent') sent++;
      else if (q.status === 'failed') failed++;
      else if (q.status === 'waiting') {
        if ((q.nextRetryAt || 0) > now) retrying++;
        else waiting++;
      }
    }
    return { waiting, sending, sent, failed, retrying };
  }

  // ==========================================
  // DOM 取得（null セーフ）
  // ==========================================
  function $(id) { return document.getElementById(id); }

  // ==========================================
  // 数値表示の更新
  // ==========================================
  function renderStats() {
    const s = computeStats(state.queue);
    const el = {
      waiting: $('queue-stat-waiting'),
      sending: $('queue-stat-sending'),
      retry: $('queue-stat-retry'),
      sent: $('queue-stat-sent'),
      failed: $('queue-stat-failed')
    };
    if (el.waiting) el.waiting.textContent = String(s.waiting);
    if (el.sending) el.sending.textContent = String(s.sending);
    if (el.retry) el.retry.textContent = String(s.retrying);
    if (el.sent) el.sent.textContent = String(s.sent);
    if (el.failed) el.failed.textContent = String(s.failed);

    const sync = $('queue-last-sync');
    if (sync) {
      const t = state.stats?.lastSyncAt;
      sync.textContent = t ? '最終同期: ' + formatRelative(t) : '';
    }
  }

  // ==========================================
  // 一時停止ボタンの表示更新
  // ==========================================
  function renderPauseButton() {
    const btn = $('queue-pause-btn');
    if (!btn) return;
    const paused = state.config?.paused === true;
    btn.textContent = paused ? '▶ 再開' : '⏸ 一時停止';
    btn.classList.toggle('queue-paused', paused);
  }

  // ==========================================
  // 個別 item リスト描画（最大 LIST_LIMIT 件）
  // ==========================================
  function renderQueueList() {
    const container = $('queue-list');
    if (!container) return;

    // textContent でクリア
    container.textContent = '';

    const items = Array.isArray(state.queue) ? state.queue.slice(0, LIST_LIMIT) : [];
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'queue-empty';
      empty.textContent = 'キューは空です';
      container.appendChild(empty);
      return;
    }

    for (const item of items) {
      container.appendChild(buildQueueItemRow(item));
    }
  }

  function buildQueueItemRow(item) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.dataset.id = item.id || '';

    const icon = document.createElement('div');
    icon.className = 'queue-item-icon';
    icon.textContent = getStatusIcon(item.status, item);
    row.appendChild(icon);

    row.appendChild(buildQueueItemBody(item));
    row.appendChild(buildQueueItemActions(item));
    return row;
  }

  function buildQueueItemBody(item) {
    const body = document.createElement('div');
    body.className = 'queue-item-body';

    const line1 = document.createElement('div');
    line1.className = 'queue-item-line1';
    const statusLabel = getStatusLabel(item.status, item);
    const label = item.sourceLabel ? truncate(item.sourceLabel, SOURCE_LABEL_MAX) : '(ラベルなし)';
    line1.textContent = '[' + statusLabel + '] ' + (item.sheetName || '(シート未指定)') + ' / ' + label;
    body.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'queue-item-line2';
    const parts = [];
    if (item.createdAt) parts.push('追加: ' + formatRelative(item.createdAt));
    if (item.status === 'waiting' && (item.nextRetryAt || 0) > getNow()) {
      parts.push(formatCountdown(item.nextRetryAt));
    }
    if (item.lastError) {
      parts.push('理由: ' + truncate(item.lastError, 80));
    }
    line2.textContent = parts.join(' / ');
    body.appendChild(line2);
    return body;
  }

  function buildQueueItemActions(item) {
    const actions = document.createElement('div');
    actions.className = 'queue-item-actions';
    if (item.status === 'failed' || item.status === 'sent') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.textContent = '↻ 再送';
      retryBtn.addEventListener('click', () => requeueOne(item.id));
      actions.appendChild(retryBtn);
    }
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '🗑 削除';
    delBtn.addEventListener('click', () => deleteOne(item.id));
    actions.appendChild(delBtn);
    return actions;
  }

  // ==========================================
  // 設定フォームの表示更新
  // ==========================================
  function renderConfigForm() {
    const cfg = state.config || CONFIG_DEFAULTS;
    const batch = clamp(safeNumber(cfg.batchSize, CONFIG_DEFAULTS.batchSize), 1, 50);
    const maxRetry = clamp(safeNumber(cfg.maxRetry, CONFIG_DEFAULTS.maxRetry), 1, 5);
    const fetchTimeoutSec = clamp(
      Math.round(safeNumber(cfg.fetchTimeoutMs, FETCH_TIMEOUT_DEFAULT_SEC * 1000) / 1000),
      10, 120
    );

    const bs = $('queue-config-bulksize');
    const bsVal = $('queue-config-bulksize-value');
    if (bs) bs.value = String(batch);
    if (bsVal) bsVal.textContent = String(batch);

    const mr = $('queue-config-maxretry');
    if (mr) mr.value = String(maxRetry);

    const ft = $('queue-config-fetch-timeout');
    if (ft) ft.value = String(fetchTimeoutSec);
  }

  // ==========================================
  // chrome.storage.local からの初期読み込み
  // ==========================================
  async function loadFromStorage() {
    try {
      const stored = await chrome.storage.local.get([
        QUEUE_KEYS.queue, QUEUE_KEYS.config, QUEUE_KEYS.stats
      ]);
      state.queue = Array.isArray(stored[QUEUE_KEYS.queue]) ? stored[QUEUE_KEYS.queue] : [];
      state.config = { ...CONFIG_DEFAULTS, ...(stored[QUEUE_KEYS.config] || {}) };
      state.stats = stored[QUEUE_KEYS.stats] || state.stats;
      renderAll();
    } catch (e) {
      console.error('[options-queue] loadFromStorage failed:', e?.message || e);
    }
  }

  function renderAll() {
    renderStats();
    renderPauseButton();
    renderQueueList();
    renderConfigForm();
  }

  // ==========================================
  // chrome.storage.onChanged 監視
  // ==========================================
  function attachStorageListener() {
    if (!chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      let touched = false;
      if (changes[QUEUE_KEYS.queue]) {
        state.queue = Array.isArray(changes[QUEUE_KEYS.queue].newValue)
          ? changes[QUEUE_KEYS.queue].newValue
          : [];
        touched = true;
      }
      if (changes[QUEUE_KEYS.config]) {
        state.config = { ...CONFIG_DEFAULTS, ...(changes[QUEUE_KEYS.config].newValue || {}) };
        touched = true;
      }
      if (changes[QUEUE_KEYS.stats]) {
        state.stats = changes[QUEUE_KEYS.stats].newValue || state.stats;
        touched = true;
      }
      if (touched) renderAll();
    });
  }

  // ==========================================
  // 定期再描画（経過時間・カウントダウンを更新するため）
  // ==========================================
  function startPeriodicRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      // queue 自体は変わっていなくても、リトライまでの秒数表示は時間で変わる
      renderStats();
      renderQueueList();
      const sync = $('queue-last-sync');
      if (sync && state.stats?.lastSyncAt) {
        sync.textContent = '最終同期: ' + formatRelative(state.stats.lastSyncAt);
      }
    }, REFRESH_INTERVAL_MS);
  }

  // ==========================================
  // アクション: 今すぐ送信（background に依頼）
  // ==========================================
  async function kickQueue() {
    const btn = $('queue-kick-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await sendMessageSafely({ action: 'kickQueue' });
      if (!res || res.success === false) {
        console.warn('[options-queue] kickQueue failed:', res?.error);
      }
    } catch (e) {
      console.error('[options-queue] kickQueue error:', e?.message || e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function sendMessageSafely(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        resolve({ success: false, error: e?.message || 'sendMessage 失敗' });
      }
    });
  }

  // ==========================================
  // アクション: 失敗をリトライ
  // Phase 3 修正（指摘 8）: storage 直接更新ではなく background に依頼。
  // background 側で withStorageLock を通すことで processQueue との race を防ぐ。
  // ==========================================
  async function retryFailed() {
    try {
      const res = await sendMessageSafely({ action: 'queueRetryFailed' });
      if (!res || res.success === false) {
        console.warn('[options-queue] retryFailed failed:', res?.error);
        return;
      }
      // リトライ後すぐ送信を始めるためキック
      await sendMessageSafely({ action: 'kickQueue' });
    } catch (e) {
      console.error('[options-queue] retryFailed error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 失敗をクリア
  // ==========================================
  async function clearFailed() {
    if (!confirmAction('失敗した項目をすべて削除しますか？\n（待機・送信中・成功の項目はそのまま残ります）')) return;
    try {
      const res = await sendMessageSafely({ action: 'queueClearFailed' });
      if (!res || res.success === false) {
        console.warn('[options-queue] clearFailed failed:', res?.error);
      }
    } catch (e) {
      console.error('[options-queue] clearFailed error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 成功をクリア
  // ==========================================
  async function clearSent() {
    if (!confirmAction('成功した項目（送信完了の履歴）をすべて削除しますか？\n（待機・送信中・失敗の項目はそのまま残ります）')) return;
    try {
      const res = await sendMessageSafely({ action: 'queueClearSent' });
      if (!res || res.success === false) {
        console.warn('[options-queue] clearSent failed:', res?.error);
      }
    } catch (e) {
      console.error('[options-queue] clearSent error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 待機をクリア（緊急停止後の取り消し用）
  // ==========================================
  async function clearWaiting() {
    if (!confirmAction('待機中の項目をすべて削除しますか？\n（送信せずにキャンセルされます。送信中・成功・失敗の項目はそのまま残ります）')) return;
    try {
      const res = await sendMessageSafely({ action: 'queueClearWaiting' });
      if (!res || res.success === false) {
        console.warn('[options-queue] clearWaiting failed:', res?.error);
      }
    } catch (e) {
      console.error('[options-queue] clearWaiting error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 一時停止 / 再開
  // ==========================================
  async function togglePause() {
    try {
      const res = await sendMessageSafely({ action: 'queueTogglePause' });
      if (!res || res.success === false) {
        console.warn('[options-queue] togglePause failed:', res?.error);
        return;
      }
      // レスポンスの paused をもとに UI を即時反映
      // (chrome.storage.onChanged でも反映されるが、UI 反応のラグを抑える)
      if (typeof res.paused === 'boolean') {
        state.config = { ...state.config, paused: res.paused };
        renderPauseButton();
        // false = 再開した直後 → すぐ送信を始めるためキック
        if (res.paused === false) {
          await sendMessageSafely({ action: 'kickQueue' });
        }
      }
    } catch (e) {
      console.error('[options-queue] togglePause error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 個別 item の再送
  // ==========================================
  async function requeueOne(itemId) {
    if (!itemId) return;
    try {
      const res = await sendMessageSafely({ action: 'queueRequeueOne', itemId });
      if (!res || res.success === false) {
        console.warn('[options-queue] requeueOne failed:', res?.error);
        return;
      }
      await sendMessageSafely({ action: 'kickQueue' });
    } catch (e) {
      console.error('[options-queue] requeueOne error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 個別 item の削除
  // ==========================================
  async function deleteOne(itemId) {
    if (!itemId) return;
    if (!confirmAction('この項目を削除しますか？')) return;
    try {
      const res = await sendMessageSafely({ action: 'queueDeleteOne', itemId });
      if (!res || res.success === false) {
        console.warn('[options-queue] deleteOne failed:', res?.error);
      }
    } catch (e) {
      console.error('[options-queue] deleteOne error:', e?.message || e);
    }
  }

  // ==========================================
  // アクション: 設定保存
  // ==========================================
  async function saveConfig() {
    const statusEl = $('queue-config-save-status');
    try {
      const bs = $('queue-config-bulksize');
      const mr = $('queue-config-maxretry');
      const ft = $('queue-config-fetch-timeout');

      const batchSize = clamp(safeNumber(bs?.value, CONFIG_DEFAULTS.batchSize), 1, 50);
      const maxRetry = clamp(safeNumber(mr?.value, CONFIG_DEFAULTS.maxRetry), 1, 5);
      const fetchTimeoutSec = clamp(safeNumber(ft?.value, FETCH_TIMEOUT_DEFAULT_SEC), 10, 120);

      const res = await sendMessageSafely({
        action: 'queueSaveConfig',
        updates: { batchSize, maxRetry, fetchTimeoutMs: fetchTimeoutSec * 1000 }
      });
      if (res?.success) {
        if (statusEl) {
          statusEl.textContent = '保存しました';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
        }
      } else {
        console.warn('[options-queue] saveConfig failed:', res?.error);
        if (statusEl) statusEl.textContent = '保存に失敗しました';
      }
    } catch (e) {
      console.error('[options-queue] saveConfig error:', e?.message || e);
      if (statusEl) statusEl.textContent = '保存に失敗しました';
    }
  }

  function confirmAction(message) {
    try {
      return window.confirm(message);
    } catch (_) {
      return true;
    }
  }

  // ==========================================
  // イベント結線
  // ==========================================
  function attachEventListeners() {
    const kick = $('queue-kick-btn');
    if (kick) kick.addEventListener('click', kickQueue);

    const retry = $('queue-retry-btn');
    if (retry) retry.addEventListener('click', retryFailed);

    const clear = $('queue-clear-failed-btn');
    if (clear) clear.addEventListener('click', clearFailed);

    const clearSentBtn = $('queue-clear-sent-btn');
    if (clearSentBtn) clearSentBtn.addEventListener('click', clearSent);

    const clearWaitingBtn = $('queue-clear-waiting-btn');
    if (clearWaitingBtn) clearWaitingBtn.addEventListener('click', clearWaiting);

    const pause = $('queue-pause-btn');
    if (pause) pause.addEventListener('click', togglePause);

    const save = $('queue-config-save-btn');
    if (save) save.addEventListener('click', saveConfig);

    const bsRange = $('queue-config-bulksize');
    const bsLabel = $('queue-config-bulksize-value');
    if (bsRange && bsLabel) {
      bsRange.addEventListener('input', () => {
        bsLabel.textContent = String(bsRange.value);
      });
    }
  }

  // ==========================================
  // 初期化
  // ==========================================
  function init() {
    try {
      attachEventListeners();
      attachStorageListener();
      loadFromStorage();
      startPeriodicRefresh();
    } catch (e) {
      console.error('[options-queue] init failed:', e?.message || e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
