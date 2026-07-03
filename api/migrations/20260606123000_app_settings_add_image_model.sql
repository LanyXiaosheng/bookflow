ALTER TABLE app_settings
    ADD COLUMN IF NOT EXISTS image_model TEXT NOT NULL DEFAULT 'gpt-image-2';
