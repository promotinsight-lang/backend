ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS order_total_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS order_paypal_address TEXT;
