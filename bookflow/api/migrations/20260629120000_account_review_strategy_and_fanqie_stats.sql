-- 账号复盘：用户策略 jsonb + 番茄作品数据表
-- 这两者此前已在部分库里手工建好，这里用幂等语句补齐新库，老库为 no-op。

-- 每个用户的账号复盘策略（爆款公式 / 禁用赛道 / 关键洞察 / 下一步行动 / 推荐选题池）
ALTER TABLE users ADD COLUMN IF NOT EXISTS strategy JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 每个用户所有番茄作品的运营数据（阅读 / 曝光 / CTR / 付费率等）
CREATE TABLE IF NOT EXISTS fanqie_stats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    book_id             TEXT NOT NULL,
    title               TEXT NOT NULL,
    category            TEXT[] DEFAULT ARRAY[]::TEXT[],
    sign_status         TEXT DEFAULT '',
    read_count          BIGINT DEFAULT 0,
    show_count          BIGINT DEFAULT 0,
    click_rate          DOUBLE PRECISION DEFAULT 0,
    digg_count          BIGINT DEFAULT 0,
    comment_count       BIGINT DEFAULT 0,
    shelf_count         BIGINT DEFAULT 0,
    read_count_increase BIGINT DEFAULT 0,
    show_count_increase BIGINT DEFAULT 0,
    douyin_pay_rate     DOUBLE PRECISION DEFAULT 0,
    fanqie_created_at   TIMESTAMPTZ,
    recorded_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fanqie_stats_user_read_idx
    ON fanqie_stats (user_id, read_count DESC);
