DO $$
DECLARE
    legacy_user_id UUID;
    legacy_created_at TIMESTAMPTZ;
    target_user_id UUID;
    candidate_count INTEGER;
BEGIN
    SELECT id, created_at
    INTO legacy_user_id, legacy_created_at
    FROM users
    WHERE email = 'legacy@bookflow.local'
    LIMIT 1;

    IF legacy_user_id IS NULL THEN
        RAISE NOTICE 'skip legacy reassignment: legacy user not found';
        RETURN;
    END IF;

    SELECT COUNT(*)
    INTO candidate_count
    FROM users
    WHERE email <> 'legacy@bookflow.local'
      AND created_at < legacy_created_at;

    IF candidate_count <> 1 THEN
        RAISE NOTICE 'skip legacy reassignment: expected exactly one preexisting user, found %', candidate_count;
        RETURN;
    END IF;

    SELECT id
    INTO target_user_id
    FROM users
    WHERE email <> 'legacy@bookflow.local'
      AND created_at < legacy_created_at
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Rename legacy-owned active projects that would collide with target-owned active titles.
    WITH combined_active AS (
        SELECT
            id,
            user_id,
            title,
            ROW_NUMBER() OVER (
                PARTITION BY title
                ORDER BY
                    CASE WHEN user_id = target_user_id THEN 0 ELSE 1 END,
                    created_at ASC,
                    id ASC
            ) AS duplicate_rank
        FROM projects
        WHERE deleted_at IS NULL
          AND user_id IN (legacy_user_id, target_user_id)
    )
    UPDATE projects p
    SET title = LEFT(c.title, 44) || ' #' || c.duplicate_rank
    FROM combined_active c
    WHERE p.id = c.id
      AND c.user_id = legacy_user_id
      AND c.duplicate_rank > 1;

    UPDATE seeds
    SET user_id = target_user_id
    WHERE user_id = legacy_user_id;

    UPDATE ai_seed_drafts
    SET user_id = target_user_id
    WHERE user_id = legacy_user_id;

    UPDATE projects
    SET user_id = target_user_id
    WHERE user_id = legacy_user_id;

    RAISE NOTICE 'reassigned legacy data to user %', target_user_id;
END $$;
