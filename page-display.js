// page-display.js — ISOLATED world（content.js と同じ content_scripts エントリ、content.js の後に読み込み）
// 商品ページ上に出品日時・更新日時・出品者評価内訳を表示する（フリマアシストが以前表示していた情報の代替）。
// 値は content.js の共通ヘルパー（URLの商品IDと一致したデータだけ返す）から取得する。取れない値は何も表示しない。
// 挿入ノードは必ず data-us-injected="1" を持ち、FA の id/class/data-testid は使わない（互換読み取りと混同させない）。
(function() {
  'use strict';

  const MARK = 'data-us-injected';
  const DEBOUNCE_MS = 300;
  const MAX_RENDERS_PER_URL = 20; // 無限ループ防止
  let _timer = null;
  let _renders = 0;
  let _lastHref = location.href;

  const host = location.hostname;
  const isMercari = host === 'jp.mercari.com';
  const isPayPay = host === 'paypayfleamarket.yahoo.co.jp';
  const isFril = host === 'item.fril.jp';
  if (!(isMercari || isPayPay || isFril)) return;

  const removeAll = () => {
    try { document.querySelectorAll('[' + MARK + ']').forEach(n => n.remove()); } catch (e) {}
  };

  // "YYYY/MM/DD HH:MM:SS（N日前）" 形式（JST）
  const relText = (d) => {
    const diffMin = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (diffMin < 60) return diffMin + '分前';
    if (diffMin < 60 * 24) return Math.floor(diffMin / 60) + '時間前';
    return Math.floor(diffMin / 1440) + '日前';
  };
  const dateText = (d) => _fmtSlashJST(d) + '（' + relText(d) + '）';

  // ---------- フリマアシスト(FA)自身の表示があれば、こちらは出さない ----------
  const faDates = () => {
    if (isMercari) return !!document.getElementById('created_at');
    if (isPayPay) return !!document.querySelector('.furima-assist-created-at, .furima-assist-updated-at');
    if (isFril) return !!(document.querySelector('tr#created_at') || document.querySelector('.flea-assist-ratings'));
    return false;
  };
  const faRatings = () => isMercari && !!document.getElementById('furima-assist-seller-ratings');
  // FA が後から表示された場合、こちらの該当表示を取り除く
  const pruneForFA = () => {
    if (faDates()) {
      document.querySelectorAll('#us-listed-at[' + MARK + '], #us-updated-at[' + MARK + ']').forEach(n => n.remove());
    }
    if (faRatings()) {
      document.querySelectorAll('#us-seller-ratings[' + MARK + ']').forEach(n => n.remove());
    }
  };

  // ---------- メルカリ ----------
  const findMercariDeliveryRow = () => {
    const h3 = Array.from(document.querySelectorAll('.merDisplayRow h3')).find(h => h.textContent.trim() === '発送までの日数');
    if (h3) return h3.closest('.merDisplayRow');
    const sp = document.querySelector('[data-testid="発送までの日数"]');
    return sp ? sp.closest('.merDisplayRow') : null;
  };

  const makeMercariRow = (base, id, label, value) => {
    const row = base.cloneNode(true);
    row.removeAttribute('data-testid');
    row.querySelectorAll('[data-testid]').forEach(e => e.removeAttribute('data-testid'));
    row.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); // 子孫のidは除去（ルートにだけ自分のidを付ける）
    const h = row.querySelector('h3');
    if (h) h.textContent = label;
    // 値の入る末端 span（元の行は <span data-testid="発送までの日数"> を持つ）。無ければ body 直下に作る
    let v = row.querySelector('span');
    if (!v) { v = document.createElement('span'); (row.querySelector('div[class*="body"]') || row).appendChild(v); }
    v.textContent = value;
    row.id = id;
    row.setAttribute(MARK, '1');
    return row;
  };

  const renderMercari = () => {
    const item = _getMercariPageItem();
    if (!item) return;
    const base = findMercariDeliveryRow();
    if (base && item.created && !faDates() && !document.getElementById('us-listed-at')) {
      let anchor = base;
      const lr = makeMercariRow(base, 'us-listed-at', '出品日時', dateText(new Date(item.created * 1000)));
      anchor.after(lr);
      anchor = lr;
      if (item.updated) {
        anchor.after(makeMercariRow(base, 'us-updated-at', '更新日時', dateText(new Date(item.updated * 1000))));
      }
    }
    if (item.ratings && !faRatings() && !document.getElementById('us-seller-ratings')) {
      const a = document.querySelector('#item-info a[data-location="item_details:seller_info"]');
      const parent = a ? a.parentElement : null;
      if (parent) {
        const r = item.ratings;
        const total = r.good + r.normal + r.bad;
        const div = document.createElement('div');
        div.id = 'us-seller-ratings';
        div.setAttribute(MARK, '1');
        div.style.cssText = 'font-size:14px;color:var(--alias-color-text-primary-default,#333);margin-top:4px;';
        if (total === 0) {
          div.textContent = '評価なし';
        } else {
          const res = _calcRatingResult(r.good, r.bad, r.normal, 0, 'Mercari');
          div.textContent = '良い ' + r.good + ' ・ 普通 ' + r.normal + ' ・ 悪い ' + r.bad + '（悪い評価率 ' + (res.badRate || '0.00%') + '）';
        }
        parent.appendChild(div);
      }
    }
  };

  // 期待するノードが全て揃っているか（揃っていれば再描画しない）
  const mercariComplete = () => {
    const item = _getMercariPageItem();
    if (!item) return true; // データ無し → 何も出さないのが正
    if (!faDates() && item.created && findMercariDeliveryRow() && !document.getElementById('us-listed-at')) return false;
    if (!faDates() && item.created && item.updated && findMercariDeliveryRow() && !document.getElementById('us-updated-at')) return false;
    if (!faRatings() && item.ratings && document.querySelector('#item-info a[data-location="item_details:seller_info"]') && !document.getElementById('us-seller-ratings')) return false;
    return true;
  };

  // ---------- PayPayフリマ ----------
  const renderPayPay = () => {
    const dates = _getPayPayPageDates();
    if (!dates || faDates()) return;
    const tbody = document.querySelector('table[class*="ItemTable__Component"] tbody');
    if (!tbody) return;
    const trs = Array.from(tbody.querySelectorAll('tr')).filter(t => !t.hasAttribute(MARK));
    if (!trs.length) return;
    const base = trs.find(t => t.querySelector('th')?.textContent.trim() === '商品ID') || trs[trs.length - 1];
    const make = (id, label, d) => {
      const tr = base.cloneNode(true);
      tr.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
      const th = tr.querySelector('th span') || tr.querySelector('th');
      const td = tr.querySelector('td span') || tr.querySelector('td');
      if (!th || !td) return null;
      th.textContent = label;
      td.textContent = dateText(d);
      tr.id = id;
      tr.setAttribute(MARK, '1');
      return tr;
    };
    if (dates.created && !document.getElementById('us-listed-at')) {
      const tr = make('us-listed-at', '出品日時', dates.created);
      if (tr) tbody.appendChild(tr);
    }
    if (dates.updated && !document.getElementById('us-updated-at')) {
      const tr = make('us-updated-at', '更新日時', dates.updated);
      if (tr) tbody.appendChild(tr);
    }
  };
  const paypayComplete = () => {
    const dates = _getPayPayPageDates();
    if (!dates || faDates() || !document.querySelector('table[class*="ItemTable__Component"] tbody')) return true;
    if (dates.created && !document.getElementById('us-listed-at')) return false;
    if (dates.updated && !document.getElementById('us-updated-at')) return false;
    return true;
  };

  // ---------- ラクマ ----------
  const renderFril = () => {
    const d = _getFrilEstimatedListedDate();
    if (!d || faDates()) return;
    const table = document.querySelector('table.item__details');
    if (!table || document.getElementById('us-listed-at')) return;
    const tr = document.createElement('tr');
    tr.id = 'us-listed-at';
    tr.setAttribute(MARK, '1');
    const th = document.createElement('th');
    th.textContent = '出品日時（おおよそ）';
    const td = document.createElement('td');
    const jst = _fmtSlashJST(d); // "YYYY/MM/DD HH:00:00"（時間単位に切り下げ済み）
    td.textContent = jst.slice(0, 13) + ':00頃（' + relText(d) + '）';
    tr.appendChild(th);
    tr.appendChild(td);
    (table.tBodies[0] || table).appendChild(tr);
  };
  const frilComplete = () => {
    if (!_getFrilEstimatedListedDate() || faDates() || !document.querySelector('table.item__details')) return true;
    return !!document.getElementById('us-listed-at');
  };

  // ---------- 共通制御 ----------
  const doRender = () => {
    try {
      if (isMercari) renderMercari();
      else if (isPayPay) renderPayPay();
      else if (isFril) renderFril();
    } catch (e) {}
  };
  const isComplete = () => {
    try {
      if (isMercari) return mercariComplete();
      if (isPayPay) return paypayComplete();
      return frilComplete();
    } catch (e) { return true; }
  };

  // 欠けているものがあるときだけ再描画（自分の挿入による再発火は isComplete=true で止まる）
  const ensure = () => {
    _timer = null;
    try {
      if (location.href !== _lastHref) { _lastHref = location.href; _renders = 0; removeAll(); }
      pruneForFA();
      if (isComplete()) return;
      if (_renders >= MAX_RENDERS_PER_URL) return;
      _renders++;
      removeAll(); // 重複・古い表示を残さない
      doRender();
    } catch (e) {}
  };
  const schedule = () => {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(ensure, DEBOUNCE_MS);
  };

  // URL 変化: 即座に古い表示を消し、データが揃ってから描画（一致しない古いデータは helper が null を返す）
  const onNav = () => {
    try {
      // URLが実際に変わったときだけ消去・カウンタリセット（同一URLのreplaceStateでちらつかせない）
      if (location.href !== _lastHref) { removeAll(); _renders = 0; _lastHref = location.href; }
    } catch (e) {}
    schedule();
  };

  try {
    // spa-watcher.js(MAIN) の us-url-change / popstate は DOM イベントとして両 world に届く
    window.addEventListener('us-url-change', onNav);
    window.addEventListener('popstate', onNav);
    // メルカリ: page-data-bridge.js のデータ書き込み/更新を検知
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-us-page-item'] });
    // React 等の再描画で挿入行が消えた場合の再挿入（body 全体を監視、debounce + 回数上限で保護）
    const attach = () => {
      if (!document.body) { setTimeout(attach, 200); return; }
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    };
    attach();
    schedule();
  } catch (e) {}
})();
