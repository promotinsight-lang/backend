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
      ADD COLUMN IF NOT EXISTS verification_responses JSONB,
      ADD COLUMN IF NOT EXISTS geo_latitude NUMERIC(10, 7),
      ADD COLUMN IF NOT EXISTS geo_longitude NUMERIC(10, 7),
      ADD COLUMN IF NOT EXISTS geo_accuracy NUMERIC(10, 2),
      ADD COLUMN IF NOT EXISTS geo_location_label TEXT,
      ADD COLUMN IF NOT EXISTS geo_source VARCHAR(50)
  `);

  await pool.query(`
    ALTER TABLE applications
      ADD COLUMN IF NOT EXISTS order_total_amount NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS order_paypal_address TEXT,
      ADD COLUMN IF NOT EXISTS order_submitted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS review_submitted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS seller_payment_transaction_id TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_screenshot_url TEXT,
      ADD COLUMN IF NOT EXISTS seller_payment_note TEXT,
      ADD COLUMN IF NOT EXISTS seller_paid_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE withdrawals
      ADD COLUMN IF NOT EXISTS transaction_reference TEXT
  `);

  await pool.query(`
    UPDATE applications
    SET order_submitted_at = COALESCE(updated_at, created_at)
    WHERE order_submitted_at IS NULL
      AND order_number IS NOT NULL
  `);

  await pool.query(`
    UPDATE applications
    SET review_submitted_at = COALESCE(updated_at, created_at)
    WHERE review_submitted_at IS NULL
      AND (
        review_link IS NOT NULL
        OR review_screenshot_url IS NOT NULL
        OR review_screenshot_url_2 IS NOT NULL
      )
  `);

  await pool.query(`
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE dynamic_fees_config
      ADD COLUMN IF NOT EXISTS platform_charge_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS buyer_reward_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS verification_fields JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

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

  await pool.query(`
    WITH eligible_seller_referrals AS (
      SELECT
        r.referrer_id,
        r.referred_id,
        GREATEST(COALESCE(r.reward_amount, 0), 15)::numeric AS reward_amount
      FROM referrals r
      JOIN users referrer ON referrer.id = r.referrer_id AND referrer.role = 'buyer'
      JOIN users referred_seller ON referred_seller.id = r.referred_id AND referred_seller.role = 'seller'
      JOIN products p ON p.seller_id = referred_seller.id
      JOIN applications a ON a.product_id = p.id AND a.status = 'completed'
      WHERE r.status = 'pending'
      GROUP BY r.referrer_id, r.referred_id, r.reward_amount
      HAVING COUNT(a.id) >= 5
    ),
    updated_referrals AS (
      UPDATE referrals r
      SET status = 'completed',
          reward_amount = eligible_seller_referrals.reward_amount,
          updated_at = CURRENT_TIMESTAMP
      FROM eligible_seller_referrals
      WHERE r.referrer_id = eligible_seller_referrals.referrer_id
        AND r.referred_id = eligible_seller_referrals.referred_id
        AND r.status = 'pending'
      RETURNING r.referrer_id, r.referred_id, r.reward_amount
    ),
    inserted_bonus AS (
      INSERT INTO transactions (user_id, amount, type, description, status)
      SELECT
        referrer_id,
        reward_amount,
        'referral_bonus',
        CONCAT('Seller referral bonus after referred seller #', referred_id, ' completed 5 orders'),
        'completed'
      FROM updated_referrals
      RETURNING user_id, amount
    ),
    credited_users AS (
      SELECT user_id, SUM(amount) AS amount
      FROM inserted_bonus
      GROUP BY user_id
    )
    UPDATE users u
    SET wallet_balance = COALESCE(u.wallet_balance, 0) + credited_users.amount
    FROM credited_users
    WHERE u.id = credited_users.user_id
  `);
};

module.exports = ensureSchema;
