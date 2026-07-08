ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS seller_payment_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS seller_payment_screenshot_url TEXT,
  ADD COLUMN IF NOT EXISTS seller_payment_note TEXT,
  ADD COLUMN IF NOT EXISTS seller_paid_at TIMESTAMP;
