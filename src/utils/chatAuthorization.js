const pool = require("../config/db");

const getAuthorizedChatSession = async (
  sessionId,
  user,
  { requireActive = false, requireAssignedAdmin = false } = {}
) => {
  if (!sessionId || !user?.id || !user?.role) return null;

  const result = await pool.query(
    `SELECT id, user_id, admin_user_id, status
     FROM private_chat_sessions
     WHERE id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) return null;

  const session = result.rows[0];
  if (requireActive && session.status !== "active") return null;

  const userId = String(user.id);
  const role = String(user.role).trim().toLowerCase();
  const isOwner = String(session.user_id) === userId;
  const isAssignedAdmin = String(session.admin_user_id) === userId;

  if (role === "admin") {
    return requireAssignedAdmin && !isAssignedAdmin ? null : session;
  }

  return isOwner ? session : null;
};

module.exports = { getAuthorizedChatSession };
