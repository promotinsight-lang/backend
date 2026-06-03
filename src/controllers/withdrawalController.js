const pool = require("../config/db");

// ==========================================
// 💸 Request Withdrawal (Buyer/Seller) - 🔥 SECURED TRANSACTION WITH DYNAMIC % FEE & CRYPTO SUPPORT
// ==========================================
const requestWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { 
      amount, 
      payment_method, 
      account_details,
      crypto_address,
      crypto_network,
      crypto_memo 
    } = req.body;
    
    const amountValue = parseFloat(amount);

    // Strict input validation (amount & payment_method are always required)
    if (!amountValue || amountValue <= 0 || !payment_method) {
      return res.status(400).json({ success: false, message: "Valid amount and payment_method are required" });
    }

    await client.query('BEGIN');

    // 🔥 1. Fetch Payment Method Details (Support new Multi-Method + Legacy)
    const methodRes = await client.query(
      `SELECT * FROM payment_methods WHERE LOWER(name) = LOWER($1)
       UNION ALL
       SELECT id, $1::text as name, 'legacy' as type, FALSE as requires_network, FALSE as requires_memo, TRUE as requires_address, TRUE as requires_account_details, NULL as example_address, NULL as example_network, NULL as example_memo, TRUE as active
       WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE LOWER(name) = LOWER($1))`,
      [payment_method]
    );

    if (methodRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Payment method not found" });
    }

    const method = methodRes.rows[0];
    const isCrypto = method.type === 'crypto';
    const isLegacy = method.type === 'legacy';

    // 🔥 2. Validate fields based on method type
    let finalCryptoAddress = null;
    let finalCryptoNetwork = null;
    let finalCryptoMemo = null;
    let baseAccountDetails = '';

    if (isLegacy) {
      if (!account_details) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Account details are required" });
      }
      baseAccountDetails = account_details.trim();
    } else if (isCrypto) {
      if (!crypto_address) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Wallet address is required for Crypto" });
      }
      if (method.requires_network && !crypto_network) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Network selection is required" });
      }
      if (method.requires_memo && !crypto_memo) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Memo/Tag is required" });
      }
      finalCryptoAddress = crypto_address.trim();
      finalCryptoNetwork = crypto_network ? crypto_network.trim() : null;
      finalCryptoMemo = crypto_memo ? crypto_memo.trim() : null;
      baseAccountDetails = account_details ? account_details.trim() : ''; 
    } else {
      if (method.requires_account_details && !account_details) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `${payment_method} requires account details` });
      }
      baseAccountDetails = account_details ? account_details.trim() : '';
    }

    // 3. Lock user's wallet to prevent concurrent double-spending
    const userResult = await client.query(
      "SELECT wallet_balance, role, amazon_location, ip_location FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // CRITICAL BUG FIX: NULL থাকলে 0 ধরে নিতে হবে
    const currentBalance = parseFloat(userResult.rows[0].wallet_balance || 0);

    // ব্যালেন্স চেক
    if (currentBalance < amountValue) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Insufficient wallet balance. You cannot withdraw more than you have." });
    }

    const userCountry = userResult.rows[0].amazon_location || userResult.rows[0].ip_location || 'Local';

    // 🔥 4. DYNAMIC WITHDRAWAL FEE & LOCAL CURRENCY CALCULATION
    const feeConfig = await client.query(
      "SELECT seller_withdrawal_fee, exchange_rate FROM dynamic_fees_config WHERE LOWER(country) = LOWER($1) LIMIT 1",
      [userCountry]
    );
    
    let feePercent = 0.0; // Default 0%
    let exchangeRate = 1;

    if (feeConfig.rows.length > 0) {
        feePercent = parseFloat(feeConfig.rows[0].seller_withdrawal_fee || 0) / 100;
        exchangeRate = parseFloat(feeConfig.rows[0].exchange_rate || 1);
    } else {
        // Fallback to default if country not found
        const defaultFeeConfig = await client.query("SELECT seller_withdrawal_fee FROM dynamic_fees_config LIMIT 1");
        if (defaultFeeConfig.rows.length > 0) {
            feePercent = parseFloat(defaultFeeConfig.rows[0].seller_withdrawal_fee || 0) / 100;
        }
    }

    const feeAmount = amountValue * feePercent;
    const netPayable = amountValue - feeAmount;
    const localNetPayable = (netPayable * exchangeRate).toFixed(2);

    // 5. Deduct total requested amount from wallet
    await client.query(
      "UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) - $1 WHERE id = $2",
      [amountValue, userId]
    );

    // 🔥 SMART TRICK: Append fee breakdown to account_details
    const finalAccountDetails = `${baseAccountDetails}\n[SYSTEM CALCULATION -> Gross: $${amountValue.toFixed(2)} | Fee: $${feeAmount.toFixed(2)} (${(feePercent * 100).toFixed(1)}%) | Net Payable: $${netPayable.toFixed(2)} USD (~${localNetPayable} ${userCountry})]`.trim();

    // 6. Insert withdrawal request with new Crypto & Legacy fields
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (
        user_id, amount, payment_method, account_details, 
        crypto_address, crypto_network, crypto_memo, is_crypto, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
      [
        userId, amountValue, payment_method.trim(), finalAccountDetails, 
        finalCryptoAddress, finalCryptoNetwork, finalCryptoMemo, isCrypto
      ]
    );

    // 7. Log the transaction securely
    await client.query(
        "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'withdrawal', $3, 'pending')",
        [userId, amountValue, `Withdrawal requested. Fee deducted: $${feeAmount.toFixed(2)}. Net to receive: $${netPayable.toFixed(2)} USD (~${localNetPayable} ${userCountry})`]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `Withdrawal request submitted successfully. Net to receive: $${netPayable.toFixed(2)} USD (~${localNetPayable} ${userCountry})`,
      data: withdrawalResult.rows[0]
    });

  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
    console.error("REQUEST WITHDRAWAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 📜 Get My Withdrawals (Buyer/Seller)
// ==========================================
const getMyWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      "SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("GET MY WITHDRAWALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 👑 Get All Withdrawals (Admin)
// ==========================================
const getAllWithdrawals = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*, u.name, u.email 
       FROM withdrawals w
       JOIN users u ON w.user_id = u.id
       ORDER BY w.created_at DESC`
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("GET ALL WITHDRAWALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 👑 Approve Withdrawal (Admin) - 🔥 SECURED TRANSACTION
// ==========================================
const approveWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const withdrawalId = req.params.id;
    const { transaction_id, screenshot_url } = req.body;

    await client.query('BEGIN');

    // Lock withdrawal record to prevent duplicate approvals/rejections
    const checkResult = await client.query("SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE", [withdrawalId]);
    
    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Withdrawal not found" });
    }
    
    const withdrawal = checkResult.rows[0];

    if (withdrawal.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Only pending requests can be approved" });
    }

    const safeTxId = transaction_id ? transaction_id.trim() : null;
    const safeUrl = screenshot_url ? screenshot_url.trim() : null;

    // Update status to approved AND save payment proofs
    const updateResult = await client.query(
      "UPDATE withdrawals SET status = 'approved', transaction_id = $2, screenshot_url = $3 WHERE id = $1 RETURNING *",
      [withdrawalId, safeTxId, safeUrl]
    );

    // Log the transaction as completed
    await client.query(
        "UPDATE transactions SET status = 'completed' WHERE user_id = $1 AND amount = $2 AND type = 'withdrawal' AND status = 'pending'",
        [withdrawal.user_id, withdrawal.amount]
    );

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: "Withdrawal approved successfully.",
      data: updateResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("APPROVE WITHDRAWAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 👑 Reject Withdrawal (Admin) - 🔥 SECURED TRANSACTION
// ==========================================
const rejectWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const withdrawalId = req.params.id;

    await client.query('BEGIN');

    // Lock the withdrawal record to prevent concurrent actions
    const checkResult = await client.query("SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE", [withdrawalId]);
    
    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Withdrawal not found" });
    }
    
    const withdrawal = checkResult.rows[0];
    
    if (withdrawal.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Only pending requests can be rejected" });
    }

    // 1. Update status to rejected
    const updateResult = await client.query(
      "UPDATE withdrawals SET status = 'rejected' WHERE id = $1 RETURNING *",
      [withdrawalId]
    );

    // 2. Refund money back to user's wallet safely
    await client.query(
      "UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2",
      [withdrawal.amount, withdrawal.user_id]
    );

    // 3. Log the refund transaction
    await client.query(
        "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'refund', $3, 'completed')",
        [withdrawal.user_id, withdrawal.amount, `Refund for rejected withdrawal request ID: ${withdrawalId}`]
    );

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: "Withdrawal rejected. Money refunded to user's wallet.",
      data: updateResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("REJECT WITHDRAWAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = {
  requestWithdrawal,
  getMyWithdrawals,
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal
};