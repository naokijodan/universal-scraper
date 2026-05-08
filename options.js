// 設定ページのJavaScript - 複数スプレッドシート対応版

// AI 翻訳 対応プラットフォームの一元定義（Single Source of Truth）
// id: content.js の currentSite と一致させる必要がある
// default: 既存ユーザーの設定に当該キーが無い場合の初期値
const AI_PLATFORMS = [
  { id: 'mercari',       name: 'メルカリ',           default: true  },
  { id: 'mercari_shop',  name: 'メルカリショップ',   default: true  },
  { id: 'ebay',          name: 'eBay',               default: false },
  { id: 'rakuten',       name: '楽天市場',           default: true  },
  { id: 'amazon',        name: 'Amazon',             default: true  },
  { id: 'yahuoku',       name: 'ヤフオク',           default: true  },
  { id: 'paypayfurima',  name: 'PayPayフリマ',       default: true  },
  { id: 'yahooshopping', name: 'Yahoo!ショッピング', default: true  },
  { id: 'hardoff',       name: 'ハードオフ',         default: true  },
  { id: 'rakuma',        name: 'ラクマ',             default: true  }
];

// AI_PLATFORMS から { mercari: true, mercari_shop: true, ebay: false, ... } を生成
function buildDefaultAiPlatforms() {
  const out = {};
  for (const p of AI_PLATFORMS) out[p.id] = p.default;
  return out;
}

// #aiPlatformsContainer に AI_PLATFORMS のチェックボックス UI を動的に挿入
// data-platform 属性で id 文字列の不整合（snake_case ⇔ PascalCase）を回避
function renderAiPlatformsCheckboxes() {
  const container = document.getElementById('aiPlatformsContainer');
  if (!container) return;
  if (container.dataset.rendered === '1') return; // 二重描画防止
  const html = AI_PLATFORMS.map(p =>
    `<label style="display: flex; align-items: center; gap: 8px; padding: 6px 0;">` +
    `<input type="checkbox" data-platform="${p.id}">` +
    `<span>${p.name}</span></label>`
  ).join('');
  container.innerHTML = html;
  container.dataset.rendered = '1';
}

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
  // ハードオフ専用：県未選択時に price に加算する固定送料（円）
  hardoffShipping: 0,
  // フリマサイトアラート条件
  alertBadRate: 5,
  alertLowReviewCount: 100,
  alertDaysFromListing: 180,
  alertDaysFromUpdate: 90,
  alertHandlingDays: false,
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
  aiOperatorName: ''
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

    // ハードオフ送料設定（数値で設定値、未設定なら0）
    document.getElementById('hardoffShipping').value = Number.isFinite(syncSettings.hardoffShipping) ? syncSettings.hardoffShipping : 0;

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

    // プラットフォーム別 ON/OFF（AI_PLATFORMS をループで処理。
    // 新規追加サイト（既存ユーザーの保存値に当該キーが無い）は p.default を採用）
    renderAiPlatformsCheckboxes();
    const platforms = syncSettings.aiPlatforms || {};
    AI_PLATFORMS.forEach(p => {
      const el = document.querySelector(`#aiPlatformsContainer input[data-platform="${p.id}"]`);
      if (!el) return;
      const saved = platforms[p.id];
      el.checked = (typeof saved === 'boolean') ? saved : p.default;
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
      // ハードオフ送料（負値は 0 にクリップ）
      hardoffShipping: Math.max(0, parseInt(document.getElementById('hardoffShipping').value, 10) || 0),
      // フリマサイトアラート設定
      alertBadRate: parseFloat(document.getElementById('alertBadRate').value) || 5,
      alertLowReviewCount: parseInt(document.getElementById('alertLowReviewCount').value) || 100,
      alertDaysFromListing: parseInt(document.getElementById('alertDaysFromListing').value) || 180,
      alertDaysFromUpdate: parseInt(document.getElementById('alertDaysFromUpdate').value) || 90,
      alertHandlingDays: document.getElementById('alertHandlingDays').checked,
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
          const el = document.querySelector(`#aiPlatformsContainer input[data-platform="${p.id}"]`);
          out[p.id] = el ? el.checked : p.default;
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
