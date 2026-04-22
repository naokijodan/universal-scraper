// 設定ページのJavaScript - 複数スプレッドシート対応版

// デフォルト設定（default_setting_json.jsから関数を使用）
const defaultSettings = {
  enableEbay: true,
  enableRakuten: true,
  enableAmazon: true,
  enableHardoff: true,
  alertKeywords: defaultAlertKeywords().join('\n'), // 除外キーワード（赤ハイライト）
  popupKeywords: defaultPopupKeywords().join('\n'), // 注目キーワード（黄色ハイライト）
  buttonPosition: 'top-right',
  spreadsheets: [], // 複数スプレッドシート対応
  lastUsedSheetId: null, // 最後に使ったシートID
  maxSheets: 10, // 最大登録数
  imageOutputCount: 999, // 出力する画像枚数（全ての画像、最大20枚）
  enableImageInClipboard: true, // クリップボードコピー時に画像URLを含める（デフォルト有効）
  // 画像読み込み待機時間（秒）
  amazonLoadDelay: 3,
  ebayLoadDelay: 3,
  rakutenLoadDelay: 3,
  mercariLoadDelay: 3,
  yahooLoadDelay: 3,
  frilLoadDelay: 3,
  hardoffLoadDelay: 3,
  // フリマサイトアラート条件
  alertBadRate: 5,
  alertLowReviewCount: 100,
  alertDaysFromListing: 180,
  alertDaysFromUpdate: 90,
  alertHandlingDays: false
};

// ページ読み込み時に設定を復元
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
});

// 設定を読み込み
async function loadSettings() {
  try {
    // 同期設定を読み込み（キーワード、アラート条件、スプレッドシートリスト）
    const syncSettings = await chrome.storage.sync.get(defaultSettings);

    // ローカル設定を読み込み（最後に使ったシートIDのみ）
    const localSettings = await chrome.storage.local.get({
      lastUsedSheetId: null
    });

    // チェックボックスの状態を設定
    document.getElementById('enableEbay').checked = syncSettings.enableEbay;
    document.getElementById('enableRakuten').checked = syncSettings.enableRakuten;
    document.getElementById('enableAmazon').checked = syncSettings.enableAmazon;
    document.getElementById('enableHardoff').checked = syncSettings.enableHardoff;

    // その他の設定値を設定
    document.getElementById('alertKeywords').value = syncSettings.alertKeywords;
    document.getElementById('popupKeywords').value = syncSettings.popupKeywords;
    document.getElementById('buttonPosition').value = syncSettings.buttonPosition;

    // 画像出力設定を設定
    document.getElementById('imageOutputCount').value = syncSettings.imageOutputCount;
    document.getElementById('enableImageInClipboard').checked = syncSettings.enableImageInClipboard;

    // 画像読み込み待機時間を設定
    document.getElementById('amazonLoadDelay').value = syncSettings.amazonLoadDelay;
    document.getElementById('ebayLoadDelay').value = syncSettings.ebayLoadDelay;
    document.getElementById('rakutenLoadDelay').value = syncSettings.rakutenLoadDelay;
    document.getElementById('mercariLoadDelay').value = syncSettings.mercariLoadDelay;
    document.getElementById('yahooLoadDelay').value = syncSettings.yahooLoadDelay;
    document.getElementById('frilLoadDelay').value = syncSettings.frilLoadDelay;
    document.getElementById('hardoffLoadDelay').value = syncSettings.hardoffLoadDelay;

    // フリマサイトアラート設定を設定
    document.getElementById('alertBadRate').value = syncSettings.alertBadRate || 5;
    document.getElementById('alertLowReviewCount').value = syncSettings.alertLowReviewCount || 100;
    document.getElementById('alertDaysFromListing').value = syncSettings.alertDaysFromListing || 180;
    document.getElementById('alertDaysFromUpdate').value = syncSettings.alertDaysFromUpdate || 90;
    document.getElementById('alertHandlingDays').checked = syncSettings.alertHandlingDays || false;

    // スプレッドシート一覧を表示（同期設定から）
    renderSpreadsheetList(syncSettings.spreadsheets || []);

    // トグル状態の表示を更新
    updateToggleStatus('enableEbay', 'statusEbay');
    updateToggleStatus('enableRakuten', 'statusRakuten');
    updateToggleStatus('enableAmazon', 'statusAmazon');
    updateToggleStatus('enableHardoff', 'statusHardoff');
    updateToggleStatus('enableImageInClipboard', 'statusImageInClipboard');
  } catch (error) {
    console.error('Error loading settings:', error);
    showMessage('設定の読み込みに失敗しました', 'error');
  }
}

