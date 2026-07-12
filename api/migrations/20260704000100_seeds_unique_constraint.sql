-- 先把 projects 里指向"重复组中将被删除的旧 seed"的外键引用,
-- 重定向到该组保留的最新 seed,避免删除时触发 projects_seed_id_fkey 外键冲突。
UPDATE projects p
SET seed_id = keep.keep_id
FROM (
    SELECT s.id AS old_id,
           first_value(s.id) OVER (
               PARTITION BY s.user_id, s.title, s.track
               ORDER BY s.created_at DESC
           ) AS keep_id
    FROM seeds s
) keep
WHERE p.seed_id = keep.old_id
  AND keep.old_id <> keep.keep_id;

-- 去重：保留每组 (user_id, title, track) 中最新的一条
DELETE FROM seeds
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, title, track) id
    FROM seeds
    ORDER BY user_id, title, track, created_at DESC
);

-- 防止并发双击创建重复 seed（同用户+标题+赛道唯一）
CREATE UNIQUE INDEX seeds_user_title_track_uq
    ON seeds (user_id, title, track);
