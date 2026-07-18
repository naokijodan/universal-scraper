// みちゃった君 - Background Script
// ストレージ管理（IndexedDB）+ 商品情報取得

// ==============================
// IndexedDB設定
// ==============================
const DB_NAME = 'MichattaKunDB';
const DB_VERSION = 2;
const STORE_VIEWED = 'viewedItems';
const STORE_SETTINGS = 'settings';

// chrome.storage.localのキー（移行用・バックアップ用）
const STORAGE_KEY = 'mercari_viewed_items';
const ALERT_KEY = 'mercari_alert_settings';
const PREMIUM_KEY = 'mercari_premium_unlocked';
const MIGRATION_KEY = 'michatta_migration_v2';

// 未処理のPromise rejectionをログに出す
// 【フェーズ1レビュー指摘LOW-1の修正】このリスナーはトップレベルで無条件登録されるため、
// enableMichatta=OFF（未初期化）の状態でも、とりこみ君側の未処理rejectionを「みちゃった君」
// 名義で誤ってログ出力してしまう問題があった。michattaInitialized フラグで内部ゲートし、
// initialize()（enableMichatta=true のときのみ実行）が開始した後だけログを出す。
let michattaInitialized = false;
self.addEventListener('unhandledrejection', (event) => {
  if (!michattaInitialized) return;
  console.error('[みちゃった君 BG] 未処理のPromise rejection:', event.reason);
});

// ==============================
// LRUキャッシュ
// ==============================
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    // アクセスしたら最新に移動
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 最古のエントリを削除
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  getAll() {
    const items = {};
    this.cache.forEach((value, key) => {
      items[key] = value;
    });
    return items;
  }

  setMultiple(items) {
    for (const [key, value] of Object.entries(items)) {
      this.set(key, value);
    }
  }
}

// キャッシュインスタンス
const viewedItemsCache = new LRUCache(1000);

// ==============================
// IndexedDB操作
// ==============================
let db = null;
let dbReadyPromise = null;
let dbClosed = false;
const DB_RETRY_DELAYS = [100, 400, 900];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupDBEventHandlers(database) {
  database.onversionchange = () => {
    console.warn('[みちゃった君 BG] IndexedDB versionchange検知。接続を閉じます。');
    database.close();
    db = null;
    dbClosed = true;
  };

  database.onclose = () => {
    console.warn('[みちゃった君 BG] IndexedDB接続が閉じられました。再接続を試みます。');
    db = null;
    dbClosed = true;
    if (!dbReadyPromise) {
      initDB().catch((error) => {
        console.error('[みちゃった君 BG] IndexedDB再接続エラー:', error);
      });
    }
  };
}

function openDBOnce() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[みちゃった君 BG] IndexedDB初期化エラー:', request.error);
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn('[みちゃった君 BG] IndexedDBの初期化がブロックされました');
      reject(new Error('IndexedDBがブロックされました'));
    };

    request.onsuccess = () => {
      db = request.result;
      dbClosed = false;
      setupDBEventHandlers(db);
      console.log('[みちゃった君 BG] IndexedDB初期化完了');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_VIEWED)) {
        const viewedStore = database.createObjectStore(STORE_VIEWED, { keyPath: 'id' });
        viewedStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('[みちゃった君 BG] viewedItemsストア作成');
      }

      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        console.log('[みちゃった君 BG] settingsストア作成');
      }
    };
  });
}

async function initDB() {
  if (db && !dbClosed) return db;
  if (dbReadyPromise) return dbReadyPromise;

  dbReadyPromise = (async () => {
    for (let attempt = 0; attempt <= DB_RETRY_DELAYS.length; attempt++) {
      try {
        return await openDBOnce();
      } catch (error) {
        if (attempt === DB_RETRY_DELAYS.length) {
          throw error;
        }
        const delay = DB_RETRY_DELAYS[attempt];
        console.warn(`[みちゃった君 BG] IndexedDB再試行まで待機: ${delay}ms`);
        await wait(delay);
      }
    }
    throw new Error('IndexedDB初期化失敗');
  })();

  try {
    return await dbReadyPromise;
  } finally {
    dbReadyPromise = null;
  }
}

