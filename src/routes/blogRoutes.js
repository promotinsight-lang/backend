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
  updateBlog,
  deleteBlog
} = require("../controllers/blogController");
const { rebuildFrontendSite } = require("../controllers/siteRebuildController");

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

// Existing blog edit/update korar jonno
router.put("/:id", protect, isAdmin, upload.single("image"), updateBlog);

// Admin panel-e sob blog (published + draft) eksathe dekhar jonno
router.get("/admin/all", protect, isAdmin, getAllBlogsAdmin);

// Published blog data change hole prerendered frontend blog pages rebuild korar jonno
router.post("/admin/rebuild-site", protect, isAdmin, rebuildFrontendSite);

// Kono blog delete korar jonno
router.delete("/:id", protect, isAdmin, deleteBlog);

module.exports = router;
