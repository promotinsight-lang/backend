const pool = require('../config/db');

const DEFAULT_PLATFORM_FIELDS = [
  { key: 'account_name', label: 'Account Name', type: 'text', required: true, placeholder: 'e.g. John Smith' },
  { key: 'profile_url', label: 'Profile URL', type: 'url', required: true, placeholder: 'https://www.amazon.com/gp/profile/...' },
];

const DEFAULT_GLOBAL_FIELDS = [
  { key: 'paypal_account', label: 'PayPal Email Address', type: 'email', required: true, placeholder: 'yourname@email.com' },
  { key: 'whatsapp_account', label: 'WhatsApp Number', type: 'tel', required: true, placeholder: '+1 555 123 4567' },
  { key: 'facebook_account', label: 'Facebook Profile URL', type: 'url', required: false, placeholder: 'https://facebook.com/your.profile' },
  { key: 'telegram_account', label: 'Telegram Username', type: 'text', required: false, placeholder: '@yourusername' },
];

const parseJsonArray = (val, fallback = []) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const parseJsonObject = (val, fallback = {}) => {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const platformKey = (country, platform) => `${String(country).trim()}|${String(platform).trim()}`;

const sanitizeFields = (fields) =>
  (Array.isArray(fields) ? fields : []).map((f, i) => ({
    key: String(f.key || `field_${i}`).trim().replace(/\s+/g, '_'),
    label: String(f.label || f.key || 'Field').trim(),
    type: ['text', 'email', 'url', 'tel'].includes(f.type) ? f.type : 'text',
    required: Boolean(f.required),
    placeholder: f.placeholder ? String(f.placeholder) : '',
  }));

const ensureGlobalConfigTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verification_global_config (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      platform_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    ALTER TABLE verification_global_config
    ADD COLUMN IF NOT EXISTS platform_fields JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
};

const getConfigRow = async () => {
  await ensureGlobalConfigTable();
  const result = await pool.query(
    'SELECT fields, platform_fields FROM verification_global_config WHERE id = 1'
  );
  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO verification_global_config (id, fields, platform_fields)
       VALUES (1, $1::jsonb, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(DEFAULT_GLOBAL_FIELDS)]
    );
    return { fields: DEFAULT_GLOBAL_FIELDS, platform_fields: {} };
  }
  const row = result.rows[0];
  const fields = parseJsonArray(row.fields, []);
  return {
    fields: fields.length ? fields : DEFAULT_GLOBAL_FIELDS,
    platform_fields: parseJsonObject(row.platform_fields, {}),
  };
};

const getGlobalFields = async () => {
  const { fields } = await getConfigRow();
  return fields;
};

const getPlatformFieldsMap = async () => {
  const { platform_fields } = await getConfigRow();
  return platform_fields;
};

const getPlatformFieldsFor = async (country, platform) => {
  const map = await getPlatformFieldsMap();
  const key = platformKey(country, platform);
  const stored = parseJsonArray(map[key], []);
  if (stored.length > 0) return stored;
  return DEFAULT_PLATFORM_FIELDS;
};

/** Public: countries, platforms, and field definitions for buyer verification form */
const getVerificationFormConfig = async (req, res) => {
  try {
    const globalFields = await getGlobalFields();
    const platformFieldsMap = await getPlatformFieldsMap();

    let feeRows;
    try {
      feeRows = await pool.query(
        `SELECT country, platform, verification_fields
         FROM dynamic_fees_config
         ORDER BY country ASC, platform ASC`
      );
    } catch {
      feeRows = await pool.query(
        `SELECT country, platform FROM dynamic_fees_config ORDER BY country ASC, platform ASC`
      );
    }

    const countryMap = {};
    for (const row of feeRows.rows) {
      const country = row.country;
      if (!countryMap[country]) {
        countryMap[country] = { country, platforms: [] };
      }

      const mapKey = platformKey(country, row.platform);
      let platformFields = parseJsonArray(platformFieldsMap[mapKey], []);
      if (platformFields.length === 0) {
        platformFields = parseJsonArray(row.verification_fields, []);
      }
      if (platformFields.length === 0) {
        platformFields = DEFAULT_PLATFORM_FIELDS.map((f) => ({
          ...f,
          label: `${row.platform} — ${f.label}`,
        }));
      }

      countryMap[country].platforms.push({
        platform: row.platform,
        fields: platformFields,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        global_fields: globalFields,
        countries: Object.values(countryMap),
      },
    });
  } catch (error) {
    console.error('getVerificationFormConfig:', error);
    return res.status(500).json({ success: false, message: 'Failed to load verification configuration.' });
  }
};