async function ensureDBReady() {
  if (!db || dbClosed) {
    return initDB();
  }

  try {
    db.transaction(STORE_VIEWED, 'readonly');
    return db;
  } catch (error) {
    console.warn('[みちゃった君 BG] IndexedDB接続が無効です。再接続します。', error);
    dbClosed = true;
    db = null;
    return initDB();
  }
}

function getStorageLocal(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function setStorageLocal(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

// ==============================
// 閲覧済み商品の操作
// ==============================

async function getViewedItems() {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_VIEWED, 'readonly');
    const store = tx.objectStore(STORE_VIEWED);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const items = {};
        request.result.forEach(item => {
          items[item.id] = item.timestamp;
        });
        // キャッシュを更新
        viewedItemsCache.setMultiple(items);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] getViewedItemsエラー:', error);
    return {};
  }
}

async function getViewedItemsBatch(ids) {
  // まずキャッシュから取得
  const result = {};
  const missingIds = [];

  for (const id of ids) {
    if (viewedItemsCache.has(id)) {
      result[id] = viewedItemsCache.get(id);
    } else {
      missingIds.push(id);
    }
  }

  // キャッシュにないものはIndexedDBから並列取得
  if (missingIds.length > 0) {
    try {
      const database = await ensureDBReady();
      const tx = database.transaction(STORE_VIEWED, 'readonly');
      const store = tx.objectStore(STORE_VIEWED);

      const promises = missingIds.map((id) => {
        return new Promise((resolve) => {
          const request = store.get(id);
          request.onsuccess = () => resolve({ id, item: request.result });
          request.onerror = () => resolve({ id, item: null });
        });
      });

      const results = await Promise.all(promises);
      for (const { id, item } of results) {
        if (item) {
          result[id] = item.timestamp;
          viewedItemsCache.set(id, item.timestamp);
        }
      }
    } catch (error) {
      console.error('[みちゃった君 BG] getViewedItemsBatchエラー:', error);
    }
  }

  return result;
}

async function saveViewedItem(itemId) {
  const timestamp = Date.now();

  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_VIEWED, 'readwrite');
    const store = tx.objectStore(STORE_VIEWED);

    store.put({ id: itemId, timestamp });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // キャッシュに追加
    viewedItemsCache.set(itemId, timestamp);

    // バックアップキューに追加
    queueBackup(itemId, timestamp);

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] saveViewedItemエラー:', error);
    return false;
  }
}

async function saveViewedItemsBulk(items) {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_VIEWED, 'readwrite');
    const store = tx.objectStore(STORE_VIEWED);

    for (const [id, timestamp] of Object.entries(items)) {
      store.put({ id, timestamp });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // キャッシュに追加
    viewedItemsCache.setMultiple(items);

    // バックアップキューに追加
    queueBackupBulk(items);

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] saveViewedItemsBulkエラー:', error);
    return false;
  }
}

async function getViewedItemsCount() {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_VIEWED, 'readonly');
    const store = tx.objectStore(STORE_VIEWED);

    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] getViewedItemsCountエラー:', error);
    return 0;
  }
}

async function clearAllViewedItems() {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_VIEWED, 'readwrite');
    const store = tx.objectStore(STORE_VIEWED);

    store.clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // キャッシュクリア
    viewedItemsCache.clear();

    // バックアップもクリア
    backupToStorageLocal().catch((error) => {
      console.error('[みちゃった君 BG] バックアップエラー:', error);
    });

    console.log('[みちゃった君 BG] 全履歴を削除しました');
    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] clearAllViewedItemsエラー:', error);
    return false;
  }
}

// バックアップ（デバウンス付き即時方式）
// Service Worker suspendに備え、長時間のタイマーは使わない
let backupPending = {};
let backupDebounceTimer = null;
const BACKUP_DEBOUNCE_MS = 10 * 1000; // 10秒

// バックアップキューに追加（10秒後にフラッシュ）
function queueBackup(itemId, timestamp) {
  backupPending[itemId] = timestamp;
  scheduleBackupFlush();
}

// バックアップキューに複数追加
function queueBackupBulk(items) {
  Object.assign(backupPending, items);
  scheduleBackupFlush();
}

