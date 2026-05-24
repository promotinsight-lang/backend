const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const { protect } = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");

const {
  requestWithdrawal,
  getMyWithdrawals,
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal
} = require("../controllers/withdrawalController");

// ==========================================
// 🛡️ Rate Limiters (Defense in Depth)
// ==========================================
// Prevent malicious users from spamming withdrawal requests (Financial Security)
const withdrawalRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 withdrawal requests per window
  message: { success: false, message: "Too many withdrawal requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Prevent automated scripts from rapidly approving/rejecting requests
const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit admin to 50 approval/rejection actions per window
  message: { success: false, message: "Too many admin actions from this IP. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================
// 💸 Withdrawal Routes (Buyer & Seller)
// ==========================
// Request a withdrawal
router.post("/", protect, authorize("buyer", "seller"), withdrawalRequestLimiter, requestWithdrawal);

// Get my withdrawal history
router.get("/my", protect, authorize("buyer", "seller"), getMyWithdrawals);

// ==========================
// 👑 Admin Routes
// ==========================
// Get all withdrawal requests
router.get("/all", protect, authorize("admin"), getAllWithdrawals);

// Approve withdrawal
router.patch("/:id/approve", protect, authorize("admin"), adminActionLimiter, approveWithdrawal);

// Reject withdrawal (Refunds money)
router.patch("/:id/reject", protect, authorize("admin"), adminActionLimiter, rejectWithdrawal);

module.exports = router;