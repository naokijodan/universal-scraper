// Universal Scraper - 外部リンクボタン機能
// 商品ページで他のサイトへのクイック検索ボタンを表示

/**
 * 外部サイトの検索URL定義
 */
const EXTERNAL_SITES = {
  rakuma: {
    name: 'ラクマ',
    url: 'https://fril.jp/s?query=',
    color: '#e52618'
  },
  mercari: {
    name: 'メルカリ',
    url: 'https://jp.mercari.com/search?keyword=',
    color: '#ff0211'
  },
  yahuoku: {
    name: 'ヤフオク',
    url: 'https://auctions.yahoo.co.jp/search/search?p=',
    color: '#ffcc00',
    textColor: '#333'
  },
  amazon: {
    name: 'Amazon',
    url: 'https://www.amazon.co.jp/s?k=',
    color: '#00a8e1'
  },
  rakuten: {
    name: '楽天市場',
    url: 'https://search.rakuten.co.jp/search/mall/',
    color: '#bf0000'
  },
  yahooshopping: {
    name: 'ヤフショ',
    url: 'https://shopping.yahoo.co.jp/search?p=',
    color: '#ff6600'
  },
  paypay: {
    name: 'PayPayフリマ',
    url: 'https://paypayfleamarket.yahoo.co.jp/search/',
    color: '#ff8800'
  },
  hardoff: {
    name: 'ハードオフ',
    url: 'https://netmall.hardoff.co.jp/search/?q=',
    color: '#FFCC00',
    textColor: '#333'
  },
  ebay: {
    name: 'eBay',
    url: 'https://www.ebay.com/sch/i.html?_nkw=',
    color: '#0064d2'
  },
  google: {
    name: 'Google',
    url: 'https://www.google.com/search?q=',
    color: '#4285f4'
  }
};

// SPA ナビゲーション用状態
let _pendingProductBarCanceled = false; // 商品ページの pending setTimeout キャンセル用
let _urlChangeTimer = null;             // URL 変化 debounce タイマー

/**
 * 商品名からキーワードを抽出
 */
