-- Run once on your PostgreSQL database (applications table)
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS screenshot_url_2 TEXT,
  ADD COLUMN IF NOT EXISTS review_screenshot_url_2 TEXT;
