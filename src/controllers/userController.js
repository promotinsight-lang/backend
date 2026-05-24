const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const svgCaptcha = require("svg-captcha"); 
const axios = require("axios"); // 🔥 NEW: Axios for API calls

// ==========================================
// 🛡️ Security Helpers & In-Memory Cache
// ==========================================

const captchaCache = new Map(); 
const otpCache = new Map();     

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of captchaCache.entries()) {
    if (value.expires < now) captchaCache.delete(key);
  }
  for (const [key, value] of otpCache.entries()) {
    if (value.expires < now) otpCache.delete(key);
  }
}, 30 * 60 * 1000);

const isValidURL = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

const isValidEmail = (email) => {
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  return emailRegex.test(email);
};

// 🔥 NEW: Block Disposable/Fake/Temporary Emails
const isDisposableEmail = (email) => {
  if (!email) return false;
  const domain = email.split('@')[1].toLowerCase();
  const blockedDomains = [
    'yopmail.com', 'mailinator.com', 'tempmail.com', '10minutemail.com', 
    'guerrillamail.com', 'dropmail.me', 'fakemail.net', 'temp-mail.org', 
    'throwawaymail.com', 'dispostable.com', 'maildrop.cc', 'tempmailo.com'
  ];
  return blockedDomains.includes(domain);
};

// 🔥 NEW: IP Tracking Helper
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(/, /)[0] : req.socket.remoteAddress;
  return ip || 'Unknown';
};

// 🔥 PREMIUM: Automated IP to Location Resolver
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

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', 
  sameSite: 'strict', 
  maxAge: 7 * 24 * 60 * 60 * 1000 
});

