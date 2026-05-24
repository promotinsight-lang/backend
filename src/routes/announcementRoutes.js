const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const authorize = require("../middleware/roleMiddleware");
const {
  createAnnouncement,
  getActiveAnnouncements,
  getAllAnnouncementsAdmin,
  deleteAnnouncement
} = require("../controllers/announcementController");

// 🔓 লগইন করা সব ইউজার ঘোষণা দেখতে পারবে
router.get("/", protect, getActiveAnnouncements);

// 🔒 অ্যাডমিন রাউটস
router.post("/", protect, authorize("admin"), createAnnouncement);
router.get("/admin/all", protect, authorize("admin"), getAllAnnouncementsAdmin);
router.delete("/:id", protect, authorize("admin"), deleteAnnouncement);

module.exports = router;