// デバウンス付きバックアップスケジュール
function scheduleBackupFlush() {
  if (backupDebounceTimer !== null) {
    clearTimeout(backupDebounceTimer);
  }
  backupDebounceTimer = setTimeout(() => {
    backupDebounceTimer = null;
    flushBackup().catch((error) => {
      console.error('[みちゃった君 BG] バックアップフラッシュエラー:', error);
    });
  }, BACKUP_DEBOUNCE_MS);
}

// バックアップを実行
async function flushBackup() {
  const itemsToBackup = { ...backupPending };
  backupPending = {};

  if (Object.keys(itemsToBackup).length === 0) return;

  try {
    const result = await getStorageLocal([STORAGE_KEY]);
    const currentItems = result[STORAGE_KEY] || {};
    const mergedItems = Object.assign({}, currentItems, itemsToBackup);
    await setStorageLocal({ [STORAGE_KEY]: mergedItems });
  } catch (error) {
    // 失敗分を戻す（フラッシュ中に追加された新しいエントリは保護する）
    for (const [key, value] of Object.entries(itemsToBackup)) {
      if (!(key in backupPending)) {
        backupPending[key] = value;
      }
    }
    scheduleBackupFlush();
    console.error('[みちゃった君 BG] バックアップエラー:', error);
  }
}

// バックアップ（全削除用）
async function backupToStorageLocal() {
  // 保留中のタイマーをキャンセル
  if (backupDebounceTimer !== null) {
    clearTimeout(backupDebounceTimer);
    backupDebounceTimer = null;
  }
  // キューをクリア
  backupPending = {};
  await setStorageLocal({ [STORAGE_KEY]: {} });
}

// ==============================
// 設定の操作
// ==============================

const DEFAULT_ALERT_SETTINGS = {
  ratings: 100,
  badRate: 5,
  listedDays: 180,
  updatedDays: 90,
  shipping47: false,
  shipping8: false
};

async function getAlertSettings() {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve) => {
      const request = store.get('alertSettings');
      request.onsuccess = () => {
        const result = request.result;
        resolve({ ...DEFAULT_ALERT_SETTINGS, ...(result?.value || {}) });
      };
      request.onerror = () => resolve(DEFAULT_ALERT_SETTINGS);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] getAlertSettingsエラー:', error);
    return DEFAULT_ALERT_SETTINGS;
  }
}

async function saveAlertSettings(settings) {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    store.put({ key: 'alertSettings', value: settings });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // バックアップ
    chrome.storage.local.set({ [ALERT_KEY]: settings }).catch((error) => {
      console.error('[みちゃった君 BG] アラート設定バックアップエラー:', error);
    });

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] saveAlertSettingsエラー:', error);
    return false;
  }
}

async function isPremiumUnlocked() {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve) => {
      const request = store.get('premiumUnlocked');
      request.onsuccess = () => {
        resolve(request.result?.value === true);
      };
      request.onerror = () => resolve(false);
    });
  } catch (error) {
    console.error('[みちゃった君 BG] isPremiumUnlockedエラー:', error);
    return false;
  }
}

async function unlockPremium() {
  try {
    const database = await ensureDBReady();
    const tx = database.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    store.put({ key: 'premiumUnlocked', value: true });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // バックアップ
    chrome.storage.local.set({ [PREMIUM_KEY]: true }).catch((error) => {
      console.error('[みちゃった君 BG] 会員情報バックアップエラー:', error);
    });

    return true;
  } catch (error) {
    console.error('[みちゃった君 BG] unlockPremiumエラー:', error);
    return false;
  }
}

// ==============================
// データ移行
// ==============================

