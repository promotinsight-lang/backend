const pool = require("../config/db");

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
};

const parseQuantity = (value) => {
  const quantity = Number.parseInt(value, 10);
  return Number.isInteger(quantity) ? quantity : NaN;
};

const fetchFeeConfig = async (client, country, platform) => {
  // 🔥 FETCH EXCHANGE RATE ALONG WITH FEES
  const result = await client.query(
    `SELECT country, platform, platform_charge, buyer_reward, buyer_refund_fee, exchange_rate
     FROM dynamic_fees_config
     WHERE LOWER(country) = LOWER($1) AND LOWER(platform) = LOWER($2)`,
    [country.trim(), platform.trim()]
  );

  return result.rows[0] || null;
};

const calculateCampaignDeposit = ({ price, reward, quantity, feeConfig, useConfiguredBuyerReward = false }) => {
  const fixedBuyerReward = parseAmount(feeConfig.buyer_reward);
  const resolvedReward = useConfiguredBuyerReward && fixedBuyerReward > 0 ? fixedBuyerReward : reward;
  
  let commissionPerOrderLocal = 0;
  let hasFeeError = false;
  let feeErrorMessage = "";

  // 🔥 JSON TIER PARSING LOGIC
  let platformChargeTiers = feeConfig.platform_charge;
  if (typeof platformChargeTiers === 'string') {
      try { 
          platformChargeTiers = JSON.parse(platformChargeTiers); 
      } catch (e) { 
          platformChargeTiers = []; 
      }
  }

  if (Array.isArray(platformChargeTiers) && platformChargeTiers.length > 0) {
      const matchedTier = platformChargeTiers.find(t => price >= Number(t.min) && price <= Number(t.max));
      if (matchedTier) {
          commissionPerOrderLocal = Number(matchedTier.fee);
      } else {
          hasFeeError = true;
          feeErrorMessage = `Product price does not fall into any defined fee tier for this platform.`;
      }
  } else {
      const platformChargePercent = parseAmount(feeConfig.platform_charge) / 100;
      commissionPerOrderLocal = price * (Number.isNaN(platformChargePercent) ? 0.10 : platformChargePercent);
  }

  const refundFeePercent = parseAmount(feeConfig.buyer_refund_fee || 0) / 100;
  const costPerOrderLocal = price + resolvedReward;
  const refundFeePerOrderLocal = costPerOrderLocal * refundFeePercent;

  // 🔥 LOCAL CURRENCY DEPOSIT
  const requiredDepositPerOrderLocal = costPerOrderLocal + commissionPerOrderLocal + refundFeePerOrderLocal;
  const totalRequiredDepositLocal = requiredDepositPerOrderLocal * quantity;

  // 🔥 USD CONVERSION (For Wallet Deduction)
  const exchangeRate = parseFloat(feeConfig.exchange_rate) || 1.0;
  const totalRequiredDepositUSD = totalRequiredDepositLocal / exchangeRate;

  return {
    resolvedReward,
    commissionPerOrderLocal,
    refundFeePercent,
    costPerOrderLocal,
    refundFeePerOrderLocal,
    totalRequiredDepositLocal,
    totalRequiredDepositUSD,
    exchangeRate,
    hasFeeError,
    feeErrorMessage
  };
};

