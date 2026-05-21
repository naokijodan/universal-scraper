// Universal Product Scraper (AI 版) - Background Script (Service Worker)
// Webhook 送信、AI 翻訳呼び出し、API キー保護を担当
//
// 送信キュー実装（enqueueExport / processQueue / acquireLock 等）は
// background-queue.js に分離して importScripts で読み込む。
// MV3 service worker は classic スクリプトなので importScripts() が使える（Fact: MDN）。
try {
  importScripts('background-queue.js');
} catch (e) {
  console.error('[boot] failed to load background-queue.js:', e?.message || e);
}

// サイドパネル: アクションアイコンクリックで開く
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('sidePanel.setPanelBehavior failed:', err));
}

console.log('Background script loaded (とりこみ君AI)');

async function fetchImageAsBase64(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const chunkSize = 32 * 1024;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }

    const base64 = btoa(binary);
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return 'data:' + mime + ';base64,' + base64;
  } catch (e) {
    console.error('[image-base64] failed:', e?.message || e);
    return null;
  }
}

// 起動時にアクセスレベルを明示的にデフォルトに戻す。
// 過去のバージョンで chrome.storage.local.setAccessLevel({TRUSTED_CONTEXTS}) を
// 呼んでおり、これは Chrome 内部に永続化されるため、コードから呼び出しを
// 削除しただけでは制限が解除されない（content.js からのアクセス拒否が継続する）。
// 既に拡張がインストールされたユーザーの環境を救済するため、
// TRUSTED_AND_UNTRUSTED_CONTEXTS に戻す処理を毎起動時に実行する。
// （API キーは元々 content.js では参照されていないので保護に影響はない）
(async () => {
  try {
    if (chrome.storage?.local?.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    }
    if (chrome.storage?.sync?.setAccessLevel) {
      await chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    }
    console.log('🔓 chrome.storage アクセスレベルをデフォルトに戻しました');
  } catch (e) {
    console.error('storage アクセスレベル復元に失敗:', e?.message || e);
  }
})();

