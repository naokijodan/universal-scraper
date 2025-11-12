// Universal Product Scraper - Background Script
// Webhook送信とメッセージ処理

console.log('Background script loaded (Universal Scraper)');

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportToSheet') {
    handleExportToSheet(request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 非同期レスポンスを示す
  }

  if (request.action === 'verifyWebhook') {
    verifyWebhookUrl(request.webhookUrl, request.sheetName)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Google Apps Script WebhookにデータをPOST
 */
async function handleExportToSheet(request) {
  try {
    const { webhookUrl, sheetName, values } = request;

    if (!webhookUrl) {
      throw new Error('Webhook URLが設定されていません');
    }

    console.log('📤 バックグラウンド：データ送信開始');
    console.log('Webhook URL:', webhookUrl);
    console.log('Sheet Name:', sheetName);
    console.log('Values array length:', values.length);

    // Apps Script WebhookにPOSTリクエスト
    const response = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors', // CORSエラー回避
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: values,
        sheetName: sheetName || 'インポート用'
      })
    });

    // no-corsモードでは詳細なレスポンスが取得できないため、
    // エラーがなければ成功と見なす
    console.log('✅ データ送信成功');

    return {
      success: true,
      message: `${sheetName}に追加しました`
    };

  } catch (error) {
    console.error('❌ エクスポートエラー:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Webhook URLの検証
 */
async function verifyWebhookUrl(webhookUrl, sheetName) {
  try {
    if (!webhookUrl) {
      throw new Error('Webhook URLが入力されていません');
    }

    // URLの形式チェック
    if (!webhookUrl.includes('script.google.com') &&
        !webhookUrl.includes('script.googleusercontent.com')) {
      throw new Error('正しいGoogle Apps Script URLではありません');
    }

    // テストデータを送信
    const testData = {
      values: Array(26).fill('テスト'), // 共通6項目 + フリマ11項目 + キーワード1項目 + 画像URLダミー8個
      sheetName: sheetName || 'インポート用'
    };

    console.log('🧪 Webhook接続テスト:', webhookUrl);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });

    // no-corsモードではレスポンスの詳細は取得できないが、
    // エラーがなければ成功と見なす
    return {
      success: true,
      message: `接続テスト成功！「${sheetName}」シートを確認してください。`
    };

  } catch (error) {
    console.error('❌ 検証エラー:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