// =======================
// ✅ CREATE PRODUCT - 🔥 SECURED & DYNAMIC FEE INTEGRATED
// =======================
const createProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const sellerId = req.user.id;
    // 🔥 FIX: Added total_deposit here to receive it from frontend
    const { product_name, price, store_name, search_keyword, reward, product_link, country, required_orders, instructions, platform, category, total_deposit } = req.body;
    const safeCountry = country ? country.trim() : '';
    const safePlatform = platform ? platform.trim() : '';

    if (!product_name || !store_name || !search_keyword || !product_link || !safeCountry || !safePlatform) {
      return res.status(400).json({ success: false, message: "Product name, store, keyword, link, country, and platform are required" });
    }

    const image_url = req.body.image_url;
    if (!image_url) {
      return res.status(400).json({ success: false, message: "Product image is required" });
    }

    const priceVal = parseAmount(price);
    const rewardVal = parseAmount(reward);
    const qtyVal = parseQuantity(required_orders);

    if (!Number.isFinite(priceVal) || !Number.isFinite(rewardVal) || !Number.isFinite(qtyVal) || priceVal <= 0 || rewardVal < 0 || qtyVal <= 0) {
       return res.status(400).json({ success: false, message: "Invalid pricing or quantity values" });
    }

    await client.query('BEGIN');

    const feeConfig = await fetchFeeConfig(client, safeCountry, safePlatform);
    if (!feeConfig) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "No active fee configuration found for this country and platform. Please contact admin."
      });
    }

    const { 
        resolvedReward, 
        totalRequiredDepositLocal, 
        totalRequiredDepositUSD, 
        exchangeRate, 
        hasFeeError, 
        feeErrorMessage,
        commissionPerOrderLocal 
    } = calculateCampaignDeposit({
      price: priceVal,
      reward: rewardVal,
      quantity: qtyVal,
      feeConfig,
      useConfiguredBuyerReward: true,
    });

    if (hasFeeError) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: feeErrorMessage });
    }

    const userResult = await client.query("SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE", [sellerId]);
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBalance = parseFloat(userResult.rows[0].wallet_balance) || 0;

    // 🔥 FIX: Use frontend provided total_deposit (USD) directly
    const frontendTotalDepositUSD = parseAmount(total_deposit);

    if (Number.isNaN(frontendTotalDepositUSD) || frontendTotalDepositUSD <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Invalid deposit amount received." });
    }

    // 🔥 CHECK BALANCE IN USD
    if (currentBalance < frontendTotalDepositUSD) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Insufficient USD balance. You need $${frontendTotalDepositUSD.toFixed(2)} USD to list this product.` 
      });
    }

    // 🔥 DEDUCT BALANCE IN USD
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2",
      [frontendTotalDepositUSD, sellerId]
    );

    // Insert Product with total_deposit (Saving USD value instead of Local) AND platform_fee_charged
    const result = await client.query(
      `INSERT INTO products 
      (image_url, product_name, price, store_name, search_keyword, reward, product_link, country, required_orders, instructions, seller_id, platform, category, status, total_deposit, platform_fee_charged)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending', $14, $15)
      RETURNING *`,
      [
        image_url, product_name.trim(), priceVal, store_name.trim(), search_keyword.trim(), 
        resolvedReward, product_link.trim(), safeCountry, qtyVal, 
        instructions ? instructions.trim() : '', sellerId, safePlatform, 
        category ? category.trim() : 'General', frontendTotalDepositUSD, commissionPerOrderLocal
      ]
    );

    // 🔥 LOG TRANSACTION IN USD
    await client.query(
      "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'product_deposit', $3, 'completed')",
      [sellerId, frontendTotalDepositUSD, `Deposit held for campaign: ${product_name} (Ex. Rate: ${exchangeRate})`]
    );

    await client.query('COMMIT');

    res.status(201).json({ 
      success: true,
      message: "Product created successfully. USD Deposit deducted from wallet.", 
      product: result.rows[0] 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("CREATE PRODUCT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// =======================
// ❌ CANCEL PRODUCT & REFUND (Seller)
// =======================
const cancelProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const sellerId = req.user.id;
    const productId = req.params.id;

    await client.query('BEGIN');

    const prodCheck = await client.query("SELECT * FROM products WHERE id = $1 AND seller_id = $2 FOR UPDATE", [productId, sellerId]);
    if (prodCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Product not found or unauthorized" });
    }
    
    const product = prodCheck.rows[0];

    if (product.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "You can only cancel pending products." });
    }

    const priceVal = parseAmount(product.price);
    const rewardVal = parseAmount(product.reward);
    const qtyVal = parseQuantity(product.required_orders);
    
    const feeConfig = await fetchFeeConfig(client, product.country, product.platform);
    if (!feeConfig) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: "Fee configuration for this product no longer exists. Admin must restore it before refund can be calculated."
      });
    }

    const { totalRequiredDepositUSD: refundAmountUSD, hasFeeError, feeErrorMessage } = calculateCampaignDeposit({
      price: priceVal,
      reward: rewardVal,
      quantity: qtyVal,
      feeConfig,
    });

    if (hasFeeError) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: feeErrorMessage });
    }

    // Refund wallet in USD
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2",
      [refundAmountUSD, sellerId]
    );

    await client.query(
      "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'refund', $3, 'completed')",
      [sellerId, refundAmountUSD, `Refund for self-cancelled product: ${product.product_name} (ID: ${product.id})`]
    );

    await client.query("DELETE FROM products WHERE id = $1", [productId]);

    await client.query('COMMIT');

    res.status(200).json({ 
      success: true, 
      message: `Product cancelled successfully. $${refundAmountUSD.toFixed(2)} USD has been refunded to your wallet.` 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("CANCEL PRODUCT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// =======================
// ✏️ EDIT PRODUCT (Seller)
// =======================
const editProduct = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const productId = req.params.id;
    
    const { product_name, product_link, store_name, search_keyword, country, instructions, platform, category } = req.body;
    const safeCountry = country ? country.trim() : '';
    const safePlatform = platform ? platform.trim() : '';

    if (!product_name || !product_link || !store_name || !search_keyword || !safeCountry || !safePlatform) {
      return res.status(400).json({ success: false, message: "Product name, link, store, keyword, country, and platform are required" });
    }

    const prodCheck = await pool.query("SELECT id, status, country, platform FROM products WHERE id = $1 AND seller_id = $2", [productId, sellerId]);
    if (prodCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Product not found or unauthorized" });
    
    if (prodCheck.rows[0].status !== 'pending') {
      return res.status(400).json({ success: false, message: "You can only edit products that are in pending status." });
    }

    const product = prodCheck.rows[0];
    if (product.country.toLowerCase() !== safeCountry.toLowerCase() || product.platform.toLowerCase() !== safePlatform.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Country and platform cannot be changed after wallet deposit is locked. Please cancel and relist the product."
      });
    }

    const result = await pool.query(
      `UPDATE products 
       SET product_name = $1, product_link = $2, store_name = $3, search_keyword = $4, country = $5, instructions = $6, platform = $7, category = $8
       WHERE id = $9 RETURNING *`,
      [
        product_name.trim(), product_link.trim(), store_name.trim(), search_keyword.trim(), 
        safeCountry, instructions ? instructions.trim() : '', safePlatform, category ? category.trim() : 'General', productId
      ]
    );

    res.status(200).json({ success: true, message: "Product updated successfully.", product: result.rows[0] });

  } catch (error) {
    console.error("EDIT PRODUCT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// 🌍 GET PUBLIC PRODUCTS (For Home Page - NO AUTH REQUIRED)
// =======================
const getPublicProducts = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.product_name, p.image_url, p.price, p.reward, p.platform, p.country, p.category, p.status, p.required_orders,
             COALESCE(COUNT(a.id), 0)::int AS application_count
      FROM products p
      LEFT JOIN applications a ON p.id = a.product_id AND a.status != 'rejected'
      WHERE p.status IN ('approved', 'stopped')
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("GET PUBLIC PRODUCTS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// ✅ GET PRODUCTS (Admin & Buyer Logic - List View)
// =======================
const getProducts = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, u.name AS seller_name, u.email AS seller_email, COALESCE(u.wallet_balance, 0) AS seller_wallet_balance,
             COALESCE(COUNT(a.id), 0)::int AS application_count
      FROM products p
      LEFT JOIN users u ON p.seller_id = u.id
      LEFT JOIN applications a ON p.id = a.product_id AND a.status != 'rejected'
      GROUP BY p.id, u.name, u.email, u.wallet_balance
      ORDER BY p.created_at DESC
    `);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// ✅ APPROVE PRODUCT (Admin)
