-- 选题评分系统 V2：seeds.score 从 7 个 1-5 独立列改为 jsonb 整块存。
-- 旧数据原样保留（以旧 7 维 jsonb 形式），total_score / tier 不重算；
-- 新数据按 4 维（title_ctr/conflict/tagfit/novelty，每维 1-10，满分 40）写入。
-- 前后端按 score 里是否含 `title_ctr` 字段判断新旧版本。

-- 1. 新增 jsonb 列
ALTER TABLE seeds ADD COLUMN score JSONB;

-- 2. 回填旧 7 维数据（保持旧字段名，前端据此识别为旧版展示）
UPDATE seeds SET score = jsonb_build_object(
    'title',   score_title,
    'opening', score_opening,
    'slap',    score_slap,
    'emotion', score_emotion,
    'twist',   score_twist,
    'hook',    score_hook,
    'finish',  score_finish
);

ALTER TABLE seeds ALTER COLUMN score SET NOT NULL;

-- 3. total_score 原是 GENERATED ALWAYS（依赖旧 7 列），先去掉生成表达式变普通列，
--    保留已算好的存量值，再补 NOT NULL。
ALTER TABLE seeds ALTER COLUMN total_score DROP EXPRESSION;
ALTER TABLE seeds ALTER COLUMN total_score SET NOT NULL;

-- 4. 删掉旧的 7 个 1-5 独立列（其行内 CHECK 约束随列一并删除）
ALTER TABLE seeds
    DROP COLUMN score_title,
    DROP COLUMN score_opening,
    DROP COLUMN score_slap,
    DROP COLUMN score_emotion,
    DROP COLUMN score_twist,
    DROP COLUMN score_hook,
    DROP COLUMN score_finish;
