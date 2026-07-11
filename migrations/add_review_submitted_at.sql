ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS review_submitted_at TIMESTAMP;

UPDATE applications
SET review_submitted_at = COALESCE(updated_at, created_at)
WHERE review_submitted_at IS NULL
  AND (
    review_link IS NOT NULL
    OR review_screenshot_url IS NOT NULL
    OR review_screenshot_url_2 IS NOT NULL
  );