// =======================
const approveProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const result = await pool.query(`UPDATE products SET status = 'approved' WHERE id = $1 RETURNING *`, [productId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, message: "Product approved successfully", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// 🛑 STOP PRODUCT (Admin)
// =======================
const stopProductAdmin = async (req, res) => {
  try {
    const productId = req.params.id;
    const result = await pool.query(`UPDATE products SET status = 'stopped' WHERE id = $1 RETURNING *`, [productId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, message: "Product stopped. It will now appear as Sold Out.", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// ▶️ RESUME PRODUCT (Admin)
// =======================
const resumeProductAdmin = async (req, res) => {
  try {
    const productId = req.params.id;
    const result = await pool.query(`UPDATE products SET status = 'approved' WHERE id = $1 RETURNING *`, [productId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, message: "Product resumed successfully.", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// ❌ REJECT PRODUCT (Admin)
// =======================
const rejectProductAdmin = async (req, res) => {
  const client = await pool.connect();
  try {
    const productId = req.params.id;
    
    await client.query('BEGIN');

    const prodCheck = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [productId]);
    if (prodCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const product = prodCheck.rows[0];
    
    if(product.status !== 'pending' && product.status !== 'stopped'){
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Only pending or stopped products can be rejected and refunded." });
    }
    
    const priceVal = parseAmount(product.price);
    const rewardVal = parseAmount(product.reward);
    const qtyVal = parseQuantity(product.required_orders);
    
    const feeConfig = await fetchFeeConfig(client, product.country, product.platform);
    if (!feeConfig) {
        await client.query('ROLLBACK');
        return res.status(409).json({
            success: false,
            message: "Fee configuration for this product no longer exists. Admin must restore it before refund can be calculated."
        });
    }

    const appCheck = await client.query("SELECT COUNT(*) FROM applications WHERE product_id = $1 AND status != 'rejected'", [productId]);
    const usedQty = parseInt(appCheck.rows[0].count) || 0;
    
    let remainingQty = qtyVal;
    if (product.status === 'stopped') {
        remainingQty = Math.max(0, qtyVal - usedQty);
    }
    
    const { totalRequiredDepositUSD: refundAmountUSD, hasFeeError, feeErrorMessage } = calculateCampaignDeposit({
        price: priceVal,
        reward: rewardVal,
        quantity: remainingQty,
        feeConfig,
    });

    if (hasFeeError) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: feeErrorMessage });
    }

    // Refund the wallet ONLY if there is remaining money (Refund in USD)
    if (refundAmountUSD > 0) {
        await client.query("UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2", [refundAmountUSD, product.seller_id]);
        
        await client.query(
            "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'refund', $3, 'completed')",
            [product.seller_id, refundAmountUSD, `Admin refund for deleted/rejected product: ${product.product_name} (ID: ${product.id})`]
        );
    }
    
    await client.query("UPDATE products SET status = 'rejected' WHERE id = $1", [productId]);

    await client.query('COMMIT');

    res.status(200).json({ 
        success: true, 
        message: `Product deleted & $${refundAmountUSD.toFixed(2)} USD refunded to seller for ${remainingQty} unused slots.` 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("REJECT PRODUCT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

// ===============================
// ✅ GET MY PRODUCTS (SELLER)
// ===============================
const getMyProducts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    
    const result = await pool.query(
      `SELECT p.*, COALESCE(COUNT(a.id), 0)::int AS application_count 
       FROM products p 
       LEFT JOIN applications a ON p.id = a.product_id AND a.status != 'rejected'
       WHERE p.seller_id = $1 
       GROUP BY p.id 
       ORDER BY p.created_at DESC`, 
      [sellerId]
    );
    
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("GET MY PRODUCTS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============================================
// 🔥 GET PRODUCT BY ID (Smart Visibility)
// ============================================
const getProductById = async (req, res) => {
  try {
    const productId = req.params.id;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
    
    if (productResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Product not found' });
    
    let product = productResult.rows[0];

    if (userRole === 'admin' || userRole === 'seller') {
        return res.status(200).json({ success: true, data: product });
    }

    if (userRole === 'buyer') {
        const appResult = await pool.query(
            `SELECT status FROM applications WHERE user_id = $1 AND product_id = $2`,
            [userId, productId]
        );

        const hasApplied = appResult.rows.length > 0;
        const isApproved = hasApplied && appResult.rows[0].status === 'approved';

        if (isApproved) {
            delete product.product_link; 
            delete product.seller_id; 
            return res.status(200).json({ success: true, data: product });
        } else {
            return res.status(200).json({
                success: true,
                data: {
                    id: product.id, image_url: product.image_url, price: product.price,
                    reward: product.reward, country: product.country, category: product.category, status: product.status
                }
            });
        }
    }
    res.status(403).json({ success: false, message: "Access denied" });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ============================================
// 🔥 GET MY REFUNDS (SELLER) 
// ============================================
const getMyRefunds = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const result = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 AND type = 'refund' ORDER BY created_at DESC`,
      [sellerId]
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET MY REFUNDS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============================================
// 🔥 GET ALL REFUNDS (ADMIN) 
// ============================================
const getAllRefunds = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.name, u.email 
       FROM transactions t 
       JOIN users u ON t.user_id = u.id 
       WHERE t.type = 'refund' 
       ORDER BY t.created_at DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET ALL REFUNDS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createProduct,
  cancelProduct, 
  editProduct,   
  getPublicProducts, 
  getProducts,
  approveProduct,
  stopProductAdmin,
  resumeProductAdmin,
  rejectProductAdmin, 
  getMyProducts,
  getProductById,
  getMyRefunds,     
  getAllRefunds     
};