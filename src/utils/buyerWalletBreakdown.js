const BUYER_REWARD_MIN_WITHDRAWAL_USD = 20;
const SIGNUP_BONUS_MIN_COMPLETED_ORDERS = 5;

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const getBuyerWalletBreakdown = async (db, userId) => {
  const transactionResult = await db.query(
    `SELECT type, status, description, amount
     FROM transactions
     WHERE user_id = $1`,
    [userId]
  );
  const completedResult = await db.query(
    "SELECT COUNT(*)::int AS completed_orders FROM applications WHERE user_id = $1 AND status = 'completed'",
    [userId]
  );

  let rewardCredits = 0;
  let signupBonusCredits = 0;
  let otherCredits = 0;
  let lockedWithdrawals = 0;
  const completedOrders = Number(completedResult.rows[0]?.completed_orders || 0);
  const signupBonusUnlocked = completedOrders >= SIGNUP_BONUS_MIN_COMPLETED_ORDERS;

  for (const row of transactionResult.rows) {
    const amount = toMoney(row.amount);
    const description = String(row.description || '').toLowerCase();
    if (
      row.type === 'refund' &&
      row.status === 'completed' &&
      !description.startsWith('refund for rejected withdrawal')
    ) {
      rewardCredits += amount;
    } else if (row.type === 'registration_bonus' && row.status === 'completed') {
      signupBonusCredits += amount;
    } else if (row.type === 'referral_bonus' && row.status === 'completed') {
      otherCredits += amount;
    } else if (row.type === 'withdrawal' && ['pending', 'completed'].includes(row.status)) {
      lockedWithdrawals += amount;
    }
  }

  let remainingWithdrawalSpend = lockedWithdrawals;
  let rewardSpent = 0;
  let signupSpent = 0;

  if (rewardCredits >= BUYER_REWARD_MIN_WITHDRAWAL_USD) {
    rewardSpent = Math.min(rewardCredits, remainingWithdrawalSpend);
    remainingWithdrawalSpend = Math.max(0, remainingWithdrawalSpend - rewardSpent);
  }

  if (signupBonusUnlocked) {
    signupSpent = Math.min(signupBonusCredits, remainingWithdrawalSpend);
    remainingWithdrawalSpend = Math.max(0, remainingWithdrawalSpend - signupSpent);
  }

  const otherSpent = Math.min(otherCredits, remainingWithdrawalSpend);
  remainingWithdrawalSpend = Math.max(0, remainingWithdrawalSpend - otherSpent);

  if (remainingWithdrawalSpend > 0) {
    const additionalRewardSpend = Math.min(rewardCredits - rewardSpent, remainingWithdrawalSpend);
    rewardSpent += additionalRewardSpend;
    remainingWithdrawalSpend = Math.max(0, remainingWithdrawalSpend - additionalRewardSpend);
  }

  if (remainingWithdrawalSpend > 0) {
    const additionalSignupSpend = Math.min(signupBonusCredits - signupSpent, remainingWithdrawalSpend);
    signupSpent += additionalSignupSpend;
  }

  const rewardBalance = Math.max(0, rewardCredits - rewardSpent);
  const signupBonusBalance = Math.max(0, signupBonusCredits - signupSpent);
  const otherBalance = Math.max(0, otherCredits - otherSpent);

  const rewardWithdrawable = rewardBalance >= BUYER_REWARD_MIN_WITHDRAWAL_USD ? rewardBalance : 0;
  const signupBonusWithdrawable =
    signupBonusUnlocked ? signupBonusBalance : 0;
  const withdrawableBalance = rewardWithdrawable + signupBonusWithdrawable + otherBalance;

  return {
    reward_balance: Number(rewardBalance.toFixed(2)),
    signup_bonus_balance: Number(signupBonusBalance.toFixed(2)),
    other_bonus_balance: Number(otherBalance.toFixed(2)),
    completed_orders: completedOrders,
    reward_min_withdrawal: BUYER_REWARD_MIN_WITHDRAWAL_USD,
    signup_bonus_min_completed_orders: SIGNUP_BONUS_MIN_COMPLETED_ORDERS,
    signup_bonus_unlocked: signupBonusUnlocked,
    withdrawable_balance: Number(withdrawableBalance.toFixed(2)),
  };
};

module.exports = {
  BUYER_REWARD_MIN_WITHDRAWAL_USD,
  SIGNUP_BONUS_MIN_COMPLETED_ORDERS,
  getBuyerWalletBreakdown,
};
