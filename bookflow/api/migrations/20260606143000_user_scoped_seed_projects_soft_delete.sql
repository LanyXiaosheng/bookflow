INSERT INTO users (email, display_name, password_hash)
VALUES (
    'legacy@bookflow.local',
    '历史数据',
    '$argon2id$v=19$m=19456,t=2,p=1$legacyusersalt0000000000$9z9Q2pH5y7sY2qA8b6iQk+eR4r8m4Q2kP0nX3mK4e7E'
)
ON CONFLICT (email) DO NOTHING;

ALTER TABLE seeds
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ai_seed_drafts
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

UPDATE seeds
SET user_id = (SELECT id FROM users WHERE email = 'legacy@bookflow.local')
WHERE user_id IS NULL;

UPDATE ai_seed_drafts
SET user_id = (SELECT id FROM users WHERE email = 'legacy@bookflow.local')
WHERE user_id IS NULL;

UPDATE projects p
SET user_id = s.user_id
FROM seeds s
WHERE p.seed_id = s.id
  AND p.user_id IS NULL;

ALTER TABLE seeds
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE ai_seed_drafts
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE projects
    ALTER COLUMN user_id SET NOT NULL;

WITH ranked_projects AS (
    SELECT
        id,
        title,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, title
            ORDER BY created_at ASC, id ASC
        ) AS duplicate_rank
    FROM projects
    WHERE deleted_at IS NULL
)
UPDATE projects p
SET title = LEFT(r.title, 44) || ' #' || r.duplicate_rank
FROM ranked_projects r
WHERE p.id = r.id
  AND r.duplicate_rank > 1;

CREATE INDEX IF NOT EXISTS seeds_user_created_at_idx
    ON seeds (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_seed_drafts_user_track_idx
    ON ai_seed_drafts (user_id, track, created_at DESC);

CREATE INDEX IF NOT EXISTS projects_user_status_idx
    ON projects (user_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_user_title_active_uq
    ON projects (user_id, title)
    WHERE deleted_at IS NULL;
