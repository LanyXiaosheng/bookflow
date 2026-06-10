CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    level TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    action_label TEXT,
    action_href TEXT,
    source_type TEXT,
    source_id TEXT,
    fingerprint TEXT,
    read_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_status_idx
    ON notifications (user_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_active_fingerprint_idx
    ON notifications (user_id, fingerprint)
    WHERE fingerprint IS NOT NULL AND status IN ('unread', 'read');
