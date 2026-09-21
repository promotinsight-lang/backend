const pool = require("../config/db");

const ensureSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT,
      role VARCHAR(50) NOT NULL DEFAULT 'buyer',
      verification_status VARCHAR(50) NOT NULL DEFAULT 'unverified',
      wallet_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
      loan_credit_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
      loan_credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
      product_purchase_limit INTEGER NOT NULL DEFAULT 3,
      product_price_limit NUMERIC(12, 2) NOT NULL DEFAULT 50,
      trust_score NUMERIC(3, 1) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_frozen BOOLEAN NOT NULL DEFAULT false,
      auth_provider VARCHAR(50),
      firebase_uid TEXT,
      last_ip TEXT,
      ip_location TEXT,
      location_label TEXT,
      referral_code VARCHAR(100) UNIQUE,
      referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completed_orders INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      image_url TEXT,
      product_name TEXT NOT NULL,
      price NUMERIC(12, 2) NOT NULL DEFAULT 0,
      store_name TEXT,
      search_keyword TEXT,
      reward NUMERIC(12, 2) NOT NULL DEFAULT 0,
      product_link TEXT,
      country VARCHAR(100),
      required_orders INTEGER NOT NULL DEFAULT 1,
      instructions TEXT,
      seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      platform VARCHAR(100),
      category VARCHAR(100),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      total_deposit NUMERIC(12, 2) NOT NULL DEFAULT 0,
      platform_fee_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      order_number TEXT,
      order_total_amount NUMERIC(12, 2),
      order_paypal_address TEXT,
      order_submitted_at TIMESTAMP,
      order_comment TEXT,
      screenshot_url TEXT,
      screenshot_url_2 TEXT,
      review_link TEXT,
      review_screenshot_url TEXT,
      review_screenshot_url_2 TEXT,
      review_submitted_at TIMESTAMP,
      refund_screenshot_url TEXT,
      refund_order_number TEXT,
      refund_comment TEXT,
      seller_payment_transaction_id TEXT,
      seller_payment_screenshot_url TEXT,
      seller_payment_note TEXT,
      seller_paid_at TIMESTAMP,
      loan_payment_transaction_id TEXT,
      loan_payment_screenshot_url TEXT,
      loan_payment_amount NUMERIC(12, 2),
      loan_payment_note TEXT,
      loan_paid_at TIMESTAMP,
      ip_address TEXT,
      ip_location TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      type VARCHAR(100) NOT NULL,
      description TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'completed',
      reference_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      payment_method TEXT,
      transaction_id TEXT,
      screenshot_url TEXT,
      account_details TEXT,
      crypto_address TEXT,
      crypto_network TEXT,
      crypto_memo TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      payment_method TEXT,
      account_details TEXT,
      crypto_address TEXT,
      crypto_network TEXT,
      crypto_memo TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      transaction_id TEXT,
      screenshot_url TEXT,
      transaction_reference TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dynamic_fees_config (
      id SERIAL PRIMARY KEY,
      country VARCHAR(100) NOT NULL,
      platform VARCHAR(100) NOT NULL,
      exchange_rate NUMERIC(12, 4) NOT NULL DEFAULT 1,
      buyer_reward NUMERIC(12, 2) NOT NULL DEFAULT 0,
      seller_withdrawal_fee NUMERIC(6, 4) NOT NULL DEFAULT 0,
      platform_charge_type VARCHAR(50) DEFAULT 'fixed',
      platform_charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      platform_charge_percentage NUMERIC(6, 4) NOT NULL DEFAULT 0,
      platform_charge_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      buyer_reward_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      verification_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(country, platform)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      referred_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      reward_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appeals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
      appeal_type VARCHAR(100),
      reason TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      admin_response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_replies (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_chat_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_chat_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      ended_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_chat_messages (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES private_chat_sessions(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_method_networks (
      id SERIAL PRIMARY KEY,
      payment_method_id INTEGER REFERENCES payment_methods(id) ON DELETE CASCADE,
      network_name VARCHAR(100) NOT NULL,
      fee_type VARCHAR(50),
      fee_amount NUMERIC(12, 2) DEFAULT 0,
      fee_percentage NUMERIC(6, 4) DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_settings (
      id SERIAL PRIMARY KEY,
      method_name VARCHAR(100) NOT NULL,
      account_details TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      ADD COLUMN IF NOT EXISTS loan_credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS product_purchase_limit INTEGER NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS product_price_limit NUMERIC(12, 2) NOT NULL DEFAULT 50,
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
      ADD COLUMN IF NOT EXISTS seller_paid_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS loan_payment_transaction_id TEXT,
      ADD COLUMN IF NOT EXISTS loan_payment_screenshot_url TEXT,
      ADD COLUMN IF NOT EXISTS loan_payment_amount NUMERIC(12, 2),
      ADD COLUMN IF NOT EXISTS loan_payment_note TEXT,
      ADD COLUMN IF NOT EXISTS loan_paid_at TIMESTAMP
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
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference_id
      ON transactions(reference_id)
      WHERE reference_id IS NOT NULL
  `);

};

module.exports = ensureSchema;

