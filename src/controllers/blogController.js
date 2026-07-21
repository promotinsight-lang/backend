const pool = require("../config/db");
const cloudinary = require("cloudinary").v2;
const sanitizeHtml = require("sanitize-html");

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const slugify = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-{2,}/g, '-');

const normalizeOptionalText = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on', 'published'].includes(String(value).toLowerCase());
};

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseDateOrNull = (value) => {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseRelatedPostIds = (value) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const text = normalizeOptionalText(value);
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {}

  return text.split(',').map((item) => item.trim()).filter(Boolean);
};

const normalizeBlogRow = (row) => {
  if (!row) return row;
  const isPublished = row.status ? row.status === 'published' : row.is_published !== false;

  return {
    ...row,
    is_published: isPublished,
    status: isPublished ? 'published' : 'draft',
    excerpt: row.excerpt || '',
    meta_title: row.meta_title || row.title || '',
    meta_description: row.meta_description || row.excerpt || '',
    primary_keyword: row.primary_keyword || '',
    category: row.category || 'General',
    category_slug: row.category_slug || slugify(row.category || 'General') || 'general',
    author_name: row.author_name || 'Admin',
    author_slug: row.author_slug || slugify(row.author_name || 'Admin') || 'admin',
    author_title: row.author_title || '',
    author_bio: row.author_bio || '',
    featured_image_alt: row.featured_image_alt || row.title || '',
    canonical_url: row.canonical_url || '',
    related_post_ids: Array.isArray(row.related_post_ids) ? row.related_post_ids : [],
    featured_image_width: row.featured_image_width || 1200,
    featured_image_height: row.featured_image_height || 630,
  };
};

const buildBlogPayload = (body, existing = null) => {
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const requestedSlug = normalizeOptionalText(body.slug);
  const isPublished = parseBoolean(body.is_published, existing ? existing.is_published : true);
  const status = isPublished ? 'published' : 'draft';
  const category = normalizeOptionalText(body.category) || 'General';
  const authorName = normalizeOptionalText(body.author_name) || existing?.author_name || 'Admin';

  if (requestedSlug && !slugPattern.test(requestedSlug)) {
    throw Object.assign(new Error('Please enter a valid slug using lowercase letters, numbers, and hyphens.'), { statusCode: 400 });
  }

  return {
    title,
    content,
    slugBase: requestedSlug || title,
    sanitizedContent: sanitizeBlogContent(content),
    excerpt: normalizeOptionalText(body.excerpt),
    metaTitle: normalizeOptionalText(body.meta_title) || title,
    metaDescription: normalizeOptionalText(body.meta_description) || normalizeOptionalText(body.excerpt),
    primaryKeyword: normalizeOptionalText(body.primary_keyword),
    category,
    categorySlug: normalizeOptionalText(body.category_slug) || slugify(category) || 'general',
    authorName,
    authorSlug: normalizeOptionalText(body.author_slug) || slugify(authorName) || 'admin',
    authorTitle: normalizeOptionalText(body.author_title),
    authorBio: normalizeOptionalText(body.author_bio),
    featuredImageAlt: normalizeOptionalText(body.featured_image_alt) || title,
    canonicalUrl: normalizeOptionalText(body.canonical_url),
    isPublished,
    status,
    publishedAt: parseDateOrNull(body.published_at) || (isPublished ? existing?.published_at || new Date() : null),
    relatedPostIds: parseRelatedPostIds(body.related_post_ids),
    featuredImageWidth: parsePositiveInteger(body.featured_image_width, existing?.featured_image_width || 1200),
    featuredImageHeight: parsePositiveInteger(body.featured_image_height, existing?.featured_image_height || 630),
  };
};

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

