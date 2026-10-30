// page-data-bridge.js — MAIN world でメルカリ商品ページの React ツリーから
// 出品日時(created)・更新日時(updated)・出品者評価内訳(seller.ratings)を読み取り、
// document.documentElement.dataset.usPageItem（JSON文字列）として ISOLATED world の content.js に渡す。
// フリマアシスト非依存化のため。ネットワークアクセスなし・例外は外に出さない。
(function() {
  'use strict';

  const ATTR = 'usPageItem';
  const POLL_MS = 500;
  const POLL_MAX_MS = 20000;
  let _timer = null;
  let _gen = 0; // 開始ごとに増やし、古いポーリングを無効化する

  // 現在URLの商品ID（/item/m... または /shops/product/...）
  const getUrlId = () => {
    const m = location.pathname.match(/\/item\/(m\d+)/) || location.pathname.match(/\/shops\/product\/([A-Za-z0-9]+)/);
    return m ? m[1] : '';
  };

  // 商品オブジェクトらしいか（id一致 + created/updated が数値）
  const isItemObj = (o, id) => {
    return o && typeof o === 'object' && o.id === id &&
      typeof o.created === 'number' && isFinite(o.created);
  };

  // Mercari Shops の商品オブジェクトらしいか（/shops/product/ のみ。name がURLのID、createTime がISO文字列）
  // ※出品者評価内訳は Shops では取れない。上位の value.user.ratings は閲覧者本人のものなので絶対に使わない
  const isShopsObj = (o, id) => {
    return /^\/shops\/product\//.test(location.pathname) && o && typeof o === 'object' &&
      o.name === id && typeof o.createTime === 'string';
  };

  // props 内のネストしたオブジェクトを深さ4まで探索（children と _始まりのキーは除外、循環ガード）
  const findInProps = (props, id) => {
    const seen = new Set();
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 4 || seen.has(o)) return null;
      seen.add(o);
      if (isItemObj(o, id) || isShopsObj(o, id)) return o;
      let keys;
      try { keys = Object.keys(o); } catch (e) { return null; }
      for (const k of keys) {
        if (k === 'children' || k.charAt(0) === '_') continue;
        let v;
        try { v = o[k]; } catch (e) { continue; }
        if (v && typeof v === 'object') {
          const r = walk(v, depth + 1);
          if (r) return r;
        }
      }
      return null;
    };
    return walk(props, 0);
  };

  const findItem = (id) => {
    const el = document.querySelector('[data-testid="発送までの日数"]') ||
               document.querySelector('#item-info') ||
               document.querySelector('main');
    if (!el) return null;
    const fk = Object.keys(el).find(k => k.indexOf('__reactFiber') === 0);
    if (!fk) return null;
    let fiber = el[fk];
    let guard = 0;
    while (fiber && guard++ < 200) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object') {
        const r = findInProps(props, id);
        if (r) return r;
      }
      fiber = fiber.return;
    }
    return null;
  };

  const clear = () => {
    try { delete document.documentElement.dataset[ATTR]; } catch (e) {}
  };

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  const tryOnce = (id) => {
    try {
      const item = findItem(id);
      if (!item) return 0;
      if (!isItemObj(item, id) && isShopsObj(item, id)) {
        // Mercari Shops: ISO文字列(UTC) → Unix秒。評価内訳は取れないので null 固定（待たずに確定）
        const toSec = (s) => { const ms = Date.parse(s); return isFinite(ms) ? Math.floor(ms / 1000) : null; };
        const created = toSec(item.createTime);
        if (created === null) return 0;
        document.documentElement.dataset[ATTR] = JSON.stringify({
          site: 'mercari',
          id: id,
          created: created,
          updated: typeof item.updateTime === 'string' ? toSec(item.updateTime) : null,
          ratings: null,
          name: (typeof item.displayName === 'string' && item.displayName) ? item.displayName : null,
          url: location.href
        });
        return 2;
      }
      const r = item.seller && item.seller.ratings;
      const ratings = (r && num(r.good) !== null && num(r.normal) !== null && num(r.bad) !== null)
        ? { good: r.good, normal: r.normal, bad: r.bad } : null;
      document.documentElement.dataset[ATTR] = JSON.stringify({
        site: 'mercari',
        id: id,
        created: num(item.created),
        updated: num(item.updated),
        ratings: ratings,
        name: (typeof item.name === 'string' && item.name) ? item.name : null, // DOMのタイトルとの照合用（SPA遷移後の取り違え検知）
        url: location.href
      });
      return ratings ? 2 : 1;
    } catch (e) {
      return 0;
    }
  };

  const start = () => {
    try {
      _gen++;
      const gen = _gen;
      if (_timer) { clearTimeout(_timer); _timer = null; }
      clear();
      const id = getUrlId();
      if (!id) return;
      const t0 = Date.now();
      let extra = 0;
      const tick = () => {
        if (gen !== _gen) return;
        const st = tryOnce(id); // 0=未検出, 1=評価なしで書込済み, 2=評価ありで書込済み
        if (st === 2) { _timer = null; return; }
        if (st === 1) {
          // 商品は取れたが評価が未取得: 最大6回(約3秒)だけ追加で待って評価付きで書き直す
          extra++;
          if (extra > 6) { _timer = null; return; }
          _timer = setTimeout(tick, POLL_MS);
          return;
        }
        if (Date.now() - t0 >= POLL_MAX_MS) { _timer = null; return; }
        _timer = setTimeout(tick, POLL_MS);
      };
      tick();
    } catch (e) {}
  };

  try {
    window.addEventListener('us-url-change', () => { setTimeout(start, 0); });
    window.addEventListener('popstate', () => { setTimeout(start, 0); });
    start();
  } catch (e) {}
})();