const getGlobalVerificationFields = async (req, res) => {
  try {
    const fields = await getGlobalFields();
    return res.status(200).json({ success: true, data: fields });
  } catch (error) {
    console.error('getGlobalVerificationFields:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateGlobalVerificationFields = async (req, res) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields)) {
      return res.status(400).json({ success: false, message: 'fields must be an array' });
    }

    const sanitized = sanitizeFields(fields);
    await ensureGlobalConfigTable();
    await pool.query(
      `INSERT INTO verification_global_config (id, fields, updated_at)
       VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(sanitized)]
    );

    return res.status(200).json({
      success: true,
      message: 'Global verification fields saved.',
      data: sanitized,
    });
  } catch (error) {
    console.error('updateGlobalVerificationFields:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getPlatformVerificationFields = async (req, res) => {
  try {
    const { country, platform } = req.query;
    if (!country || !platform) {
      return res.status(400).json({ success: false, message: 'country and platform are required' });
    }
    const fields = await getPlatformFieldsFor(country, platform);
    return res.status(200).json({ success: true, data: fields });
  } catch (error) {
    console.error('getPlatformVerificationFields:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updatePlatformVerificationFields = async (req, res) => {
  try {
    const { country, platform, fields } = req.body;
    if (!country || !platform) {
      return res.status(400).json({ success: false, message: 'country and platform are required' });
    }
    if (!Array.isArray(fields)) {
      return res.status(400).json({ success: false, message: 'fields must be an array' });
    }

    const sanitized = sanitizeFields(fields);
    const { fields: globalFields, platform_fields } = await getConfigRow();
    const updatedMap = { ...platform_fields, [platformKey(country, platform)]: sanitized };

    await ensureGlobalConfigTable();
    await pool.query(
      `INSERT INTO verification_global_config (id, fields, platform_fields, updated_at)
       VALUES (1, $1::jsonb, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         platform_fields = EXCLUDED.platform_fields,
         updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(globalFields), JSON.stringify(updatedMap)]
    );

    // Also try fee config column if it exists
    try {
      await pool.query(
        `UPDATE dynamic_fees_config SET verification_fields = $1::jsonb
         WHERE LOWER(country) = LOWER($2) AND LOWER(platform) = LOWER($3)`,
        [JSON.stringify(sanitized), country.trim(), platform.trim()]
      );
    } catch {
      /* column may not exist yet */
    }

    return res.status(200).json({
      success: true,
      message: `Verification fields saved for ${country} — ${platform}.`,
      data: sanitized,
    });
  } catch (error) {
    console.error('updatePlatformVerificationFields:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/** Used by fee upsert fallback when DB column is missing */
const savePlatformFieldsToStore = async (country, platform, fields) => {
  const sanitized = sanitizeFields(fields);
  const { fields: globalFields, platform_fields } = await getConfigRow();
  const updatedMap = { ...platform_fields, [platformKey(country, platform)]: sanitized };
  await ensureGlobalConfigTable();
  await pool.query(
    `INSERT INTO verification_global_config (id, fields, platform_fields, updated_at)
     VALUES (1, $1::jsonb, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       platform_fields = EXCLUDED.platform_fields,
       updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(globalFields), JSON.stringify(updatedMap)]
  );
  return sanitized;
};

module.exports = {
  getVerificationFormConfig,
  getGlobalVerificationFields,
  updateGlobalVerificationFields,
  getPlatformVerificationFields,
  updatePlatformVerificationFields,
  savePlatformFieldsToStore,
  parseJsonArray,
  DEFAULT_PLATFORM_FIELDS,
  getPlatformFieldsFor,
};
