const pool = require("../config/db");
const cloudinary = require("cloudinary").v2;
const sanitizeHtml = require("sanitize-html");

const sanitizeBlogContent = (content) => sanitizeHtml(content, {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'pre', 'code',
    'span', 'img'
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    span: ['class'],
    code: ['class'],
    pre: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
});

// 🔥 এই কনফিগারেশন ব্লকটি যোগ করুন
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ... আপনার বাকি কোড নিচে যেমন ছিল তেমনই থাকবে ...
// ==========================================
// 🛡️ Create a New Blog Post (ADMIN)
// ==========================================
const uploadBlogImage = async (file) => {
  if (!file) return null;

  const uploadResult = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "promotinsight/blogs" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(file.buffer);
  });

  return uploadResult.secure_url;
};

const createUniqueSlug = async (title, excludeId = null) => {
  const baseSlug =
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') ||
    `blog-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 1;

  while (true) {
    const query = excludeId
      ? "SELECT id FROM blogs WHERE slug = $1 AND id != $2"
      : "SELECT id FROM blogs WHERE slug = $1";
    const params = excludeId ? [slug, excludeId] : [slug];
    const slugCheck = await pool.query(query, params);
    if (slugCheck.rows.length === 0) return slug;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
};

const createBlog = async (req, res) => {
  try {
    const { title, content, author_name, is_published } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    const slug = await createUniqueSlug(title.trim());

    let image_url = null;

    // 🔥 Cloudinary-তে ছবি আপলোডের লজিক
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "promotinsight/blogs", // Cloudinary-তে এই ফোল্ডারে ছবি সেভ হবে
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          // Multer memory storage থেকে পাওয়া বাফার পাঠানো হচ্ছে
          uploadStream.end(req.file.buffer); 
        });

        // আপলোড সফল হলে Cloudinary-র ডিরেক্ট URL সেভ করে নেওয়া হচ্ছে
        image_url = uploadResult.secure_url;
      } catch (uploadError) {
        console.error("CLOUDINARY UPLOAD ERROR:", uploadError);
        return res.status(500).json({ success: false, message: "Failed to upload image to Cloudinary." });
      }
    }

    // ডেটাবেজে সেভ করা (URL সহ)
    const sanitizedContent = sanitizeBlogContent(content.trim());

    const result = await pool.query(
      `INSERT INTO blogs (title, slug, content, image_url, author_name, is_published) 
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true)) RETURNING *`,
      [title.trim(), slug, sanitizedContent, image_url, author_name || 'Admin', is_published]
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

    res.status(200).json({
      success: true,
      data: {
        ...result.rows[0],
        content: sanitizeBlogContent(result.rows[0].content || ''),
      },
    });
  } catch (error) {
    console.error("GET BLOG BY SLUG ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ==========================================
// 🛡️ Delete Blog Post (ADMIN)
// ==========================================
const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, author_name, is_published } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    const existing = await pool.query("SELECT * FROM blogs WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    let image_url = existing.rows[0].image_url;
    if (req.file) {
      try {
        image_url = await uploadBlogImage(req.file);
      } catch (uploadError) {
        console.error("CLOUDINARY UPLOAD ERROR:", uploadError);
        return res.status(500).json({ success: false, message: "Failed to upload image to Cloudinary." });
      }
    }

    const slug = await createUniqueSlug(title.trim(), id);
    const sanitizedContent = sanitizeBlogContent(content.trim());
    const params = [
      title.trim(),
      slug,
      sanitizedContent,
      image_url,
      author_name || existing.rows[0].author_name || 'Admin',
      is_published,
      id,
    ];

    let result;
    try {
      result = await pool.query(
        `UPDATE blogs
         SET title = $1, slug = $2, content = $3, image_url = $4, author_name = $5,
             is_published = COALESCE($6, is_published), updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 RETURNING *`,
        params
      );
    } catch (error) {
      if (error.code !== "42703") throw error;
      result = await pool.query(
        `UPDATE blogs
         SET title = $1, slug = $2, content = $3, image_url = $4, author_name = $5,
             is_published = COALESCE($6, is_published)
         WHERE id = $7 RETURNING *`,
        params
      );
    }

    res.status(200).json({ success: true, message: "Blog updated successfully!", data: result.rows[0] });
  } catch (error) {
    console.error("UPDATE BLOG ERROR:", error);
    res.status(500).json({ success: false, message: "Server error while updating blog." });
  }
};

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
  updateBlog,
  deleteBlog
};
