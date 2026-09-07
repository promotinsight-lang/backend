const pool = require("../config/db");
const { addAutomaticRank } = require("../utils/userRank");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { sendEmail, resend } = require("../utils/emailService");
const crypto = require("crypto");
const svgCaptcha = require("svg-captcha"); 
const axios = require("axios"); // 🔥 NEW: Axios for API calls
const net = require("net");
const firebaseAdmin = require("../config/firebaseAdmin");
const { getBuyerWalletBreakdown } = require("../utils/buyerWalletBreakdown");

// ==========================================
// 🛡️ Security Helpers & In-Memory Cache
// ==========================================

const captchaCache = new Map(); 
const otpCache = new Map();     
const geoLocationCache = new Map();

if (!resend) {
  console.warn("RESEND_API_KEY is not configured; email-dependent endpoints will return 503.");
}

const requireEmailService = (res) => {
  if (resend) return true;

  res.status(503).json({
    success: false,
    message: "Email service is not configured. Please try again later."
  });
  return false;
};

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

const hasEnoughPhoneDigits = (value) => String(value || '').replace(/\D/g, '').length >= 7;

const getBuyerContactValidationMessage = ({ facebook, whatsapp }) => {
  const facebookUrl = String(facebook || '').trim();
  const whatsappNumber = String(whatsapp || '').trim();

  if (!whatsappNumber) return 'WhatsApp Number is required for buyer approval.';
  if (!hasEnoughPhoneDigits(whatsappNumber)) return 'WhatsApp Number must include a valid phone number.';
  if (!facebookUrl) return 'Facebook URL is required for buyer approval.';
  if (!isValidURL(facebookUrl)) return 'Facebook URL must be a valid URL.';
  return null;
};

// 🔥 NEW: Block Disposable/Fake/Temporary Emails
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "0-mail.com",
  "0815.ru",
  "0wnd.net",
  "10minut.com",
  "10minutemail.co.uk",
  "10minutemail.com",
  "10minutemail.de",
  "10minutemail.net",
  "10minutemail.org",
  "10minutesmail.com",
  "20minutemail.com",
  "33mail.com",
  "anonbox.net",
  "anonymbox.com",
  "binkmail.com",
  "bugmenot.com",
  "deadaddress.com",
  "discard.email",
  "discardmail.com",
  "dispostable.com",
  "dodgit.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "guerillamail.com",
  "incognitomail.com",
  "jetable.org",
  "mail-temporaire.fr",
  "mailcatch.com",
  "maildrop.cc",
  "mailexpire.com",
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "mailnesia.com",
  "mailnull.com",
  "mintemail.com",
  "mohmal.com",
  "mytrashmail.com",
  "pookmail.com",
  "sharklasers.com",
  "shitmail.me",
  "slopsbox.com",
  "spam4.me",
  "spambog.com",
  "spambog.de",
  "spambog.ru",
  "spambox.us",
  "spamfree24.org",
  "spamgourmet.com",
  "spamhole.com",
  "spamify.com",
  "spammotel.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "temporaryemail.net",
  "throwawaymail.com",
  "trash-mail.com",
  "trashmail.com",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.org",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "zehnminutenmail.de",
]);

const DISPOSABLE_EMAIL_KEYWORDS = [
  "10minute",
  "disposable",
  "fakeemail",
  "fakemail",
  "guerrillamail",
  "mailinator",
  "tempmail",
  "temporarymail",
  "throwawaymail",
  "trashmail",
  "yopmail",
];

const TRUSTED_EMAIL_DOMAINS = new Set([
  "aol.com",
  "fastmail.com",
  "gmx.com",
  "gmx.de",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "icloud.com",
  "live.com",
  "mail.com",
  "mac.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "tutanota.com",
  "tutanota.de",
  "tutamail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "yahoo.fr",
  "ymail.com",
  "zoho.com",
  "zohomail.com",
]);

