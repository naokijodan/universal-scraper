// とりこみ君 設定画面 - 直接送信の履歴パネル制御（v1.6.6）
//
// 役割:
//   - background-direct.js の directQueue / directWarmup を「表示のみ」
//   - 2 秒ごとに chrome.runtime.sendMessage({action:'directGetState'}) でポーリングし、
//     取得データを JSON 文字列で比較して変化があった時だけ DOM を再構築する（無駄な再描画を避ける）
//   - 書き込み操作（再送・クリア・削除）はすべて background に依頼し、background-direct.js の
//     withStorageLock を経由させる（processDirectQueue との race condition を排除）
//
// セキュリティ: DOM 挿入は textContent のみ。innerHTML は使わない。

(function () {
  'use strict';

  const LIST_LIMIT = 100;
  const SOURCE_LABEL_MAX = 40;
  const ERROR_MAX = 100;
  const POLL_INTERVAL_MS = 2000;

  const state = {
    items: [],
    warmup: {},
    pollTimer: null,
    lastItemsJson: null,
    lastWarmupJson: null
  };

  // ==========================================
  // ユーティリティ
  // ==========================================
  function $(id) { return document.getElementById(id); }

  function truncate(text, maxLen) {
    const s = (text == null) ? '' : String(text);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
  }

  function formatClock(ms) {
    if (!ms || typeof ms !== 'number') return '';
    try {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (_) {
      return '';
    }
  }

  function formatSeconds(ms) {
    if (!ms || typeof ms !== 'number' || ms <= 0) return '';
    return (ms / 1000).toFixed(1) + 's';
  }

  function getStatusIcon(status) {
    if (status === 'sending') return '📡';
    if (status === 'sent') return '✅';
    if (status === 'failed') return '❌';
    if (status === 'unknown') return '⚠️';
    if (status === 'waiting') return '⌛';
    return '•';
  }

  function getStatusLabel(status) {
    if (status === 'sending') return '送信中';
    if (status === 'sent') return '成功';
    if (status === 'failed') return '失敗';
    if (status === 'unknown') return '不明（要確認）';
    if (status === 'waiting') return '待機';
    return status || '?';
  }

  function computeStats(items) {
    let waiting = 0, sending = 0, sent = 0, failed = 0, unknown = 0;
    for (const q of (Array.isArray(items) ? items : [])) {
      if (!q || typeof q !== 'object') continue;
      if (q.status === 'waiting') waiting++;
      else if (q.status === 'sending') sending++;
      else if (q.status === 'sent') sent++;
      else if (q.status === 'failed') failed++;
      else if (q.status === 'unknown') unknown++;
    }
    return { waiting, sending, sent, failed, unknown };
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

  function confirmAction(message) {
    try {
      return window.confirm(message);
    } catch (_) {
      return true;
    }
  }

  // ==========================================
  // 描画
  // ==========================================
  function renderStats() {
    const s = computeStats(state.items);
    const el = {
      waiting: $('direct-stat-waiting'),
      sending: $('direct-stat-sending'),
      sent: $('direct-stat-sent'),
      failed: $('direct-stat-failed'),
      unknown: $('direct-stat-unknown')
    };
    if (el.waiting) el.waiting.textContent = String(s.waiting);
    if (el.sending) el.sending.textContent = String(s.sending);
    if (el.sent) el.sent.textContent = String(s.sent);
    if (el.failed) el.failed.textContent = String(s.failed);
    if (el.unknown) el.unknown.textContent = String(s.unknown);

    const retryBtn = $('direct-retry-btn');
    if (retryBtn) retryBtn.disabled = (s.failed === 0 && s.unknown === 0);

    const clearFailedBtn = $('direct-clear-failed-btn');
    if (clearFailedBtn) clearFailedBtn.disabled = (s.failed === 0 && s.unknown === 0);

    const clearDoneBtn = $('direct-clear-done-btn');
    if (clearDoneBtn) clearDoneBtn.disabled = (s.sent === 0);
  }

  function renderWarmup() {
    const el = $('direct-warmup-last');
    if (!el) return;
    const values = Object.values(state.warmup || {}).map((v) => Number(v) || 0).filter((v) => v > 0);
    if (values.length === 0) {
      el.textContent = '受け口ウォームアップ 最終: 未実施';
      return;
    }
    const latest = Math.max(...values);
    el.textContent = '受け口ウォームアップ 最終: ' + formatClock(latest);
  }

  function renderList() {
    const container = $('direct-list');
    if (!container) return;

    container.textContent = '';

    const sorted = (Array.isArray(state.items) ? state.items.slice() : [])
      .sort((a, b) => (b?.enqueuedAt || 0) - (a?.enqueuedAt || 0));
    const items = sorted.slice(0, LIST_LIMIT);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'queue-empty';
      empty.textContent = '送信履歴はありません';
      container.appendChild(empty);
      return;
    }

    for (const item of items) {
      container.appendChild(buildItemRow(item));
    }

    if (sorted.length > LIST_LIMIT) {
      const hint = document.createElement('div');
      hint.className = 'queue-list-hint';
      hint.textContent = sorted.length + ' 件のうち新しい ' + LIST_LIMIT + ' 件を表示中';
      container.appendChild(hint);
    }
  }

  function buildItemRow(item) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.dataset.id = item.id || '';

    const icon = document.createElement('div');
    icon.className = 'queue-item-icon';
    icon.textContent = getStatusIcon(item.status);
    row.appendChild(icon);

    row.appendChild(buildItemBody(item));
    row.appendChild(buildItemActions(item));
    return row;
  }

  function buildItemBody(item) {
    const body = document.createElement('div');
    body.className = 'queue-item-body';

    const line1 = document.createElement('div');
    line1.className = 'queue-item-line1';
    const label = item.sourceLabel ? truncate(item.sourceLabel, SOURCE_LABEL_MAX) : '(商品名不明)';
    line1.textContent = '[' + getStatusLabel(item.status) + '] '
      + formatClock(item.enqueuedAt) + ' / '
      + (item.sheetName || '(シート未指定)') + ' / '
      + label;
    body.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'queue-item-line2';
    const parts = [];
    const timing = item.timing || {};
    if (typeof timing.totalMs === 'number' && timing.totalMs > 0) {
      parts.push('所要: ' + formatSeconds(timing.totalMs));
    }
    const detail = [];
    if (typeof timing.imageMs === 'number' && timing.imageMs > 0) detail.push('画像 ' + formatSeconds(timing.imageMs));
    if (typeof timing.fetchMs === 'number' && timing.fetchMs > 0) detail.push('シート応答 ' + formatSeconds(timing.fetchMs));
    if (detail.length) parts.push('(' + detail.join(' / ') + ')');
    if (item.lastError) parts.push('エラー: ' + truncate(item.lastError, ERROR_MAX));
    line2.textContent = parts.join(' ');
    if (detail.length) {
      line2.title = detail.join(' / ');
    }
    body.appendChild(line2);
    return body;
  }

  function buildItemActions(item) {
    const actions = document.createElement('div');
    actions.className = 'queue-item-actions';
    if (item.status === 'failed' || item.status === 'unknown') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.textContent = '↻ 再送';
      retryBtn.addEventListener('click', () => onRetryClick(item));
      actions.appendChild(retryBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '🗑 削除';
      delBtn.addEventListener('click', () => deleteOne(item.id));
      actions.appendChild(delBtn);
    }
    return actions;
  }

  function renderAll() {
    renderStats();
    renderWarmup();
    renderList();
  }

  // ==========================================
  // ポーリング（2秒ごと、差分がある時だけ再描画）
  // ==========================================
  async function poll() {
    try {
      const res = await sendMessageSafely({ action: 'directGetState' });
      if (!res || res.success === false) return;
      const items = Array.isArray(res.items) ? res.items : [];
      const warmup = res.warmup || {};

      const itemsJson = JSON.stringify(items);
      const warmupJson = JSON.stringify(warmup);
      if (itemsJson === state.lastItemsJson && warmupJson === state.lastWarmupJson) {
        return; // 変化なし
      }
      state.items = items;
      state.warmup = warmup;
      state.lastItemsJson = itemsJson;
      state.lastWarmupJson = warmupJson;
      renderAll();
    } catch (e) {
      console.error('[options-direct] poll failed:', e?.message || e);
    }
  }

  function startPolling() {
    poll();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  // ==========================================
  // アクション
  // ==========================================
  async function retryFailed() {
    if (!confirmAction('『失敗』の項目をすべて再送待機に戻しますか？\n（『不明』は書き込み済みの可能性が高いため対象外です。個別に確認して再送してください）')) return;
    try {
      const res = await sendMessageSafely({ action: 'directRetryFailed' });
      if (!res || res.success === false) {
        console.warn('[options-direct] retryFailed failed:', res?.error);
      }
      poll();
    } catch (e) {
      console.error('[options-direct] retryFailed error:', e?.message || e);
    }
  }

  async function clearFailed() {
    if (!confirmAction('失敗・不明の履歴をすべて削除しますか？\n（待機・送信中・成功の項目はそのまま残ります）')) return;
    try {
      const res = await sendMessageSafely({ action: 'directClearFailed' });
      if (!res || res.success === false) {
        console.warn('[options-direct] clearFailed failed:', res?.error);
      }
      poll();
    } catch (e) {
      console.error('[options-direct] clearFailed error:', e?.message || e);
    }
  }

  async function clearDone() {
    if (!confirmAction('成功した項目（送信完了の履歴）をすべて削除しますか？')) return;
    try {
      const res = await sendMessageSafely({ action: 'directClearDone' });
      if (!res || res.success === false) {
        console.warn('[options-direct] clearDone failed:', res?.error);
      }
      poll();
    } catch (e) {
      console.error('[options-direct] clearDone error:', e?.message || e);
    }
  }

  function onRetryClick(item) {
    if (!item || !item.id) return;
    if (item.status === 'unknown') {
      if (!confirmAction('この商品はスプレッドシートに既に書き込まれている可能性が高いです。\n\nシートを開いて、この商品の行が「無い」ことを確認しましたか？\n無い場合のみ再送してください（有る場合は二重になります）。')) {
        return;
      }
    }
    requeueOne(item.id);
  }

  async function requeueOne(id) {
    if (!id) return;
    try {
      const res = await sendMessageSafely({ action: 'directRequeueOne', id });
      if (!res || res.success === false) {
        console.warn('[options-direct] requeueOne failed:', res?.error);
      }
      poll();
    } catch (e) {
      console.error('[options-direct] requeueOne error:', e?.message || e);
    }
  }

  async function deleteOne(id) {
    if (!id) return;
    if (!confirmAction('この項目を削除しますか？')) return;
    try {
      const res = await sendMessageSafely({ action: 'directDeleteOne', id });
      if (!res || res.success === false) {
        console.warn('[options-direct] deleteOne failed:', res?.error);
      }
      poll();
    } catch (e) {
      console.error('[options-direct] deleteOne error:', e?.message || e);
    }
  }

  // ==========================================
  // イベント結線
  // ==========================================
  function attachEventListeners() {
    const retry = $('direct-retry-btn');
    if (retry) retry.addEventListener('click', retryFailed);

    const clearF = $('direct-clear-failed-btn');
    if (clearF) clearF.addEventListener('click', clearFailed);

    const clearD = $('direct-clear-done-btn');
    if (clearD) clearD.addEventListener('click', clearDone);
  }

  // ==========================================
  // 初期化
  // ==========================================
  function init() {
    try {
      attachEventListeners();
      startPolling();
      window.addEventListener('beforeunload', () => {
        if (state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
      });
    } catch (e) {
      console.error('[options-direct] init failed:', e?.message || e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