const createUniqueSlug = async (value, excludeId = null) => {
  const baseSlug = slugify(value) || `blog-${Date.now()}`;
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
    const payload = buildBlogPayload(req.body);

    if (!payload.title || !payload.content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    let imageUrl = null;
    if (req.file) {
      try {
        imageUrl = await uploadBlogImage(req.file);
      } catch (uploadError) {
        console.error("CLOUDINARY UPLOAD ERROR:", uploadError);
        return res.status(500).json({ success: false, message: "Failed to upload image to Cloudinary." });
      }
    }

    const slug = await createUniqueSlug(payload.slugBase);
    const result = await pool.query(
      `INSERT INTO blogs (
        title, slug, content, image_url, author_name, is_published,
        excerpt, meta_title, meta_description, primary_keyword,
        category, category_slug, author_slug, author_title, author_bio,
        featured_image_alt, canonical_url, published_at, status, related_post_ids,
        featured_image_width, featured_image_height
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20::jsonb,
        $21, $22
      )
      RETURNING *`,
      [
        payload.title,
        slug,
        payload.sanitizedContent,
        imageUrl,
        payload.authorName,
        payload.isPublished,
        payload.excerpt,
        payload.metaTitle,
        payload.metaDescription,
        payload.primaryKeyword,
        payload.category,
        payload.categorySlug,
        payload.authorSlug,
        payload.authorTitle,
        payload.authorBio,
        payload.featuredImageAlt,
        payload.canonicalUrl,
        payload.publishedAt,
        payload.status,
        JSON.stringify(payload.relatedPostIds),
        payload.featuredImageWidth,
        payload.featuredImageHeight,
      ]
    );

    res.status(201).json({ success: true, message: "Blog saved successfully!", data: normalizeBlogRow(result.rows[0]) });
  } catch (error) {
    console.error("CREATE BLOG ERROR:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Server error while creating blog.",
    });
  }
};

const getPublicBlogs = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM blogs
       WHERE COALESCE(status, CASE WHEN COALESCE(is_published, true) = true THEN 'published' ELSE 'draft' END) = 'published'
         AND COALESCE(is_published, true) = true
       ORDER BY COALESCE(published_at, created_at) DESC`
    );
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows.map(normalizeBlogRow) });
  } catch (error) {
    console.error("GET PUBLIC BLOGS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getAllBlogsAdmin = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM blogs ORDER BY created_at DESC");
    res.status(200).json({ success: true, data: result.rows.map(normalizeBlogRow) });
  } catch (error) {
    console.error("GET ADMIN BLOGS ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getBlogBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slugPattern.test(slug)) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    const result = await pool.query(
      `SELECT *
       FROM blogs
       WHERE slug = $1
         AND COALESCE(status, CASE WHEN COALESCE(is_published, true) = true THEN 'published' ELSE 'draft' END) = 'published'
         AND COALESCE(is_published, true) = true`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    res.status(200).json({
      success: true,
      data: normalizeBlogRow({
        ...result.rows[0],
        content: sanitizeBlogContent(result.rows[0].content || ''),
      }),
    });
  } catch (error) {
    console.error("GET BLOG BY SLUG ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    const existing = await pool.query("SELECT * FROM blogs WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Blog not found." });
    }

    const payload = buildBlogPayload(req.body, existing.rows[0]);
    if (!payload.title || !payload.content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    let imageUrl = existing.rows[0].image_url;
    if (req.file) {
      try {
        imageUrl = await uploadBlogImage(req.file);
      } catch (uploadError) {
        console.error("CLOUDINARY UPLOAD ERROR:", uploadError);
        return res.status(500).json({ success: false, message: "Failed to upload image to Cloudinary." });
      }
    }

    const slug = await createUniqueSlug(payload.slugBase, id);
    const result = await pool.query(
      `UPDATE blogs
       SET title = $1,
           slug = $2,
           content = $3,
           image_url = $4,
           author_name = $5,
           is_published = $6,
           excerpt = $7,
           meta_title = $8,
           meta_description = $9,
           primary_keyword = $10,
           category = $11,
           category_slug = $12,
           author_slug = $13,
           author_title = $14,
           author_bio = $15,
           featured_image_alt = $16,
           canonical_url = $17,
           published_at = $18,
           status = $19,
           related_post_ids = $20::jsonb,
           featured_image_width = $21,
           featured_image_height = $22,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $23
       RETURNING *`,
      [
        payload.title,
        slug,
        payload.sanitizedContent,
        imageUrl,
        payload.authorName,
        payload.isPublished,
        payload.excerpt,
        payload.metaTitle,
        payload.metaDescription,
        payload.primaryKeyword,
        payload.category,
        payload.categorySlug,
        payload.authorSlug,
        payload.authorTitle,
        payload.authorBio,
        payload.featuredImageAlt,
        payload.canonicalUrl,
        payload.publishedAt,
        payload.status,
        JSON.stringify(payload.relatedPostIds),
        payload.featuredImageWidth,
        payload.featuredImageHeight,
        id,
      ]
    );

    res.status(200).json({ success: true, message: "Blog updated successfully!", data: normalizeBlogRow(result.rows[0]) });
  } catch (error) {
    console.error("UPDATE BLOG ERROR:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Server error while updating blog.",
    });
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