const getBlockedEmailDomains = () => {
  const extraDomains = (process.env.DISPOSABLE_EMAIL_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return new Set([...DISPOSABLE_EMAIL_DOMAINS, ...extraDomains]);
};

const getTrustedEmailDomains = () => {
  const extraDomains = (process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return new Set([...TRUSTED_EMAIL_DOMAINS, ...extraDomains]);
};

const getEmailDomain = (email) => {
  const domain = String(email || "").split("@").pop();
  return domain ? domain.trim().toLowerCase().replace(/\.+$/, "") : "";
};

const isBlockedEmailDomain = (domain) => {
  if (!domain) return false;

  const blockedDomains = getBlockedEmailDomains();
  if (blockedDomains.has(domain)) return true;

  for (const blockedDomain of blockedDomains) {
    if (domain.endsWith(`.${blockedDomain}`)) return true;
  }

  return DISPOSABLE_EMAIL_KEYWORDS.some((keyword) => domain.includes(keyword));
};

const isDisposableEmail = (email) => {
  if (!email) return false;
  return isBlockedEmailDomain(getEmailDomain(email));
};

const isTrustedRegistrationEmail = (email) => {
  const domain = getEmailDomain(email);
  if (!domain || isBlockedEmailDomain(domain)) return false;
  return getTrustedEmailDomains().has(domain);
};

const getRegistrationEmailBlockMessage = () => (
  "Temporary or unsupported email addresses are not allowed. Please use Gmail, Yahoo, Outlook, iCloud, Proton, Zoho, or another approved email."
);

// 🔥 NEW: IP Tracking Helper
const normalizeClientIp = (ip) => {
  if (!ip) return "Unknown";
  let normalized = String(ip).trim().replace(/^::ffff:/, "");
  if (normalized.startsWith('[') && normalized.includes(']')) {
    normalized = normalized.slice(1, normalized.indexOf(']'));
  }
  if (normalized.includes(',') ) {
    normalized = normalized.split(',')[0].trim();
  }
  if (net.isIP(normalized) === 4 && normalized.includes(':')) {
    normalized = normalized.split(':')[0];
  }
  normalized = normalized.replace(/^"|"$/g, '').trim();
  return normalized || "Unknown";
};

const isPrivateIp = (ip) => {
  const version = net.isIP(ip);
  if (!version) return false;

  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }

  const normalized = ip.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
};

const isPublicIp = (ip) => {
  const normalized = normalizeClientIp(ip);
  return normalized !== "Unknown" && !isPrivateIp(normalized);
};

const getForwardedClientIp = (req) => {
  const candidates = [
    req.headers?.["cf-connecting-ip"],
    req.headers?.["true-client-ip"],
    req.headers?.["x-real-ip"],
    req.headers?.["x-forwarded-for"],
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ]
    .flatMap((value) => String(value || '').split(','))
    .map(normalizeClientIp)
    .filter((ip) => ip !== 'Unknown');

  return candidates.find(isPublicIp) || candidates[0] || 'Unknown';
};

const normalizeOptionalText = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const normalizeOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractGeoPayload = (body = {}) => ({
  latitude: normalizeOptionalNumber(body.geo_latitude ?? body.latitude),
  longitude: normalizeOptionalNumber(body.geo_longitude ?? body.longitude),
  accuracy: normalizeOptionalNumber(body.geo_accuracy ?? body.accuracy),
  locationLabel: normalizeOptionalText(
    body.geo_location_label ?? body.location_label ?? body.geo_address ?? body.geo_address_label
  ),
  source: normalizeOptionalText(body.geo_source ?? body.location_source),
});

const hasBrowserGeoCoordinates = (geoPayload = {}) => {
  const { latitude, longitude } = geoPayload;
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
};

const getGeoSource = (geoPayload = {}) => (
  hasBrowserGeoCoordinates(geoPayload) || geoPayload.locationLabel
    ? geoPayload.source || 'browser_geolocation'
    : null
);

const formatGeoFallbackLabel = (geoPayload = {}) => (
  hasBrowserGeoCoordinates(geoPayload)
    ? `${Number(geoPayload.latitude).toFixed(5)}, ${Number(geoPayload.longitude).toFixed(5)}`
    : null
);

const buildReverseGeoLabel = (data) => {
  const address = data?.address || {};
  const locality = address.city || address.town || address.village || address.municipality || address.county || address.state_district;
  const region = address.state || address.division;
  const country = address.country;
  return normalizeOptionalText([locality, region, country].filter(Boolean).join(', '))
    || normalizeOptionalText(data?.display_name);
};

const resolveGeoLocationLabel = async (geoPayload = {}) => {
  if (geoPayload.locationLabel) return geoPayload.locationLabel;
  if (!hasBrowserGeoCoordinates(geoPayload)) return null;

  const lat = Number(geoPayload.latitude);
  const lon = Number(geoPayload.longitude);
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (geoLocationCache.has(cacheKey)) return geoLocationCache.get(cacheKey);

  const fallback = formatGeoFallbackLabel(geoPayload);

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'jsonv2',
        lat,
        lon,
        zoom: 10,
        addressdetails: 1,
      },
      headers: {
        'User-Agent': process.env.GEOLOCATION_USER_AGENT || 'PromotInsight/1.0',
        'Accept-Language': 'en',
      },
      timeout: 5000,
    });

    const label = buildReverseGeoLabel(response.data) || fallback;
    geoLocationCache.set(cacheKey, label);
    return label;
  } catch (error) {
    console.error("Browser Location Reverse Geocode Error:", error.message);
    geoLocationCache.set(cacheKey, fallback);
    return fallback;
  }
};

const getClientIp = (req) => {
  return getForwardedClientIp(req);
};

// 🔥 PREMIUM: Automated IP to Location Resolver
const getIpLocation = async (ip) => {
  if (!ip || ip === 'Unknown' || ip === '::1' || ip === '127.0.0.1') return 'Localhost';
  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}`);
    if (response.data && response.data.status === 'success') {
      return [response.data.city, response.data.country].filter(Boolean).join(', ') || 'Unknown Location';
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
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  partitioned: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000 
});

const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  partitioned: process.env.NODE_ENV === 'production',
});

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const stripHeaderUnsafeChars = (value) => String(value || "").replace(/[\r\n]/g, " ").trim();

const validateLength = (value, min, max) => {
  const text = String(value || "").trim();
  return text.length >= min && text.length <= max;
};

const maskEmail = (email) => {
  if (!email) return "Unknown";
  const [name, domain] = email.split('@');
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.substring(0, 2)}***${name[name.length - 1]}@${domain}`;
};

const getPasswordResetSecret = () => {
  const resetSecret = process.env.JWT_RESET_SECRET || process.env.PASSWORD_RESET_SECRET;
  if (resetSecret) return resetSecret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_RESET_SECRET or PASSWORD_RESET_SECRET is required in production");
  }

  console.warn("JWT_RESET_SECRET/PASSWORD_RESET_SECRET is not set; falling back to JWT_SECRET for development only.");
  return process.env.JWT_SECRET;
};