// スプレッドシート一覧を表示
function renderSpreadsheetList(spreadsheets) {
  const listContainer = document.getElementById('spreadsheetList');
  const countLabel = document.getElementById('sheetCount');

  countLabel.textContent = `(${spreadsheets.length}/${defaultSettings.maxSheets})`;

  if (spreadsheets.length === 0) {
    listContainer.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #999; border: 2px dashed #ddd; border-radius: 8px;">
        登録されているスプレッドシートはありません<br>
        下のフォームから追加してください
      </div>
    `;
    return;
  }

  listContainer.innerHTML = spreadsheets.map((sheet, index) => `
    <div class="spreadsheet-item" data-id="${sheet.id}" style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 10px; background: #fafafa;">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 16px; color: #333; margin-bottom: 8px;">
            ${escapeHtml(sheet.name)}
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
            <strong>URL:</strong> ${escapeHtml(sheet.webhookUrl.substring(0, 50))}...
          </div>
          <div style="font-size: 12px; color: #666;">
            <strong>シート名:</strong> ${escapeHtml(sheet.sheetName)}
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-test-sheet" data-id="${sheet.id}" style="padding: 6px 12px; background: #2196F3; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
            🧪 テスト
          </button>
          <button class="btn-edit-sheet" data-id="${sheet.id}" style="padding: 6px 12px; background: #FF9800; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
            ✏️ 編集
          </button>
          <button class="btn-delete-sheet" data-id="${sheet.id}" style="padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
            🗑️ 削除
          </button>
        </div>
      </div>
    </div>
  `).join('');

  // イベントリスナーを追加
  document.querySelectorAll('.btn-test-sheet').forEach(btn => {
    btn.addEventListener('click', (e) => testSpreadsheet(e.target.dataset.id));
  });

  document.querySelectorAll('.btn-edit-sheet').forEach(btn => {
    btn.addEventListener('click', (e) => editSpreadsheet(e.target.dataset.id));
  });

  document.querySelectorAll('.btn-delete-sheet').forEach(btn => {
    btn.addEventListener('click', (e) => deleteSpreadsheet(e.target.dataset.id));
  });
}

// HTMLエスケープ
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// イベントリスナーを設定
function setupEventListeners() {
  // 保存ボタン
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  // リセットボタン
  document.getElementById('resetBtn').addEventListener('click', resetSettings);

  // スプレッドシート追加ボタン
  document.getElementById('addSheetBtn').addEventListener('click', addSpreadsheet);

  // Apps Scriptコードコピーボタン
  const copyScriptBtn = document.getElementById('copyScriptBtn');
  if (copyScriptBtn) {
    copyScriptBtn.addEventListener('click', copyScript);
  }

  // トグルスイッチの状態変更イベント
  document.getElementById('enableEbay').addEventListener('change', () => {
    updateToggleStatus('enableEbay', 'statusEbay');
  });

  document.getElementById('enableRakuten').addEventListener('change', () => {
    updateToggleStatus('enableRakuten', 'statusRakuten');
  });

  document.getElementById('enableAmazon').addEventListener('change', () => {
    updateToggleStatus('enableAmazon', 'statusAmazon');
  });

  document.getElementById('enableHardoff').addEventListener('change', () => {
    updateToggleStatus('enableHardoff', 'statusHardoff');
  });

  // 画像出力設定のトグル
  document.getElementById('enableImageInClipboard').addEventListener('change', () => {
    updateToggleStatus('enableImageInClipboard', 'statusImageInClipboard');
  });
}

// トグルスイッチの状態表示を更新
function updateToggleStatus(toggleId, statusId) {
  const toggle = document.getElementById(toggleId);
  const status = document.getElementById(statusId);

  if (toggle.checked) {
    status.textContent = '有効';
    status.style.color = '#2e7d32';
  } else {
    status.textContent = '無効';
    status.style.color = '#c62828';
  }
}

// スプレッドシートを追加
async function addSpreadsheet() {
  const name = document.getElementById('newSheetName').value.trim();
  const webhookUrl = document.getElementById('newWebhookUrl').value.trim();
  const sheetName = document.getElementById('newTargetSheet').value.trim();
  const resultDiv = document.getElementById('addSheetResult');

  // バリデーション
  if (!name) {
    resultDiv.innerHTML = '<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">識別名を入力してください</div>';
    return;
  }

  if (!webhookUrl) {
    resultDiv.innerHTML = '<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">Webhook URLを入力してください</div>';
    return;
  }

  if (!webhookUrl.includes('script.google.com')) {
    resultDiv.innerHTML = '<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">正しいGoogle Apps Script URLを入力してください</div>';
    return;
  }

  if (!sheetName) {
    resultDiv.innerHTML = '<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">シート名を入力してください</div>';
    return;
  }

  try {
    // 同期ストレージからスプレッドシート設定を取得
    const syncSettings = await chrome.storage.sync.get({ spreadsheets: [] });
    const spreadsheets = syncSettings.spreadsheets || [];

    // 最大数チェック
    if (spreadsheets.length >= defaultSettings.maxSheets) {
      resultDiv.innerHTML = `<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">最大${defaultSettings.maxSheets}件まで登録できます</div>`;
      return;
    }

    // 重複チェック
    if (spreadsheets.some(s => s.name === name)) {
      resultDiv.innerHTML = '<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">同じ識別名が既に登録されています</div>';
      return;
    }

    // 新しいスプレッドシートを追加
    const newSheet = {
      id: Date.now().toString(),
      name: name,
      webhookUrl: webhookUrl,
      sheetName: sheetName
    };

    spreadsheets.push(newSheet);

    // 同期ストレージに保存
    await chrome.storage.sync.set({ spreadsheets: spreadsheets });

    // 入力フィールドをクリア
    document.getElementById('newSheetName').value = '';
    document.getElementById('newWebhookUrl').value = '';
    document.getElementById('newTargetSheet').value = 'インポート用';

    resultDiv.innerHTML = '<div style="color: #4CAF50; padding: 10px; background: #e8f5e9; border-radius: 4px;">✓ 追加しました</div>';
    setTimeout(() => {
      resultDiv.innerHTML = '';
    }, 3000);

    // 一覧を再描画
    renderSpreadsheetList(spreadsheets);

  } catch (error) {
    console.error('Error adding spreadsheet:', error);
    resultDiv.innerHTML = '<div style="color: #f44336; padding: 10px; background: #ffebee; border-radius: 4px;">エラーが発生しました</div>';
  }
}

