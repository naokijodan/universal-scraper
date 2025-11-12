// Universal Product Scraper - Popup Script
// DOMが完全に読み込まれてから実行
document.addEventListener('DOMContentLoaded', function() {
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
