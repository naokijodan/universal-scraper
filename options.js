// 設定ページのJavaScript - 複数スプレッドシート対応版

// 対応プラットフォームの一元定義（Single Source of Truth）
// id        : content.js の currentSite と一致
// enableKey : サイト全体の有効化フラグ名（既存 enable* 設定キーに対応）
// enableDefault : サイト有効化のデフォルト値
// aiDefault : AI 翻訳のデフォルト値
const AI_PLATFORMS = [
  { id: 'mercari',       name: 'メルカリ',           enableKey: 'enableMercari',       enableDefault: true,  aiDefault: true  },
  { id: 'mercari_shop',  name: 'メルカリショップ',   enableKey: 'enableMercariShop',   enableDefault: true,  aiDefault: true  },
  { id: 'ebay',          name: 'eBay',               enableKey: 'enableEbay',          enableDefault: false, aiDefault: false },
  { id: 'rakuten',       name: '楽天市場',           enableKey: 'enableRakuten',       enableDefault: true,  aiDefault: true  },
  { id: 'amazon',        name: 'Amazon',             enableKey: 'enableAmazon',        enableDefault: true,  aiDefault: true  },
  { id: 'yahuoku',       name: 'ヤフオク',           enableKey: 'enableYahoo',         enableDefault: true,  aiDefault: true  },
  { id: 'paypayfurima',  name: 'PayPayフリマ',       enableKey: 'enablePaypay',        enableDefault: true,  aiDefault: true  },
  { id: 'yahooshopping', name: 'Yahoo!ショッピング', enableKey: 'enableYahooshopping', enableDefault: true,  aiDefault: true  },
  { id: 'hardoff',       name: 'ハードオフ',         enableKey: 'enableHardoff',       enableDefault: true,  aiDefault: true  },
  { id: 'rakuma',        name: 'ラクマ',             enableKey: 'enableFril',          enableDefault: true,  aiDefault: true  }
];

// みちゃった君: 直近に chrome.storage.sync へ保存された enableMichatta の値。
// トグルのチェック状態（未保存の可能性あり）と区別するために持つ（MED-1対応）。
let michattaSavedEnabled = false;

// AI_PLATFORMS から { mercari: true, mercari_shop: true, ebay: false, ... } を生成
function buildDefaultAiPlatforms() {
  const out = {};
  for (const p of AI_PLATFORMS) out[p.id] = p.aiDefault;
  return out;
}

// #aiPlatformsContainer に AI_PLATFORMS のマトリクス UI を動的に挿入
// 各サイト 1 行で「サイト有効」と「AI 翻訳」の 2 つのチェックを横並び表示
// data-platform / data-kind 属性で識別
function renderAiPlatformsCheckboxes() {
  const container = document.getElementById('aiPlatformsContainer');
  if (!container) return;
  if (container.dataset.rendered === '1') return;
  const header = `
    <div style="display: grid; grid-template-columns: 1fr 90px 90px; gap: 4px; padding: 4px 0; font-size: 12px; color: #666; border-bottom: 1px solid #ddd; margin-bottom: 4px;">
      <div></div>
      <div style="text-align: center;">サイト有効</div>
      <div style="text-align: center;">AI 翻訳</div>
    </div>`;
  const rows = AI_PLATFORMS.map(p => `
    <div style="display: grid; grid-template-columns: 1fr 90px 90px; gap: 4px; padding: 4px 0; align-items: center;">
      <div>${p.name}</div>
      <label style="display: flex; justify-content: center; cursor: pointer;">
        <input type="checkbox" data-platform="${p.id}" data-kind="enable">
      </label>
      <label style="display: flex; justify-content: center; cursor: pointer;">
        <input type="checkbox" data-platform="${p.id}" data-kind="ai">
      </label>
    </div>`).join('');
  container.innerHTML = header + rows;
  container.dataset.rendered = '1';
}

// デフォルト設定（default_setting_json.jsから関数を使用）
// 各サイトの enable* キーは AI_PLATFORMS の enableDefault で初期化される
// enableMercariShop / enableYahooshopping は defaults から除外:
//   旧 v1.3.x で enableMercari/enableYahoo を OFF にしていたユーザーの意思を
//   引き継ぐため、保存値が無ければ undefined のまま受け取って後段でマイグレーション
const defaultSettings = {
  enableEbay: false,
  enableRakuten: true,
  enableAmazon: true,
  enableMercari: true,
  enableYahoo: true,
  enablePaypay: true,
  enableFril: true,
  enableHardoff: true,
  alertKeywords: defaultAlertKeywords().join('\n'), // 除外キーワード（赤ハイライト）
  popupKeywords: defaultPopupKeywords().join('\n'), // 注目キーワード（黄色ハイライト）
  excludeSellerIds: [], // 除外セラー（出品者ID完全一致で警告）
  buttonPosition: 'top-right',
  spreadsheets: [], // 複数スプレッドシート対応
  lastUsedSheetId: null, // 最後に使ったシートID
  maxSheets: 10, // 最大登録数
  imageOutputCount: 999, // 出力する画像枚数（全ての画像、最大20枚）
  imageBase64Count: 1, // セル内画像にする枚数（メルカリ非経由）
  enableImageInClipboard: true, // クリップボードコピー時に画像URLを含める（デフォルト有効）
  // 画像読み込み待機時間（秒）
  amazonLoadDelay: 3,
  ebayLoadDelay: 3,
  rakutenLoadDelay: 3,
  mercariLoadDelay: 3,
  yahooLoadDelay: 3,
  frilLoadDelay: 3,
  hardoffLoadDelay: 3,
  // ハードオフ専用：県未選択時に price に加算する固定送料（円）
  hardoffShipping: 0,
  // フリマサイトアラート条件
  alertBadRate: 5,
  alertLowReviewCount: 100,
  alertDaysFromListing: 180,
  alertDaysFromUpdate: 90,
  alertHandlingDays: false,
  alertShipFromRemote: true,
  // AI 翻訳設定（chrome.storage.sync に保存）。API キーは別管理で chrome.storage.local
  aiTranslationEnabled: false,
  aiModel: 'gpt-5.4-mini',
  aiCustomModel: '',
  aiWebSearchEnabled: true,
  aiDailyLimit: 1000,
  aiImageCount: 1,
  // aiPlatforms のデフォルト値は AI_PLATFORMS 配列から派生（buildDefaultAiPlatforms()）
  // ebay 以外は default true（椛島さん指示 2026-05-08）
  aiPlatforms: { mercari: true, mercari_shop: true, ebay: false, rakuten: true, amazon: true, yahuoku: true, paypayfurima: true, yahooshopping: true, hardoff: true, rakuma: true },
  aiPromptOverride_common: '',
  aiPromptOverride_mercari: '',
  // マイタグ（タブ区切り形式の文字列で保存。各行: tagName\tkeyword1,keyword2,...）
  aiMyTags: '',
  // 担当者名（インポート用2 シートの B列に出力される。未入力なら B列は空白）
  aiOperatorName: '',
  // みちゃった君機能（閲覧履歴・既読マーク）の有効/無効。初期状態では無効
  enableMichatta: false
};

