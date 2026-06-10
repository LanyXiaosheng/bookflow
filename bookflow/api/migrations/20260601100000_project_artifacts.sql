-- AI 生成产物：README/大纲/发布稿/配套 等长文本统一存这里
-- kind 复用枚举语义（用 TEXT + CHECK 不创建真 enum）；同 (project_id, kind) 取 version 最大的一条作为「当前版本」

CREATE TABLE project_artifacts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL CHECK (kind IN ('readme','outline','publish_post','side_dishes')),
    version      INT         NOT NULL DEFAULT 1,
    content      TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX project_artifacts_project_idx ON project_artifacts (project_id, kind, version DESC);
CREATE UNIQUE INDEX project_artifacts_unique_version ON project_artifacts (project_id, kind, version);
