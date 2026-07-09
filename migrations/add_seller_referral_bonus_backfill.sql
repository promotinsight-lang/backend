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
WHERE u.id = credited_users.user_id;
