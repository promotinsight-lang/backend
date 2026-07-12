const net = require("net");
const pool = require("../config/db");
const {
  normalizeCampaignCategory,
  normalizeCampaignCategoryKey,
  resolveBuyerRewardForCategory,
  parsePlatformChargeConditions,
  parsePlatformChargeTiers,
} = require("../utils/campaignCategories");

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
};

const parseQuantity = (value) => {
  const quantity = Number.parseInt(value, 10);
  return Number.isInteger(quantity) ? quantity : NaN;
};

const isPrivateIp = (hostname) => {
  if (!net.isIP(hostname)) return false;
  if (hostname === "::1" || hostname === "127.0.0.1") return true;
  if (net.isIP(hostname) === 4) {
    const parts = hostname.split(".").map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0;
  }
  const normalized = hostname.toLowerCase();
  return normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:");
};

const validateExternalImageUrl = (value) => {
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return false;
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateIp(hostname)) return false;
    return true;
  } catch {
    return false;
  }
};

const publicProductFields = (product) => ({
  id: product.id,
  product_name: product.product_name,
  image_url: product.image_url,
  price: product.price,
  reward: product.reward,
  platform: product.platform,
  country: product.country,
  category: product.category,
  status: product.status,
  required_orders: product.required_orders,
  application_count: product.application_count,
  seller_name: product.seller_name,
});

const sellerProductFields = (product) => ({
  ...product,
  seller_email: undefined,
  seller_wallet_balance: undefined,
});

const serializeProductForUser = (product, user) => {
  if (user?.role === "admin") return product;
  if (user?.role === "seller" && String(product.seller_id) === String(user.id)) {
    return sellerProductFields(product);
  }
  return publicProductFields(product);
};

const fetchFeeConfig = async (client, country, platform) => {
  // 🔥 FETCH EXCHANGE RATE ALONG WITH FEES
  const result = await client.query(
    `SELECT country, platform, platform_charge, platform_charge_conditions, buyer_reward, buyer_reward_conditions, buyer_refund_fee, exchange_rate
     FROM dynamic_fees_config
     WHERE LOWER(country) = LOWER($1) AND LOWER(platform) = LOWER($2)`,
    [country.trim(), platform.trim()]
  );

  return result.rows[0] || null;
};

