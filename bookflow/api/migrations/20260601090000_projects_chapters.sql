-- projects：立项后从 seed 派生的项目。一个 seed 可衍生多个项目（重写/分赛道）
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seed_id     UUID NOT NULL REFERENCES seeds(id) ON DELETE RESTRICT,
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 50),
    track       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'writing'
                CHECK (status IN ('writing', 'ready', 'published', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_status_idx ON projects (status, created_at DESC);
CREATE INDEX projects_seed_idx   ON projects (seed_id);

-- chapters：章节。idx 从 1 起编号
CREATE TABLE chapters (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    idx          SMALLINT NOT NULL CHECK (idx >= 1),
    title        TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 50),
    -- AI 拆出来的段落 beats，结构 [{"id":"b1","label":"...","note":"..."}]
    beats        JSONB NOT NULL DEFAULT '[]'::jsonb,
    body         TEXT NOT NULL DEFAULT '',
    -- 字数（中英都只数字符，不去标点；前端展示用，落库省一次 strlen）
    word_count   INT  NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, idx)
);

CREATE INDEX chapters_project_idx ON chapters (project_id, idx);

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_touch_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER chapters_touch_updated_at
  BEFORE UPDATE ON chapters
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
