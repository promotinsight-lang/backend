CREATE TABLE IF NOT EXISTS blogs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  image_url TEXT,
  author_name TEXT DEFAULT 'Admin',
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS excerpt TEXT,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT,
  ADD COLUMN IF NOT EXISTS primary_keyword TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS category_slug VARCHAR(255),
  ADD COLUMN IF NOT EXISTS author_slug VARCHAR(255),
  ADD COLUMN IF NOT EXISTS author_title TEXT,
  ADD COLUMN IF NOT EXISTS author_bio TEXT,
  ADD COLUMN IF NOT EXISTS featured_image_alt TEXT,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS related_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS featured_image_width INTEGER DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS featured_image_height INTEGER DEFAULT 630;

UPDATE blogs
SET
  status = CASE WHEN COALESCE(is_published, true) = true THEN 'published' ELSE 'draft' END,
  published_at = CASE
    WHEN COALESCE(is_published, true) = true THEN COALESCE(published_at, created_at, CURRENT_TIMESTAMP)
    ELSE published_at
  END,
  category_slug = COALESCE(category_slug, 'general'),
  author_slug = COALESCE(author_slug, LOWER(REGEXP_REPLACE(COALESCE(author_name, 'admin'), '[^a-zA-Z0-9]+', '-', 'g'))),
  featured_image_alt = COALESCE(featured_image_alt, title),
  meta_title = COALESCE(meta_title, title),
  meta_description = COALESCE(meta_description, excerpt, LEFT(REGEXP_REPLACE(COALESCE(content, ''), '<[^>]+>', '', 'g'), 155))
WHERE status IS NULL
   OR category_slug IS NULL
   OR author_slug IS NULL
   OR featured_image_alt IS NULL
   OR meta_title IS NULL
   OR meta_description IS NULL
   OR (COALESCE(is_published, true) = true AND published_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_blogs_status_published_at
  ON blogs(status, published_at DESC);
