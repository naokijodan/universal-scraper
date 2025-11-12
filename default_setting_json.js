/*
 統合フィールド定義
 全サイト（eBay, 楽天, Amazon, メルカリ, ヤフオク, ラクマ）に対応
 データがない項目は空白で出力
*/

// ========================================
// フィールド定義（一元管理）
// ========================================
const FIELD_DEFINITIONS = {
  // 共通フィールド（全サイト）
  common: [
    {id: 'platform', label: 'プラットフォーム', enabled: true, sites: ['all']},
    {id: 'url', label: '商品URL/ID', enabled: true, sites: ['all']},
    {id: 'price', label: '価格', enabled: true, sites: ['all']},
    {id: 'title', label: '商品名/タイトル', enabled: true, sites: ['all']},
    {id: 'description', label: '説明/詳細', enabled: true, sites: ['all']},
    {id: 'seller', label: '販売者/出品者ID', enabled: true, sites: ['all']},
    {id: 'pageUrl', label: 'ページURL', enabled: true, sites: ['all'], excludeFromClipboard: true}
  ],

  // メルカリ/ヤフオク/ラクマ専用フィールド
  furima: [
    {id: 'reviewCount', label: '評価件数', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'badRate', label: '悪い評価率', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'listedDate', label: '出品日時', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'updatedDate', label: '更新日時', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'handlingDays', label: '発送までの日数', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'listedElapsedDays', label: '出品からの経過日数', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'updatedElapsedDays', label: '更新からの経過日数', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'condition', label: '商品の状態', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'shippingPayer', label: '配送料の負担', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'shippingMethod', label: '配送方法', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']},
    {id: 'shipFrom', label: '発送元の地域', enabled: true, sites: ['mercari', 'yahuoku', 'paypayfurima', 'rakuma']}
  ],

  // 全サイト共通（キーワード検知）
  detection: [
    {id: 'keywords', label: '検知キーワード', enabled: true, sites: ['all']}
  ],

  // 画像（全サイト、20枚固定）
  images: {
    id: 'imageUrl',
    label: '商品画像',
    count: 20,
    enabled: true,
    sites: ['all']
  }
};

// 出力フィールドを自動生成する関数
function generateOutputFields() {
  const fields = [];

  // 共通フィールド
  fields.push(...FIELD_DEFINITIONS.common);

  // フリマサイト専用フィールド
  fields.push(...FIELD_DEFINITIONS.furima);

  // 検知フィールド
  fields.push(...FIELD_DEFINITIONS.detection);

  // 画像フィールドを展開（imageUrl1 〜 imageUrl20）
  const imageDef = FIELD_DEFINITIONS.images;
  for (let i = 1; i <= imageDef.count; i++) {
    fields.push({
      id: `${imageDef.id}${i}`,
      label: `${imageDef.label}${i}`,
      enabled: imageDef.enabled,
      sites: imageDef.sites,
      arrayBase: imageDef.id,
      arrayIndex: i - 1
    });
  }

  return fields;
}

// デフォルトのアラートキーワード（mercari_yahoo_extensionから継承）
function defaultAlertKeywords() {
  const data = `
なると
カシオ
ゴジラ
ナイキ
ナルト
アトラス
ペルソナ
ミッフィ
ワムオー
ミッフィー
まいんくらふと
マインクラフト
エヴァンゲリオン
atlus
BIGFOOT
casio
Casio
CASIO
degital devil saga
Degital Devil saga
DIGITAL DEVIL SAGA
EVANGELION
GODZILLA
Hatsune Miku
MEGAMITENSEI
MEGAMI TENSEI
miffy
Miffy
MIFFY
minecraft
Minecraft
MINECRAFT
naruto
Naruto
NARUTO
nike
Nike
NIKE
Persona
SHIN MEGAMI TENSEI
Wham-o
初音ミク
女神転生
新・女神転生
`;
  return data.trim().split('\n');
}

// デフォルトの除外キーワード
function defaultExcludeKeywords() {
  const data = `
なると
カシオ
ゴジラ
ナイキ
ナルト
アトラス
ペルソナ
ミッフィ
ワムオー
ミッフィー
まいんくらふと
マインクラフト
エヴァンゲリオン
atlus
BIGFOOT
casio
Casio
CASIO
degital devil saga
Degital Devil saga
DIGITAL DEVIL SAGA
EVANGELION
GODZILLA
Hatsune Miku
MEGAMITENSEI
MEGAMI TENSEI
miffy
Miffy
MIFFY
minecraft
Minecraft
MINECRAFT
naruto
Naruto
NARUTO
nike
Nike
NIKE
Persona
SHIN MEGAMI TENSEI
Wham-o
初音ミク
女神転生
新・女神転生
`;
  return data.trim().split('\n');
}

// デフォルト設定
const default_setting_json = {
  // サイト別有効/無効
  enableEbay: true,
  enableRakuten: true,
  enableAmazon: true,
  enableMercari: true,
  enableYahoo: true,
  enableFril: true,

  // ボタン位置
  buttonPosition: 'top-right',

  // 画像設定
  imageOutputCount: 20, // 20枚固定
  enableImageInClipboard: true,

  // サイト別読み込み待機時間（秒）
  amazonLoadDelay: 3, // Amazon画像の遅延読み込み対応
  ebayLoadDelay: 0,
  rakutenLoadDelay: 0,
  mercariLoadDelay: 0,
  yahooLoadDelay: 0,
  frilLoadDelay: 0,

  // アラート・除外設定
  // alertKeywords: オプション画面の「除外キーワード」（赤ハイライト）
  // popupKeywords: オプション画面の「注目キーワード」（黄色ハイライト）
  alertKeywords: defaultAlertKeywords(),
  popupKeywords: [],
  excludeKeywords: defaultExcludeKeywords(), // 旧設定（互換性のため保持）
  excludeSellerIds: [], // 除外セラーID

  // フリマサイト（メルカリ/ヤフオク/PayPayフリマ/ラクマ）専用のアラート条件
  alertBadRate: 5, // 悪い評価率が次以上でアラート（%）
  alertLowReviewCount: 100, // 評価件数が次以下でアラート
  alertDaysFromListing: 180, // 出品からの日数が次以上でアラート
  alertDaysFromUpdate: 90, // 更新からの日数が次以上でアラート
  alertHandlingDays: false, // 発送までの日数が4〜7日の場合にアラート（true/false）

  // メルカリ/ヤフオク専用の除外条件（スキップ）
  skipReviewCount: null, // 評価件数が次未満をスキップ（nullは無効）
  skipBadRate: null, // 悪い評価率が次以上をスキップ（nullは無効）
  skipDaysFromListing: null, // 出品からの日数が次以上をスキップ（nullは無効）

  // スプレッドシート設定
  spreadsheets: [],
  lastUsedSheetId: null,
  maxSheets: 10,

  // 出力フィールド
  outputFields: generateOutputFields()
};
