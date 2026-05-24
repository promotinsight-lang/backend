const pool = require("../config/db");

// ==========================================
// 📢 CREATE ANNOUNCEMENT (Admin Only)
// ==========================================
const createAnnouncement = async (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    const result = await pool.query(
      "INSERT INTO announcements (title, message) VALUES ($1, $2) RETURNING *",
      [title.trim(), message.trim()]
    );

    res.status(201).json({ 
      success: true, 
      message: "Announcement published successfully", 
      data: result.rows[0] 
    });
  } catch (error) {
    console.error("CREATE ANNOUNCEMENT ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🌍 GET ACTIVE ANNOUNCEMENTS (For Logged-in Users)
// ==========================================
const getActiveAnnouncements = async (req, res) => {
  try {
    // শুধুমাত্র একটিভ ঘোষণাগুলো দেখাবে এবং লেটেস্টটি সবার আগে থাকবে
    const result = await pool.query(
      "SELECT * FROM announcements WHERE is_active = TRUE ORDER BY created_at DESC"
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET ANNOUNCEMENTS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 👑 GET ALL ANNOUNCEMENTS (Admin Only - For Management)
// ==========================================
const getAllAnnouncementsAdmin = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM announcements ORDER BY created_at DESC");
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// ❌ DELETE ANNOUNCEMENT (Admin Only)
// ==========================================
const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM announcements WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    res.status(200).json({ success: true, message: "Announcement deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createAnnouncement,
  getActiveAnnouncements,
  getAllAnnouncementsAdmin,
  deleteAnnouncement
};