// スプレッドシートをテスト
async function testSpreadsheet(id) {
  try {
    const syncSettings = await chrome.storage.sync.get(['spreadsheets']);
    const sheet = syncSettings.spreadsheets.find(s => s.id === id);

    if (!sheet) return;

    const btn = document.querySelector(`[data-id="${id}"].btn-test-sheet`);
    btn.textContent = '送信中...';
    btn.disabled = true;

    const response = await chrome.runtime.sendMessage({
      action: 'verifyWebhook',
      webhookUrl: sheet.webhookUrl,
      sheetName: sheet.sheetName
    });

    if (response.success) {
      alert(`✓ 接続成功！\n\n「${sheet.name}」の「${sheet.sheetName}」シートを確認してください。`);
    } else {
      alert(`✗ 接続失敗\n\n${response.error}`);
    }

    btn.textContent = '🧪 テスト';
    btn.disabled = false;

  } catch (error) {
    console.error('Test error:', error);
    alert('テストに失敗しました: ' + error.message);
  }
}

// スプレッドシートを編集
async function editSpreadsheet(id) {
  try {
    const syncSettings = await chrome.storage.sync.get(['spreadsheets']);
    const sheet = syncSettings.spreadsheets.find(s => s.id === id);

    if (!sheet) return;

    let updated = false;

    // 識別名を編集
    const newName = prompt('識別名を入力 (キャンセルでスキップ):', sheet.name);
    if (newName && newName.trim() !== sheet.name) {
      sheet.name = newName.trim();
      updated = true;
    }

    // Webhook URLを編集
    const newWebhookUrl = prompt('Webhook URLを入力 (キャンセルでスキップ):', sheet.webhookUrl);
    if (newWebhookUrl && newWebhookUrl.trim() !== sheet.webhookUrl) {
      sheet.webhookUrl = newWebhookUrl.trim();
      updated = true;
    }

    // シート名を編集
    const newSheetName = prompt('シート名を入力 (キャンセルでスキップ):', sheet.sheetName);
    if (newSheetName && newSheetName.trim() !== sheet.sheetName) {
      sheet.sheetName = newSheetName.trim();
      updated = true;
    }

    if (updated) {
      await chrome.storage.sync.set({ spreadsheets: syncSettings.spreadsheets });
      renderSpreadsheetList(syncSettings.spreadsheets);
      showMessage('更新しました', 'success');
    }

  } catch (error) {
    console.error('Edit error:', error);
    showMessage('更新に失敗しました', 'error');
  }
}

