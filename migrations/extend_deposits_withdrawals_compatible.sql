-- ===== EXTEND EXISTING TABLES (Backward Compatible) =====

-- ===== UPDATE DEPOSITS TABLE =====
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100) DEFAULT 'Bank Transfer';
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS crypto_address VARCHAR(255);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS crypto_network VARCHAR(100);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS crypto_memo VARCHAR(255);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS is_crypto BOOLEAN DEFAULT FALSE;

UPDATE deposits SET payment_method = 'Bank Transfer' WHERE payment_method IS NULL OR payment_method = '';

-- ===== UPDATE WITHDRAWALS TABLE =====
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100) DEFAULT 'Bank Transfer';
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS crypto_address VARCHAR(255);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS crypto_network VARCHAR(100);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS crypto_memo VARCHAR(255);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS is_crypto BOOLEAN DEFAULT FALSE;

UPDATE withdrawals SET payment_method = 'Bank Transfer' WHERE payment_method IS NULL OR payment_method = '';

-- ===== ADD INDICES =====
CREATE INDEX IF NOT EXISTS idx_deposits_payment_method ON deposits(payment_method);
CREATE INDEX IF NOT EXISTS idx_withdrawals_payment_method ON withdrawals(payment_method);