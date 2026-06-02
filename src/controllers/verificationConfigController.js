const pool = require('../config/db');

const DEFAULT_PLATFORM_FIELDS = [
  { key: 'account_name', label: 'Account Name', type: 'text', required: true, placeholder: 'Shopping account name' },
  { key: 'profile_url', label: 'Profile URL', type: 'url', required: true, placeholder: 'Profile URL on this platform' },
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

const ensureGlobalConfigTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verification_global_config (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const DEFAULT_GLOBAL_FIELDS = [
  { key: 'paypal_account', label: 'PayPal Email Address', type: 'email', required: true, placeholder: 'PayPal Email Address' },
  { key: 'whatsapp_account', label: 'WhatsApp Number', type: 'text', required: true, placeholder: 'WhatsApp Number (with country code)' },
  { key: 'facebook_account', label: 'Facebook Profile URL', type: 'url', required: false, placeholder: 'Facebook Profile URL' },
  { key: 'telegram_account', label: 'Telegram Username', type: 'text', required: false, placeholder: 'Telegram Username (@username)' },
];

const getGlobalFields = async () => {
  await ensureGlobalConfigTable();
  const result = await pool.query('SELECT fields FROM verification_global_config WHERE id = 1');
  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO verification_global_config (id, fields) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(DEFAULT_GLOBAL_FIELDS)]
    );
    return DEFAULT_GLOBAL_FIELDS;
  }
  const fields = parseJsonArray(result.rows[0].fields, []);
  return fields.length ? fields : DEFAULT_GLOBAL_FIELDS;
};

/** Public: countries, platforms, and field definitions for buyer verification form */
const getVerificationFormConfig = async (req, res) => {
  try {
    const globalFields = await getGlobalFields();

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
      let platformFields = parseJsonArray(row.verification_fields, []);
      if (platformFields.length === 0) {
        platformFields = DEFAULT_PLATFORM_FIELDS.map((f) => ({
          ...f,
          label: `${row.platform} ${f.label}`,
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

/** Admin: get global field catalog */
const getGlobalVerificationFields = async (req, res) => {
  try {
    const fields = await getGlobalFields();
    return res.status(200).json({ success: true, data: fields });
  } catch (error) {
    console.error('getGlobalVerificationFields:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/** Admin: replace global field catalog */
const updateGlobalVerificationFields = async (req, res) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields)) {
      return res.status(400).json({ success: false, message: 'fields must be an array' });
    }

    const sanitized = fields.map((f, i) => ({
      key: String(f.key || `field_${i}`).trim(),
      label: String(f.label || f.key || 'Field').trim(),
      type: ['text', 'email', 'url', 'tel'].includes(f.type) ? f.type : 'text',
      required: Boolean(f.required),
      placeholder: f.placeholder ? String(f.placeholder) : '',
    }));

    await ensureGlobalConfigTable();
    await pool.query(
      `INSERT INTO verification_global_config (id, fields, updated_at)
       VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(sanitized)]
    );

    return res.status(200).json({ success: true, message: 'Global verification fields saved.', data: sanitized });
  } catch (error) {
    console.error('updateGlobalVerificationFields:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getVerificationFormConfig,
  getGlobalVerificationFields,
  updateGlobalVerificationFields,
  parseJsonArray,
  DEFAULT_PLATFORM_FIELDS,
};
