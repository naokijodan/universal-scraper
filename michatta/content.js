// フリマ閲覧済みチェッカー
(function() {
  'use strict';

  // ストレージ初期化待ち
  let storageReady = false;
  let pendingOperations = [];

  // ストレージ操作をラップ（初期化完了後に実行）
  function whenStorageReady(fn) {
    if (storageReady) {
      return fn();
    }
    return new Promise((resolve) => {
      pendingOperations.push(() => resolve(fn()));
    });
  }

  // 会員機能が解除されているか確認
  async function isPremiumUnlocked() {
    return whenStorageReady(() => window.MichattaStorage.isPremiumUnlocked());
  }

  // デフォルトのアラート設定
  const DEFAULT_ALERT_SETTINGS = {
    ratings: 100,
    badRate: 5,
    listedDays: 180,
    updatedDays: 90,
    shipping47: false,
    shipping8: false
  };

  // チェック用タブかどうか（_mcheck=1 パラメータがあるか）
  const isCheckTab = window.location.search.includes('_mcheck=1');

  // 表示中の詳細パネル（複数対応）
  let detailPanels = new Map(); // itemId -> panel

  // マーク済み itemId を記憶（MutationObserver による重複マーク防止）
  // URL変更時にクリアされる（SPA対応、実際のクリア用タイマーは init() 内で enableMichatta 確認後に開始）
  const markedItemIds = new Set();

  // アラート設定を取得
  async function getAlertSettings() {
    return whenStorageReady(() => window.MichattaStorage.getAlertSettings());
  }

  // アラート判定
  function checkAlerts(details, settings) {
    const alerts = [];

    // 評価件数チェック（設定値以下でアラート）
    if (settings.ratings > 0 && details.ratings <= settings.ratings) {
      alerts.push({ type: 'ratings', message: `評価${details.ratings}件` });
    }

    // 悪い評価の割合チェック（設定値以上でアラート）
    if (settings.badRate > 0 && details.badRatePercent >= settings.badRate) {
      alerts.push({ type: 'badRate', message: `悪い評価${details.badRatePercent.toFixed(1)}%` });
    }

    // 出品経過日数チェック（設定値以上でアラート）
    if (settings.listedDays > 0 && details.listedDays !== undefined && details.listedDays >= settings.listedDays) {
      alerts.push({ type: 'listedDays', message: `出品から${details.listedDays}日経過` });
    }

    // 更新経過日数チェック（設定値以上でアラート）
    if (settings.updatedDays > 0 && details.updatedDays !== undefined && details.updatedDays >= settings.updatedDays) {
      alerts.push({ type: 'updatedDays', message: `更新から${details.updatedDays}日経過` });
    }

    // 発送日数チェック（4〜7日）
    if (settings.shipping47 && details.shippingDays) {
      if (details.shippingDays.includes('4') && details.shippingDays.includes('7')) {
        alerts.push({ type: 'shipping', message: '発送4〜7日' });
      }
    }

    // 発送日数チェック（8日以上）
    if (settings.shipping8 && details.shippingDays) {
      // 「8日以上」や数値が8以上の場合
      if (details.shippingDays.includes('8') || /[89]\d*/.test(details.shippingDays)) {
        alerts.push({ type: 'shipping', message: '発送8日以上' });
      }
    }

    return alerts;
  }

  // 現在のサイトを判定
  function getCurrentSite() {
    const host = window.location.hostname;
    if (host.includes('mercari-shops.com')) return 'mercari';
    if (host.includes('mercari.com')) return 'mercari';
    if (host.includes('fril.jp')) return 'rakuma';
    if (host.includes('rakuten.co.jp')) return 'rakuten';
    if (host.includes('paypayfleamarket.yahoo.co.jp')) return 'paypay';
    if (host.includes('shopping.yahoo.co.jp')) return 'yshopping';
    if (host.includes('yahoo.co.jp')) return 'yahoo';
    if (host.includes('netmall.hardoff.co.jp')) return 'hardoff';
    if (host.includes('amazon.co.jp')) return 'amazon';
    return null;
  }

  // 商品IDをURLから抽出（各サイト対応）
  function extractItemId(url) {
    // PayPayフリマ: paypayfleamarket.yahoo.co.jp/item/z491889774
    // ※メルカリより先に判定（/item/パターンが重複するため）
    const paypayMatch = url.match(/paypayfleamarket\.yahoo\.co\.jp\/item\/([a-zA-Z0-9]+)/);
    if (paypayMatch) return 'paypay_' + paypayMatch[1];

    // メルカリ通常: /item/m12345678901（IDのみ）※相対パス・フルURL両対応
    const mercariMatch = url.match(/\/item\/([a-zA-Z0-9]+)/);
    if (mercariMatch && !url.includes('rakuten.co.jp') && !url.includes('yahoo.co.jp')) return mercariMatch[1];

    // メルカリショップ: /shops/product/xxxxx（shop_プレフィックス）
    const mercariShopMatch = url.match(/\/shops\/product\/([a-zA-Z0-9]+)/);
    if (mercariShopMatch) return 'shop_' + mercariShopMatch[1];

    // ラクマ: item.fril.jp/xxxxx（IDのみ）
    const rakumaMatch = url.match(/item\.fril\.jp\/([a-zA-Z0-9]+)/);
    if (rakumaMatch) return rakumaMatch[1];

    // 楽天市場: item.rakuten.co.jp/shop/product/（URLパス全体）
    const rakutenMatch = url.match(/item\.rakuten\.co\.jp\/([^?#]+)/);
    if (rakutenMatch) return 'rakuten_' + rakutenMatch[1].replace(/\/$/, '');

    // ヤフショ（Yahoo!ショッピング）: store.shopping.yahoo.co.jp/{store_id}/{product_id}.html
    // ※パンくず（カテゴリページ）と区別するため .html 必須
    // ※ヤフオク判定より先に評価する（host が yahoo.co.jp で被るため）
    const yshoppingMatch = url.match(/store\.shopping\.yahoo\.co\.jp\/([^/]+)\/([^/?#]+)\.html(?:[?#]|$)/);
    if (yshoppingMatch) {
      return 'yshopping_' + yshoppingMatch[1] + '_' + yshoppingMatch[2];
    }

    // ヤフオク: page.auctions.yahoo.co.jp/jp/auction/xxxxx
    // ※IDがzで始まる場合はPayPayフリマの商品（ヤフオク検索結果に混在表示される）
    const yahooAuctionMatch = url.match(/page\.auctions\.yahoo\.co\.jp\/jp\/auction\/([a-zA-Z0-9]+)/);
    if (yahooAuctionMatch) {
      const id = yahooAuctionMatch[1];
      return id.startsWith('z') ? 'paypay_' + id : 'yahoo_' + id;
    }

    // ヤフオク: /auction/xxxxx（相対パス）
    const yahooAuctionRelMatch = url.match(/\/auction\/([a-zA-Z0-9]+)/);
    if (yahooAuctionRelMatch && url.includes('yahoo')) {
      const id = yahooAuctionRelMatch[1];
      return id.startsWith('z') ? 'paypay_' + id : 'yahoo_' + id;
    }

    // ヤフオク検索結果のリンク: closedsearch.auctions.yahoo.co.jp や auctions.yahoo.co.jp
    const yahooSearchMatch = url.match(/auctions\.yahoo\.co\.jp.*\/([a-zA-Z0-9]{10,})/);
    if (yahooSearchMatch) {
      const id = yahooSearchMatch[1];
      return id.startsWith('z') ? 'paypay_' + id : 'yahoo_' + id;
    }

    // オフモール（ハードオフ）: netmall.hardoff.co.jp/product/[数字]/
    const hardoffMatch = url.match(/netmall\.hardoff\.co\.jp\/product\/([0-9]+)/);
    if (hardoffMatch) return 'hardoff_' + hardoffMatch[1];

    // Amazon: /dp/[ASIN] または /gp/product/[ASIN]
    // ASIN は英数字10桁（例: B08N5WRWNW）
    const amazonMatch = url.match(/amazon\.co\.jp\/(?:.*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
    if (amazonMatch) return 'amazon_' + amazonMatch[1].toUpperCase();

    // Amazon スポンサーリンク: /sspa/click?...&url=...%2Fdp%2F[ASIN]... (URLエンコード形式)
    const amazonSpaMatch = url.match(/%2[Ff](?:dp|gp%2[Ff]product)%2[Ff]([A-Z0-9]{10})/i);
    if (amazonSpaMatch) return 'amazon_' + amazonSpaMatch[1].toUpperCase();

    return null;
  }

  // 閲覧済み商品を取得
  async function getViewedItems() {
    return whenStorageReady(() => window.MichattaStorage.getViewedItems());
  }

  // 商品を閲覧済みとして保存（上限なし）
  async function saveViewedItem(itemId) {
    return whenStorageReady(() => window.MichattaStorage.saveViewedItem(itemId));
  }

  // 商品ページの場合、閲覧記録を保存（チェック用タブでは保存しない）
  async function checkAndSaveCurrentPage() {
    // チェック用タブでは閲覧記録を保存しない
    if (isCheckTab) {
      console.log('[みちゃった君] チェック用タブのため閲覧記録をスキップ');
      return;
    }

    const itemId = extractItemId(window.location.href);
    if (itemId) {
      // 既に閲覧済みかチェックしてバッジを表示
      const viewedItems = await getViewedItems();
      if (viewedItems[itemId]) {
        showBadgeOnProductPage(viewedItems[itemId]);
      }
      // 閲覧記録を保存
      saveViewedItem(itemId);
    }
  }

  // 商品ページでフローティングバッジを表示
  function showBadgeOnProductPage(viewedTimestamp) {
    // チェック用タブではバッジを表示しない
    if (isCheckTab) return;

    // 既にバッジがあれば何もしない
    if (document.querySelector('.mercari-viewed-page-badge')) {
      return;
    }

    const badge = document.createElement('div');
    badge.className = 'mercari-viewed-page-badge';

    const viewedDate = new Date(viewedTimestamp);
    badge.innerHTML = `以前閲覧した商品です<span class="mercari-viewed-date">（${viewedDate.toLocaleDateString('ja-JP')} ${viewedDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}）</span><button class="mercari-viewed-close">✕</button>`;

    document.body.appendChild(badge);

    // 閉じるボタンのイベント
    badge.querySelector('.mercari-viewed-close').addEventListener('click', () => {
      badge.remove();
    });
  }

  // 商品ページかどうかを判定
  function isProductPage() {
    const url = window.location.href;
    // メルカリ
    if (/jp\.mercari\.com\/item\//.test(url)) return true;
    if (/jp\.mercari\.com\/shops\/product\//.test(url)) return true;
    // ラクマ
    if (/item\.fril\.jp\/[a-zA-Z0-9]+/.test(url)) return true;
    // 楽天市場
    if (/item\.rakuten\.co\.jp\//.test(url)) return true;
    // ヤフオク
    if (/page\.auctions\.yahoo\.co\.jp\/jp\/auction\//.test(url)) return true;
    // PayPayフリマ
    if (/paypayfleamarket\.yahoo\.co\.jp\/item\//.test(url)) return true;
    // オフモール
    if (/netmall\.hardoff\.co\.jp\/product\/[0-9]+/.test(url)) return true;
    // ヤフショ（store.shopping.yahoo.co.jp/{store_id}/{product_id}.html）
    if (/store\.shopping\.yahoo\.co\.jp\/[^/]+\/[^/?#]+\.html/.test(url)) return true;
    // Amazon商品ページ（/dp/ASIN または /gp/product/ASIN）
    if (/amazon\.co\.jp\/(?:.*\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(url)) return true;
    return false;
  }

  // 一覧用バッジを表示しないページかどうかを判定
  function isExcludedPage() {
    const url = window.location.href;
    // 取引ページ
    if (/jp\.mercari\.com\/transaction\//.test(url)) return true;
    // お知らせページ
    if (/jp\.mercari\.com\/notifications/.test(url)) return true;
    // マイページ
    if (/jp\.mercari\.com\/mypage\//.test(url)) return true;
    return false;
  }

  let markInProgress = false;
  async function markViewedItemsInList() {
    if (markInProgress) return;
    markInProgress = true;
    try {
      // チェック用タブや除外ページでは実行しない
      if (isCheckTab || isExcludedPage()) {
        return;
      }

      // ヤフショ商品ページ（store.shopping.yahoo.co.jp）ではマークを表示しない
      // パンくず・カテゴリリンクへの誤マークを防ぐため
      if (getCurrentSite() === 'yshopping' && window.location.hostname.startsWith('store.')) {
        return;
      }

      // 現在のページの商品IDを取得（商品ページの場合、自分自身にはバッジを付けない）
      const currentItemId = extractItemId(window.location.href);

      // 商品リンクを取得（各サイト対応）
      const productLinks = document.querySelectorAll(
        'a[href*="/item/"], a[href*="/shops/product/"], ' +
        'a[href*="item.fril.jp/"], a[href*="item.rakuten.co.jp/"], ' +
        'a[href*="page.auctions.yahoo.co.jp/jp/auction/"], a[href*="/auction/"], ' +
        'a[href*="paypayfleamarket.yahoo.co.jp/item/"], ' +
        'a[href*="netmall.hardoff.co.jp/product/"], ' +
        'a[href*="store.shopping.yahoo.co.jp/"], ' +
        'a[href*="/dp/"], a[href*="/gp/product/"], a[href*="/sspa/click"]'
      );

      // ページ内の商品IDリストを作成（重複排除）
      const itemIds = [];
      const linkMap = new Map();
      productLinks.forEach((link) => {
        const itemId = extractItemId(link.href);
        if (itemId && itemId !== currentItemId) {
          if (!linkMap.has(itemId)) {
            linkMap.set(itemId, []);
            itemIds.push(itemId);
          }
          linkMap.get(itemId).push(link);
        }
      });

      if (itemIds.length === 0) return;

      // バッチ取得（ページ内のIDだけを問い合わせ）
      let viewedItems;
      try {
        viewedItems = await whenStorageReady(() => window.MichattaStorage.getViewedItemsBatch(itemIds));
      } catch (error) {
        console.error('[みちゃった君] バッチ取得エラー:', error);
        return;
      }

      // PayPayフリマ検索ページ判定
      const isPayPaySearch = window.location.hostname.includes('paypayfleamarket.yahoo.co.jp') &&
                             window.location.pathname.includes('/search/');
      // 1カードに複数リンク（画像 + タイトル等）が存在し重複マークが起きるサイト
      // → リンク自体をカードとして扱い、最初の1リンクだけマーク
      const isYShopping = getCurrentSite() === 'yshopping';
      const isRakuma = getCurrentSite() === 'rakuma';
      const isRakuten = getCurrentSite() === 'rakuten';
      const isAmazon = getCurrentSite() === 'amazon';
      const useLinkAsCard = isPayPaySearch || isYShopping || isRakuma || isRakuten || isAmazon;
      const needsLinkDedup = isYShopping || isRakuma || isRakuten || isAmazon;

      // 閲覧済みの商品にバッジを追加
      for (const [itemId, links] of linkMap) {
        if (!viewedItems[itemId]) continue;

        // 1カードに画像リンク+タイトルリンクの2つあるサイトは最初の1つだけマーク
        const linksToProcess = needsLinkDedup ? [links[0]] : links;

        // ヤフショ・ラクマ等: モジュールレベルで既にマーク済みのitemIdはスキップ
        // （MutationObserver による複数回呼び出しで別要素に重複マークされるのを防ぐ）
        if (needsLinkDedup && markedItemIds.has(itemId)) {
          continue;
        }

        for (const link of linksToProcess) {
          let card;
          if (useLinkAsCard) {
            card = link;
          } else {
            card = link.closest('[data-testid="item-cell"]') ||
                   link.closest('[data-testid="product-box"]') ||
                   link.closest('li.Product') ||
                   link.closest('.Product') ||
                   link.closest('.cf') ||
                   link.closest('li[class*="item"]') ||
                   link.closest('li[class*="product"]') ||
                   link.closest('article') ||
                   link.closest('li') ||
                   link.parentElement;
          }

          if (card && !card.classList.contains('mercari-viewed-marked')) {
            card.classList.add('mercari-viewed-marked');
            card.setAttribute('data-mercari-viewed-id', itemId);

            const badge = document.createElement('div');
            badge.className = 'mercari-viewed-badge';
            badge.textContent = '閲覧済み';

            const viewedDate = new Date(viewedItems[itemId]);
            badge.title = `閲覧日時: ${viewedDate.toLocaleString('ja-JP')}`;

            if (getComputedStyle(card).position === 'static') {
              card.style.position = 'relative';
            }

            card.appendChild(badge);

            // モジュールレベルで記憶（次回以降スキップ）
            if (needsLinkDedup) {
              markedItemIds.add(itemId);
            }
          }
        }

        // dedup対象サイト: 同じitemIdの重複マークを掃除（最初の1つを残して他を削除）
        if (needsLinkDedup) {
          const sameIdMarked = document.querySelectorAll(`[data-mercari-viewed-id="${itemId}"]`);
          if (sameIdMarked.length > 1) {
            Array.from(sameIdMarked).slice(1).forEach((el) => {
              el.querySelectorAll('.mercari-viewed-badge').forEach((b) => b.remove());
              el.classList.remove('mercari-viewed-marked');
              el.removeAttribute('data-mercari-viewed-id');
            });
          }
        }
      }
    } finally {
      markInProgress = false;
    }
  }

  // MutationObserverで動的に追加される商品も監視
  function observeDOM() {
    // チェック用タブでは監視しない
    if (isCheckTab) return;

    let debounceTimer = null;

    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          shouldCheck = true;
        }
      });
      if (shouldCheck) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          markViewedItemsInList();
          addOpenButtons();
        }, 250);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ==============================
  // 商品詳細取得（background script経由）
  // ==============================

  // background scriptに商品情報取得を依頼
  async function fetchItemDetailsViaBackground(itemId, itemUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'fetchItemDetails', itemId, itemUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success) {
            resolve(response.details);
          } else {
            reject(new Error(response?.error || '取得失敗'));
          }
        }
      );
    });
  }

  // 商品ページでDOMから情報を取得（チェック用タブで実行される）
  function extractItemDetailsFromDOM() {
    try {
      console.log('[みちゃった君] DOM解析開始');

      // ページ全体のテキストを取得
      const bodyText = document.body.innerText || '';
      console.log('[みちゃった君] bodyText長さ:', bodyText.length);

      // メルカリショップかどうか判定
      const isShop = window.location.pathname.includes('/shops/product/');
      console.log('[みちゃった君] ショップモード:', isShop);

      let ratings = 0;
      let goodRatings = 0;
      let badRatings = 0;

      if (isShop) {
        // ===== メルカリショップの評価取得 =====
        // data-testid="shops-information" または "shops-profile-link" から取得
        // 形式: "ショップ名\n\n33365\n\nメルカリShops"
        const shopsInfoEl = document.querySelector('[data-testid="shops-information"]') ||
                           document.querySelector('[data-testid="shops-profile-link"]');
        console.log('[みちゃった君] shops-information:', shopsInfoEl ? shopsInfoEl.innerText.substring(0, 100) : 'なし');

        if (shopsInfoEl) {
          const shopsText = shopsInfoEl.innerText || '';
          const allNumbers = shopsText.match(/\d+/g);
          console.log('[みちゃった君] ショップ数値一覧:', allNumbers);

          if (allNumbers && allNumbers.length >= 1) {
            // 最大の数値を評価数とする（ショップ名に数字が含まれる場合への対策）
            const nums = allNumbers.map(n => parseInt(n)).filter(n => !Number.isNaN(n));
            ratings = Math.max(...nums);
            console.log('[みちゃった君] ショップ評価数:', ratings);
          }
        }

        // フォールバック: ページ全体から探す
        if (ratings === 0) {
          const shopsMatch = bodyText.match(/(\d+)\s*メルカリShops/);
          if (shopsMatch) {
            ratings = parseInt(shopsMatch[1], 10);
            console.log('[みちゃった君] メルカリShops前から取得:', ratings);
          }
        }
      } else {
        // ===== 通常メルカリの評価取得 =====
        // パターン1: data-testid="seller-link" から取得
        // 形式: "出品者名\n\n732\n 730  2\n本人確認済"
        // 732=合計, 730=良い, 2=悪い
        const sellerLink = document.querySelector('[data-testid="seller-link"]');
        console.log('[みちゃった君] seller-link:', sellerLink ? sellerLink.innerText.substring(0, 100) : 'なし');

        if (sellerLink) {
          const sellerText = sellerLink.innerText || '';
          const allNumbers = sellerText.match(/\d+/g);
          console.log('[みちゃった君] seller-link数値一覧:', allNumbers);

          if (allNumbers && allNumbers.length >= 1) {
            // 最初の数値が合計評価数
            ratings = parseInt(allNumbers[0], 10);
            console.log('[みちゃった君] seller-linkから評価取得:', ratings);

            // 良い評価と悪い評価を取得（2番目と3番目の数値）
            if (allNumbers.length >= 3) {
              goodRatings = parseInt(allNumbers[1], 10);
              badRatings = parseInt(allNumbers[2], 10);
              console.log('[みちゃった君] 良い:', goodRatings, '悪い:', badRatings);
            }
          }
        }

        // パターン2: 「良い XXX」のパターン（評価の良い件数）
        if (ratings === 0) {
          const goodMatch = bodyText.match(/良い\s*(\d+)/);
          if (goodMatch) {
            ratings = parseInt(goodMatch[1], 10);
            console.log('[みちゃった君] 良い評価から取得:', ratings);
          }
        }

        // パターン3: 数字だけが並んでいるパターン（評価合計）
        if (ratings === 0) {
          const allRatingsMatch = bodyText.match(/(\d+)\s*良い/);
          if (allRatingsMatch) {
            ratings = parseInt(allRatingsMatch[1], 10);
            console.log('[みちゃった君] 評価合計から取得:', ratings);
          }
        }
      }

      // ===== 発送日数を取得 =====
      let shippingDays = '不明';

      // パターン1: data-testidから
      const shippingEl = document.querySelector('[data-testid="発送までの日数"]');
      console.log('[みちゃった君] 発送日数要素:', shippingEl ? shippingEl.textContent : 'なし');

      if (shippingEl) {
        shippingDays = shippingEl.textContent.trim();
      }

      // パターン2: ページ全体から探す
      if (shippingDays === '不明') {
        const patterns = [
          /(1[〜~]2日で発送)/,
          /(2[〜~]3日で発送)/,
          /(4[〜~]7日で発送)/,
          /(1〜2日|2〜3日|4〜7日)/
        ];
        for (const pattern of patterns) {
          const match = bodyText.match(pattern);
          if (match) {
            shippingDays = match[1];
            break;
          }
        }
      }

      // ===== 出品日・更新日からの日数を取得 =====
      let listedDays = undefined;
      let updatedDays = undefined;
      let listedText = '';
      let updatedText = '';

      // 時間表現をパース（「X日前」「X時間前」「X分前」「Xか月前」「X年前」など）
      function parseTimeAgo(text) {
        // 年前
        const yearMatch = text.match(/(\d+)\s*年前/);
        if (yearMatch) return { days: parseInt(yearMatch[1]) * 365, text: `${yearMatch[1]}年前` };

        // ヶ月/か月前
        const monthMatch = text.match(/(\d+)\s*[かヶケ]?月前/);
        if (monthMatch) return { days: parseInt(monthMatch[1]) * 30, text: `${monthMatch[1]}ヶ月前` };

        // 日前
        const dayMatch = text.match(/(\d+)\s*日前/);
        if (dayMatch) return { days: parseInt(dayMatch[1]), text: `${dayMatch[1]}日前` };

        // 時間前
        const hourMatch = text.match(/(\d+)\s*時間前/);
        if (hourMatch) return { days: 0, text: `${hourMatch[1]}時間前` };

        // 分前
        const minMatch = text.match(/(\d+)\s*分前/);
        if (minMatch) return { days: 0, text: `${minMatch[1]}分前` };

        return null;
      }

      // メルカリの表示形式を複数パターンで対応
      // パターン1: 「出品日」の後に時間表現
      // パターン2: 時間表現の後に「出品日」
      // パターン3: 「出品」と時間表現が近くにある

      // デバッグ用: 時間表現を含む部分を確認
      const timeExpressions = bodyText.match(/\d+(?:年|[かヶケ]?月|日|時間|分)前/g);
      console.log('[みちゃった君] 時間表現一覧:', timeExpressions);

      // 出品日時パターン（フリマアシスト形式: 出品日時\n日付\nXX日前）
      const listedMatch = bodyText.match(/出品日時[\s\S]{0,50}?(\d+(?:年|[かヶケ]?月|日|時間|分)前)/);
      if (listedMatch) {
        const parsed = parseTimeAgo(listedMatch[1]);
        if (parsed) {
          listedDays = parsed.days;
          listedText = parsed.text;
          console.log('[みちゃった君] 出品日時:', listedText);
        }
      }

      // 更新日時パターン（フリマアシスト形式: 更新日時\n日付\nXX日前）
      const updatedMatch = bodyText.match(/更新日時[\s\S]{0,50}?(\d+(?:年|[かヶケ]?月|日|時間|分)前)/);
      if (updatedMatch) {
        const parsed = parseTimeAgo(updatedMatch[1]);
        if (parsed) {
          updatedDays = parsed.days;
          updatedText = parsed.text;
          console.log('[みちゃった君] 更新日時:', updatedText);
        }
      }

      // 悪い評価の割合を計算
      const badRatePercent = ratings > 0 ? (badRatings / ratings * 100) : 0;

      console.log('[みちゃった君] 取得結果 - 評価:', ratings, '良い:', goodRatings, '悪い:', badRatings, '悪い割合:', badRatePercent.toFixed(1) + '%', '発送:', shippingDays, '出品:', listedDays, '更新:', updatedDays);

      // 売り切れ判定
      const isSold = bodyText.includes('売り切れました') ||
                     bodyText.includes('この商品は売り切れです') ||
                     bodyText.includes('SOLD OUT');

      return {
        ratings,
        goodRatings,
        badRatings,
        badRatePercent,
        shippingDays,
        listedDays,
        updatedDays,
        listedText,
        updatedText,
        status: isSold ? 'sold_out' : 'on_sale'
      };
    } catch (e) {
      console.error('[みちゃった君] DOM解析エラー:', e);
      return null;
    }
  }

  // ==============================
  // 詳細パネル表示
  // ==============================

  // 詳細パネルを表示（複数同時対応）
  function showDetailPanel(itemId, itemUrl, buttonElement) {
    // 同じ商品のパネルが既にあれば閉じる
    if (detailPanels.has(itemId)) {
      closeDetailPanel(itemId);
      return;
    }

    // ローディングパネルを表示
    const panel = document.createElement('div');
    panel.className = 'mercari-detail-panel';
    panel.dataset.itemId = itemId;
    panel.innerHTML = `
      <div class="mercari-detail-loading">
        <div class="mercari-detail-spinner"></div>
        <span>読み込み中...</span>
      </div>
    `;

    // ボタンの位置を基準に配置
    const rect = buttonElement.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.left = `${rect.left}px`;

    document.body.appendChild(panel);
    detailPanels.set(itemId, panel);

    // 画面外にはみ出さないよう調整
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.right > window.innerWidth - 16) {
      panel.style.left = `${window.innerWidth - panelRect.width - 16}px`;
    }
    if (panelRect.bottom > window.innerHeight - 16) {
      panel.style.top = `${rect.top - panelRect.height - 8}px`;
    }

    // 商品情報を取得（background script経由）
    fetchItemDetailsViaBackground(itemId, itemUrl)
      .then(async (details) => {
        // パネルが既に閉じられていたら何もしない
        if (!detailPanels.has(itemId)) return;

        if (!details) {
          throw new Error('詳細なし');
        }

        // アラート設定を取得してチェック
        const alertSettings = await getAlertSettings();
        const alerts = checkAlerts(details, alertSettings);

        // 売り切れチェック
        const isSold = details.status === 'sold_out' || details.status === 'trading';
        const soldBadge = isSold ? '<span class="mercari-detail-sold">SOLD</span>' : '';

        // 出品日・更新日の表示
        let dateInfo = '';
        if (details.listedText || details.updatedText) {
          dateInfo = '<div class="mercari-detail-row">';
          if (details.listedText) {
            dateInfo += `<span class="mercari-detail-label">出品</span><span class="mercari-detail-value">${escapeHtml(details.listedText)}</span>`;
          }
          if (details.updatedText) {
            dateInfo += ` <span class="mercari-detail-label">更新</span><span class="mercari-detail-value">${escapeHtml(details.updatedText)}</span>`;
          }
          dateInfo += '</div>';
        }

        // 悪い評価の表示
        let badRateInfo = '';
        if (details.badRatings > 0) {
          badRateInfo = `<div class="mercari-detail-row">
            <span class="mercari-detail-label">悪い評価</span>
            <span class="mercari-detail-value">${details.badRatings}件 (${details.badRatePercent.toFixed(1)}%)</span>
          </div>`;
        }

        // アラート表示
        let alertsHtml = '';
        if (alerts.length > 0) {
          alertsHtml = '<div class="mercari-detail-alerts">';
          alerts.forEach(alert => {
            alertsHtml += `<span class="mercari-detail-alert">${escapeHtml(alert.message)}</span>`;
          });
          alertsHtml += '</div>';
        }

        panel.innerHTML = `
          <div class="mercari-detail-content">
            <div class="mercari-detail-header">
              <span class="mercari-detail-title">商品情報</span>
              ${soldBadge}
              <button class="mercari-detail-close-x" data-item-id="${itemId}">✕</button>
            </div>
            ${alertsHtml}
            <div class="mercari-detail-body">
              <div class="mercari-detail-row">
                <span class="mercari-detail-label">評価件数</span>
                <span class="mercari-detail-value mercari-detail-ratings-count">${details.ratings}件</span>
              </div>
              ${badRateInfo}
              <div class="mercari-detail-row">
                <span class="mercari-detail-label">発送日数</span>
                <span class="mercari-detail-value">${escapeHtml(details.shippingDays)}</span>
              </div>
              ${dateInfo}
            </div>
            <div class="mercari-detail-footer">
              <button class="mercari-detail-open-btn" ${isSold ? 'disabled' : ''}>
                ${isSold ? '売り切れ' : '開く'}
              </button>
            </div>
          </div>
        `;

        // 閉じるボタン
        panel.querySelector('.mercari-detail-close-x').addEventListener('click', (e) => {
          closeDetailPanel(e.target.dataset.itemId);
        });

        // 開くボタン（バックグラウンドで新しいタブを開く＆パネルを閉じる）
        if (!isSold) {
          panel.querySelector('.mercari-detail-open-btn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openInBackground', url: itemUrl });
            closeDetailPanel(itemId);
          });
        }

        // ドラッグで移動できるようにする
        makeDraggable(panel, panel.querySelector('.mercari-detail-header'));
      })
      .catch(error => {
        console.error('[みちゃった君] エラー:', error);
        if (!detailPanels.has(itemId)) return;

        panel.innerHTML = `
          <div class="mercari-detail-error">
            <span>情報を取得できませんでした</span>
            <button class="mercari-detail-close-btn" data-item-id="${itemId}">閉じる</button>
          </div>
        `;
        panel.querySelector('.mercari-detail-close-btn').addEventListener('click', (e) => {
          closeDetailPanel(e.target.dataset.itemId);
        });
      });
  }

  // 詳細パネルを閉じる（特定のパネルまたは全て）
  function closeDetailPanel(itemId) {
    if (itemId) {
      const panel = detailPanels.get(itemId);
      if (panel) {
        panel.remove();
        detailPanels.delete(itemId);
      }
    } else {
      // 全てのパネルを閉じる
      detailPanels.forEach(panel => panel.remove());
      detailPanels.clear();
    }
  }

  // 全パネルを閉じる（ページ遷移時など）
  function closeAllPanels() {
    closeDetailPanel();
  }

  // HTMLエスケープ
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // パネルをドラッグ可能にする
  function makeDraggable(panel, handle) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', (e) => {
      // 閉じるボタンをクリックした場合は無視
      if (e.target.classList.contains('mercari-detail-close-x')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = panel.offsetLeft;
      initialTop = panel.offsetTop;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      panel.style.left = `${initialLeft + dx}px`;
      panel.style.top = `${initialTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // 商品カードに開くボタンを追加
  async function addOpenButtons() {
    // チェック用タブでは追加しない
    if (isCheckTab) return;

    const site = getCurrentSite();
    // 開くボタン対応サイト（段階的に拡張）
    if (site !== 'mercari' && site !== 'hardoff' && site !== 'yshopping' && site !== 'paypay' && site !== 'yahoo' && site !== 'rakuma' && site !== 'rakuten' && site !== 'amazon') return;
    if (isExcludedPage()) return;

    // 現在のページの商品ID（商品ページの場合、自分自身にはボタンを付けない）
    const currentItemId = extractItemId(window.location.href);

    // サイト別に商品リンクを取得
    let productLinks;
    if (site === 'mercari') {
      productLinks = document.querySelectorAll(
        'a[href*="/item/"], a[href*="/shops/product/"]'
      );
    } else if (site === 'hardoff') {
      productLinks = document.querySelectorAll(
        'a[href*="netmall.hardoff.co.jp/product/"], a[href^="/product/"]'
      );
    } else if (site === 'yshopping') {
      // 商品ページ（store.shopping.yahoo.co.jp）ではボタンを表示しない
      // 商品ページにはパンくず・カテゴリ・関連店舗リンクが多数あり誤誘導の原因になるため
      if (window.location.hostname.startsWith('store.')) return;
      productLinks = document.querySelectorAll(
        'a[href*="store.shopping.yahoo.co.jp/"]'
      );
    } else if (site === 'paypay') {
      // PayPayフリマは検索ページのみ表示（商品ページは関連商品で誤誘導の可能性があるため）
      if (!window.location.pathname.includes('/search/')) return;
      // 相対パス（/item/xxx）と絶対URLの両方に対応
      productLinks = document.querySelectorAll(
        'a[href^="/item/"], a[href*="paypayfleamarket.yahoo.co.jp/item/"]'
      );
    } else if (site === 'yahoo') {
      // ヤフオク商品ページ（page.auctions.yahoo.co.jp）ではボタンを表示しない
      // 入札・関連オークションリンクへの誤誘導を防ぐ
      if (window.location.hostname.includes('page.auctions.yahoo.co.jp')) return;
      // 検索結果・カテゴリページの商品リンク（既存マーク表示と同じセレクタ）
      productLinks = document.querySelectorAll(
        'a[href*="page.auctions.yahoo.co.jp/jp/auction/"], a[href*="/auction/"]'
      );
    } else if (site === 'rakuma') {
      // ラクマ商品ページ（item.fril.jp/xxxxx）ではボタンを表示しない
      // 関連商品リンクへの誤誘導を防ぐ
      if (window.location.hostname.includes('item.fril.jp')) return;
      // 検索結果・カテゴリページの商品リンク（既存マーク表示と同じセレクタ）
      productLinks = document.querySelectorAll(
        'a[href*="item.fril.jp/"]'
      );
    } else if (site === 'rakuten') {
      // 楽天市場の商品ページ（item.rakuten.co.jp）ではボタンを表示しない
      // 関連商品・店舗リンクへの誤誘導を防ぐ
      if (window.location.hostname.includes('item.rakuten.co.jp')) return;
      // 検索結果ページの商品リンク（既存マーク表示と同じセレクタ）
      productLinks = document.querySelectorAll(
        'a[href*="item.rakuten.co.jp/"]'
      );
    } else if (site === 'amazon') {
      // Amazon商品ページ（/dp/ASIN または /gp/product/ASIN）ではボタンを表示しない
      // 関連商品・カルーセルへの誤誘導を防ぐ
      if (/\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(window.location.pathname)) return;
      // 検索結果ページの商品リンク（直接URL + スポンサーリンク両対応）
      productLinks = document.querySelectorAll(
        'a[href*="/dp/"], a[href*="/gp/product/"], a[href*="/sspa/click"]'
      );
    }

    // ヤフショ向け重複防止（1カードに複数リンクがあるため同じitemIdを複数処理しない）
    const processedItemIds = new Set();

    productLinks.forEach((link) => {
      const itemId = extractItemId(link.href);
      // 現在のページの商品は除外
      if (!itemId || itemId === currentItemId) return;

      // 1カードに複数リンク（画像 + タイトル等）があるサイトは同一itemIdにつき最初の1リンクだけ処理
      if (site === 'yshopping' || site === 'rakuma' || site === 'rakuten' || site === 'amazon') {
        if (processedItemIds.has(itemId)) return;
        processedItemIds.add(itemId);
      }

      // サイト別に親要素（商品カード）を探す
      let card;
      if (site === 'mercari') {
        card = link.closest('[data-testid="item-cell"]') ||
               link.closest('[data-testid="product-box"]') ||  // メルカリShops
               link.closest('li') ||
               link.parentElement;
      } else if (site === 'hardoff') {
        card = link.closest('li[class*="product"]') ||
               link.closest('li[class*="item"]') ||
               link.closest('article') ||
               link.closest('li') ||
               link.parentElement;
      } else if (site === 'yshopping') {
        // ヤフショはカードのDOM構造が複雑なためリンク自体をカードとして扱う
        card = link;
      } else if (site === 'paypay') {
        // PayPayフリマ検索ページは既存マーク機能と同じパターン（リンク自体をカードに）
        card = link;
      } else if (site === 'yahoo') {
        // ヤフオク（既存マーク機能と同じ closest パターン）
        card = link.closest('li.Product') ||
               link.closest('.Product') ||
               link.closest('li[class*="Product"]') ||
               link.closest('li[class*="product"]') ||
               link.closest('li[class*="item"]') ||
               link.closest('article') ||
               link.closest('li') ||
               link.parentElement;
      } else if (site === 'rakuma') {
        // ラクマは1カードに画像リンク+タイトルリンクの2つあるため
        // ヤフショ・PayPayと同じリンク自体をカードとして扱うパターン
        card = link;
      } else if (site === 'rakuten') {
        // 楽天市場は1カードに画像リンク+タイトルリンクの2つあるため
        // ラクマ・ヤフショ・PayPayと同じリンク自体をカードとして扱うパターン
        card = link;
      } else if (site === 'amazon') {
        // Amazonは1カードに画像リンク+タイトルリンクの2つあるため
        // ラクマ・ヤフショ・PayPayと同じリンク自体をカードとして扱うパターン
        card = link;
      }

      if (card && !card.querySelector('.mercari-open-btn')) {
        // カードの相対位置設定
        if (getComputedStyle(card).position === 'static') {
          card.style.position = 'relative';
        }

        // 開くボタンを追加（バックグラウンドで開く）
        const openBtn = document.createElement('button');
        openBtn.className = 'mercari-open-btn';
        openBtn.textContent = '開く';
        // 親<a>要素のクリック・mousedownナビゲーションを阻止
        ['mousedown', 'pointerdown', 'touchstart'].forEach((evt) => {
          openBtn.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
        });
        openBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: 'openInBackground', url: link.href });
        });

        card.appendChild(openBtn);
      }
    });

    // 重複防止が必要なサイト: 同じitemIdに複数の開くボタンがあれば最初の1つだけ残す
    if (site === 'yshopping' || site === 'rakuma' || site === 'rakuten' || site === 'amazon') {
      const seenItemIds = new Set();
      document.querySelectorAll('.mercari-open-btn').forEach((btn) => {
        const parentLink = btn.parentElement;
        if (!parentLink || parentLink.tagName !== 'A') return;
        const id = extractItemId(parentLink.href);
        if (!id) return;
        if (seenItemIds.has(id)) {
          btn.remove();
        } else {
          seenItemIds.add(id);
        }
      });
    }
  }

  // チェックボタン機能（非表示・将来復活用にコード保持）
  // async function addCheckButtons() { ... }

  // 初期化
  async function init() {
    const { enableMichatta } = await chrome.storage.sync.get({ enableMichatta: false });
    if (!enableMichatta) {
      console.log('[みちゃった君] enableMichatta=false のため何もしません');
      return;
    }

    // SPA対応: URL変更時に markedItemIds をクリア（enableMichatta=true のときのみタイマーを開始）
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        markedItemIds.clear();
      }
    }, 1000);

    // background scriptからのメッセージを受信
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'getItemDetails') {
        // チェック用タブで商品情報を取得
        const details = extractItemDetailsFromDOM();
        if (details) {
          sendResponse({ success: true, details });
        } else {
          sendResponse({ success: false, error: 'DOM解析失敗' });
        }
        return true;
      }
    });

    // ストレージを初期化
    try {
      await window.MichattaStorage.initDB();
      await window.MichattaStorage.migrateFromLegacyStorage();
      storageReady = true;

      // 保留中の操作を実行
      pendingOperations.forEach(fn => fn());
      pendingOperations = [];

      console.log('[みちゃった君] ストレージ初期化完了');
    } catch (error) {
      console.error('[みちゃった君] ストレージ初期化エラー:', error);
      storageReady = true; // フォールバックで動作
    }

    // チェック用タブでは最小限の初期化のみ
    if (isCheckTab) {
      console.log('[みちゃった君] チェック用タブとして初期化');
      return;
    }

    // 開くボタンを追加
    addOpenButtons();

    // 商品ページなら閲覧記録を保存
    checkAndSaveCurrentPage();

    // 検索一覧の商品にマークを付ける
    markViewedItemsInList();

    // DOM変更を監視
    observeDOM();
  }

  // DOMContentLoadedで初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
