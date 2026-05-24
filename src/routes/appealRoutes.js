const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { 
    submitAppeal,
    createOrderDispute, 
    getAllAppeals, 
    approveAppeal, 
    rejectAppeal,
    favorSeller,
    favorBuyer,
    getMyAppeals 
} = require('../controllers/appealController');

const { protect } = require('../middleware/authMiddleware'); 
const authorize = require('../middleware/roleMiddleware'); 

// ==========================================
// 🛡️ Rate Limiters (Defense in Depth)
// ==========================================
// Prevent spamming appeals and database exhaustion
const appealSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 appeal submissions per window
  message: { success: false, message: "Too many appeals submitted from this IP, please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Prevent rapid-fire admin dispute resolutions (Anti-automation)
const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 admin actions per window
  message: { success: false, message: "Too many admin actions from this IP, please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================================
// 👤 User (Buyer/Seller) Routes
// ==========================================
// General Account Ban Appeal (Both roles)
router.post('/submit', protect, appealSubmitLimiter, submitAppeal);

// Seller filing an order dispute against a buyer
router.post('/order', protect, authorize('seller'), appealSubmitLimiter, createOrderDispute);

// Fetch seller's own appeals
router.get('/my', protect, authorize('seller'), getMyAppeals);

// ==========================================
// 👑 Admin Routes
// ==========================================
// Admin reading and handling standard appeals
router.get('/', protect, authorize('admin'), getAllAppeals);
router.patch('/:id/approve', protect, authorize('admin'), adminActionLimiter, approveAppeal);
router.patch('/:id/reject', protect, authorize('admin'), adminActionLimiter, rejectAppeal);

// Admin resolving order disputes (Seller vs Buyer)
router.patch('/dispute/:id/favor-seller', protect, authorize('admin'), adminActionLimiter, favorSeller);
router.patch('/dispute/:id/favor-buyer', protect, authorize('admin'), adminActionLimiter, favorBuyer);

module.exports = router;