// ==========================================
// メッセージリスナー（sender 検証付き）
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // sender 検証：自拡張機能内からのメッセージのみ受け付ける
  if (!sender || sender.id !== chrome.runtime.id) {
    console.warn('⚠️ 不正な sender からのメッセージを拒否:', sender?.id);
    sendResponse({ success: false, error: '不正な送信元です' });
    return false;
  }

  if (request.action === 'exportToSheet') {
    handleExportToSheet(request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'exportBoth') {
    // 旧 API（直接バルク送信）— Phase 1 ではキュー方式へ転送するブリッジ。
    // 互換性のため残しているが、新しい呼び出しは enqueueExport を使うこと。
    handleExportBothBridgeToQueue(request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'enqueueExport') {
    // 新 API: キューに積むだけ。実際の送信は processQueue が alarms で実行する。
    handleEnqueueExport(request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'kickQueue') {
    // 設定画面の「今すぐ送信」から呼ばれる。
    // processQueue は background-queue.js の global function。
    // withStorageLock で直列化されているので、並行発火でも安全。
    Promise.resolve()
      .then(() => (typeof processQueue === 'function' ? processQueue() : Promise.reject(new Error('processQueue 未定義'))))
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'キュー処理に失敗しました' }));
    return true;
  }

  // Phase 3 修正（指摘 8 対応）: options 画面からの書き込みは
  // background 側で withStorageLock を通して安全に処理する。
  if (request.action === 'queueRetryFailed') {
    Promise.resolve()
      .then(() => (typeof queueRetryFailed === 'function' ? queueRetryFailed() : Promise.reject(new Error('queueRetryFailed 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueRetryFailed 失敗' }));
    return true;
  }

  if (request.action === 'queueClearFailed') {
    Promise.resolve()
      .then(() => (typeof queueClearFailed === 'function' ? queueClearFailed() : Promise.reject(new Error('queueClearFailed 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueClearFailed 失敗' }));
    return true;
  }

  if (request.action === 'queueClearSent') {
    Promise.resolve()
      .then(() => (typeof queueClearSent === 'function' ? queueClearSent() : Promise.reject(new Error('queueClearSent 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueClearSent 失敗' }));
    return true;
  }

  if (request.action === 'queueClearWaiting') {
    Promise.resolve()
      .then(() => (typeof queueClearWaiting === 'function' ? queueClearWaiting() : Promise.reject(new Error('queueClearWaiting 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueClearWaiting 失敗' }));
    return true;
  }

  if (request.action === 'queueRequeueOne') {
    Promise.resolve()
      .then(() => (typeof queueRequeueOne === 'function' ? queueRequeueOne(request.itemId) : Promise.reject(new Error('queueRequeueOne 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueRequeueOne 失敗' }));
    return true;
  }

  if (request.action === 'queueDeleteOne') {
    Promise.resolve()
      .then(() => (typeof queueDeleteOne === 'function' ? queueDeleteOne(request.itemId) : Promise.reject(new Error('queueDeleteOne 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueDeleteOne 失敗' }));
    return true;
  }

  if (request.action === 'queueTogglePause') {
    Promise.resolve()
      .then(() => (typeof queueTogglePause === 'function' ? queueTogglePause() : Promise.reject(new Error('queueTogglePause 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueTogglePause 失敗' }));
    return true;
  }

  if (request.action === 'queueSaveConfig') {
    Promise.resolve()
      .then(() => (typeof queueSaveConfig === 'function' ? queueSaveConfig(request.updates) : Promise.reject(new Error('queueSaveConfig 未定義'))))
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e?.message || 'queueSaveConfig 失敗' }));
    return true;
  }

  if (request.action === 'verifyWebhook') {
    verifyWebhookUrl(request.webhookUrl, request.sheetName)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'aiTranslate') {
    handleAiTranslate(request.payload)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error?.message || 'AI 翻訳に失敗しました' }));
    return true;
  }

  if (request.action === 'aiRefine') {
    handleAiRefine(request.payload)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error?.message || 'AI 修正に失敗しました' }));
    return true;
  }

  return false;
});

// ==========================================
// Google Apps Script Webhook 送信（既存）
// ==========================================
async function handleExportToSheet(request) {
  try {
    const { webhookUrl, sheetName, values } = request;
    if (!webhookUrl) throw new Error('Webhook URLが設定されていません');

    console.log('📤 データ送信開始: sheet=', sheetName, 'values.len=', values?.length);

    const body = { values, sheetName: sheetName || 'インポート用' };
    const topImageUrls = Array.isArray(request.topImageUrls)
      ? request.topImageUrls
      : (typeof request.topImageUrl === 'string' && request.topImageUrl ? [request.topImageUrl] : []);
    const topImagesBase64 = [];
    for (const url of topImageUrls) {
      try {
        if (
          typeof url === 'string' &&
          url.startsWith('https://static.mercdn.net/') &&
          typeof fetchImageAsBase64 === 'function'
        ) {
          const dataUrl = await fetchImageAsBase64(url);
          topImagesBase64.push(dataUrl || null);
        } else {
          topImagesBase64.push(null);
        }
      } catch (e) {
        console.error('[handleExportToSheet] top image base64 failed:', e && e.message ? e.message : e);
        topImagesBase64.push(null);
      }
    }
    if (topImagesBase64.some(Boolean)) {
      body.topImagesBase64 = topImagesBase64;
    }

    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    console.log('✅ データ送信成功');
    return { success: true, message: `${sheetName}に追加しました` };
  } catch (error) {
    console.error('❌ エクスポートエラー:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// 両シートへ一括送信（fire-and-forget エンドポイント）
// content.js が 1 回の sendMessage で両方の payload を渡す。
// タブを閉じても service worker として最後まで処理する。
// ==========================================
async function handleExportBoth(request) {
  const { webhookUrl, payloads } = request;
  if (!webhookUrl) throw new Error('Webhook URLが指定されていません');
  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw new Error('payloads が空です');
  }
  const results = [];
  for (const p of payloads) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: p.values, sheetName: p.sheetName || 'インポート用' })
      });
      console.log('✅ exportBoth 送信成功:', p.sheetName);
      results.push({ sheetName: p.sheetName, ok: true });
    } catch (e) {
      console.error('❌ exportBoth 送信失敗:', p.sheetName, e?.message || e);
      results.push({ sheetName: p.sheetName, ok: false, error: e?.message });
    }
  }
  const allOk = results.every(r => r.ok);
  return { success: allOk, results };
}