const updateSocialProviderMetadata = async (userId, provider, firebaseUid) => {
  try {
    await pool.query(
      "UPDATE users SET auth_provider = $1, firebase_uid = $2 WHERE id = $3",
      [provider, firebaseUid, userId]
    );
  } catch (error) {
    if (error.code !== "42703") {
      throw error;
    }
  }
};

// 🔥 NEW: Referral Code Generator Helper
const BUYER_REGISTRATION_BONUS_USD = 0;
const BUYER_REFERRAL_BONUS_USD = 0;
const SELLER_REFERRAL_BONUS_USD = 0;
const REFERRAL_REWARDS_ENABLED = false;

const generateReferralCode = (name) => {
  const prefix = name ? name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X') : 'USR';
  const randomString = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${randomString}`;
};

// ==========================================
// 📈 GET PUBLIC LIVE FEED
// ==========================================
const getPublicLiveFeed = async (req, res) => {
  try {
    const earningsRes = await pool.query(`
      SELECT u.email, p.price as amount, a.updated_at as date, 'campaign' as type
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

const PUBLIC_SELLER_BASE_COUNT = 435;
const PUBLIC_BUYER_BASE_COUNT = 4560;

const getPublicUserStats = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT role, COUNT(*)::int AS count
      FROM users
      WHERE role IN ('buyer', 'seller')
      GROUP BY role
    `);

    const counts = result.rows.reduce(
      (acc, row) => ({ ...acc, [row.role]: Number(row.count) || 0 }),
      { buyer: 0, seller: 0 }
    );

    res.status(200).json({
      success: true,
      data: {
        sellers: PUBLIC_SELLER_BASE_COUNT + counts.seller,
        buyers: PUBLIC_BUYER_BASE_COUNT + counts.buyer,
      },
    });
  } catch (error) {
    console.error("PUBLIC USER STATS ERROR:", error);
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
    if (!requireEmailService(res)) return;

    const { email } = req.body;
    
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    const emailTrimmed = email.trim().toLowerCase();

    // 🔥 FRAUD PREVENTION: Block Temporary/Fake Emails
    if (!isTrustedRegistrationEmail(emailTrimmed)) {
      return res.status(400).json({ 
        success: false, 
        message: getRegistrationEmailBlockMessage()
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

   const { data, error } = await resend.emails.send({
      from: 'PromotInsight Security <security@promotinsight.com>',
      to: emailTrimmed,
      subject: "Your Registration Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 500px; margin: auto; border-top: 5px solid #0066ff;">
            <h2 style="color: #333; text-align: center;">Account Verification</h2>
            <p style="color: #555; font-size: 16px;">Welcome to PromotInsight! Your email verification code is:</p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0066ff; background: #f0f7ff; padding: 10px 20px; border-radius: 5px;">${otpCode}</span>
            </div>
            <p style="color: #555; font-size: 14px;">This code will expire in <strong>10 minutes</strong>. Do not share this code with anyone.</p>
          </div>
        </div>
      `
    });

    if (error) {
      console.error("RESEND OTP ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to send verification code" });
    }
    res.status(200).json({ success: true, message: "Verification code sent to your email" });

  } catch (error) {
    console.error("SEND OTP ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to send verification code" });
  }
};

