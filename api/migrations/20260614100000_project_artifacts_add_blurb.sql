ALTER TABLE project_artifacts
    DROP CONSTRAINT IF EXISTS project_artifacts_kind_check;

ALTER TABLE project_artifacts
    ADD CONSTRAINT project_artifacts_kind_check
    CHECK (
        kind IN (
            'readme',
            'outline',
            'publish_post',
            'side_dishes',
            'story_image',
            'book_summary',
            'book_polished',
            'character_setup',
            'blurb'
        )
    );