async function verifyWebhookUrl(webhookUrl, sheetName) {
  try {
    if (!webhookUrl) throw new Error('Webhook URLが入力されていません');
    if (!webhookUrl.includes('script.google.com') &&
        !webhookUrl.includes('script.googleusercontent.com')) {
      throw new Error('正しいGoogle Apps Script URLではありません');
    }
    const testData = { values: Array(26).fill('テスト'), sheetName: sheetName || 'インポート用' };
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });
    return { success: true, message: `接続テスト成功！「${sheetName}」シートを確認してください。` };
  } catch (error) {
    console.error('❌ 検証エラー:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// AI 翻訳：OpenAI Responses API 呼び出し
// payload: { product, imageUrl, model, prompts: {common, platform}, webSearchEnabled }
// ==========================================
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const RATE_LIMIT_KEY = 'aiRateLimit';
const DEFAULT_DAILY_LIMIT = 1000;     // 拡張側の暴走防止用（緩めの上限）
const REQUEST_TIMEOUT_MS = 60_000;    // 60 秒タイムアウト

async function handleAiTranslate(payload) {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: '不正なリクエストです' };
  }

  // API キーをローカルストレージから取得（content.js は読めない）
  const { aiApiKey } = await chrome.storage.local.get('aiApiKey');
  if (!aiApiKey || typeof aiApiKey !== 'string' || aiApiKey.length < 10) {
    return { success: false, error: 'OpenAI API キーが設定されていません。設定画面で入力してください。' };
  }

  // レート制限チェック
  const limitCheck = await checkAndIncrementRateLimit();
  if (!limitCheck.ok) {
    return { success: false, error: limitCheck.error };
  }

  // 入力検証
  if (!payload.model || typeof payload.model !== 'string') {
    return { success: false, error: 'モデルが指定されていません' };
  }
  if (!payload.product || typeof payload.product !== 'object') {
    return { success: false, error: '商品データがありません' };
  }
  if (!payload.prompts || typeof payload.prompts !== 'object') {
    return { success: false, error: 'プロンプトがありません' };
  }

  // システムプロンプト合成
  const commonPrompt = (payload.prompts.common || '').toString();
  const platformPrompt = (payload.prompts.platform || '').toString();
  const systemPrompt = `${commonPrompt}\n\n---\n\n${platformPrompt}`.trim();
  if (!systemPrompt) {
    return { success: false, error: 'プロンプトが空です' };
  }

  // ユーザーコンテンツ（商品データ + 設定された枚数のメイン画像 + マイタグ候補）
  let userText = '以下の商品データを上記スキーマで JSON 出力してください。\n\n' + JSON.stringify(payload.product, null, 2);
  // マイタグ候補を user content の末尾に付与
  if (Array.isArray(payload.userTags) && payload.userTags.length) {
    userText += '\n\n# マイタグ候補（ユーザーが管理しているタグ。この中から商品に合うものを recommendedUserTags に 1〜3 個選んでください。タグ名はそのままコピー。商品ジャンルと無関係なものは選ばないこと）\n'
      + payload.userTags.map(t => '- ' + t).join('\n');
  }
  const userContent = [{ type: 'input_text', text: userText }];
  // imageUrls: 配列で複数枚対応。imageUrl: 後方互換で 1 枚（文字列）
  const imageList = Array.isArray(payload.imageUrls)
    ? payload.imageUrls
    : (payload.imageUrl ? [payload.imageUrl] : []);
  for (const url of imageList) {
    if (typeof url === 'string' && url.startsWith('https://')) {
      userContent.push({ type: 'input_image', image_url: url });
    }
  }

  // リクエストボディ
  const requestBody = {
    model: payload.model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  };

  // OpenAI の制約: Web Search と JSON mode (text.format) は併用不可。
  // Web Search ON → プロンプト強制で JSON、OFF → text.format で JSON モード
  if (payload.webSearchEnabled) {
    requestBody.tools = [{ type: 'web_search' }];
    // text.format は付けない（プロンプト側で JSON のみを強制している）
  } else {
    requestBody.text = { format: { type: 'json_object' } };
  }

  // GPT-5 系では reasoning_effort が長すぎると無応答になるため low 固定
  if (/^gpt-5/i.test(payload.model)) {
    requestBody.reasoning = { effort: 'low' };
  }

  // 呼び出し
  let response;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiApiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(tid);
  } catch (e) {
    console.error('❌ AI 通信失敗:', e?.name);
    return { success: false, error: 'OpenAI への通信に失敗しました（タイムアウト or ネットワーク）' };
  }

  if (!response.ok) {
    const status = response.status;
    let bodyText = '';
    try { bodyText = await response.text(); } catch (_) {}
    // エラーメッセージに API キーを含めない
    const safeBody = bodyText.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 300);
    console.error(`❌ OpenAI API エラー (${status}):`, safeBody);
    return {
      success: false,
      error: `OpenAI API エラー（HTTP ${status}）: ${safeBody}`
    };
  }

  let json;
  try {
    json = await response.json();
  } catch (_) {
    return { success: false, error: 'OpenAI の応答を JSON として解析できませんでした' };
  }

  const outputText = extractOutputText(json);
  if (!outputText) {
    return { success: false, error: 'AI 応答から本文を抽出できませんでした' };
  }

  // Web Search ON 時はプロンプト強制で JSON を返させているが、
  // コードフェンス（```json ... ```）や前後の文章が混入する可能性があるので堅牢にパース
  const parsed = safeParseJson(outputText);
  if (!parsed) {
    return { success: false, error: 'AI 応答の JSON パースに失敗しました（応答冒頭: ' + outputText.slice(0, 80).replace(/\s+/g, ' ') + '）' };
  }

  const valid = validateAiResponse(parsed);
  if (!valid.ok) {
    return { success: false, error: `AI 応答の検証エラー: ${valid.error}` };
  }

  // 出力 HTML をサニタイズ
  parsed.description = sanitizeHtml(parsed.description || '');

  // ログには API キーが残らない（payload に含まれていない）
  console.log('✅ AI 翻訳成功: title len=', parsed.title?.length, 'category候補=', parsed.categorySuggestions?.length);

  return { success: true, data: parsed };
}

