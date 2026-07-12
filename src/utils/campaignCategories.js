const CATEGORY_KEY_ALIASES = {
  'need review': 'need_review',
  review: 'need_review',
  'no need review': 'no_need_review',
  'no review': 'no_need_review',
  'no need': 'no_need_review',
  rating: 'rating',
  feedback: 'feedback',
  'feedback only': 'feedback',
  'pre-pay': 'pre_pay',
  prepay: 'pre_pay',
};

const CATEGORY_LABELS = {
  need_review: 'Need Review',
  no_need_review: 'No Need Review',
  rating: 'Rating',
  feedback: 'Feedback',
  pre_pay: 'Pre-Pay',
};

const PLATFORM_CHARGE_CONDITION_KEYS = ['need_review', 'no_need_review', 'rating', 'feedback'];

const normalizeCampaignCategoryKey = (category) => {
  const normalized = String(category || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return CATEGORY_KEY_ALIASES[normalized] || null;
};

const normalizeCampaignCategory = (category) => {
  const key = normalizeCampaignCategoryKey(category);
  if (key) return CATEGORY_LABELS[key];
  return String(category || '').trim() || 'Need Review';
};

const isReviewRequiredCampaignCategory = (category) => {
  const key = normalizeCampaignCategoryKey(category);
  return key === 'need_review' || key === 'rating' || key === 'feedback';
};

const buildDefaultPlatformChargeConditions = () =>
  PLATFORM_CHARGE_CONDITION_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

const parseMaybeJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const parsePlatformChargeTiers = (value) => {
  const parsed = parseMaybeJson(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((tier) =>
    tier &&
    tier.min !== '' &&
    tier.max !== '' &&
    tier.fee !== '' &&
    Number.isFinite(Number(tier.min)) &&
    Number.isFinite(Number(tier.max)) &&
    Number.isFinite(Number(tier.fee))
  );
};

const parsePlatformChargeConditions = (value) => {
  const parsed = parseMaybeJson(value, {});
  const defaults = buildDefaultPlatformChargeConditions();

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }

  for (const key of PLATFORM_CHARGE_CONDITION_KEYS) {
    defaults[key] = parsePlatformChargeTiers(parsed[key]);
  }

  return defaults;
};

const resolvePlatformChargeTiersForCategory = (feeConfig, category) => {
  const categoryKey = normalizeCampaignCategoryKey(category);
  const conditionMap = parsePlatformChargeConditions(feeConfig?.platform_charge_conditions);
  const conditionTiers = categoryKey ? conditionMap[categoryKey] : null;

  if (Array.isArray(conditionTiers) && conditionTiers.length > 0) {
    return conditionTiers;
  }

  return parsePlatformChargeTiers(feeConfig?.platform_charge);
};

module.exports = {
  CATEGORY_LABELS,
  PLATFORM_CHARGE_CONDITION_KEYS,
  buildDefaultPlatformChargeConditions,
  isReviewRequiredCampaignCategory,
  normalizeCampaignCategory,
  normalizeCampaignCategoryKey,
  parsePlatformChargeConditions,
  parsePlatformChargeTiers,
  resolvePlatformChargeTiersForCategory,
};
