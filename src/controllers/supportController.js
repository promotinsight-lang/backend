const pool = require('../config/db');

// ==========================================
// 1. Create a New Ticket (Buyer/Seller) - 🔥 SECURED
// ==========================================
const createTicket = async (req, res) => {
  try {
    const { subject, message } = req.body;
    const userId = req.user.id;

    if (!subject || !subject.trim() || !message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Subject and message are required' });
    }

    const result = await pool.query(
      `INSERT INTO support_tickets (user_id, subject, message, status) 
       VALUES ($1, $2, $3, 'open') RETURNING *`,
      [userId, subject.trim(), message.trim()]
    );

    res.status(201).json({ success: true, message: 'Support ticket created successfully', data: result.rows[0] });
  } catch (error) {
    console.error('CREATE TICKET ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 2. Get My Tickets (For Logged in Buyer/Seller)
// ==========================================
const getMyTickets = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('GET MY TICKETS ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 3. Get All Tickets (For Admin)
// ==========================================
const getAllTickets = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.name as user_name, u.email as user_email, u.role as user_role 
       FROM support_tickets t 
       JOIN users u ON t.user_id = u.id 
       ORDER BY t.updated_at DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('GET ALL TICKETS ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 4. Get Single Ticket Details & Replies (Admin or Ticket Owner)
// ==========================================
const getTicketDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Fetch the main ticket
    const ticketQuery = await pool.query(
      `SELECT t.*, u.name as user_name, u.role as user_role 
       FROM support_tickets t JOIN users u ON t.user_id = u.id WHERE t.id = $1`, 
      [id]
    );

    if (ticketQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const ticket = ticketQuery.rows[0];

    // Check Authorization: Only Admin or the Ticket Owner can view
    if (userRole !== 'admin' && ticket.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this ticket' });
    }

    // Fetch replies for this ticket
    const repliesQuery = await pool.query(
      `SELECT r.*, u.name as user_name, u.role as user_role 
       FROM ticket_replies r JOIN users u ON r.user_id = u.id 
       WHERE r.ticket_id = $1 ORDER BY r.created_at ASC`, 
      [id]
    );

    res.status(200).json({ success: true, data: { ticket, replies: repliesQuery.rows } });
  } catch (error) {
    console.error('GET TICKET DETAILS ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 5. Add a Reply to a Ticket - 🔥 SECURED TRANSACTION
// ==========================================
const replyToTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params; // ticket_id
    const { message } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Reply message is required' });
    }

    await client.query('BEGIN');

    // Lock ticket to prevent concurrent status updates
    const ticketCheck = await client.query('SELECT user_id, status FROM support_tickets WHERE id = $1 FOR UPDATE', [id]);
    if (ticketCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    
    const ticket = ticketCheck.rows[0];

    // Prevent replies on closed tickets
    if (ticket.status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot reply to a closed ticket' });
    }

    // Authorization
    if (userRole !== 'admin' && ticket.user_id !== userId) {
       await client.query('ROLLBACK');
       return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Insert the reply
    const replyResult = await client.query(
      `INSERT INTO ticket_replies (ticket_id, user_id, message) VALUES ($1, $2, $3) RETURNING id`,
      [id, userId, message.trim()]
    );

    // Update ticket status dynamically (If admin replies -> answered, if user replies -> open)
    const newStatus = userRole === 'admin' ? 'answered' : 'open';
    await client.query(
      `UPDATE support_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newStatus, id]
    );

    await client.query('COMMIT');

    // Fetch the new reply outside of the transaction lock to send back to frontend
    const finalReply = await pool.query(
       `SELECT r.*, u.name as user_name, u.role as user_role FROM ticket_replies r JOIN users u ON r.user_id = u.id WHERE r.id = $1`,
       [replyResult.rows[0].id]
    );

    res.status(201).json({ success: true, message: 'Reply sent successfully', data: finalReply.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('REPLY TICKET ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
};

// ==========================================
// 6. Close a Ticket - 🔥 SECURED
// ==========================================
const closeTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const ticketCheck = await pool.query('SELECT user_id, status FROM support_tickets WHERE id = $1', [id]);
    if (ticketCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'Ticket not found' });

    if (ticketCheck.rows[0].status === 'closed') {
      return res.status(400).json({ success: false, message: 'Ticket is already closed' });
    }

    // Authorization
    if (userRole !== 'admin' && ticketCheck.rows[0].user_id !== userId) {
       return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await pool.query(`UPDATE support_tickets SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

    res.status(200).json({ success: true, message: 'Ticket closed successfully' });
  } catch (error) {
    console.error('CLOSE TICKET ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketDetails,
  replyToTicket,
  closeTicket
};