// ==========================================
// AI 修正：既存 AI 結果 + ユーザーの修正指示を渡して再生成
// payload: { currentAi, userInstruction, productContext, model, prompts:{common,platform}, webSearchEnabled }
// ==========================================
async function handleAiRefine(payload) {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: '不正なリクエストです' };
  }
  const { aiApiKey } = await chrome.storage.local.get('aiApiKey');
  if (!aiApiKey || typeof aiApiKey !== 'string' || aiApiKey.length < 10) {
    return { success: false, error: 'OpenAI API キーが設定されていません' };
  }

  const limitCheck = await checkAndIncrementRateLimit();
  if (!limitCheck.ok) return { success: false, error: limitCheck.error };

  if (!payload.userInstruction || !String(payload.userInstruction).trim()) {
    return { success: false, error: '修正指示が空です' };
  }
  if (!payload.currentAi || typeof payload.currentAi !== 'object') {
    return { success: false, error: '修正対象の AI 結果がありません' };
  }
  if (!payload.model) return { success: false, error: 'モデルが指定されていません' };
  if (!payload.prompts) return { success: false, error: 'プロンプトがありません' };

  const commonPrompt = (payload.prompts.common || '').toString();
  const platformPrompt = (payload.prompts.platform || '').toString();
  const refineInstruction = `

# 追加指示（修正リクエスト）
あなたは前回 eBay 出品データを生成しました。今回はユーザーから追加の修正指示が届きます。
既存の AI 結果を、ユーザーの指示に **必ず** 従って修正してください。
- 指示が小さくても、何らかの具体的な変更を加えること。「同じ内容で返す」ことは避ける。
- 指示が抽象的な場合は、自分の判断で適切に改善すること。
- title・description・itemSpecifics・categorySuggestions のうち、修正に関連するフィールドはすべて更新する。
- 出力 JSON スキーマは絶対に変更してはいけません。スキーマで定義されたキー以外を出力しないこと。
- warnings は **日本語** で記載すること。`;
  const systemPrompt = `${commonPrompt}\n\n---\n\n${platformPrompt}${refineInstruction}`.trim();

  const userText =
