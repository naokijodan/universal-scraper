// Universal Scraper - 外部リンクボタン機能
// 商品ページで他のサイトへのクイック検索ボタンを表示

/**
 * 外部サイトの検索URL定義
 */
const EXTERNAL_SITES = {
  rakuma: {
    name: 'ラクマ',
    url: 'https://fril.jp/search/',
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

  // 少し待ってから表示
  setTimeout(() => {
    const keyword = getProductKeyword(currentSite);
    if (keyword) {
      createProductLinksBar(currentSite, keyword);
    }
  }, 2000);

  // 2回目の試行（ページ読み込みが遅い場合に対応）
  setTimeout(() => {
    if (!document.getElementById('us-external-links-bar')) {
      const keyword = getProductKeyword(currentSite);
      if (keyword) {
        createProductLinksBar(currentSite, keyword);
      }
    }
  }, 4000);
}
