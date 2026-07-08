const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getAutomaticUserRank = ({
  completed_orders = 0,
  failed_orders = 0,
  total_ranked_orders = 0,
  trust_score = 0,
} = {}) => {
  const completed = toNumber(completed_orders);
  const failed = toNumber(failed_orders);
  const total = toNumber(total_ranked_orders) || completed + failed;
  const trust = Math.max(0, Math.min(5, toNumber(trust_score)));
  const successRate = total > 0 ? completed / total : 0;
  const rankScore = Math.max(0, completed * 10 - failed * 5 + trust * 4);

  if (completed <= 0) return "New User";
  if (completed >= 100 && successRate >= 0.95 && rankScore >= 1000) return "Elite Performer";
  if (completed >= 50 && successRate >= 0.9 && rankScore >= 500) return "Top Rated";
  if (completed >= 20 && successRate >= 0.85 && rankScore >= 200) return "Trusted";
  if (completed >= 5 && successRate >= 0.75 && rankScore >= 50) return "Reliable";
  return "Rising Star";
};

const addAutomaticRank = (user) => ({
  ...user,
  user_rank: getAutomaticUserRank(user),
});

module.exports = {
  addAutomaticRank,
  getAutomaticUserRank,
};