// =======================
// ✅ Register User (Updated with Referral Logic)
// =======================
const registerUser = async (req, res) => {
  try {
    const { name, fullName, email, password, role, otp, referred_by_code } = req.body;
    const finalName = name ? name.trim() : (fullName ? fullName.trim() : '');
    const emailTrimmed = email ? email.trim().toLowerCase() : '';
    const geoPayload = extractGeoPayload(req.body);
    
    // 🔥 Track IP and Location on Register
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);
    const geoLocationLabel = await resolveGeoLocationLabel(geoPayload);
    const geoSource = getGeoSource(geoPayload);

    if (!finalName || !emailTrimmed || !password || !otp) {
      return res.status(400).json({ success: false, message: "All fields including verification code are required" });
    }

    if (!isValidEmail(emailTrimmed)) {
      return res.status(400).json({ success: false, message: "Invalid email format" });
    }

    if (!isTrustedRegistrationEmail(emailTrimmed)) {
      return res.status(400).json({ success: false, message: getRegistrationEmailBlockMessage() });
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

   const userRole =
  role &&
  ["buyer", "seller"].includes(role.trim().toLowerCase())
    ? role.trim().toLowerCase()
    : "buyer";
    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [emailTrimmed]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // 🔥 Referral Logic: Check if referred_by_code is valid
    let referredById = null;
    if (REFERRAL_REWARDS_ENABLED && referred_by_code) {
      const referrerRes = await pool.query("SELECT id FROM users WHERE referral_code = $1", [referred_by_code.trim()]);
      if (referrerRes.rows.length > 0) {
        referredById = referrerRes.rows[0].id;
      }
    }

    // 🔥 Generate Referral Code for the new user
    const newReferralCode = generateReferralCode(finalName);
    const registrationBonus = userRole === 'buyer' ? BUYER_REGISTRATION_BONUS_USD : 0;

    // 🔥 Add IP, Location, Referral Code, and Referrer ID to insertion
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, last_ip, ip_location, geo_latitude, geo_longitude, geo_accuracy, geo_location_label, geo_source, referral_code, referred_by, wallet_balance, trust_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0)
       RETURNING id, name, email, role, verification_status, wallet_balance, loan_credit_balance, trust_score`,
      [
        finalName,
        emailTrimmed,
        hashedPassword,
        userRole,
        ipAddress,
        ipLocation,
        geoPayload.latitude,
        geoPayload.longitude,
        geoPayload.accuracy,
        geoLocationLabel,
        geoSource,
        newReferralCode,
        referredById,
        registrationBonus
      ]
    );

    const user = result.rows[0];
    otpCache.delete(emailTrimmed);

    if (registrationBonus > 0) {
      await pool.query(
        "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'registration_bonus', $3, 'completed')",
        [user.id, registrationBonus, 'New buyer registration bonus']
      );
    }

    // 🔥 Insert into referrals table if user was referred
    if (REFERRAL_REWARDS_ENABLED && referredById) {
      const referralRewardAmount = userRole === 'seller' ? SELLER_REFERRAL_BONUS_USD : BUYER_REFERRAL_BONUS_USD;
      await pool.query(
        `INSERT INTO referrals (referrer_id, referred_id, status, reward_amount) VALUES ($1, $2, 'pending', $3)`
      , [referredById, user.id, referralRewardAmount]);
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie('token', token, getCookieOptions());

    // 🔥 NEW: Send Welcome Email
    await sendEmail({
      to: emailTrimmed,
      subject: "Welcome to Promotinsight!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
          <h2 style="color: #10b981;">Welcome to Promotinsight, ${finalName}!</h2>
          <p>Thank you for signing up. We are thrilled to have you on board.</p>
          <p>Start exploring our platform and discovering great products today.</p>
          <br>
          <p>Best regards,<br><strong>The Promotinsight Team</strong></p>
        </div>
      `
    });

    res.status(201).json({ 
      success: true,
      message: "User registered successfully", 
      user: { id: user.id, name: user.name, email: user.email, role: user.role, verification_status: user.verification_status, wallet_balance: user.wallet_balance, loan_credit_balance: user.loan_credit_balance } 
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
    const geoPayload = extractGeoPayload(req.body);
    
    // 🔥 Track IP and Location on Login
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);
    const geoLocationLabel = await resolveGeoLocationLabel(geoPayload);
    const geoSource = getGeoSource(geoPayload);

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
      "SELECT id, name, email, password_hash, role, verification_status, wallet_balance, loan_credit_balance FROM users WHERE email = $1",
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
    await pool.query(
      `UPDATE users
       SET last_ip = $1,
           ip_location = $2,
           geo_latitude = COALESCE($3, geo_latitude),
           geo_longitude = COALESCE($4, geo_longitude),
           geo_accuracy = COALESCE($5, geo_accuracy),
           geo_location_label = COALESCE($6, geo_location_label),
           geo_source = COALESCE($7, geo_source)
       WHERE id = $8`,
      [
        ipAddress,
        ipLocation,
        geoPayload.latitude,
        geoPayload.longitude,
        geoPayload.accuracy,
        geoLocationLabel,
        geoSource,
        user.id
      ]
    );

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie('token', token, getCookieOptions());

    res.json({
      success: true,
      message: "Login successful",
      user: { id: user.id, name: user.name, email: user.email, role: user.role, verification_status: user.verification_status, wallet_balance: user.wallet_balance, loan_credit_balance: user.loan_credit_balance },
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// =======================
// 🌐 Social Login (Google & Yahoo) - Updated with Referral Logic
// =======================
const socialLogin = async (req, res) => {
  try {
    const { idToken, referred_by_code, role } = req.body;
    const geoPayload = extractGeoPayload(req.body);
    
    // 🔥 Track IP and Location on Social Login
    const ipAddress = getClientIp(req); 
    const ipLocation = await getIpLocation(ipAddress);
    const geoLocationLabel = await resolveGeoLocationLabel(geoPayload);
    const geoSource = getGeoSource(geoPayload);

    if (!idToken) {
      return res.status(400).json({ success: false, message: "Firebase idToken is required for social login" });
    }

    let decodedToken;
    try {
      decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    } catch (verifyError) {
      console.error("FIREBASE TOKEN VERIFY ERROR:", verifyError.code || verifyError.message);

      if (verifyError.code && String(verifyError.code).startsWith("auth/")) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired Firebase login token"
        });
      }

      return res.status(500).json({
        success: false,
        message: "Social login is not configured correctly on the server"
      });
    }
    const verifiedEmail = decodedToken.email;
    const provider = decodedToken.firebase?.sign_in_provider || "firebase";
    const allowedSocialProviders = new Set(["google.com", "yahoo.com"]);

    if (decodedToken.email_verified !== true || !allowedSocialProviders.has(provider)) {
      return res.status(401).json({
        success: false,
        message: "Unsupported or unverified social provider"
      });
    }

    if (!verifiedEmail) {
      return res.status(400).json({ success: false, message: "Verified email is required for social login" });
    }

    const emailTrimmed = verifiedEmail.trim().toLowerCase();
    if (!isTrustedRegistrationEmail(emailTrimmed)) {
      return res.status(400).json({
        success: false,
        message: getRegistrationEmailBlockMessage()
      });
    }

    const providerUid = decodedToken.uid;
    const verifiedName = decodedToken.name || decodedToken.email?.split("@")[0] || "User";
    
    const existingUser = await pool.query(
      "SELECT id, name, email, password_hash, role, verification_status, wallet_balance, loan_credit_balance FROM users WHERE email = $1",
      [emailTrimmed]
    );

    let user;
if (existingUser.rows.length > 0) {
  user = existingUser.rows[0];

  console.log("Existing User Found:");
  console.log("DB Role:", user.role);
  console.log("Requested Role:", role);

    await pool.query(
      `UPDATE users
       SET last_ip = $1,
           ip_location = $2,
           geo_latitude = COALESCE($3, geo_latitude),
           geo_longitude = COALESCE($4, geo_longitude),
           geo_accuracy = COALESCE($5, geo_accuracy),
           geo_location_label = COALESCE($6, geo_location_label),
           geo_source = COALESCE($7, geo_source)
       WHERE id = $8`,
      [
        ipAddress,
        ipLocation,
        geoPayload.latitude,
        geoPayload.longitude,
        geoPayload.accuracy,
        geoLocationLabel,
        geoSource,
        user.id
      ]
    );
  await updateSocialProviderMetadata(user.id, provider, providerUid);
} else {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 12);
      const finalName = verifiedName.trim();

      // 🔥 Referral Logic for Social Login
      let referredById = null;
      if (REFERRAL_REWARDS_ENABLED && referred_by_code) {
        const referrerRes = await pool.query("SELECT id FROM users WHERE referral_code = $1", [referred_by_code.trim()]);
        if (referrerRes.rows.length > 0) {
          referredById = referrerRes.rows[0].id;
        }
      }

      const newReferralCode = generateReferralCode(finalName);
      const normalizedRole = role ? role.trim().toLowerCase() : 'buyer';
      const userRole = normalizedRole === 'seller' ? 'seller' : 'buyer';
      const registrationBonus = userRole === 'buyer' ? BUYER_REGISTRATION_BONUS_USD : 0;

      // 🔥 Insert IP, Location, and Referral Data for new social login user
      const newUser = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, last_ip, ip_location, geo_latitude, geo_longitude, geo_accuracy, geo_location_label, geo_source, referral_code, referred_by, wallet_balance, trust_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0)
         RETURNING id, name, email, role, verification_status, wallet_balance, loan_credit_balance, trust_score`,
        [
          finalName,
          emailTrimmed,
          hashedPassword,
          userRole,
          ipAddress,
          ipLocation,
          geoPayload.latitude,
          geoPayload.longitude,
          geoPayload.accuracy,
          geoLocationLabel,
          geoSource,
          newReferralCode,
          referredById,
          registrationBonus
        ]
      );
      
      user = newUser.rows[0];
      await updateSocialProviderMetadata(user.id, provider, providerUid);

      if (registrationBonus > 0) {
        await pool.query(
          "INSERT INTO transactions (user_id, amount, type, description, status) VALUES ($1, $2, 'registration_bonus', $3, 'completed')",
          [user.id, registrationBonus, 'New buyer registration bonus']
        );
      }

      // 🔥 Insert into referrals table if user was referred
      if (REFERRAL_REWARDS_ENABLED && referredById) {
        const referralRewardAmount = userRole === 'seller' ? SELLER_REFERRAL_BONUS_USD : BUYER_REFERRAL_BONUS_USD;
        await pool.query(
          `INSERT INTO referrals (referrer_id, referred_id, status, reward_amount) VALUES ($1, $2, 'pending', $3)`
        , [referredById, user.id, referralRewardAmount]);
      }
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie('token', token, getCookieOptions());

    res.status(200).json({
      success: true,
      message: `${provider.toUpperCase()} login successful`,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, verification_status: user.verification_status, wallet_balance: user.wallet_balance, loan_credit_balance: user.loan_credit_balance },
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
  res.clearCookie('token', getClearCookieOptions());
  res.status(200).json({ success: true, message: "Logged out successfully" });
};

// ==========================================
// 👤 Get User Profile (Updated to fetch Referral Code)
// ==========================================
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // 🔥 Added referral_code to selection
    const result = await pool.query(
      `SELECT id, name, email, role, wallet_balance, loan_credit_balance, created_at, 
              verification_status, amazon_location, amazon_account, 
              amazon_profile_url, paypal_account, facebook_account, 
              whatsapp_account, telegram_account, is_active, is_frozen, referral_code
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = result.rows[0];
    if (user.role === 'buyer') {
      user.wallet_breakdown = await getBuyerWalletBreakdown(pool, userId);
    }

    res.status(200).json({ success: true, user });

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
// 🛡️ Submit User Verification Info (legacy + dynamic)
// ==========================================
const parseFieldArray = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};

