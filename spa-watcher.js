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

  // メルカリ側バンドルが window.scrollTo({top: null}) を繰り返し呼び、
  // top:null が 0 に強制変換されてページが最上部へ何度も飛ぶ不具合への防御。
  // 空の縦方向ターゲット(top が null/undefined/NaN かつ left も無い)のみ無視し、
  // それ以外の呼び出しは元の挙動をそのまま通す。
  const isMercari = /(^|\.)mercari\.com$/.test(location.hostname);

  if (isMercari) {
    let _emptyScrollCount = 0;
    let _lastLogAt = 0;
    const _isEmpty = (v) => v == null || (typeof v === 'number' && Number.isNaN(v));
    const _logThrottled = () => {
      const now = Date.now();
      if (now - _lastLogAt >= 2000) {
        _lastLogAt = now;
        console.log('[とりこみ君] メルカリの空スクロール(top:null)を無視しました (累計' + _emptyScrollCount + '回)');
      }
    };
    const _wrapScrollFn = (_orig) => {
      return function(...args) {
        try {
          if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const opts = args[0];
            const topEmpty = _isEmpty(opts.top);
            const leftEmpty = _isEmpty(opts.left);
            if (topEmpty && leftEmpty) {
              _emptyScrollCount++;
              _logThrottled();
              return;
            }
            if (topEmpty) {
              return _orig({ left: opts.left, behavior: opts.behavior });
            }
            return _orig(opts);
          }
          return _orig(...args);
        } catch (e) {
          return _orig(...args);
        }
      };
    };

    const _origScrollTo = window.scrollTo.bind(window);
    window.scrollTo = _wrapScrollFn(_origScrollTo);

    if (typeof window.scroll === 'function') {
      const _origScroll = window.scroll.bind(window);
      window.scroll = _wrapScrollFn(_origScroll);
    }
  }
})();
