-- Migration 001: Initial schema

CREATE TABLE accounts (
    id          SERIAL PRIMARY KEY,
    platform    TEXT NOT NULL,
    name        TEXT,
    cookie      TEXT,
    meta        JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE works (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER REFERENCES accounts(id),
    platform        TEXT NOT NULL,
    platform_id     TEXT NOT NULL,
    item_id         TEXT,
    title           TEXT NOT NULL,
    word_count      INTEGER DEFAULT 0,
    category        TEXT,
    sign_status     INTEGER DEFAULT 0,
    create_time     TIMESTAMPTZ,
    update_time     TIMESTAMPTZ,
    meta            JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(platform, platform_id)
);

CREATE TABLE work_stats (
    id              SERIAL PRIMARY KEY,
    work_id         INTEGER REFERENCES works(id),
    read_count      BIGINT DEFAULT 0,
    show_count      BIGINT DEFAULT 0,
    click_rate      REAL DEFAULT 0,
    digg_count      INTEGER DEFAULT 0,
    comment_count   INTEGER DEFAULT 0,
    shelf_count     INTEGER DEFAULT 0,
    pay_rate        REAL DEFAULT 0,
    popularity_score INTEGER DEFAULT 0,
    meta            JSONB DEFAULT '{}',
    fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE work_daily (
    id                  SERIAL PRIMARY KEY,
    work_id             INTEGER REFERENCES works(id),
    date                DATE NOT NULL,
    show_count          INTEGER DEFAULT 0,
    read_count          INTEGER DEFAULT 0,
    read_100_percent    INTEGER DEFAULT 0,
    read_15s            INTEGER DEFAULT 0,
    read_30s            INTEGER DEFAULT 0,
    read_60s            INTEGER DEFAULT 0,
    meta                JSONB DEFAULT '{}',
    UNIQUE(work_id, date)
);

CREATE TABLE predictions (
    id              SERIAL PRIMARY KEY,
    work_id         INTEGER REFERENCES works(id),
    rubric_version  TEXT NOT NULL,
    scores          JSONB NOT NULL,
    composite       REAL,
    bucket          TEXT,
    confidence      TEXT,
    reasoning       TEXT,
    blind_scores    JSONB,
    predicted_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE retros (
    id              SERIAL PRIMARY KEY,
    work_id         INTEGER REFERENCES works(id),
    prediction_id   INTEGER REFERENCES predictions(id),
    actual_read     BIGINT,
    actual_bucket   TEXT,
    hit             BOOLEAN,
    analysis        TEXT,
    observations    JSONB,
    retro_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rubric_versions (
    id              SERIAL PRIMARY KEY,
    version         TEXT NOT NULL UNIQUE,
    dimensions      JSONB NOT NULL,
    bucket_ranges   JSONB NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE candidates (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    source          TEXT,
    scores          JSONB,
    composite       REAL,
    tier            TEXT,
    status          TEXT DEFAULT 'pending',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE observations (
    id              SERIAL PRIMARY KEY,
    content         TEXT NOT NULL,
    source_type     TEXT,
    source_id       INTEGER,
    status          TEXT DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_works_platform ON works(platform, platform_id);
CREATE INDEX idx_works_account ON works(account_id);
CREATE INDEX idx_work_stats_work ON work_stats(work_id, fetched_at DESC);
CREATE INDEX idx_work_daily_work ON work_daily(work_id, date);
CREATE INDEX idx_predictions_work ON predictions(work_id);
CREATE INDEX idx_retros_work ON retros(work_id);
CREATE INDEX idx_candidates_status ON candidates(status);
CREATE INDEX idx_observations_status ON observations(status);
