const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const {
  getPublicLiveFeed,      
  generateCaptcha,        
  sendRegistrationOtp,    
  registerUser,
  loginUser,
  socialLogin, 
  logoutUser, 
  getUserProfile,
  updateUserName, // 🔥 IMPORTED
  depositFunds,
  getMyDeposits,
  getPaymentSettings,
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
} = require("../controllers/userController");

const { protect } = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");
const { blockVPNAndProxy } = require("../middleware/vpnCheck"); // 🔥 IMPORTED VPN CHECKER

// ==========================================
// 🛡️ Rate Limiters (Defense in Depth)
// ==========================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, 
  message: { success: false, message: "Too many authentication attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 3, 
  message: { success: false, message: "Too many password reset requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, 
  max: 3, 
  message: { success: false, message: "Too many OTP requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const financialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, 
  message: { success: false, message: "Too many deposit requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================
// 🔐 Authentication Routes (Public)
// ==========================

router.get("/live-feed", getPublicLiveFeed);
router.get("/captcha", generateCaptcha);
router.post("/send-otp", otpLimiter, sendRegistrationOtp);

// 🔥 VPN CHECKER ADDED TO SENSITIVE ROUTES
router.post("/register", blockVPNAndProxy, authLimiter, registerUser);
router.post("/login", blockVPNAndProxy, authLimiter, loginUser);
router.post("/social-login", blockVPNAndProxy, authLimiter, socialLogin);

router.post("/logout", logoutUser); 

router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.patch("/reset-password/:id/:token", passwordResetLimiter, resetPassword);

// ==========================
// 👤 User Profile & Verification
// ==========================
router.get("/profile", protect, getUserProfile);
router.post("/verify", protect, submitVerification);
router.patch("/profile/name", protect, updateUserName); // 🔥 EDIT NAME ROUTE ADDED

// ==========================
// 💳 Financial & Settings Routes
// ==========================
router.post("/deposit", protect, financialLimiter, depositFunds);
router.get("/deposits", protect, getMyDeposits);
router.get("/payment-settings", protect, getPaymentSettings);

// ==========================
// ⚖️ Appeals (User)
// ==========================
router.post("/appeal", protect, submitAppeal);

// ==========================
// 👑 Admin Routes (Strictly Protected)
// ==========================
router.get("/admin/role/:role", protect, authorize("admin"), getAllUsersByRole);
router.patch("/admin/status/:id", protect, authorize("admin"), updateUserStatus);
router.patch("/:id/trust-score", protect, authorize("admin"), updateTrustScore);
router.get("/admin/user/:id", protect, authorize("admin"), getAdminUserDetailsById);

router.get("/admin/appeals", protect, authorize("admin"), getPendingAppeals);
router.patch("/admin/appeal/:id", protect, authorize("admin"), resolveAppeal);

module.exports = router;