`# 商品データ（参考）
${JSON.stringify(payload.productContext || {}, null, 2)}

# 既存の AI 結果（修正対象）
${JSON.stringify(payload.currentAi || {}, null, 2)}

# ユーザーの修正指示
${String(payload.userInstruction).trim()}

上記の修正指示に従って、既存の AI 結果を修正してください。修正された JSON のみを返してください。`;

  const requestBody = {
    model: payload.model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'input_text', text: userText }] }
    ]
  };
  if (payload.webSearchEnabled) {
    requestBody.tools = [{ type: 'web_search' }];
  } else {
    requestBody.text = { format: { type: 'json_object' } };
  }
  if (/^gpt-5/i.test(payload.model)) {
    requestBody.reasoning = { effort: 'low' };
  }

  let response;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiApiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(tid);
  } catch (e) {
    return { success: false, error: 'OpenAI への通信に失敗しました（タイムアウト or ネットワーク）' };
  }

  if (!response.ok) {
    let bodyText = '';
    try { bodyText = await response.text(); } catch (_) {}
    const safeBody = bodyText.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 300);
    return { success: false, error: `OpenAI API エラー（HTTP ${response.status}）: ${safeBody}` };
  }

  let json;
  try {
    json = await response.json();
  } catch (_) {
    return { success: false, error: 'OpenAI の応答を JSON として解析できませんでした' };
  }

  const outputText = extractOutputText(json);
  if (!outputText) return { success: false, error: 'AI 応答から本文を抽出できませんでした' };

  const parsed = safeParseJson(outputText);
  if (!parsed) {
    return { success: false, error: 'AI 修正応答の JSON パースに失敗しました（応答冒頭: ' + outputText.slice(0, 80).replace(/\s+/g, ' ') + '）' };
  }

  const valid = validateAiResponse(parsed);
  if (!valid.ok) {
    return { success: false, error: `AI 修正応答の検証エラー: ${valid.error}` };
  }
  parsed.description = sanitizeHtml(parsed.description || '');

  console.log('✅ AI 修正成功');
  return { success: true, data: parsed };
}

// ==========================================
// Responses API のレスポンスから本文テキストを抽出
// ==========================================
function extractOutputText(json) {
  if (!json) return null;
  // 推奨パス: json.output[*].content[*].text where type === 'output_text'
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if ((c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') {
            return c.text;
          }
        }
      }
    }
  }
  // フォールバック
  if (typeof json.output_text === 'string') return json.output_text;
  if (typeof json.text === 'string') return json.text;
  return null;
}

// ==========================================
// JSON 堅牢パース：コードフェンスや前後の説明文が混じっても JSON だけ取り出す
// ==========================================
function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  // ```json ... ``` または ``` ... ``` で囲まれている場合の中身を抽出
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  // 通常パース
  try { return JSON.parse(s); } catch (_) {}
  // フォールバック：最初の { から最後の } までを抜き出してパース
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