// 公式プロンプトをコード同梱ファイルから取得（共通 + 各プラットフォーム）
async function loadOfficialPrompt(key) {
  const fileName = key === 'common' ? 'system_common.txt' : `platform_${key}.txt`;
  try {
    const url = chrome.runtime.getURL(`prompts/${fileName}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error('公式プロンプト取得失敗:', key, e?.message);
    return '';
  }
}

// API キー表示用のマスキング
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  if (key.length < 12) return 'sk-***';
  return key.slice(0, 7) + '***' + key.slice(-4);
}

// マイタグ: テキスト ⇔ 配列 の変換
// テキスト形式: 各行 "タグ名\tkeyword1, keyword2, ..."（# で始まる行や空行は無視）
function parseMyTagsText(text) {
  if (!text) return [];
  const rows = String(text).split(/\r?\n/);
  const tags = [];
  for (const raw of rows) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tabIdx = line.indexOf('\t');
    let name, kwStr;
    if (tabIdx >= 0) {
      name = line.slice(0, tabIdx).trim();
      kwStr = line.slice(tabIdx + 1).trim();
    } else {
      name = line;
      kwStr = '';
    }
    if (!name) continue;
    const keywords = kwStr
      ? kwStr.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    tags.push({ name, keywords });
  }
  return tags;
}

// マイタグ: 配列 → テキスト
function stringifyMyTags(tagsArray) {
  if (!Array.isArray(tagsArray) || !tagsArray.length) return '';
  return tagsArray.map(t => {
    const name = String(t.name || '').trim();
    const kws = Array.isArray(t.keywords) ? t.keywords.join(', ') : '';
    return name + '\t' + kws;
  }).join('\n');
}

// マイタグカウンタの表示更新
function refreshMyTagsCounter() {
  const counter = document.getElementById('aiMyTagsCounter');
  if (!counter) return;
  const text = document.getElementById('aiMyTags')?.value || '';
  const tags = parseMyTagsText(text);
  counter.textContent = `登録タグ数: ${tags.length}`;
}

// 公式タグセット (default_tags.json) を取得してテキスト形式に変換
async function loadDefaultTagsAsText() {
  try {
    const url = chrome.runtime.getURL('prompts/default_tags.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return '';
    // group ごとに区切ってコメントを挿入
    let lastGroup = null;
    const lines = [];
    for (const t of data) {
      if (t.group && t.group !== lastGroup) {
        lines.push(`# 【${t.group}】`);
        lastGroup = t.group;
      }
      const name = String(t.name || '').trim();
      const kws = Array.isArray(t.keywords) ? t.keywords.join(', ') : '';
      lines.push(name + '\t' + kws);
    }
    return lines.join('\n');
  } catch (e) {
    console.error('default_tags.json 取得失敗:', e?.message);
    return '';
  }
}

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

    // 旧「対応サイトの設定」のトグル UI は廃止し、「対応プラットフォーム」セクションに統合
    // （enable* 値は renderAiPlatformsCheckboxes() 経由でマトリクス UI に反映する）

    // その他の設定値を設定
    document.getElementById('alertKeywords').value = syncSettings.alertKeywords;
    document.getElementById('popupKeywords').value = syncSettings.popupKeywords;
    document.getElementById('excludeSellerIds').value = Array.isArray(syncSettings.excludeSellerIds) ? syncSettings.excludeSellerIds.join('\n') : '';
    document.getElementById('buttonPosition').value = syncSettings.buttonPosition;

    // 画像出力設定を設定
    document.getElementById('imageOutputCount').value = syncSettings.imageOutputCount;
    document.getElementById('imageBase64Count').value = (syncSettings.imageBase64Count || 1);
    document.getElementById('enableImageInClipboard').checked = syncSettings.enableImageInClipboard;

    // 画像読み込み待機時間を設定
    document.getElementById('amazonLoadDelay').value = syncSettings.amazonLoadDelay;
    document.getElementById('ebayLoadDelay').value = syncSettings.ebayLoadDelay;
    document.getElementById('rakutenLoadDelay').value = syncSettings.rakutenLoadDelay;
    document.getElementById('mercariLoadDelay').value = syncSettings.mercariLoadDelay;
    document.getElementById('yahooLoadDelay').value = syncSettings.yahooLoadDelay;
    document.getElementById('frilLoadDelay').value = syncSettings.frilLoadDelay;
    document.getElementById('hardoffLoadDelay').value = syncSettings.hardoffLoadDelay;

    // ハードオフ送料設定（数値で設定値、未設定なら0）
    document.getElementById('hardoffShipping').value = Number.isFinite(syncSettings.hardoffShipping) ? syncSettings.hardoffShipping : 0;

    // フリマサイトアラート設定を設定
    document.getElementById('alertBadRate').value = syncSettings.alertBadRate || 5;
    document.getElementById('alertLowReviewCount').value = syncSettings.alertLowReviewCount || 100;
    document.getElementById('alertDaysFromListing').value = syncSettings.alertDaysFromListing || 180;
    document.getElementById('alertDaysFromUpdate').value = syncSettings.alertDaysFromUpdate || 90;
    document.getElementById('alertHandlingDays').checked = syncSettings.alertHandlingDays || false;
    document.getElementById('alertShipFromRemote').checked = syncSettings.alertShipFromRemote !== false;

    // スプレッドシート一覧を表示（同期設定から）
    renderSpreadsheetList(syncSettings.spreadsheets || []);

    // （旧トグルの updateToggleStatus 呼び出しは UI 廃止のため削除）
    updateToggleStatus('enableImageInClipboard', 'statusImageInClipboard');

    document.getElementById('enableMichatta').checked = !!syncSettings.enableMichatta;
    michattaSavedEnabled = !!syncSettings.enableMichatta;
    updateToggleStatus('enableMichatta', 'statusEnableMichatta');
    michattaUpdateSectionVisibility();
    michattaUpdateUnsavedNotice();
    if (syncSettings.enableMichatta) {
      michattaInitHistorySection();
    }

    // AI 翻訳設定を読み込み
    document.getElementById('aiTranslationEnabled').checked = !!syncSettings.aiTranslationEnabled;
    document.getElementById('aiWebSearchEnabled').checked = syncSettings.aiWebSearchEnabled !== false;

    const modelSel = document.getElementById('aiModel');
    const customInput = document.getElementById('aiCustomModel');
    const knownModels = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'custom'];
    if (knownModels.includes(syncSettings.aiModel)) {
      modelSel.value = syncSettings.aiModel;
    } else {
      // デフォルト一覧にないモデル名 → カスタム扱い
      modelSel.value = 'custom';
      customInput.value = syncSettings.aiModel || '';
    }
    if (modelSel.value === 'custom') {
      customInput.style.display = '';
      if (!customInput.value) customInput.value = syncSettings.aiCustomModel || '';
    } else {
      customInput.style.display = 'none';
    }
    document.getElementById('aiDailyLimit').value = Number.isFinite(syncSettings.aiDailyLimit) ? syncSettings.aiDailyLimit : 1000;

    // AI に渡す画像枚数
    const imgCountValue = String(Number.isFinite(syncSettings.aiImageCount) ? syncSettings.aiImageCount : 1);
    const imgCountSel = document.getElementById('aiImageCount');
    if ([...imgCountSel.options].some(o => o.value === imgCountValue)) {
      imgCountSel.value = imgCountValue;
    } else {
      imgCountSel.value = '1';
    }

    // プラットフォーム別 ON/OFF（AI_PLATFORMS のマトリクス UI: サイト有効 + AI 翻訳）
    // マイグレーション: 旧 v1.3.x で enableMercari / enableYahoo が共有キーだった
    // ため、新独立キー (enableMercariShop / enableYahooshopping) が undefined の
    // 場合は旧共有キーの値を引き継ぐ（ユーザーの「無効化の意思」を尊重）
    renderAiPlatformsCheckboxes();
    const platforms = syncSettings.aiPlatforms || {};
    AI_PLATFORMS.forEach(p => {
      const enableEl = document.querySelector(`#aiPlatformsContainer input[data-platform="${p.id}"][data-kind="enable"]`);
      if (enableEl) {
        let savedEnable = syncSettings[p.enableKey];
        if (typeof savedEnable !== 'boolean') {
          // 旧共有キーからのマイグレーション
          if (p.id === 'mercari_shop' && typeof syncSettings.enableMercari === 'boolean') {
            savedEnable = syncSettings.enableMercari;
          } else if (p.id === 'yahooshopping' && typeof syncSettings.enableYahoo === 'boolean') {
            savedEnable = syncSettings.enableYahoo;
          } else {
            savedEnable = p.enableDefault;
          }
        }
        enableEl.checked = savedEnable;
      }
      const aiEl = document.querySelector(`#aiPlatformsContainer input[data-platform="${p.id}"][data-kind="ai"]`);
      if (aiEl) {
        const savedAi = platforms[p.id];
        aiEl.checked = (typeof savedAi === 'boolean') ? savedAi : p.aiDefault;
      }
    });

    // ユーザーカスタムプロンプト
    document.getElementById('aiPromptOverrideCommon').value = syncSettings.aiPromptOverride_common || '';
    document.getElementById('aiPromptOverrideMercari').value = syncSettings.aiPromptOverride_mercari || '';

    // マイタグ
    const myTagsEl = document.getElementById('aiMyTags');
    myTagsEl.value = syncSettings.aiMyTags || '';
    refreshMyTagsCounter();

    // 担当者名（最上部の入力欄）
    const operatorEl = document.getElementById('aiOperatorName');
    if (operatorEl) operatorEl.value = syncSettings.aiOperatorName || '';

    updateToggleStatus('aiTranslationEnabled', 'statusAiTranslationEnabled');
    updateToggleStatus('aiWebSearchEnabled', 'statusAiWebSearchEnabled');

    // API キーは chrome.storage.local から（同期されない）
    const localKeys = await chrome.storage.local.get('aiApiKey');
    const aiApiKey = localKeys.aiApiKey || '';
    document.getElementById('aiApiKey').value = aiApiKey;
    document.getElementById('aiApiKey').type = 'password';
    document.getElementById('aiApiKeyToggleBtn').textContent = '表示';
    document.getElementById('aiApiKeyStatus').textContent = aiApiKey
      ? `保存済み: ${maskApiKey(aiApiKey)}`
      : '未設定';
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

  // （旧 enableEbay/Rakuten/Amazon/Hardoff のトグルイベントは UI 廃止のため削除。
  //   enable* 値は「対応プラットフォーム」マトリクス UI で扱う）

  // 画像出力設定のトグル
  document.getElementById('enableImageInClipboard').addEventListener('change', () => {
    updateToggleStatus('enableImageInClipboard', 'statusImageInClipboard');
  });

  // みちゃった君機能トグル
  document.getElementById('enableMichatta').addEventListener('change', (event) => {
    updateToggleStatus('enableMichatta', 'statusEnableMichatta');
    michattaUpdateSectionVisibility();
    michattaUpdateUnsavedNotice();
    if (event.target.checked) {
      // OFF→ON時、閲覧履歴セクションを表示だけは即座に行う。ただし、
      // enableMichattaのsync保存は「設定を保存」実行後（saveSettings内の
      // chrome.storage.sync.set）まで発生しないため、この時点ではまだ
      // background.js側は enableMichatta=false 判定のまま。そのため
      // ここで呼ぶ michattaInitHistorySection() は件数・アラート設定・
      // プレミアム状態がすべてフォールバック値（0件・デフォルト設定・
      // 未解除）のまま返ってくる（エラーにはならない）。正しい値は
      // 「設定を保存」後（saveSettings内で再度 michattaInitHistorySection()
      // を呼ぶ）に反映される。michattaUpdateUnsavedNotice() が保存前は
      // その旨をユーザーに案内する。
      michattaInitHistorySection();
    }
  });

  // みちゃった君: 閲覧履歴管理セクションのボタン（元 popup.js のイベント登録と同一）
  document.getElementById('michattaRegisterBtn').addEventListener('click', michattaRegisterItems);
  document.getElementById('michattaClearAllBtn').addEventListener('click', michattaClearAllItems);
  document.getElementById('michattaExportBtn').addEventListener('click', michattaExportItems);
  document.getElementById('michattaImportBtn').addEventListener('click', () => {
    document.getElementById('michattaImportFile').click();
  });
  document.getElementById('michattaImportFile').addEventListener('change', michattaImportHistoryCsv);
  document.getElementById('michattaSaveAlertBtn').addEventListener('click', michattaSaveAlertSettings);
  document.getElementById('michattaUnlockBtn').addEventListener('click', michattaUnlockPremium);
  document.getElementById('imageBase64Count').addEventListener('change', (event) => {
    const count = parseInt(event.target.value, 10);
    if (count >= 2) {
      alert('画像を増やすほど取り込みに時間がかかり、1日に処理できる件数が減ります（1枚あたり約1.4秒、Googleの実行枠は1アカウント1日90分）。通常は1枚で十分です。');
    }
  });

  // AI 翻訳トグル
  document.getElementById('aiTranslationEnabled').addEventListener('change', () => {
    updateToggleStatus('aiTranslationEnabled', 'statusAiTranslationEnabled');
  });
  document.getElementById('aiWebSearchEnabled').addEventListener('change', () => {
    updateToggleStatus('aiWebSearchEnabled', 'statusAiWebSearchEnabled');
  });

  // モデル選択：カスタム時のみ追加入力を表示
  const modelSel = document.getElementById('aiModel');
  const customInput = document.getElementById('aiCustomModel');
  modelSel.addEventListener('change', () => {
    customInput.style.display = (modelSel.value === 'custom') ? '' : 'none';
  });

  // API キー：表示/非表示トグル
  const apiInput = document.getElementById('aiApiKey');
  const apiToggle = document.getElementById('aiApiKeyToggleBtn');
  apiToggle.addEventListener('click', () => {
    if (apiInput.type === 'password') {
      apiInput.type = 'text';
      apiToggle.textContent = '隠す';
    } else {
      apiInput.type = 'password';
      apiToggle.textContent = '表示';
    }
  });

  // API キー：削除ボタン
  document.getElementById('aiApiKeyClearBtn').addEventListener('click', async () => {
    if (!confirm('保存済みの OpenAI API キーを削除します。よろしいですか？')) return;
    await chrome.storage.local.remove('aiApiKey');
    apiInput.value = '';
    document.getElementById('aiApiKeyStatus').textContent = '未設定（削除しました）';
    showMessage('API キーを削除しました', 'success');
  });

  // マイタグ: 公式タグセット読み込みボタン
  const myTagsEl = document.getElementById('aiMyTags');
  document.getElementById('aiMyTagsLoadDefault').addEventListener('click', async () => {
    if (myTagsEl.value && myTagsEl.value.trim()) {
      if (!confirm('既存のマイタグが上書きされます。よろしいですか？')) return;
    }
    const text = await loadDefaultTagsAsText();
    if (!text) {
      showMessage('公式タグセットの読み込みに失敗しました', 'error');
      return;
    }
    myTagsEl.value = text;
    refreshMyTagsCounter();
    showMessage('公式タグセットを読み込みました。「設定を保存」で適用されます。', 'success');
  });
  document.getElementById('aiMyTagsClear').addEventListener('click', () => {
    if (!myTagsEl.value || !confirm('マイタグをクリアします。よろしいですか？')) return;
    myTagsEl.value = '';
    refreshMyTagsCounter();
  });
  myTagsEl.addEventListener('input', refreshMyTagsCounter);

  // プロンプトリセット / クリア
  document.querySelectorAll('button[data-prompt-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.promptKey; // 'common' | 'mercari'
      const action = btn.dataset.action;  // 'reset' | 'clear'
      const ta = document.getElementById(key === 'common' ? 'aiPromptOverrideCommon' : 'aiPromptOverrideMercari');
      if (!ta) return;

      if (action === 'reset') {
        // 公式プロンプトを取得して textarea に流し込む（保存はユーザーが「設定を保存」で行う）
        const text = await loadOfficialPrompt(key);
        if (!text) {
          showMessage('公式プロンプトの取得に失敗しました', 'error');
          return;
        }
        ta.value = text;
        showMessage(`公式プロンプト（${key}）を読み込みました。「設定を保存」で適用されます。`, 'success');
      } else if (action === 'clear') {
        if (!confirm(`カスタムプロンプト（${key}）をクリアして公式版を使うようにします。よろしいですか？`)) return;
        ta.value = '';
        showMessage(`カスタムプロンプト（${key}）をクリアしました。「設定を保存」で適用されます。`, 'success');
      }
    });
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
      // enable* キーは「対応プラットフォーム」マトリクス UI から後方の spread で保存
      alertKeywords: document.getElementById('alertKeywords').value,
      popupKeywords: document.getElementById('popupKeywords').value,
      excludeSellerIds: document.getElementById('excludeSellerIds').value.split('\n').map(s => s.trim()).filter(s => s),
      buttonPosition: document.getElementById('buttonPosition').value,
      imageOutputCount: (() => { const v = parseInt(document.getElementById('imageOutputCount').value); return isNaN(v) ? 999 : v; })(),
      imageBase64Count: (() => { const v = parseInt(document.getElementById('imageBase64Count').value, 10); return isNaN(v) ? 1 : Math.min(Math.max(v, 1), 10); })(),
      enableImageInClipboard: document.getElementById('enableImageInClipboard').checked,
      enableMichatta: document.getElementById('enableMichatta').checked,
      // 画像読み込み待機時間（秒）
      amazonLoadDelay: parseFloat(document.getElementById('amazonLoadDelay').value) || 0,
      ebayLoadDelay: parseFloat(document.getElementById('ebayLoadDelay').value) || 0,
      rakutenLoadDelay: parseFloat(document.getElementById('rakutenLoadDelay').value) || 0,
      mercariLoadDelay: parseFloat(document.getElementById('mercariLoadDelay').value) || 0,
      yahooLoadDelay: parseFloat(document.getElementById('yahooLoadDelay').value) || 0,
      frilLoadDelay: parseFloat(document.getElementById('frilLoadDelay').value) || 0,
      hardoffLoadDelay: parseFloat(document.getElementById('hardoffLoadDelay').value) || 0,
      // ハードオフ送料（負値は 0 にクリップ）
      hardoffShipping: Math.max(0, parseInt(document.getElementById('hardoffShipping').value, 10) || 0),
      // フリマサイトアラート設定
      alertBadRate: parseFloat(document.getElementById('alertBadRate').value) || 5,
      alertLowReviewCount: parseInt(document.getElementById('alertLowReviewCount').value) || 100,
      alertDaysFromListing: parseInt(document.getElementById('alertDaysFromListing').value) || 180,
      alertDaysFromUpdate: parseInt(document.getElementById('alertDaysFromUpdate').value) || 90,
      alertHandlingDays: document.getElementById('alertHandlingDays').checked,
      alertShipFromRemote: document.getElementById('alertShipFromRemote').checked,
      // AI 翻訳設定（API キーは含めない、別ストレージ）
      aiTranslationEnabled: document.getElementById('aiTranslationEnabled').checked,
      aiWebSearchEnabled: document.getElementById('aiWebSearchEnabled').checked,
      aiModel: (() => {
        const sel = document.getElementById('aiModel').value;
        if (sel === 'custom') {
          return (document.getElementById('aiCustomModel').value || '').trim() || 'gpt-5.4-mini';
        }
        return sel;
      })(),
      aiCustomModel: (document.getElementById('aiCustomModel').value || '').trim(),
      aiDailyLimit: Math.max(1, parseInt(document.getElementById('aiDailyLimit').value, 10) || 1000),
      aiImageCount: Math.max(0, Math.min(10, parseInt(document.getElementById('aiImageCount').value, 10) || 1)),
      aiPlatforms: (() => {
        const out = {};
        AI_PLATFORMS.forEach(p => {
          const aiEl = document.querySelector(`#aiPlatformsContainer input[data-platform="${p.id}"][data-kind="ai"]`);
          out[p.id] = aiEl ? aiEl.checked : p.aiDefault;
        });
        return out;
      })(),
      // サイト有効化フラグ（AI_PLATFORMS の enableKey で個別保存）
      ...(() => {
        const out = {};
        AI_PLATFORMS.forEach(p => {
          const el = document.querySelector(`#aiPlatformsContainer input[data-platform="${p.id}"][data-kind="enable"]`);
          out[p.enableKey] = el ? el.checked : p.enableDefault;
        });
        return out;
      })(),
      aiPromptOverride_common: (document.getElementById('aiPromptOverrideCommon').value || '').trim(),
      aiPromptOverride_mercari: (document.getElementById('aiPromptOverrideMercari').value || '').trim(),
      aiMyTags: (document.getElementById('aiMyTags').value || ''),
      aiOperatorName: (document.getElementById('aiOperatorName')?.value || '').trim()
    };

    await chrome.storage.sync.set(settings);

    // API キーは chrome.storage.local（同期されない）
    const apiKey = (document.getElementById('aiApiKey').value || '').trim();
    if (apiKey) {
      await chrome.storage.local.set({ aiApiKey: apiKey });
      document.getElementById('aiApiKeyStatus').textContent = `保存済み: ${maskApiKey(apiKey)}`;
    } else {
      // 空なら削除（未設定状態）
      await chrome.storage.local.remove('aiApiKey');
      document.getElementById('aiApiKeyStatus').textContent = '未設定';
    }

    showMessage('設定を保存しました', 'success');

    // みちゃった君: 保存が成功した時点で background.js 側も enableMichatta の
    // 最新値を参照できるようになる（MED-1対応）。ON保存なら、フォールバック値
    // ではない正しい件数・アラート設定・プレミアム状態を取得し直す。
    michattaSavedEnabled = settings.enableMichatta;
    if (settings.enableMichatta) {
      michattaInitHistorySection();
    }
    michattaUpdateUnsavedNotice();

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