function getProductKeyword(currentSite) {
  let keyword = '';

  try {
    console.log('📝 商品名取得開始:', currentSite);

    if (currentSite === 'mercari' || currentSite === 'mercari_shop') {
      const titleEl = document.querySelector('[data-testid="item-name"]') || document.querySelector('h1');
      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ メルカリ商品名:', keyword);
      } else {
        console.log('⚠️ メルカリ: タイトル要素が見つかりません');
      }
    } else if (currentSite === 'rakuma') {
      // ラクマは複数のh1があるので、より具体的なセレクタを使う
      let titleEl = document.querySelector('h1[class*="Item_itemName"]') ||
                    document.querySelector('h1[data-testid="item-name"]');

      // 見つからない場合は全てのh1を試す
      if (!titleEl || !titleEl.textContent.trim()) {
        const h1Elements = document.querySelectorAll('h1');
        console.log('🔍 h1要素数:', h1Elements.length);

        for (const h1 of h1Elements) {
          const text = h1.textContent.trim();
          if (text && text.length > 5) { // 5文字以上のテキストがある要素
            titleEl = h1;
            console.log('✅ 有効なh1を発見:', text.substring(0, 50));
            break;
          }
        }
      }

      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ ラクマ商品名:', keyword);
      } else {
        console.log('⚠️ ラクマ: タイトル要素が見つかりません');
      }
    } else if (currentSite === 'yahuoku') {
      let titleEl = document.querySelector('h1');

      // 見つからない場合や空の場合は全てのh1を試す
      if (!titleEl || !titleEl.textContent.trim()) {
        const h1Elements = document.querySelectorAll('h1');
        console.log('🔍 ヤフオク h1要素数:', h1Elements.length);

        for (const h1 of h1Elements) {
          const text = h1.textContent.trim();
          if (text && text.length > 5) {
            titleEl = h1;
            console.log('✅ ヤフオク: 有効なh1を発見:', text.substring(0, 50));
            break;
          }
        }
      }

      if (titleEl && titleEl.textContent.trim()) {
        keyword = titleEl.textContent.trim();
        console.log('✅ ヤフオク商品名:', keyword);
      } else {
        console.log('⚠️ ヤフオク: タイトル要素が見つかりません');
      }
    } else if (currentSite === 'paypayfurima') {
      let titleEl = document.querySelector('h1');

      // 見つからない場合や空の場合は全てのh1を試す
      if (!titleEl || !titleEl.textContent.trim()) {
        const h1Elements = document.querySelectorAll('h1');
        console.log('🔍 PayPayフリマ h1要素数:', h1Elements.length);

        for (const h1 of h1Elements) {
          const text = h1.textContent.trim();
          if (text && text.length > 5) {
            titleEl = h1;
            console.log('✅ PayPayフリマ: 有効なh1を発見:', text.substring(0, 50));
            break;
          }
        }
      }

      if (titleEl && titleEl.textContent.trim()) {
        keyword = titleEl.textContent.trim();
        console.log('✅ PayPayフリマ商品名:', keyword);
      } else {
        console.log('⚠️ PayPayフリマ: h1要素が見つかりません');
      }
    } else if (currentSite === 'amazon') {
      const titleEl = document.querySelector('#productTitle');
      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ Amazon商品名:', keyword);
      } else {
        console.log('⚠️ Amazon: #productTitle要素が見つかりません');
      }
    } else if (currentSite === 'rakuten') {
      const titleEl = document.querySelector('.item_name') || document.querySelector('h1');
      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ 楽天商品名:', keyword);
      } else {
        console.log('⚠️ 楽天: タイトル要素が見つかりません');
      }
    } else if (currentSite === 'ebay') {
      const titleEl = document.querySelector('.x-item-title__mainTitle') || document.querySelector('h1');
      if (titleEl) {
        keyword = titleEl.textContent.trim();
        console.log('✅ eBay商品名:', keyword);
      } else {
        console.log('⚠️ eBay: タイトル要素が見つかりません');
      }
    } else if (currentSite === 'hardoff') {
      // OGP タイトル形式: "ブランド|商品名|サイト名|WEB No." → parts[1] が商品名
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const content = ogTitle.getAttribute('content') || '';
        const parts = content.split('|');
        if (parts.length >= 2 && parts[1].trim()) {
          keyword = parts[1].trim();
          console.log('✅ ハードオフ商品名 (OGP):', keyword);
        } else {
          console.log('⚠️ ハードオフ: OGPパーツ不足、h1フォールバックへ');
        }
      } else {
        console.log('⚠️ ハードオフ: OGPタイトルなし、h1フォールバックへ');
      }
      // フォールバック: h1 要素
      if (!keyword) {
        const titleEl = document.querySelector('h1');
        if (titleEl && titleEl.textContent.trim()) {
          keyword = titleEl.textContent.trim();
          console.log('✅ ハードオフ商品名 (h1フォールバック):', keyword);
        } else {
          console.log('⚠️ ハードオフ: タイトル要素が見つかりません');
        }
      }
    }

    if (!keyword) {
      console.log('⚠️ キーワードが取得できませんでした');
    }

    return keyword.trim();

  } catch (error) {
    console.error('❌ キーワード取得エラー:', error);
    return '';
  }
}

/**
 * 商品ページにリンクバーを表示（ページ最上部）
 */
