const express = require("express");
const router = express.Router();

// ==========================================
// 🛠️ MIDDLEWARE IMPORTS
// ==========================================
// Dhyan rakhben: Ei file gulo jeno apnar middleware folder e thake
const { protect, isAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload"); 

// ==========================================
// 🎮 CONTROLLER IMPORTS
// ==========================================
const {
  createBlog,
  getPublicBlogs,
  getAllBlogsAdmin,
  getBlogBySlug,
  deleteBlog
} = require("../controllers/blogController");

// ==========================================
// 🌍 PUBLIC ROUTES (Kono Login/Auth lagbe na)
// ==========================================
// Sob public blog dekhar jonno (Public user/Buyer der jonno)
router.get("/public", getPublicBlogs);

// Slug (URL) diye nirdisto ekti blog dekhar jonno
router.get("/public/:slug", getBlogBySlug);

// ==========================================
// 🛡️ ADMIN ONLY ROUTES (Sudhu Admin access pabe)
// ==========================================
// Notun blog toiri kora (Image upload soho)
router.post("/", protect, isAdmin, upload.single("image"), createBlog);

// Admin panel-e sob blog (published + draft) eksathe dekhar jonno
router.get("/admin/all", protect, isAdmin, getAllBlogsAdmin);

// Kono blog delete korar jonno
router.delete("/:id", protect, isAdmin, deleteBlog);

module.exports = router;