// ==========================================
// AI 応答の検証（必須キー、型、Title 80字制限）
// ==========================================
function validateAiResponse(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'object でない' };

  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    return { ok: false, error: 'title が空 or 文字列でない' };
  }
  if (obj.title.length > 80) {
    return { ok: false, error: `title が 80 文字を超えています（${obj.title.length}）` };
  }
  if (typeof obj.description !== 'string') {
    return { ok: false, error: 'description が文字列でない' };
  }
  if (!Array.isArray(obj.categorySuggestions)) {
    return { ok: false, error: 'categorySuggestions が配列でない' };
  }
  if (typeof obj.itemSpecifics !== 'object' || obj.itemSpecifics === null || Array.isArray(obj.itemSpecifics)) {
    return { ok: false, error: 'itemSpecifics がオブジェクトでない' };
  }
  if (!Array.isArray(obj.warnings)) {
    obj.warnings = []; // 寛容に補正
  }
  if (!Array.isArray(obj.recommendedUserTags)) {
    obj.recommendedUserTags = []; // 寛容に補正
  }
  return { ok: true };
}

// ==========================================
// HTML サニタイザー（簡易版）
// 全ての HTML タグを除去してプレーンテキストに変換する。
// description は eBay の説明欄に直接渡されるため、装飾タグ（<strong>, <br> 等）が
// あるとそのまま eBay に入る。椛島さんの方針は「一つの文章として」プレーンテキスト出力。
// ==========================================
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  let s = html;

  // <script>, <style>, <iframe> 等は中身ごと丸ごと削除（テキスト残しを防ぐ）
  s = s.replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '');

  // <li> の閉じタグ → ", "（リスト要素を 1 行のカンマ区切りに変換）
  s = s.replace(/\s*<\s*\/\s*li\s*>\s*/gi, ', ');

  // <br>, <p>, <div>, <ul>, <ol>, <li>, <h1〜6> → 半角スペース 1 個に置換
  // （ブロック区切りを失わないように、前後の単語が連結しないようスペース挿入）
  s = s.replace(/<\s*\/?\s*(br|p|div|ul|ol|li|h[1-6]|tr|td|th|table|thead|tbody|tfoot)\b[^>]*\/?>/gi, ' ');

  // 残った全ての HTML タグを完全削除
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');

  // HTML エンティティをデコード（&amp; → &、&nbsp; → スペース 等）
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&amp;/gi, '&');
  s = s.replace(/&lt;/gi, '<');
  s = s.replace(/&gt;/gi, '>');
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/&#39;/gi, "'");
  s = s.replace(/&apos;/gi, "'");

  // 改行・タブ・連続スペースを 1 個の半角スペースに圧縮（1 行の文章にする）
  s = s.replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/\s+/g, ' ');

  // ", " の前後にゴミがあれば整理（タグ削除後の", , " などを 1 つに）
  s = s.replace(/,\s*,+/g, ',');
  s = s.replace(/,\s+\./g, '.');
  s = s.replace(/,\s*$/g, '');

  return s.trim();
}

// ==========================================
// レート制限：1 日のリクエスト数を制限（暴走防止）
// 設定値は chrome.storage.sync の aiDailyLimit から読む（デフォルト DEFAULT_DAILY_LIMIT）
// ==========================================
async function checkAndIncrementRateLimit() {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { [RATE_LIMIT_KEY]: state } = await chrome.storage.local.get(RATE_LIMIT_KEY);
    const { aiDailyLimit } = await chrome.storage.sync.get({ aiDailyLimit: DEFAULT_DAILY_LIMIT });
    const limit = Math.max(1, parseInt(aiDailyLimit, 10) || DEFAULT_DAILY_LIMIT);

    let count = 0;
    if (state && state.date === today) {
      count = state.count || 0;
    }
    if (count >= limit) {
      return { ok: false, error: `本日の AI 翻訳上限（${limit}件/日）に達しました。設定で上限を変更できます。` };
    }
    await chrome.storage.local.set({
      [RATE_LIMIT_KEY]: { date: today, count: count + 1 }
    });
    return { ok: true };
  } catch (e) {
    // 失敗してもリクエスト自体はブロックしない（fail-open）
    console.warn('レート制限チェック失敗（継続）:', e?.message);
    return { ok: true };
  }
}
