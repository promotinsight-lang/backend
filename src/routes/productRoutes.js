const express = require("express");
const router = express.Router();
const multer = require("multer");
const rateLimit = require("express-rate-limit");

// ==========================================
// 🛡️ Secure File Upload Configuration (Multer)
// ==========================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) { 
    cb(null, 'uploads/'); 
  },
  filename: function (req, file, cb) { 
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, Date.now() + '-' + safeName); 
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/png" || file.mimetype === "image/webp") {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WEBP are allowed."), false);
    }
  }
});

const { protect } = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");

// 🔥 Added getMyRefunds and getAllRefunds logic here
const {
  createProduct, cancelProduct, editProduct, getPublicProducts, getProducts,
  approveProduct, stopProductAdmin, resumeProductAdmin, rejectProductAdmin, 
  getMyProducts, getProductById, getMyRefunds, getAllRefunds
} = require("../controllers/productController");

// ==========================================
// 🛡️ Rate Limiters
// ==========================================
const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150, 
  message: { success: false, message: "Too many requests from this IP. Please try again later." },
  standardHeaders: true, legacyHeaders: false,
});

const sellerActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, 
  message: { success: false, message: "Too many product actions. Please try again after 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, 
  message: { success: false, message: "Too many admin actions. Please try again after 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

// ==========================
// 🌍 Public Routes & Static Shared (Must be at top)
// ==========================
router.get("/public", publicApiLimiter, getPublicProducts);
router.get("/", protect, getProducts); 

// ==========================
// 💰 Refund History Routes (Must be BEFORE dynamic /:id route)
// ==========================
router.get("/refunds/my", protect, authorize("seller"), getMyRefunds);
router.get("/refunds/all", protect, authorize("admin"), getAllRefunds);

// ==========================
// 🏪 Seller Routes (Static first)
// ==========================
router.post("/", protect, authorize("seller"), sellerActionLimiter, upload.single('image'), createProduct);
router.get("/my", protect, authorize("seller"), getMyProducts);

// ==========================
// 👑 Admin Routes (Specific Paths)
// ==========================
router.patch("/:id/approve", protect, authorize("admin"), adminActionLimiter, approveProduct);
router.patch("/:id/stop", protect, authorize("admin"), adminActionLimiter, stopProductAdmin);
router.patch("/:id/resume", protect, authorize("admin"), adminActionLimiter, resumeProductAdmin);
router.patch("/:id/reject", protect, authorize("admin"), adminActionLimiter, rejectProductAdmin);

// ==========================
// 🛠️ Dynamic Parameter Routes (MUST BE AT THE VERY BOTTOM TO PREVENT SHADOWING)
// ==========================
router.get("/:id", publicApiLimiter, protect, getProductById); 
router.patch("/:id", protect, authorize("seller"), sellerActionLimiter, editProduct);
router.delete("/:id", protect, authorize("seller"), sellerActionLimiter, cancelProduct);

module.exports = router;