// スプレッドシートを削除
async function deleteSpreadsheet(id) {
  if (!confirm('本当に削除しますか？')) return;

  try {
    const syncSettings = await chrome.storage.sync.get(['spreadsheets']);
    const spreadsheets = syncSettings.spreadsheets.filter(s => s.id !== id);

    await chrome.storage.sync.set({ spreadsheets: spreadsheets });

    // 一覧を再描画
    renderSpreadsheetList(spreadsheets);
    showMessage('削除しました', 'success');

  } catch (error) {
    console.error('Delete error:', error);
    showMessage('削除に失敗しました', 'error');
  }
}

// 設定を保存
async function saveSettings() {
  try {
    const settings = {
      enableEbay: document.getElementById('enableEbay').checked,
      enableRakuten: document.getElementById('enableRakuten').checked,
      enableAmazon: document.getElementById('enableAmazon').checked,
      enableHardoff: document.getElementById('enableHardoff').checked,
      alertKeywords: document.getElementById('alertKeywords').value,
      popupKeywords: document.getElementById('popupKeywords').value,
      buttonPosition: document.getElementById('buttonPosition').value,
      imageOutputCount: (() => { const v = parseInt(document.getElementById('imageOutputCount').value); return isNaN(v) ? 999 : v; })(),
      enableImageInClipboard: document.getElementById('enableImageInClipboard').checked,
      // 画像読み込み待機時間（秒）
      amazonLoadDelay: parseFloat(document.getElementById('amazonLoadDelay').value) || 0,
      ebayLoadDelay: parseFloat(document.getElementById('ebayLoadDelay').value) || 0,
      rakutenLoadDelay: parseFloat(document.getElementById('rakutenLoadDelay').value) || 0,
      mercariLoadDelay: parseFloat(document.getElementById('mercariLoadDelay').value) || 0,
      yahooLoadDelay: parseFloat(document.getElementById('yahooLoadDelay').value) || 0,
      frilLoadDelay: parseFloat(document.getElementById('frilLoadDelay').value) || 0,
      hardoffLoadDelay: parseFloat(document.getElementById('hardoffLoadDelay').value) || 0,
      // フリマサイトアラート設定
      alertBadRate: parseFloat(document.getElementById('alertBadRate').value) || 5,
      alertLowReviewCount: parseInt(document.getElementById('alertLowReviewCount').value) || 100,
      alertDaysFromListing: parseInt(document.getElementById('alertDaysFromListing').value) || 180,
      alertDaysFromUpdate: parseInt(document.getElementById('alertDaysFromUpdate').value) || 90,
      alertHandlingDays: document.getElementById('alertHandlingDays').checked
    };

    await chrome.storage.sync.set(settings);
    showMessage('設定を保存しました', 'success');

  } catch (error) {
    console.error('Error saving settings:', error);
    showMessage('設定の保存に失敗しました', 'error');
  }
}

