-- P0-3: 对齐真相 — 把运行时 DDL / 手工 ALTER 补进迁移

-- project_reviews 缺 4 列（代码已使用，靠手工 ALTER 存活）
ALTER TABLE project_reviews ADD COLUMN IF NOT EXISTS show_count BIGINT NULL;
ALTER TABLE project_reviews ADD COLUMN IF NOT EXISTS comment_count BIGINT NULL;
ALTER TABLE project_reviews ADD COLUMN IF NOT EXISTS like_count BIGINT NULL;
ALTER TABLE project_reviews ADD COLUMN IF NOT EXISTS library_count BIGINT NULL;

-- app_settings 缺 duomiapi_key（之前靠运行时 ensure_duomiapi_key_column）
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS duomiapi_key TEXT NOT NULL DEFAULT '';
