-- Payment attempts are not reservations. Only verified paid sessions create reservations.
CREATE TABLE checkout_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES users(id),
  payload JSONB NOT NULL,
  stripe_session_id TEXT UNIQUE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
