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
      ADD COLUMN IF NOT EXISTS order_total_amount NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS order_paypal_address TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_transaction_id TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_screenshot_url TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_note TEXT,
      ADD COLUMN IF NOT EXISTS seller_paid_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference_id
      ON transactions(reference_id)
      WHERE reference_id IS NOT NULL
  `);

  await pool.query(`
    WITH missing_rewards AS (
      SELECT
        a.id AS application_id,
        a.user_id,
        COALESCE(p.reward, 0)::numeric AS reward_amount
      FROM applications a
      JOIN products p ON a.product_id = p.id
      WHERE a.status = 'completed'
        AND a.seller_payment_transaction_id IS NOT NULL
        AND COALESCE(p.reward, 0)::numeric > 0
        AND NOT EXISTS (
          SELECT 1
          FROM transactions t
          WHERE t.reference_id = CONCAT('seller_reward_', a.id)
        )
    ),
    inserted_rewards AS (
      INSERT INTO transactions (user_id, amount, type, description, status, reference_id)
      SELECT
        user_id,
        reward_amount,
        'refund',
        CONCAT('Buyer reward for seller-paid Application #', application_id),
        'completed',
        CONCAT('seller_reward_', application_id)
      FROM missing_rewards
      ON CONFLICT DO NOTHING
      RETURNING user_id, amount
    ),
    credited_users AS (
      SELECT user_id, SUM(amount) AS amount
      FROM inserted_rewards
      GROUP BY user_id
    )
    UPDATE users u
    SET wallet_balance = COALESCE(u.wallet_balance, 0) + credited_users.amount
    FROM credited_users
    WHERE u.id = credited_users.user_id
  `);
};

module.exports = ensureSchema;
