const pool = require('../config/db');

// ==========================================
// 1. Submit Account Ban Appeal (Original Logic)
// ==========================================
exports.submitAppeal = async (req, res) => {
  try {
    const userId = req.user.id; 
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Appeal reason is required.' });
    }

    const existingAppeal = await pool.query(
      'SELECT * FROM appeals WHERE user_id = $1 AND status = $2',
      [userId, 'pending']
    );

    if (existingAppeal.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending appeal. Please wait for the admin to review it.'
      });
    }

    const newAppeal = await pool.query(
      `INSERT INTO appeals (user_id, appeal_type, reason, status) 
       VALUES ($1, 'account_ban', $2, 'pending') RETURNING *`,
      [userId, reason.trim()]
    );

    res.status(201).json({
      success: true,
      message: 'Appeal submitted successfully.',
      appeal: newAppeal.rows[0]
    });

  } catch (error) {
    console.error('Error submitting appeal:', error);
    res.status(500).json({ success: false, message: 'Server error while submitting appeal.' });
  }
};

// ==========================================
// 2. Submit Order Dispute Appeal (By Seller) - 🔥 SECURED TRANSACTION
// ==========================================
exports.createOrderDispute = async (req, res) => {
  const client = await pool.connect();
  try {
    const { application_id, reason } = req.body;
    const seller_id = req.user.id;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Dispute reason is required.' });
    }

    await client.query('BEGIN');

    // Row-level lock to prevent concurrent modifications on the application
    const appCheck = await client.query(
      `SELECT a.id, p.seller_id 
       FROM applications a 
       JOIN products p ON a.product_id = p.id 
       WHERE a.id = $1 FOR UPDATE`, 
      [application_id]
    );

    if (appCheck.rows.length === 0 || appCheck.rows[0].seller_id !== seller_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized or invalid application." });
    }

    await client.query(
      `INSERT INTO appeals (user_id, application_id, appeal_type, reason, status) 
       VALUES ($1, $2, 'order_dispute', $3, 'pending')`,
      [seller_id, application_id, reason.trim()]
    );

    await client.query(`UPDATE applications SET status = 'disputed', updated_at = NOW() WHERE id = $1`, [application_id]);

    await client.query('COMMIT');
    res.json({ success: true, message: "Dispute appeal submitted successfully." });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Order dispute error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 3. GET all appeals for Admin
// ==========================================
exports.getAllAppeals = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.name, u.email, u.role 
      FROM appeals a 
      JOIN users u ON a.user_id = u.id 
      ORDER BY a.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET ALL APPEALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 4. Handle Standard Account Ban Appeals - 🔥 SECURED TRANSACTION
// ==========================================
exports.approveAppeal = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    
    await client.query("BEGIN");
    
    // Check and lock the appeal row
    const appealResult = await client.query(
      "SELECT user_id FROM appeals WHERE id = $1 AND status = 'pending' FOR UPDATE", 
      [id]
    );
    
    if (appealResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Pending appeal not found" });
    }

    await client.query("UPDATE appeals SET status = 'approved' WHERE id = $1", [id]);
    await client.query("UPDATE users SET is_frozen = false, is_active = true WHERE id = $1", [appealResult.rows[0].user_id]);
    
    await client.query("COMMIT");
    res.json({ success: true, message: "Appeal approved and user unbanned." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("APPROVE APPEAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

exports.rejectAppeal = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("UPDATE appeals SET status = 'rejected' WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Appeal not found" });
    res.json({ success: true, message: "Appeal rejected." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🔥 5. Admin Resolve Dispute - Favor Seller (SECURED)
// ==========================================
exports.favorSeller = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { application_id, admin_comment } = req.body;
    
    const safeComment = admin_comment ? admin_comment.trim() : 'Resolved in favor of seller.';

    await client.query("BEGIN");
    
    // Check appeal status
    const appealCheck = await client.query("SELECT * FROM appeals WHERE id = $1 AND status = 'pending' FOR UPDATE", [id]);
    if (appealCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Pending appeal not found." });
    }

    // Row-level lock on application
    const appQuery = await client.query(
      `SELECT a.product_id, p.price, p.reward, p.seller_id 
       FROM applications a JOIN products p ON a.product_id = p.id 
       WHERE a.id = $1 FOR UPDATE`, 
      [application_id]
    );

    if(appQuery.rows.length > 0) {
      const app = appQuery.rows[0];
      // 10% platform fee সহ সম্পূর্ণ টাকা সেলারকে ব্যাক দেওয়া হচ্ছে
      const totalRefund = parseFloat(app.price) + parseFloat(app.reward) + ((parseFloat(app.price) + parseFloat(app.reward)) * 0.10);

      // Refund the Seller
      await client.query(`UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`, [totalRefund, app.seller_id]);

      // Reject the application and save admin comment
      await client.query(
        `UPDATE applications SET status = 'rejected', refund_comment = $1, updated_at = NOW() WHERE id = $2`, 
        [safeComment, application_id]
      );
    }

    // Resolve appeal (Seller won)
    await client.query(`UPDATE appeals SET status = 'approved' WHERE id = $1`, [id]); 

    await client.query("COMMIT");
    res.json({ success: true, message: "Resolved in favor of Seller. Application rejected and Seller refunded." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Favor Seller Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 🔥 6. Admin Resolve Dispute - Favor Buyer (SECURED)
// ==========================================
exports.favorBuyer = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { application_id, admin_comment } = req.body;
    
    const safeComment = admin_comment ? admin_comment.trim() : 'Resolved in favor of buyer.';

    await client.query("BEGIN");
    
    // Check appeal status
    const appealCheck = await client.query("SELECT * FROM appeals WHERE id = $1 AND status = 'pending' FOR UPDATE", [id]);
    if (appealCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Pending appeal not found." });
    }

    // Row-level lock on application
    const appQuery = await client.query("SELECT id FROM applications WHERE id = $1 FOR UPDATE", [application_id]);
    if (appQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    // Change status to pending_refund so Admin can manually process it, and save the comment
    await client.query(
      `UPDATE applications SET status = 'pending_refund', refund_comment = $1, updated_at = NOW() WHERE id = $2`, 
      [safeComment, application_id]
    );

    // Resolve appeal (Seller lost)
    await client.query(`UPDATE appeals SET status = 'rejected' WHERE id = $1`, [id]);

    await client.query("COMMIT");
    res.json({ success: true, message: "Resolved in favor of Buyer. Order moved to Pending Refund." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Favor Buyer Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 🔥 7. GET My Appeals (For Seller Dashboard)
// ==========================================
exports.getMyAppeals = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT * FROM appeals 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.status(200).json({ 
      success: true, 
      count: result.rows.length,
      data: result.rows 
    });
  } catch (error) {
    console.error("GET MY APPEALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};