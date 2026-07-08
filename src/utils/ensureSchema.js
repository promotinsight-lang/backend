const pool = require("../config/db");

const ensureSchema = async () => {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS user_rank VARCHAR(100) DEFAULT 'New User',
      ADD COLUMN IF NOT EXISTS amazon_location TEXT,
      ADD COLUMN IF NOT EXISTS amazon_account TEXT,
      ADD COLUMN IF NOT EXISTS amazon_profile_url TEXT,
      ADD COLUMN IF NOT EXISTS paypal_account TEXT,
      ADD COLUMN IF NOT EXISTS facebook_account TEXT,
      ADD COLUMN IF NOT EXISTS whatsapp_account TEXT,
      ADD COLUMN IF NOT EXISTS telegram_account TEXT,
      ADD COLUMN IF NOT EXISTS verification_country TEXT,
      ADD COLUMN IF NOT EXISTS verification_platforms JSONB,
      ADD COLUMN IF NOT EXISTS verification_responses JSONB
  `);

  await pool.query(`
    ALTER TABLE applications
      ADD COLUMN IF NOT EXISTS seller_payment_transaction_id TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_screenshot_url TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_note TEXT,
      ADD COLUMN IF NOT EXISTS seller_paid_at TIMESTAMP
  `);
};

module.exports = ensureSchema;
