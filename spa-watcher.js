// spa-watcher.js — MAIN world で pushState/replaceState を監視し
// ISOLATED world (external-links.js) に us-url-change イベントを通知する
(function() {
  'use strict';
  const _origPushState = history.pushState.bind(history);
  const _origReplaceState = history.replaceState.bind(history);

  history.pushState = function(...args) {
    _origPushState(...args);
    window.dispatchEvent(new Event('us-url-change'));
  };

  history.replaceState = function(...args) {
    _origReplaceState(...args);
    window.dispatchEvent(new Event('us-url-change'));
  };
})();