function createProductLinksBar(currentSite, keyword) {
  console.log('🔗 外部リンクバーを作成:', currentSite, keyword);

  // 既に存在する場合はスキップ
  if (document.getElementById('us-external-links-bar')) {
    console.log('⚠️ 既に表示されています');
    return;
  }

  if (!keyword) {
    console.log('⚠️ キーワードがないため表示しません');
    return;
  }

  // バーコンテナを作成
  const bar = document.createElement('div');
  bar.id = 'us-external-links-bar';
  bar.style.cssText = `
    position: sticky;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 99999;
    background: #2c2c2c;
    padding: 10px 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  `;

  // タイトルラベル
  const label = document.createElement('span');
  label.textContent = '🔗 他サイトで検索';
  label.style.cssText = `
    color: white;
    font-size: 13px;
    font-weight: bold;
    margin-right: 8px;
  `;
  bar.appendChild(label);

  // 現在のサイトを除外
  const sitesToShow = Object.keys(EXTERNAL_SITES).filter(site => {
    if (currentSite === 'mercari' && site === 'mercari') return false;
    if (currentSite === 'mercari_shop' && site === 'mercari') return false;
    if (currentSite === 'rakuma' && site === 'rakuma') return false;
    if (currentSite === 'yahuoku' && site === 'yahuoku') return false;
    if (currentSite === 'paypayfurima' && site === 'paypay') return false;
    if (currentSite === 'amazon' && site === 'amazon') return false;
    if (currentSite === 'rakuten' && site === 'rakuten') return false;
    if (currentSite === 'ebay' && site === 'ebay') return false;
    if (currentSite === 'hardoff' && site === 'hardoff') return false;
    if (currentSite === 'yahooshopping' && site === 'yahooshopping') return false;
    return true;
  });

  // ボタンを作成
  sitesToShow.forEach(siteKey => {
    const siteInfo = EXTERNAL_SITES[siteKey];
    const button = document.createElement('a');
    button.href = siteInfo.url + encodeURIComponent(keyword);
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.textContent = siteInfo.name;
    button.style.cssText = `
      display: inline-block;
      padding: 6px 16px;
      text-decoration: none;
      color: ${siteInfo.textColor || 'white'};
      background-color: ${siteInfo.color};
      border-radius: 4px;
      font-size: 13px;
      font-weight: bold;
      text-align: center;
      transition: opacity 0.2s;
      white-space: nowrap;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.opacity = '0.8';
    });
    button.addEventListener('mouseleave', () => {
      button.style.opacity = '1';
    });

    bar.appendChild(button);
  });

  // 閉じるボタン
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.title = '閉じる';
  closeBtn.style.cssText = `
    margin-left: auto;
    background: none;
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    padding: 0 8px;
  `;
  closeBtn.addEventListener('click', () => {
    bar.remove();
  });
  bar.appendChild(closeBtn);

  // ページの最上部に挿入
  if (document.body.firstChild) {
    document.body.insertBefore(bar, document.body.firstChild);
  } else {
    document.body.appendChild(bar);
  }
  console.log('✅ 外部リンクバーを表示しました');
}

/**
 * 外部リンク機能を初期化（商品ページのみ）
 */
function initExternalLinksForProduct(currentSite) {
  console.log('🔗 外部リンク機能を初期化:', currentSite);
  _pendingProductBarCanceled = false; // ★ SPA 遷移時キャンセルをリセット

  // 少し待ってから表示
  setTimeout(() => {
    if (_pendingProductBarCanceled) return; // ★ SPA 遷移で中断された場合はスキップ
    const keyword = getProductKeyword(currentSite);
    if (keyword) {
      createProductLinksBar(currentSite, keyword);
    }
  }, 2000);

  // 2回目の試行（ページ読み込みが遅い場合に対応）
  setTimeout(() => {
    if (_pendingProductBarCanceled) return; // ★ SPA 遷移で中断された場合はスキップ
    if (!document.getElementById('us-external-links-bar')) {
      const keyword = getProductKeyword(currentSite);
      if (keyword) {
        createProductLinksBar(currentSite, keyword);
      }
    }
  }, 4000);
}

/**
 * 検索ページを判定してサイトキーを返す
 * content.js から呼ばれる（external-links.js が先に読まれるため利用可能）
 * @param {string} hostname - window.location.hostname
 * @param {string} pathname - window.location.pathname
 * @returns {string|null} サイトキー or null（非検索ページ）
 */
function detectSearchPageSite(hostname, pathname) {
  if (hostname.includes('mercari.com') && pathname === '/search') return 'mercari';
  if (hostname.includes('fril.jp') && pathname === '/s') return 'rakuma';
  if (hostname.includes('auctions.yahoo.co.jp') && pathname.includes('/search/search')) return 'yahuoku';
  if (hostname.includes('paypayfleamarket.yahoo.co.jp') && pathname.startsWith('/search')) return 'paypayfurima';
  if (hostname.includes('amazon.co.jp') && pathname === '/s') return 'amazon';
  if (hostname.includes('search.rakuten.co.jp') && pathname.startsWith('/search/mall/')) return 'rakuten';
  if (hostname.includes('shopping.yahoo.co.jp') && pathname === '/search') return 'yahooshopping';
  if (hostname.includes('netmall.hardoff.co.jp') && pathname.startsWith('/search')) return 'hardoff';
  if (hostname.includes('ebay.') && pathname.includes('/sch/')) return 'ebay';
  return null;
}

/**
 * 検索画面の URL からキーワードを抽出
 * @param {string} currentSite - detectSearchPageSite の戻り値
 * @returns {string} キーワード（取得失敗時は空文字）
 */
function getSearchKeyword(currentSite) {
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const pathname = url.pathname;

    if (currentSite === 'mercari') {
      // URLSearchParams.get() は自動デコード済み（WHATWG URL 仕様）
      return params.get('keyword') || '';
    } else if (currentSite === 'rakuma') {
      return params.get('query') || '';
    } else if (currentSite === 'yahuoku') {
      return params.get('p') || '';
    } else if (currentSite === 'paypayfurima') {
      // URL: /search/<keyword> (パスベース、pathname は percent-encoded)
      const parts = pathname.split('/');
      return decodeURIComponent(parts[2] || '');
    } else if (currentSite === 'amazon') {
      return params.get('k') || '';
    } else if (currentSite === 'rakuten') {
      // URL: /search/mall/<keyword>/... (パスベース、pathname は percent-encoded)
      const parts = pathname.split('/');
      return decodeURIComponent(parts[3] || '');
    } else if (currentSite === 'yahooshopping') {
      return params.get('p') || '';
    } else if (currentSite === 'hardoff') {
      return params.get('q') || '';
    } else if (currentSite === 'ebay') {
      return params.get('_nkw') || '';
    }
    console.log('⚠️ getSearchKeyword: 未知のサイト:', currentSite);
    return '';
  } catch (error) {
    console.error('❌ 検索キーワード取得エラー:', error);
    return '';
  }
}

/**
 * 検索画面にリンクバーを表示
 * URL パラメータは即時取得できるため setTimeout 不要
 * @param {string} currentSite - detectSearchPageSite の戻り値
 */
function initExternalLinksForSearch(currentSite) {
  console.log('🔍 検索画面リンクバーを初期化:', currentSite);
  const keyword = getSearchKeyword(currentSite);
  if (keyword) {
    createProductLinksBar(currentSite, keyword);
    console.log('✅ 検索画面リンクバーを表示:', currentSite, keyword);
  } else {
    console.log('⚠️ 検索キーワードが取得できませんでした:', currentSite);
  }
}

/**
 * URL 変化の実処理
 * バーを削除し、新 URL を評価する（検索ページならバーを再表示）
 * ★ 商品データ抽出（getProductData等）は呼ばない（スコープ制約）
 */
function _doHandleUrlChange() {
  // pending の商品ページバーをキャンセル
  _pendingProductBarCanceled = true;

  // 既存バーを削除
  const existingBar = document.getElementById('us-external-links-bar');
  if (existingBar) {
    existingBar.remove();
    console.log('🗑️ SPA: 既存バーを削除しました');
  }

  // 新 URL を評価: 検索ページなら検索バーを表示
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  const searchSite = detectSearchPageSite(hostname, pathname);

  if (searchSite) {
    console.log('🔍 SPA: 検索ページへ遷移:', searchSite, window.location.href);
    initExternalLinksForSearch(searchSite);
  } else {
    // 商品ページや他のページ: バーなし
    // （スコープ制約: 商品データ抽出は SPA 遷移で再実行しない）
    console.log('📦 SPA: 非検索ページへ遷移、バーなし:', pathname);
  }
}

/**
 * URL 変化ハンドラ（50ms debounce）
 * replaceState の連続呼出によるチラつきを防ぐ
 */
function handleUrlChange() {
  clearTimeout(_urlChangeTimer);
  _urlChangeTimer = setTimeout(_doHandleUrlChange, 50);
}

/**
 * SPA ナビゲーション監視をセットアップする
 * MAIN world の spa-watcher.js と popstate リスナーで URL 変化を監視する
 * ★ content.js の変更不要。このスクリプトのロード時に自動実行される
 */
function setupSpaNavigation() {
  // pushState/replaceState のフックは MAIN world の spa-watcher.js が担う
  // (ISOLATED world で history を書き換えてもページの MAIN world には効かないため)

  // 戻る / 進むボタン対応 (popstate は DOM イベントで両 world で発火)
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('us-url-change'));
  });

  // spa-watcher.js (MAIN) からの us-url-change を受信
  window.addEventListener('us-url-change', handleUrlChange);

  console.log('🔄 SPA ナビゲーション監視を開始しました (MAIN world 連携)');
}

// スクリプト読み込み時に自動セットアップ
setupSpaNavigation();
