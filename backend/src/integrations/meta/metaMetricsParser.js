import crypto from 'node:crypto';

const LANDING_PAGE_VIEW_ALIASES = ['landing_page_view', 'omni_landing_page_view'];
const ADD_TO_CART_ALIASES = [
  'offsite_conversion.fb_pixel_add_to_cart',
  'add_to_cart',
  'omni_add_to_cart',
  'onsite_web_add_to_cart',
];
const PURCHASE_ALIASES = [
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
  'omni_purchase',
  'onsite_web_purchase',
];
const LINK_CLICK_ALIASES = ['link_click'];

function parseOptionalNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function parseOptionalInt(val) {
  const num = parseOptionalNumber(val);
  return num === null ? null : Math.round(num);
}

function roundMetric(val, decimals = 4) {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Resolve first matching metric across ordered Meta action_type aliases
 * without double-counting duplicate pixel + omni action aliases.
 */
export function extractOrderedActionMetric(actionList, aliases, { integer = false } = {}) {
  if (!Array.isArray(actionList) || actionList.length === 0) return null;
  for (const alias of aliases) {
    const match = actionList.find((item) => item?.action_type === alias && item?.value !== undefined);
    if (match) {
      return integer ? parseOptionalInt(match.value) : parseOptionalNumber(match.value);
    }
  }
  return null;
}

/**
 * Parse Meta purchase_roas / website_purchase_roas array cleanly.
 */
export function extractRoasValue(roasList) {
  if (!Array.isArray(roasList) || roasList.length === 0) return null;
  const preferred =
    roasList.find((r) => PURCHASE_ALIASES.includes(r?.action_type)) ||
    roasList.find((r) => r?.value !== undefined);
  return preferred ? roundMetric(parseOptionalNumber(preferred.value), 4) : null;
}

/**
 * Determine if a reported YYYY-MM-DD date still falls inside Meta's delayed attribution
 * reporting window (within trailing 3 calendar days relative to referenceDate).
 */
export function isWithinDelayedAttributionWindow(dateStopStr, referenceDate = new Date()) {
  if (!dateStopStr || typeof dateStopStr !== 'string') return false;
  const parts = dateStopStr.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return false;

  const stopUtcMs = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const refUtcMs = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  const diffDays = (refUtcMs - stopUtcMs) / (24 * 60 * 60 * 1000);
  return diffDays >= 0 && diffDays <= 3;
}

/**
 * Build deterministic sync key ensuring idempotent upserts across repeated sync runs.
 */
export function buildMetaSyncKey({
  metaAdAccountId,
  metaAdId,
  dateStart,
  breakdownKey = 'none',
  attributionSetting = '7d_click_1d_view',
}) {
  const raw = [
    String(metaAdAccountId || ''),
    String(metaAdId || ''),
    String(dateStart || ''),
    String(breakdownKey || 'none'),
    String(attributionSetting || 'default'),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/**
 * Normalize one raw Meta Ads Insights API row into strict AdPilot analytics shape.
 * Explicitly separates inline_link_clicks / inline_link_click_ctr from all-click metrics
 * and preserves null for missing metrics (never fabricates zero conversions or reach).
 */
export function parseMetaInsightRow(rawRow, accountMeta = {}, attributionContext = {}) {
  const actions = Array.isArray(rawRow.actions) ? rawRow.actions : [];
  const actionValues = Array.isArray(rawRow.action_values) ? rawRow.action_values : [];
  const costPerAction = Array.isArray(rawRow.cost_per_action_type) ? rawRow.cost_per_action_type : [];

  const derivedFields = [];
  const missingMetrics = [];

  const impressions = parseOptionalInt(rawRow.impressions);
  if (impressions === null) missingMetrics.push('impressions');

  const reach = parseOptionalInt(rawRow.reach);
  if (reach === null) missingMetrics.push('reach');

  const spend = roundMetric(parseOptionalNumber(rawRow.spend), 4);
  if (spend === null) missingMetrics.push('spend');

  let cpm = roundMetric(parseOptionalNumber(rawRow.cpm), 4);
  if (cpm === null && spend !== null && impressions !== null && impressions > 0) {
    cpm = roundMetric((spend / impressions) * 1000, 4);
    derivedFields.push('cpm');
  }
  if (cpm === null) missingMetrics.push('cpm');

  // Preserve strict distinction: all clicks vs inline link clicks
  const allClicks = parseOptionalInt(rawRow.clicks);
  const allClickCtr = roundMetric(parseOptionalNumber(rawRow.ctr), 4);
  const allClickCpc = roundMetric(parseOptionalNumber(rawRow.cpc), 4);

  let linkClicks = parseOptionalInt(rawRow.inline_link_clicks);
  if (linkClicks === null) {
    linkClicks = extractOrderedActionMetric(actions, LINK_CLICK_ALIASES, { integer: true });
  }
  if (linkClicks === null) missingMetrics.push('link_clicks');

  let linkCtr = roundMetric(parseOptionalNumber(rawRow.inline_link_click_ctr), 4);
  if (linkCtr === null && linkClicks !== null && impressions !== null && impressions > 0) {
    linkCtr = roundMetric((linkClicks / impressions) * 100, 4);
    derivedFields.push('link_ctr');
  }
  if (linkCtr === null) missingMetrics.push('link_ctr');

  // Strictly use cost_per_inline_link_click for link CPC (never overwrite with all-click cpc)
  let cpc = roundMetric(parseOptionalNumber(rawRow.cost_per_inline_link_click), 4);
  if (cpc === null && spend !== null && linkClicks !== null && linkClicks > 0) {
    cpc = roundMetric(spend / linkClicks, 4);
    derivedFields.push('cpc');
  }
  if (cpc === null) missingMetrics.push('cpc');

  const landingPageViews = extractOrderedActionMetric(actions, LANDING_PAGE_VIEW_ALIASES, { integer: true });
  if (landingPageViews === null) missingMetrics.push('landing_page_views');

  const addToCart = extractOrderedActionMetric(actions, ADD_TO_CART_ALIASES, { integer: true });
  if (addToCart === null) missingMetrics.push('add_to_cart');

  const purchases = extractOrderedActionMetric(actions, PURCHASE_ALIASES, { integer: true });
  if (purchases === null) missingMetrics.push('purchases');

  const purchaseConversionValue = roundMetric(
    extractOrderedActionMetric(actionValues, PURCHASE_ALIASES, { integer: false }),
    4
  );
  if (purchaseConversionValue === null) missingMetrics.push('purchase_conversion_value');

  let cpa = roundMetric(extractOrderedActionMetric(costPerAction, PURCHASE_ALIASES, { integer: false }), 4);
  if (cpa === null && spend !== null && purchases !== null && purchases > 0) {
    cpa = roundMetric(spend / purchases, 4);
    derivedFields.push('cpa');
  }
  if (cpa === null) missingMetrics.push('cpa');

  let roas = extractRoasValue(rawRow.purchase_roas);
  if (roas === null) {
    roas = extractRoasValue(rawRow.website_purchase_roas);
  }
  if (roas === null && spend !== null && spend > 0 && purchaseConversionValue !== null) {
    roas = roundMetric(purchaseConversionValue / spend, 4);
    derivedFields.push('roas');
  }
  if (roas === null) missingMetrics.push('roas');

  const publisherPlatform = rawRow.publisher_platform || null;
  const platformPosition = rawRow.platform_position || null;
  const age = rawRow.age || null;
  const gender = rawRow.gender || null;

  const breakdownParts = [
    publisherPlatform ? `platform=${publisherPlatform}` : null,
    platformPosition ? `position=${platformPosition}` : null,
    age ? `age=${age}` : null,
    gender ? `gender=${gender}` : null,
  ].filter(Boolean);
  const breakdownKey = breakdownParts.length > 0 ? breakdownParts.join(';') : 'none';

  const dateStart = rawRow.date_start;
  const dateStop = rawRow.date_stop || rawRow.date_start;
  const attributionWindows =
    attributionContext.attributionWindows && attributionContext.attributionWindows.length > 0
      ? attributionContext.attributionWindows
      : ['7d_click', '1d_view'];
  const attributionSetting =
    rawRow.attribution_setting ||
    attributionContext.attributionSetting ||
    attributionWindows.join('_');

  const metaAdAccountId = accountMeta.adAccountId || rawRow.account_id || '';
  const metaAdId = rawRow.ad_id || rawRow.campaign_id || 'unknown_ad';

  return {
    metaAdAccountId: metaAdAccountId.startsWith('act_') ? metaAdAccountId : `act_${metaAdAccountId}`,
    metaCampaignId: rawRow.campaign_id || '',
    metaCampaignName: rawRow.campaign_name || '',
    metaAdSetId: rawRow.adset_id || '',
    metaAdSetName: rawRow.adset_name || '',
    metaAdId,
    metaAdName: rawRow.ad_name || '',
    dateStart,
    dateStop,
    currency: (rawRow.account_currency || accountMeta.currency || 'USD').toUpperCase(),
    timezoneName: accountMeta.timezoneName || 'UTC',
    timezoneOffsetHoursUtc: Number(accountMeta.timezoneOffsetHoursUtc ?? 0),
    attributionSetting,
    attributionWindows,
    useUnifiedAttributionSetting: attributionContext.useUnifiedAttributionSetting !== false,
    isProvisionalAttribution: isWithinDelayedAttributionWindow(
      dateStop,
      attributionContext.referenceDate || new Date()
    ),
    breakdownKey,
    publisherPlatform,
    platformPosition,
    age,
    gender,
    impressions,
    reach,
    spend,
    cpm,
    allClicks,
    allClickCtr,
    allClickCpc,
    linkClicks,
    linkCtr,
    cpc,
    landingPageViews,
    addToCart,
    purchases,
    purchaseConversionValue,
    cpa,
    roas,
    missingMetrics,
    derivedFields,
    rawActions: actions,
    rawActionValues: actionValues,
    syncKey: buildMetaSyncKey({
      metaAdAccountId,
      metaAdId,
      dateStart,
      breakdownKey,
      attributionSetting,
    }),
  };
}
