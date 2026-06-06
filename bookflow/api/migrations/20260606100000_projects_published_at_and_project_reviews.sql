ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;

CREATE TABLE project_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('24h', '72h', '7d')),
    published_at TIMESTAMPTZ NOT NULL,
    data_recorded BOOLEAN NOT NULL DEFAULT FALSE,
    read_count BIGINT NULL,
    completion_rate DOUBLE PRECISION NULL,
    engagement_count BIGINT NULL,
    overall_result TEXT NULL CHECK (overall_result IN ('爆', '平', '扑')),
    title_result TEXT NULL,
    hook_result TEXT NULL,
    emotion_result TEXT NULL,
    success_reason TEXT NULL,
    failure_reason TEXT NULL,
    continue_track TEXT NULL,
    reusable_conclusion TEXT NULL,
    next_action TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX project_reviews_project_stage_uq
    ON project_reviews (project_id, stage);

CREATE INDEX project_reviews_project_idx
    ON project_reviews (project_id, updated_at DESC);