// ==============================================================
// みちゃった君: 閲覧履歴管理（フェーズ2 移植, 2026-07-18）
// 元: /Users/naokijodan/Desktop/みちゃった君/popup.js を忠実移植（読み取り専用参照。
// ロジックは変更しない）。DOM id は options.html 既存の alertBadRate 等と衝突しない
// よう michatta* プレフィックスを付与しただけで、判定ロジック・保存キー名は元のまま。
// データアクセスは window.MichattaStorage（michatta/storage.js）経由で
// chrome.runtime.sendMessage({action:'storage', ...}) → michatta/background.js。
// enableMichatta=OFF のときはこのセクション自体が非表示（display:none）になり、
// かつ background.js 側も無効応答を返すため二重に安全。
// ==============================================================

// 商品IDをURLまたはIDから抽出（元 popup.js:17-101 と同一ロジック）
function michattaExtractItemId(input) {
  input = input.trim();

  // PayPayフリマ: paypayfleamarket.yahoo.co.jp/item/z491889774
  // ※メルカリより先に判定
  const paypayMatch = input.match(/paypayfleamarket\.yahoo\.co\.jp\/item\/([a-zA-Z0-9]+)/);
  if (paypayMatch) return 'paypay_' + paypayMatch[1];

  // メルカリ通常: /item/m12345678901（IDのみ）
  const mercariMatch = input.match(/jp\.mercari\.com\/item\/([a-zA-Z0-9]+)/);
  if (mercariMatch) return mercariMatch[1];

  // メルカリショップ: /shops/product/xxxxx（shop_プレフィックス）
  const mercariShopMatch = input.match(/jp\.mercari\.com\/shops\/product\/([a-zA-Z0-9]+)/);
  if (mercariShopMatch) return 'shop_' + mercariShopMatch[1];

  // ラクマ: item.fril.jp/xxxxx（IDのみ）
  const rakumaMatch = input.match(/item\.fril\.jp\/([a-zA-Z0-9]+)/);
  if (rakumaMatch) return rakumaMatch[1];

  // 楽天市場: item.rakuten.co.jp/shop/product/（URLパス全体）
  const rakutenMatch = input.match(/item\.rakuten\.co\.jp\/([^?#]+)/);
  if (rakutenMatch) return 'rakuten_' + rakutenMatch[1].replace(/\/$/, '');

  // ヤフオク: page.auctions.yahoo.co.jp/jp/auction/xxxxx
  // ※IDがzで始まる場合はPayPayフリマの商品
  const yahooAuctionMatch = input.match(/page\.auctions\.yahoo\.co\.jp\/jp\/auction\/([a-zA-Z0-9]+)/);
  if (yahooAuctionMatch) {
    const id = yahooAuctionMatch[1];
    return id.startsWith('z') ? 'paypay_' + id : 'yahoo_' + id;
  }

  // ヤフオク: auctions.yahoo.co.jp系
  const yahooSearchMatch = input.match(/auctions\.yahoo\.co\.jp.*\/([a-zA-Z0-9]{10,})/);
  if (yahooSearchMatch) {
    const id = yahooSearchMatch[1];
    return id.startsWith('z') ? 'paypay_' + id : 'yahoo_' + id;
  }

  // オフモール（ハードオフ）: netmall.hardoff.co.jp/product/[数字]/
  const hardoffMatch = input.match(/netmall\.hardoff\.co\.jp\/product\/([0-9]+)/);
  if (hardoffMatch) return 'hardoff_' + hardoffMatch[1];

  // ヤフショ: store.shopping.yahoo.co.jp/{store_id}/{product_id}.html
  const yshoppingMatch = input.match(/store\.shopping\.yahoo\.co\.jp\/([^/]+)\/([^/?#]+)\.html(?:[?#]|$)/);
  if (yshoppingMatch) return 'yshopping_' + yshoppingMatch[1] + '_' + yshoppingMatch[2];

  // Amazon: /dp/[ASIN] または /gp/product/[ASIN]
  const amazonMatch = input.match(/amazon\.co\.jp\/(?:.*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  if (amazonMatch) return 'amazon_' + amazonMatch[1].toUpperCase();

  // === ID 単体入力の判定（URL 抽出に失敗した場合のフォールバック）===
  if (/^m[0-9]{11}$/.test(input)) return input;
  if (/^[a-zA-Z0-9]{22}$/.test(input) && /[A-Z]/.test(input)) return 'shop_' + input;
  if (/^[a-f0-9]{32}$/.test(input)) return input;
  if (/^B0[A-Z0-9]{8}$/i.test(input)) return 'amazon_' + input.toUpperCase();
  if (/^z[0-9]{9}$/.test(input)) return 'paypay_' + input;
  if (/^[a-y][0-9]{10}$/.test(input)) return 'yahoo_' + input;
  if (/^[0-9]{6,10}$/.test(input)) return 'hardoff_' + input;

  return null;
}

// ステータス表示（元 popup.js:110-118 相当。options.html 既存の status-message パターンに合わせる）
function michattaShowMessage(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = 'status-message ' + (isError ? 'error' : 'success');
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

// 件数を更新（元 popup.js:104-108）
async function michattaUpdateCount() {
  const countEl = document.getElementById('michattaCount');
  if (!countEl || !window.MichattaStorage) return;
  const count = await window.MichattaStorage.getViewedItemsCount();
  countEl.textContent = count;
}

// 登録処理（元 popup.js:121-160）
async function michattaRegisterItems() {
  if (!window.MichattaStorage) return;
  const textarea = document.getElementById('michattaItemIds');
  const input = textarea.value;
  const lines = input.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    michattaShowMessage('michattaRegisterStatus', 'IDまたはURLを入力してください', true);
    return;
  }

  const viewedItems = await window.MichattaStorage.getViewedItems();
  let addedCount = 0;
  let skippedCount = 0;
  let invalidCount = 0;

  for (const line of lines) {
    const itemId = michattaExtractItemId(line);
    if (itemId) {
      if (!viewedItems[itemId]) {
        viewedItems[itemId] = Date.now();
        addedCount++;
      } else {
        skippedCount++;
      }
    } else {
      invalidCount++;
    }
  }

  // 一括保存（上限なし）
  await window.MichattaStorage.saveViewedItemsBulk(viewedItems);

  // 結果表示
  let message = `${addedCount}件を登録しました`;
  if (skippedCount > 0) message += `（${skippedCount}件は登録済み）`;
  if (invalidCount > 0) message += `（${invalidCount}件は無効なID）`;

  michattaShowMessage('michattaRegisterStatus', message, invalidCount > 0 && addedCount === 0);
  textarea.value = '';
  michattaUpdateCount();
}

// 全削除処理（元 popup.js:163-188。破壊的操作のため confirm() で確認。
// options.js は既存の他の破壊的操作（スプレッドシート削除・APIキー削除・設定リセット等）
// でも同じサイドパネル上で標準の confirm() を使用しており、動作実績がある＝忠実移植）
async function michattaClearAllItems() {
  if (!window.MichattaStorage) return;
  const count = await window.MichattaStorage.getViewedItemsCount();

  if (count === 0) {
    michattaShowMessage('michattaRegisterStatus', '削除する履歴がありません', true);
    return;
  }

  const confirmed = confirm(`本当に全ての閲覧履歴（${count}件）を削除しますか？\n\nこの操作は取り消せません。`);

  if (!confirmed) {
    michattaShowMessage('michattaRegisterStatus', '削除をキャンセルしました');
    return;
  }

  const success = await window.MichattaStorage.clearAllViewedItems();

  if (success) {
    michattaShowMessage('michattaRegisterStatus', `${count}件の履歴を削除しました`);
    michattaUpdateCount();
  } else {
    michattaShowMessage('michattaRegisterStatus', '削除に失敗しました', true);
  }
}

// IDのプレフィックスからサイト名を判定（元 popup.js:191-201）
function michattaDetectSite(itemId) {
  if (itemId.startsWith('paypay_')) return 'paypay';
  if (itemId.startsWith('shop_')) return 'mercari_shop';
  if (itemId.startsWith('rakuten_')) return 'rakuten';
  if (itemId.startsWith('yahoo_')) return 'yahoo_auction';
  if (itemId.startsWith('hardoff_')) return 'hardoff';
  if (itemId.startsWith('yshopping_')) return 'yahoo_shopping';
  if (itemId.startsWith('amazon_')) return 'amazon';
  if (/^m[a-zA-Z0-9]+$/.test(itemId)) return 'mercari';
  return 'rakuma';
}

// CSV用にフィールドをエスケープ（全フィールドをクォートで囲む。元 popup.js:204-207）
function michattaCsvEscape(value) {
  const str = String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

// 2桁ゼロ埋め（元 popup.js:210-212）
function michattaPad2(n) {
  return String(n).padStart(2, '0');
}

// ファイル名用のタイムスタンプ YYYYMMDD_HHMMSS（元 popup.js:215-225）
function michattaFormatFilenameTimestamp(date) {
  return (
    date.getFullYear() +
    michattaPad2(date.getMonth() + 1) +
    michattaPad2(date.getDate()) +
    '_' +
    michattaPad2(date.getHours()) +
    michattaPad2(date.getMinutes()) +
    michattaPad2(date.getSeconds())
  );
}

// 人間可読なローカル日時 YYYY-MM-DD HH:MM:SS（元 popup.js:228-238）
function michattaFormatViewedAt(timestampMs) {
  const d = new Date(timestampMs);
  return (
    d.getFullYear() + '-' +
    michattaPad2(d.getMonth() + 1) + '-' +
    michattaPad2(d.getDate()) + ' ' +
    michattaPad2(d.getHours()) + ':' +
    michattaPad2(d.getMinutes()) + ':' +
    michattaPad2(d.getSeconds())
  );
}

// 閲覧履歴をCSVでエクスポート（元 popup.js:241-273 と完全同一形式:
// ヘッダー "id","site","timestamp_ms","viewed_at" / 全フィールドクォート /
// 改行CRLF / UTF-8 BOM付き / ファイル名 michatta_backup_YYYYMMDD_HHMMSS.csv）
async function michattaExportItems() {
  if (!window.MichattaStorage) return;
  const items = await window.MichattaStorage.getViewedItems();
  const ids = Object.keys(items);

  if (ids.length === 0) {
    michattaShowMessage('michattaRegisterStatus', 'エクスポートする履歴がありません', true);
    return;
  }

  // 新しい順に並べる
  ids.sort((a, b) => items[b] - items[a]);

  const header = ['id', 'site', 'timestamp_ms', 'viewed_at'].map(michattaCsvEscape).join(',');
  const rows = ids.map((id) => {
    const ts = items[id];
    return [id, michattaDetectSite(id), ts, michattaFormatViewedAt(ts)].map(michattaCsvEscape).join(',');
  });

  // Excel互換のためUTF-8 BOMを付与、改行はCRLF（元 popup.js:260 の '﻿' リテラルと同一コードポイント U+FEFF）
  const csv = '﻿' + header + '\r\n' + rows.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'michatta_backup_' + michattaFormatFilenameTimestamp(new Date()) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  michattaShowMessage('michattaRegisterStatus', `${ids.length}件をエクスポートしました`);
}

// ============================================================
// みちゃった君: 履歴CSVインポート機能（フェーズ3, 設計書§8-2）
// パース系・マージ計算系（michattaParseCsvLine / michattaParseHistoryCsv /
// michattaComputeMergedBulk）は純粋関数として実装する（DOM/chrome APIに依存しない。
// Node.js から直接テストするため）。
// ============================================================

// CSVの1行をダブルクォート対応でパースし、フィールド配列を返す汎用ヘルパー。
// クォートで囲まれたフィールド内の `,` や、エスケープされた `""` に対応する。
function michattaParseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++; // エスケープされた "" は 1 個の " として扱い、2文字分読み進める
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

// みちゃった君の履歴CSV文字列（popup.js:241-273 形式）をパースする。
// 戻り値: { rows: [{id, timestamp}, ...], skipped: number }
function michattaParseHistoryCsv(csvText) {
  const rows = [];
  let skipped = 0;

  // 先頭のUTF-8 BOM（U+FEFF）を除去する（無くても正常動作する）
  let text = csvText;
  if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // 改行は CRLF / LF / CR いずれにも対応する
  const lines = text.split(/\r\n|\n|\r/);

  // 1行目がヘッダー行（1列目が大小問わず "id"）であれば読み飛ばす
  let startIndex = 0;
  if (lines.length > 0) {
    const firstFields = michattaParseCsvLine(lines[0]);
    if (firstFields.length > 0 && String(firstFields[0]).trim().toLowerCase() === 'id') {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // 空行はスキップ（skippedにカウントしない）

    const fields = michattaParseCsvLine(line);
    const id = (fields[0] || '').trim();
    const timestampRaw = fields[2] !== undefined ? fields[2].trim() : '';
    const timestamp = Number(timestampRaw);

    // 不正行（idが空、またはtimestamp_msが正の整数として解釈できない）はrowsに含めない
    if (!id || !Number.isInteger(timestamp) || timestamp <= 0) {
      skipped++;
      continue;
    }

    rows.push({ id, timestamp });
  }

  return { rows, skipped };
}

// 既存の {id: timestamp} マップとパース済み行配列から、保存すべき {id: timestamp} を計算する。
// 同一idについて既存値・CSV値・CSV内の重複行同士を比較し、常に一番大きい（新しい）
// timestampを採用する（既存の方が新しければCSV側の古い値で上書きしない。§10決定済み事項）。
function michattaComputeMergedBulk(existingMap, rows) {
  const merged = {};
  Object.keys(existingMap || {}).forEach((id) => {
    merged[id] = existingMap[id];
  });

  (rows || []).forEach(({ id, timestamp }) => {
    merged[id] = (merged[id] === undefined) ? timestamp : Math.max(merged[id], timestamp);
  });

  return merged;
}

// ここから下はDOM/chrome APIを使うオーケストレーション関数（純粋関数ではない）

// FileReaderを使い、選択されたファイルの内容をテキストとしてPromiseで読み込む
function michattaReadFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file);
  });
}

// idsを500件ずつのチャンクに分割し、getViewedItemsBatchで既存の記録を取得して1つにまとめる
async function michattaFetchExistingBatch(ids) {
  const CHUNK_SIZE = 500;
  const merged = {};
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const result = await window.MichattaStorage.getViewedItemsBatch(chunk);
    Object.assign(merged, result || {});
  }
  return merged;
}

// bulkObjのエントリを500件ずつのチャンクに分割し、saveViewedItemsBulkでバッチ保存する。
// 戻り値: 保存に失敗したチャンクがあれば true を含む { hadFailure: boolean }
// （saveViewedItemsBulkはIndexedDB書き込み失敗時にfalseを返す実装のため、
// 呼び出し側で戻り値を確認しないと「取込N件」の表示が実態と食い違う恐れがある）
async function michattaSaveBulkChunked(bulkObj) {
  const CHUNK_SIZE = 500;
  const entries = Object.entries(bulkObj);
  let hadFailure = false;
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunkEntries = entries.slice(i, i + CHUNK_SIZE);
    const chunkObj = {};
    chunkEntries.forEach(([id, ts]) => { chunkObj[id] = ts; });
    const success = await window.MichattaStorage.saveViewedItemsBulk(chunkObj);
    if (!success) hadFailure = true;
  }
  return { hadFailure };
}

// 履歴CSVインポートのfile input changeイベントハンドラ
async function michattaImportHistoryCsv(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    if (!window.MichattaStorage) return;

    const text = await michattaReadFileAsText(file);
    const { rows, skipped } = michattaParseHistoryCsv(text);

    if (rows.length === 0) {
      michattaShowMessage('michattaImportStatus', `取込0件・スキップ${skipped}件`, true);
      return;
    }

    const ids = rows.map((r) => r.id);
    const existingMap = await michattaFetchExistingBatch(ids);
    const mergedBulk = michattaComputeMergedBulk(existingMap, rows);
    const { hadFailure } = await michattaSaveBulkChunked(mergedBulk);

    if (hadFailure) {
      michattaShowMessage('michattaImportStatus', `取込${rows.length}件・スキップ${skipped}件（一部の保存に失敗しました。もう一度お試しください）`, true);
    } else {
      michattaShowMessage('michattaImportStatus', `取込${rows.length}件・スキップ${skipped}件`);
    }
    await michattaUpdateCount();
  } catch (error) {
    console.error('[みちゃった君] 履歴CSVインポートエラー:', error);
    michattaShowMessage('michattaImportStatus', '読み込みに失敗しました', true);
  } finally {
    // 同じファイルを連続選択できるよう、処理後は必ずvalueをクリアする
    input.value = '';
  }
}

// アラート設定を保存（元 popup.js:276-294。保存キー名(ratings/badRate/listedDays/
// updatedDays/shipping47/shipping8)は元のまま。DOM idのみ michattaAlert* に変更）
async function michattaSaveAlertSettings() {
  if (!window.MichattaStorage) return;
  const settings = {
    ratings: parseInt(document.getElementById('michattaAlertRatings').value) || 0,
    badRate: parseInt(document.getElementById('michattaAlertBadRate').value) || 0,
    listedDays: parseInt(document.getElementById('michattaAlertListedDays').value) || 0,
    updatedDays: parseInt(document.getElementById('michattaAlertUpdatedDays').value) || 0,
    shipping47: document.getElementById('michattaAlertShipping47').checked,
    shipping8: document.getElementById('michattaAlertShipping8').checked
  };

  await window.MichattaStorage.saveAlertSettings(settings);
  michattaShowMessage('michattaAlertStatus', '設定を保存しました');
}

// アラート設定をUIに反映（元 popup.js:297-305）
async function michattaLoadAlertSettings() {
  if (!window.MichattaStorage) return;
  const settings = await window.MichattaStorage.getAlertSettings();
  document.getElementById('michattaAlertRatings').value = settings.ratings;
  document.getElementById('michattaAlertBadRate').value = settings.badRate;
  document.getElementById('michattaAlertListedDays').value = settings.listedDays;
  document.getElementById('michattaAlertUpdatedDays').value = settings.updatedDays;
  document.getElementById('michattaAlertShipping47').checked = settings.shipping47;
  document.getElementById('michattaAlertShipping8').checked = settings.shipping8;
}

// 会員パスで解除（元 popup.js:1, 308-317。パスワードは忠実移植のためハードコード値のまま
// 変更しない。プレミアム解除機能の扱いは設計書§10未決事項だが、今回の指示は「単体版と
// 同じ仕組みをそのまま移植」のため現状維持で実装する）
const MICHATTA_PREMIUM_PASS = 'MGOOSE2025';

async function michattaUnlockPremium() {
  if (!window.MichattaStorage) return;
  const pass = document.getElementById('michattaPremiumPass').value.trim();
  if (pass === MICHATTA_PREMIUM_PASS) {
    await window.MichattaStorage.unlockPremium();
    michattaShowMessage('michattaRegisterStatus', '会員機能を解除しました！');
    michattaUpdatePremiumUI(true);
  } else {
    michattaShowMessage('michattaRegisterStatus', 'パスワードが違います', true);
  }
}

// 会員機能のUI更新（元 popup.js:320-334。#alertSettings.locked → .michatta-locked クラスに対応）
function michattaUpdatePremiumUI(isUnlocked) {
  const lockedEl = document.getElementById('michattaPremiumLocked');
  const unlockedEl = document.getElementById('michattaPremiumUnlocked');
  const alertSettings = document.getElementById('michattaAlertSettingsBlock');

  if (isUnlocked) {
    lockedEl.style.display = 'none';
    unlockedEl.style.display = 'block';
    if (alertSettings) alertSettings.classList.remove('michatta-locked');
  } else {
    lockedEl.style.display = 'block';
    unlockedEl.style.display = 'none';
    if (alertSettings) alertSettings.classList.add('michatta-locked');
  }
}

// 表示ゲート: enableMichatta が ON のときだけ「閲覧履歴（みちゃった君）」セクションを表示
function michattaUpdateSectionVisibility() {
  const toggle = document.getElementById('enableMichatta');
  const section = document.getElementById('michattaHistorySection');
  if (!toggle || !section) return;
  section.style.display = toggle.checked ? '' : 'none';
}

// 未保存警告の表示切替（MED-1対応）。
// 「トグルがONだが、まだ保存されていない（michattaSavedEnabledがfalse）」場合にのみ表示する。
// トグルOFF、またはトグルONかつ既に保存済み（michattaSavedEnabled === true）の場合は非表示。
function michattaUpdateUnsavedNotice() {
  const toggle = document.getElementById('enableMichatta');
  const notice = document.getElementById('michattaUnsavedNotice');
  if (!toggle || !notice) return;
  const shouldShow = toggle.checked && !michattaSavedEnabled;
  // 注: #michattaUnsavedNotice は class="status-message" を持ち、CSS側で
  // .status-message { display: none; } が定義されているため、空文字('')に
  // すると inline style が外れてCSSのdisplay:noneにフォールバックし、
  // 表示されない不具合があった。michattaShowMessage()と同じく 'block' を
  // 明示する（独立レビュー指摘、jsdomでのCSSカスケード実測により発覚）。
  notice.style.display = shouldShow ? 'block' : 'none';
}

// 閲覧履歴セクションの初期化（件数・アラート設定・会員状態の読み込み。元 popup.js の init() 相当）
async function michattaInitHistorySection() {
  if (!window.MichattaStorage) return;
  try {
    await michattaUpdateCount();
    await michattaLoadAlertSettings();
    const isUnlocked = await window.MichattaStorage.isPremiumUnlocked();
    michattaUpdatePremiumUI(isUnlocked);
  } catch (error) {
    console.error('[みちゃった君] options.html 閲覧履歴セクション初期化エラー:', error);
  }
}
