const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { upsertFeeConfig, getFeeConfig, getAllFeeConfigs, deleteFeeConfig } = require('../controllers/feeConfigController');
const { protect } = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const adminFeeConfigLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 80,
    message: { success: false, message: 'Too many fee configuration actions. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// 🌍 Public Routes (যে কেউ, এমনকি লগিন ছাড়াও ডাটা দেখতে পারবে)
// ==========================================
// Public lookup for seller calculator and product listing previews.
router.get('/', getFeeConfig);
// 🔥 FIXED: Removed protect & authorize('admin') to allow public dropdowns in HomePage
router.get('/all', getAllFeeConfigs); 

// ==========================================
// 🔒 Secured Admin Routes (শুধুমাত্র অ্যাডমিন সেভ ও ডিলিট করতে পারবে)
// ==========================================
// Admin-only fee configuration management.
router.post('/', protect, authorize('admin'), adminFeeConfigLimiter, upsertFeeConfig);
router.delete('/:country/:platform', protect, authorize('admin'), adminFeeConfigLimiter, deleteFeeConfig);

module.exports = router;