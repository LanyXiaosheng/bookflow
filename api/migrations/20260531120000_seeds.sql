CREATE TABLE seeds (
    id           UUID        PRIMARY KEY,
    title        TEXT        NOT NULL,
    track        TEXT        NOT NULL,
    score_title    SMALLINT NOT NULL CHECK (score_title BETWEEN 1 AND 5),
    score_opening  SMALLINT NOT NULL CHECK (score_opening BETWEEN 1 AND 5),
    score_slap     SMALLINT NOT NULL CHECK (score_slap BETWEEN 1 AND 5),
    score_emotion  SMALLINT NOT NULL CHECK (score_emotion BETWEEN 1 AND 5),
    score_twist    SMALLINT NOT NULL CHECK (score_twist BETWEEN 1 AND 5),
    score_hook     SMALLINT NOT NULL CHECK (score_hook BETWEEN 1 AND 5),
    score_finish   SMALLINT NOT NULL CHECK (score_finish BETWEEN 1 AND 5),
    total_score    INT GENERATED ALWAYS AS (
        score_title + score_opening + score_slap +
        score_emotion + score_twist + score_hook + score_finish
    ) STORED,
    tier         TEXT NOT NULL CHECK (tier IN ('greenlight','backlog','reject')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX seeds_created_at_idx ON seeds (created_at DESC);
CREATE INDEX seeds_tier_idx       ON seeds (tier);
