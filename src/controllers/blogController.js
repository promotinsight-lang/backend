const pool = require("../config/db");

// ==========================================
// 🛡️ Create a New Blog Post (ADMIN)
// ==========================================
const createBlog = async (req, res) => {
  try {
    const { title, content, author_name, is_published } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    // Create a URL-friendly slug from the title
    let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    
    // Check if slug exists, if so, append a random number
    const slugCheck = await pool.query("SELECT id FROM blogs WHERE slug = $1", [slug]);
    if (slugCheck.rows.length > 0) {
      slug = `${slug}-${Math.floor(Math.random() * 10000)}`;
    }

    let image_url = null;
    if (req.file) {
      image_url = `http://localhost:5000/uploads/${req.file.filename}`;
    }

    const result = await pool.query(
      `INSERT INTO blogs (title, slug, content, image_url, author_name, is_published) 
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true)) RETURNING *`,
      [title.trim(), slug, content.trim(), image_url, author_name || 'Admin', is_published]
    );

    res.status(201).json({ success: true, message: "Blog published successfully!", data: result.rows[0] });
  } catch (error) {
    console.error("CREATE BLOG ERROR:", error);
    res.status(500).json({ success: false, message: "Server error while creating blog." });
  }
};

// ==========================================
// 🌍 Get All Public Blogs (No Auth Required)
// ==========================================
const getPublicBlogs = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, slug, image_url, author_name, created_at FROM blogs WHERE is_published = true ORDER BY created_at DESC"
    );
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("GET PUBLIC BLOGS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ Get All Blogs for Admin (Includes Drafts)
// ==========================================
const getAllBlogsAdmin = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM blogs ORDER BY created_at DESC");
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("GET ADMIN BLOGS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 📖 Get Single Blog by Slug (Public)
// ==========================================
const getBlogBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query("SELECT * FROM blogs WHERE slug = $1", [slug]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("GET BLOG BY SLUG ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ Delete Blog Post (ADMIN)
// ==========================================
const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM blogs WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    res.status(200).json({ success: true, message: "Blog deleted successfully." });
  } catch (error) {
    console.error("DELETE BLOG ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createBlog,
  getPublicBlogs,
  getAllBlogsAdmin,
  getBlogBySlug,
  deleteBlog
};