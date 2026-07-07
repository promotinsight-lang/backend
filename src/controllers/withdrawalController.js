const pool = require("../config/db");
const crypto = require("crypto");

// ==========================================
// 💸 Request Withdrawal (Buyer/Seller) - 🔥 FIXED SQL ID ERROR & ADDED QR SUPPORT
// ==========================================
const requestWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { 
      amount, payment_method, account_details,
      crypto_address, crypto_network, crypto_memo, qr_code_url 
    } = req.body;
    
    const amountValue = parseFloat(amount);

    if (!amountValue || amountValue <= 0 || !payment_method) {
      return res.status(400).json({ success: false, message: "Valid amount and payment_method are required" });
    }

    await client.query('BEGIN');

    // 1. Fetch Payment Method Details (Support Crypto & Fiat)
    const methodRes = await client.query(
      "SELECT * FROM payment_methods WHERE LOWER(name) = LOWER($1)",
      [payment_method]
    );

    let method;
    if (methodRes.rows.length === 0) {
      // 🔥 FIXED: Handled Legacy fallback using JavaScript instead of SQL to avoid "id" column error
      method = {
        type: 'legacy',
        requires_network: false,
        requires_memo: false,
        requires_address: false,
        requires_account_details: true
      };
    } else {
      method = methodRes.rows[0];
    }

    const isCrypto = method.type === 'crypto';
    const isLegacy = method.type === 'legacy';

    let finalCryptoAddress = null;
    let finalCryptoNetwork = null;
    let finalCryptoMemo = null;
    let baseAccountDetails = '';

    // Validate Input based on Method Type
    if (isLegacy) {
      if (!account_details) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Account details are required" });
      }
      baseAccountDetails = account_details.trim();
    } else if (isCrypto) {
      if (method.requires_address && !crypto_address) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Wallet address is required" });
      }
      if (method.requires_network && !crypto_network) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Network selection is required" });
      }
      if (method.requires_memo && !crypto_memo) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Memo/Tag is required" });
      }
      finalCryptoAddress = crypto_address ? crypto_address.trim() : null;
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

    // 2. Lock user's wallet
    const userResult = await client.query(
      "SELECT wallet_balance, role, amazon_location, ip_location FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBalance = parseFloat(userResult.rows[0].wallet_balance || 0);

    if (currentBalance < amountValue) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Insufficient wallet balance." });
    }

    const userCountry = userResult.rows[0].amazon_location || userResult.rows[0].ip_location || 'Local';

    // 3. Calculate Dynamic Fees
    const feeConfig = await client.query(
      "SELECT seller_withdrawal_fee, exchange_rate FROM dynamic_fees_config WHERE LOWER(country) = LOWER($1) LIMIT 1",
      [userCountry]
    );
    
    let feePercent = 0.0;
    let exchangeRate = 1;

    if (feeConfig.rows.length > 0) {
        feePercent = parseFloat(feeConfig.rows[0].seller_withdrawal_fee || 0) / 100;
        exchangeRate = parseFloat(feeConfig.rows[0].exchange_rate || 1);
    } else {
        const defaultFeeConfig = await client.query("SELECT seller_withdrawal_fee FROM dynamic_fees_config LIMIT 1");
        if (defaultFeeConfig.rows.length > 0) {
            feePercent = parseFloat(defaultFeeConfig.rows[0].seller_withdrawal_fee || 0) / 100;
        }
    }

    const feeAmount = amountValue * feePercent;
    const netPayable = amountValue - feeAmount;
    const localNetPayable = (netPayable * exchangeRate).toFixed(2);

    // 4. Deduct Wallet Balance
    await client.query(
      "UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) - $1 WHERE id = $2",
      [amountValue, userId]
    );

    const finalAccountDetails = `${baseAccountDetails}\n[SYSTEM CALCULATION -> Gross: $${amountValue.toFixed(2)} | Fee: $${feeAmount.toFixed(2)} (${(feePercent * 100).toFixed(1)}%) | Net Payable: $${netPayable.toFixed(2)} USD (~${localNetPayable} ${userCountry})]`.trim();

    // 5. Insert Withdrawal (With qr_code_url parameter)
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (
        user_id, amount, payment_method, account_details, 
        crypto_address, crypto_network, crypto_memo, qr_code_url, is_crypto, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING *`,
      [
        userId, amountValue, payment_method.trim(), finalAccountDetails, 
        finalCryptoAddress, finalCryptoNetwork, finalCryptoMemo, qr_code_url || null, isCrypto
      ]
    );

    const withdrawal = withdrawalResult.rows[0];
    const transactionReference = `withdrawal:${withdrawal.id}:${crypto.randomUUID()}`;

    await client.query(
      "UPDATE withdrawals SET transaction_reference = $1 WHERE id = $2",
      [transactionReference, withdrawal.id]
    );

    // 6. Log transaction
    await client.query(
        "INSERT INTO transactions (user_id, amount, type, description, status, reference_id) VALUES ($1, $2, 'withdrawal', $3, 'pending', $4)",
        [userId, amountValue, `Withdrawal requested. Fee: $${feeAmount.toFixed(2)}. Net to receive: $${netPayable.toFixed(2)} USD`, transactionReference]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `Withdrawal request submitted successfully. Net to receive: $${netPayable.toFixed(2)} USD`,
      data: { ...withdrawal, transaction_reference: transactionReference }
    });

  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { }
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
    const result = await pool.query("SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
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
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("GET ALL WITHDRAWALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 👑 Approve Withdrawal (Admin)
// ==========================================
const approveWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const withdrawalId = req.params.id;
    const { transaction_id, screenshot_url } = req.body;

    await client.query('BEGIN');

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

    if (!withdrawal.transaction_reference) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: "Withdrawal transaction reference is missing. Manual review is required."
      });
    }

    const safeTxId = transaction_id ? transaction_id.trim() : null;
    const safeUrl = screenshot_url ? screenshot_url.trim() : null;

    const transactionUpdateResult = await client.query(
        "UPDATE transactions SET status = 'completed' WHERE reference_id = $1 AND type = 'withdrawal' AND status = 'pending'",
        [withdrawal.transaction_reference]
    );

    if (transactionUpdateResult.rowCount !== 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: "Exact withdrawal transaction could not be updated. Manual review is required."
      });
    }

    const updateResult = await client.query(
      "UPDATE withdrawals SET status = 'approved', transaction_id = $2, screenshot_url = $3 WHERE id = $1 RETURNING *",
      [withdrawalId, safeTxId, safeUrl]
    );

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: "Withdrawal approved successfully.", data: updateResult.rows[0] });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("APPROVE WITHDRAWAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ==========================================
// 👑 Reject Withdrawal (Admin)
// ==========================================
const rejectWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const withdrawalId = req.params.id;

    await client.query('BEGIN');

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

    if (!withdrawal.transaction_reference) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: "Withdrawal transaction reference is missing. Manual review is required."
      });
    }

    const transactionUpdateResult = await client.query(
        "UPDATE transactions SET status = 'rejected' WHERE reference_id = $1 AND type = 'withdrawal' AND status = 'pending'",
        [withdrawal.transaction_reference]
    );

    if (transactionUpdateResult.rowCount !== 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: "Exact withdrawal transaction could not be updated. Manual review is required."
      });
    }

    const updateResult = await client.query("UPDATE withdrawals SET status = 'rejected' WHERE id = $1 RETURNING *", [withdrawalId]);

    await client.query(
      "UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2",
      [withdrawal.amount, withdrawal.user_id]
    );

    await client.query(
        "INSERT INTO transactions (user_id, amount, type, description, status, reference_id) VALUES ($1, $2, 'refund', $3, 'completed', $4)",
        [withdrawal.user_id, withdrawal.amount, `Refund for rejected withdrawal request ID: ${withdrawalId}`, `refund:${withdrawal.transaction_reference}`]
    );

    await client.query('COMMIT');
    res.status(200).json({ success: true, message: "Withdrawal rejected. Money refunded.", data: updateResult.rows[0] });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("REJECT WITHDRAWAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = { requestWithdrawal, getMyWithdrawals, getAllWithdrawals, approveWithdrawal, rejectWithdrawal };
