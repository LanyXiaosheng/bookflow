-- 全局设置（单行）
CREATE TABLE app_settings (
    id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- 永远只有一行
    provider    TEXT NOT NULL DEFAULT 'anthropic',
    base_url    TEXT NOT NULL DEFAULT '',
    api_key     TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    timeout_secs INTEGER NOT NULL DEFAULT 60,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 默认空行：服务启动后，若 DB 为空则用 .env 兜底；这里只确保单行存在
INSERT INTO app_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER trg_app_settings_updated
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
