-- Security hardening columns for social auth and withdrawal transaction tracking.

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_transaction_reference
  ON withdrawals(transaction_reference)
  WHERE transaction_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference_id
  ON transactions(reference_id)
  WHERE reference_id IS NOT NULL;

-- Backfill legacy pending withdrawals with deterministic per-row references.
UPDATE withdrawals
SET transaction_reference = 'withdrawal:' || id || ':' || md5(random()::text || clock_timestamp()::text)
WHERE status = 'pending'
  AND transaction_reference IS NULL;

-- Link only unambiguous legacy pending withdrawal transactions.
-- If a user has multiple pending withdrawals with the same amount, or multiple matching
-- pending transactions, leave reference_id NULL so the controller requires manual review.
WITH candidate_pairs AS (
  SELECT
    w.id AS withdrawal_id,
    t.id AS transaction_id,
    COUNT(*) OVER (PARTITION BY w.id) AS withdrawal_match_count,
    COUNT(*) OVER (PARTITION BY t.id) AS transaction_match_count
  FROM withdrawals w
  JOIN transactions t
    ON t.user_id = w.user_id
   AND t.amount = w.amount
   AND t.type = 'withdrawal'
   AND t.status = 'pending'
   AND t.reference_id IS NULL
  WHERE w.status = 'pending'
    AND w.transaction_reference IS NOT NULL
)
UPDATE transactions t
SET reference_id = w.transaction_reference
FROM candidate_pairs cp
JOIN withdrawals w ON w.id = cp.withdrawal_id
WHERE t.id = cp.transaction_id
  AND cp.withdrawal_match_count = 1
  AND cp.transaction_match_count = 1
  AND t.reference_id IS NULL;