const maskEmail = (email) => {
  if (!email) return "Unknown";
  const [name, domain] = email.split('@');
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.substring(0, 2)}***${name[name.length - 1]}@${domain}`;
};

// ==========================================
// 📈 GET PUBLIC LIVE FEED
// ==========================================
const getPublicLiveFeed = async (req, res) => {
  try {
    const earningsRes = await pool.query(`
      SELECT u.email, (p.price + p.reward) as amount, a.updated_at as date, 'earning' as type
      FROM applications a
      JOIN users u ON a.user_id = u.id
      JOIN products p ON a.product_id = p.id
      WHERE a.status = 'completed'
      ORDER BY a.updated_at DESC LIMIT 5
    `);

    const withdrawalsRes = await pool.query(`
      SELECT u.email, w.amount, w.created_at as date, 'withdrawal' as type
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'approved'
      ORDER BY w.created_at DESC LIMIT 5
    `);

    const combined = [...earningsRes.rows, ...withdrawalsRes.rows]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5); 

    const maskedData = combined.map(item => ({
      ...item,
      email: maskEmail(item.email)
    }));

    res.status(200).json({ success: true, data: maskedData });
  } catch (error) {
    console.error("LIVE FEED ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🖼️ Generate CAPTCHA
// ==========================================
const generateCaptcha = (req, res) => {
  try {
    const captcha = svgCaptcha.create({
      size: 4,           
      noise: 2,          
      color: true,       
      background: '#f4f7f6', 
      width: 120,
      height: 40
    });

    const captchaId = crypto.randomBytes(16).toString('hex');
    
    captchaCache.set(captchaId, {
      text: captcha.text.toLowerCase(),
      expires: Date.now() + 5 * 60000 
    });

    res.status(200).json({ 
      success: true, 
      captchaId, 
      image: captcha.data 
    });
  } catch (error) {
    console.error("CAPTCHA ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to generate captcha" });
  }
};

// ==========================================
// 📧 Send Registration OTP
// ==========================================
const sendRegistrationOtp = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    const emailTrimmed = email.trim().toLowerCase();

    // 🔥 FRAUD PREVENTION: Block Temporary/Fake Emails
    if (isDisposableEmail(emailTrimmed)) {
      return res.status(400).json({ 
        success: false, 
        message: "Temporary or Fake emails are strictly prohibited on our platform. Please use a valid email address (e.g. Gmail, Yahoo)." 
      });
    }

    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [emailTrimmed]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email is already registered" });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    otpCache.set(emailTrimmed, {
      code: otpCode,
      expires: Date.now() + 10 * 60000
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: `"MarketInsight Security" <${process.env.EMAIL_USER}>`,
      to: emailTrimmed,
      subject: "Your Registration Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; border-top: 5px solid #0066ff;">
            <h2 style="color: #333; text-align: center;">Account Verification</h2>
            <p style="color: #555; font-size: 16px;">Welcome to MarketInsight! Your email verification code is:</p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0066ff; background: #f0f7ff; padding: 10px 20px; border-radius: 5px;">${otpCode}</span>
            </div>
            <p style="color: #555; font-size: 14px;">This code will expire in <strong>10 minutes</strong>. Do not share this code with anyone.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: "Verification code sent to your email" });

  } catch (error) {
    console.error("SEND OTP ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to send verification code" });
  }
};

// =======================
// ✅ Register User
// =======================
const registerUser = async (req, res) => {
  try {
    const { name, fullName, email, password, role, otp } = req.body;
    const finalName = name ? name.trim() : (fullName ? fullName.trim() : '');
    const emailTrimmed = email ? email.trim().toLowerCase() : '';
    
    // 🔥 Track IP and Location on Register
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);

    if (!finalName || !emailTrimmed || !password || !otp) {
      return res.status(400).json({ success: false, message: "All fields including verification code are required" });
    }

    if (!isValidEmail(emailTrimmed)) {
      return res.status(400).json({ success: false, message: "Invalid email format" });
    }

    if (isDisposableEmail(emailTrimmed)) {
      return res.status(400).json({ success: false, message: "Fake or temporary emails are not allowed." });
    }

    const cachedOtp = otpCache.get(emailTrimmed);
    if (!cachedOtp) {
      return res.status(400).json({ success: false, message: "Verification code expired or not requested." });
    }
    if (cachedOtp.expires < Date.now()) {
      otpCache.delete(emailTrimmed);
      return res.status(400).json({ success: false, message: "Verification code expired." });
    }
    if (cachedOtp.code !== otp.toString().trim()) {
      return res.status(400).json({ success: false, message: "Invalid verification code" });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters long." });
    }

    const userRole = role ? role.trim().toLowerCase() : "buyer";
    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [emailTrimmed]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // 🔥 Add IP and Location to insertion
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, last_ip, ip_location)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, verification_status`,
      [finalName, emailTrimmed, hashedPassword, userRole, ipAddress, ipLocation]
    );

    const user = result.rows[0];
    otpCache.delete(emailTrimmed);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie('token', token, getCookieOptions());

    res.status(201).json({ 
      success: true,
      message: "User registered successfully", 
      token, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role, verification_status: user.verification_status } 
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// ✅ Login User
// =======================
const loginUser = async (req, res) => {
  try {
    const { email, password, captchaId, captchaInput } = req.body;
    
    // 🔥 Track IP and Location on Login
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    if (!captchaId || !captchaInput) {
      return res.status(400).json({ success: false, message: "Captcha is required" });
    }

    const cachedCaptcha = captchaCache.get(captchaId);
    if (!cachedCaptcha) {
      return res.status(400).json({ success: false, message: "Captcha expired." });
    }
    
    if (cachedCaptcha.expires < Date.now()) {
      captchaCache.delete(captchaId);
      return res.status(400).json({ success: false, message: "Captcha expired." });
    }

    if (cachedCaptcha.text !== captchaInput.toLowerCase().trim()) {
      return res.status(400).json({ success: false, message: "Incorrect captcha code" });
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash, role, verification_status FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid credentials" }); 
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    captchaCache.delete(captchaId);
    
    // 🔥 Update last IP and Location on successful login
    await pool.query("UPDATE users SET last_ip = $1, ip_location = $2 WHERE id = $3", [ipAddress, ipLocation, user.id]);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie('token', token, getCookieOptions());

    res.json({
      success: true,
      message: "Login successful",
      token, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role, verification_status: user.verification_status },
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// 🌐 Social Login (Google & Yahoo)
// =======================
const socialLogin = async (req, res) => {
  try {
    const { email, name, auth_provider } = req.body;
    
    // 🔥 Track IP and Location on Social Login
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required for social login" });
    }

    const emailTrimmed = email.trim().toLowerCase();
    
    const existingUser = await pool.query(
      "SELECT id, name, email, password_hash, role, verification_status FROM users WHERE email = $1",
      [emailTrimmed]
    );

    let user;

    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      // 🔥 Update IP and Location for returning social login user
      await pool.query("UPDATE users SET last_ip = $1, ip_location = $2 WHERE id = $3", [ipAddress, ipLocation, user.id]);
    } else {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 12);
      const finalName = name ? name.trim() : 'User';

      // 🔥 Insert IP and Location for new social login user
      const newUser = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, last_ip, ip_location)
         VALUES ($1, $2, $3, 'buyer', $4, $5)
         RETURNING id, name, email, role, verification_status`,
        [finalName, emailTrimmed, hashedPassword, ipAddress, ipLocation]
      );
      
      user = newUser.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie('token', token, getCookieOptions());

    res.status(200).json({
      success: true,
      message: `${auth_provider ? auth_provider.toUpperCase() : 'Social'} login successful`,
      token, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role, verification_status: user.verification_status },
    });

  } catch (error) {
    console.error("SOCIAL LOGIN ERROR:", error);
    res.status(500).json({ success: false, message: "Server error during social login" });
  }
};

// =======================
// 🚪 Logout User
// =======================
const logoutUser = (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
};

// ==========================================
// 👤 Get User Profile
// ==========================================
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT id, name, email, role, wallet_balance, created_at, 
              verification_status, amazon_location, amazon_account, 
              amazon_profile_url, paypal_account, facebook_account, 
              whatsapp_account, telegram_account, is_active, is_frozen
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, user: result.rows[0] });

  } catch (error) {
    console.error("GET PROFILE ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// ✏️ Update User Name (For Profile)
// ==========================================
const updateUserName = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Name cannot be empty" });
    }

    const result = await pool.query(
      "UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, role, verification_status",
      [name.trim(), userId]
    );

    res.status(200).json({ 
      success: true, 
      message: "Name updated successfully!",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("UPDATE NAME ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ Submit User Verification Info
// ==========================================
const submitVerification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      amazon_location, amazon_account, amazon_profile_url, 
      paypal_account, facebook_account, whatsapp_account, telegram_account 
    } = req.body;

    if (!amazon_location || !amazon_account || !amazon_profile_url || !paypal_account || !whatsapp_account) {
      return res.status(400).json({ success: false, message: "Amazon info, PayPal info, and WhatsApp number are required!" });
    }

    if (!isValidURL(amazon_profile_url)) {
      return res.status(400).json({ success: false, message: "Amazon profile must be a valid URL link." });
    }

    if (facebook_account && !isValidURL(facebook_account)) {
      return res.status(400).json({ success: false, message: "Facebook account must be a valid URL link." });
    }

    // 🔥 FRAUD PREVENTION: Check for Duplicate WhatsApp or Amazon Profile URL
    const duplicateCheck = await pool.query(
      `SELECT id FROM users 
       WHERE (whatsapp_account = $1 OR amazon_profile_url = $2) 
       AND id != $3`,
      [whatsapp_account.trim(), amazon_profile_url.trim(), userId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Fraud Alert: This WhatsApp number or Amazon Profile URL is already linked with another account!" 
      });
    }

    const result = await pool.query(
      `UPDATE users 
       SET amazon_location = $1, amazon_account = $2, amazon_profile_url = $3, 
           paypal_account = $4, facebook_account = $5, whatsapp_account = $6, 
           telegram_account = $7, verification_status = 'pending'
       WHERE id = $8 RETURNING *`,
      [
        amazon_location.trim(), 
        amazon_account.trim(), 
        amazon_profile_url.trim(), 
        paypal_account.trim(), 
        facebook_account ? facebook_account.trim() : null, 
        whatsapp_account ? whatsapp_account.trim() : null, 
        telegram_account ? telegram_account.trim() : null, 
        userId
      ]
    );

    res.status(200).json({ 
      success: true, 
      message: "Verification submitted successfully!",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("SUBMIT VERIFICATION ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ ADMIN: Get All Users By Role
// ==========================================
const getAllUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    // 🔥 Added ip_location to selection
    const result = await pool.query(
      `SELECT id, name, email, role, wallet_balance, trust_score, 
              verification_status, is_active, is_frozen, created_at, last_ip, ip_location
       FROM users WHERE role = $1 ORDER BY created_at DESC`,
      [role]
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("ADMIN GET USERS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ ADMIN: Update User Status
// ==========================================
const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, is_frozen } = req.body;

    const isActiveParam = typeof is_active !== 'undefined' ? is_active : null;
    const isFrozenParam = typeof is_frozen !== 'undefined' ? is_frozen : null;

    const result = await pool.query(
      `UPDATE users 
       SET is_active = COALESCE($1, is_active), 
           is_frozen = COALESCE($2, is_frozen) 
       WHERE id = $3 RETURNING id, name, is_active, is_frozen`,
      [isActiveParam, isFrozenParam, id]
    );

    res.status(200).json({ 
      success: true, 
      message: "User status updated successfully", 
      user: result.rows[0] 
    });
  } catch (error) {
    console.error("UPDATE STATUS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ ADMIN: Get Specific User Details
// ==========================================
const getAdminUserDetailsById = async (req, res) => {
  try {
    const userId = req.params.id;
    // 🔥 Added ip_location to selection
    const result = await pool.query(
      `SELECT id, name, email, role, wallet_balance, created_at, 
              verification_status, amazon_location, amazon_account, 
              amazon_profile_url, paypal_account, facebook_account, 
              whatsapp_account, telegram_account, trust_score, is_active, is_frozen, last_ip, ip_location
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("GET ADMIN USER DETAILS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getPaymentSettings = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM payment_settings ORDER BY id ASC");
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET PAYMENT SETTINGS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 💳 Deposit Funds
// ==========================================
const depositFunds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, payment_method, transaction_id } = req.body;
    const amountValue = Number(amount);

    if (!amountValue || amountValue <= 0 || !payment_method || !transaction_id || !transaction_id.trim()) {
      return res.status(400).json({ success: false, message: "Valid amount, payment method, and transaction ID are required" });
    }

    const result = await pool.query(
      `INSERT INTO deposits (user_id, amount, payment_method, transaction_id, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [userId, amountValue, payment_method.trim(), transaction_id.trim()]
    );

    res.status(201).json({
      success: true,
      message: "Deposit request submitted successfully.",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("DEPOSIT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getMyDeposits = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET DEPOSITS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateTrustScore = async (req, res) => {
  try {
    const userId = req.params.id;
    const { trust_score } = req.body;

    const scoreValue = parseFloat(trust_score);

    if (isNaN(scoreValue) || scoreValue < 0 || scoreValue > 5) {
      return res.status(400).json({ success: false, message: "Score must be between 0 and 5" });
    }

    const result = await pool.query(
      "UPDATE users SET trust_score = $1 WHERE id = $2 RETURNING *",
      [scoreValue, userId]
    );

    res.status(200).json({ success: true, message: "Trust score updated successfully", data: result.rows[0] });
  } catch (error) {
    console.error("UPDATE TRUST SCORE ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const submitAppeal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;
    
    if (!reason || !reason.trim()) return res.status(400).json({ success: false, message: "Reason is required" });

    const check = await pool.query("SELECT * FROM appeals WHERE user_id = $1 AND status = 'pending'", [userId]);
    if (check.rows.length > 0) return res.status(400).json({ success: false, message: "You already have a pending appeal." });

    await pool.query("INSERT INTO appeals (user_id, reason) VALUES ($1, $2)", [userId, reason.trim()]);
    res.status(201).json({ success: true, message: "Appeal submitted successfully." });
  } catch (error) {
    console.error("APPEAL SUBMIT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getPendingAppeals = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.reason, a.status, a.created_at, u.name, u.email, u.id AS user_id 
      FROM appeals a 
      JOIN users u ON a.user_id = u.id 
      WHERE a.status = 'pending' 
      ORDER BY a.created_at DESC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET APPEALS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const resolveAppeal = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { action } = req.body; 

    await client.query('BEGIN');

    const appealCheck = await client.query("SELECT * FROM appeals WHERE id = $1 FOR UPDATE", [id]);
    if (appealCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Appeal not found" });
    }

    const userId = appealCheck.rows[0].user_id;

    if (action === 'approve') {
      await client.query("UPDATE users SET is_active = true WHERE id = $1", [userId]);
      await client.query("UPDATE appeals SET status = 'approved' WHERE id = $1", [id]);
      await client.query('COMMIT');
      res.status(200).json({ success: true, message: "Appeal approved." });
    } else {
      await client.query("UPDATE appeals SET status = 'rejected' WHERE id = $1", [id]);
      await client.query('COMMIT');
      res.status(200).json({ success: true, message: "Appeal rejected." });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("RESOLVE APPEAL ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email.trim()]);
    if (userResult.rows.length === 0) {
      return res.status(200).json({ success: true, message: "If your email is registered, a reset link will be sent." });
    }

    const user = userResult.rows[0];
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const resetLink = `http://localhost:5173/reset-password/${user.id}/${token}`;

    const mailOptions = {
      from: `"MarketInsight Security" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Security Alert: Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; border-top: 5px solid #0066ff;">
            <h2 style="color: #333;">Password Reset</h2>
            <p style="color: #555; font-size: 16px;">Hello ${user.name},</p>
            <p style="color: #555; font-size: 16px;">You requested to reset your password. This link will expire in 15 minutes.</p>
            <a href="${resetLink}" style="display: inline-block; padding: 12px 25px; background-color: #0066ff; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px;">Reset Password</a>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: "Reset link sent successfully." });

  } catch (error) {
    console.error("FORGOT PASSWORD ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to process request." });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { id, token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters long." });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(400).json({ success: false, message: "Invalid or expired token." });
      }

      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hashedPassword, id]);
      res.status(200).json({ success: true, message: "Password updated successfully!" });
    });

  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getPublicLiveFeed,      
  generateCaptcha,        
  sendRegistrationOtp,    
  registerUser,
  loginUser,
  socialLogin, 
  logoutUser,
  getUserProfile,
  updateUserName,
  getPaymentSettings,
  depositFunds,
  getMyDeposits,
  updateTrustScore,
  submitAppeal,
  getPendingAppeals,
  resolveAppeal,
  forgotPassword, 
  resetPassword,
  submitVerification,
  getAllUsersByRole,
  updateUserStatus,
  getAdminUserDetailsById 
};