const calculateCampaignDeposit = ({ price, reward, quantity, feeConfig, category, useConfiguredBuyerReward = false }) => {
  const resolvedReward = useConfiguredBuyerReward
    ? resolveBuyerRewardForCategory(feeConfig, category, reward)
    : reward;
  
  let commissionPerOrderLocal = 0;
  let hasFeeError = false;
  let feeErrorMessage = "";
  const normalizedCategory = normalizeCampaignCategory(category);
  const categoryKey = normalizeCampaignCategoryKey(normalizedCategory);

  // 🔥 JSON TIER PARSING LOGIC
  const conditionMap = parsePlatformChargeConditions(feeConfig.platform_charge_conditions);
  const selectedConditionTiers = categoryKey ? conditionMap[categoryKey] : [];
  const platformChargeTiers = (Array.isArray(selectedConditionTiers) && selectedConditionTiers.length > 0)
    ? selectedConditionTiers
    : parsePlatformChargeTiers(feeConfig.platform_charge);

  if (Array.isArray(platformChargeTiers) && platformChargeTiers.length > 0) {
      const matchedTier = platformChargeTiers.find(t => price >= Number(t.min) && price <= Number(t.max));
      if (matchedTier) {
          commissionPerOrderLocal = Number(matchedTier.fee);
      } else {
          hasFeeError = true;
          feeErrorMessage = `Product price does not fall into any defined fee tier for ${normalizedCategory} on this platform.`;
      }
  } else {
      const platformChargePercent = parseAmount(feeConfig.platform_charge) / 100;
      if (Number.isNaN(platformChargePercent)) {
        hasFeeError = true;
        feeErrorMessage = `No platform charge tier configured for ${normalizedCategory} on this platform.`;
      } else {
        commissionPerOrderLocal = price * platformChargePercent;
      }
  }

  const rewardDepositPerOrderLocal = resolvedReward;

  // 🔥 LOCAL CURRENCY DEPOSIT
  const requiredDepositPerOrderLocal = rewardDepositPerOrderLocal + commissionPerOrderLocal;
  const totalRequiredDepositLocal = requiredDepositPerOrderLocal * quantity;

  // 🔥 USD CONVERSION (For Wallet Deduction)
  // Frontend submits price/reward in USD; exchangeRate is kept for display/audit context.
  const exchangeRate = parseFloat(feeConfig.exchange_rate) || 1.0;
  const totalRequiredDepositUSD = totalRequiredDepositLocal;

  return {
    resolvedReward,
    commissionPerOrderLocal,
    rewardDepositPerOrderLocal,
    totalRequiredDepositLocal,
    totalRequiredDepositUSD,
    exchangeRate,
    categoryKey,
    normalizedCategory,
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
    const { product_name, price, store_name, search_keyword, reward, product_link, country, required_orders, instructions, platform, category } = req.body;
    const safeCountry = country ? country.trim() : '';
    const safePlatform = platform ? platform.trim() : '';
    const safeCategory = normalizeCampaignCategory(category);

    if (!product_name || !store_name || !search_keyword || !product_link || !safeCountry || !safePlatform) {
      return res.status(400).json({ success: false, message: "Product name, store, keyword, link, country, and platform are required" });
    }

    const image_url = req.body.image_url;
    if (!image_url) {
      return res.status(400).json({ success: false, message: "Product image is required" });
    }
    if (!validateExternalImageUrl(image_url)) {
      return res.status(400).json({ success: false, message: "Product image must be a valid public HTTPS URL" });
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
      category: safeCategory,
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

    // 🔥 CHECK BALANCE IN USD
    if (currentBalance < totalRequiredDepositUSD) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Insufficient USD balance. You need $${totalRequiredDepositUSD.toFixed(2)} USD to list this product.` 
      });
    }

    // 🔥 DEDUCT BALANCE IN USD
    await client.query(
      "UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2",
      [totalRequiredDepositUSD, sellerId]
    );

    // Insert Product with total_deposit (Saving USD value instead of Local) AND platform_fee_charged
    const result = await client.query(
      `INSERT INTO products 
      (image_url, product_name, price, store_name, search_keyword, reward, product_link, country, required_orders, instructions, seller_id, platform, category, status, total_deposit, platform_fee_charged)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending', $14, $15)
      RETURNING *`,
      [
        image_url.trim(), product_name.trim(), priceVal, store_name.trim(), search_keyword.trim(),
        resolvedReward, product_link.trim(), safeCountry, qtyVal, 
        instructions ? instructions.trim() : '', sellerId, safePlatform, 
        safeCategory, totalRequiredDepositUSD, commissionPerOrderLocal
      ]
    );

    // 🔥 LOG TRANSACTION IN USD
    await client.query(
      "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'product_deposit', $3, 'completed')",
      [sellerId, totalRequiredDepositUSD, `Deposit held for campaign: ${product_name} (Ex. Rate: ${exchangeRate})`]
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

    const savedDepositUSD = parseAmount(product.total_deposit);
    let refundAmountUSD = Number.isFinite(savedDepositUSD) ? savedDepositUSD : 0;

    if (!Number.isFinite(savedDepositUSD)) {
      const { totalRequiredDepositUSD, hasFeeError, feeErrorMessage } = calculateCampaignDeposit({
        price: priceVal,
        reward: rewardVal,
        quantity: qtyVal,
        feeConfig,
      });

      if (hasFeeError) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: feeErrorMessage });
      }

      refundAmountUSD = totalRequiredDepositUSD;
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
      LEFT JOIN applications a ON p.id = a.product_id
        AND a.status IN ('order_submitted', 'order_approved', 'review_submitted', 'pending_refund', 'forwarded_to_seller', 'completed', 'disputed')
      WHERE p.status IN ('approved', 'stopped')
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    const data = result.rows.map((product) => serializeProductForUser(product, req.user));
    res.status(200).json({ success: true, count: data.length, data });
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
      LEFT JOIN applications a ON p.id = a.product_id
        AND a.status IN ('order_submitted', 'order_approved', 'review_submitted', 'pending_refund', 'forwarded_to_seller', 'completed', 'disputed')
      GROUP BY p.id, u.name, u.email, u.wallet_balance
      ORDER BY p.created_at DESC
    `);
    const data = result.rows.map((product) => serializeProductForUser(product, req.user));
    res.status(200).json({ success: true, count: data.length, data });
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

    const appCheck = await client.query(
      `SELECT COUNT(*)
       FROM applications
       WHERE product_id = $1
         AND status IN ('order_submitted', 'order_approved', 'review_submitted', 'pending_refund', 'forwarded_to_seller', 'completed', 'disputed')`,
      [productId]
    );
    const usedQty = parseInt(appCheck.rows[0].count) || 0;
    
    let remainingQty = qtyVal;
    if (product.status === 'stopped') {
        remainingQty = Math.max(0, qtyVal - usedQty);
    }
    
    const savedDepositUSD = parseAmount(product.total_deposit);
    let refundAmountUSD = Number.isFinite(savedDepositUSD)
        ? (savedDepositUSD / Math.max(qtyVal, 1)) * remainingQty
        : 0;

    if (!Number.isFinite(savedDepositUSD)) {
      const { totalRequiredDepositUSD, hasFeeError, feeErrorMessage } = calculateCampaignDeposit({
        price: priceVal,
        reward: rewardVal,
        quantity: remainingQty,
        feeConfig,
      });

      if (hasFeeError) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: feeErrorMessage });
      }

      refundAmountUSD = totalRequiredDepositUSD;
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
       LEFT JOIN applications a ON p.id = a.product_id
         AND a.status IN ('order_submitted', 'order_approved', 'review_submitted', 'pending_refund', 'forwarded_to_seller', 'completed', 'disputed')
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
    
    const product = productResult.rows[0];

    if (userRole === 'admin') {
      return res.status(200).json({ success: true, data: product });
    }

    if (userRole === 'seller') {
      if (String(product.seller_id) !== String(userId)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      return res.status(200).json({ success: true, data: sellerProductFields(product) });
    }

    if (userRole === 'buyer') {
      return res.status(200).json({ success: true, data: publicProductFields(product) });
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
