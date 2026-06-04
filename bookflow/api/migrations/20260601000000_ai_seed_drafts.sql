-- AI 候选历史：每次 /api/seeds/ai-generate 把 5 条候选都落进来
-- 是「草稿」概念，不进 seeds 表，不参与立项流水线，只是 UI 看历史

CREATE TABLE ai_seed_drafts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    track          TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    score          JSONB       NOT NULL,  -- 7 维评分整块存
    total_score    INT         NOT NULL,
    why_buy        TEXT        NOT NULL,
    -- 同一批生成的 5 条共享 batch_id；前端可以做「这次生成」分组
    batch_id       UUID        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_seed_drafts_track_idx      ON ai_seed_drafts (track, created_at DESC);
CREATE INDEX ai_seed_drafts_batch_id_idx   ON ai_seed_drafts (batch_id);
