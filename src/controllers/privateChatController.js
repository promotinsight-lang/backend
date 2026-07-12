const pool = require('../config/db');
const { getAuthorizedChatSession } = require('../utils/chatAuthorization');

// ==========================================
// 1. Request Private Chat (Verified User)
// ==========================================
const requestChat = async (req, res) => {
  try {
    const userId = req.user.id;

    // চেক করা হচ্ছে ইউজারের আগে থেকেই কোনো পেন্ডিং রিকোয়েস্ট বা অ্যাক্টিভ সেশন আছে কি না
    const existingReq = await pool.query(
      `SELECT id FROM private_chat_requests WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );
    if (existingReq.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'You already have a pending chat request.' });
    }

    const activeSession = await pool.query(
      `SELECT id FROM private_chat_sessions WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    if (activeSession.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'You already have an active chat session.' });
    }

    // নতুন রিকোয়েস্ট তৈরি করা
    const result = await pool.query(
      `INSERT INTO private_chat_requests (user_id, status) VALUES ($1, 'pending') RETURNING *`,
      [userId]
    );

    res.status(201).json({ success: true, message: 'Chat request submitted successfully', data: result.rows[0] });
  } catch (error) {
    console.error('REQUEST CHAT ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 2. Get My Chat Status (Logged in User)
// ==========================================
const getMyChatStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const pendingRequest = await pool.query(
      `SELECT * FROM private_chat_requests WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
      [userId]
    );

    const activeSession = await pool.query(
      `SELECT * FROM private_chat_sessions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId]
    );

    res.status(200).json({
      success: true,
      pendingRequest: pendingRequest.rows[0] || null,
      activeSession: activeSession.rows[0] || null
    });
  } catch (error) {
    console.error('GET CHAT STATUS ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 3. Get Pending Requests (Admin Only)
// ==========================================
const getPendingChatRequests = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.status, r.created_at, u.id as user_id, u.name, u.email, u.verification_status 
      FROM private_chat_requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('GET PENDING REQUESTS ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 4. Approve Chat Request (Admin Only)
// ==========================================
const approveChatRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params; // Request ID
    const adminId = req.user.id;

    await client.query('BEGIN');

    // রিকোয়েস্ট চেক করা
    const requestCheck = await client.query(`SELECT * FROM private_chat_requests WHERE id = $1 FOR UPDATE`, [id]);
    if (requestCheck.rows.length === 0 || requestCheck.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Request not found or already processed' });
    }

    const userId = requestCheck.rows[0].user_id;

    // রিকোয়েস্ট অ্যাপ্রুভ করা
    await client.query(`UPDATE private_chat_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    // নতুন অ্যাক্টিভ সেশন তৈরি করা
    const sessionResult = await client.query(
      `INSERT INTO private_chat_sessions (user_id, admin_user_id, status) VALUES ($1, $2, 'active') RETURNING *`,
      [userId, adminId]
    );

    await client.query('COMMIT');

    const io = req.app.get('io') || global.io;
    if (io) {
      io.to(`user_${userId}`).emit('private_chat_approved', {
        userId,
        requestId: id,
        session: sessionResult.rows[0],
      });
    }

    res.status(200).json({ success: true, message: 'Chat approved and session started', session: sessionResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('APPROVE CHAT ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
};

// ==========================================
// 5. Reject Chat Request (Admin Only)
// ==========================================
const rejectChatRequest = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE private_chat_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
    res.status(200).json({ success: true, message: 'Chat request rejected' });
  } catch (error) {
    console.error('REJECT CHAT ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 6. Admin Starts Chat Directly (Admin Only)
// ==========================================
const adminStartChatWithUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const adminId = req.user.id;

    if (!userId) return res.status(400).json({ success: false, message: 'User ID is required' });

    // চেক করা হচ্ছে আগে থেকেই কোনো অ্যাক্টিভ সেশন আছে কি না
    const existingSession = await pool.query(
      `SELECT * FROM private_chat_sessions WHERE user_id = $1 AND admin_user_id = $2 AND status = 'active'`,
      [userId, adminId]
    );

    if (existingSession.rows.length > 0) {
      return res.status(200).json({ success: true, message: 'Session already active', session: existingSession.rows[0] });
    }

    const otherAdminSession = await pool.query(
      `SELECT id FROM private_chat_sessions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId]
    );

    if (otherAdminSession.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This user already has an active chat session assigned to another admin.'
      });
    }

    const sessionResult = await pool.query(
      `INSERT INTO private_chat_sessions (user_id, admin_user_id, status) VALUES ($1, $2, 'active') RETURNING *`,
      [userId, adminId]
    );

    const io = req.app.get('io') || global.io;
    if (io) {
      io.to(`user_${userId}`).emit('private_chat_approved', {
        userId,
        session: sessionResult.rows[0],
        startedDirectly: true,
      });
    }

    res.status(201).json({ success: true, message: 'Chat session started directly', session: sessionResult.rows[0] });
  } catch (error) {
    console.error('ADMIN START CHAT ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 7. End Chat Session (Admin Only)
// ==========================================
const adminEndChat = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await getAuthorizedChatSession(sessionId, req.user, {
      requireAssignedAdmin: true,
    });

    if (!session) {
      return res.status(403).json({ success: false, message: 'Not authorized to end this chat session.' });
    }

    if (session.status === 'ended') return res.status(400).json({ success: false, message: 'Session already ended' });

    await pool.query(
      `UPDATE private_chat_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [session.id]
    );

    res.status(200).json({ success: true, message: 'Chat session ended successfully' });
  } catch (error) {
    console.error('END CHAT ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 8. Get Session Messages (Both)
// ==========================================
const getSessionMessages = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await getAuthorizedChatSession(sessionId, req.user);

    if (!session) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this chat session.' });
    }
    
    const messages = await pool.query(
      `SELECT m.*, u.name as sender_name, u.role as sender_role 
       FROM private_chat_messages m
       JOIN users u ON m.sender_user_id = u.id
       WHERE m.session_id = $1
       ORDER BY m.created_at ASC`,
      [sessionId]
    );

    res.status(200).json({ success: true, data: messages.rows });
  } catch (error) {
    console.error('GET MESSAGES ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  requestChat,
  getMyChatStatus,
  getPendingChatRequests,
  approveChatRequest,
  rejectChatRequest,
  adminStartChatWithUser,
  adminEndChat,
  getSessionMessages
};
