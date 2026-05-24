const pool = require("../config/db");

// 🛡️ XSS Protection Utility
const escapeHTML = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
};

// 1. Get Dashboard Stats
const getDashboardStats = async (req, res) => {
  try {
    const usersCount = await pool.query("SELECT COUNT(*) FROM users");
    const productsCount = await pool.query("SELECT COUNT(*) FROM products");
    const pendingDeposits = await pool.query("SELECT COUNT(*) FROM deposits WHERE status = 'pending'");
    const pendingWithdrawals = await pool.query("SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'");

    res.status(200).json({
      success: true,
      data: {
        totalUsers: parseInt(usersCount.rows[0].count),
        totalProducts: parseInt(productsCount.rows[0].count),
        pendingDeposits: parseInt(pendingDeposits.rows[0].count),
        pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].count),
      }
    });
  } catch (error) {
    console.error("GET DASHBOARD STATS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 2. Get All Pending Deposits
const getPendingDeposits = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, u.name, u.email 
      FROM deposits d 
      JOIN users u ON d.user_id = u.id 
      WHERE d.status = 'pending' 
      ORDER BY d.created_at DESC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET PENDING DEPOSITS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 3. Approve Deposit - 🔥 SECURED TRANSACTION
const approveDeposit = async (req, res) => {
  const client = await pool.connect();
  try {
    const depositId = req.params.id;
    
    await client.query('BEGIN');
    
    const depositResult = await client.query(
      "SELECT * FROM deposits WHERE id = $1 AND status = 'pending' FOR UPDATE", 
      [depositId]
    );
    
    if (depositResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Pending deposit not found or already processed" });
    }
    
    const deposit = depositResult.rows[0];

    await client.query("UPDATE deposits SET status = 'approved' WHERE id = $1", [depositId]);
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2", 
      [deposit.amount, deposit.user_id]
    );
    
    await client.query('COMMIT');
    res.status(200).json({ success: true, message: "Deposit approved successfully" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("APPROVE DEPOSIT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// 4. Reject Deposit
const rejectDeposit = async (req, res) => {
  try {
    const depositId = req.params.id;
    const result = await pool.query("UPDATE deposits SET status = 'rejected' WHERE id = $1 RETURNING *", [depositId]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Deposit not found" });
    res.status(200).json({ success: true, message: "Deposit rejected" });
  } catch (error) {
    console.error("REJECT DEPOSIT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 5. Update Admin Payment Settings
const updatePaymentSetting = async (req, res) => {
  try {
    const settingId = req.params.id;
    const { account_details } = req.body;

    if (!account_details || typeof account_details !== 'string') {
       return res.status(400).json({ success: false, message: "Invalid account details" });
    }

    const result = await pool.query(
      "UPDATE payment_settings SET account_details = $1 WHERE id = $2 RETURNING *",
      [escapeHTML(account_details.trim()), settingId]
    );
    res.status(200).json({ success: true, message: "Payment setting updated", data: result.rows[0] });
  } catch (error) {
    console.error("UPDATE PAYMENT SETTING ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 6. Get Pending User Verifications
const getPendingVerifications = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, amazon_account, amazon_location, amazon_profile_url, paypal_account, facebook_account, whatsapp_account, telegram_account, verification_status 
      FROM users 
      WHERE verification_status = 'pending'
      ORDER BY created_at DESC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET VERIFICATIONS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 7. Verify User (Approve/Reject)
const verifyUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { status } = req.body; 

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const result = await pool.query(
      "UPDATE users SET verification_status = $1 WHERE id = $2 RETURNING *",
      [status, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, message: `User ${status} successfully` });
  } catch (error) {
    console.error("VERIFY USER ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 8. Get All Appeals
const getAppeals = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.name, u.email, u.role
      FROM appeals a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET APPEALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 9. Approve Appeal & Reactivate Account
const approveAppeal = async (req, res) => {
  const client = await pool.connect();
  try {
    const appealId = req.params.id;
    
    await client.query('BEGIN');
    const appealResult = await client.query(
      "SELECT * FROM appeals WHERE id = $1 AND status = 'pending' FOR UPDATE", 
      [appealId]
    );
    
    if (appealResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Pending appeal not found" });
    }

    const appeal = appealResult.rows[0];
    await client.query("UPDATE appeals SET status = 'approved' WHERE id = $1", [appealId]);
    await client.query("UPDATE users SET is_active = true WHERE id = $1", [appeal.user_id]);
    
    await client.query('COMMIT');
    res.status(200).json({ success: true, message: "Appeal approved and user account reactivated." });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("APPROVE APPEAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// 10. Reject Appeal
const rejectAppeal = async (req, res) => {
  try {
    const appealId = req.params.id;
    const result = await pool.query("UPDATE appeals SET status = 'rejected' WHERE id = $1 RETURNING *", [appealId]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Appeal not found" });
    res.status(200).json({ success: true, message: "Appeal rejected." });
  } catch (error) {
    console.error("REJECT APPEAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 11. Get Monthly Reports
const getMonthlyStats = async (req, res) => {
  try {
    const { month } = req.query;
    
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!month || !monthRegex.test(month)) {
      return res.status(400).json({ success: false, message: "Valid month is required (YYYY-MM)" });
    }

    const result = await pool.query(`
      SELECT 
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_orders,
        COUNT(*) FILTER (WHERE status = 'rejected') AS failed_orders
      FROM applications
      WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
    `, [month]);

    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error("GET MONTHLY STATS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getDashboardStats, getPendingDeposits, approveDeposit, rejectDeposit,
  updatePaymentSetting, getPendingVerifications, verifyUser, getAppeals,
  approveAppeal, rejectAppeal, getMonthlyStats
};