// 設定をリセット
async function resetSettings() {
  if (!confirm('設定をデフォルトに戻しますか？\n（スプレッドシート登録は削除されません）')) return;

  try {
    // スプレッドシート設定は保持
    const syncSettings = await chrome.storage.sync.get(['spreadsheets']);

    // 同期設定をデフォルトに戻すが、スプレッドシートは保持
    await chrome.storage.sync.set({
      ...defaultSettings,
      spreadsheets: syncSettings.spreadsheets || []
    });

    // ローカル設定（最後に使ったシートID）は変更しない

    await loadSettings();
    showMessage('デフォルト設定に戻しました', 'success');

  } catch (error) {
    console.error('Error resetting settings:', error);
    showMessage('リセットに失敗しました', 'error');
  }
}

// メッセージを表示
function showMessage(message, type) {
  const statusMessage = document.getElementById('statusMessage');
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';

  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, 3000);
}

// Apps Scriptコードをコピー
function copyScript() {
  const script = `// Webhook受信用関数
function doPost(e) {
  try {
    // リクエストボディを解析
    const data = JSON.parse(e.postData.contents);
    const values = data.values;
    const sheetName = data.sheetName || 'インポート用'; // デフォルト

    // スプレッドシートを取得
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(sheetName);

    // シートが存在しない場合は作成
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    // データを追加
    const row = sheet.getLastRow() + 1;

    // valuesをそのまま1行として追加
    // values配列: [platform, url, price, name, description, seller, =IMAGE("url1"), =IMAGE("url2"), ...]
    if (values.length > 0) {
      sheet.getRange(row, 1, 1, values.length).setValues([values]);

      // 画像がある場合（7列目以降に=IMAGE()があれば）、行の高さを調整
      if (values.length > 6 && values[6] && values[6].toString().startsWith('=IMAGE(')) {
        sheet.setRowHeight(row, 150); // 150ピクセルの高さ
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: sheetName + 'に追加しました'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 【使い方】
// 既存のonOpen()関数に以下のコードを追加してください：
//
// ui.createMenu('🖼️ 商品データツール')
//   .addItem('📏 選択した行の高さを調整', 'adjustSelectedRowHeights')
//   .addToUi();
//
// 追加場所: } catch (e) { の直前（他のメニューの後）

// 選択した行の高さを調整
function adjustSelectedRowHeights() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const selection = sheet.getActiveRange();

  if (!selection) {
    SpreadsheetApp.getUi().alert('行を選択してください');
    return;
  }

  const startRow = selection.getRow();
  const numRows = selection.getNumRows();
  let adjustedCount = 0;

  for (let i = 0; i < numRows; i++) {
    const rowNum = startRow + i;

    // G列（7列目）に画像があるかチェック
    const cellG = sheet.getRange(rowNum, 7);
    const value = cellG.getValue();

    // 画像がある場合は行の高さを調整、ない場合も150pxに設定
    sheet.setRowHeight(rowNum, 150);
    adjustedCount++;
  }

  SpreadsheetApp.getUi().alert(
    '完了\\n\\n' + adjustedCount + '行の高さを150pxに調整しました。'
  );
}`;

  navigator.clipboard.writeText(script).then(() => {
    showMessage('✓ コードをクリップボードにコピーしました！', 'success');
  }).catch(err => {
    console.error('コピーエラー:', err);
    showMessage('コピーに失敗しました。手動でコピーしてください。', 'error');
  });
}
