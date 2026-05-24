const pool = require("../config/db");
const axios = require("axios");

// 🛡️ XSS Protection Utility
const escapeHTML = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
};

// 🔥 IP Tracking Helper
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(/, /)[0] : req.socket.remoteAddress;
  return ip || 'Unknown';
};

// 🔥 Automated IP to Location Resolver
const getIpLocation = async (ip) => {
  if (!ip || ip === 'Unknown' || ip === '::1' || ip === '127.0.0.1') return 'Localhost';
  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}`);
    if (response.data && response.data.status === 'success') {
      return `${response.data.city}, ${response.data.country}`;
    }
    return 'Unknown Location';
  } catch (error) {
    console.error("IP Location Fetch Error:", error.message);
    return 'Location Unavailable';
  }
};

const updateApplicationStatus = async (req, res, options) => {
  const client = await pool.connect();
  try {
    const applicationId = req.params.id;
    const { allowedStatuses, nextStatus, successMessage, invalidMessage } = options;

    await client.query('BEGIN');

    const appResult = await client.query(
      "SELECT * FROM applications WHERE id = $1 FOR UPDATE",
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const application = appResult.rows[0];
    if (!allowedStatuses.includes(application.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: invalidMessage || `Application must be in ${allowedStatuses.join(', ')} status.`
      });
    }

    const result = await client.query(
      "UPDATE applications SET status = $1 WHERE id = $2 RETURNING *",
      [nextStatus, applicationId]
    );

    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: successMessage, application: result.rows[0], data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("APPLICATION STATUS UPDATE ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// =======================
// ✅ Apply to Product (Buyer)
// =======================
const applyToProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const { product_id } = req.body;
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    const user_id = req.user.id;
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);

    await client.query('BEGIN');

    const userCheck = await client.query("SELECT is_active, is_frozen FROM users WHERE id = $1 FOR UPDATE", [user_id]);
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "User not found" });
    }

    const user = userCheck.rows[0];

    if (user.is_active === false) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: "Your account is disabled due to policy violations. Please contact the support team." });
    }

    if (user.is_frozen === true) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: "Your account is currently frozen. You cannot apply for new products at this moment." });
    }

    const productId = parseInt(product_id, 10);
    if (!Number.isInteger(productId) || productId <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "product_id is required" });
    }

    const productResult = await client.query(
      "SELECT id, status, required_orders FROM products WHERE id = $1 FOR UPDATE",
      [productId]
    );

    if (productResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Product not found" });
    }

    const product = productResult.rows[0];
    if (product.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "This product is not available for new applications" });
    }

    const applicationCount = await client.query(
      "SELECT COUNT(*)::int AS count FROM applications WHERE product_id = $1 AND status != 'rejected'",
      [productId]
    );

    const requiredOrders = parseInt(product.required_orders, 10) || 0;
    const currentApplications = parseInt(applicationCount.rows[0].count, 10) || 0;

    if (requiredOrders > 0 && currentApplications >= requiredOrders) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "This product is sold out" });
    }

    const existing = await client.query(
      "SELECT id FROM applications WHERE user_id = $1 AND product_id = $2",
      [user_id, productId]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "Already applied" });
    }

    const result = await client.query(
      `INSERT INTO applications (user_id, product_id, status, ip_address, ip_location) VALUES ($1, $2, 'pending', $3, $4) RETURNING *`,
      [user_id, productId, ipAddress, ipLocation]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: "Applied successfully", application: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("APPLY ERROR:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

// =======================
// ✅ Admin Approve Application
// =======================
const approveApplication = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['pending'],
    nextStatus: 'approved',
    successMessage: "Application approved successfully",
    invalidMessage: "Only pending applications can be approved."
  });
};

// =======================
// ❌ Admin Reject Application
// =======================
const rejectApplication = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['pending'],
    nextStatus: 'rejected',
    successMessage: "Application rejected successfully",
    invalidMessage: "Only pending applications can be rejected from this action."
  });
};

// =======================
// 🗑️ Admin Clear/Delete Application
// =======================
const deleteApplicationAdmin = async (req, res) => {
  try {
    const applicationId = req.params.id;
    const result = await pool.query(
      `DELETE FROM applications WHERE id = $1 RETURNING *`,
      [applicationId]
    );

    if (result.rows.length === 0) return res.status(404).json({ message: "Application not found" });
    res.status(200).json({ success: true, message: "Application history cleared successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// =======================
// ✅ Get Applications (Admin)
// =======================
const getApplicationsByProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'seller') {
      const productCheck = await pool.query(
        "SELECT id FROM products WHERE id = $1 AND seller_id = $2",
        [productId, userId]
      );

      if (productCheck.rows.length === 0) {
        return res.status(403).json({ success: false, message: "Unauthorized. This product does not belong to you." });
      }
    }

    const result = await pool.query(
      `SELECT a.id, a.status, a.order_number, a.screenshot_url, a.order_comment, 
              a.review_screenshot_url, a.review_link, a.refund_screenshot_url, a.refund_comment, a.created_at, a.ip_address, a.ip_location,
              u.name, u.email 
       FROM applications a JOIN users u ON a.user_id = u.id WHERE a.product_id = $1 ORDER BY a.created_at DESC`,
      [productId]
    );
    res.json({ message: "Applications fetched successfully", applications: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================================
// 🔥 Get My Applications (Buyer Dashboard)
// ==========================================
const getMyApplications = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT 
         a.id AS application_id, a.status AS application_status, a.order_number, a.screenshot_url, a.order_comment,
         a.review_screenshot_url, a.review_link, a.refund_screenshot_url, a.refund_comment, a.created_at AS applied_on,
         p.id AS product_id, p.product_name, p.image_url, p.price, p.reward, p.country, p.platform, p.store_name, p.search_keyword, p.instructions, p.category
       FROM applications a JOIN products p ON a.product_id = p.id
       WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
      [userId]
    );
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================================
// 🛒 Submit Order Number (Buyer)
// ==========================================
const submitOrder = async (req, res) => {
  try {
    const applicationId = req.params.id;
    const { order_number, screenshot_url, order_comment } = req.body;
    const userId = req.user.id;

    if (!order_number || order_number.trim() === '') {
      return res.status(400).json({ message: "Order number is required" });
    }

    const appCheck = await pool.query("SELECT id, status FROM applications WHERE id = $1 AND user_id = $2", [applicationId, userId]);
    if (appCheck.rows.length === 0) return res.status(404).json({ message: "Application not found or unauthorized" });
    if (appCheck.rows[0].status !== 'approved') return res.status(400).json({ message: "You can only submit an order for 'approved' applications" });

    const result = await pool.query(
      `UPDATE applications 
       SET order_number = $1, screenshot_url = $2, order_comment = $3, status = 'order_submitted' 
       WHERE id = $4 AND user_id = $5 AND status = 'approved'
       RETURNING *`,
      [escapeHTML(order_number.trim()), screenshot_url ? escapeHTML(screenshot_url.trim()) : null, order_comment ? escapeHTML(order_comment.trim()) : null, applicationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Application status changed. Please refresh and try again." });
    }

    res.status(200).json({ success: true, message: "Order submitted successfully with screenshot", data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================================
// ➡️ Forward Order to Seller (Admin)
// ==========================================
const forwardOrderToSeller = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['order_submitted', 'review_submitted'],
    nextStatus: 'forwarded_to_seller',
    successMessage: "Forwarded to seller for verification.",
    invalidMessage: "Application must have a submitted order or review before forwarding."
  });
};

// ==========================================
// 👑 Approve Order (Admin)
// ==========================================
const approveOrder = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['order_submitted'],
    nextStatus: 'order_approved',
    successMessage: "Order approved successfully. Buyer can now submit a review.",
    invalidMessage: "Application not found or order has not been submitted yet."
  });
};

// ==========================================
// ❌ Reject Order (Admin)
// ==========================================
const rejectOrder = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['order_submitted'],
    nextStatus: 'rejected',
    successMessage: "Order rejected successfully.",
    invalidMessage: "Application not found or order has not been submitted yet."
  });
};

// ==========================================
// 📝 Submit Review (Buyer)
// ==========================================
const submitReview = async (req, res) => {
  try {
    const applicationId = req.params.id;
    const { review_screenshot_url, review_link } = req.body;
    const userId = req.user.id;

    if (!review_screenshot_url && !review_link) {
      return res.status(400).json({ message: "Please provide either a review screenshot or a review link" });
    }

    const appCheck = await pool.query("SELECT id, status FROM applications WHERE id = $1 AND user_id = $2", [applicationId, userId]);
    if (appCheck.rows.length === 0) return res.status(404).json({ message: "Application not found or unauthorized" });
    if (appCheck.rows[0].status !== 'order_approved') return res.status(400).json({ message: "You can only submit a review after your order is approved by the admin" });

    const result = await pool.query(
      `UPDATE applications 
       SET review_screenshot_url = $1, review_link = $2, status = 'review_submitted' 
       WHERE id = $3 AND user_id = $4 AND status = 'order_approved'
       RETURNING *`,
      [
        review_screenshot_url ? escapeHTML(review_screenshot_url.trim()) : null, 
        review_link ? escapeHTML(review_link.trim()) : null, 
        applicationId,
        userId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Application status changed. Please refresh and try again." });
    }

    res.status(200).json({ success: true, message: "Review submitted successfully", data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================================
// 👑 Approve Review (Admin)
// ==========================================
const approveReview = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['review_submitted'],
    nextStatus: 'pending_refund',
    successMessage: "Review approved successfully. Status changed to pending_refund.",
    invalidMessage: "Application not found or review has not been submitted yet."
  });
};

// ==========================================
// ❌ Reject Review (Admin)
// ==========================================
const rejectReview = async (req, res) => {
  return updateApplicationStatus(req, res, {
    allowedStatuses: ['review_submitted'],
    nextStatus: 'rejected',
    successMessage: "Review rejected successfully.",
    invalidMessage: "Application not found or review has not been submitted yet."
  });
};

// ==========================================
// 🔥 Seller Approve Review / Order
// ==========================================
const sellerApproveReview = async (req, res) => {
  const client = await pool.connect();
  const applicationId = req.params.id;
  const sellerId = req.user.id;

  try {
    await client.query("BEGIN");

    const appQuery = await client.query(
      `SELECT a.id, a.status, p.seller_id, p.category 
       FROM applications a JOIN products p ON a.product_id = p.id 
       WHERE a.id = $1 FOR UPDATE`, 
      [applicationId]
    );

    if (appQuery.rows.length === 0 || appQuery.rows[0].seller_id !== sellerId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Unauthorized action." });
    }

    const app = appQuery.rows[0];

    const validStates = ['review_submitted', 'pending_refund', 'forwarded_to_seller'];
    if (!validStates.includes(app.status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Application is not in a valid state to be approved." });
    }

    if (app.category !== 'Pre-Pay') {
      await client.query(`UPDATE applications SET status = 'pending_refund' WHERE id = $1`, [applicationId]);
      await client.query("COMMIT");
      return res.json({ success: true, message: "Verified by Seller. Sent to Admin for final refund processing." });
    } else {
      await client.query(`UPDATE applications SET status = 'completed' WHERE id = $1`, [applicationId]);
      await client.query("COMMIT");
      return res.json({ success: true, message: "Approved successfully." });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 💰 Confirm Refund (Admin) - 🔥 PERCENTAGE REFUND LOGIC INTEGRATED
// ==========================================
const confirmRefund = async (req, res) => {
  const client = await pool.connect();
  try {
    const applicationId = req.params.id;
    const { refund_order_number, refund_screenshot_url, refund_comment } = req.body; 

    await client.query('BEGIN');

    // 🔥 1. Fetch Application & Product details
    const appResult = await client.query(
      `SELECT a.user_id, a.status, p.price, p.reward, p.category, p.country, p.platform 
       FROM applications a JOIN products p ON a.product_id = p.id 
       WHERE a.id = $1 FOR UPDATE`,
      [applicationId]
    );

    if (appResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Application not found" });
    }
    
    const app = appResult.rows[0];
    
    if (app.status === 'completed') {
       await client.query('ROLLBACK');
       return res.status(400).json({ message: "Refund already processed for this application." });
    }

    const allowedRefundStatuses = app.category === 'Pre-Pay' ? ['pending', 'pending_refund'] : ['pending_refund'];
    if (!allowedRefundStatuses.includes(app.status)) {
       await client.query('ROLLBACK');
       return res.status(400).json({
         success: false,
         message: app.category === 'Pre-Pay'
           ? "Pre-Pay payment can only be confirmed from pending or pending_refund status."
           : "Refund can only be confirmed after the application reaches pending_refund status."
       });
    }

    const totalGrossAmount = parseFloat(app.price) + parseFloat(app.reward);
    let finalRefundAmount = totalGrossAmount;
    let refundFeeAmount = 0;
    let message = "";

    if (app.category !== 'Pre-Pay') {
      // 🔥 2. FETCH DYNAMIC REFUND FEE PERCENTAGE
      const feeResult = await client.query(
        "SELECT buyer_refund_fee FROM dynamic_fees_config WHERE LOWER(country) = LOWER($1) AND LOWER(platform) = LOWER($2)",
        [app.country, app.platform]
      );
      
      // If config found, calculate fee percentage (e.g. 5.00 -> 0.05)
      const refundFeePercent = feeResult.rows.length > 0 ? (parseFloat(feeResult.rows[0].buyer_refund_fee) / 100) : 0;
      
      refundFeeAmount = totalGrossAmount * refundFeePercent;
      finalRefundAmount = totalGrossAmount - refundFeeAmount;

      // 3. Update User Wallet with Final Net Amount
      await client.query(`UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2`, [finalRefundAmount, app.user_id]);
      
      message = `Refund confirmed successfully. $${finalRefundAmount.toFixed(2)} added to buyer's wallet. (Network Fee: $${refundFeeAmount.toFixed(2)} deducted)`;
    } else {
      message = `Payment confirmed for Pre-Pay task. Amount sent to external account, wallet not updated.`;
    }

    const finalOrderText = refund_order_number ? escapeHTML(refund_order_number.trim()) : (refund_screenshot_url ? escapeHTML(refund_screenshot_url.trim()) : '');

    // 4. Log the refund
    const updateResult = await client.query(
      `UPDATE applications SET status = 'completed', refund_screenshot_url = $1, refund_comment = $2 WHERE id = $3 RETURNING *`,
      [finalOrderText, refund_comment ? escapeHTML(refund_comment.trim()) : null, applicationId]
    );

    // 🔥 SECURITY FIX: Log transaction for the buyer
    if (app.category !== 'Pre-Pay') {
        await client.query(
            "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'refund', $3, 'completed')",
            [app.user_id, finalRefundAmount, `Refund received for Application #${applicationId} (Fee deducted: $${refundFeeAmount.toFixed(2)})`]
        );
    }

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: message, data: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("CONFIRM REFUND ERROR:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 📊 Get Product Reviews (Seller Dashboard)
// ==========================================
const getSellerProductReviews = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const productId = req.params.id;

    const productCheck = await pool.query("SELECT id FROM products WHERE id = $1 AND seller_id = $2", [productId, sellerId]);
    if (productCheck.rows.length === 0) return res.status(403).json({ message: "Unauthorized. This product does not belong to you." });

    const result = await pool.query(
      `SELECT a.id AS application_id, a.status, a.order_number, a.screenshot_url, a.review_screenshot_url, a.review_link, a.refund_comment, a.created_at, 
              u.name AS buyer_name, u.amazon_profile_url AS profile_link, u.trust_score
       FROM applications a 
       JOIN users u ON a.user_id = u.id 
       WHERE a.product_id = $1
       ORDER BY a.created_at DESC`,
      [productId]
    );

    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================================
// 👑 Get All Applications for Admin
// ==========================================
const getAllApplicationsAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.user_id, a.status, a.order_number, a.screenshot_url, a.order_comment, 
             a.review_link, a.review_screenshot_url, a.created_at, a.ip_address, a.ip_location,
             p.product_name, p.image_url, p.price, p.reward,
             p.platform, p.country, p.store_name, p.search_keyword, p.instructions, p.product_link, p.seller_id, p.category,
             u.name AS buyer_name, u.email AS buyer_email, u.trust_score,
             s.name AS seller_name, s.email AS seller_email
      FROM applications a
      JOIN products p ON a.product_id = p.id
      JOIN users u ON a.user_id = u.id
      LEFT JOIN users s ON p.seller_id = s.id
      ORDER BY a.created_at DESC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  applyToProduct, approveApplication, rejectApplication, deleteApplicationAdmin, 
  getApplicationsByProduct, getMyApplications, submitOrder, forwardOrderToSeller, 
  approveOrder, rejectOrder, submitReview, approveReview, rejectReview,      
  sellerApproveReview, confirmRefund, getSellerProductReviews, getAllApplicationsAdmin
};
