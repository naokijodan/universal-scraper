// とりこみ君 設定画面 - キーボードショートカット案内パネル制御
//
// 役割:
//   - manifest.json の commands（direct-send / select-send / preview）の
//     現在の割り当てキーを chrome.commands.getAll() で取得して表示する
//   - 「ショートカット設定画面を開く」ボタンで chrome://extensions/shortcuts を新規タブで開く
//   - ページにフォーカスが戻った時（chrome://extensions/shortcuts から戻った時）に再取得し、
//     変更後のキーを反映する
//
// 権限メモ（Fact, 2026-09-14 https://developer.chrome.com/docs/extensions/reference/api/commands
//   および https://developer.chrome.com/docs/extensions/reference/api/tabs より確認）:
//   - chrome.commands.getAll() は manifest.json の "commands" キー宣言のみで使用可能。
//     "permissions" 配列への追加は不要。
//   - chrome.tabs.create({url}) のような基本的なタブ作成は "tabs" 権限なしで使用可能。
//     "tabs" 権限は tabs.query() の一部センシティブなプロパティ取得にのみ必要。
//
// セキュリティ: DOM 挿入は textContent のみ。innerHTML は使わない。

(function () {
  'use strict';

  const COMMAND_CELL_IDS = {
    'direct-send': 'shortcut-key-direct-send',
    'select-send': 'shortcut-key-select-send',
    'preview': 'shortcut-key-preview'
  };

  const UNSET_LABEL = '未設定';

  function $(id) { return document.getElementById(id); }

  function refreshShortcuts() {
    try {
      if (!chrome || !chrome.commands || typeof chrome.commands.getAll !== 'function') {
        return;
      }
      chrome.commands.getAll().then((commands) => {
        try {
          const byName = {};
          (commands || []).forEach((cmd) => {
            if (cmd && cmd.name) byName[cmd.name] = cmd;
          });

          Object.keys(COMMAND_CELL_IDS).forEach((name) => {
            const cellId = COMMAND_CELL_IDS[name];
            const cell = $(cellId);
            if (!cell) return;
            const cmd = byName[name];
            const shortcut = cmd && cmd.shortcut ? cmd.shortcut : '';
            cell.textContent = shortcut || UNSET_LABEL;
          });
        } catch (e) {
          console.error('[options-shortcuts] render failed:', e && e.message || e);
        }
      }).catch((e) => {
        console.error('[options-shortcuts] getAll failed:', e && e.message || e);
      });
    } catch (e) {
      console.error('[options-shortcuts] refreshShortcuts failed:', e && e.message || e);
    }
  }

  function openShortcutsPage() {
    try {
      if (!chrome || !chrome.tabs || typeof chrome.tabs.create !== 'function') {
        showHelpTextAsError();
        return;
      }
      const p = chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          showHelpTextAsError();
        });
      }
    } catch (e) {
      console.error('[options-shortcuts] openShortcutsPage failed:', e && e.message || e);
      showHelpTextAsError();
    }
  }

  function showHelpTextAsError() {
    try {
      const helpText = $('shortcuts-help-text');
      if (helpText) helpText.classList.add('shortcuts-help-error');
    } catch (_) {
      // no-op
    }
  }

  function attachEventListeners() {
    try {
      const btn = $('open-shortcuts-btn');
      if (btn) btn.addEventListener('click', openShortcutsPage);

      window.addEventListener('focus', refreshShortcuts);
    } catch (e) {
      console.error('[options-shortcuts] attachEventListeners failed:', e && e.message || e);
    }
  }

  function init() {
    try {
      attachEventListeners();
      refreshShortcuts();
    } catch (e) {
      console.error('[options-shortcuts] init failed:', e && e.message || e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