const submitVerification = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      country,
      platforms,
      global: globalBody,
      platform_responses,
      responses,
      amazon_location,
      amazon_account,
      amazon_profile_url,
      paypal_account,
      facebook_account,
      whatsapp_account,
      telegram_account,
    } = req.body;

    const hasDynamicPayload =
      country &&
      Array.isArray(platforms) &&
      platforms.length > 0 &&
      (globalBody || responses?.global || platform_responses || responses?.platforms);
    const isSeller = req.user.role === 'seller';
    const isBuyer = req.user.role === 'buyer';
    const isDynamic = hasDynamicPayload;

    if (isSeller && !hasDynamicPayload) {
      return res.status(400).json({
        success: false,
        message: 'Target country, platform, and store details are required for seller verification.',
      });
    }

    let amazonLoc, amazonAcc, amazonUrl, paypal, facebook, whatsapp, telegram;
    let verificationCountry = null;
    let verificationPlatforms = null;
    let verificationResponses = null;

    if (isDynamic) {
      const globalData = globalBody || responses?.global || {};
      const platData = platform_responses || responses?.platforms || {};

      const globalCfgRes = await pool.query(
        'SELECT fields FROM verification_global_config WHERE id = 1'
      ).catch(() => ({ rows: [] }));

      const globalFields = globalCfgRes.rows.length
        ? parseFieldArray(globalCfgRes.rows[0].fields)
        : [];

      for (const field of globalFields) {
        const val = globalData[field.key];
        const fieldLabel = field.key === 'paypal_account'
          ? (isBuyer ? 'PayPal Email Address' : 'Email Address')
          : field.key === 'facebook_account' ? (isBuyer ? 'Facebook URL' : 'WeChat ID') : field.label;
        const isSellerOptionalContactField = isSeller && ['facebook_account', 'whatsapp_account'].includes(field.key);
        if (field.required && !isSellerOptionalContactField && (!val || !String(val).trim())) {
          return res.status(400).json({
            success: false,
            message: `${fieldLabel} is required.`,
          });
        }
        if (val && field.type === 'email' && !isValidEmail(String(val).trim())) {
          return res.status(400).json({ success: false, message: `${fieldLabel} must be a valid email.` });
        }
        if (val && field.type === 'url' && field.key !== 'facebook_account' && !isValidURL(String(val).trim())) {
          return res.status(400).json({ success: false, message: `${fieldLabel} must be a valid URL.` });
        }
      }

      const { getPlatformFieldsFor } = require('./verificationConfigController');

      for (const platformName of platforms) {
        let platFields = await getPlatformFieldsFor(country.trim(), platformName.trim());

        const platformValues = platData[platformName] || {};
        for (const field of platFields) {
          const val = platformValues[field.key];
          const fieldLabel = field.key === 'account_name'
            ? (isBuyer ? 'Profile Name' : 'Store Name')
            : field.label;
          const isOptionalPlatformField = ['profile_url', 'amazon_profile_url', 'verification_image_url', 'image_url'].includes(field.key);
          if (field.required && !isOptionalPlatformField && (!val || !String(val).trim())) {
            return res.status(400).json({
              success: false,
              message: `${platformName}: ${fieldLabel} is required.`,
            });
          }
          if (val && field.type === 'url' && !isValidURL(String(val).trim())) {
            return res.status(400).json({
              success: false,
              message: `${platformName}: ${fieldLabel} must be a valid URL.`,
            });
          }
        }
      }

      amazonLoc = country.trim();
      const firstPlat = platforms[0];
      const firstVals = platData[firstPlat] || {};
      amazonAcc =
        firstVals.account_name ||
        firstVals.amazon_account ||
        Object.values(firstVals).find((v) => v && typeof v === 'string') ||
        platforms.join(', ');
      amazonUrl =
        firstVals.profile_url ||
        firstVals.amazon_profile_url ||
        '';

      paypal = (globalData.paypal_account || '').trim();
      whatsapp = (globalData.whatsapp_account || '').trim();
      facebook = globalData.facebook_account ? String(globalData.facebook_account).trim() : null;
      telegram = globalData.telegram_account ? String(globalData.telegram_account).trim() : null;

      verificationCountry = country.trim();
      verificationPlatforms = JSON.stringify(platforms);
      verificationResponses = JSON.stringify({ global: globalData, platforms: platData });

      if (!paypal) {
        return res.status(400).json({
          success: false,
          message: isBuyer ? 'PayPal Email Address is required.' : 'Email address is required.',
        });
      }
      if (isBuyer) {
        const buyerContactMessage = getBuyerContactValidationMessage({ facebook, whatsapp });
        if (buyerContactMessage) {
          return res.status(400).json({ success: false, message: buyerContactMessage });
        }
      }
      if (amazonUrl && !isValidURL(amazonUrl)) {
        return res.status(400).json({ success: false, message: 'Profile URL must be a valid link.' });
      }
    } else {
      amazonLoc = amazon_location;
      amazonAcc = amazon_account;
      amazonUrl = amazon_profile_url;
      paypal = paypal_account;
      facebook = facebook_account;
      whatsapp = whatsapp_account;
      telegram = telegram_account;

      if (!amazonLoc || !amazonAcc || !paypal) {
        return res.status(400).json({
          success: false,
          message: 'Platform account info and PayPal info are required!',
        });
      }

      if (isBuyer) {
        const buyerContactMessage = getBuyerContactValidationMessage({ facebook, whatsapp });
        if (buyerContactMessage) {
          return res.status(400).json({ success: false, message: buyerContactMessage });
        }
      }

      if (amazonUrl && !isValidURL(amazonUrl)) {
        return res.status(400).json({ success: false, message: 'Amazon profile must be a valid URL link.' });
      }
    }

    const profileUrlForDup = amazonUrl || '';
    const duplicateCheck = await pool.query(
      `SELECT id FROM users
       WHERE (($1 <> '' AND whatsapp_account = $1) OR ($2 <> '' AND amazon_profile_url = $2))
       AND id != $3`,
      [whatsapp ? whatsapp.trim() : '', profileUrlForDup.trim(), userId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          'Fraud Alert: This WhatsApp number or profile URL is already linked with another account!',
      });
    }

    const baseParams = [
      amazonLoc.trim(),
      amazonAcc.trim(),
      amazonUrl ? amazonUrl.trim() : '',
      paypal.trim(),
      facebook,
      whatsapp ? whatsapp.trim() : '',
      telegram,
      userId,
    ];

    let result;
    try {
      result = await pool.query(
        `UPDATE users
         SET amazon_location = $1, amazon_account = $2, amazon_profile_url = $3,
             paypal_account = $4, facebook_account = $5, whatsapp_account = $6,
             telegram_account = $7, verification_status = 'pending',
             verification_country = COALESCE($8, verification_country),
             verification_platforms = COALESCE($9::jsonb, verification_platforms),
             verification_responses = COALESCE($10::jsonb, verification_responses)
         WHERE id = $11 RETURNING *`,
        [
          ...baseParams.slice(0, 7),
          verificationCountry,
          verificationPlatforms,
          verificationResponses,
          userId,
        ]
      );
    } catch {
      result = await pool.query(
        `UPDATE users
         SET amazon_location = $1, amazon_account = $2, amazon_profile_url = $3,
             paypal_account = $4, facebook_account = $5, whatsapp_account = $6,
             telegram_account = $7, verification_status = 'pending'
         WHERE id = $8 RETURNING *`,
        baseParams
      );
    }

    res.status(200).json({
      success: true,
      message: 'Verification submitted successfully!',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('SUBMIT VERIFICATION ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 🛡️ ADMIN: Get All Users By Role
// ==========================================
const getAllUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const statsJoin = role === 'seller'
      ? `LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed_orders,
             COUNT(*) FILTER (WHERE a.status IN ('rejected', 'disputed'))::int AS failed_orders,
             COUNT(*) FILTER (WHERE a.status IN ('completed', 'rejected', 'disputed'))::int AS total_ranked_orders
           FROM products p
           LEFT JOIN applications a ON a.product_id = p.id
           WHERE p.seller_id = u.id
         ) stats ON true`
      : `LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed_orders,
             COUNT(*) FILTER (WHERE a.status IN ('rejected', 'disputed'))::int AS failed_orders,
             COUNT(*) FILTER (WHERE a.status IN ('completed', 'rejected', 'disputed'))::int AS total_ranked_orders
           FROM applications a
           WHERE a.user_id = u.id
         ) stats ON true`;

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.wallet_balance, u.loan_credit_balance, u.trust_score, u.user_rank,
              u.verification_status, u.is_active, u.is_frozen, u.created_at, u.last_ip, u.ip_location,
              u.geo_latitude, u.geo_longitude, u.geo_accuracy, u.geo_location_label, u.geo_source,
              CASE
                WHEN COALESCE(BTRIM(u.ip_location), '') NOT IN ('', 'Unknown', 'Unknown Location', 'Location Unavailable') THEN u.ip_location
                WHEN COALESCE(BTRIM(u.verification_country), '') <> '' THEN u.verification_country
                WHEN COALESCE(BTRIM(u.amazon_location), '') <> '' THEN u.amazon_location
                ELSE 'Unknown Location'
              END AS location_label,
              COALESCE(stats.completed_orders, 0) AS completed_orders,
              COALESCE(stats.failed_orders, 0) AS failed_orders,
              COALESCE(stats.total_ranked_orders, 0) AS total_ranked_orders
       FROM users u
       ${statsJoin}
       WHERE u.role = $1
       ORDER BY u.created_at DESC`,
      [role]
    );
    res.status(200).json({ success: true, data: result.rows.map(addAutomaticRank) });
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
      `SELECT id, name, email, role, wallet_balance, loan_credit_balance, created_at, 
              verification_status, amazon_location, amazon_account, 
              amazon_profile_url, paypal_account, facebook_account, 
              whatsapp_account, telegram_account, verification_country, verification_platforms, verification_responses,
              trust_score, user_rank, is_active, is_frozen, last_ip, ip_location,
              geo_latitude, geo_longitude, geo_accuracy, geo_location_label, geo_source,
              CASE
                WHEN COALESCE(BTRIM(ip_location), '') NOT IN ('', 'Unknown', 'Unknown Location', 'Location Unavailable') THEN ip_location
                WHEN COALESCE(BTRIM(verification_country), '') <> '' THEN verification_country
                WHEN COALESCE(BTRIM(amazon_location), '') <> '' THEN amazon_location
                ELSE 'Unknown Location'
              END AS location_label
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = result.rows[0];
    const statsResult = user.role === 'seller'
      ? await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed_orders,
             COUNT(*) FILTER (WHERE a.status IN ('rejected', 'disputed'))::int AS failed_orders,
             COUNT(*) FILTER (WHERE a.status IN ('completed', 'rejected', 'disputed'))::int AS total_ranked_orders
           FROM products p
           LEFT JOIN applications a ON a.product_id = p.id
           WHERE p.seller_id = $1`,
          [userId]
        )
      : await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_orders,
             COUNT(*) FILTER (WHERE status IN ('rejected', 'disputed'))::int AS failed_orders,
             COUNT(*) FILTER (WHERE status IN ('completed', 'rejected', 'disputed'))::int AS total_ranked_orders
           FROM applications
           WHERE user_id = $1`,
          [userId]
        );

    res.status(200).json({
      success: true,
      data: addAutomaticRank({ ...user, ...statsResult.rows[0] }),
    });
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
// 💳 Deposit Funds (Updated with Screenshot & User Data)
// ==========================================
const depositFunds = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 🔥 UPDATE: Frontend থেকে আসা সব ডাটা রিসিভ করা হচ্ছে
    const { 
      amount, payment_method, transaction_id, 
      screenshot_url, account_details, crypto_address, crypto_network, crypto_memo 
    } = req.body;
    
    const amountValue = Number(amount);

    if (!amountValue || amountValue <= 0 || !payment_method || !transaction_id || !transaction_id.trim()) {
      return res.status(400).json({ success: false, message: "Valid amount, payment method, and transaction ID are required" });
    }

    // 🔥 UPDATE: ডাটাবেসে ছবি এবং সেলারের অন্যান্য ইনপুট ডাটা সেভ করা হচ্ছে
    const result = await pool.query(
      `INSERT INTO deposits 
        (user_id, amount, payment_method, transaction_id, screenshot_url, account_details, crypto_address, crypto_network, crypto_memo, status)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') 
       RETURNING *`,
      [
        userId, 
        amountValue, 
        payment_method.trim(), 
        transaction_id.trim(),
        screenshot_url ? screenshot_url.trim() : null,
        account_details ? account_details.trim() : null,
        crypto_address ? crypto_address.trim() : null,
        crypto_network ? crypto_network.trim() : null,
        crypto_memo ? crypto_memo.trim() : null
      ]
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

const updateBuyerLoanCredit = async (req, res) => {
  try {
    const userId = req.params.id;
    const { loan_credit_balance } = req.body;
    const creditValue = Number(loan_credit_balance);

    if (!Number.isFinite(creditValue) || creditValue < 0) {
      return res.status(400).json({ success: false, message: "Loan credit must be a valid non-negative amount" });
    }

    const result = await pool.query(
      `UPDATE users
       SET loan_credit_balance = $1
       WHERE id = $2 AND role = 'buyer'
       RETURNING id, name, email, role, loan_credit_balance`,
      [creditValue, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Buyer user not found" });
    }

    res.status(200).json({
      success: true,
      message: "Buyer loan credit updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("UPDATE LOAN CREDIT ERROR:", error);
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
    if (!requireEmailService(res)) return;

    const { email } = req.body;
    
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email.trim()]);
    if (userResult.rows.length === 0) {
      return res.status(200).json({ success: true, message: "If your email is registered, a reset link will be sent." });
    }

    const user = userResult.rows[0];
    const token = jwt.sign(
      { id: String(user.id), purpose: "password_reset" },
      getPasswordResetSecret(),
      { expiresIn: '15m' }
    );

    const resetLink = `https://promotinsight.com/reset-password/${user.id}/${token}`;

    const { data, error } = await resend.emails.send({
      from: 'PromotInsight <noreply@promotinsight.com>',
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
    });

    if (error) {
      console.error("RESEND FORGOT PASS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to send reset link." });
    }
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

    jwt.verify(token, getPasswordResetSecret(), async (err, decoded) => {
      if (err) {
        return res.status(400).json({ success: false, message: "Invalid or expired token." });
      }

      if (!decoded || decoded.purpose !== "password_reset" || String(decoded.id) !== String(id)) {
        return res.status(400).json({ success: false, message: "Invalid password reset token." });
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

// ==========================================
// 📧 Receive Contact Support Message (🔥 NEW FUNCTION ADDED)
// ==========================================
const sendContactEmail = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    const safeName = stripHeaderUnsafeChars(name);
    const safeEmail = stripHeaderUnsafeChars(email).toLowerCase();
    const safeSubject = stripHeaderUnsafeChars(subject || "Contact support request");
    const safeMessage = String(message || "").trim();

    if (!validateLength(safeName, 1, 80) || !validateLength(safeEmail, 3, 254) || !validateLength(safeSubject, 1, 120) || !validateLength(safeMessage, 1, 2000)) {
      return res.status(400).json({ success: false, message: "Please provide a valid name, email, subject, and message." });
    }

    if (!isValidEmail(safeEmail)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }

    if (!requireEmailService(res)) return;

    const { data, error } = await resend.emails.send({
      from: 'PromotInsight Support <support@promotinsight.com>',
      replyTo: safeEmail,
      to: 'promotinsight@gmail.com', // Ei email e apni support message gulo paben
      subject: `New Support Request: ${safeSubject}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; max-width: 600px; border-top: 5px solid #0066ff;">
            <h2 style="color: #333;">New Support Request</h2>
            <p><strong>Name:</strong> ${escapeHtml(safeName)}</p>
            <p><strong>Email:</strong> ${escapeHtml(safeEmail)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(safeSubject)}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p><strong>Message:</strong></p>
            <p style="background: #f9f9f9; padding: 15px; border-radius: 5px; color: #555; white-space: pre-wrap;">${escapeHtml(safeMessage)}</p>
          </div>
        </div>
      `
    });

    if (error) {
      console.error("RESEND CONTACT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to send message" });
    }
    res.status(200).json({ success: true, message: "Message sent successfully" });

  } catch (error) {
    console.error("SUPPORT EMAIL ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

module.exports = {
  getPublicLiveFeed,      
  getPublicUserStats,
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
  updateBuyerLoanCredit,
  submitAppeal,
  getPendingAppeals,
  resolveAppeal,
  forgotPassword, 
  resetPassword,
  submitVerification,
  getAllUsersByRole,
  updateUserStatus,
  getAdminUserDetailsById,
  sendContactEmail // 🔥 EXPORTED NEW FUNCTION
};
