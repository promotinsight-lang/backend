-- Buyer verification: global fields + per country/platform fields on fee config
CREATE TABLE IF NOT EXISTS verification_global_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO verification_global_config (id, fields)
VALUES (
  1,
  '[
    {"key":"paypal_account","label":"PayPal Email Address","type":"email","required":true,"placeholder":"PayPal Email Address"},
    {"key":"whatsapp_account","label":"WhatsApp Number","type":"text","required":true,"placeholder":"WhatsApp Number (with country code)"},
    {"key":"facebook_account","label":"Facebook Profile URL","type":"url","required":false,"placeholder":"Facebook Profile URL"},
    {"key":"telegram_account","label":"Telegram Username","type":"text","required":false,"placeholder":"Telegram Username (@username)"}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE dynamic_fees_config
  ADD COLUMN IF NOT EXISTS verification_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_country VARCHAR(255),
  ADD COLUMN IF NOT EXISTS verification_platforms JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_responses JSONB DEFAULT '{}'::jsonb;
