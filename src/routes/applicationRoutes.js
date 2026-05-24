const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const { protect } = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");

const {
  applyToProduct, approveApplication, rejectApplication, deleteApplicationAdmin, 
  getApplicationsByProduct, getMyApplications, submitOrder, forwardOrderToSeller, 
  approveOrder, rejectOrder, submitReview, approveReview, rejectReview,        
  sellerApproveReview, confirmRefund, getSellerProductReviews, getAllApplicationsAdmin
} = require("../controllers/applicationController");

// ==========================================
// 🛡️ Rate Limiters
// ==========================================
const buyerActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, 
  message: { success: false, message: "Too many requests. Please try again after 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

const sellerActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50, 
  message: { success: false, message: "Too many actions from this IP. Please try again after 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 150, 
  message: { success: false, message: "Too many admin actions from this IP. Please try again after 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

// ==========================
// 🛍️ Buyer Routes (Static First)
// ==========================
router.post("/apply", protect, authorize("buyer"), buyerActionLimiter, applyToProduct);
router.get("/my", protect, authorize("buyer"), getMyApplications);

// ==========================
// 👑 Admin Routes (Static First)
// ==========================
router.get("/all", protect, authorize("admin"), getAllApplicationsAdmin); 

// ==========================
// 🏪 Seller Routes
// ==========================
router.get("/seller/product/:id/reviews", protect, authorize("seller"), getSellerProductReviews);
router.patch("/seller/:id/approve", protect, authorize("seller"), sellerActionLimiter, sellerApproveReview);

// ==========================
// 🛠️ Dynamic Admin/Shared Routes (Bottom)
// ==========================
router.get("/product/:id", protect, authorize("admin", "seller"), getApplicationsByProduct);

// Buyer Actions on ID
router.patch("/:id/order", protect, authorize("buyer"), buyerActionLimiter, submitOrder);
router.patch("/:id/review", protect, authorize("buyer"), buyerActionLimiter, submitReview);

// Admin Actions on ID
router.patch("/:id/approve", protect, authorize("admin"), adminActionLimiter, approveApplication);
router.patch("/:id/approve-order", protect, authorize("admin"), adminActionLimiter, approveOrder);
router.patch("/:id/approve-review", protect, authorize("admin"), adminActionLimiter, approveReview);
router.patch("/:id/forward", protect, authorize("admin"), adminActionLimiter, forwardOrderToSeller);
router.patch("/:id/reject", protect, authorize("admin"), adminActionLimiter, rejectApplication);
router.patch("/:id/reject-order", protect, authorize("admin"), adminActionLimiter, rejectOrder);
router.patch("/:id/reject-review", protect, authorize("admin"), adminActionLimiter, rejectReview);
router.patch("/:id/confirm-refund", protect, authorize("admin"), adminActionLimiter, confirmRefund);
router.delete("/:id/delete", protect, authorize("admin"), adminActionLimiter, deleteApplicationAdmin);

module.exports = router;