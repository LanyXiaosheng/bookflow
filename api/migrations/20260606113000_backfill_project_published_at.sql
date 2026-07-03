UPDATE projects
SET published_at = updated_at
WHERE published_at IS NULL
  AND status IN ('published', 'archived');
