// Universal Product Scraper - Content Script
// eBay、楽天、Amazon、メルカリ、ヤフオク、ラクマに対応

console.log('🌐 Universal Product Scraper content.js が読み込まれました');

// ========================================
// 共通ノイズフィルタ関数（全プラットフォーム共通）
// ========================================
function isNoiseText(text) {
  if (!text || typeof text !== 'string') return true;

  const trimmed = text.trim();
  if (trimmed.length < 5) return true;

  // ※で始まる注意書き
  if (/^※/.test(trimmed)) return true;

  // 支払い関連
  if (/支払い方法|お支払い|クレジットカード|銀行振込|代金引換|コンビニ払い|後払い|分割払い|ボーナス払い/.test(trimmed)) return true;

  // ポイント・カード関連
  if (/獲得ポイント|ポイント加算|ポイントの|Amazonポイント|楽天ポイント|Tポイント|PayPayポイント/.test(trimmed)) return true;
  if (/Mastercard|プライム会員|キャンペーン等|ポイント還元|ポイント倍/.test(trimmed)) return true;

  // 配送関連
  if (/配送方法|配送地域|送料無料|送料込|送料別|配送料|お届け日|届け先|発送元|配送について/.test(trimmed)) return true;
  if (/宅配便|ゆうパック|クロネコ|佐川|ヤマト運輸|日本郵便|メール便|ネコポス|ゆうメール/.test(trimmed)) return true;
  if (/代引き|代金引換|沖縄|離島|送料を頂|別途送料|追加送料|送料がかかり/.test(trimmed)) return true;
  if (/出荷は受け付けて|発送不可|配送不可|お届けできません/.test(trimmed)) return true;

  // 保証関連
  if (/保証期間|メーカー保証|延長保証|保証書|保証の有無|保証について|返品保証/.test(trimmed)) return true;

  // 返品・交換関連
  if (/返品について|返品条件|交換について|キャンセル|返金/.test(trimmed)) return true;

  // 店舗・ショップ情報関連
  if (/営業時間|定休日|店舗情報|お問い合わせ|カスタマー|サポート/.test(trimmed)) return true;

  // Amazon/楽天の定型文
  if (/取り扱い開始日|この商品を見た|よく一緒に購入|スポンサー|おすすめ商品/.test(trimmed)) return true;
  if (/ウィッシュリスト|お気に入り|シェアする|ツイート|いいね/.test(trimmed)) return true;

  // レビュー関連
  if (/レビュー済み|グローバルレーティング|役に立った|参考になった|カスタマーレビュー/.test(trimmed)) return true;
  if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(trimmed)) return true; // 日付で始まる

  // タグの集団を検出（短い単語がスペースで多数並んでいる）
  // 例: "時計 メンズ ブランド 腕時計 プレゼント ギフト 人気 おすすめ"
  // ただし、商品情報らしいキーワードが含まれている場合は除外しない
  const productInfoKeywords = /ブランド|サイズ|素材|カラー|色|生産国|原産国|メーカー|品番|型番|重量|cm|mm|kg|g|%/;
  if (!productInfoKeywords.test(trimmed)) {
    const words = trimmed.split(/[\s　,、]+/);
    // 8単語以上あり、90%以上が短い単語（3文字以下） = タグの集団と判定
    if (words.length >= 8) {
      const veryShortWords = words.filter(w => w.length <= 3);
      if (veryShortWords.length / words.length >= 0.9) {
        return true;
      }
    }
  }

  // 「|」区切りで短い単語が多数並んでいる場合もタグ（条件を厳しく）
  const pipeWords = trimmed.split(/\|/).map(w => w.trim());
  if (pipeWords.length >= 6) {
    const shortPipeWords = pipeWords.filter(w => w.length <= 5);
    if (shortPipeWords.length / pipeWords.length >= 0.9) {
      return true;
    }
  }

  return false;
}

