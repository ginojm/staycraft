ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE users
SET first_name = CASE WHEN first_name = '' THEN split_part(trim(full_name), ' ', 1) ELSE first_name END,
    last_name = CASE WHEN last_name = '' THEN COALESCE(NULLIF(trim(substring(trim(full_name) from length(split_part(trim(full_name), ' ', 1)) + 1)), ''), trim(full_name)) ELSE last_name END;

CREATE INDEX IF NOT EXISTS users_active_idx ON users (is_active, created_at DESC);
