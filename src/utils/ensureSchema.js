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
      ADD COLUMN IF NOT EXISTS loan_credit_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS blogs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      content TEXT NOT NULL,
      image_url TEXT,
      author_name TEXT DEFAULT 'Admin',
      is_published BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE blogs
      ADD COLUMN IF NOT EXISTS excerpt TEXT,
      ADD COLUMN IF NOT EXISTS meta_title TEXT,
      ADD COLUMN IF NOT EXISTS meta_description TEXT,
      ADD COLUMN IF NOT EXISTS primary_keyword TEXT,
      ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
      ADD COLUMN IF NOT EXISTS category_slug VARCHAR(255),
      ADD COLUMN IF NOT EXISTS author_slug VARCHAR(255),
      ADD COLUMN IF NOT EXISTS author_title TEXT,
      ADD COLUMN IF NOT EXISTS author_bio TEXT,
      ADD COLUMN IF NOT EXISTS featured_image_alt TEXT,
      ADD COLUMN IF NOT EXISTS canonical_url TEXT,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS related_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS featured_image_width INTEGER DEFAULT 1200,
      ADD COLUMN IF NOT EXISTS featured_image_height INTEGER DEFAULT 630
  `);

  await pool.query(`
    UPDATE blogs
    SET
      status = CASE WHEN COALESCE(is_published, true) = true THEN 'published' ELSE 'draft' END,
      published_at = CASE
        WHEN COALESCE(is_published, true) = true THEN COALESCE(published_at, created_at, CURRENT_TIMESTAMP)
        ELSE published_at
      END,
      category_slug = COALESCE(category_slug, 'general'),
      author_slug = COALESCE(author_slug, LOWER(REGEXP_REPLACE(COALESCE(author_name, 'admin'), '[^a-zA-Z0-9]+', '-', 'g'))),
      featured_image_alt = COALESCE(featured_image_alt, title),
      meta_title = COALESCE(meta_title, title),
      meta_description = COALESCE(meta_description, excerpt, LEFT(REGEXP_REPLACE(COALESCE(content, ''), '<[^>]+>', '', 'g'), 155))
    WHERE status IS NULL
       OR category_slug IS NULL
       OR author_slug IS NULL
       OR featured_image_alt IS NULL
       OR meta_title IS NULL
       OR meta_description IS NULL
       OR (COALESCE(is_published, true) = true AND published_at IS NULL)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_blogs_status_published_at
      ON blogs(status, published_at DESC)
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
};

module.exports = ensureSchema;