(async function() {
  console.log('🚀 Universal Product Scraper 実行開始');

  // サイトを判別
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  let currentSite = null;

  if (hostname.includes('ebay.') && pathname.includes('/itm/')) {
    currentSite = 'ebay';
  } else if (hostname.includes('rakuten.co.jp') && (pathname.includes('/item/') || pathname.match(/\/[a-z0-9_-]+\/[a-z0-9_-]+\//))) {
    currentSite = 'rakuten';
  } else if (hostname.includes('amazon.co.jp') && (pathname.includes('/dp/') || pathname.includes('/gp/product/'))) {
    currentSite = 'amazon';
  } else if (hostname.includes('mercari.com') && pathname.includes('/shops/product/')) {
    // メルカリショップ
    currentSite = 'mercari_shop';
  } else if (hostname.includes('mercari.com') && pathname.includes('/item/')) {
    // 通常のメルカリ
    currentSite = 'mercari';
  } else if ((hostname.includes('auctions.yahoo.co.jp') && pathname.includes('/auction/')) || (hostname.includes('page.auctions.yahoo.co.jp'))) {
    currentSite = 'yahuoku';
  } else if (hostname.includes('paypayfleamarket.yahoo.co.jp')) {
    // PayPayフリマ
    currentSite = 'paypayfurima';
  } else if (hostname.includes('shopping.yahoo.co.jp') && (pathname.includes('/products/') || hostname.includes('store.shopping.yahoo.co.jp'))) {
    // Yahoo!ショッピングの商品詳細ページ
    currentSite = 'yahooshopping';
  } else if (hostname.includes('fril.jp')) {
    // ラクマ: fril.jp, item.fril.jp など全てのサブドメインに対応
    currentSite = 'rakuma';
  } else {
    console.log('❌ 対象外のサイトまたはページ:', hostname, pathname);
    return; // 対象外のサイト
  }

  console.log('✅ サイト判別成功:', currentSite, 'URL:', window.location.href);

  // 設定を読み込み
  const settings = await chrome.storage.sync.get({
    enableEbay: true,
    enableRakuten: true,
    enableAmazon: true,
    enableMercari: true,
    enableYahoo: true,
    enablePaypay: true,
    enableFril: true,
    amazonLoadDelay: 3,
    ebayLoadDelay: 0,
    rakutenLoadDelay: 0,
    mercariLoadDelay: 0,
    yahooLoadDelay: 0,
    paypayLoadDelay: 0,
    frilLoadDelay: 0,
    alertKeywords: [],
    popupKeywords: [],
    excludeKeywords: [],
    excludeSellerIds: [],
    skipReviewCount: null,
    skipBadRate: null,
    skipDaysFromListing: null,
    buttonPosition: 'top-right',
    imageOutputCount: 20,
    enableImageInClipboard: true,
    spreadsheets: [],
    lastUsedSheetId: null,
    // フリマサイトアラート条件（デフォルト値）
    alertBadRate: 5,
    alertLowReviewCount: 100,
    alertDaysFromListing: 180,
    alertDaysFromUpdate: 90,
    alertHandlingDays: false
  });

  console.log('⚙️ 設定読み込み完了:', settings);

  // このサイトが無効化されている場合は終了
  if (currentSite === 'ebay' && !settings.enableEbay) {
    console.log('⚠️ eBayが無効化されています');
    return;
  }
  if (currentSite === 'rakuten' && !settings.enableRakuten) {
    console.log('⚠️ 楽天が無効化されています');
    return;
  }
  if (currentSite === 'amazon' && !settings.enableAmazon) {
    console.log('⚠️ Amazonが無効化されています');
    return;
  }
  if (currentSite === 'mercari' && !settings.enableMercari) {
    console.log('⚠️ メルカリが無効化されています');
    return;
  }
  if (currentSite === 'mercari_shop' && !settings.enableMercari) {
    console.log('⚠️ メルカリショップが無効化されています（メルカリ設定を使用）');
    return;
  }
  if (currentSite === 'yahuoku' && !settings.enableYahoo) {
    console.log('⚠️ ヤフオクが無効化されています');
    return;
  }
  if (currentSite === 'yahooshopping' && !settings.enableYahoo) {
    console.log('⚠️ Yahoo!ショッピングが無効化されています');
    return;
  }
  if (currentSite === 'paypayfurima' && !settings.enablePaypay) {
    console.log('⚠️ PayPayフリマが無効化されています');
    return;
  }
  if (currentSite === 'rakuma' && !settings.enableFril) {
    console.log('⚠️ ラクマが無効化されています');
    return;
  }

  // サイト別の色設定
  const siteColors = {
    ebay: { primary: '#3665f3', hover: '#2952cc' },
    rakuten: { primary: '#bf0000', hover: '#a00000' },
    amazon: { primary: '#FF9900', hover: '#e88b00' },
    mercari: { primary: '#FF0211', hover: '#E60210' },
    mercari_shop: { primary: '#4169E1', hover: '#315ABD' }, // メルカリショップは青系
    yahuoku: { primary: '#FF0033', hover: '#E6002E' },
    paypayfurima: { primary: '#FF6B00', hover: '#E65C00' },
    rakuma: { primary: '#E91E63', hover: '#C2185B' },
    yahooshopping: { primary: '#FF0033', hover: '#E6002E' }
  };

  const colors = siteColors[currentSite];

  // ページ上の要素をハイライト表示する関数
  function highlightPageElements() {
    console.log('🎨 ページ要素のハイライト開始');

    // 除外キーワードと注目キーワードを取得
    const excludeKeywords = Array.isArray(settings.alertKeywords) ? settings.alertKeywords.filter(k => k.trim()) : (typeof settings.alertKeywords === 'string' && settings.alertKeywords ? settings.alertKeywords.split('\n').filter(k => k.trim()) : []);
    const attentionKeywords = Array.isArray(settings.popupKeywords) ? settings.popupKeywords.filter(k => k.trim()) : (typeof settings.popupKeywords === 'string' && settings.popupKeywords ? settings.popupKeywords.split('\n').filter(k => k.trim()) : []);

    if (excludeKeywords.length === 0 && attentionKeywords.length === 0) {
      console.log('⚠️ キーワード設定なし');
      return { foundExcludeKeywords: [], foundAttentionKeywords: [] };
    }

    // 検出されたキーワードを記録
    const foundExcludeKeywords = new Set();
    const foundAttentionKeywords = new Set();

    // タイトルと説明文をハイライト
    const highlightText = (element, keywords, color, isExclude) => {
      if (!element) return;

      // テキストノードを直接処理
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const textNodes = [];
      let node;
      while (node = walker.nextNode()) {
        textNodes.push(node);
      }

      textNodes.forEach(textNode => {
        const text = textNode.textContent;
        let hasMatch = false;
        let newHTML = text;

        keywords.forEach(keyword => {
          if (!keyword.trim()) return;
          // 特殊文字をエスケープ
          const escapedKeyword = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(${escapedKeyword})`, 'gi');
          if (regex.test(text)) {
            hasMatch = true;
            newHTML = newHTML.replace(regex, `<mark style="background-color: ${color}; color: #000; padding: 2px 4px; border-radius: 2px;">$1</mark>`);

            // 検出されたキーワードを記録
            if (isExclude) {
              foundExcludeKeywords.add(keyword.trim());
            } else {
              foundAttentionKeywords.add(keyword.trim());
            }
          }
        });

        if (hasMatch) {
          const span = document.createElement('span');
          span.innerHTML = newHTML;
          textNode.parentNode.replaceChild(span, textNode);
        }
      });
    };

    // サイト別のセレクタでタイトル・説明文を検索してハイライト
    let titleSelectors = [];
    let descriptionSelectors = [];

    if (currentSite === 'mercari' || currentSite === 'mercari_shop') {
      titleSelectors = [
        'h1[data-testid="name"]',
        'h1.merBlock__title',
        'h2.item-name',
        'h1[class*="heading"]',
        'mer-heading[variant="headingM"]'
      ];
      descriptionSelectors = [
        'div[data-testid="description"]',
        'pre[data-testid="description"]',
        'div.item-description',
        'pre.item-description__inner',
        'mer-text[class*="description"]',
        'div[class*="ItemDescription"]'
      ];
    } else if (currentSite === 'rakuten') {
      titleSelectors = ['h1.item_name', 'h2.item_name', 'span.item_name'];
      descriptionSelectors = ['div.item_desc', 'div[class*="description"]'];
    } else if (currentSite === 'amazon') {
      titleSelectors = ['#productTitle', 'h1#title'];
      descriptionSelectors = ['#feature-bullets', '#productDescription'];
    } else if (currentSite === 'yahuoku') {
      titleSelectors = ['h1.ProductTitle__text', 'h1[class*="Title"]'];
      descriptionSelectors = ['div.ProductExplanation__commentBody', 'div[class*="Description"]'];
    } else if (currentSite === 'paypayfurima') {
      titleSelectors = [
        'h1[class*="Name"]',
        'h1.sc-',
        'h1[class*="name"]',
        'h1[class*="title"]',
        'h1[class*="Title"]',
        'h1',
        '[class*="ProductName"]',
        '[class*="productName"]',
        '[class*="ItemName"]',
        '[class*="itemName"]'
      ];
      descriptionSelectors = [
        'div[class*="Description"]',
        'p[class*="description"]',
        '[class*="ProductDescription"]',
        '[class*="itemDescription"]',
        'pre[class*="description"]'
      ];
    } else if (currentSite === 'rakuma') {
      titleSelectors = [
        'h1[class*="item-name"]',
        'h1.item_name',
        'h1.item-name',
        'h1',
        '.item-name',
        '[class*="ItemName"]',
        '[class*="itemName"]'
      ];
      descriptionSelectors = [
        'div[class*="item-description"]',
        'pre.description',
        '.item-description',
        '[class*="ItemDescription"]',
        '[class*="itemDescription"]',
        'pre[class*="description"]'
      ];
    }

    // タイトルをハイライト
    console.log('🔍 キーワード検索:', { excludeKeywords, attentionKeywords });
    let titleFound = false;
    titleSelectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent?.trim() || '';
        console.log('✅ タイトル要素発見:', selector, 'テキスト:', text.substring(0, 80));

        // テキストが実際に存在する場合のみハイライト
        if (text.length > 5) {
          highlightText(element, excludeKeywords, '#ffcccc', true); // 薄い赤（除外）
          highlightText(element, attentionKeywords, '#ffeb3b', false); // 濃い黄色（注目）
          titleFound = true;
        } else {
          console.warn('⚠️ タイトル要素はあるがテキストが空:', selector);
        }
      }
    });

    // タイトルが見つからない場合は、より広範囲に検索
    if (!titleFound) {
      console.warn('⚠️ タイトルセレクタで要素が見つからなかったため、汎用検索を実行');
      const allH1 = document.querySelectorAll('h1, h2');
      console.log('🔍 h1/h2要素数:', allH1.length);

      // 優先度順に検索：1) item/titleクラス名を持つ要素 2) キーワードを含む要素
      const candidates = [];

      for (let index = 0; index < allH1.length; index++) {
        const h1 = allH1[index];
        const text = h1.textContent?.trim() || '';
        console.log(`🔍 h${index}: テキスト長=${text.length}, 内容="${text.substring(0, 80)}", class="${h1.className}"`);

        // 商品タイトルらしい長さ（15文字以上、200文字以下）
        if (text.length >= 15 && text.length < 200) {
          const textLower = text.toLowerCase();
          const hasKeyword = [...excludeKeywords, ...attentionKeywords].some(kw =>
            kw && kw.trim() && (text.includes(kw.trim()) || textLower.includes(kw.trim().toLowerCase()))
          );
          const isItemTitle = h1.className && (h1.className.includes('item') || h1.className.includes('title') || h1.className.includes('name'));

          if (hasKeyword || isItemTitle) {
            const priority = isItemTitle ? 1 : 2; // クラス名があるものを優先
            candidates.push({ element: h1, text, hasKeyword, isItemTitle, priority });
            console.log(`📌 候補追加: priority=${priority}, text="${text.substring(0, 50)}"`);
          }
        }
      }

      // 優先度順にソートして最優先の要素をハイライト
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.priority - b.priority);
        const best = candidates[0];
        console.log('✅ hタイトル発見（汎用）:', best.text.substring(0, 80), 'hasKeyword:', best.hasKeyword, 'isItemTitle:', best.isItemTitle);
        highlightText(best.element, excludeKeywords, '#ffcccc', true);
        highlightText(best.element, attentionKeywords, '#ffeb3b', false);
        titleFound = true;
      }
    }

    // それでも見つからない場合、商品名らしいテキストを持つ要素を探す
    if (!titleFound && (currentSite === 'rakuma' || currentSite === 'yahuoku' || currentSite === 'paypayfurima')) {
      console.warn('⚠️ h1/h2でも見つからなかったため、商品名を直接検索');
      const allElements = document.querySelectorAll('div, span, p');
      allElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        // 商品タイトルっぽい長さと内容（【】で始まる、または長めのテキスト）
        if ((text.startsWith('【') || text.length > 20) && text.length < 300 && el.children.length === 0) {
          // キーワードが含まれているかチェック
          const hasKeyword = [...excludeKeywords, ...attentionKeywords].some(kw => text.includes(kw));
          if (hasKeyword) {
            console.log('✅ 商品名らしき要素発見:', text.substring(0, 80));
            highlightText(el, excludeKeywords, '#ffcccc', true);
            highlightText(el, attentionKeywords, '#ffeb3b', false);
            titleFound = true;
          }
        }
      });
    }

    // 説明文をハイライト
    let descFound = false;
    descriptionSelectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        console.log('✅ 説明文要素発見:', selector, element.textContent.substring(0, 50));
        highlightText(element, excludeKeywords, '#ffcccc', true); // 薄い赤（除外）
        highlightText(element, attentionKeywords, '#ffeb3b', false); // 濃い黄色（注目）
        descFound = true;
      }
    });

    // 説明文が見つからない場合も、より広範囲に検索
    if (!descFound && (currentSite === 'rakuma' || currentSite === 'yahuoku' || currentSite === 'paypayfurima')) {
      console.warn('⚠️ 説明文セレクタで要素が見つからなかったため、汎用検索を実行');
      const allPre = document.querySelectorAll('pre, div[class*="description"], div[class*="Description"]');
      allPre.forEach(el => {
        if (el.textContent && el.textContent.length > 50) {
          console.log('✅ 説明文発見（汎用）:', el.textContent.substring(0, 50));
          highlightText(el, excludeKeywords, '#ffcccc', true);
          highlightText(el, attentionKeywords, '#ffeb3b', false);
        }
      });
    }

    console.log('✅ ハイライト完了');
    console.log('📝 検出されたキーワード:', {
      exclude: Array.from(foundExcludeKeywords),
      attention: Array.from(foundAttentionKeywords)
    });

    // 検出されたキーワードを返す
    return {
      foundExcludeKeywords: Array.from(foundExcludeKeywords),
      foundAttentionKeywords: Array.from(foundAttentionKeywords)
    };
  }

  // アラートバッジを表示する関数（フリマサイト用）
  function showAlertBadges(data, keywordInfo) {
    if (!data) return;

    console.log('🚨 アラートバッジ表示開始');

    // 既存のアラートコンテナを削除
    const existing = document.getElementById('unified-scraper-alerts');
    if (existing) existing.remove();

    const alerts = [];

    // キーワード検出アラートを追加
    if (keywordInfo) {
      if (keywordInfo.foundExcludeKeywords && keywordInfo.foundExcludeKeywords.length > 0) {
        alerts.push({
          type: 'error',
          icon: '🚫',
          title: '除外キーワード検出',
          message: keywordInfo.foundExcludeKeywords.join(', ')
        });
      }

      if (keywordInfo.foundAttentionKeywords && keywordInfo.foundAttentionKeywords.length > 0) {
        alerts.push({
          type: 'warning',
          icon: '⚠️',
          title: '注目キーワード検出',
          message: keywordInfo.foundAttentionKeywords.join(', ')
        });
      }
    }

    // 悪い評価率のチェック
    if (settings.alertBadRate && data.badRate) {
      const badRate = parseFloat(data.badRate);
      if (!isNaN(badRate) && badRate >= settings.alertBadRate) {
        alerts.push({
          type: 'error',
          icon: '🚨',
          title: '悪い評価率が高い',
          message: `${badRate}% (基準: ${settings.alertBadRate}%以上)`
        });
      }
    }

    // 評価件数のチェック（0件も含む）
    const frimaPlatforms = ['mercari', 'mercari_shop', 'yahuoku', 'paypayfurima', 'rakuma'];
    const isFrimaPlatform = frimaPlatforms.includes(data.platform);

    if (settings.alertLowReviewCount !== null && settings.alertLowReviewCount !== undefined &&
        data.reviewCount !== null && data.reviewCount !== undefined && data.reviewCount !== '') {
      const reviewCount = parseInt(data.reviewCount);
      if (!isNaN(reviewCount) && reviewCount <= settings.alertLowReviewCount) {
        alerts.push({
          type: 'warning',
          icon: '⚠️',
          title: '評価件数が少ない',
          message: `${reviewCount}件 (基準: ${settings.alertLowReviewCount}件以下)`
        });
      }
    } else if (isFrimaPlatform && (data.reviewCount === null || data.reviewCount === undefined || data.reviewCount === '')) {
      // フリマサイトで評価件数が取得できなかった場合
      alerts.push({
        type: 'warning',
        icon: '⚠️',
        title: '評価件数が取得できませんでした',
        message: '出品者の評価件数を取得できませんでした。手動で確認してください'
      });
    }

    // 出品経過日数のチェック（ヤフオクの場合は終了までの残り日数）
    if (settings.alertDaysFromListing && data.listedElapsedDays) {
      const days = parseFloat(data.listedElapsedDays);

      // ヤフオクの場合は終了までの残り日数として扱う
      if (data.platform === 'yahoo') {
        if (!isNaN(days) && days >= 0) {
          alerts.push({
            type: 'info',
            icon: '⏰',
            title: '終了まで残り時間',
            message: `残り ${Math.ceil(days)} 日`
          });
        }
      } else {
        // フリマサイトの場合は出品からの経過日数
        if (!isNaN(days) && days >= settings.alertDaysFromListing) {
          alerts.push({
            type: 'info',
            icon: '📅',
            title: '出品から時間が経過',
            message: `${Math.floor(days)}日経過 (基準: ${settings.alertDaysFromListing}日以上)`
          });
        }
      }
    }

    // 更新経過日数のチェック（ヤフオクでは表示しない）
    if (data.platform !== 'yahoo' && settings.alertDaysFromUpdate && data.updatedElapsedDays) {
      const elapsedDays = parseFloat(data.updatedElapsedDays);
      if (!isNaN(elapsedDays) && elapsedDays >= settings.alertDaysFromUpdate) {
        alerts.push({
          type: 'info',
          icon: '🔄',
          title: '更新から時間が経過',
          message: `${Math.floor(elapsedDays)}日経過 (基準: ${settings.alertDaysFromUpdate}日以上)`
        });
      }
    }

    // 送料負担のチェック（無料以外をアラート）
    if (data.shippingPayer) {
      const shippingPayer = data.shippingPayer.toString();
      console.log('📦 送料負担チェック:', shippingPayer);

      // 出品者負担・送料無料のパターン
      const isFreeShipping =
        shippingPayer.includes('出品者') ||
        shippingPayer.match(/送料[込こ]/) || // 送料込み、送料込
        shippingPayer.includes('無料') ||
        shippingPayer.includes('0円') ||
        shippingPayer.includes('FREE');

      // 購入者負担のパターン
      const isPaidShipping =
        shippingPayer.includes('購入者') ||
        shippingPayer.includes('落札者') ||
        shippingPayer.includes('着払') ||
        shippingPayer.includes('別途') ||
        shippingPayer.includes('送料別') ||
        shippingPayer.match(/\d+円/); // 数字+円が含まれる場合

      if (!isFreeShipping || isPaidShipping) {
        console.log('⚠️ 送料負担アラート発動:', shippingPayer);
        alerts.push({
          type: 'warning',
          icon: '💰',
          title: '送料購入者負担',
          message: `${shippingPayer}`
        });
      }
    }

    // 発送日数のチェック（4〜7日、または8日以上）
    if (settings.alertHandlingDays && data.handlingDays) {
      const handlingDaysText = data.handlingDays.toString();
      const rangeMatch = handlingDaysText.match(/(\d+)[〜～~](\d+)/);
      const singleMatch = handlingDaysText.match(/(\d+)/);

      let maxDays = 0;
      if (rangeMatch) {
        maxDays = parseInt(rangeMatch[2]);
      } else if (singleMatch) {
        maxDays = parseInt(singleMatch[1]);
      }

      if (maxDays >= 8) {
        alerts.push({
          type: 'error',
          icon: '🚨',
          title: '発送日数がとても長い',
          message: `${handlingDaysText}（8日以上）`
        });
      } else if (maxDays >= 4) {
        alerts.push({
          type: 'warning',
          icon: '📦',
          title: '発送日数が長い',
          message: `${handlingDaysText}`
        });
      }
    }

    if (alerts.length === 0) {
      console.log('✅ アラート条件に該当なし');
      return;
    }

    // アラートコンテナを作成
    const alertContainer = document.createElement('div');
    alertContainer.id = 'unified-scraper-alerts';
    alertContainer.style.cssText = `
      position: fixed;
      top: 60px;
      left: 10px;
      z-index: 100000;
      max-width: 280px;
      background: white;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      padding: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      cursor: move;
      animation: slideInLeft 0.3s ease-out;
      font-size: 12px;
    `;

    // ヘッダー（ドラッグハンドル + 閉じるボタン）
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      padding: 2px 2px 6px 2px;
      border-bottom: 1px solid #e0e0e0;
      cursor: move;
    `;

    const title = document.createElement('div');
    title.textContent = '⚠️ アラート';
    title.style.cssText = `
      font-size: 11px;
      font-weight: 700;
      color: #424242;
    `;

    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      background: none;
      border: none;
      color: #757575;
      font-size: 16px;
      cursor: pointer;
      padding: 0;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 2px;
      transition: all 0.2s;
    `;

    closeButton.addEventListener('mouseenter', () => {
      closeButton.style.backgroundColor = '#f5f5f5';
      closeButton.style.color = '#000';
    });

    closeButton.addEventListener('mouseleave', () => {
      closeButton.style.backgroundColor = 'transparent';
      closeButton.style.color = '#757575';
    });

    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      alertContainer.remove();
    });

    header.appendChild(title);
    header.appendChild(closeButton);
    alertContainer.appendChild(header);

    // アラート一覧
    alerts.forEach(alert => {
      const bgColor = alert.type === 'error' ? '#ffebee' : alert.type === 'warning' ? '#fff3e0' : '#e3f2fd';
      const borderColor = alert.type === 'error' ? '#f44336' : alert.type === 'warning' ? '#ff9800' : '#2196F3';
      const textColor = alert.type === 'error' ? '#c62828' : alert.type === 'warning' ? '#e65100' : '#1565c0';

      const alertBox = document.createElement('div');
      alertBox.style.cssText = `
        background: ${bgColor};
        border-left: 3px solid ${borderColor};
        border-radius: 3px;
        padding: 6px 8px;
        margin-bottom: 6px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.1);
        display: flex;
        align-items: start;
        gap: 6px;
      `;

      alertBox.innerHTML = `
        <span style="font-size: 14px; flex-shrink: 0;">${alert.icon}</span>
        <div style="flex: 1;">
          <div style="font-weight: 700; color: ${textColor}; font-size: 11px; margin-bottom: 2px;">${alert.title}</div>
          <div style="font-size: 10px; color: #424242; line-height: 1.3;">${alert.message}</div>
        </div>
      `;

      alertContainer.appendChild(alertBox);
    });

    // ドラッグ機能を追加
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let containerStartLeft = 10;
    let containerStartTop = 60;

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      containerStartLeft = parseInt(alertContainer.style.left);
      containerStartTop = parseInt(alertContainer.style.top);
      alertContainer.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      const newLeft = containerStartLeft + deltaX;
      const newTop = containerStartTop + deltaY;

      alertContainer.style.left = `${Math.max(0, Math.min(newLeft, window.innerWidth - alertContainer.offsetWidth))}px`;
      alertContainer.style.top = `${Math.max(0, Math.min(newTop, window.innerHeight - alertContainer.offsetHeight))}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      alertContainer.style.cursor = 'move';
    });

    // アニメーションのスタイルを追加
    if (!document.getElementById('unified-scraper-alert-styles')) {
      const style = document.createElement('style');
      style.id = 'unified-scraper-alert-styles';
      style.textContent = `
        @keyframes slideInLeft {
          from {
            transform: translateX(-300px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(alertContainer);
    console.log(`✅ アラートバッジ ${alerts.length}個表示完了`);
  }

  // ページ上の要素を直接ハイライトする関数（フリマサイト用）
  function highlightAlertElements(data) {
    if (!data) return;

    console.log('🎨 ページ要素のハイライト開始');

    // ハイライト用のヘルパー関数（テキスト部分のみをハイライト）
    const addTextHighlight = (element, pattern, type) => {
      if (!element || element.dataset.scraperHighlighted) return false;

      const colors = {
        error: '#ffcccc',    // 薄い赤（除外）
        warning: '#ff5252',  // 赤（警告：評価件数、発送日数）
        info: '#ff5252'      // 赤（情報：出品日、更新日）
      };

      const bgColor = colors[type] || colors.warning;

      // テキストノードを探索
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const textNodes = [];
      let node;
      while (node = walker.nextNode()) {
        if (pattern.test(node.textContent)) {
          textNodes.push(node);
        }
      }

      if (textNodes.length === 0) return false;

      // マッチしたテキストノードだけをハイライト
      textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const match = text.match(pattern);
        if (match) {
          const newHTML = text.replace(pattern, `<mark style="background-color: ${bgColor}; color: #000; padding: 2px 4px; border-radius: 2px;">$1</mark>`);
          const span = document.createElement('span');
          span.innerHTML = newHTML;
          textNode.parentNode.replaceChild(span, textNode);
        }
      });

      element.dataset.scraperHighlighted = 'true';
      return true;
    };

    // フリマサイト共通のハイライト処理
    if (currentSite === 'mercari' || currentSite === 'mercari_shop' || currentSite === 'yahuoku' || currentSite === 'paypayfurima' || currentSite === 'rakuma') {
      console.log('🔍 フリマサイトのアラート要素を検索中...', currentSite);

      // 悪い評価率のハイライト（評価率の数字だけ）
      if (settings.alertBadRate && data.badRate) {
        const badRate = parseFloat(data.badRate);
        if (!isNaN(badRate) && badRate >= settings.alertBadRate) {
          console.log('🚨 悪い評価率検出:', badRate);

          // 評価率を含む要素を探す
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            if (el.children.length > 2) return; // リーフ要素のみ
            const text = el.textContent?.trim() || '';
            // 「31件」または「31」のパターン（評価セクション内）
            if (text.match(/^\d+件?$/) || (text.match(/^\d+$/) && el.closest('[class*="rating"]'))) {
              const pattern = /(\d+件?)/;
              addTextHighlight(el, pattern, 'error');
            }
          });
        }
      }

      // 評価件数のハイライト（件数の数字だけ、0件も含む）
      if (settings.alertLowReviewCount !== null && settings.alertLowReviewCount !== undefined &&
          data.reviewCount !== null && data.reviewCount !== undefined && data.reviewCount !== '') {
        const reviewCount = parseInt(data.reviewCount);
        if (!isNaN(reviewCount) && reviewCount <= settings.alertLowReviewCount) {
          console.log('⚠️ 評価件数少ない:', reviewCount, '基準:', settings.alertLowReviewCount);

          // 評価件数を含む要素を探す（より広範囲に）
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            if (el.children.length > 2) return; // リーフ要素のみ
            const text = el.textContent?.trim() || '';

            // 「31」だけの場合や「31件」の場合に対応
            if ((text === data.reviewCount.toString() || text === `${data.reviewCount}件`) && !el.dataset.scraperHighlighted) {
              console.log('✅ 評価件数要素発見:', text, el.tagName);
              const pattern = text.includes('件') ? /(\d+件)/ : /(\d+)/;
              addTextHighlight(el, pattern, 'warning');
            }
          });
        }
      }

      // 発送日数のハイライト（日数部分だけ）
      console.log('📦 発送日数チェック開始 - settings.alertHandlingDays:', settings.alertHandlingDays, 'data.handlingDays:', data.handlingDays);

      // 発送日数を含む要素を探す（設定に関わらず4日以上の範囲をハイライト）
      const allElements = document.querySelectorAll('*');
      let foundShippingDays = false;

      allElements.forEach(el => {
        // 子要素が少ない（リーフに近い）要素のみをチェック
        if (el.children.length > 3) return;

        const text = el.textContent?.trim() || '';

        // 「4〜7日で発送」「4～7日で発送」「4~7日で発送」（半角・全角チルダ対応）
        const match = text.match(/(\d+)[〜～~](\d+)日(で発送)?/);
        if (match && text.length < 50) { // テキストが短い要素のみ（精度向上）
          const minDays = parseInt(match[1]);
          const maxDays = parseInt(match[2]);

          // 最大日数が4日以上の場合
          if (maxDays >= 4 || (settings.alertHandlingDays && maxDays >= settings.alertHandlingDays)) {
            console.log('✅ 発送日数ハイライト対象:', text, 'element:', el.tagName, 'children:', el.children.length);
            const pattern = /(\d+[〜～~]\d+日(で発送)?)/;
            const highlightType = maxDays >= 8 ? 'error' : 'warning';
            const highlighted = addTextHighlight(el, pattern, highlightType);
            if (highlighted) {
              foundShippingDays = true;
              console.log('🎨 発送日数ハイライト成功');
            }
          }
        }
      });

      if (!foundShippingDays) {
        console.warn('⚠️ 発送日数の要素が見つかりませんでした');
      }

      // 送料負担のハイライト（購入者負担の場合）
      console.log('💰 送料負担ハイライト開始 - shippingPayer:', data.shippingPayer);

      if (data.shippingPayer) {
        const shippingPayer = data.shippingPayer.toString();

        // 出品者負担・送料無料かチェック
        const isFreeShipping =
          shippingPayer.includes('出品者') ||
          shippingPayer.match(/送料[込こ]/) ||
          shippingPayer.includes('無料') ||
          shippingPayer.includes('0円');

        const isPaidShipping =
          shippingPayer.includes('購入者') ||
          shippingPayer.includes('落札者') ||
          shippingPayer.includes('着払') ||
          shippingPayer.includes('別途') ||
          shippingPayer.includes('送料別') ||
          shippingPayer.match(/\d+円/);

        if (!isFreeShipping || isPaidShipping) {
          console.log('💰 送料負担ページハイライト対象:', shippingPayer);

          // 送料・配送料関連の要素を検索
          const allElements = document.querySelectorAll('*');
          let foundShipping = false;

          allElements.forEach(el => {
            if (el.children.length > 3) return;
            const text = el.textContent?.trim() || '';

            // 送料関連キーワード + 購入者負担パターン
            const hasShippingKeyword = text.match(/送料|配送料|配送の方法|発送方法/);
            const hasPaidPattern =
              text.includes('購入者') ||
              text.includes('落札者') ||
              text.includes('着払') ||
              text.includes('別途') ||
              text.match(/送料.*\d+円/) ||
              text.includes('送料別');

            if (hasShippingKeyword && hasPaidPattern && text.length < 100) {
              console.log('✅ 送料負担要素発見:', text);
              // 購入者負担・着払いなどをハイライト
              const pattern = /(購入者負担|落札者負担|着払い|送料別|送料\d+円)/;
              if (pattern.test(text)) {
                addTextHighlight(el, pattern, 'warning');
                foundShipping = true;
              }
            }
          });

          if (!foundShipping) {
            console.warn('⚠️ 送料負担の要素が見つかりませんでした');
          }
        }
      }

      // 出品日のハイライト（日数部分だけ）
      if (settings.alertDaysFromListing && data.listedElapsedDays) {
        const elapsedDays = parseFloat(data.listedElapsedDays);
        if (!isNaN(elapsedDays) && elapsedDays >= settings.alertDaysFromListing) {
          console.log('📅 出品経過日数:', elapsedDays);

          // 出品日時の日付部分だけをハイライト
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            if (el.children.length > 2) return; // リーフ要素のみ
            const text = el.textContent?.trim() || '';
            // 「210日前」のような形式を探す
            const daysMatch = text.match(/\d+日前/);
            if (daysMatch && !el.dataset.scraperHighlighted) {
              const days = parseInt(daysMatch[0]);
              if (days >= settings.alertDaysFromListing) {
                console.log('✅ 出品日要素発見:', text);
                const pattern = /(\d+日前)/;
                addTextHighlight(el, pattern, 'info');
              }
            }
          });
        }
      }

      // 更新日のハイライト（日数部分だけ）
      if (settings.alertDaysFromUpdate && data.updatedElapsedDays) {
        const elapsedDays = parseFloat(data.updatedElapsedDays);
        if (!isNaN(elapsedDays) && elapsedDays >= settings.alertDaysFromUpdate) {
          console.log('🔄 更新経過日数:', elapsedDays);

          // 更新日時の日付部分だけをハイライト
          const allElements = document.querySelectorAll('*');
          allElements.forEach(el => {
            if (el.children.length > 2) return; // リーフ要素のみ
            const text = el.textContent?.trim() || '';
            // 「149日前」のような形式を探す
            const daysMatch = text.match(/\d+日前/);
            if (daysMatch && !el.dataset.scraperHighlighted) {
              const days = parseInt(daysMatch[0]);
              if (days >= settings.alertDaysFromUpdate) {
                console.log('✅ 更新日要素発見:', text);
                const pattern = /(\d+日前)/;
                addTextHighlight(el, pattern, 'info');
              }
            }
          });
        }
      }
    }

    console.log('✅ ページ要素のハイライト完了');
  }

  // ローディング表示を作成
  const loadingIndicator = document.createElement('div');
  loadingIndicator.id = 'unified-scraper-loading';
  loadingIndicator.innerHTML = '商品情報を取得中...';

  const loadingStyles = {
    position: 'fixed',
    zIndex: '9999',
    padding: '12px 20px',
    backgroundColor: '#f5f5f5',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
  };

  // 位置設定
  if (settings.buttonPosition === 'top-right') {
    loadingStyles.top = currentSite === 'ebay' ? '150px' : '150px';
    loadingStyles.right = '20px';
  } else if (settings.buttonPosition === 'bottom-right') {
    loadingStyles.bottom = '20px';
    loadingStyles.right = '20px';
  }

  Object.assign(loadingIndicator.style, loadingStyles);
  document.body.appendChild(loadingIndicator);

  // ページ読み込み待機
  let waitTime = currentSite === 'ebay' ? (settings.waitTime * 1000) :
                 currentSite === 'rakuten' ? (settings.checkDelay * 1000) : 2000;

  if (currentSite === 'ebay') {
    // カウントダウン表示
    let countdown = Math.ceil(waitTime / 1000);
    loadingIndicator.innerHTML = `商品情報を取得中... (${countdown}秒)`;

    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        loadingIndicator.innerHTML = `商品情報を取得中... (${countdown}秒)`;
      } else {
        loadingIndicator.innerHTML = '商品情報を取得中... (もう少し)';
        clearInterval(countdownInterval);
      }
    }, 1000);
  }

  await new Promise(resolve => setTimeout(resolve, waitTime));

  // eBay用の追加待機
  if (currentSite === 'ebay') {
    let retryCount = 0;
    const maxRetries = 10;
    while (retryCount < maxRetries) {
      const itemSpecSection = document.querySelector('div[class*="ux-layout-section--itemDetails"]');
      if (itemSpecSection) {
        console.log(`Item specificsセクションを検出 (${retryCount * 500}ms後)`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      retryCount++;
    }
  }

  // サイト別の読み込み待機時間を適用（秒→ミリ秒に変換）
  const loadDelays = {
    'amazon': (settings.amazonLoadDelay || 0) * 1000,
    'ebay': (settings.ebayLoadDelay || 0) * 1000,
    'rakuten': (settings.rakutenLoadDelay || 0) * 1000,
    'mercari': (settings.mercariLoadDelay || 0) * 1000,
    'mercari_shop': (settings.mercariLoadDelay || 0) * 1000,
    'yahuoku': (settings.yahooLoadDelay || 0) * 1000,
    'yahooshopping': (settings.yahooLoadDelay || 0) * 1000,
    'paypayfurima': (settings.paypayLoadDelay || 0) * 1000,
    'rakuma': (settings.frilLoadDelay || 0) * 1000
  };

  const delayMs = loadDelays[currentSite] || 0;
  if (delayMs > 0) {
    console.log(`⏱️ ${currentSite}の画像読み込みを待機中... (${delayMs / 1000}秒)`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  // 商品情報を抽出
  let extractedData = null;
  try {
    if (currentSite === 'ebay') {
      extractedData = extractEbayProductInfo();
    } else if (currentSite === 'rakuten') {
      extractedData = extractRakutenProductInfo(settings);
    } else if (currentSite === 'amazon') {
      extractedData = extractAmazonProductData();
    } else if (currentSite === 'mercari') {
      extractedData = await extractMercariProductData();
    } else if (currentSite === 'mercari_shop') {
      // メルカリショップは通常のメルカリと同じ構造なので、同じ関数を使用
      extractedData = await extractMercariProductData();
      // プラットフォーム名だけ変更
      if (extractedData && !extractedData.error) {
        extractedData.platform = 'mercari_shop';
      }
    } else if (currentSite === 'yahuoku') {
      extractedData = extractYahooProductData();
    } else if (currentSite === 'paypayfurima') {
      extractedData = extractPayPayProductData();
    } else if (currentSite === 'rakuma') {
      extractedData = extractFrilProductData();
    } else if (currentSite === 'yahooshopping') {
      extractedData = extractYahooShoppingProductData();
    }

    if (extractedData && extractedData.error) {
      loadingIndicator.remove();
      showNotification('エラー', extractedData.error, 'error', colors);
      return;
    }

    if (currentSite === 'amazon' && (!extractedData || !extractedData.asin || extractedData.asin === 'N/A')) {
      loadingIndicator.remove();
      showNotification('エラー', '商品情報の取得に失敗しました', 'error', colors);
      return;
    }

    if ((currentSite === 'mercari' || currentSite === 'mercari_shop' || currentSite === 'yahuoku' || currentSite === 'paypayfurima' || currentSite === 'rakuma') && (!extractedData || !extractedData.url)) {
      loadingIndicator.remove();
      showNotification('エラー', '商品情報の取得に失敗しました', 'error', colors);
      return;
    }
  } catch (error) {
    loadingIndicator.remove();
    showNotification('エラー', 'データの抽出に失敗しました: ' + error.message, 'error', colors);
    return;
  }

  loadingIndicator.remove();

  console.log('✅ データ抽出完了、ボタン作成開始');

  // ページ要素をハイライト表示（少し遅延させてDOM構築完了を待つ）
  let detectedKeywords = null;
  setTimeout(() => {
    try {
      console.log('🎨 ハイライト実行開始（遅延後）');
      detectedKeywords = highlightPageElements();

      // フリマサイトの場合、キーワード検出結果をバッジに反映
      if ((currentSite === 'mercari' || currentSite === 'mercari_shop' || currentSite === 'yahuoku' || currentSite === 'paypayfurima' || currentSite === 'rakuma') && detectedKeywords) {
        const existingBadge = document.getElementById('unified-scraper-alerts');
        if (existingBadge) {
          existingBadge.remove();
        }
        showAlertBadges(extractedData, detectedKeywords);
      }
    } catch (error) {
      console.error('❌ ハイライト表示エラー:', error);
    }
  }, 500);

  // フリマサイトの場合、アラートバッジとページ要素ハイライトを表示
  if (currentSite === 'mercari' || currentSite === 'mercari_shop' || currentSite === 'yahuoku' || currentSite === 'paypayfurima' || currentSite === 'rakuma') {
    try {
      showAlertBadges(extractedData, null);

      // ページ要素ハイライトも少し遅延
      setTimeout(() => {
        try {
          console.log('🚨 アラートハイライト実行開始（遅延後）');
          highlightAlertElements(extractedData);
        } catch (error) {
          console.error('❌ アラートハイライトエラー:', error);
        }
      }, 500);
    } catch (error) {
      console.error('❌ アラートバッジ表示エラー:', error);
    }
  }

  // 保存された位置を取得
  let buttonPosition = null;
  try {
    const saved = await chrome.storage.local.get(['buttonPosition']);
    if (saved.buttonPosition) {
      buttonPosition = saved.buttonPosition;
    }
  } catch (e) {
    console.log('ボタン位置の読み込みに失敗、デフォルト位置を使用');
  }

  // デフォルト位置の設定
  if (!buttonPosition) {
    if (settings.buttonPosition === 'bottom-right') {
      buttonPosition = { bottom: 20, right: 20 };
    } else {
      buttonPosition = { top: currentSite === 'ebay' ? 150 : currentSite === 'amazon' ? 100 : 150, right: 20 };
    }
  }

  console.log('📍 ボタン位置:', buttonPosition);

  // ボタンを作成
  // ボタンコンテナを作成
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'unified-scraper-button-container';

  const containerStyles = {
    position: 'fixed',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };

  // 位置を設定
  if ('top' in buttonPosition) {
    containerStyles.top = `${buttonPosition.top}px`;
  } else if ('bottom' in buttonPosition) {
    containerStyles.bottom = `${buttonPosition.bottom}px`;
  }
  if ('right' in buttonPosition) {
    containerStyles.right = `${buttonPosition.right}px`;
  }

  Object.assign(buttonContainer.style, containerStyles);

  // 上段の行（内容確認 + コピー）
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display: flex; gap: 8px; width: 100%;';

  // 1. 内容確認ボタン
  const previewButton = document.createElement('button');
  previewButton.id = 'unified-scraper-preview-btn';
  previewButton.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2L2 6V10C2 14.5 5 18.5 10 20C15 18.5 18 14.5 18 10V6L10 2Z" fill="white"/>
      <path d="M8 10L10 12L14 8" stroke="${colors.primary}" stroke-width="2"/>
    </svg>
    内容確認
  `;

  const previewButtonStyles = {
    padding: '10px 12px',
    backgroundColor: colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'move',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    boxShadow: `0 4px 12px ${colors.primary}4d`,
    transition: 'background-color 0.2s',
    userSelect: 'none',
    flex: '1',
    whiteSpace: 'nowrap'
  };

  Object.assign(previewButton.style, previewButtonStyles);

  // 2. コピーボタン
  const copyButton = document.createElement('button');
  copyButton.id = 'unified-scraper-copy-btn';
  copyButton.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="10" height="12" rx="1" stroke="white" stroke-width="2" fill="none"/>
      <path d="M6 4V2H16V14H14" stroke="white" stroke-width="2" fill="none"/>
    </svg>
    コピー
  `;

  const copyButtonStyles = {
    padding: '10px 12px',
    backgroundColor: '#FF9800',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    boxShadow: '0 4px 12px #FF98004d',
    transition: 'all 0.2s',
    userSelect: 'none',
    flex: '1',
    whiteSpace: 'nowrap'
  };

  Object.assign(copyButton.style, copyButtonStyles);

  // 上段にボタンを追加
  topRow.appendChild(previewButton);
  topRow.appendChild(copyButton);

  // 3. ダイレクトエクスポートボタン（下段）
  const exportButton = document.createElement('button');
  exportButton.id = 'unified-scraper-export-btn';
  exportButton.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2L2 6V10C2 14.5 5 18.5 10 20C15 18.5 18 14.5 18 10V6L10 2Z" fill="white"/>
      <path d="M6 10L10 14L10 6M10 14L14 10" stroke="${colors.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    直接エクスポート
  `;

  const exportButtonStyles = {
    padding: '10px 16px',
    backgroundColor: '#2196F3',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    boxShadow: '0 4px 12px #2196F34d',
    transition: 'all 0.2s',
    userSelect: 'none',
    width: '100%',
    whiteSpace: 'nowrap'
  };

  Object.assign(exportButton.style, exportButtonStyles);

  // コンテナにボタンを追加
  buttonContainer.appendChild(topRow);
  buttonContainer.appendChild(exportButton);

  // ドラッグ機能（コンテナ全体をドラッグ）
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let containerStartTop = 0;
  let containerStartBottom = 0;
  let containerStartRight = 0;
  let isUsingTop = 'top' in buttonPosition;

  previewButton.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    if (buttonContainer.style.top) {
      containerStartTop = parseInt(buttonContainer.style.top);
      isUsingTop = true;
    } else {
      containerStartBottom = parseInt(buttonContainer.style.bottom);
      isUsingTop = false;
    }
    containerStartRight = parseInt(buttonContainer.style.right);

    previewButton.style.cursor = 'grabbing';
    previewButton.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const deltaX = dragStartX - e.clientX;
    const deltaY = e.clientY - dragStartY;
    const newRight = containerStartRight + deltaX;

    // 楽天の場合はtop/bottomの切り替え機能
    if (currentSite === 'rakuten') {
      if (e.clientY < window.innerHeight / 2) {
        const newTop = isUsingTop ? containerStartTop + deltaY : (window.innerHeight - containerStartBottom - buttonContainer.offsetHeight - deltaY);
        buttonContainer.style.top = `${Math.max(0, Math.min(newTop, window.innerHeight - buttonContainer.offsetHeight))}px`;
        buttonContainer.style.bottom = '';
        isUsingTop = true;
      } else {
        const newBottom = isUsingTop ? (window.innerHeight - containerStartTop - buttonContainer.offsetHeight - deltaY) : containerStartBottom - deltaY;
        buttonContainer.style.bottom = `${Math.max(0, Math.min(newBottom, window.innerHeight - buttonContainer.offsetHeight))}px`;
        buttonContainer.style.top = '';
        isUsingTop = false;
      }
    } else {
      // eBay、Amazon用
      const newTop = containerStartTop + deltaY;
      const maxTop = window.innerHeight - buttonContainer.offsetHeight;
      buttonContainer.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
    }

    const maxRight = window.innerWidth - buttonContainer.offsetWidth;
    buttonContainer.style.right = `${Math.max(0, Math.min(newRight, maxRight))}px`;
  });

  document.addEventListener('mouseup', async (e) => {
    if (!isDragging) return;

    isDragging = false;
    previewButton.style.cursor = 'move';
    previewButton.style.transition = 'background-color 0.2s';

    // 位置を保存
    const newPosition = {};
    if (buttonContainer.style.top) {
      newPosition.top = parseInt(buttonContainer.style.top);
    } else {
      newPosition.bottom = parseInt(buttonContainer.style.bottom);
    }
    newPosition.right = parseInt(buttonContainer.style.right);

    try {
      await chrome.storage.local.set({ buttonPosition: newPosition });
      console.log('ボタン位置を保存しました:', newPosition);
    } catch (e) {
      console.log('ボタン位置の保存に失敗しました');
    }
  });

  previewButton.addEventListener('mouseenter', () => {
    if (!isDragging) {
      previewButton.style.backgroundColor = colors.hover;
    }
  });

  previewButton.addEventListener('mouseleave', () => {
    if (!isDragging) {
      previewButton.style.backgroundColor = colors.primary;
    }
  });

  copyButton.addEventListener('mouseenter', () => {
    copyButton.style.backgroundColor = '#FB8C00';
  });

  copyButton.addEventListener('mouseleave', () => {
    copyButton.style.backgroundColor = '#FF9800';
  });

  // 1. 内容確認ボタンクリック
  previewButton.addEventListener('click', (e) => {
    const moveDistance = Math.sqrt(
      Math.pow(e.clientX - dragStartX, 2) + Math.pow(e.clientY - dragStartY, 2)
    );
    if (moveDistance < 5) {
      showPreviewModal(extractedData, currentSite, colors, settings);
    }
  });

  // 2. コピーボタンクリック（直接クリップボードにコピー）
  copyButton.addEventListener('click', async (e) => {
    e.stopPropagation(); // イベント伝播を停止

    try {
      // 既存のcopyToClipboard関数を使用
      await copyToClipboard(extractedData, currentSite, colors, settings);

      // 成功フィードバック
      const originalText = copyButton.innerHTML;
      copyButton.innerHTML = '✓ コピー完了！';
      copyButton.style.backgroundColor = '#4CAF50';

      setTimeout(() => {
        copyButton.innerHTML = originalText;
        copyButton.style.backgroundColor = '#FF9800';
      }, 2000);
    } catch (error) {
      console.error('コピーエラー:', error);
      alert('クリップボードへのコピーに失敗しました');
    }
  });

  // エクスポートボタンのホバーエフェクト
  exportButton.addEventListener('mouseenter', () => {
    exportButton.style.backgroundColor = '#1976D2';
    exportButton.style.transform = 'translateY(-2px)';
    exportButton.style.boxShadow = '0 6px 16px rgba(33, 150, 243, 0.4)';
  });

  exportButton.addEventListener('mouseleave', () => {
    exportButton.style.backgroundColor = '#2196F3';
    exportButton.style.transform = 'translateY(0)';
    exportButton.style.boxShadow = '0 4px 12px #2196F34d';
  });

  // エクスポートボタンクリック（直接エクスポート）
  exportButton.addEventListener('click', async (e) => {
    e.preventDefault();

    // ボタンを無効化して処理中表示
    exportButton.disabled = true;
    const originalText = exportButton.innerHTML;
    exportButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="8" stroke="white" stroke-width="2" fill="none" opacity="0.25"/>
        <path d="M10 2 A 8 8 0 0 1 18 10" stroke="white" stroke-width="2" fill="none" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="1s" repeatCount="indefinite"/>
        </path>
      </svg>
      エクスポート中...
    `;
    exportButton.style.cursor = 'wait';
    exportButton.style.backgroundColor = '#1976D2';

    try {
      // データをエクスポート（モーダル表示なし）
      await exportToSpreadsheet(extractedData, currentSite, colors);
    } catch (error) {
      console.error('Direct export error:', error);
      showNotification(
        'エラー',
        'エクスポートに失敗しました: ' + (error.message || '不明なエラー'),
        'error',
        colors
      );
    } finally {
      // ボタンを元に戻す
      exportButton.disabled = false;
      exportButton.innerHTML = originalText;
      exportButton.style.cursor = 'pointer';
      exportButton.style.backgroundColor = '#2196F3';
    }
  });

  // インライン配置（楽天用）
  if (currentSite === 'rakuten' && settings.buttonPosition === 'inline') {
    console.log('🎯 楽天インライン配置モード');
    const priceSelectors = [
      'span[class*="price"]',
      'div[class*="price"]',
      '.price2',
      '[itemprop="price"]',
      '.item_price',
      '.rakutenprice'
    ];

    let priceElement = null;
    for (const selector of priceSelectors) {
      priceElement = document.querySelector(selector);
      if (priceElement) break;
    }

    if (priceElement) {
      console.log('✅ 価格要素の隣に配置');
      buttonContainer.style.position = 'relative';
      buttonContainer.style.marginTop = '15px';
      buttonContainer.style.display = 'flex';
      button.style.cursor = 'pointer';
      buttonContainer.style.top = '';
      buttonContainer.style.bottom = '';
      buttonContainer.style.right = '';
      priceElement.parentElement.insertBefore(buttonContainer, priceElement.nextSibling);
    } else {
      console.log('⚠️ 価格要素が見つからないため、body に追加');
      document.body.appendChild(buttonContainer);
    }
  } else {
    console.log('✅ ボタンコンテナを body に追加');
    document.body.appendChild(buttonContainer);
  }

  console.log('🎉 ボタン配置完了！');

  // プレビューモーダル表示関数
  async function showPreviewModal(data, site, colors, settings) {
    console.log('🎨 モーダル表示開始');
    console.log('📦 データ:', data);
    console.log('🖼️ 画像URL:', data.imageUrl);

    const existingModal = document.getElementById('unified-scraper-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // キーワード検出
    // alertKeywords（オプション画面の「除外キーワード」）を赤ハイライト用に使用
    // popupKeywords（オプション画面の「注目キーワード」）を黄色ハイライト用に使用
    const excludeKeywords = Array.isArray(settings.alertKeywords) ? settings.alertKeywords.filter(k => k.trim()) : (typeof settings.alertKeywords === 'string' && settings.alertKeywords ? settings.alertKeywords.split('\n').filter(k => k.trim()) : []);
    const attentionKeywords = Array.isArray(settings.popupKeywords) ? settings.popupKeywords.filter(k => k.trim()) : (typeof settings.popupKeywords === 'string' && settings.popupKeywords ? settings.popupKeywords.split('\n').filter(k => k.trim()) : []);

    // タイトルと説明文の両方でキーワード検出
    const title = data.title || data.name || '';
    const description = site === 'amazon' ? data.details : data.description;
    const titleDetection = detectKeywords(title, excludeKeywords, attentionKeywords);
    const descDetection = detectKeywords(description, excludeKeywords, attentionKeywords);

    // 両方の検出結果をマージ
    const keywordDetection = {
      excludeMatches: [...new Set([...titleDetection.excludeMatches, ...descDetection.excludeMatches])],
      alertMatches: [...new Set([...titleDetection.alertMatches, ...descDetection.alertMatches])],
      hasExclude: titleDetection.hasExclude || descDetection.hasExclude,
      hasAlert: titleDetection.hasAlert || descDetection.hasAlert
    };

    // 検出されたキーワードをカンマ区切りで保存（AI列に出力）
    const detectedKeywords = [...keywordDetection.excludeMatches, ...keywordDetection.alertMatches].join(', ');
    data.keywords = detectedKeywords;

    // フリマサイトのアラート判定
    const furimaAlerts = [];
    if (site === 'mercari' || site === 'mercari_shop' || site === 'yahuoku' || site === 'paypayfurima' || site === 'rakuma') {
      console.log('🔍 アラート判定開始');
      console.log('設定値:', {
        alertBadRate: settings.alertBadRate,
        alertLowReviewCount: settings.alertLowReviewCount,
        alertDaysFromListing: settings.alertDaysFromListing,
        alertDaysFromUpdate: settings.alertDaysFromUpdate
      });
      console.log('商品データ:', {
        badRate: data.badRate,
        reviewCount: data.reviewCount,
        listedElapsedDays: data.listedElapsedDays,
        updatedElapsedDays: data.updatedElapsedDays
      });

      // 悪い評価率のアラート
      if (settings.alertBadRate && data.badRate) {
        const badRate = parseFloat(data.badRate);
        if (!isNaN(badRate) && badRate >= settings.alertBadRate) {
          furimaAlerts.push({
            type: 'warning',
            title: '⚠️ 悪い評価率が高い',
            message: `悪い評価率: ${badRate}%（設定値: ${settings.alertBadRate}%以上）`
          });
        }
      }

      // 評価件数のアラート
      if (settings.alertLowReviewCount && data.reviewCount) {
        const reviewCount = parseInt(data.reviewCount);
        if (!isNaN(reviewCount) && reviewCount <= settings.alertLowReviewCount) {
          furimaAlerts.push({
            type: 'warning',
            title: '⚠️ 評価件数が少ない',
            message: `評価件数: ${reviewCount}件（設定値: ${settings.alertLowReviewCount}件以下）`
          });
        }
      } else if (!data.reviewCount || data.reviewCount === '') {
        // 評価件数が取得できなかった場合
        furimaAlerts.push({
          type: 'warning',
          title: '⚠️ 評価件数が取得できませんでした',
          message: '出品者の評価件数を取得できませんでした。手動で確認してください'
        });
      }

      // 出品経過日数のアラート
      if (settings.alertDaysFromListing && data.listedElapsedDays) {
        const elapsedDays = parseFloat(data.listedElapsedDays);
        if (!isNaN(elapsedDays) && elapsedDays >= settings.alertDaysFromListing) {
          furimaAlerts.push({
            type: 'info',
            title: '📅 出品から時間が経過',
            message: `出品からの経過日数: ${Math.floor(elapsedDays)}日（設定値: ${settings.alertDaysFromListing}日以上）`
          });
        }
      }

      // 更新経過日数のアラート
      if (settings.alertDaysFromUpdate && data.updatedElapsedDays) {
        const elapsedDays = parseFloat(data.updatedElapsedDays);
        if (!isNaN(elapsedDays) && elapsedDays >= settings.alertDaysFromUpdate) {
          furimaAlerts.push({
            type: 'info',
            title: '🔄 更新から時間が経過',
            message: `更新からの経過日数: ${Math.floor(elapsedDays)}日（設定値: ${settings.alertDaysFromUpdate}日以上）`
          });
        }
      }

      // 発送日数のアラート（4日以上）
      if (settings.alertHandlingDays && data.handlingDays) {
        const handlingDaysText = data.handlingDays.toString();
        const rangeMatch = handlingDaysText.match(/(\d+)[〜～~](\d+)/);
        const singleMatch = handlingDaysText.match(/(\d+)/);

        let maxDays = 0;
        if (rangeMatch) {
          maxDays = parseInt(rangeMatch[2]);
        } else if (singleMatch) {
          maxDays = parseInt(singleMatch[1]);
        }

        if (maxDays >= 8) {
          furimaAlerts.push({
            type: 'error',
            title: '🚨 発送日数がとても長い',
            message: `発送までの日数: ${handlingDaysText}（8日以上）`
          });
        } else if (maxDays >= 4) {
          furimaAlerts.push({
            type: 'warning',
            title: '📦 発送日数が長い',
            message: `発送までの日数: ${handlingDaysText}`
          });
        }
      }
    }

    console.log('🔔 フリマアラート判定結果:', furimaAlerts);

    const overlay = document.createElement('div');
    overlay.id = 'unified-scraper-modal';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background-color: white;
      border-radius: 12px;
      padding: 30px;
      max-width: 800px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      animation: slideUp 0.3s;
    `;

    let modalContent = '';

    if (site === 'amazon') {
      // 画像ギャラリー
      const imageUrls = data.imageUrl ? data.imageUrl.split(',').map(url => url.trim()) : [];

      modalContent = `
        <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px; border-bottom: 2px solid ${colors.primary}; padding-bottom: 10px;">
          商品情報の確認・編集
        </h2>

        ${imageUrls.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <div style="position: relative; text-align: center; background: #f5f5f5; border-radius: 8px; padding: 20px;">
            <img id="gallery-image" src="${imageUrls[0]}" alt="商品画像" style="max-width: 400px; max-height: 400px; border: 1px solid #ddd; border-radius: 8px; object-fit: contain;">
            ${imageUrls.length > 1 ? `
              <button id="gallery-prev" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">‹</button>
              <button id="gallery-next" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">›</button>
              <div style="font-size: 12px; color: #666; margin-top: 10px;">
                <span id="gallery-counter">1</span> / ${imageUrls.length}
              </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            プラットフォーム
          </label>
          <input type="text" id="preview-platform" value="${data.supplier}" readonly
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5; font-size: 14px;">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            ASIN
          </label>
          <input type="text" id="preview-asin" value="${data.asin}" readonly
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5; font-size: 14px;">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            🔸 価格<span style="color: ${colors.primary}; font-size: 12px; margin-left: 8px;">※要確認</span>
          </label>
          <input type="text" id="preview-price" value="${data.price}"
            style="width: 100%; padding: 10px; border: 2px solid #ff9800; border-radius: 4px; font-size: 16px; font-weight: bold;">
          <div style="font-size: 12px; color: #666; margin-top: 5px;">
            抽出された価格が正しいか確認してください。誤っている場合は修正できます。
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            商品名
          </label>
          ${titleDetection.hasExclude || titleDetection.hasAlert ? `
            <div id="title-preview" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: white; margin-bottom: 10px; line-height: 1.6;">${highlightKeywords(data.title || '', excludeKeywords, attentionKeywords)}</div>
          ` : ''}
          <textarea id="preview-name" rows="2"
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; resize: vertical;">${data.title}</textarea>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            🔸 商品詳細<span style="color: ${colors.primary}; font-size: 12px; margin-left: 8px;">※要確認</span>
          </label>
          ${keywordDetection.hasExclude || keywordDetection.hasAlert ? `
            <div style="margin-bottom: 10px; padding: 12px; border-radius: 6px; background: #f5f5f5; border-left: 4px solid ${keywordDetection.hasExclude ? '#ff5252' : '#ffeb3b'};">
              ${keywordDetection.hasExclude ? `
                <div style="margin-bottom: ${keywordDetection.hasAlert ? '8px' : '0'};">
                  <strong style="color: #ff5252;">🚨 除外キーワード検出</strong>
                  <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    ${keywordDetection.excludeMatches.map(kw => `<span style="background: #ff5252; color: white; padding: 2px 6px; border-radius: 3px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${kw}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
              ${keywordDetection.hasAlert ? `
                <div>
                  <strong style="color: #f57c00;">⚠️ 注目キーワード検出</strong>
                  <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    ${keywordDetection.alertMatches.map(kw => `<span style="background: #ffeb3b; color: #000; padding: 2px 6px; border-radius: 3px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${kw}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          ` : ''}
          <div id="description-preview" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: white; max-height: 200px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word; line-height: 1.6; margin-bottom: 10px;">${highlightKeywords(data.details || '', excludeKeywords, attentionKeywords)}</div>
          <textarea id="preview-description" rows="8"
            style="width: 100%; padding: 10px; border: 2px solid #ff9800; border-radius: 4px; font-size: 14px; resize: vertical;">${data.details}</textarea>
          <div style="font-size: 12px; color: #666; margin-top: 5px;">
            不要な情報や重複した内容があれば削除してください。
          </div>
        </div>

        <div style="margin-bottom: 30px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            出品者
          </label>
          <input type="text" id="preview-seller" value="${data.sellerId}"
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
        </div>
      `;
    } else if (site === 'mercari' || site === 'mercari_shop' || site === 'yahuoku' || site === 'paypayfurima' || site === 'rakuma') {
      // フリマサイト（38フィールド表示）
      console.log('🏪 フリマサイトモーダル表示');

      // 画像ギャラリー（配列または文字列に対応）
      const imageUrls = Array.isArray(data.imageUrl)
        ? data.imageUrl.filter(url => url)
        : data.imageUrl
          ? data.imageUrl.split(',').map(url => url.trim())
          : [];

      const imageCount = imageUrls.length;

      modalContent = `
        <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px; border-bottom: 2px solid ${colors.primary}; padding-bottom: 10px;">
          🏪 フリマ商品情報の確認（38フィールド）
        </h2>

        ${furimaAlerts.length > 0 ? `
        <div style="margin-bottom: 20px; padding: 18px; border-radius: 8px; background: #ffebee; border: 3px solid #f44336; box-shadow: 0 4px 12px rgba(244, 67, 54, 0.3);">
          <h3 style="margin: 0 0 15px 0; color: #c62828; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 24px;">🚨</span>
            <span>アラート通知</span>
          </h3>
          ${furimaAlerts.map(alert => `
            <div style="padding: 12px; margin-bottom: 10px; border-radius: 6px; background: white; border-left: 4px solid #f44336; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="font-weight: 700; color: #d32f2f; margin-bottom: 6px; font-size: 15px;">${alert.title}</div>
              <div style="font-size: 14px; color: #333; font-weight: 500;">${alert.message}</div>
            </div>
          `).join('')}
        </div>
        ` : ''}

        ${imageUrls.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <div style="position: relative; text-align: center; background: #f5f5f5; border-radius: 8px; padding: 20px;">
            <img id="gallery-image" src="${imageUrls[0]}" alt="商品画像" style="max-width: 400px; max-height: 400px; border: 1px solid #ddd; border-radius: 8px; object-fit: contain;">
            ${imageUrls.length > 1 ? `
              <button id="gallery-prev" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">‹</button>
              <button id="gallery-next" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">›</button>
              <div style="font-size: 12px; color: #666; margin-top: 10px;">
                <span id="gallery-counter">1</span> / ${imageUrls.length}枚（最大20枚）
              </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <!-- 基本情報セクション -->
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 15px 0; color: #333; font-size: 16px; font-weight: 600;">📦 基本情報（1-6列）</h3>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">1. プラットフォーム</label>
              <input type="text" id="preview-platform" value="${data.platform || ''}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff; font-size: 13px;">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">3. 価格</label>
              <input type="text" id="preview-price" value="${data.price || ''}" style="width: 100%; padding: 8px; border: 2px solid #ff9800; border-radius: 4px; font-size: 13px; font-weight: bold;">
            </div>
          </div>

          <div style="margin-bottom: 10px;">
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">2. 商品URL</label>
            <input type="text" id="preview-url" value="${data.url || ''}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
          </div>

          <div style="margin-bottom: 10px;">
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">4. 商品名</label>
            ${titleDetection.hasExclude || titleDetection.hasAlert ? `
              <div id="title-preview" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: white; margin-bottom: 8px; line-height: 1.5;">${highlightKeywords(data.name || '', excludeKeywords, attentionKeywords)}</div>
            ` : ''}
            <textarea id="preview-name" rows="2" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; resize: vertical;">${data.name || ''}</textarea>
          </div>

          <div style="margin-bottom: 10px;">
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">5. 説明</label>
            ${keywordDetection.hasExclude || keywordDetection.hasAlert ? `
              <div style="margin-bottom: 8px; padding: 10px; border-radius: 4px; background: #f5f5f5; border-left: 4px solid ${keywordDetection.hasExclude ? '#ff5252' : '#ffeb3b'};">
                ${keywordDetection.hasExclude ? `
                  <div style="margin-bottom: 6px;">
                    <strong style="color: #ff5252;">🚨 除外キーワード検出</strong>
                    <div style="font-size: 12px; color: #666; margin-top: 4px;">
                      ${keywordDetection.excludeMatches.map(kw => `<span style="background: #ff5252; color: white; padding: 2px 6px; border-radius: 3px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${kw}</span>`).join('')}
                    </div>
                  </div>
                ` : ''}
                ${keywordDetection.hasAlert ? `
                  <div>
                    <strong style="color: #f57c00;">⚠️ 注目キーワード検出</strong>
                    <div style="font-size: 12px; color: #666; margin-top: 4px;">
                      ${keywordDetection.alertMatches.map(kw => `<span style="background: #ffeb3b; color: #000; padding: 2px 6px; border-radius: 3px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${kw}</span>`).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            ` : ''}
            <div id="description-preview" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: white; max-height: 150px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5;">${highlightKeywords(data.description || '', excludeKeywords, attentionKeywords)}</div>
            <textarea id="preview-description" rows="4" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; resize: vertical; margin-top: 8px;">${data.description || ''}</textarea>
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">6. 出品者</label>
            <input type="text" id="preview-seller" value="${data.seller || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px;">
          </div>
        </div>

        <!-- 画像情報セクション -->
        <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px; font-weight: 600;">🖼️ 画像情報（7-26列）</h3>
          <div style="font-size: 13px; color: #555;">
            画像枚数: <strong>${imageCount}</strong>枚 / 20枚<br>
            <span style="font-size: 12px; color: #666;">※ギャラリーで確認できます</span>
          </div>
        </div>

        <!-- フリマ固有情報セクション -->
        <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 15px 0; color: #333; font-size: 16px; font-weight: 600;">📋 フリマ固有情報（27-38列）</h3>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">27. 評価件数</label>
              <input type="text" value="${data.reviewCount || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: ${settings.alertLowReviewCount && data.reviewCount && parseInt(data.reviewCount) <= settings.alertLowReviewCount ? '#ffcdd2' : '#f5f5f5'}; font-size: 13px; font-weight: ${settings.alertLowReviewCount && data.reviewCount && parseInt(data.reviewCount) <= settings.alertLowReviewCount ? 'bold' : 'normal'};">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">28. 悪い評価率</label>
              <input type="text" value="${data.badRate || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: ${settings.alertBadRate && data.badRate && parseFloat(data.badRate) >= settings.alertBadRate ? '#ffcdd2' : '#f5f5f5'}; font-size: 13px; font-weight: ${settings.alertBadRate && data.badRate && parseFloat(data.badRate) >= settings.alertBadRate ? 'bold' : 'normal'};">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">29. 出品日時</label>
              <input type="text" value="${data.listedFmt || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">30. 更新日時</label>
              <input type="text" value="${data.updatedFmt || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">31. 発送日数</label>
              <input type="text" value="${data.handlingDays || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">32. 出品経過日数</label>
              <input type="text" value="${data.listedElapsedDays || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: ${settings.alertDaysFromListing && data.listedElapsedDays && parseFloat(data.listedElapsedDays) >= settings.alertDaysFromListing ? '#ffcdd2' : '#f5f5f5'}; font-size: 13px; font-weight: ${settings.alertDaysFromListing && data.listedElapsedDays && parseFloat(data.listedElapsedDays) >= settings.alertDaysFromListing ? 'bold' : 'normal'};">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">33. 更新経過日数</label>
              <input type="text" value="${data.updatedElapsedDays || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: ${settings.alertDaysFromUpdate && data.updatedElapsedDays && parseFloat(data.updatedElapsedDays) >= settings.alertDaysFromUpdate ? '#ffcdd2' : '#f5f5f5'}; font-size: 13px; font-weight: ${settings.alertDaysFromUpdate && data.updatedElapsedDays && parseFloat(data.updatedElapsedDays) >= settings.alertDaysFromUpdate ? 'bold' : 'normal'};">
            </div>
          </div>

          <div style="margin-bottom: 10px;">
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">34. 検知キーワード</label>
            <input type="text" value="${data.keywords || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">35. 商品の状態</label>
              <input type="text" value="${data.condition || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">36. 配送料の負担</label>
              <input type="text" value="${data.shippingPayer || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">37. 配送方法</label>
              <input type="text" value="${data.shippingMethod || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
            <div>
              <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">38. 発送元の地域</label>
              <input type="text" value="${data.shipFrom || '-'}" readonly style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; font-size: 13px;">
            </div>
          </div>
        </div>
      `;
    } else {
      // eBay, 楽天, Yahoo!ショッピング
      const priceLabel = (site === 'rakuten' || site === 'yahooshopping') ? '価格（送料込み）' : '価格';
      const priceType = (site === 'rakuten' || site === 'yahooshopping') ? 'number' : 'number';
      const priceStep = site === 'rakuten' ? '' : 'step="0.01"';

      // 画像ギャラリー（配列または文字列に対応）
      const imageUrls = Array.isArray(data.imageUrl)
        ? data.imageUrl.filter(url => url)
        : data.imageUrl
          ? data.imageUrl.split(',').map(url => url.trim())
          : [];

      modalContent = `
        <h2 style="margin: 0 0 20px 0; color: #333; font-size: 20px; border-bottom: 2px solid ${colors.primary}; padding-bottom: 10px;">
          商品情報の確認・編集
        </h2>

        ${imageUrls.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <div style="position: relative; text-align: center; background: #f5f5f5; border-radius: 8px; padding: 20px;">
            <img id="gallery-image" src="${imageUrls[0]}" alt="商品画像" style="max-width: 400px; max-height: 400px; border: 1px solid #ddd; border-radius: 8px; object-fit: contain;">
            ${imageUrls.length > 1 ? `
              <button id="gallery-prev" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">‹</button>
              <button id="gallery-next" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; font-size: 20px; cursor: pointer;">›</button>
              <div style="font-size: 12px; color: #666; margin-top: 10px;">
                <span id="gallery-counter">1</span> / ${imageUrls.length}
              </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            プラットフォーム
          </label>
          <input type="text" id="preview-platform" value="${data.platform}" readonly
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5; font-size: 14px;">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            商品URL
          </label>
          <input type="text" id="preview-url" value="${data.url}" readonly
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5; font-size: 14px;">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            🔸 ${priceLabel}<span style="color: ${colors.primary}; font-size: 12px; margin-left: 8px;">※要確認</span>
          </label>
          <input type="${priceType}" id="preview-price" value="${data.price}" ${priceStep}
            style="width: 100%; padding: 10px; border: 2px solid #ff9800; border-radius: 4px; font-size: 16px; font-weight: bold;">
          <div style="font-size: 12px; color: #666; margin-top: 5px;">
            抽出された価格が正しいか確認してください。誤っている場合は修正できます。
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            商品名
          </label>
          ${titleDetection.hasExclude || titleDetection.hasAlert ? `
            <div id="title-preview" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: white; margin-bottom: 10px; line-height: 1.6;">${highlightKeywords(data.name || '', excludeKeywords, attentionKeywords)}</div>
          ` : ''}
          <textarea id="preview-name" rows="2"
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; resize: vertical;">${data.name}</textarea>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            🔸 商品詳細<span style="color: ${colors.primary}; font-size: 12px; margin-left: 8px;">※要確認</span>
          </label>
          ${keywordDetection.hasExclude || keywordDetection.hasAlert ? `
            <div style="margin-bottom: 10px; padding: 12px; border-radius: 6px; background: #f5f5f5; border-left: 4px solid ${keywordDetection.hasExclude ? '#ff5252' : '#ffeb3b'};">
              ${keywordDetection.hasExclude ? `
                <div style="margin-bottom: ${keywordDetection.hasAlert ? '8px' : '0'};">
                  <strong style="color: #ff5252;">🚨 除外キーワード検出</strong>
                  <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    ${keywordDetection.excludeMatches.map(kw => `<span style="background: #ff5252; color: white; padding: 2px 6px; border-radius: 3px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${kw}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
              ${keywordDetection.hasAlert ? `
                <div>
                  <strong style="color: #f57c00;">⚠️ 注目キーワード検出</strong>
                  <div style="font-size: 12px; color: #666; margin-top: 4px;">
                    ${keywordDetection.alertMatches.map(kw => `<span style="background: #ffeb3b; color: #000; padding: 2px 6px; border-radius: 3px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${kw}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          ` : ''}
          <div id="description-preview" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; background: white; max-height: 200px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word; line-height: 1.6; margin-bottom: 10px;">${highlightKeywords(data.description || '', excludeKeywords, attentionKeywords)}</div>
          <textarea id="preview-description" rows="8"
            style="width: 100%; padding: 10px; border: 2px solid #ff9800; border-radius: 4px; font-size: 14px; resize: vertical;">${data.description}</textarea>
          <div style="font-size: 12px; color: #666; margin-top: 5px;">
            ${(site === 'rakuten' || site === 'yahooshopping') ? '不要な検索タグや重複した情報があれば削除してください。' : '不要な情報や重複した内容があれば削除してください。'}
          </div>
        </div>

        <div style="margin-bottom: 30px;">
          <label style="display: block; font-weight: bold; margin-bottom: 8px; color: #555;">
            出品者
          </label>
          <input type="text" id="preview-seller" value="${data.seller}"
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
        </div>
      `;
    }

    // スプレッドシート選択ドロップダウンを追加
    modalContent += `
      <div id="sheet-selector-container" style="margin-top: 20px; display: none;">
        <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #555;">
          📊 出力先スプレッドシート:
        </label>
        <select id="sheet-selector" style="width: 100%; padding: 10px; border: 2px solid #4CAF50; border-radius: 6px; font-size: 14px; background: white; cursor: pointer;">
          <option value="">読み込み中...</option>
        </select>
      </div>

      <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px;">
        <button id="modal-copy" style="flex: 1; min-width: 150px; padding: 12px 20px; background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.hover} 100%); color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          📋 クリップボードにコピー
        </button>
        <button id="modal-export" style="flex: 1; min-width: 150px; padding: 12px 20px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          📊 スプレッドシートに追加
        </button>
        <button id="modal-cancel" style="flex: 1; min-width: 150px; padding: 12px 20px; background: #f5f5f5; color: #666; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          閉じる
        </button>
      </div>
    `;

    modal.innerHTML = modalContent;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 画像ギャラリー機能を初期化（配列または文字列に対応）
    const imageUrls = Array.isArray(data.imageUrl)
      ? data.imageUrl.filter(url => url)
      : data.imageUrl
        ? data.imageUrl.split(',').map(url => url.trim())
        : [];
    if (imageUrls.length > 1) {
      let currentImageIndex = 0;
      const galleryImage = document.getElementById('gallery-image');
      const galleryCounter = document.getElementById('gallery-counter');
      const prevBtn = document.getElementById('gallery-prev');
      const nextBtn = document.getElementById('gallery-next');

      const updateGallery = () => {
        galleryImage.src = imageUrls[currentImageIndex];
        galleryCounter.textContent = currentImageIndex + 1;
      };

      prevBtn.addEventListener('click', () => {
        currentImageIndex = (currentImageIndex - 1 + imageUrls.length) % imageUrls.length;
        updateGallery();
      });

      nextBtn.addEventListener('click', () => {
        currentImageIndex = (currentImageIndex + 1) % imageUrls.length;
        updateGallery();
      });

      // キーボード操作対応
      const keyHandler = (e) => {
        if (e.key === 'ArrowLeft') {
          currentImageIndex = (currentImageIndex - 1 + imageUrls.length) % imageUrls.length;
          updateGallery();
        } else if (e.key === 'ArrowRight') {
          currentImageIndex = (currentImageIndex + 1) % imageUrls.length;
          updateGallery();
        }
      };
      document.addEventListener('keydown', keyHandler);

      // モーダルを閉じるときにイベントリスナーを削除
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          document.removeEventListener('keydown', keyHandler);
        }
      });
    }

    // スプレッドシート選択ドロップダウンを初期化
    await initSheetSelector();

    // キャンセルボタン
    document.getElementById('modal-cancel').addEventListener('click', () => {
      overlay.remove();
    });

    // コピーボタン
    document.getElementById('modal-copy').addEventListener('click', async () => {
      let editedData;

      if (site === 'amazon') {
        editedData = {
          supplier: document.getElementById('preview-platform').value,
          asin: document.getElementById('preview-asin').value,
          price: document.getElementById('preview-price').value,
          title: document.getElementById('preview-name').value,
          details: document.getElementById('preview-description').value,
          sellerId: document.getElementById('preview-seller').value,
          imageUrl: data.imageUrl // 元のデータから画像URLを保持
        };
      } else {
        editedData = {
          platform: document.getElementById('preview-platform').value,
          url: document.getElementById('preview-url').value,
          price: site === 'rakuten' ? parseInt(document.getElementById('preview-price').value) || 0 : parseFloat(document.getElementById('preview-price').value) || 0,
          name: document.getElementById('preview-name').value,
          description: document.getElementById('preview-description').value,
          seller: document.getElementById('preview-seller').value,
          imageUrl: data.imageUrl // 元のデータから画像URLを保持
        };

        // フリマサイトの追加フィールドを保持
        if (site === 'mercari' || site === 'mercari_shop' || site === 'yahuoku' || site === 'paypayfurima' || site === 'rakuma') {
          editedData.reviewCount = data.reviewCount || '';
          editedData.badRate = data.badRate || '';
          editedData.listedFmt = data.listedFmt || '';
          editedData.updatedFmt = data.updatedFmt || '';
          editedData.handlingDays = data.handlingDays || '';
          editedData.listedElapsedDays = data.listedElapsedDays || '';
          editedData.updatedElapsedDays = data.updatedElapsedDays || '';
          editedData.keywords = data.keywords || '';
          editedData.condition = data.condition || '';
          editedData.shippingPayer = data.shippingPayer || '';
          editedData.shippingMethod = data.shippingMethod || '';
          editedData.shipFrom = data.shipFrom || '';
        }

        // 楽天の場合アラートチェック
        if (site === 'rakuten') {
          const alerts = checkRakutenAlerts(editedData, settings);
          if (alerts.length > 0) {
            const alertMessage = alerts.join('\n');
            if (!confirm(`⚠️ 警告が検出されました:\n\n${alertMessage}\n\nそれでもコピーしますか？`)) {
              return;
            }
          }
        }
      }

      await copyToClipboard(editedData, site, colors, settings);
      overlay.remove();
    });

    // エクスポートボタン
    const exportBtn = document.getElementById('modal-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        // ボタンを一時的に無効化
        exportBtn.disabled = true;
        const originalText = exportBtn.textContent;
        exportBtn.textContent = '送信中...';
        exportBtn.style.cursor = 'wait';

        // 編集された値を取得
        let editedData;
        if (site === 'amazon') {
          editedData = {
            supplier: document.getElementById('preview-platform').value,
            asin: document.getElementById('preview-asin').value,
            price: document.getElementById('preview-price').value,
            title: document.getElementById('preview-name').value,
            details: document.getElementById('preview-description').value,
            sellerId: document.getElementById('preview-seller').value,
            imageUrl: data.imageUrl // 元のデータから画像URLを保持
          };
        } else {
          editedData = {
            platform: document.getElementById('preview-platform').value,
            url: document.getElementById('preview-url').value,
            price: site === 'rakuten' ? parseInt(document.getElementById('preview-price').value) || 0 : parseFloat(document.getElementById('preview-price').value) || 0,
            name: document.getElementById('preview-name').value,
            description: document.getElementById('preview-description').value,
            seller: document.getElementById('preview-seller').value,
            imageUrl: data.imageUrl // 元のデータから画像URLを保持
          };

          // フリマサイトの追加フィールドを保持
          if (site === 'mercari' || site === 'mercari_shop' || site === 'yahuoku' || site === 'paypayfurima' || site === 'rakuma') {
            editedData.reviewCount = data.reviewCount || '';
            editedData.badRate = data.badRate || '';
            editedData.listedFmt = data.listedFmt || '';
            editedData.updatedFmt = data.updatedFmt || '';
            editedData.handlingDays = data.handlingDays || '';
            editedData.listedElapsedDays = data.listedElapsedDays || '';
            editedData.updatedElapsedDays = data.updatedElapsedDays || '';
            editedData.keywords = data.keywords || '';
            editedData.condition = data.condition || '';
            editedData.shippingPayer = data.shippingPayer || '';
            editedData.shippingMethod = data.shippingMethod || '';
            editedData.shipFrom = data.shipFrom || '';
          }
        }

        try {
          await exportToSpreadsheet(editedData, site, colors);
        } catch (error) {
          console.error('Export error:', error);
        } finally {
          // ボタンを再度有効化
          exportBtn.disabled = false;
          exportBtn.textContent = originalText;
          exportBtn.style.cursor = 'pointer';
        }
      });

      // ホバーエフェクト
      exportBtn.addEventListener('mouseenter', () => {
        if (!exportBtn.disabled) {
          exportBtn.style.transform = 'translateY(-2px)';
          exportBtn.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.4)';
        }
      });

      exportBtn.addEventListener('mouseleave', () => {
        exportBtn.style.transform = 'translateY(0)';
        exportBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      });
    }

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    // ESCキーで閉じる
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  async function copyToClipboard(data, site, colors, settings) {
    console.log('📋 クリップボードコピー開始');
    console.log('📊 data.imageUrl:', data.imageUrl);
    console.log('⚙️ settings.enableImageInClipboard:', settings.enableImageInClipboard);
    console.log('⚙️ settings.imageOutputCount:', settings.imageOutputCount);

    let tsvData;

    // フリマサイト（39フィールド: 基本6 + ページURL1 + 画像20 + フリマ12）
    if (site === 'mercari' || site === 'mercari_shop' || site === 'yahuoku' || site === 'paypayfurima' || site === 'rakuma') {
      console.log('🏪 フリマサイト: クリップボードコピー');

      const row = [
        data.platform || '',    // 1. プラットフォーム (A列)
        data.url || '',         // 2. 商品ID (B列)
        data.price || '',       // 3. 価格 (C列)
        data.name || '',        // 4. 商品名 (D列)
        data.description || '', // 5. 説明 (E列)
        data.seller || ''       // 6. 出品者 (F列)
      ];

      // enableImageInClipboard設定で出力範囲を制御
      if (settings.enableImageInClipboard) {
        // 有効時: A〜AM列（全フィールド出力）
        console.log('✅ 全フィールド出力モード（A〜AM列）');

        // 7. ページURL (G列)
        row.push(window.location.href);

        // 8-27. 画像20フィールド (H〜AA列)
        const imageUrls = Array.isArray(data.imageUrl) ? data.imageUrl :
                          typeof data.imageUrl === 'string' ? data.imageUrl.split(',').map(url => url.trim()) : [];

        for (let i = 0; i < 20; i++) {
          const url = imageUrls[i] || '';
          if (url) {
            row.push(`=IMAGE("${url}")`);
          } else {
            row.push(''); // 画像がない場合は空文字
          }
        }

        // 28-39. フリマ固有フィールド（12フィールド）(AB〜AM列)
        row.push(data.reviewCount || '');        // 28. 評価件数
        row.push(data.badRate || '');            // 29. 悪い評価率
        row.push(data.listedFmt || '');          // 30. 出品日時
        row.push(data.updatedFmt || '');         // 31. 更新日時
        row.push(data.handlingDays || '');       // 32. 発送までの日数
        row.push(data.listedElapsedDays || '');  // 33. 出品からの経過日数
        row.push(data.updatedElapsedDays || ''); // 34. 更新からの経過日数
        row.push(data.keywords || '');           // 35. 検知キーワード
        row.push(data.condition || '');          // 36. 商品の状態
        row.push(data.shippingPayer || '');      // 37. 配送料の負担
        row.push(data.shippingMethod || '');     // 38. 配送方法
        row.push(data.shipFrom || '');           // 39. 発送元の地域

        console.log('📊 フリマサイト全フィールド出力:', row.length, 'フィールド（A〜AM列）');
      } else {
        // 無効時: A〜F列のみ（基本6フィールドのみ）
        console.log('❌ 基本フィールドのみ出力（A〜F列）');
        console.log('📊 フリマサイト基本フィールドのみ:', row.length, 'フィールド（A〜F列）');
      }

      tsvData = row.map(field => field.toString().replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t');

    } else if (site === 'amazon') {
      // Amazon（7フィールド + 画像: 基本6 + ページURL1 + 画像）
      console.log('📦 Amazon: クリップボードコピー');
      const row = [
        data.supplier || '',  // 1. プラットフォーム (A列)
        data.asin || '',      // 2. ASIN (B列)
        data.price || '',     // 3. 価格 (C列)
        data.title || '',     // 4. 商品名 (D列)
        data.details || '',   // 5. 説明 (E列)
        data.sellerId || ''   // 6. 販売者 (F列)
      ];

      // enableImageInClipboard設定で出力範囲を制御
      if (settings.enableImageInClipboard) {
        // 有効時: 基本6 + ページURL + 画像
        console.log('✅ 全フィールド出力モード');

        // 7. ページURL (G列)
        row.push(window.location.href);

        // 8以降: 画像
        if (data.imageUrl) {
          const imageUrls = data.imageUrl.split(',').map(url => url.trim());
          const maxImages = settings.imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, typeof settings.imageOutputCount === 'number' ? settings.imageOutputCount : 5);
          const imageFormulas = imageUrls.slice(0, maxImages).map(url => `=IMAGE("${url}")`);
          console.log('🖼️ IMAGE()関数を追加（タブ区切り）:', imageFormulas.length + '枚');
          row.push(...imageFormulas);
        }
      } else {
        // 無効時: A〜F列のみ（基本6フィールドのみ）
        console.log('❌ 基本フィールドのみ出力（A〜F列）');
      }

      console.log('📊 Amazon出力フィールド数:', row.length);
      tsvData = row.map(field => field.toString().replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t');

    } else {
      // eBay, 楽天, Yahoo!ショッピング（7フィールド + 画像: 基本6 + ページURL1 + 画像）
      console.log('🛒 eBay/楽天/Yahoo!ショッピング: クリップボードコピー');
      const row = [
        data.platform,    // 1. プラットフォーム (A列)
        data.url,         // 2. URL (B列)
        data.price,       // 3. 価格 (C列)
        data.name,        // 4. 商品名 (D列)
        data.description, // 5. 説明 (E列)
        data.seller       // 6. 販売者 (F列)
      ];

      // enableImageInClipboard設定で出力範囲を制御
      if (settings.enableImageInClipboard) {
        // 有効時: 基本6 + ページURL + 画像
        console.log('✅ 全フィールド出力モード');

        // 7. ページURL (G列)
        row.push(window.location.href);

        // 8以降: 画像
        if (data.imageUrl) {
          const imageUrls = data.imageUrl.split(',').map(url => url.trim());
          const maxImages = settings.imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, typeof settings.imageOutputCount === 'number' ? settings.imageOutputCount : 5);
          const imageFormulas = imageUrls.slice(0, maxImages).map(url => `=IMAGE("${url}")`);
          console.log('🖼️ IMAGE()関数を追加（タブ区切り）:', imageFormulas.length + '枚');
          row.push(...imageFormulas);
        }
      } else {
        // 無効時: A〜F列のみ（基本6フィールドのみ）
        console.log('❌ 基本フィールドのみ出力（A〜F列）');
      }

      console.log('📊 eBay/楽天出力フィールド数:', row.length);
      tsvData = row.map(field => field.toString().replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t');
    }

    console.log('📝 最終的なTSVデータ:', tsvData);
    await navigator.clipboard.writeText(tsvData);

    const displayName = site === 'amazon' ? data.title : data.name;
    const displayPrice = site === 'rakuten' ? `${data.price}円` : site === 'amazon' ? data.price : `$${data.price}`;
    const extraInfo = site === 'amazon' ? `\nASIN: ${data.asin}` : '';

    showNotification(
      'コピー完了',
      `商品情報をクリップボードにコピーしました\n\n商品名: ${displayName.substring(0, 50)}${displayName.length > 50 ? '...' : ''}\n価格: ${displayPrice}${extraInfo}`,
      'success',
      colors
    );

    // 楽天のポップアップキーワードチェック
    if (site === 'rakuten') {
      checkRakutenPopupKeywords(data, settings, colors);
    }
  }

  function showNotification(title, message, type = 'info', colors) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10001;
      max-width: 350px;
      padding: 20px;
      background-color: ${type === 'error' ? '#ffebee' : type === 'success' ? '#e8f5e9' : '#e3f2fd'};
      color: ${type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : '#1976d2'};
      border-left: 4px solid ${type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : '#1976d2'};
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: slideIn 0.3s ease-out;
    `;

    notification.innerHTML = `
      <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px;">${title}</div>
      <div style="font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${message}</div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  // スタイルシート
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideUp {
      from {
        transform: translateY(50px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
    #modal-cancel:hover {
      background-color: #e0e0e0;
    }
    #modal-copy:hover {
      background-color: ${colors.hover};
    }
  `;
  document.head.appendChild(style);

  // 楽天用アラートチェック
  function checkRakutenAlerts(data, settings) {
    const alerts = [];

    const alertKw = Array.isArray(settings.alertKeywords) ? settings.alertKeywords : (typeof settings.alertKeywords === 'string' ? settings.alertKeywords : '');
    const alertKwStr = Array.isArray(alertKw) ? alertKw.join('\n') : alertKw;
    if (alertKwStr && alertKwStr.trim() !== '') {
      const keywords = alertKwStr.split('\n').filter(k => k.trim() !== '');
      const fullText = (data.name + ' ' + data.description).toLowerCase();

      for (const keyword of keywords) {
        if (fullText.includes(keyword.trim().toLowerCase())) {
          alerts.push(`🚨 除外キーワード検出: "${keyword.trim()}"`);
        }
      }
    }

    return alerts;
  }

  // 楽天用ポップアップキーワードチェック
  function checkRakutenPopupKeywords(data, settings, colors) {
    const popupKw = Array.isArray(settings.popupKeywords) ? settings.popupKeywords : (typeof settings.popupKeywords === 'string' ? settings.popupKeywords : '');
    const popupKwStr = Array.isArray(popupKw) ? popupKw.join('\n') : popupKw;
    if (popupKwStr && popupKwStr.trim() !== '') {
      const keywords = popupKwStr.split('\n').filter(k => k.trim() !== '');
      const fullText = (data.name + ' ' + data.description).toLowerCase();
      const matchedKeywords = [];

      for (const keyword of keywords) {
        if (fullText.includes(keyword.trim().toLowerCase())) {
          matchedKeywords.push(keyword.trim());
        }
      }

      if (matchedKeywords.length > 0) {
        showNotification(
          '注目キーワード検出',
          `✨ 以下のキーワードが見つかりました:\n${matchedKeywords.join(', ')}`,
          'success',
          colors
        );
      }
    }
  }

  // テキストにキーワードハイライトを適用する関数
  function highlightKeywords(text, excludeKeywords, alertKeywords) {
    if (!text) return '';

    let highlightedText = text;

    // 除外キーワード（赤ハイライト）
    if (excludeKeywords && Array.isArray(excludeKeywords)) {
      excludeKeywords.forEach(keyword => {
        if (keyword.trim()) {
          const regex = new RegExp(`(${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          highlightedText = highlightedText.replace(regex, '<mark style="background-color: #ff5252; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;">$1</mark>');
        }
      });
    }

    // 注目キーワード（黄色ハイライト）
    if (alertKeywords && Array.isArray(alertKeywords)) {
      alertKeywords.forEach(keyword => {
        if (keyword.trim()) {
          const regex = new RegExp(`(${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          highlightedText = highlightedText.replace(regex, '<mark style="background-color: #ffeb3b; color: #000; padding: 2px 4px; border-radius: 3px; font-weight: bold;">$1</mark>');
        }
      });
    }

    return highlightedText;
  }

  // キーワード検出とカウント
  function detectKeywords(text, excludeKeywords, alertKeywords) {
    const result = {
      excludeMatches: [],
      alertMatches: [],
      hasExclude: false,
      hasAlert: false
    };

    if (!text) return result;

    const lowerText = text.toLowerCase();

    // 除外キーワード検出
    if (excludeKeywords && Array.isArray(excludeKeywords)) {
      excludeKeywords.forEach(keyword => {
        if (keyword.trim() && lowerText.includes(keyword.trim().toLowerCase())) {
          result.excludeMatches.push(keyword.trim());
        }
      });
      result.hasExclude = result.excludeMatches.length > 0;
    }

    // 注目キーワード検出
    if (alertKeywords && Array.isArray(alertKeywords)) {
      alertKeywords.forEach(keyword => {
        if (keyword.trim() && lowerText.includes(keyword.trim().toLowerCase())) {
          result.alertMatches.push(keyword.trim());
        }
      });
      result.hasAlert = result.alertMatches.length > 0;
    }

    return result;
  }

  // ヘルパー関数
  function getTextBySelectors(selectors) {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.innerText && element.innerText.trim() !== '') {
          return element.innerText.trim();
        }
      } catch (e) {
        continue;
      }
    }
    return '';
  }

  function extractNumber(text) {
    if (!text) return 0;
    text = String(text);

    // 価格らしいパターンを優先的に抽出
    if (text.includes('$') || text.includes('US') || text.includes('USD')) {
      const cleaned = text.replace(/[$,¥円税込US USD\s]/g, '').replace(/（[^）]*）/g, '');
      const match = cleaned.match(/\d+\.?\d*/);
      if (match) {
        return parseFloat(match[0]);
      }
    }

    if (text.includes('円') || text.includes('¥')) {
      const cleaned = text.replace(/[,円税込￥\s]/g, '').replace(/（[^）]*）/g, '');
      const match = cleaned.match(/\d+/);
      if (match) {
        return parseInt(match[0], 10);
      }
    }

    const commaMatch = text.match(/(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)/);
    if (commaMatch) {
      return parseFloat(commaMatch[1].replace(/,/g, ''));
    }

    const decimalMatch = text.match(/\d+\.\d{1,2}/);
    if (decimalMatch) {
      return parseFloat(decimalMatch[0]);
    }

    const intMatch = text.match(/\d+/);
    if (intMatch) {
      const num = parseInt(intMatch[0], 10);
      if (num >= 0.01 && num <= 10000000) {
        return num;
      }
    }

    return 0;
  }

  // ======================================
  // eBay専用の抽出関数
  // ======================================
  function extractEbayProductInfo() {
    try {
      const hostname = window.location.hostname;
      let platform = 'ebay';
      const url = window.location.href;

      // 商品名抽出
      const nameSelectors = [
        'h1.x-item-title__mainTitle',
        'h1[itemprop="name"]',
        '.it-ttl',
        'h1.product-title',
        'h1'
      ];
      let name = getTextBySelectors(nameSelectors);

      if (!name || name.trim() === '') {
        const title = document.title;
        name = title.split('|')[0].split('-')[0].split(':')[0].trim();
      }

      name = name.replace(/【[^】]*】/g, '').replace(/[\[\]]/g, '').trim();

      // 価格抽出
      let price = 0;
      let priceText = '';

      console.log('=== 価格抽出開始 ===');

      const prioritySelectors = [
        'meta[itemprop="price"]',
        '.x-price-primary .ux-textspans--BOLD',
        '.x-price-primary span[class*="ux-textspans"]',
        'div[class*="x-price-primary"] span.ux-textspans',
        '.x-price-primary .ux-textspans',
        '.x-price-section .x-price-primary',
        '[data-testid="x-price-primary"] span',
        '[data-testid="x-price-primary"]',
        'span[itemprop="price"]',
        '[itemprop="price"]',
        '.x-price-primary',
        '.x-price-approx__price .ux-textspans',
        '.x-price-approx__price',
        '.notranslate'
      ];

      for (const selector of prioritySelectors) {
        const elements = document.querySelectorAll(selector);

        if (elements.length > 0) {
          console.log(`セレクタ "${selector}" で ${elements.length} 個の要素を発見`);

          for (const element of elements) {
            if (element.tagName === 'META') {
              priceText = element.getAttribute('content');
            } else {
              priceText = element.innerText?.trim();
            }

            if (priceText) {
              console.log(`  -> テキスト: "${priceText}"`);
              const num = extractNumber(priceText);

              if (num >= 0.01 && num <= 10000000) {
                price = num;
                console.log(`✅ 有効な価格を検出: $${price} (セレクタ: ${selector})`);
                break;
              } else if (num > 0) {
                console.log(`  -> 価格として無効: ${num} (範囲: 0.01〜10,000,000)`);
              }
            }
          }

          if (price > 0) break;
        }
      }

      if (price === 0) {
        console.log('⚠️ 優先セレクタで価格が見つかりませんでした');
        console.log('HTMLから"US $"を含む全要素を検索します...');

        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const text = el.innerText?.trim();
          if (text && (text.startsWith('US $') || text.startsWith('$')) && text.length < 50) {
            console.log(`  候補: "${text}" (タグ: ${el.tagName}, クラス: ${el.className})`);
            const num = extractNumber(text);
            if (num >= 0.01 && num <= 10000000) {
              price = num;
              priceText = text;
              console.log(`✅ フォールバックで価格を検出: $${price}`);
              break;
            }
          }
        }
      }

      if (price === 0) {
        console.log('価格が見つからないため、フォールバック検索を開始...');

        const allPriceElements = document.querySelectorAll(
          'span[class*="price"], div[class*="price"], span[class*="Price"], div[class*="Price"], span.ux-textspans'
        );

        console.log('価格候補要素の数:', allPriceElements.length);

        let candidates = [];

        allPriceElements.forEach(el => {
          const text = el.innerText?.trim();
          if (!text) return;

          const num = extractNumber(text);
          if (num === 0) return;

          if (num < 0.01 || num > 10000000) return;

          const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
          const classList = el.className.toLowerCase();
          const parentClass = el.parentElement?.className.toLowerCase() || '';

          let priority = 0;

          if (classList.includes('price') || parentClass.includes('price')) priority += 10;
          if (classList.includes('x-price') || parentClass.includes('x-price')) priority += 20;
          if (fontSize >= 20) priority += fontSize / 10;
          if (text.includes('$') || text.includes('US') || text.includes('USD')) priority += 5;
          if (classList.includes('textspans') || classList.includes('ux-textspans')) priority += 8;

          const hasMainPriceParent = el.closest('.x-price-primary, .x-price-section, [data-testid="x-price-primary"]');
          if (hasMainPriceParent) priority += 25;

          candidates.push({
            element: el,
            num: num,
            priority: priority,
            fontSize: fontSize,
            text: text,
            selector: `${el.tagName}.${el.className.split(' ')[0]}`
          });
        });

        console.log('有効な価格候補の数:', candidates.length);

        if (candidates.length > 0) {
          console.log('価格候補トップ5:');
          candidates.sort((a, b) => b.priority - a.priority);
          candidates.slice(0, 5).forEach((c, i) => {
            console.log(`  ${i + 1}. $${c.num} (優先度: ${c.priority.toFixed(1)}, フォント: ${c.fontSize}px, テキスト: "${c.text.substring(0, 30)}")`);
          });

          const bestCandidate = candidates[0];
          price = bestCandidate.num;
          priceText = bestCandidate.text;

          console.log('✅ 選択された価格:', {
            text: bestCandidate.text,
            num: bestCandidate.num,
            priority: bestCandidate.priority,
            fontSize: bestCandidate.fontSize,
            selector: bestCandidate.selector
          });
        } else {
          console.log('❌ 有効な価格候補が見つかりませんでした');
        }
      }

      console.log('送料は計算に含めません（商品価格のみ）');

      // 商品詳細抽出
      const descriptionSelectors = [
        '[itemprop="description"]',
        '.x-item-description',
        '#desc_div',
        '.ux-layout-section__item--description'
      ];

      let description = '';
      let longestDesc = '';
      descriptionSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.innerText?.trim() || '';
          if (text.length > longestDesc.length && text.length < 5000) {
            longestDesc = text;
          }
        }
      });

      description = longestDesc;

      // Seller Notes取得
      let sellerNotes = '';

      const allLabels = document.querySelectorAll('.ux-labels-values__labels, dt');
      allLabels.forEach(label => {
        const labelText = label.innerText?.trim().toLowerCase();
        if (labelText && labelText.includes('seller note')) {
          const valueElem = label.nextElementSibling;
          if (valueElem) {
            let fullText = '';

            const walker = document.createTreeWalker(
              valueElem,
              NodeFilter.SHOW_TEXT,
              null,
              false
            );

            let node;
            while (node = walker.nextNode()) {
              const text = node.textContent.trim();
              if (text && text !== 'Read more' && text !== '...') {
                fullText += text + ' ';
              }
            }

            if (fullText.trim()) {
              sellerNotes = fullText.trim();
            } else {
              sellerNotes = valueElem.innerText.trim();
            }
          }
        }
      });

      // Item specifics取得
      let itemSpecifics = '';

      console.log('=== Item specifics 抽出開始 ===');

      const excludeLabels = [
        'shipping',
        'delivery',
        'returns',
        'payments',
        'seller notes',
        'located in',
        'estimated between',
        'see details'
      ];

      console.log('Item specificsセクションを検索中...');
      const possibleSelectors = [
        'div[class*="ux-layout-section--itemDetails"]',
        'div.ux-layout-section__item[data-testid="ux-layout-section-evo__item--itemDetails"]',
        '.ux-layout-section--itemDetails',
        'div[class*="itemDetails"]',
        'section[class*="itemDetails"]'
      ];

      let specificsSections = [];
      for (const selector of possibleSelectors) {
        const elem = document.querySelector(selector);
        if (elem) {
          console.log(`✓ セレクタ "${selector}" でセクションを発見`);
          specificsSections.push(elem);
          break;
        } else {
          console.log(`✗ セレクタ "${selector}" では見つからず`);
        }
      }

      if (specificsSections.length === 0) {
        console.log('フォールバック: "Item specifics"テキストで検索...');
        const allSections = document.querySelectorAll('div, section');
        for (const section of allSections) {
          const heading = section.querySelector('h3, h2');
          if (heading && heading.innerText.includes('Item specifics')) {
            console.log('✓ "Item specifics"見出しでセクションを発見');
            specificsSections.push(section);
            break;
          }
        }
      }

      console.log('Item specificsセクション候補数:', specificsSections.length);

      for (const specificsSection of specificsSections) {
        const specRows = specificsSection.querySelectorAll('.ux-labels-values');
        console.log('見つかった .ux-labels-values の数:', specRows.length);

        specRows.forEach(row => {
          const label = row.querySelector('.ux-labels-values__labels, dt');
          const value = row.querySelector('.ux-labels-values__values, dd');
          if (label && value) {
            const labelText = label.innerText?.trim();
            const valueText = value.innerText?.trim();

            const labelLower = labelText.toLowerCase();
            const shouldExclude = excludeLabels.some(exclude => labelLower.includes(exclude));

            if (labelText && valueText && !shouldExclude) {
              if (valueText.length < 200) {
                itemSpecifics += `${labelText}: ${valueText} | `;
                console.log(`  ✓ ${labelText}: ${valueText}`);
              } else {
                console.log(`  ✗ スキップ（長すぎる）: ${labelText}`);
              }
            } else if (shouldExclude) {
              console.log(`  ✗ スキップ（除外リスト）: ${labelText}`);
            }
          }
        });

        const dlElements = specificsSection.querySelectorAll('dl');
        dlElements.forEach(dl => {
          const dts = dl.querySelectorAll('dt');
          const dds = dl.querySelectorAll('dd');
          for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
            const labelText = dts[i].innerText?.trim();
            const valueText = dds[i].innerText?.trim();

            const labelLower = labelText.toLowerCase();
            const shouldExclude = excludeLabels.some(exclude => labelLower.includes(exclude));

            if (labelText && valueText && !shouldExclude && valueText.length < 200) {
              itemSpecifics += `${labelText}: ${valueText} | `;
              console.log(`  ✓ ${labelText}: ${valueText}`);
            }
          }
        });
      }

      console.log('Item specifics 抽出結果（文字数）:', itemSpecifics.length);
      if (itemSpecifics) {
        console.log('Item specifics プレビュー:', itemSpecifics.substring(0, 200) + '...');
      }

      // 商品の状態を取得
      const conditionSelectors = [
        '.x-item-condition-text',
        '.x-item-condition-value',
        '[itemprop="itemCondition"]'
      ];
      const condition = getTextBySelectors(conditionSelectors);

      // すべての詳細情報を結合
      let allDetails = [
        condition ? `Condition: ${condition}` : '',
        sellerNotes ? `Seller Notes: ${sellerNotes}` : '',
        itemSpecifics ? `Item Specifics: ${itemSpecifics}` : '',
        description ? `Description: ${description}` : ''
      ]
        .filter(text => text && text.trim() !== '')
        .join(' | ');

      allDetails = allDetails
        .replace(/【[^】]*】/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (allDetails.length > 2000) {
        allDetails = allDetails.substring(0, 2000) + '...';
      }

      // 出品者情報抽出
      const sellerSelectors = [
        '.x-sellercard-atf__info__about-seller',
        '.mbg-nw',
        '[data-testid="ux-seller-section__item--seller"] a'
      ];
      let seller = getTextBySelectors(sellerSelectors);

      // 商品画像URL抽出（複数対応）
      let imageUrls = [];

      // eBayの画像ギャラリーから全ての画像を取得（複数のセレクタを試行）
      const carouselSelectors = [
        'img[class*="ux-image-carousel-item"]',
        'button[class*="ux-image-carousel-item"] img',
        '.ux-image-carousel img',
        '.ux-image-filmstrip img',
        'div[class*="ux-image-carousel"] img',
        'ul[class*="ux-image-carousel"] img'
      ];

      for (const selector of carouselSelectors) {
        const carouselImages = document.querySelectorAll(selector);
        console.log(`🔍 eBayセレクタ "${selector}" で ${carouselImages.length}枚発見`);

        carouselImages.forEach(img => {
          let url = img.src || img.getAttribute('data-src') || img.getAttribute('data-zoom-src');
          if (url && url.startsWith('http')) {
            // サムネイルを高解像度に変換
            if (url.includes('s-l')) {
              url = url.replace(/s-l\d+/g, 's-l1600');
            }
            if (!imageUrls.includes(url)) {
              console.log(`🖼️ eBay画像: ${url}`);
              imageUrls.push(url);
            }
          }
        });

        // 画像が見つかったらループを抜ける
        if (imageUrls.length > 0) break;
      }

      // メイン画像セレクタもチェック
      if (imageUrls.length === 0) {
        const mainSelectors = [
          'img[id*="icImg"]',
          '.vi-image-gallery img',
          'img[itemprop="image"]',
          'img.vi_main_img_pic',
          '#icImg',
          'img[class*="vi-image"]'
        ];

        for (const selector of mainSelectors) {
          const imgElement = document.querySelector(selector);
          if (imgElement) {
            let url = imgElement.src || imgElement.getAttribute('data-src') || imgElement.getAttribute('data-zoom-src');
            if (url && url.startsWith('http')) {
              if (url.includes('s-l')) {
                url = url.replace(/s-l\d+/g, 's-l1600');
              }
              console.log(`🖼️ eBayメイン画像: ${url}`);
              imageUrls.push(url);
              break;
            }
          }
        }
      }

      // og:imageもフォールバック
      if (imageUrls.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          const url = ogImage.getAttribute('content');
          if (url) {
            console.log(`🖼️ eBay OG画像: ${url}`);
            imageUrls.push(url);
          }
        }
      }

      const imageUrl = imageUrls.join(',');
      console.log(`✅ eBay画像URL確定（${imageUrls.length}枚）:`, imageUrl);

      if (!imageUrl) {
        console.log('⚠️ eBay画像URLが見つかりませんでした');
      }

      console.log('=== eBayスクレイパー デバッグ情報 ===');
      console.log('プラットフォーム:', platform);
      console.log('商品名:', name);
      console.log('価格テキスト:', priceText);
      console.log('価格（数値）:', price);
      console.log('Seller Notes:', sellerNotes ? sellerNotes.substring(0, 100) + '...' : 'なし');
      console.log('Item Specifics（長さ）:', itemSpecifics.length);
      console.log('商品詳細（長さ）:', allDetails.length);
      console.log('出品者:', seller);
      console.log('画像URL:', imageUrl);

      if (!name || name.trim() === '') {
        name = document.title.split('|')[0].split(':')[0].split('【')[0].trim();
        if (!name) {
          return { error: '商品名が取得できませんでした。' };
        }
      }

      if (!price || price === 0) {
        return {
          error: '価格が取得できませんでした。\n\n取得できたデータ:\n商品名: ' + name
        };
      }

      console.log('✅ 抽出成功');
      return {
        platform: platform,
        url: url,
        price: price,
        name: name,
        description: allDetails || '商品詳細なし',
        seller: seller || '出品者情報なし',
        imageUrl: imageUrl || ''
      };

    } catch (error) {
      console.error('抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ======================================
  // 楽天専用の抽出関数
  // ======================================
  function extractRakutenProductInfo(settings) {
    try {
      const hostname = window.location.hostname;
      let platform = 'rakuten';
      if (hostname.includes('books.rakuten.co.jp')) {
        platform = 'rakuten_books';
      } else if (hostname.includes('biccamera.rakuten.co.jp')) {
        platform = 'rakuten_bic';
      }

      const url = window.location.href;

      // 商品名抽出（優先順位付きの多段階フォールバック）
      let name = '';

      // 方法1: 標準的なセレクタ
      const nameSelectors = [
        'h1[itemprop="name"]',
        'h1[class*="item"]',
        'h1[class*="title"]',
        'h1[class*="name"]',
        'h1[class*="product"]',
        'h1.item_name',
        'h1.prod_title',
        'h2.item_name',
        'div.item_name h1',
        '.product_name h1',
        '.itemName'
      ];
      name = getTextBySelectors(nameSelectors);

      // 方法2: より広範囲なh1タグ検索
      if (!name || name.trim() === '' || name.length < 5) {
        const allH1 = document.querySelectorAll('h1');
        for (const h1 of allH1) {
          const text = h1.innerText?.trim() || '';
          // 商品名として妥当な長さ（10〜200文字）
          if (text.length >= 10 && text.length <= 200) {
            // ナビゲーション要素を除外
            if (!text.match(/^(楽天|Rakuten|カテゴリ|ホーム|マイページ|カート|検索|ログイン)/i)) {
              name = text;
              console.log('✅ 方法2でh1から商品名を取得:', name.substring(0, 50));
              break;
            }
          }
        }
      }

      // 方法3: meta og:titleから取得
      if (!name || name.trim() === '' || name.length < 5) {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          const content = ogTitle.getAttribute('content');
          if (content && content.length >= 10 && content.length <= 200) {
            name = content;
            console.log('✅ 方法3でog:titleから商品名を取得:', name.substring(0, 50));
          }
        }
      }

      // 方法4: document.titleから抽出
      if (!name || name.trim() === '' || name.length < 5) {
        const title = document.title;
        // 「商品名 | ショップ名 | 楽天」のような形式を想定
        const parts = title.split(/[|｜:：]/);
        if (parts.length > 0) {
          const candidate = parts[0].trim();
          if (candidate.length >= 10 && candidate.length <= 200) {
            name = candidate;
            console.log('✅ 方法4でdocument.titleから商品名を取得:', name.substring(0, 50));
          }
        }
      }

      // 方法5: 最終フォールバック - より柔軟なh2, h3検索
      if (!name || name.trim() === '' || name.length < 5) {
        const headings = document.querySelectorAll('h2, h3');
        for (const heading of headings) {
          const text = heading.innerText?.trim() || '';
          if (text.length >= 15 && text.length <= 200) {
            // 商品詳細エリアに含まれるheadingを優先
            const parent = heading.closest('[class*="item"], [class*="product"], [id*="item"], [id*="product"]');
            if (parent) {
              name = text;
              console.log('✅ 方法5でh2/h3から商品名を取得:', name.substring(0, 50));
              break;
            }
          }
        }
      }

      // クリーンアップ
      name = name.replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '').trim();

      // 最終チェック
      if (!name || name.length < 5) {
        console.error('❌ 楽天の商品名を取得できませんでした');
        name = '商品名を取得できませんでした';
      }

      // 価格抽出
      let price = 0;
      let priceText = '';

      const prioritySelectors = [
        'span[itemprop="price"]',
        'span.price2',
        '.item_price',
        'meta[itemprop="price"]',
        '[data-price]'
      ];

      for (const selector of prioritySelectors) {
        const element = document.querySelector(selector);
        if (element) {
          if (element.tagName === 'META') {
            priceText = element.getAttribute('content');
          } else if (element.hasAttribute('data-price')) {
            priceText = element.getAttribute('data-price');
          } else {
            priceText = element.innerText?.trim();
          }

          if (priceText) {
            const num = extractNumber(priceText);
            if (num >= 100 && num <= 10000000) {
              price = num;
              break;
            }
          }
        }
      }

      if (price === 0) {
        const allPriceElements = document.querySelectorAll(
          'span[class*="price"], div[class*="price"], p[class*="price"], [class*="Price"]'
        );

        let candidates = [];

        allPriceElements.forEach(el => {
          const text = el.innerText?.trim();
          if (!text) return;

          const num = extractNumber(text);
          if (num === 0) return;

          if (num < 100 || num > 10000000) return;

          const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
          const classList = el.className.toLowerCase();

          let priority = 0;

          if (classList.includes('price')) priority += 10;
          if (fontSize >= 20) priority += fontSize / 10;
          if (text.includes('円') || text.includes('¥')) priority += 5;

          candidates.push({
            element: el,
            num: num,
            priority: priority,
            fontSize: fontSize,
            text: text
          });
        });

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.priority - a.priority);

          const bestCandidate = candidates[0];
          price = bestCandidate.num;
          priceText = bestCandidate.text;
        }
      }

      // 送料抽出と計算
      const pageText = document.body.innerText;
      let shipping = 0;

      if (pageText.includes('送料無料') || pageText.includes('送料込み') || pageText.includes('送料込')) {
        shipping = 0;
      } else if (pageText.includes('送料別') || pageText.includes('別途送料')) {
        const shippingSelectors = [
          'span.shipping_cost',
          '.postage',
          '.delivery_price',
          '[class*="shipping"]',
          '[class*="postage"]',
          '.shippingCost'
        ];
        const shippingText = getTextBySelectors(shippingSelectors);
        if (shippingText) {
          shipping = extractNumber(shippingText);
        }
      }

      price = price + shipping;

      // 商品詳細抽出（より厳密なフィルタリング）
      // 楽天の各ショップで使われる様々なセレクタに対応
      const descriptionSelectors = [
        '[itemprop="description"]',
        '.item_desc',
        '.product_description',
        '.item_caption',
        'div[class*="description"]',
        'div[class*="spec"]',
        'div[id*="description"]',
        // 楽天ショップ特有のセレクタを追加
        '.rakutenLimitedId_ImageMain1-3 + div', // メイン画像の隣の説明
        'div.item-explain',
        'div.itemExplain',
        'div#item-explain',
        'div#itemExplain',
        '.item_info',
        '.itemInfo',
        '#item_info',
        '#itemInfo',
        '.goods_detail',
        '.goodsDetail',
        '.product_detail',
        '.productDetail',
        'div[class*="itemDesc"]',
        'div[class*="item-desc"]',
        'div[class*="goodsDesc"]',
        'div[class*="goods-desc"]',
        // テーブル形式の商品情報
        '.item_spec_table',
        '.spec_table',
        '#spec_table',
        // 商品説明エリア
        '.item_text',
        '.itemText',
        '#item_text',
        '#itemText',
        '.desc_area',
        '.descArea',
        // 商品特徴
        '.item_feature',
        '.itemFeature',
        '#item_feature',
        // 楽天GOLDページ用
        'div[class*="explain"]',
        'div[id*="explain"]',
        'div[class*="detail"]',
        'div[id*="detail"]'
      ];

      // 除外すべき要素（ノイズ）
      const excludeSelectors = [
        '.review', '.reviews', '[class*="review"]',
        '.recommend', '[class*="recommend"]',
        '.ranking', '[class*="ranking"]',
        '.navigation', 'nav', '[class*="nav"]',
        '.breadcrumb', '[class*="breadcrumb"]',
        '.sidebar', '[class*="sidebar"]',
        '.footer', 'footer',
        '.header', 'header',
        '.related', '[class*="related"]',
        '.banner', '[class*="banner"]',
        'script', 'style', 'noscript'
      ];

      let description = '';
      let longestDesc = '';

      descriptionSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
          // 除外要素のクローンを作成して削除
          const clone = el.cloneNode(true);
          excludeSelectors.forEach(excludeSelector => {
            clone.querySelectorAll(excludeSelector).forEach(node => node.remove());
          });

          let text = clone.innerText?.trim() || '';

          // 不要な行を削除
          text = text.split('\n')
            .filter(line => {
              const trimmed = line.trim();
              // 短すぎる行や特定のキーワードを含む行を除外
              if (trimmed.length < 5) return false;
              if (/^(レビュー|口コミ|評価|ランキング|おすすめ|関連商品|カテゴリ|検索|タグ)/i.test(trimmed)) return false;
              if (/^(HOME|TOP|トップ|ホーム|買い物かご|カート|お気に入り)/i.test(trimmed)) return false;
              return true;
            })
            .join('\n');

          // 適切な長さの説明文を選択（50〜2000文字に緩和）
          if (text.length >= 50 && text.length < 2000 && text.length > longestDesc.length) {
            longestDesc = text;
          }
        }
      });

      description = longestDesc;

      // フォールバック：説明文が取得できなかった場合
      if (!description || description.length < 50) {
        console.warn('⚠️ 標準セレクタで説明文が取得できませんでした。フォールバック実行中...');

        // より広範囲に探索（楽天ショップ特有のパターンを追加）
        const fallbackSelectors = [
          'div.item_explain',
          'div.item-explain',
          'div#item_explain',
          'div#itemExplain',
          '.item_information',
          '.product-details',
          '.product_details',
          'div[id*="item"]',
          'div[id*="product"]',
          'div[class*="detail"]',
          'div[class*="info"]',
          // 楽天ショップ独自のレイアウト用追加セレクタ
          '.goods_info',
          '.goodsInfo',
          '#goods_info',
          '#goodsInfo',
          '.main_content',
          '.mainContent',
          '#main_content',
          '#mainContent',
          '.contents_main',
          '.contentsMain',
          // 商品説明が画像とテキストで構成されている場合
          'div[class*="catch"]',
          'div[class*="point"]',
          'div[class*="feature"]',
          // iframeを使わないショップの商品説明エリア
          'td[class*="item"]',
          'td[class*="desc"]',
          'td[class*="explain"]',
          // center/tableベースの古いレイアウト
          'table[class*="item"] td',
          'table[id*="item"] td',
          // 楽天GOLDページ用
          '#rakutenLimitedId_ImageMain1-3',
          '.rakutenLimitedId_ImageMain1-3'
        ];

        fallbackSelectors.forEach(selector => {
          if (description.length >= 50) return; // 既に取得できた場合はスキップ
          const el = document.querySelector(selector);
          if (el) {
            const clone = el.cloneNode(true);
            excludeSelectors.forEach(excludeSelector => {
              clone.querySelectorAll(excludeSelector).forEach(node => node.remove());
            });
            const text = clone.innerText?.trim() || '';
            if (text.length >= 50 && text.length < 2000) {
              description = text;
              console.log('✅ フォールバックで説明文を取得:', selector);
            }
          }
        });
      }

      // 最終フォールバック：テーブル情報から詳細を取得
      if (!description || description.length < 30) {
        console.warn('⚠️ フォールバックでも説明文が不十分です。テーブル情報を優先的に使用します');

        // 「商品詳細」セクションを探す
        const detailSections = document.querySelectorAll('section, div, article');
        for (const section of detailSections) {
          const heading = section.querySelector('h2, h3, h4, h5');
          if (heading && heading.innerText?.match(/商品詳細|商品情報|仕様|スペック|詳細/)) {
            const clone = section.cloneNode(true);
            excludeSelectors.forEach(excludeSelector => {
              clone.querySelectorAll(excludeSelector).forEach(node => node.remove());
            });
            const text = clone.innerText?.trim() || '';
            if (text.length >= 30) {
              description = text;
              console.log('✅ 最終フォールバックで商品詳細セクションから取得');
              break;
            }
          }
        }
      }

      // テーブルから仕様情報も取得（重複除去）
      // より広範囲にテーブルを検索（商品情報らしいキーを含むテーブルを優先）
      const productInfoKeys = /品番|型番|駆動|ムーブメント|素材|ケース|ベルト|風防|文字盤|サイズ|重[さ量]|防水|仕様|付属|保証|ブランド|メーカー|原産国|製造国/;

      // まず全てのテーブルを取得
      const allTables = document.querySelectorAll('table');
      let specText = '';
      const specSet = new Set(); // 重複を防ぐ

      // 商品情報らしいテーブルを優先的に処理
      const sortedTables = Array.from(allTables).sort((a, b) => {
        const aText = a.innerText || '';
        const bText = b.innerText || '';
        const aMatch = (aText.match(productInfoKeys) || []).length;
        const bMatch = (bText.match(productInfoKeys) || []).length;
        return bMatch - aMatch; // マッチ数が多い順
      });

      sortedTables.forEach(table => {
        const tableText = table.innerText || '';
        // 商品情報らしいキーワードを含まないテーブルはスキップ
        if (!productInfoKeys.test(tableText)) return;
        // 関連商品・おすすめ商品のテーブルはスキップ
        if (/閲覧した商品|おすすめ|関連商品|ランキング/.test(tableText)) return;

        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
          const th = row.querySelector('th');
          const td = row.querySelector('td');

          if (th && td) {
            const key = th.innerText?.trim() || '';
            const value = td.innerText?.trim() || '';

            // 有効なキー・バリューペアのみ追加
            if (key && value && key.length < 50 && value.length < 300) {
              // ノイズキーを除外
              if (/閲覧|おすすめ|ランキング|レビュー|評価/.test(key)) return;
              const pair = `${key}: ${value}`;
              // 重複チェック
              if (!specSet.has(pair)) {
                specSet.add(pair);
                specText += pair + ' | ';
              }
            }
          }
        });
      });

      console.log('📋 テーブルから取得した仕様情報:', specText.substring(0, 200));

      // 説明文が短い場合のみ、specTextを追加（重複を避ける）
      if (description.length < 300 && specText) {
        specText = specText.slice(0, -3); // 最後の " | " を削除
      } else {
        specText = ''; // 説明文が十分長い場合はspecTextは不要
      }

      let allDetails = [description, specText]
        .filter(text => text && text.trim() !== '')
        .join(' | ');

      // クリーンアップ（より厳密）
      allDetails = allDetails
        .replace(/【[^】]*】/g, '') // 【】内を削除
        .replace(/\[[^\]]*\]/g, '') // []内を削除
        .replace(/\n{3,}/g, '\n\n') // 3行以上の改行を2行に
        .replace(/[\r\n\t]+/g, ' ') // 改行・タブをスペースに
        .replace(/\s+/g, ' ') // 連続スペースを1つに
        .replace(/検索[：:].*/g, '') // 検索キーワード削除
        .replace(/タグ[：:].*/g, '') // タグ削除
        .replace(/関連[キーワード|ワード|商品][：:].*/g, '') // 関連情報削除
        .replace(/[★☆]{3,}/g, '') // 星マーク削除
        .replace(/レビュー数[:：]\d+/g, '') // レビュー数削除
        .replace(/[▼▲►◄]+/g, '') // 矢印記号削除
        .replace(/クリック|タップ|こちら|詳細を見る/gi, '') // ナビゲーション文言削除
        // === 楽天専用ノイズ除去（パターンマッチで直接削除） ===
        // 配送関連
        .replace(/[こちらの]?の?商品は[、,]?代引き[でのは]*出荷[はを]?受け付けておりません[。]?/g, '')
        .replace(/沖縄[、,]?離島[はへ]?[別途]?送料[をが]?[頂ご][きざ]ます[。]?/g, '')
        .replace(/沖縄[、,]?離島[はへ]?[別途]?[追加]?送料[がを]?[かかり発生し]ます[。]?/g, '')
        .replace(/北海道[、,]?沖縄[、,]?離島[はへのへは]*[別途]?送料[^。]{0,30}[。]?/g, '')
        .replace(/送料[無料込別][。、,]?/g, '')
        .replace(/[ご]?注文[^。]{0,20}営業日[^。]{0,20}発送[^。]{0,30}[。]?/g, '')
        // 支払い関連
        .replace(/代[金引]引[換き][はでの]*[^。]{0,30}[。]?/gi, '')
        .replace(/お支払い[方法はについて][^。]{0,50}[。]?/g, '')
        .replace(/クレジットカード[^。]{0,30}[。]?/g, '')
        // ポイント関連
        .replace(/ポイント[0-9０-９]*倍[^。]{0,30}[。]?/g, '')
        .replace(/[楽天]?ポイント[がを]?[^。]{0,30}[還元付与][^。]{0,20}[。]?/g, '')
        // 返品・保証関連
        .replace(/返品[・,、]?交換[はについて][^。]{0,50}[。]?/g, '')
        .replace(/[ご]?注文後[のは]?[キャンセル返品][^。]{0,30}[。]?/g, '')
        // 注意書き（※で始まる）
        .replace(/※[^。]{0,100}[。]?/g, '')
        // ナビゲーション・UI関連
        .replace(/商品についてのお問い合わせ/g, '')
        .replace(/不適切な商品を報告/g, '')
        .replace(/この商品を[お気に入りに]?[登録追加][^。]{0,20}[。]?/g, '')
        // 価格関連の注意書き
        .replace(/店頭価格[：:\s]*[\d,]+円[^。]*[。]?/g, '')
        .replace(/販売価格は[^。]+[。]/g, '')
        .replace(/当サイトの価格は[^。]+[。]/g, '')
        // 関連キーワード（セクションごと削除）
        .replace(/関連キーワード\s*[A-Za-z0-9\s\-\.]+[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\s]+(?:Present|Gift|Anniversary|Birthday)[\s\S]{0,50}/gi, '')
        .replace(/関連キーワード[^]*?(?=商品状態|$)/g, '') // 関連キーワード以降を削除（商品状態があればそこまで）
        // 撮影・画像・モニター関連の注意書き
        .replace(/色[、,]?素材感に注意して撮影[^。]+[。]?/g, '')
        .replace(/デジカメの特性[^。]+[。]?/g, '')
        .replace(/ご覧になられている機器[^。]+[。]?/g, '')
        .replace(/実際の[色商品][^。]*異なる[^。]+[。]?/g, '')
        .replace(/お客様のモニター[^。]+[。]?/g, '')
        .replace(/実物を[蛍光灯自然光]+[^。]+色味[^。]+[。]?/g, '')
        .replace(/ご理解の上[ご購入お買い求め][^。]+[。]?/g, '')
        // 類似商品・新着商品・再販商品（セクションごと削除）
        .replace(/類似商品は[＼\\]?[^]+$/g, '') // 類似商品以降を全て削除
        .replace(/新着商品は\d{4}\/\d{1,2}\/\d{1,2}[^]+$/g, '') // 新着商品以降を全て削除
        .replace(/再販商品は\d{4}\/\d{1,2}\/\d{1,2}[^]+$/g, '') // 再販商品以降を全て削除
        // ブラックフライデー・セール関連
        .replace(/[＼\\]ブラックフライデー[^／\\]*[／\\]/g, '')
        .replace(/point\d+倍/gi, '')
        // カラーコード・謎の文字列
        .replace(/#[a-fA-F0-9]{6}[,\s]*/g, '')
        .replace(/,\d+,[ア-ン]/g, '') // ",118,オ" のようなパターン
        // 連続スペースを再度整理
        .replace(/\s+/g, ' ')
        .trim();

      // 文字数制限（最大1500文字）
      if (allDetails.length > 1500) {
        allDetails = allDetails.substring(0, 1500) + '...';
      }

      // 最終チェック：内容が薄い場合でもspecTextがあれば許容
      if (allDetails.length < 30) {
        console.warn('⚠️ 楽天の詳細情報が不十分です');
        // specTextがあればそれを使用
        if (specText && specText.length >= 30) {
          allDetails = specText;
          console.log('✅ specTextを詳細情報として使用');
        } else {
          allDetails = '詳細情報を取得できませんでした（このショップは情報が少ないページ構造です）';
        }
      }

      // 出品者情報抽出
      const sellerSelectors = [
        'a[href*="/shop/"]',
        'div[class*="shop"] a',
        'div[class*="store"] a',
        '.shop_name a',
        '.store_name',
        '[itemprop="seller"] [itemprop="name"]',
        '.seller_name',
        '.shopName a'
      ];
      let seller = getTextBySelectors(sellerSelectors);

      if (!seller || seller.trim() === '') {
        const shopMatch = url.match(/\/shop\/([^\/]+)\//);
        if (shopMatch) {
          seller = shopMatch[1];
        }
      }

      if (!seller || seller.trim() === '') {
        const itemMatch = url.match(/\/([^\/]+)\/[0-9]/);
        if (itemMatch) {
          seller = itemMatch[1];
        }
      }

      // 商品画像URL抽出（複数対応）
      let imageUrls = [];

      // メイン画像とサムネイル画像を取得
      const mainImageSelectors = [
        'img[itemprop="image"]',
        '.item_image img',
        '.item-img img',
        'img[id*="rakutenLimitedId_ImageMain"]'
      ];

      // 複数の画像を取得（ギャラリーやサムネイル）
      const gallerySelectors = [
        'img[class*="item"]',
        'img[class*="product"]',
        'img[class*="gallery"]',
        'img[class*="thumb"]',
        '.itemImg img',
        '[class*="image"] img'
      ];

      // まずメイン画像を取得
      for (const selector of mainImageSelectors) {
        const imgElement = document.querySelector(selector);
        if (imgElement) {
          const url = imgElement.src || imgElement.getAttribute('data-src');
          if (url && url.startsWith('http') && !imageUrls.includes(url)) {
            console.log(`🖼️ 楽天メイン画像: ${url}`);
            imageUrls.push(url);
            break; // メイン画像は1つだけ
          }
        }
      }

      // 次に追加の商品画像を取得
      const allImages = document.querySelectorAll(gallerySelectors.join(','));
      allImages.forEach(img => {
        const url = img.src || img.getAttribute('data-src');
        if (url && url.startsWith('http') && !imageUrls.includes(url)) {
          // 商品画像らしいURLのみ追加（楽天のshop.r10s.jpドメイン等）
          if (url.includes('rakuten') || url.includes('r10s.jp')) {
            // サイズが小さすぎる画像は除外（アイコンなど）
            if (!url.includes('icon') && !url.includes('banner') && !url.includes('logo')) {
              console.log(`📷 楽天追加画像: ${url}`);
              imageUrls.push(url);
            }
          }
        }
      });

      // og:imageもフォールバックとして追加
      if (imageUrls.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          const url = ogImage.getAttribute('content');
          if (url) {
            console.log(`🖼️ 楽天OG画像: ${url}`);
            imageUrls.push(url);
          }
        }
      }

      const imageUrl = imageUrls.join(','); // カンマ区切りで結合
      console.log(`✅ 楽天画像URL確定（${imageUrls.length}枚）:`, imageUrl);

      if (!imageUrl) {
        console.log('⚠️ 楽天画像URLが見つかりませんでした');
      }

      console.log('=== 楽天スクレイパー デバッグ情報 ===');
      console.log('プラットフォーム:', platform);
      console.log('商品名:', name);
      console.log('価格テキスト:', priceText);
      console.log('価格:', price);
      console.log('送料:', shipping);
      console.log('商品詳細（長さ）:', allDetails.length);
      console.log('出品者:', seller);
      console.log('画像URL:', imageUrl);

      if (!name || name.trim() === '') {
        name = document.title.split('|')[0].split(':')[0].split('【')[0].trim();
        if (!name) {
          return { error: '商品名が取得できませんでした。' };
        }
      }

      if (!price || price === 0) {
        return {
          error: '価格が取得できませんでした。\n\n取得できたデータ:\n商品名: ' + name
        };
      }

      console.log('✅ 抽出成功');
      return {
        platform: platform,
        url: url,
        price: price,
        name: name,
        description: allDetails || '商品詳細なし',
        seller: seller || '出品者情報なし',
        imageUrl: imageUrl || ''
      };

    } catch (error) {
      console.error('抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ======================================
  // Amazon専用の抽出関数
  // ======================================
  function extractAmazonProductData() {
    let asin, price, title, details, sellerId, imageUrl;

    try {
      asin = extractASIN();
    } catch (e) {
      console.warn('ASIN抽出エラー:', e.message);
      asin = 'N/A';
    }

    try {
      price = extractPrice();
    } catch (e) {
      console.warn('価格抽出エラー:', e.message);
      price = 'N/A';
    }

    try {
      title = extractTitle();
    } catch (e) {
      console.warn('タイトル抽出エラー:', e.message);
      title = 'N/A';
    }

    try {
      details = extractDetails();
    } catch (e) {
      console.warn('詳細抽出エラー:', e.message);
      details = 'N/A';
    }

    try {
      sellerId = extractSellerId();
    } catch (e) {
      console.warn('セラーID抽出エラー:', e.message);
      sellerId = 'N/A';
    }

    try {
      imageUrl = extractAmazonImage();
    } catch (e) {
      console.warn('画像URL抽出エラー:', e.message);
      imageUrl = '';
    }

    return {
      supplier: 'amazon',
      asin: asin || 'N/A',
      price: price || 'N/A',
      title: title || 'N/A',
      details: details || 'N/A',
      sellerId: sellerId || 'N/A',
      imageUrl: imageUrl || ''
    };
  }

  function extractASIN() {
    const urlPatterns = [
      /\/dp\/([A-Z0-9]{10})/,
      /\/gp\/product\/([A-Z0-9]{10})/
    ];
    for (const re of urlPatterns) {
      const m = window.location.pathname.match(re);
      if (m) return m[1];
    }

    const asinMeta = document.querySelector('input[name="ASIN"]');
    if (asinMeta && asinMeta.value) return asinMeta.value;

    const asinFromTables = (() => {
      const containers = [
        '#detailBullets_feature_div',
        '#productDetails_detailBullets_sections1',
        '#productDetails_techSpec_section_1',
        '#productDetails_techSpec_section_2'
      ];
      for (const sel of containers) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = el.textContent || '';
        const m = text.match(/ASIN\s*[:：]\s*([A-Z0-9]{10})/i);
        if (m) return m[1];
      }
      return null;
    })();
    if (asinFromTables) return asinFromTables;

    return 'N/A';
  }

  function extractPrice() {
    const priceSelectors = [
      '.a-price.a-text-price.a-size-medium.a-color-base .a-offscreen',
      '.a-price .a-offscreen',
      '#corePrice_feature_div .a-offscreen',
      '#priceblock_dealprice',
      '#priceblock_ourprice',
      '#priceblock_saleprice',
      '.a-price-whole',
      '[data-testid="price-value"]'
    ];

    for (const selector of priceSelectors) {
      const priceElement = document.querySelector(selector);
      if (priceElement) {
        let priceText = priceElement.textContent.trim();

        priceText = priceText.replace(/[￥¥,]/g, '');

        const priceMatch = priceText.match(/[\d,]+/);
        if (priceMatch) {
          return priceMatch[0].replace(/,/g, '');
        }
      }
    }

    const priceRange = document.querySelector('#price_inside_buybox');
    if (priceRange) {
      const priceText = priceRange.textContent;
      const priceMatch = priceText.match(/￥?([\d,]+)/);
      if (priceMatch) {
        return priceMatch[1].replace(/,/g, '');
      }
    }

    return 'N/A';
  }

  function extractTitle() {
    const titleSelectors = [
      '#productTitle',
      '[data-testid="product-title"]',
      '.product-title'
    ];

    for (const selector of titleSelectors) {
      const titleElement = document.querySelector(selector);
      if (titleElement) {
        return titleElement.textContent.trim();
      }
    }

    return 'N/A';
  }

  function extractDetails() {
    const seen = new Set();
    const out = [];

    const clean = (t) => {
      if (t === null || t === undefined) return '';
      return String(t)
        .replace(/\s+/g, ' ')
        .replace(/\u00A0/g, ' ')
        .trim();
    };

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
      return true;
    };

    const push = (text) => {
      const v = clean(text);
      if (!v) return;
      if (v.includes('詳細はこちら')) return;
      if (v.length > 250) return;
      if (seen.has(v)) return;
      // 共通ノイズフィルタを適用
      if (isNoiseText(v)) return;
      seen.add(v);
      out.push(v);
    };

    const pushKV = (k, v) => {
      const key = clean(k);
      const val = clean(v);
      if (!key || !val) return;
      if (/^ASIN$/i.test(key)) return;
      if (val.length > 200) return;
      push(`${key}: ${val}`);
    };

    // 商品の特徴（bullet points）- 複数のセレクタパターンに対応
    // 通常ページ
    document.querySelectorAll('#feature-bullets ul li, #feature-bullets li .a-list-item')
      .forEach(li => { if (isVisible(li)) push(li.textContent); });

    // バリエーション商品ページ用（「この商品について」セクション）
    document.querySelectorAll('#featurebullets_feature_div li, #featurebullets_feature_div .a-list-item')
      .forEach(li => { if (isVisible(li)) push(li.textContent); });

    // productFacts（展開可能なセクション）
    document.querySelectorAll('#productFactsDesktopExpander li, #productFactsDesktopExpander .a-list-item')
      .forEach(li => { if (isVisible(li)) push(li.textContent); });

    // 「この商品について」の別パターン
    document.querySelectorAll('[data-feature-name="featurebullets"] li')
      .forEach(li => { if (isVisible(li)) push(li.textContent); });

    // a-unordered-list内のbullet points（汎用）
    document.querySelectorAll('#centerCol .a-unordered-list.a-vertical li .a-list-item')
      .forEach(li => {
        // レビューセクション内は除外
        if (li.closest('#customerReviews') || li.closest('#reviews-medley-footer')) return;
        if (isVisible(li)) push(li.textContent);
      });

    // 商品説明（A+コンテンツ、ブランドストーリーなど）
    const descriptionSelectors = [
      '#productDescription',
      '#aplus_feature_div',
      '#aplus',
      '#dpx-aplus-product-description_feature_div',
      '#dpx-aplus-3p-product-description_feature_div',
      '.apm-tablemodule',
      '#brand-snapshot_feature_div',
      '#important-information_feature_div',
      '.a-section.a-spacing-medium.a-spacing-top-small'
    ];

    descriptionSelectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        const text = clean(el.textContent);
        if (text && text.length > 20 && text.length < 500) {
          push(text);
        }
      }
    });

    document.querySelectorAll('#detailBullets_feature_div li span.a-list-item')
      .forEach(span => {
        if (!isVisible(span)) return;
        const text = clean(span.textContent);
        if (!text) return; // textが空の場合はスキップ
        const m = text.match(/^([^:：]+)[:：]\s*(.+)$/);
        if (m) {
          pushKV(m[1], m[2]);
        }
      });

    document.querySelectorAll('#poExpander table tr, #productOverview_feature_div table tr')
      .forEach(tr => {
        const th = tr.querySelector('th, .po-attribute-name');
        const td = tr.querySelector('td, .po-attribute-value');
        if (isVisible(tr) && th && td) pushKV(th.textContent, td.textContent);
      });

    // 商品仕様テーブル（複数パターン対応）
    const techSpecSelectors = [
      '#productDetails_techSpec_section_1',
      '#productDetails_techSpec_section_2',
      '#technicalSpecifications_section_1',
      '#prodDetails',
      '#productDetails_detailBullets_sections1',
      '#productDetails_feature_div table',
      '#detailBulletsWrapper_feature_div',
      '.a-keyvalue',
      '#tech-specs-desktop',
      '#tech-specs-mobile',
      // バリエーション商品ページ用（登録情報セクション）
      '#productDetails_db_sections',
      '#productDetails_expanderTables_dep498',
      '#poExpander',
      '#productOverview_feature_div',
      '.product-facts-detail',
      '#nic-po-expander-content'
    ];

    techSpecSelectors.forEach(sel => {
        const table = document.querySelector(sel);
        if (!table) return;
        table.querySelectorAll('tr').forEach(row => {
          const heading = row.querySelector('th, td.a-color-secondary, .a-span3, .a-text-bold');
          const value = row.querySelector('td, td.a-color-base, .a-span9');
          if (isVisible(row) && heading && value && value !== heading) {
            pushKV(heading.textContent, value.textContent);
          }
        });
      });

    // 「登録情報」の別フォーマット（dl/dt/dd形式）
    document.querySelectorAll('#productDetails_feature_div dl, #detailBullets dl, .product-facts dl').forEach(dl => {
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      dts.forEach((dt, i) => {
        if (dds[i] && isVisible(dt)) {
          pushKV(dt.textContent, dds[i].textContent);
        }
      });
    });

    // span.a-text-bold + span 形式の仕様情報
    document.querySelectorAll('#productDetails_feature_div .a-row, #poExpander .a-row').forEach(row => {
      const label = row.querySelector('.a-text-bold, .a-color-secondary');
      const value = row.querySelector('.a-text-bold + span, .po-break-word');
      if (label && value && isVisible(row)) {
        pushKV(label.textContent, value.textContent);
      }
    });

    // 追加の商品情報（よく一緒に見られている情報など以外）
    const additionalInfoSelectors = [
      '#variation_size_name .selection',
      '#variation_color_name .selection',
      '.a-size-base.a-color-secondary'
    ];

    additionalInfoSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (isVisible(el)) {
          const text = clean(el.textContent);
          if (text && text.length > 5 && text.length < 100) {
            push(text);
          }
        }
      });
    });

    // フォールバック: セレクタで十分な情報が取れなかった場合、スコアリング方式で取得
    if (out.length < 3) {
      console.log('⚠️ セレクタベースで十分な情報が取れませんでした。スコアリング方式を試行...');

      const scoredBlocks = [];

      // 商品説明らしいキーワード（スコア加算）
      const productKeywords = [
        'サイズ', '素材', 'カラー', '色', '仕様', '対応', '付属', 'セット',
        '重量', '重さ', 'cm', 'mm', 'kg', 'g', '幅', '高さ', '長さ', '厚さ',
        'ブランド', 'メーカー', '型番', '品番', '材質', '原産国', '生産国',
        '容量', '電池', '防水', '保証', 'ギフト', 'プレゼント',
        'ウール', 'コットン', 'ポリエステル', 'レザー', 'ステンレス',
        '日本製', '海外製', '並行輸入', '正規品'
      ];

      // ノイズキーワード（スコア減算）
      const noiseKeywords = [
        'カート', 'ログイン', 'レビュー', '評価', 'ランキング', 'おすすめ',
        '関連商品', 'この商品を見た', 'よく一緒に購入', 'スポンサー',
        'Amazon', 'プライム', '配送', '届け', '在庫', '残り',
        '販売元', '出品者', 'マーケットプレイス', 'ギフト設定',
        'シェア', 'ツイート', 'ウィッシュリスト', 'お気に入り'
      ];

      // ページ内のテキストブロックを収集（リスト項目と段落）
      const candidateSelectors = [
        '#centerCol li',
        '#centerCol p',
        '#centerCol div',
        '#dpx-product-details li',
        '#dpx-product-details p',
        'div[data-feature-name] li',
        'div[data-feature-name] p'
      ];

      const seenTexts = new Set();

      candidateSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          // レビューセクションを除外
          if (el.closest('#customerReviews') ||
              el.closest('#reviews-medley-footer') ||
              el.closest('#sp_detail') ||
              el.closest('#nav-main') ||
              el.closest('footer') ||
              el.closest('header')) return;

          if (!isVisible(el)) return;

          const text = clean(el.textContent);
          if (!text || text.length < 15 || text.length > 300) return;
          if (seenTexts.has(text)) return;
          seenTexts.add(text);

          // 共通ノイズフィルタを適用
          if (isNoiseText(text)) return;

          // スコアリング
          let score = 0;

          // テキスト長スコア（50-150文字が理想）
          if (text.length >= 30 && text.length <= 200) score += 10;
          if (text.length >= 50 && text.length <= 150) score += 5;

          // 商品キーワードスコア
          productKeywords.forEach(kw => {
            if (text.includes(kw)) score += 3;
          });

          // ノイズキーワードスコア（減点）
          noiseKeywords.forEach(kw => {
            if (text.includes(kw)) score -= 5;
          });

          // 箇条書き的なパターンにボーナス（「:」や「：」を含む）
          if (/[:：]/.test(text)) score += 5;

          // 数値+単位を含むとボーナス
          if (/\d+\s*(cm|mm|kg|g|ml|L|%|個|枚|本)/.test(text)) score += 5;

          if (score > 0) {
            scoredBlocks.push({ text, score });
          }
        });
      });

      // スコア順にソートして上位を採用
      scoredBlocks.sort((a, b) => b.score - a.score);
      const topBlocks = scoredBlocks.slice(0, 10);

      topBlocks.forEach(block => {
        if (!seen.has(block.text)) {
          seen.add(block.text);
          out.push(block.text);
          console.log(`✅ スコアリングで採用 (score: ${block.score}):`, block.text.substring(0, 50));
        }
      });
    }

    return out.slice(0, 30).join(' | ');
  }

  function extractSellerId() {
    const sellerTextSelectors = [
      '#merchant-info a',
      '[data-testid="byline-info-desktop"] a',
      'a[href*="seller="]',
      'a[href*="/stores/"]',
      '#bylineInfo a'
    ];

    for (const selector of sellerTextSelectors) {
      const sellerElement = document.querySelector(selector);
      if (sellerElement && sellerElement.textContent.trim()) {
        let sellerName = sellerElement.textContent.trim();

        if (sellerName.includes('のストアを表示')) {
          sellerName = sellerName.replace('のストアを表示', '').trim();
        }
        if (sellerName.includes('にアクセス')) {
          sellerName = sellerName.replace('にアクセス', '').trim();
        }

        return sellerName || null;
      }
    }

    const sellerLinkSelectors = [
      '[href*="/stores/"]',
      '[href*="/seller/"]',
      'a[href*="seller="]'
    ];

    for (const selector of sellerLinkSelectors) {
      const sellerLink = document.querySelector(selector);
      if (sellerLink) {
        const href = sellerLink.href;

        let match = href.match(/\/stores\/([^\/\?]+)/);
        if (match) {
          try {
            return decodeURIComponent(match[1]);
          } catch (e) {
            return match[1];
          }
        }

        match = href.match(/\/seller\/([^\/\?]+)/);
        if (match) {
          try {
            return decodeURIComponent(match[1]);
          } catch (e) {
            return match[1];
          }
        }

        match = href.match(/seller=([^&]+)/);
        if (match) {
          try {
            return decodeURIComponent(match[1]);
          } catch (e) {
            return match[1];
          }
        }
      }
    }

    const sellerInfo = document.querySelector('#merchant-info');
    if (sellerInfo) {
      const sellerText = sellerInfo.textContent;
      const sellerMatch = sellerText.match(/販売元[:：]\s*(.+?)(?:\s|$)/);
      if (sellerMatch) {
        return sellerMatch[1].trim();
      }
    }

    return 'Amazon.co.jp';
  }

  function extractAmazonImage() {
    let imageUrls = [];
    const seenImageIds = new Set(); // 画像ID重複チェック用

    // 画像IDを抽出（例: https://m.media-amazon.com/images/I/51ozZz0CsiL._AC_SL1500_.jpg → 51ozZz0CsiL）
    const getImageId = (url) => {
      if (!url) return '';
      const match = url.match(/\/I\/([A-Z0-9]+)/);
      return match ? match[1] : url;
    };

    // Amazonの画像URLを高解像度に変換
    const toHighResUrl = (url) => {
      if (!url) return url;
      // _AC_SR38,50_ などのサイズ指定を _AC_SL1500_ に変換
      return url.replace(/\._AC_[A-Z]+\d+[,\d]*_\./, '._AC_SL1500_.');
    };

    const addUniqueUrl = (url) => {
      if (!url || !url.startsWith('http')) return false;
      const imageId = getImageId(url);
      if (seenImageIds.has(imageId)) {
        console.log(`⚠️ 重複スキップ: ${imageId}`);
        return false;
      }
      seenImageIds.add(imageId);
      // 高解像度URLに変換してから追加
      const highResUrl = toHighResUrl(url);
      imageUrls.push(highResUrl);
      console.log(`📸 高解像度変換: ${url.substring(url.lastIndexOf('/') + 1)} → ${highResUrl.substring(highResUrl.lastIndexOf('/') + 1)}`);
      return true;
    };

    // メイン画像を取得
    const mainImageSelectors = [
      '#landingImage',
      '#imgBlkFront',
      '#main-image',
      'img[data-old-hires]',
      'img[data-a-dynamic-image]'
    ];

    for (const selector of mainImageSelectors) {
      const imgElement = document.querySelector(selector);
      if (imgElement) {
        console.log(`🖼️ Amazon画像要素発見: ${selector}`);

        // data-old-hires属性があれば高解像度画像を取得（最優先）
        const hiresUrl = imgElement.getAttribute('data-old-hires');
        if (hiresUrl && addUniqueUrl(hiresUrl)) {
          console.log(`✅ Amazonメイン画像（data-old-hires）: ${hiresUrl}`);
        }

        // data-a-dynamic-imageからは最大解像度の1つだけ取得
        const dynamicImage = imgElement.getAttribute('data-a-dynamic-image');
        if (dynamicImage && imageUrls.length === 0) { // メイン画像がまだない場合のみ
          try {
            const imageObj = JSON.parse(dynamicImage);
            const urls = Object.keys(imageObj);
            // 最大解像度の画像を1つだけ取得
            if (urls.length > 0) {
              const maxResUrl = urls.reduce((max, url) => {
                const maxSize = imageObj[max] ? imageObj[max][0] * imageObj[max][1] : 0;
                const urlSize = imageObj[url] ? imageObj[url][0] * imageObj[url][1] : 0;
                return urlSize > maxSize ? url : max;
              }, urls[0]);

              if (addUniqueUrl(maxResUrl)) {
                console.log(`✅ Amazon画像（dynamic-image最高解像度）: ${maxResUrl}`);
              }
            }
          } catch (e) {
            console.log('⚠️ JSON パースエラー:', e);
          }
        }

        // メイン画像が見つかったらループを抜ける
        if (imageUrls.length > 0) break;
      }
    }

    // サムネイル画像も取得（メイン画像と重複しないもののみ）
    const thumbnails = document.querySelectorAll('#altImages img, .imageThumbnail img, ul.a-unordered-list.a-nostyle.a-button-list img');
    console.log(`🔍 Amazonサムネイル候補: ${thumbnails.length}個`);

    thumbnails.forEach((img, index) => {
      const hiresUrl = img.getAttribute('data-old-hires');
      const dynamicImage = img.getAttribute('data-a-dynamic-image');
      const srcUrl = img.src;

      console.log(`🔎 サムネイル${index + 1}:`, {
        'data-old-hires': hiresUrl ? 'あり' : 'なし',
        'data-a-dynamic-image': dynamicImage ? 'あり' : 'なし',
        'src': srcUrl ? srcUrl.substring(0, 80) : 'なし'
      });

      // data-old-hiresを優先
      if (hiresUrl && addUniqueUrl(hiresUrl)) {
        console.log(`📷 Amazonサムネイル（hires）: ${hiresUrl}`);
      } else if (dynamicImage) {
        try {
          const imageObj = JSON.parse(dynamicImage);
          const urls = Object.keys(imageObj);
          // 最大解像度の1つだけ取得
          if (urls.length > 0) {
            const maxResUrl = urls.reduce((max, url) => {
              const maxSize = imageObj[max] ? imageObj[max][0] * imageObj[max][1] : 0;
              const urlSize = imageObj[url] ? imageObj[url][0] * imageObj[url][1] : 0;
              return urlSize > maxSize ? url : max;
            }, urls[0]);

            if (addUniqueUrl(maxResUrl)) {
              console.log(`📷 Amazonサムネイル（dynamic）: ${maxResUrl}`);
            }
          }
        } catch (e) {
          console.log(`⚠️ サムネイル${index + 1} JSONパースエラー:`, e);
        }
      } else if (srcUrl && srcUrl.includes('/images/I/')) {
        // data属性がない場合は、srcから直接取得
        if (addUniqueUrl(srcUrl)) {
          console.log(`📷 Amazonサムネイル（src）: ${srcUrl}`);
        }
      }
    });

    // og:imageもフォールバック
    if (imageUrls.length === 0) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        const url = ogImage.getAttribute('content');
        if (url) {
          console.log(`🖼️ Amazon OG画像: ${url}`);
          imageUrls.push(url);
        }
      }
    }

    const result = imageUrls.join(',');
    console.log(`✅ Amazon画像URL確定（${imageUrls.length}枚）:`, result);

    if (!result) {
      console.log('⚠️ Amazon画像URLが見つかりませんでした');
    }

    return result;
  }

  // Amazon用メッセージリスナー（ポップアップからも使えるように）
  if (currentSite === 'amazon') {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'extractData') {
        try {
          const productData = extractAmazonProductData();
          const row = [
            productData.supplier || '',
            productData.asin || '',
            productData.price || '',
            productData.title || '',
            productData.details || '',
            productData.sellerId || ''
          ];
          const tsvData = row.map(field => field.toString().replace(/\t/g, ' ')).join('\t');

          sendResponse({
            success: true,
            data: tsvData
          });
        } catch (error) {
          console.error('Data extraction error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      }
    });
  }

  // ==========================================
  // Googleスプレッドシートエクスポート機能
  // ==========================================

  /**
   * ドロップダウンを初期化
   */
  async function initSheetSelector() {
    try {
      // スプレッドシート設定は同期ストレージから取得
      const syncSettings = await chrome.storage.sync.get(['spreadsheets']);
      // 最後に使ったシートIDはローカルストレージから取得
      const localSettings = await chrome.storage.local.get(['lastUsedSheetId']);
      const spreadsheets = syncSettings.spreadsheets || [];

      const container = document.getElementById('sheet-selector-container');
      const selector = document.getElementById('sheet-selector');

      if (spreadsheets.length === 0) {
        // スプレッドシートが登録されていない
        container.style.display = 'none';
        return;
      }

      // スプレッドシートが登録されている場合は表示
      container.style.display = 'block';

      // ドロップダウンのオプションを生成
      selector.innerHTML = spreadsheets.map(sheet =>
        `<option value="${sheet.id}">${sheet.name} (${sheet.sheetName})</option>`
      ).join('');

      // 最後に使ったシートを選択
      if (localSettings.lastUsedSheetId && spreadsheets.some(s => s.id === localSettings.lastUsedSheetId)) {
        selector.value = localSettings.lastUsedSheetId;
      }

    } catch (error) {
      console.error('Error initializing sheet selector:', error);
    }
  }

  /**
   * スプレッドシートへデータをエクスポート
   * @param {Object} data - 商品データオブジェクト
   * @param {string} site - サイト名 ('ebay', 'rakuten', 'amazon')
   * @param {Object} colors - サイトカラー
   */
  async function exportToSpreadsheet(data, site, colors) {
    try {
      // 同期設定（スプレッドシート、画像枚数）を取得
      const syncSettings = await chrome.storage.sync.get(['spreadsheets', 'imageOutputCount']);
      const localSettings = await chrome.storage.local.get(['lastUsedSheetId']);
      const spreadsheets = syncSettings.spreadsheets || [];
      const imageOutputCount = typeof syncSettings.imageOutputCount === 'number' ? syncSettings.imageOutputCount : 5;

      // スプレッドシートが未登録の場合
      if (spreadsheets.length === 0) {
        showNotification(
          '設定が必要です',
          'スプレッドシートが登録されていません。拡張機能の設定画面を開いてください。',
          'error',
          colors
        );
        return;
      }

      // 選択されたスプレッドシートを取得
      // モーダル内のセレクタがあればそれを使用、なければ最後に使ったシートIDを使用
      const selector = document.getElementById('sheet-selector');
      const selectedSheetId = selector ? selector.value : localSettings.lastUsedSheetId;

      if (!selectedSheetId) {
        showNotification(
          'エラー',
          '出力先スプレッドシートを選択してください。\n最初に「内容確認・コピー」ボタンから出力先を選択してください。',
          'error',
          colors
        );
        return;
      }

      const selectedSheet = spreadsheets.find(s => s.id === selectedSheetId);
      if (!selectedSheet) {
        showNotification(
          'エラー',
          '選択されたスプレッドシートが見つかりません',
          'error',
          colors
        );
        return;
      }

      // 最後に使ったシートIDを保存（ローカルストレージ）
      await chrome.storage.local.set({ lastUsedSheetId: selectedSheetId });

      // データを配列形式に変換（サイト別に対応）
      let values;

      // フリマサイト（39フィールド: 基本6 + ページURL1 + 画像20 + フリマ12）
      if (site === 'mercari' || site === 'mercari_shop' || site === 'yahuoku' || site === 'paypayfurima' || site === 'rakuma') {
        console.log('🏪 フリマサイトエクスポート: 39フィールド');

        // 基本6フィールド + ページURL
        values = [
          data.platform || '',              // 1. プラットフォーム
          data.url || '',                   // 2. 商品URL/ID
          data.price || '',                 // 3. 価格
          data.name || '',                  // 4. 商品名
          data.description || '',           // 5. 説明
          data.seller || '',                // 6. 出品者
          window.location.href              // 7. ページURL（新規追加）
        ];

        // 画像20フィールド（imageOutputCount設定に従う）
        const imageUrls = Array.isArray(data.imageUrl) ? data.imageUrl :
                          typeof data.imageUrl === 'string' ? data.imageUrl.split(',').map(url => url.trim()) : [];

        // imageOutputCountが0の場合は全て空、999の場合は全画像、それ以外は指定枚数まで
        const maxImages = imageOutputCount === 0 ? 0 :
                          imageOutputCount === 999 ? 20 :
                          Math.min(imageOutputCount, 20);

        for (let i = 0; i < 20; i++) {
          const url = (i < maxImages) ? (imageUrls[i] || '') : '';
          if (url) {
            values.push(`=IMAGE("${url}")`);
          } else {
            values.push(''); // 空文字
          }
        }

        // フリマ固有12フィールド
        values.push(data.reviewCount || '');
        values.push(data.badRate || '');
        values.push(data.listedFmt || '');
        values.push(data.updatedFmt || '');
        values.push(data.handlingDays || '');
        values.push(data.listedElapsedDays || '');
        values.push(data.updatedElapsedDays || '');
        values.push(data.keywords || '');
        values.push(data.condition || '');
        values.push(data.shippingPayer || '');
        values.push(data.shippingMethod || '');
        values.push(data.shipFrom || '');

        console.log('📊 フリマサイトエクスポートフィールド数:', values.length);

      } else if (site === 'ebay') {
        // eBay（7フィールド + 画像: 基本6 + ページURL1 + 画像）
        let imageFormulas = [];
        if (data.imageUrl && imageOutputCount > 0) {
          const imageUrls = data.imageUrl.split(',').map(url => url.trim());
          const maxImages = imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, imageOutputCount);
          imageFormulas = imageUrls.slice(0, maxImages).map(url => `=IMAGE("${url}")`);
        }

        values = [
          data.platform || 'ebay',
          data.url || window.location.href,
          data.price || '',
          data.name || '',
          data.description || '',
          data.seller || '',
          window.location.href,  // 7. ページURL（新規追加）
          ...imageFormulas
        ];

      } else if (site === 'rakuten' || site === 'yahooshopping') {
        // 楽天, Yahoo!ショッピング（7フィールド + 画像: 基本6 + ページURL1 + 画像）
        let imageFormulas = [];
        if (data.imageUrl && imageOutputCount > 0) {
          const imageUrls = data.imageUrl.split(',').map(url => url.trim());
          const maxImages = imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, imageOutputCount);
          imageFormulas = imageUrls.slice(0, maxImages).map(url => `=IMAGE("${url}")`);
        }

        values = [
          data.platform || (site === 'rakuten' ? 'rakuten' : 'yahoo_shopping'),
          data.url || window.location.href,
          data.price || '',
          data.name || '',
          data.description || '',
          data.seller || '',
          window.location.href,  // 7. ページURL（新規追加）
          ...imageFormulas
        ];

      } else if (site === 'amazon') {
        // Amazon（7フィールド + 画像: 基本6 + ページURL1 + 画像）
        let imageFormulas = [];
        if (data.imageUrl && imageOutputCount > 0) {
          const imageUrls = data.imageUrl.split(',').map(url => url.trim());
          const maxImages = imageOutputCount === 999 ? imageUrls.length : Math.min(imageUrls.length, imageOutputCount);
          imageFormulas = imageUrls.slice(0, maxImages).map(url => `=IMAGE("${url}")`);
        }

        values = [
          data.supplier || 'amazon',
          data.asin || '',
          data.price || '',
          data.title || '',
          data.details || '',
          data.sellerId || '',
          window.location.href,  // 7. ページURL（新規追加）
          ...imageFormulas
        ];

      } else {
        throw new Error('対応していないサイトです');
      }

      // データをクリーンアップ（タブ、改行、セル内改行を完全に削除）
      values = values.map(field => {
        if (typeof field === 'string') {
          // あらゆる種類の改行・タブを半角スペースに置換
          return field
            .replace(/\r\n/g, ' ')     // Windows改行
            .replace(/\r/g, ' ')        // Mac改行
            .replace(/\n/g, ' ')        // Unix改行
            .replace(/\u2028/g, ' ')    // ラインセパレータ
            .replace(/\u2029/g, ' ')    // パラグラフセパレータ
            .replace(/\t/g, ' ')        // タブ
            .replace(/\s+/g, ' ')       // 連続する空白を1つに
            .trim();                    // 前後の空白を削除
        }
        return field;
      });

      console.log('📤 エクスポートするデータ:', values);
      console.log('📊 エクスポートフィールド数:', values.length);

      // バックグラウンドスクリプトにメッセージを送信
      const response = await chrome.runtime.sendMessage({
        action: 'exportToSheet',
        webhookUrl: selectedSheet.webhookUrl,
        sheetName: selectedSheet.sheetName,
        values: values,
        imageOutputCount: imageOutputCount
      });

      if (response.success) {
        // 成功時の通知
        showNotification(
          '成功',
          `「${selectedSheet.name}」の「${selectedSheet.sheetName}」に追加しました！`,
          'success',
          colors
        );
      } else {
        // エラー時の通知
        showNotification(
          'エラー',
          `エクスポートに失敗しました: ${response.error}`,
          'error',
          colors
        );
      }
    } catch (error) {
      console.error('Export error:', error);
      showNotification(
        'エラー',
        `エラーが発生しました: ${error.message}`,
        'error',
        colors
      );
    }
  }

  // エクスポート機能の初期化確認
  console.log('スプレッドシートエクスポート機能が読み込まれました');

  // ==========================================
  // メルカリ商品データ抽出
  // ==========================================
  async function extractMercariProductData() {
    console.log('=== メルカリデータ抽出開始 ===');

    try {
      // 商品ID（mから始まるコードまたはメルカリショップのID）
      const pageUrl = window.location.href;
      let itemIdMatch = pageUrl.match(/\/item\/([a-zA-Z0-9]+)/);
      if (!itemIdMatch) {
        // メルカリショップのURL: /shops/product/{id}
        itemIdMatch = pageUrl.match(/\/shops\/product\/([a-zA-Z0-9]+)/);
      }
      const itemId = itemIdMatch ? itemIdMatch[1] : '';
      console.log('商品ID:', itemId);

      // タイトル
      const title = (document.querySelector('title')?.textContent?.replace(' - メルカリ', '') || '').replace(/\t/g, '  ');

      // 価格
      let price = document.querySelector('meta[name="product:price:amount"]')?.content || '';
      if (!price) {
        const priceEl = document.querySelector('[data-testid="product-price"]');
        if (priceEl) {
          price = priceEl.textContent.replace(/[^\d]/g, '');
        }
      }

      // 説明文
      let description = '';
      const ldjson = document.querySelector('script[type="application/ld+json"]');
      if (ldjson) {
        try {
          const allJson = JSON.parse(ldjson.textContent);
          const json = allJson['@graph']?.[2];
          if (json && json.description) {
            // あらゆる種類の改行・タブを半角スペースに置換
            description = json.description
              .replace(/\r\n/g, ' ')     // Windows改行
              .replace(/\r/g, ' ')        // Mac改行
              .replace(/\n/g, ' ')        // Unix改行
              .replace(/\u2028/g, ' ')    // ラインセパレータ
              .replace(/\u2029/g, ' ')    // パラグラフセパレータ
              .replace(/\t/g, ' ')        // タブ
              .replace(/\s+/g, ' ')       // 連続する空白を1つに
              .trim();                    // 前後の空白を削除
          }
        } catch (e) {
          console.warn('⚠️ 商品説明パース失敗', e);
        }
      }

      // 出品者ID（通常のメルカリとメルカリショップ両方に対応）
      let seller = '';

      // 通常のメルカリ: /user/profile/{id}
      let sellerLink = document.querySelector('a[href^="/user/profile/"]');
      if (sellerLink) {
        seller = sellerLink.getAttribute('href')?.split('/').pop() || '';
      }

      // メルカリショップ: /shops/profile/{shop_id} へのリンク
      if (!seller) {
        // パターン1: /shops/profile/{shop_id} へのリンク（最も正確）
        sellerLink = document.querySelector('a[href^="/shops/profile/"]');
        if (sellerLink) {
          const shopPath = sellerLink.getAttribute('href');
          const shopMatch = shopPath?.match(/\/shops\/profile\/([^\/\?]+)/);
          seller = shopMatch ? shopMatch[1] : '';
          console.log('✅ メルカリショップID取得 (profile):', seller);
        }
      }

      // メルカリショップ: /shops/{shop_id} へのリンク（予備）
      if (!seller) {
        sellerLink = document.querySelector('a[href^="/shops/"]:not([href*="/product"])');
        if (sellerLink) {
          const shopPath = sellerLink.getAttribute('href');
          const shopMatch = shopPath?.match(/\/shops\/([^\/\?]+)/);
          seller = shopMatch ? shopMatch[1] : '';
          console.log('✅ メルカリショップID取得 (shops):', seller);
        }
      }

      // メルカリショップ: data-testidやショップ名からID取得
      if (!seller) {
        // パターン2: ショップ名のリンクやdata-testid
        const shopNameLink = document.querySelector('[data-testid*="shop"] a, [class*="shop"] a[href^="/shops/"]');
        if (shopNameLink) {
          const shopPath = shopNameLink.getAttribute('href');
          const shopMatch = shopPath?.match(/\/shops\/([^\/]+)/);
          seller = shopMatch ? shopMatch[1] : '';
        }
      }

      // メルカリショップ: URLから直接ショップIDを推測（最終手段）
      if (!seller && pageUrl.includes('/shops/product/')) {
        // ショップページへのリンクがない場合、ページ内のすべてのリンクを検索
        const allLinks = document.querySelectorAll('a[href*="/shops/"]');
        for (const link of allLinks) {
          const href = link.getAttribute('href');
          if (href && !href.includes('/product/') && href.match(/\/shops\/([^\/]+)/)) {
            const shopMatch = href.match(/\/shops\/([^\/]+)/);
            seller = shopMatch ? shopMatch[1] : '';
            break;
          }
        }
      }

      // 詳細フィールドを取得（data-testidまたはtableから）
      const pickDetailByLabel = (keys) => {
        for (const k of keys) {
          const el = document.querySelector(`[data-testid="${k}"]`) || document.querySelector(`[data-testid*="${k}"]`);
          if (el) {
            const v = (el.textContent || el.nextElementSibling?.textContent || '').trim();
            if (v) return v;
          }
        }
        const rows = document.querySelectorAll('table tr, .ProductDetail__item, dl');
        for (const tr of Array.from(rows || [])) {
          if (!tr || !tr.querySelector) continue;
          const th = tr.querySelector('th,dt,.ProductDetail__title');
          const td = tr.querySelector('td,dd,.ProductDetail__desc');
          const key = (th ? th.textContent : '').trim();
          const val = (td ? td.textContent : '').trim();
          for (const kk of keys) {
            if (key.includes(kk)) return val;
          }
        }
        return '';
      };

      const condition = pickDetailByLabel(['商品の状態', '商品状態', 'コンディション']);
      const shippingPayer = pickDetailByLabel(['配送料の負担', '送料の負担']);
      const shippingMethod = pickDetailByLabel(['配送方法', '配送の方法']);
      const shipFrom = pickDetailByLabel(['発送元の地域', '発送元']);
      const handlingDays = pickDetailByLabel(['発送までの日数']);

      // 出品日時・更新日時を取得
      const getListingDates = () => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return '';
          const t = el.firstChild?.textContent ?? el.textContent ?? '';
          return t.trim();
        };

        let listedAt = pick('span[data-testid="出品日時"]') || pick('span[data-testid="開始日時"]');
        let updatedAt = pick('span[data-testid="更新日時"]') || pick('span[data-testid="終了日時"]');

        if (!listedAt || !updatedAt) {
          const rows = document.querySelectorAll('table tr, .ProductDetail__item, dl');
          Array.from(rows || []).forEach(tr => {
            if (!tr || !tr.querySelector) return;
            const th = tr.querySelector('th,dt,.ProductDetail__title');
            const td = tr.querySelector('td,dd,.ProductDetail__desc');
            const key = (th ? th.textContent : '').trim();
            const val = (td ? td.textContent : '').trim();
            if (!listedAt && /出品|開始/.test(key)) listedAt = val;
            if (!updatedAt && /更新|終了/.test(key)) updatedAt = val;
          });
        }

        const parseDate = (str) => {
          if (!str) return null;
          const d = new Date(str);
          if (!isNaN(d)) return d;
          return null;
        };

        const ld = parseDate(listedAt);
        const ud = parseDate(updatedAt);

        const formatJST = (d) => {
          if (!d || isNaN(d)) return '';
          return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
        };

        const daysDiff = (from) => {
          if (!(from instanceof Date) || isNaN(from)) return '';
          return (((new Date()) - from) / (1000 * 60 * 60 * 24)).toFixed(2);
        };

        return {
          listedFmt: formatJST(ld),
          updatedFmt: formatJST(ud),
          listedElapsedDays: daysDiff(ld),
          updatedElapsedDays: daysDiff(ud)
        };
      };

      const dates = getListingDates();

      // 出品者の評価情報を取得
      const getSellerRating = async () => {
        console.log('[getSellerRating] 評価情報取得開始');

        let good = null;
        let bad = null;
        let normal = null;
        let totalFromSellerLink = null; // seller-linkから取得した合計（フォールバック用）

        // メルカリショップの場合は、ショップ情報セクションから評価数を取得
        const isShop = window.location.pathname.includes('/shops/product/');
        if (isShop) {
          console.log('[getSellerRating] メルカリショップモード');

          // 方法0（最優先）: data-testid="shops-information" または "shops-profile-link" から取得
          // 形式: "ショップ名\n\n評価数\n\nメルカリShops"
          const shopsInfoEl = document.querySelector('[data-testid="shops-information"]') ||
                              document.querySelector('[data-testid="shops-profile-link"]');
          if (shopsInfoEl) {
            const shopsText = shopsInfoEl.innerText || '';
            console.log('[getSellerRating] shops-information テキスト:', shopsText.substring(0, 100));

            // 改行で分割して評価数を取得（2番目の要素が評価数）
            const lines = shopsText.split('\n').filter(line => line.trim() !== '');
            console.log('[getSellerRating] shops-information 行分割:', lines);

            if (lines.length >= 2) {
              const reviewCount = parseInt(lines[1].trim());
              if (!Number.isNaN(reviewCount) && reviewCount > 0) {
                console.log('[getSellerRating] ショップ評価数取得成功:', reviewCount);
                return { reviewCount: String(reviewCount), badRate: '' };
              }
            }
          }

          // 方法1（フォールバック）: ページ全体のテキストから評価数を探す
          const bodyText = document.body.innerText || '';

          // パターン1: 「優良ショップ」の直前にある数字（優良ショップバッジがある場合）
          const excellentShopMatch = bodyText.match(/(\d{1,5})\s*優良ショップ/);
          if (excellentShopMatch) {
            const total = parseInt(excellentShopMatch[1]);
            console.log('[getSellerRating] ショップ星評価取得（優良ショップ前）:', total);
            return { reviewCount: String(total), badRate: '' };
          }

          // パターン2: 「メルカリShops」の直前にある数字（優良ショップバッジが無い場合）
          const shopSectionMatch = bodyText.match(/ショップ情報[\s\S]{0,500}メルカリShops/);
          if (shopSectionMatch) {
            const sectionText = shopSectionMatch[0];
            console.log('[getSellerRating] ショップ情報セクション:', sectionText.substring(0, 100));

            const shopsMatch = sectionText.match(/(\d{1,6})\s*メルカリShops/);
            if (shopsMatch) {
              const total = parseInt(shopsMatch[1]);
              console.log('[getSellerRating] ショップ星評価取得（メルカリShops前）:', total);
              return { reviewCount: String(total), badRate: '' };
            }
          }

          console.log('[getSellerRating] ショップ情報セクションが見つかりませんでした');
        }

        // Step 1: seller-linkから合計評価を取得（常に取得可能）
        const sellerLinkEl = document.querySelector('[data-testid="seller-link"]');
        if (sellerLinkEl) {
          const sellerText = sellerLinkEl.innerText || '';
          console.log('[getSellerRating] seller-link テキスト:', sellerText.substring(0, 100));

          // 数値を全て抽出（改行や空白で区切られた数値）
          const allNumbers = sellerText.match(/\d+/g);
          console.log('[getSellerRating] seller-link 数値一覧:', allNumbers);

          if (allNumbers && allNumbers.length >= 1) {
            // 改行で分割し、純粋に数字のみの行を探す（セラー名に含まれる数字を避けるため）
            const lines = sellerText.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);
            let foundPureNumberLine = false;

            for (const line of lines) {
              // 行が純粋に数字のみ（空白を除く）であれば、それが評価数
              if (/^\d+$/.test(line)) {
                totalFromSellerLink = parseInt(line);
                foundPureNumberLine = true;
                console.log('[getSellerRating] seller-link 純粋数値行から合計評価:', totalFromSellerLink);
                break;
              }
            }

            // 純粋数字行が見つからない場合は最大値を使用（セラー名の数字より評価数の方が通常大きい）
            if (!foundPureNumberLine) {
              const nums = allNumbers.map(n => parseInt(n)).filter(n => !Number.isNaN(n));
              totalFromSellerLink = Math.max(...nums);
              console.log('[getSellerRating] seller-link 最大値から合計評価（フォールバック）:', totalFromSellerLink);
            }

            // 3つ以上の数値がある場合は内訳も取得を試みる
            if (allNumbers.length >= 3) {
              const nums = allNumbers.map(n => parseInt(n)).filter(n => !Number.isNaN(n));
              const total = nums[0];
              const goodVal = nums[1];
              const remaining = nums.slice(2);

              // 合計 = 良い + 悪い (+ 普通) かどうか検証
              if (remaining.length === 1) {
                const badVal = remaining[0];
                if (Math.abs(total - (goodVal + badVal)) <= 1) {
                  good = goodVal;
                  bad = badVal;
                  console.log('[getSellerRating] seller-link 解析成功（良い/悪い）:', { total, good, bad });
                }
              } else if (remaining.length >= 2) {
                const normalVal = remaining[0];
                const badVal = remaining[1];
                if (Math.abs(total - (goodVal + normalVal + badVal)) <= 1) {
                  good = goodVal;
                  normal = normalVal;
                  bad = badVal;
                  console.log('[getSellerRating] seller-link 解析成功（良い/普通/悪い）:', { total, good, normal, bad });
                } else if (Math.abs(total - (goodVal + remaining[0])) <= 1) {
                  good = goodVal;
                  bad = remaining[0];
                  console.log('[getSellerRating] seller-link 解析成功（良い/悪い + 余分）:', { total, good, bad });
                }
              }
            }
          }
        }

        // Step 2: フリマアシスト要素をポーリングで待機（内訳が未取得の場合）
        if (good === null || bad === null) {
          const getFromAssist = () => {
            const assistRatings = document.querySelector("#furima-assist-seller-ratings");
            if (!assistRatings) return null;

            const spans = assistRatings.querySelectorAll("span");
            if (spans.length < 2) return null;

            let g = parseInt((spans[0]?.textContent || "").replace(/[^\d]/g, ''));
            let b = parseInt((spans[1]?.textContent || "").replace(/[^\d]/g, ''));
            let n = spans[2] ? parseInt((spans[2]?.textContent || "").replace(/[^\d]/g, '')) : null;

            g = Number.isNaN(g) ? null : g;
            b = Number.isNaN(b) ? null : b;
            n = (n !== null && Number.isNaN(n)) ? null : n;

            if (g === null && b === null) return null;

            console.log('[getSellerRating] フリマアシスト経由:', {good: g, bad: b, normal: n});
            return { good: g, bad: b, normal: n };
          };

          // ポーリングで最大5秒待つ（500ms × 10回）
          console.log('[getSellerRating] フリマアシスト要素をポーリング待機中（最大5秒）...');
          const maxAttempts = 10;
          const interval = 500;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const assistResult = getFromAssist();
            if (assistResult) {
              good = assistResult.good;
              bad = assistResult.bad;
              normal = assistResult.normal;
              console.log('[getSellerRating] ポーリング成功（試行:', attempt + 1, '回目）');
              break;
            }
            if (attempt < maxAttempts - 1) {
              await new Promise(r => setTimeout(r, interval));
            }
          }

          if (good === null && bad === null) {
            console.log('[getSellerRating] ポーリングタイムアウト: フリマアシスト要素が見つかりませんでした');
          }
        }

        // 合計と悪い評価率を計算
        const nums = [good, normal, bad].filter(v => typeof v === 'number' && !Number.isNaN(v));
        let total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;

        // 内訳が取れなかった場合、seller-linkの合計をフォールバックとして使用
        if (total === 0 && totalFromSellerLink && !Number.isNaN(totalFromSellerLink)) {
          total = totalFromSellerLink;
          console.log('[getSellerRating] フォールバック: seller-linkの合計を使用:', total);
        }

        const badRate = (typeof bad === 'number' && total > 0)
          ? (bad * 100 / total).toFixed(2) + '%'
          : '';

        console.log('[getSellerRating] 最終結果:', {
          reviewCount: total ? String(total) : '',
          badRate,
          good,
          bad,
          normal,
          totalFromSellerLink
        });

        return {
          reviewCount: total ? String(total) : '',
          badRate
        };
      };

      let rating = await getSellerRating();
      if (!rating.reviewCount) {
        console.log('[getSellerRating] 1回目で取得失敗。2秒後にリトライ...');
        await new Promise(r => setTimeout(r, 2000));
        rating = await getSellerRating();
        if (rating.reviewCount) {
          console.log('[getSellerRating] リトライで取得成功');
        } else {
          console.log('[getSellerRating] リトライでも取得失敗');
        }
      }

      // 画像URL（最大20枚、複数の方法で取得）
      const imageUrlArray = new Array(20).fill('');
      let foundCount = 0;

      // 方法1: data-testid="image-0" ~ "image-19" から取得
      for (let i = 0; i < 20; i++) {
        const imgEl = document.querySelector(`img[data-testid="image-${i}"]`);
        if (imgEl) {
          let url = '';
          const srcset = imgEl.getAttribute('srcset');
          if (srcset) {
            const match = srcset.match(/^([^\s]+)/);
            if (match) url = match[1];
          }
          if (!url) {
            url = imgEl.src || imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
          }
          if (url && url.startsWith('http')) {
            imageUrlArray[i] = url;
            foundCount++;
          }
        }
      }

      // 方法2: カルーセルから取得（data-testidで取得できなかった場合）
      if (foundCount === 0) {
        const carousel = document.querySelector('[data-testid="carousel"]') ||
                         document.querySelector('mer-carousel-item') ||
                         document.querySelector('[class*="imageArea"]') ||
                         document.querySelector('[class*="ItemImage"]') ||
                         document.querySelector('mer-item-thumbnail');

        if (carousel) {
          const images = carousel.querySelectorAll('img');
          console.log('📸 カルーセルから画像検索:', images.length, '個');
          images.forEach((img, idx) => {
            if (idx < 20) {
              let url = '';
              const srcset = img.getAttribute('srcset');
              if (srcset) {
                const match = srcset.match(/^([^\s]+)/);
                if (match) url = match[1];
              }
              if (!url) {
                url = img.src || img.getAttribute('src') || img.getAttribute('data-src') || '';
              }
              if (url && url.startsWith('http')) {
                imageUrlArray[idx] = url;
                foundCount++;
              }
            }
          });
        }
      }

      // 方法3: 全picture要素から取得
      if (foundCount === 0) {
        const pictures = document.querySelectorAll('picture img, picture source');
        console.log('📸 picture要素から画像検索:', pictures.length, '個');
        pictures.forEach((el, idx) => {
          if (idx < 20) {
            let url = '';
            if (el.tagName === 'SOURCE') {
              url = el.getAttribute('srcset') || '';
              if (url) {
                const match = url.match(/^([^\s]+)/);
                if (match) url = match[1];
              }
            } else {
              const srcset = el.getAttribute('srcset');
              if (srcset) {
                const match = srcset.match(/^([^\s]+)/);
                if (match) url = match[1];
              }
              if (!url) {
                url = el.src || el.getAttribute('src') || '';
              }
            }
            if (url && url.startsWith('http')) {
              imageUrlArray[idx] = url;
              foundCount++;
            }
          }
        });
      }

      // 方法4: og:imageフォールバック
      if (foundCount === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          const url = ogImage.getAttribute('content');
          console.log('📸 og:imageから取得:', url);
          if (url && url.startsWith('http')) {
            imageUrlArray[0] = url;
            foundCount++;
          }
        }
      }

      console.log('=== メルカリ抽出結果 ===');
      console.log('プラットフォーム: mercari');
      console.log('商品ID:', itemId);
      console.log('タイトル:', title);
      console.log('価格:', price);
      console.log('説明:', description.substring(0, 100));
      console.log('出品者:', seller);
      console.log('画像URL数:', foundCount);
      console.log('商品の状態:', condition);
      console.log('配送料の負担:', shippingPayer);
      console.log('配送方法:', shippingMethod);
      console.log('発送元:', shipFrom);
      console.log('発送日数:', handlingDays);
      console.log('出品日時:', dates.listedFmt);
      console.log('更新日時:', dates.updatedFmt);
      console.log('評価件数:', rating.reviewCount);
      console.log('悪い評価率:', rating.badRate);

      return {
        platform: 'mercari',
        url: itemId, // 商品ID（mから始まるコード）
        price: price,
        name: title,
        description: description,
        seller: seller,
        imageUrl: imageUrlArray, // 配列として返す（20要素）
        condition: condition,
        shippingPayer: shippingPayer,
        shippingMethod: shippingMethod,
        shipFrom: shipFrom,
        handlingDays: handlingDays,
        listedFmt: dates.listedFmt,
        updatedFmt: dates.updatedFmt,
        listedElapsedDays: dates.listedElapsedDays,
        updatedElapsedDays: dates.updatedElapsedDays,
        reviewCount: rating.reviewCount, // 評価件数
        badRate: rating.badRate, // 悪い評価率
        keywords: '' // キーワード検知は別途処理
      };

    } catch (error) {
      console.error('❌ メルカリ抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ==========================================
  // ヤフオク商品データ抽出
  // ==========================================
  function extractYahooProductData() {
    console.log('=== ヤフオクデータ抽出開始 ===');

    try {
      // __NEXT_DATA__ からJSON データを取得
      const dataScript = document.getElementById('__NEXT_DATA__');
      if (!dataScript) {
        console.error('❌ __NEXT_DATA__ が見つかりません');
        return { error: '__NEXT_DATA__ が見つかりませんでした' };
      }

      const jsonData = JSON.parse(dataScript.textContent);
      const itemJson = jsonData.props.pageProps.initialState.item.detail.item;

      console.log('📦 itemJson取得成功:', itemJson.auctionId);

      // 商品URL
      const url = window.location.href;

      // 商品ID
      const itemId = itemJson.auctionId;

      // タイトル
      const title = itemJson.title.replace(/\t/g, '  '); // タブを空白に変換

      // 価格（本体価格 + 送料）
      let price = itemJson.taxinPrice || itemJson.price || 0;
      let shipping = 0;

      // 送料を取得
      const shippingElement = document.querySelector('div[id="itemPostage"]');
      if (shippingElement) {
        const shippingText = shippingElement.innerText || '';
        shipping = parseInt(shippingText.replace(/[^0-9]/g, '')) || 0;
        console.log('📦 送料:', shipping);
      }

      price = price + shipping;

      // 説明文（description + カテゴリ + コンディション + ブランド）
      let description = itemJson.description || '';

      // カテゴリを追加
      if (itemJson.category && itemJson.category.path) {
        const categoryPath = itemJson.category.path.map(item => item.name).join(' > ');
        description += `\nカテゴリ: ${categoryPath}`;
      }

      // コンディションを追加
      if (itemJson.conditionName) {
        description += `\nコンディション: ${itemJson.conditionName}`;
      }

      // ブランドを追加
      if (itemJson.brand && itemJson.brand.path) {
        const brandPath = itemJson.brand.path.map(item => item.name).join(' > ');
        description += `\nブランド: ${brandPath}`;
      }

      description = description.replace(/\t/g, '  '); // タブを空白に変換

      // 出品者ID
      const seller = itemJson.seller?.aucUserId || '';
      const sellerName = itemJson.seller?.displayName || '';

      // 画像URL（最大20枚）
      const imageUrlArray = new Array(20).fill('');
      if (itemJson.img && Array.isArray(itemJson.img)) {
        itemJson.img.forEach((imgObj, idx) => {
          if (idx < 20 && imgObj.image) {
            imageUrlArray[idx] = imgObj.image;
          }
        });
      }

      // 商品の状態
      const condition = itemJson.conditionName || '';

      // 配送料の負担を判定（複数の方法で取得）
      let shippingPayer = '';

      // 方法1: itemJson.shippingFeeから取得
      if (itemJson.shippingFee?.shippingPayer) {
        shippingPayer = itemJson.shippingFee.shippingPayer;
        console.log('✅ 配送料の負担（方法1 - shippingFee）:', shippingPayer);
      }

      // 方法2: 送料の有無から判定（送料0円なら出品者負担、それ以外なら落札者負担）
      if (!shippingPayer && shipping !== undefined) {
        if (shipping === 0) {
          shippingPayer = '出品者負担';
          console.log('✅ 配送料の負担（方法2 - 送料0円）:', shippingPayer);
        } else if (shipping > 0) {
          shippingPayer = '落札者負担';
          console.log('✅ 配送料の負担（方法2 - 送料あり）:', shippingPayer, '（送料:', shipping, '円）');
        }
      }

      // 方法3: itemJson.isFreeshippingから判定
      if (!shippingPayer && itemJson.isFreeshipping !== undefined) {
        shippingPayer = itemJson.isFreeshipping ? '出品者負担' : '落札者負担';
        console.log('✅ 配送料の負担（方法3 - isFreeshipping）:', shippingPayer);
      }

      // 方法4: DOM要素から取得
      if (!shippingPayer) {
        const shippingElement = document.querySelector('span[data-testid="配送料の負担"]') ||
                                document.querySelector('[class*="ShippingFee"]');
        if (shippingElement) {
          const text = shippingElement.textContent.trim();
          if (text.includes('出品者') || text.includes('送料無料')) {
            shippingPayer = '出品者負担';
          } else if (text.includes('落札者') || text.includes('着払い')) {
            shippingPayer = '落札者負担';
          } else {
            shippingPayer = text;
          }
          console.log('✅ 配送料の負担（方法4 - DOM要素）:', shippingPayer);
        }
      }

      if (!shippingPayer) {
        console.log('⚠️ 配送料の負担を取得できませんでした');
      }

      // 配送方法
      const shippingMethod = itemJson.shipment?.name || itemJson.shipping?.name || '';

      // 発送元の地域
      const shipFrom = itemJson.location?.prefecture || itemJson.seller?.location?.prefecture || '';

      // 発送までの日数
      const handlingDays = itemJson.shipment?.duration || itemJson.shipping?.duration || '';

      // ヤフオク用：終了までの残り日数を計算
      let listedFmt = '';
      let updatedFmt = '';
      let listedElapsedDays = ''; // ヤフオクでは「終了までの残り日数」として使用
      let updatedElapsedDays = ''; // ヤフオクでは使用しない

      console.log('📅 ヤフオク - endTime取得:', itemJson.endTime);

      // 終了日時から残り日数を計算
      if (itemJson.endTime) {
        let timestamp = parseInt(itemJson.endTime);
        console.log('📅 endTime変換前:', timestamp);

        // タイムスタンプが秒単位かミリ秒単位かを判定（秒単位なら1000倍）
        if (timestamp < 10000000000) {
          timestamp = timestamp * 1000;
          console.log('📅 終了日時を秒→ミリ秒に変換:', timestamp);
        }

        const endDate = new Date(timestamp);
        console.log('📅 endDate:', endDate, 'isValid:', !isNaN(endDate.getTime()));

        if (!isNaN(endDate.getTime())) {
          listedFmt = endDate.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');

          // 終了までの残り日数を計算（マイナスの場合は終了済み）
          const remainingDays = (endDate - new Date()) / (1000 * 60 * 60 * 24);
          listedElapsedDays = String(remainingDays.toFixed(2));

          console.log('📅 オークション終了日:', listedFmt, '残り日数:', listedElapsedDays);
        }
      }

      // 出品者の評価情報を取得
      const getSellerRating = () => {
        console.log('[Yahoo getSellerRating] 評価情報取得開始');

        let good = null;
        let bad = null;
        let normal = null;

        // 方法1: #furima-assist-seller-ratings から取得
        const assistRatings = document.querySelector("#furima-assist-seller-ratings");
        if (assistRatings) {
          const spans = assistRatings.querySelectorAll("span");
          if (spans.length >= 2) {
            good = parseInt((spans[0]?.textContent || "").replace(/[^\d]/g, ''));
            bad = parseInt((spans[1]?.textContent || "").replace(/[^\d]/g, ''));
            if (spans[2]) {
              normal = parseInt((spans[2]?.textContent || "").replace(/[^\d]/g, ''));
            }
            good = Number.isNaN(good) ? null : good;
            bad = Number.isNaN(bad) ? null : bad;
            normal = Number.isNaN(normal) ? null : normal;
            console.log('[Yahoo getSellerRating] #furima-assist-seller-ratings経由:', {good, bad, normal});
          }
        }

        // 方法2: itemJsonから評価情報を取得
        if ((good === null || bad === null) && itemJson.seller?.rating) {
          const rating = itemJson.seller.rating;
          if (rating.good != null) good = rating.good;
          if (rating.bad != null) bad = rating.bad;
          if (rating.normal != null) normal = rating.normal;
          console.log('[Yahoo getSellerRating] itemJson.seller.rating経由:', {good, bad, normal});
        }

        // 方法3: Rating関連のspan要素から取得
        if (good === null || bad === null) {
          const sellerSection = document.querySelector('[class*="Seller"]');
          const allSpans = document.querySelectorAll('[class*="Rating"] span, [class*="評価"] span');

          const spans = [...allSpans].filter(span => {
            if (sellerSection && sellerSection.contains(span)) {
              return false;
            }
            return true;
          });

          console.log('[Yahoo getSellerRating] span要素検索:', spans.length, '個');

          if (spans && spans.length) {
            const nums = [...spans]
              .map(x => parseInt((x.textContent || '').replace(/[^\d]/g, '')))
              .filter(n => !Number.isNaN(n) && n > 0 && n < 100000);

            console.log('[Yahoo getSellerRating] span内の数値:', nums);

            if (nums.length >= 2) {
              good = nums[0];
              bad = nums[1];
              if (nums[2] != null) normal = nums[2];
            }
          }
        }

        // 方法4: テキスト検索
        if (good === null || bad === null) {
          const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
          const goodMatch = bodyText.match(/良い[^\d]*([0-9,]+)/);
          const normalMatch = bodyText.match(/普通[^\d]*([0-9,]+)/);
          const badMatch = bodyText.match(/悪い[^\d]*([0-9,]+)/);

          console.log('[Yahoo getSellerRating] テキスト検索:', {
            良い: goodMatch?.[1],
            普通: normalMatch?.[1],
            悪い: badMatch?.[1]
          });

          if (goodMatch) good = parseInt(goodMatch[1].replace(/,/g, ''));
          if (normalMatch) normal = parseInt(normalMatch[1].replace(/,/g, ''));
          if (badMatch) bad = parseInt(badMatch[1].replace(/,/g, ''));

          const totalMatch = bodyText.match(/評価[^\d]*([0-9,]+)/);
          if ((good === null || bad === null) && totalMatch) {
            const total = parseInt(totalMatch[1].replace(/,/g, ''));
            console.log('[Yahoo getSellerRating] 評価合計のみ取得:', total);
            return { reviewCount: String(total), badRate: '' };
          }
        }

        // 合計と悪い評価率を計算
        const nums = [good, normal, bad].filter(v => typeof v === 'number' && !Number.isNaN(v));
        const total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
        const badRate = (typeof bad === 'number' && total > 0)
          ? (bad * 100 / total).toFixed(2) + '%'
          : '';

        console.log('[Yahoo getSellerRating] 最終結果:', {
          reviewCount: total ? String(total) : '',
          badRate,
          good,
          bad,
          normal
        });

        return {
          reviewCount: total ? String(total) : '',
          badRate
        };
      };

      const rating = getSellerRating();

      console.log('=== ヤフオク抽出結果 ===');
      console.log('プラットフォーム: yahoo');
      console.log('商品ID:', itemId);
      console.log('タイトル:', title);
      console.log('価格:', price, '（本体:', itemJson.taxinPrice || itemJson.price, '+ 送料:', shipping, '）');
      console.log('出品者:', seller, '/', sellerName);
      console.log('画像URL数:', imageUrlArray.filter(url => url).length);
      console.log('商品の状態:', condition);
      console.log('配送料の負担:', shippingPayer);
      console.log('配送方法:', shippingMethod);
      console.log('発送元:', shipFrom);
      console.log('発送日数:', handlingDays);
      console.log('出品日時:', listedFmt);
      console.log('終了日時:', updatedFmt);
      console.log('評価件数:', rating.reviewCount);
      console.log('悪い評価率:', rating.badRate);

      return {
        platform: 'yahuoku',
        url: itemId, // 商品IDを出力（URLではなく）
        price: String(price),
        name: title,
        description: description,
        seller: seller,
        imageUrl: imageUrlArray, // 配列として返す（20要素）
        condition: condition,
        shippingPayer: shippingPayer,
        shippingMethod: shippingMethod,
        shipFrom: shipFrom,
        handlingDays: handlingDays,
        listedFmt: listedFmt,
        updatedFmt: updatedFmt,
        listedElapsedDays: listedElapsedDays,
        updatedElapsedDays: updatedElapsedDays,
        reviewCount: rating.reviewCount, // 評価件数
        badRate: rating.badRate, // 悪い評価率
        keywords: '' // キーワード検知は別途処理
      };

    } catch (error) {
      console.error('❌ ヤフオク抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ==========================================
  // PayPayフリマ商品データ抽出
  // ==========================================
  function extractPayPayProductData() {
    console.log('=== PayPayフリマデータ抽出開始 ===');

    try {
      // 商品URL
      const url = window.location.href;

      // 商品ID（URLから取得）
      const itemId = location.pathname.split("/").pop();

      // ld+jsonから基本データを取得
      let dataJson = {};
      const ldjsonTag = document.querySelector('script[type="application/ld+json"]');

      if (ldjsonTag) {
        try {
          const tmpJson = JSON.parse(ldjsonTag.textContent);
          // 配列なら最初の要素、そうでなければそのまま
          dataJson = Array.isArray(tmpJson) ? tmpJson[0] : tmpJson;
          console.log('📦 ld+json取得成功');
        } catch (e) {
          console.warn('⚠️ ld+jsonのパースに失敗しました', e);
        }
      }

      // タイトル
      let title = (dataJson.name || '').replace(/\t/g, '  ');

      // 価格
      const price = String(dataJson.offers?.price || '');

      // 説明文（ld+jsonから）
      let description = (dataJson.description || '')
        .replace(/\r\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\u2028/g, ' ')
        .replace(/\u2029/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // テーブルから詳細情報を取得
      const rows = document.querySelectorAll("table.ItemTable__Component tr");
      console.log('📊 テーブル行数:', rows.length);

      // テーブル情報を収集
      let infoFormatted = "";
      const ignoreKeys = [
        "出品日時", "更新日時", "配送の方法", "発送までの日数", "発送元の地域", "商品ID"
      ];

      // 詳細フィールド用の変数
      let condition = '';
      let shippingPayer = '';
      let shippingMethod = '';
      let shipFrom = '';
      let handlingDays = '';
      let listedFmt = '';
      let updatedFmt = '';
      let listedElapsedDays = '';
      let updatedElapsedDays = '';

      rows.forEach(row => {
        const key = row.querySelector("th span")?.textContent?.trim();
        const valueNode = row.querySelector("td");
        let value = "";

        if (valueNode) {
          // カテゴリのように <a><span>...</span></a> が複数ある場合
          const spanTexts = Array.from(valueNode.querySelectorAll("span, p"))
            .map(el => el.textContent.trim())
            .filter(text => text.length > 0);
          value = spanTexts.join(" > ");
        }
        value = value.replace(/  +/g, '');

        console.log('📋 テーブル行:', { key, value });

        if (key && value) {
          if (!ignoreKeys.includes(key)) {
            infoFormatted += `${key}: ${value}; `;
          }

          // フィールドに割り当て（複数のパターンに対応、優先度の高い順に判定）
          if (key === "商品の状態" || key?.includes("状態")) {
            condition = value;
            console.log('✅ 商品の状態を設定:', value);
          }

          // 配送料の負担（「配送の方法」より先に判定）
          if (key === "配送料の負担" || key === "送料の負担" || (key?.includes("送料") && key?.includes("負担"))) {
            shippingPayer = value;
            console.log('✅ 配送料の負担を設定:', value);
          }

          // 配送方法（配送料の負担と重複しないように判定）
          if ((key === "配送の方法" || key === "配送方法") && !shippingMethod) {
            shippingMethod = value;
            console.log('✅ 配送方法を設定:', value);
          }

          if (key === "発送元の地域" || key === "発送元" || key?.includes("発送元")) {
            shipFrom = value;
            console.log('✅ 発送元を設定:', value);
          }

          if (key === "発送までの日数" || (key?.includes("発送") && key?.includes("日数"))) {
            handlingDays = value;
            console.log('✅ 発送までの日数を設定:', value);
          }

          // 出品日時（"2025/10/01 10:13:50 9時間前 > 9時間前" のような形式）
          if (key === "出品日時") {
            const dateMatch = value.match(/(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/);
            if (dateMatch) {
              const dateStr = dateMatch[1];
              const d = new Date(dateStr.replace(/\//g, '-'));
              if (!isNaN(d)) {
                listedFmt = dateStr;
                listedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
                console.log('📅 出品日時設定:', listedFmt, listedElapsedDays);
              }
            }
          }

          // 更新日時
          if (key === "更新日時") {
            const dateMatch = value.match(/(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/);
            if (dateMatch) {
              const dateStr = dateMatch[1];
              const d = new Date(dateStr.replace(/\//g, '-'));
              if (!isNaN(d)) {
                updatedFmt = dateStr;
                updatedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
                console.log('📅 更新日時設定:', updatedFmt, updatedElapsedDays);
              }
            }
          }
        }
      });

      infoFormatted = infoFormatted.replace(/[\n\r]+/g, ' ').trim();

      // 説明文にテーブル情報を追加
      if (infoFormatted) {
        description += ' ' + infoFormatted;
      }
      description = description.replace(/\t/g, '  ');

      // 画像URL（最大20枚）
      const imageUrlArray = new Array(20).fill('');
      let imageUrls = [];

      // slick-listから画像を取得
      const slickListNode = document.querySelector("div.slick-list");
      if (slickListNode) {
        imageUrls = Array.from(slickListNode.querySelectorAll("img"))
          .map(img => img.getAttribute("src"))
          .filter(src => src && src.startsWith('http'));
      }

      // フォールバック: ld+jsonのimageを使用
      if (imageUrls.length === 0) {
        const fallbackImage = dataJson?.image;
        if (fallbackImage) {
          imageUrls = Array.isArray(fallbackImage) ? fallbackImage : [fallbackImage];
        }
      }

      // 配列に格納（最大20枚）
      imageUrls.forEach((url, idx) => {
        if (idx < 20) {
          imageUrlArray[idx] = url;
        }
      });

      // 出品者情報
      const sellerAnchor = document.querySelector('a[href*="/user/"]');
      const seller = sellerAnchor?.getAttribute("href")?.split("/").pop() || "";
      const sellerName = document.querySelector('div[class*="UserInfo__Name"]')?.textContent?.trim() || "";

      // 出品者の評価情報を取得
      const getSellerRating = () => {
        console.log('[PayPay getSellerRating] 評価情報取得開始');

        let good = null;
        let bad = null;
        let normal = null;

        // 方法1: #furima-assist-seller-ratings から取得（元の拡張機能が挿入する要素）
        const assistRatings = document.querySelector("#furima-assist-seller-ratings");
        if (assistRatings) {
          const spans = assistRatings.querySelectorAll("span");
          if (spans.length >= 2) {
            good = parseInt((spans[0]?.textContent || "").replace(/[^\d]/g, ''));
            bad = parseInt((spans[1]?.textContent || "").replace(/[^\d]/g, ''));
            if (spans[2]) {
              normal = parseInt((spans[2]?.textContent || "").replace(/[^\d]/g, ''));
            }
            good = Number.isNaN(good) ? null : good;
            bad = Number.isNaN(bad) ? null : bad;
            normal = Number.isNaN(normal) ? null : normal;
            console.log('[PayPay getSellerRating] #furima-assist-seller-ratings経由:', {good, bad, normal});
          }
        }

        // 方法2: Rating関連のspan要素から取得
        if (good === null || bad === null) {
          const sellerSection = document.querySelector('[class*="UserInfo"]') ||
                                document.querySelector('[class*="Seller"]');

          const allSpans = document.querySelectorAll('[class*="Rating"] span, [class*="評価"] span, [class*="rating"] span');

          // 出品者セクション内のspanを除外（誤検出防止）
          const spans = [...allSpans].filter(span => {
            if (sellerSection && sellerSection.contains(span)) {
              return false;
            }
            return true;
          });

          console.log('[PayPay getSellerRating] span要素検索:', spans.length, '個（出品者セクション除外後）');

          if (spans && spans.length) {
            const nums = [...spans]
              .map(x => parseInt((x.textContent || '').replace(/[^\d]/g, '')))
              .filter(n => !Number.isNaN(n) && n > 0 && n < 100000); // 異常値除外

            console.log('[PayPay getSellerRating] span内の数値:', nums);

            if (nums.length >= 2) {
              good = nums[0];
              bad = nums[1];
              if (nums[2] != null) normal = nums[2];
            }
          }
        }

        // 方法3: テキスト検索（「良い」「普通」「悪い」パターン）
        if (good === null || bad === null) {
          const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
          const goodMatch = bodyText.match(/良い[^\d]*([0-9,]+)/);
          const normalMatch = bodyText.match(/普通[^\d]*([0-9,]+)/);
          const badMatch = bodyText.match(/悪い[^\d]*([0-9,]+)/);

          console.log('[PayPay getSellerRating] テキスト検索:', {
            良い: goodMatch?.[1],
            普通: normalMatch?.[1],
            悪い: badMatch?.[1]
          });

          if (goodMatch) good = parseInt(goodMatch[1].replace(/,/g, ''));
          if (normalMatch) normal = parseInt(normalMatch[1].replace(/,/g, ''));
          if (badMatch) bad = parseInt(badMatch[1].replace(/,/g, ''));

          // 「評価」だけで合計が取れた場合
          const totalMatch = bodyText.match(/評価[^\d]*([0-9,]+)/);
          if ((good === null || bad === null) && totalMatch) {
            const total = parseInt(totalMatch[1].replace(/,/g, ''));
            console.log('[PayPay getSellerRating] 評価合計のみ取得:', total);
            return { reviewCount: String(total), badRate: '' };
          }
        }

        // 合計と悪い評価率を計算
        const nums = [good, normal, bad].filter(v => typeof v === 'number' && !Number.isNaN(v));
        const total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
        const badRate = (typeof bad === 'number' && total > 0)
          ? (bad * 100 / total).toFixed(2) + '%'
          : '';

        console.log('[PayPay getSellerRating] 最終結果:', {
          reviewCount: total ? String(total) : '',
          badRate,
          good,
          bad,
          normal
        });

        return {
          reviewCount: total ? String(total) : '',
          badRate
        };
      };

      const rating = getSellerRating();

      console.log('=== PayPayフリマ抽出結果 ===');
      console.log('プラットフォーム: paypay');
      console.log('商品ID:', itemId);
      console.log('タイトル:', title);
      console.log('価格:', price);
      console.log('出品者:', seller, '/', sellerName);
      console.log('画像URL数:', imageUrlArray.filter(url => url).length);
      console.log('商品の状態:', condition);
      console.log('配送料の負担:', shippingPayer);
      console.log('配送方法:', shippingMethod);
      console.log('発送元:', shipFrom);
      console.log('発送日数:', handlingDays);
      console.log('評価件数:', rating.reviewCount);
      console.log('悪い評価率:', rating.badRate);

      return {
        platform: 'paypayfurima',
        url: itemId, // 商品IDを出力（URLではなく）
        price: price,
        name: title,
        description: description,
        seller: seller,
        imageUrl: imageUrlArray, // 配列として返す（20要素）
        condition: condition,
        shippingPayer: shippingPayer,
        shippingMethod: shippingMethod,
        shipFrom: shipFrom,
        handlingDays: handlingDays,
        listedFmt: listedFmt,
        updatedFmt: updatedFmt,
        listedElapsedDays: listedElapsedDays,
        updatedElapsedDays: updatedElapsedDays,
        reviewCount: rating.reviewCount, // 評価件数
        badRate: rating.badRate, // 悪い評価率
        keywords: '' // キーワード検知は別途処理
      };

    } catch (error) {
      console.error('❌ PayPayフリマ抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ==========================================
  // ラクマ商品データ抽出
  // ==========================================
  function extractFrilProductData() {
    console.log('=== ラクマデータ抽出開始 ===');

    try {
      // 商品ID（URLの最後の部分、複数の形式に対応）
      let itemId = location.pathname.split("/").filter(p => p).pop(); // 空要素を除外

      // URLパラメータからも取得を試みる（フォールバック）
      if (!itemId || itemId.length < 5) {
        const match = location.pathname.match(/\/item\/([a-zA-Z0-9]+)/);
        if (match) itemId = match[1];
      }

      console.log('📦 商品ID:', itemId);
      console.log('📦 現在のURL:', location.href);

      // ld+jsonから基本データを取得
      let itemJson = {};
      const ldjson = document.querySelector('script[type="application/ld+json"]');

      if (ldjson) {
        try {
          itemJson = JSON.parse(ldjson.textContent);
          console.log('📦 ld+json取得成功:', itemJson);
        } catch (e) {
          console.warn('⚠️ ld+jsonのパースに失敗しました', e);
        }
      }

      // タイトル（ld+jsonまたはDOMから取得）
      let title = (itemJson.name || '').replace(/\t/g, '  ');
      if (!title) {
        // DOMから取得（フォールバック）
        const titleElem = document.querySelector('h1.item-name, h1[class*="item"], h1[class*="title"], h1');
        title = (titleElem?.textContent || '').trim().replace(/\t/g, '  ');
        console.log('📦 タイトル（DOM）:', title);
      }

      // 価格（ld+jsonまたはDOMから取得）
      let price = String(itemJson.offers?.price || '');
      if (!price) {
        // DOMから取得（フォールバック）
        const priceElem = document.querySelector('.item-price, [class*="price"]');
        if (priceElem) {
          price = priceElem.textContent.replace(/[^\d]/g, '');
          console.log('📦 価格（DOM）:', price);
        }
      }

      // 説明文
      let description = (itemJson.description || '')
        .replace(/\r\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\u2028/g, ' ')
        .replace(/\u2029/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // 出品日時・更新日時をld+jsonから取得（方法1）
      let listedFmt = '';
      let listedElapsedDays = '';
      let updatedFmt = '';
      let updatedElapsedDays = '';

      // ld+jsonからdatePublished, dateModifiedを取得
      if (itemJson.datePublished) {
        const d = new Date(itemJson.datePublished);
        if (!isNaN(d)) {
          listedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
          listedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
          console.log('📅 出品日時設定（ld+json）:', listedFmt, listedElapsedDays);
        }
      }

      if (itemJson.dateModified) {
        const d = new Date(itemJson.dateModified);
        if (!isNaN(d)) {
          updatedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
          updatedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
          console.log('📅 更新日時設定（ld+json）:', updatedFmt, updatedElapsedDays);
        }
      }

      // DOMから直接日時を取得（方法2 - ld+jsonで取れなかった場合）
      if (!listedFmt || !updatedFmt) {
        console.log('🔍 DOMから日時を探索開始...');

        // 方法2-1: data-*属性から取得
        const createdAtElem = document.querySelector('[data-created-at], [data-listing-date]');
        if (createdAtElem && !listedFmt) {
          const dateStr = createdAtElem.getAttribute('data-created-at') || createdAtElem.getAttribute('data-listing-date');
          if (dateStr) {
            const d = new Date(dateStr);
            if (!isNaN(d)) {
              listedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
              listedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
              console.log('📅 出品日時設定（data-*）:', listedFmt);
            }
          }
        }

        // 方法2-2: 全てのテキストから日時パターンを探す
        if (!listedFmt || !updatedFmt) {
          const allText = document.body.innerText;

          // 「出品日時: 2025/10/28 10:27:08」のようなパターンを探す
          const listedMatch = allText.match(/出品日時[：:\s]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/);
          if (listedMatch && !listedFmt) {
            const dateStr = listedMatch[1].replace(/\//g, '-');
            const d = new Date(dateStr);
            if (!isNaN(d)) {
              listedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
              listedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
              console.log('📅 出品日時設定（テキストパターン）:', listedFmt);
            }
          }

          // 「更新日時: 2025/10/28 20:19:10」のようなパターンを探す
          const updatedMatch = allText.match(/更新日時[：:\s]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/);
          if (updatedMatch && !updatedFmt) {
            const dateStr = updatedMatch[1].replace(/\//g, '-');
            const d = new Date(dateStr);
            if (!isNaN(d)) {
              updatedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
              updatedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
              console.log('📅 更新日時設定（テキストパターン）:', updatedFmt);
            }
          }
        }
      }

      // 商品の詳細情報をテーブルから取得
      const infoRows = document.querySelectorAll('.item__details tr');
      let allInfoFormatted = '';
      console.log('📊 詳細テーブル行数:', infoRows.length);

      // 詳細フィールド用の変数
      let condition = '';
      let shippingPayer = '';
      let shippingMethod = '';
      let shipFrom = '';
      let handlingDays = '';

      infoRows.forEach(row => {
        const key = row.querySelector('th')?.textContent?.trim();
        const value = row.querySelector('td')?.textContent?.trim().replace(/  +/g, '');
        console.log('📋 詳細行:', { key, value });

        if (key && value) {
          allInfoFormatted += `${key}: ${value}; `;

          console.log('🔍 キー比較:', {
            key,
            includes出品: key?.includes('出品'),
            includes更新: key?.includes('更新'),
            value
          });

          // フィールドに割り当て
          if (key === '商品の状態' || key?.includes('状態')) {
            condition = value;
            console.log('✅ 商品の状態を設定:', value);
          }
          if (key === '配送料の負担' || key === '送料の負担' || key?.includes('送料')) {
            shippingPayer = value;
            console.log('✅ 配送料の負担を設定:', value);
          }
          if (key === '配送方法' || key === '配送の方法') {
            shippingMethod = value;
            console.log('✅ 配送方法を設定:', value);
          }
          if (key === '発送元の地域' || key === '発送元') {
            shipFrom = value;
            console.log('✅ 発送元を設定:', value);
          }
          if (key === '発送日の目安' || key?.includes('発送') && key?.includes('日')) {
            handlingDays = value;
            console.log('✅ 発送日数を設定:', value);
          }

          // 出品日時（方法3 - テーブルから取得、まだ設定されていない場合のみ）
          if (!listedFmt && key?.includes('出品')) {
            // 「10時間前」などの相対時間を含むテキストから絶対日時を抽出
            const dateMatch = value.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/);
            if (dateMatch) {
              const dateStr = dateMatch[1].replace(/\//g, '-');
              const d = new Date(dateStr);
              if (!isNaN(d)) {
                listedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
                listedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
                console.log('📅 出品日時設定（テーブル）:', listedFmt, listedElapsedDays);
              }
            } else {
              // 相対時間のみの場合はパース試行
              const d = new Date(value);
              if (!isNaN(d)) {
                listedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
                listedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
                console.log('📅 出品日時設定（テーブル・直接パース）:', listedFmt, listedElapsedDays);
              }
            }
          }

          // 更新日時（方法3 - テーブルから取得、まだ設定されていない場合のみ）
          if (!updatedFmt && key?.includes('更新')) {
            // 「14分前」などの相対時間を含むテキストから絶対日時を抽出
            const dateMatch = value.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/);
            if (dateMatch) {
              const dateStr = dateMatch[1].replace(/\//g, '-');
              const d = new Date(dateStr);
              if (!isNaN(d)) {
                updatedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
                updatedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
                console.log('📅 更新日時設定（テーブル）:', updatedFmt, updatedElapsedDays);
              }
            } else {
              // 相対時間のみの場合はパース試行
              const d = new Date(value);
              if (!isNaN(d)) {
                updatedFmt = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' JST');
                updatedElapsedDays = String(((new Date() - d) / (1000 * 60 * 60 * 24)).toFixed(2));
                console.log('📅 更新日時設定（テーブル・直接パース）:', updatedFmt, updatedElapsedDays);
              }
            }
          }
        }
      });

      // 説明文にテーブル情報を追加
      if (allInfoFormatted) {
        description += ' ' + allInfoFormatted.replace(/\t/g, '  ');
      }

      // 出品者ID
      let seller = '';
      const shopLink = document.querySelector('a.shop_link');
      if (shopLink) {
        const href = shopLink.getAttribute('href');
        const match = href?.match(/\/shop\/([a-z0-9]+)/i);
        seller = match ? match[1] : '';
      }
      const sellerName = document.querySelector('p.header-shopinfo__user-name')?.textContent?.trim() || '';

      // 画像URL（最大20枚、#photoFrameから取得）
      const imageUrlArray = new Array(20).fill('');
      let foundCount = 0;

      const photoFrame = document.querySelector('#photoFrame');
      if (photoFrame) {
        const images = photoFrame.querySelectorAll('img');
        console.log('📸 #photoFrameから画像検索:', images.length, '個');
        images.forEach((img, idx) => {
          if (idx < 20) {
            const url = img.getAttribute('src') || img.src || '';
            if (url && url.startsWith('http')) {
              imageUrlArray[idx] = url;
              foundCount++;
            }
          }
        });
      }

      // og:imageフォールバック
      if (foundCount === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          const url = ogImage.getAttribute('content');
          console.log('📸 og:imageから取得:', url);
          if (url && url.startsWith('http')) {
            imageUrlArray[0] = url;
            foundCount++;
          }
        }
      }

      // 出品者の評価情報を取得
      const getSellerRating = () => {
        console.log('[Rakuma getSellerRating] 評価情報取得開始');

        let good = null;
        let bad = null;
        let normal = null;

        // 方法1: #furima-assist-seller-ratings から取得
        const assistRatings = document.querySelector("#furima-assist-seller-ratings");
        if (assistRatings) {
          const spans = assistRatings.querySelectorAll("span");
          if (spans.length >= 2) {
            good = parseInt((spans[0]?.textContent || "").replace(/[^\d]/g, ''));
            bad = parseInt((spans[1]?.textContent || "").replace(/[^\d]/g, ''));
            if (spans[2]) {
              normal = parseInt((spans[2]?.textContent || "").replace(/[^\d]/g, ''));
            }
            good = Number.isNaN(good) ? null : good;
            bad = Number.isNaN(bad) ? null : bad;
            normal = Number.isNaN(normal) ? null : normal;
            console.log('[Rakuma getSellerRating] #furima-assist-seller-ratings経由:', {good, bad, normal});
          }
        }

        // 方法2: .flea-assist-ratingsから取得
        if (good === null || bad === null) {
          const sun = document.querySelector('.flea-assist-ratings .icon_review_sun');
          const cloud = document.querySelector('.flea-assist-ratings .icon_review_cloud');
          const rain = document.querySelector('.flea-assist-ratings .icon_review_rain');

          if (sun && sun.nextSibling && sun.nextSibling.nodeType === 3) {
            const goodText = sun.nextSibling.textContent.trim();
            good = parseInt(goodText);
          }
          if (cloud && cloud.nextSibling && cloud.nextSibling.nodeType === 3) {
            const normalText = cloud.nextSibling.textContent.trim();
            normal = parseInt(normalText);
          }
          if (rain && rain.nextSibling && rain.nextSibling.nodeType === 3) {
            const badText = rain.nextSibling.textContent.trim();
            bad = parseInt(badText);
          }
          console.log('[Rakuma getSellerRating] .flea-assist-ratings経由:', {good, bad, normal});
        }

        // 方法3: テキスト検索
        if (good === null || bad === null) {
          const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
          const goodMatch = bodyText.match(/良い[^\d]*([0-9,]+)/);
          const normalMatch = bodyText.match(/普通[^\d]*([0-9,]+)/);
          const badMatch = bodyText.match(/悪い[^\d]*([0-9,]+)/);

          console.log('[Rakuma getSellerRating] テキスト検索:', {
            良い: goodMatch?.[1],
            普通: normalMatch?.[1],
            悪い: badMatch?.[1]
          });

          if (goodMatch) good = parseInt(goodMatch[1].replace(/,/g, ''));
          if (normalMatch) normal = parseInt(normalMatch[1].replace(/,/g, ''));
          if (badMatch) bad = parseInt(badMatch[1].replace(/,/g, ''));

          const totalMatch = bodyText.match(/評価[^\d]*([0-9,]+)/);
          if ((good === null || bad === null) && totalMatch) {
            const total = parseInt(totalMatch[1].replace(/,/g, ''));
            console.log('[Rakuma getSellerRating] 評価合計のみ取得:', total);
            return { reviewCount: String(total), badRate: '' };
          }
        }

        // 合計と悪い評価率を計算
        const nums = [good, normal, bad].filter(v => typeof v === 'number' && !Number.isNaN(v));
        const total = nums.length ? nums.reduce((a, b) => a + b, 0) : 0;
        const badRate = (typeof bad === 'number' && total > 0)
          ? (bad * 100 / total).toFixed(2) + '%'
          : '';

        console.log('[Rakuma getSellerRating] 最終結果:', {
          reviewCount: total ? String(total) : '',
          badRate,
          good,
          bad,
          normal
        });

        return {
          reviewCount: total ? String(total) : '',
          badRate
        };
      };

      const rating = getSellerRating();

      // 最低限の検証（商品IDは必須）
      if (!itemId) {
        console.error('❌ 商品IDが取得できませんでした');
        return { error: 'ラクマの商品IDを取得できませんでした' };
      }

      console.log('=== ラクマ抽出結果 ===');
      console.log('プラットフォーム: rakuma');
      console.log('商品ID:', itemId);
      console.log('タイトル:', title);
      console.log('価格:', price);
      console.log('出品者:', seller, '/', sellerName);
      console.log('画像URL数:', foundCount);
      console.log('商品の状態:', condition);
      console.log('配送料の負担:', shippingPayer);
      console.log('配送方法:', shippingMethod);
      console.log('発送元:', shipFrom);
      console.log('発送日数:', handlingDays);
      console.log('出品日時:', listedFmt);
      console.log('更新日時:', updatedFmt);
      console.log('評価件数:', rating.reviewCount);
      console.log('悪い評価率:', rating.badRate);

      return {
        platform: 'rakuma',
        url: itemId, // 商品IDを出力（URLではなく）
        price: price,
        name: title,
        description: description,
        seller: seller,
        imageUrl: imageUrlArray, // 配列として返す（20要素）
        condition: condition,
        shippingPayer: shippingPayer,
        shippingMethod: shippingMethod,
        shipFrom: shipFrom,
        handlingDays: handlingDays,
        listedFmt: listedFmt,
        updatedFmt: updatedFmt,
        listedElapsedDays: listedElapsedDays,
        updatedElapsedDays: updatedElapsedDays,
        reviewCount: rating.reviewCount, // 評価件数
        badRate: rating.badRate, // 悪い評価率
        keywords: '' // キーワード検知は別途処理
      };

    } catch (error) {
      console.error('❌ ラクマ抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ==========================================
  // Yahoo!ショッピング商品データ抽出
  // ==========================================
  function extractYahooShoppingProductData() {
    console.log('=== Yahoo!ショッピングデータ抽出開始 ===');

    try {
      const url = window.location.href;

      // 商品名を取得（複数の方法で試行）
      let name = '';

      // 方法1: 標準的なセレクタ
      const nameSelectors = [
        'h1[class*="Product"]',
        'h1[class*="product"]',
        'h1[class*="Title"]',
        'h1[class*="title"]',
        'h1[class*="Name"]',
        'h1[class*="name"]',
        'h1.mdHeading1',
        'h1'
      ];

      for (const selector of nameSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.innerText?.trim() || '';
          if (text.length >= 10 && text.length <= 200) {
            // ナビゲーション要素を除外
            if (!text.match(/^(Yahoo|ヤフー|ショッピング|カテゴリ|ホーム|カート|検索|ログイン)/i)) {
              name = text;
              console.log('✅ 商品名を取得:', name.substring(0, 50));
              break;
            }
          }
        }
      }

      // 方法2: meta og:titleから取得
      if (!name || name.trim() === '' || name.length < 5) {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          const content = ogTitle.getAttribute('content');
          if (content && content.length >= 10 && content.length <= 200) {
            name = content;
            console.log('✅ og:titleから商品名を取得:', name.substring(0, 50));
          }
        }
      }

      // 方法3: document.titleから抽出
      if (!name || name.trim() === '' || name.length < 5) {
        const title = document.title;
        const parts = title.split(/[|｜]/);
        if (parts.length > 0) {
          const candidate = parts[0].trim();
          if (candidate.length >= 10 && candidate.length <= 200) {
            name = candidate;
            console.log('✅ document.titleから商品名を取得:', name.substring(0, 50));
          }
        }
      }

      // クリーンアップ
      name = name.replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '').trim();

      if (!name || name.length < 5) {
        console.error('❌ Yahoo!ショッピングの商品名を取得できませんでした');
        name = '商品名を取得できませんでした';
      }

      // 価格を取得
      let price = 0;
      let priceText = '';

      const priceSelectors = [
        'span[class*="Price_price"]',
        'span[class*="price"]',
        'div[class*="Price"]',
        'div[class*="price"]',
        'span.mdPriceValue',
        'p.mdPriceValue',
        '[data-testid="price"]',
        'meta[property="product:price:amount"]'
      ];

      for (const selector of priceSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          if (element.tagName === 'META') {
            priceText = element.getAttribute('content');
          } else if (element.hasAttribute('data-price')) {
            priceText = element.getAttribute('data-price');
          } else {
            priceText = element.innerText?.trim();
          }

          if (priceText) {
            const num = extractNumber(priceText);
            if (num >= 1 && num <= 10000000) {
              price = num;
              console.log('✅ 価格を取得:', price, '円');
              break;
            }
          }
        }
      }

      // 送料を取得
      const pageText = document.body.innerText;
      let shipping = 0;

      if (pageText.includes('送料無料') || pageText.includes('送料込み') || pageText.includes('送料込')) {
        shipping = 0;
        console.log('✅ 送料: 無料');
      } else if (pageText.includes('送料') && !pageText.includes('送料無料')) {
        const shippingSelectors = [
          'span[class*="shipping"]',
          'span[class*="Shipping"]',
          'div[class*="shipping"]',
          'div[class*="Shipping"]',
          '[class*="postage"]',
          '[class*="delivery"]'
        ];

        for (const selector of shippingSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.innerText?.trim();
            if (text && text.includes('円')) {
              const num = extractNumber(text);
              if (num > 0 && num <= 5000) {
                shipping = num;
                console.log('✅ 送料:', shipping, '円');
                break;
              }
            }
          }
        }
      }

      price = price + shipping;

      // 商品説明を取得（Yahoo!ショッピング用 - 商品情報テーブルを優先）
      let description = '';
      console.log('🔍 Yahoo!ショッピング商品説明の取得を開始...');

      // 方法1: 「商品情報」セクションのテーブルから取得（最優先）
      console.log('📊 方法1: テーブル要素を探索中...');
      const infoTables = document.querySelectorAll('table');
      console.log(`見つかったテーブル数: ${infoTables.length}`);
      let productInfoText = '';

      for (let i = 0; i < infoTables.length; i++) {
        const table = infoTables[i];
        const text = table.innerText?.trim() || '';

        console.log(`テーブル ${i + 1}:`, text.substring(0, 150));

        // 商品情報テーブルの特徴：「ブランド」を含む、または「原作」「シリーズ」「製品仕様」などを含む
        if (text.includes('ブランド') || text.includes('原作') || text.includes('シリーズ') ||
            text.includes('製品仕様') || text.includes('原型製作') || text.includes('コピーライト')) {

          console.log(`✅ 商品情報テーブル候補を発見（テーブル ${i + 1}）:`, text.substring(0, 100));

          // テーブルの各行を抽出
          const rows = table.querySelectorAll('tr');
          console.log(`  行数: ${rows.length}`);
          let infoLines = [];

          rows.forEach((row, rowIndex) => {
            // th と td の両方を取得
            const ths = row.querySelectorAll('th');
            const tds = row.querySelectorAll('td');

            console.log(`  行 ${rowIndex + 1}: th=${ths.length}, td=${tds.length}`);

            if (ths.length > 0 && tds.length > 0) {
              // th と td がある場合
              const label = ths[0].innerText?.trim() || '';
              const value = tds[0].innerText?.trim() || '';

              if (label && value) {
                const cleanValue = value.replace(/\t/g, ' ').replace(/\n+/g, ' ').trim();
                infoLines.push(`${label}：${cleanValue}`);
                console.log(`    抽出: ${label}：${cleanValue.substring(0, 50)}`);
              }
            } else if (tds.length >= 2) {
              // td が2つ以上ある場合
              const label = tds[0].innerText?.trim() || '';
              const value = tds[1].innerText?.trim() || '';

              if (label && value) {
                const cleanValue = value.replace(/\t/g, ' ').replace(/\n+/g, ' ').trim();
                infoLines.push(`${label}：${cleanValue}`);
                console.log(`    抽出: ${label}：${cleanValue.substring(0, 50)}`);
              }
            } else if (tds.length === 1) {
              // td が1つだけの場合（解説など）
              const content = tds[0].innerText?.trim() || '';
              if (content && content.length > 10 && !content.includes('商品情報')) {
                infoLines.push(content);
                console.log(`    単一セル: ${content.substring(0, 50)}`);
              }
            }
          });

          if (infoLines.length > 0) {
            productInfoText = infoLines.join('\n');
            console.log(`✅ 商品情報を${infoLines.length}行取得しました`);
            console.log('取得内容:', productInfoText.substring(0, 300));
            break;
          }
        }
      }

      if (productInfoText && productInfoText.length >= 20) {
        description = productInfoText;
        console.log('✅ 商品情報テーブルから説明文を取得（最終確認）:', description.substring(0, 200));
      } else {
        console.log('⚠️ 方法1では商品情報を取得できませんでした');
      }

      // 方法2: ページ上部の「商品情報」テキストブロックを取得
      if (!description || description.length < 50) {
        console.log('⚠️ テーブルから取得できませんでした。テキストブロックを探します...');

        // 「商品情報」というヘッダーの後に続くコンテンツを探す
        const allElements = document.querySelectorAll('*');
        let foundProductInfo = false;
        let collectedText = [];

        for (const el of allElements) {
          const text = el.innerText?.trim() || '';

          // 「商品情報」というテキストを含む要素を見つける
          if (!foundProductInfo && text === '商品情報') {
            foundProductInfo = true;
            console.log('✅ 「商品情報」ヘッダーを発見');
            continue;
          }

          // 商品情報セクションの後のコンテンツを収集
          if (foundProductInfo) {
            // 次のセクション（ランキング、レビューなど）に到達したら終了
            if (text.match(/^(ランキング|レビュー|口コミ|おすすめ|関連商品|買い物かご)/)) {
              break;
            }

            // 商品情報らしいテキストを収集
            if (text.length >= 10 && text.length < 1000) {
              // ショップの宣伝文句を除外
              if (!text.includes('格安通販店') && !text.includes('当店限定商品')) {
                collectedText.push(text);

                // 十分な情報が集まったら終了
                if (collectedText.join('\n').length >= 500) {
                  break;
                }
              }
            }
          }
        }

        if (collectedText.length > 0) {
          description = collectedText.join('\n');
          console.log(`✅ テキストブロックから${collectedText.length}個の要素を取得:`, description.substring(0, 200));
        }
      }

      // 方法3: 一般的なセレクタから取得
      if (!description || description.length < 50) {
        console.log('⚠️ 商品情報セクションが見つかりませんでした。一般的なセレクタを試します...');

        const generalSelectors = [
          '#detailBox',
          '.mdProductDetailBox',
          '[class*="Detail"]',
          '[class*="detail"]',
          '[class*="Spec"]',
          '[class*="spec"]'
        ];

        // 除外すべき要素
        const excludeSelectors = [
          '.review', '.reviews', '[class*="review"]',
          '.recommend', '[class*="recommend"]',
          '.ranking', '[class*="ranking"]',
          'nav', '[class*="nav"]',
          '.breadcrumb', '[class*="breadcrumb"]',
          'header', 'footer',
          '[class*="Cart"]', '[class*="Button"]'
        ];

        for (const selector of generalSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const clone = el.cloneNode(true);

            // 除外要素を削除
            excludeSelectors.forEach(excludeSelector => {
              clone.querySelectorAll(excludeSelector).forEach(node => node.remove());
            });

            let text = clone.innerText?.trim() || '';

            // ショップの宣伝を除外
            if (!text.includes('格安通販店') && text.length >= 100 && text.length < 5000) {
              description = text;
              console.log(`✅ セレクタ ${selector} から取得:`, text.substring(0, 200));
              break;
            }
          }
        }
      }

      // 方法4: 最終フォールバック - ページ全体から商品スペックを抽出
      if (!description || description.length < 50) {
        console.log('⚠️ 最終フォールバック：ページ全体から商品情報を探します...');

        const bodyText = document.body.innerText || '';
        const lines = bodyText.split('\n');
        let relevantLines = [];

        // 商品スペックに関連する行を抽出
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length < 5 || trimmed.length > 500) continue;

          // 商品情報らしいキーワードを含む行
          if (trimmed.match(/^(ブランド|原作|シリーズ|作者|原型製作|コピーライト|製品仕様|サイズ|備考|解説|検索ワード)[:：]/)) {
            relevantLines.push(trimmed);
          }
        }

        if (relevantLines.length > 0) {
          description = relevantLines.join('\n');
          console.log(`✅ ページ全体から${relevantLines.length}行の商品情報を抽出`);
        }
      }

      if (!description || description.length < 20) {
        console.error('❌ 商品説明を取得できませんでした');
        description = '商品説明を取得できませんでした';
      } else {
        console.log(`✅ 最終的な商品説明（${description.length}文字）:`, description.substring(0, 300));
      }

      // 販売者情報を取得
      let seller = '';
      const sellerSelectors = [
        'a[class*="Store"]',
        'a[class*="store"]',
        'a[class*="Shop"]',
        'a[class*="shop"]',
        'a[class*="Seller"]',
        'a[class*="seller"]',
        '[class*="StoreName"]',
        '[class*="storeName"]',
        '[class*="ShopName"]',
        '[class*="shopName"]'
      ];

      for (const selector of sellerSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          seller = element.innerText?.trim() || '';
          if (seller && seller.length > 0 && seller.length < 100) {
            console.log('✅ 販売者:', seller);
            break;
          }
        }
      }

      if (!seller) {
        // URLから店舗名を抽出（store.shopping.yahoo.co.jp/店舗名/商品ID.html）
        const urlMatch = url.match(/store\.shopping\.yahoo\.co\.jp\/([^\/]+)/);
        if (urlMatch) {
          seller = urlMatch[1];
          console.log('✅ URLから販売者を抽出:', seller);
        } else {
          seller = '出品者情報なし';
        }
      }

      // 画像URLを取得（最大20枚）
      const imageUrls = [];

      // 方法1: 商品画像のセレクタから取得
      const imageSelectors = [
        'img[class*="Product"]',
        'img[class*="product"]',
        'img[class*="Item"]',
        'img[class*="item"]',
        'img[class*="Thumbnail"]',
        'img[class*="thumbnail"]',
        'img[data-index]',
        '[class*="Gallery"] img',
        '[class*="gallery"] img'
      ];

      const galleryImages = document.querySelectorAll(imageSelectors.join(','));
      galleryImages.forEach(img => {
        const url = img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
        if (url && url.startsWith('http') && !imageUrls.includes(url)) {
          // 小さすぎる画像は除外（アイコンなど）
          if (!url.includes('icon') && !url.includes('banner') && !url.includes('logo') && !url.includes('btn')) {
            console.log(`📷 Yahoo!ショッピング画像: ${url}`);
            imageUrls.push(url);
            if (imageUrls.length >= 20) return;
          }
        }
      });

      // 方法2: og:imageもフォールバックとして追加
      if (imageUrls.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          const url = ogImage.getAttribute('content');
          if (url) {
            console.log(`🖼️ Yahoo!ショッピングOG画像: ${url}`);
            imageUrls.push(url);
          }
        }
      }

      const imageUrl = imageUrls.join(',');
      console.log(`✅ Yahoo!ショッピング画像URL確定（${imageUrls.length}枚）:`, imageUrl.substring(0, 100));

      console.log('=== Yahoo!ショッピング抽出結果 ===');
      console.log('プラットフォーム: yahooshopping');
      console.log('商品名:', name);
      console.log('価格:', price, '円（本体 + 送料:', shipping, '円）');
      console.log('商品詳細（長さ）:', description.length);
      console.log('出品者:', seller);
      console.log('画像URL数:', imageUrls.length);

      if (!name || name.trim() === '') {
        return { error: '商品名が取得できませんでした。' };
      }

      if (!price || price === 0) {
        return {
          error: '価格が取得できませんでした。\n\n取得できたデータ:\n商品名: ' + name
        };
      }

      console.log('✅ 抽出成功');
      return {
        platform: 'yahoo_shopping',
        url: url,
        price: price,
        name: name,
        description: description || '商品詳細なし',
        seller: seller || '出品者情報なし',
        imageUrl: imageUrl || ''
      };

    } catch (error) {
      console.error('❌ Yahoo!ショッピング抽出エラー:', error);
      return { error: 'データの抽出に失敗しました: ' + error.message };
    }
  }

  // ==========================================
  // 外部リンクボタン機能（商品ページのみ）
  // ==========================================
  console.log('🔗 外部リンク機能を初期化');

  if (typeof initExternalLinksForProduct === 'function') {
    initExternalLinksForProduct(currentSite);
    console.log('✅ 外部リンク機能を開始:', currentSite);
  } else {
    console.log('⚠️ 外部リンク機能が読み込まれていません');
  }

})();