async function migrateFromStorageLocal() {
  try {
    // 移行済みチェック
    const migrationStatus = await new Promise((resolve, reject) => {
      chrome.storage.local.get([MIGRATION_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result[MIGRATION_KEY]);
      });
    });

    if (migrationStatus === 'completed') {
      console.log('[みちゃった君 BG] 移行済み');
      return;
    }

    console.log('[みちゃった君 BG] データ移行開始...');

    // 旧データを取得
    const legacyData = await new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEY, ALERT_KEY, PREMIUM_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      });
    });

    // 閲覧済み商品を移行
    const viewedItems = legacyData[STORAGE_KEY] || {};
    const itemCount = Object.keys(viewedItems).length;

    if (itemCount > 0) {
      console.log(`[みちゃった君 BG] ${itemCount}件の閲覧履歴を移行中...`);

      // 100件ずつ段階的に移行
      const entries = Object.entries(viewedItems);
      const batchSize = 100;

      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const batchItems = Object.fromEntries(batch);
        await saveViewedItemsBulk(batchItems);
        console.log(`[みちゃった君 BG] 移行進捗: ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
      }

      console.log('[みちゃった君 BG] 閲覧履歴の移行完了');
    }

    // アラート設定を移行
    if (legacyData[ALERT_KEY]) {
      await saveAlertSettings(legacyData[ALERT_KEY]);
      console.log('[みちゃった君 BG] アラート設定を移行完了');
    }

    // 会員情報を移行
    if (legacyData[PREMIUM_KEY]) {
      await unlockPremium();
      console.log('[みちゃった君 BG] 会員情報を移行完了');
    }

    // 移行完了フラグ
    chrome.storage.local.set({ [MIGRATION_KEY]: 'completed' }).catch((error) => {
      console.error('[みちゃった君 BG] 移行フラグ保存エラー:', error);
    });
    console.log('[みちゃった君 BG] 全移行完了');

  } catch (error) {
    console.error('[みちゃった君 BG] 移行エラー:', error);
  }
}

// ==============================
// メッセージハンドラ
// ==============================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const MICHATTA_ACTIONS = ['storage', 'fetchItemDetails', 'openInBackground'];
  if (!MICHATTA_ACTIONS.includes(request.action)) {
    // みちゃった君に関係ないメッセージには一切応答しない（とりこみ君側のリスナーに委ねる）
    return false;
  }

  chrome.storage.sync.get({ enableMichatta: false }, ({ enableMichatta }) => {
    if (!enableMichatta) {
      sendResponse({ success: false, error: 'みちゃった君機能は無効です' });
      return;
    }

    // ストレージ操作
    if (request.action === 'storage') {
      let responded = false;
      const safeSendResponse = (data) => {
        if (!responded) {
          responded = true;
          sendResponse(data);
        }
      };
      handleStorageMessage(request, safeSendResponse).catch((error) => {
        console.error('[みちゃった君 BG] ストレージ操作エラー:', error);
        safeSendResponse({ success: false, error: error.message });
      });
      return;
    }

    // 商品詳細取得
    if (request.action === 'fetchItemDetails') {
      fetchItemDetailsInBackground(request.itemId, request.itemUrl)
        .then(details => sendResponse({ success: true, details }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return;
    }

    // バックグラウンドで新しいタブを開く
    if (request.action === 'openInBackground') {
      chrome.tabs.create({ url: request.url, active: false }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ success: true });
      });
    }
  });

  return true; // 非同期レスポンス
});

async function handleStorageMessage(request, sendResponse) {
  const { method, params } = request;

  try {
    let result;

    switch (method) {
      case 'getViewedItems':
        result = await getViewedItems();
        sendResponse({ success: true, items: result });
        break;

      case 'getViewedItemsBatch':
        result = await getViewedItemsBatch(params.ids);
        sendResponse({ success: true, items: result });
        break;

      case 'saveViewedItem':
        result = await saveViewedItem(params.itemId);
        sendResponse({ success: result });
        break;

      case 'saveViewedItemsBulk':
        result = await saveViewedItemsBulk(params.items);
        sendResponse({ success: result });
        break;

      case 'getViewedItemsCount':
        result = await getViewedItemsCount();
        sendResponse({ success: true, count: result });
        break;

      case 'clearAllViewedItems':
        result = await clearAllViewedItems();
        sendResponse({ success: result });
        break;

      case 'getAlertSettings':
        result = await getAlertSettings();
        sendResponse({ success: true, settings: result });
        break;

      case 'saveAlertSettings':
        result = await saveAlertSettings(params.settings);
        sendResponse({ success: result });
        break;

      case 'isPremiumUnlocked':
        result = await isPremiumUnlocked();
        sendResponse({ success: true, unlocked: result });
        break;

      case 'unlockPremium':
        result = await unlockPremium();
        sendResponse({ success: result });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown method' });
    }
  } catch (error) {
    console.error('[みちゃった君 BG] ストレージ操作エラー:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ==============================
// 商品詳細取得（既存機能）
// ==============================

async function fetchItemDetailsInBackground(itemId, itemUrl) {
  return new Promise((resolve, reject) => {
    const checkUrl = itemUrl + (itemUrl.includes('?') ? '&' : '?') + '_mcheck=1';

    chrome.tabs.create({
      url: checkUrl,
      active: false
    }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tab || typeof tab.id !== 'number') {
        reject(new Error('タブ作成失敗'));
        return;
      }
      const tabId = tab.id;
      let timeoutId;
      let retryCount = 0;
      const maxRetries = 2;

      timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId).catch(() => {});
        reject(new Error('タイムアウト'));
      }, 15000);

      const tryGetDetails = () => {
        console.log('[みちゃった君 BG] タブにメッセージ送信 (試行:', retryCount + 1, ')');
        chrome.tabs.sendMessage(tabId, { action: 'getItemDetails' }, (response) => {
          console.log('[みちゃった君 BG] レスポンス:', response);

          if (chrome.runtime.lastError) {
            console.log('[みちゃった君 BG] 通信エラー:', chrome.runtime.lastError.message);
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(tryGetDetails, 2000);
              return;
            }
            clearTimeout(timeoutId);
            chrome.tabs.remove(tabId).catch(() => {});
            reject(new Error('通信エラー'));
            return;
          }

          if (response && response.success) {
            if (response.details.ratings === 0 && retryCount < maxRetries) {
              console.log('[みちゃった君 BG] 評価0のためリトライ');
              retryCount++;
              setTimeout(tryGetDetails, 2000);
              return;
            }
            clearTimeout(timeoutId);
            chrome.tabs.remove(tabId).catch(() => {});
            resolve(response.details);
          } else {
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(tryGetDetails, 2000);
              return;
            }
            clearTimeout(timeoutId);
            chrome.tabs.remove(tabId).catch(() => {});
            reject(new Error(response?.error || '取得失敗'));
          }
        });
      };

      const listener = (changedTabId, changeInfo) => {
        if (changedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(tryGetDetails, 4000);
        }
      };

      if (typeof tabId === 'number') {
        chrome.tabs.onUpdated.addListener(listener);
      } else {
        clearTimeout(timeoutId);
        reject(new Error('タブIDが無効です'));
      }
    });
  });
}

// ==============================
// 初期化
// ==============================

async function initialize() {
  // enableMichatta=true が確認できてここに到達した時点で初期化済みとみなし、
  // unhandledrejectionのログゲート（michattaInitialized）を開く。
  michattaInitialized = true;
  try {
    await initDB();
    await migrateFromStorageLocal();
    console.log('[みちゃった君 BG] 初期化完了');
  } catch (error) {
    console.error('[みちゃった君 BG] 初期化エラー:', error);
  }
}

// enableMichatta (chrome.storage.sync) が true のときだけ実際に初期化する。
// これが無いと、とりこみ君の既存ユーザー（オフのまま）でも Service Worker 起動の
// たびに IndexedDB (MichattaKunDB) が新規作成され、既存動作を変えない、という
// 統合の絶対要件に違反する。
async function initializeIfEnabled() {
  const { enableMichatta } = await chrome.storage.sync.get({ enableMichatta: false });
  if (!enableMichatta) {
    console.log('[みちゃった君 BG] enableMichatta=false のため初期化をスキップ');
    return;
  }
  await initialize();
}

// Service Worker起動時に初期化（enableMichatta=false なら何もしない）
initializeIfEnabled().catch((error) => {
  console.error('[みちゃった君 BG] 初期化エラー:', error);
});

// enableMichatta が OFF→ON に変わったとき、Service Worker が生存していれば
// リロード無しで再初期化を試みる（Service Worker が休止済みなら次回起動時に
// initializeIfEnabled() が最新値を見るので、この即時リスナーは保険的位置づけ）。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.enableMichatta && changes.enableMichatta.newValue === true) {
    initializeIfEnabled().catch((error) => {
      console.error('[みちゃった君 BG] 再初期化エラー:', error);
    });
  }
});
