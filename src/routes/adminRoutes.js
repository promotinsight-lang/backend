const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const { protect } = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");

const {
  getDashboardStats, getPendingDeposits, approveDeposit, rejectDeposit,
  updatePaymentSetting, getPendingVerifications, verifyUser, getAppeals,        
  approveAppeal, rejectAppeal, getMonthlyStats
} = require("../controllers/adminController");

const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests from this IP, please try again after 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

router.use(protect, authorize("admin"));

// Analytics
router.get("/stats", getDashboardStats);
router.get("/monthly-stats", getMonthlyStats);

// Deposits
router.get("/deposits", getPendingDeposits);
router.patch("/deposits/:id/approve", adminActionLimiter, approveDeposit);
router.patch("/deposits/:id/reject", adminActionLimiter, rejectDeposit);

// Settings
router.patch("/payment-settings/:id", adminActionLimiter, updatePaymentSetting);

// Users
router.get("/verifications", getPendingVerifications);
router.patch("/verify-user/:id", adminActionLimiter, verifyUser);

// Appeals
router.get("/appeals", getAppeals);
router.patch("/appeals/:id/approve", adminActionLimiter, approveAppeal);
router.patch("/appeals/:id/reject", adminActionLimiter, rejectAppeal);

module.exports = router;