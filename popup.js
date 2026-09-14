// Universal Product Scraper - Popup Script
// DOMが完全に読み込まれてから実行
document.addEventListener('DOMContentLoaded', function() {
  // 直接送信（background-direct.js）の失敗・不明件数サマリを表示する。
  // バッジ（赤い数字）を見たユーザーが「送信履歴を開く」から options.html の
  // 直接送信パネルへすぐたどり着けるようにするための導線。
  const summaryEl = document.getElementById('direct-summary');
  const openHistoryBtn = document.getElementById('open-direct-history');

  if (summaryEl) {
    try {
      chrome.runtime.sendMessage({ action: 'directGetSummary' }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('❌ directGetSummary エラー:', chrome.runtime.lastError);
          summaryEl.textContent = '直接送信の状況を取得できませんでした';
          return;
        }
        if (!response || response.success === false) {
          summaryEl.textContent = '直接送信の状況を取得できませんでした';
          return;
        }
        const failed = Number(response.failed) || 0;
        const unknown = Number(response.unknown) || 0;
        if (failed === 0 && unknown === 0) {
          summaryEl.textContent = '直接送信の失敗はありません';
          summaryEl.classList.remove('has-issue');
        } else {
          summaryEl.textContent = '直接送信: 失敗 ' + failed + '件・不明 ' + unknown + '件';
          summaryEl.classList.add('has-issue');
        }
      });
    } catch (error) {
      console.error('❌ directGetSummary 例外発生:', error);
      summaryEl.textContent = '直接送信の状況を取得できませんでした';
    }
  }

  if (openHistoryBtn) {
    openHistoryBtn.addEventListener('click', function() {
      try {
        if (chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          chrome.tabs.create({ url: 'options.html' });
        }
      } catch (error) {
        console.error('❌ 送信履歴を開くボタンで例外発生:', error);
      }
    });
  }

  const openOptionsBtn = document.getElementById('openOptions');

  if (openOptionsBtn) {
    console.log('✅ 設定ボタンが見つかりました');

    openOptionsBtn.addEventListener('click', function() {
      console.log('🖱️ 設定ボタンがクリックされました');

      try {
        if (chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage(function() {
            if (chrome.runtime.lastError) {
              console.error('❌ エラー:', chrome.runtime.lastError);
              alert('設定ページを開けませんでした: ' + chrome.runtime.lastError.message);
            } else {
              console.log('✅ 設定ページを開きました');
            }
          });
        } else {
          console.error('❌ chrome.runtime.openOptionsPage が利用できません');
          // 代替手段：直接options.htmlを開く
          chrome.tabs.create({ url: 'options.html' });
        }
      } catch (error) {
        console.error('❌ 例外発生:', error);
        alert('エラーが発生しました: ' + error.message);
      }
    });
  } else {
    console.error('❌ 設定ボタンが見つかりません');
  }
});
