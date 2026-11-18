ALTER TABLE users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX users_google_sub_unique
  ON users (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE google_auth_codes (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX google_auth_codes_expiry_idx
  ON google_auth_codes (expires_at) WHERE consumed_at IS NULL;
