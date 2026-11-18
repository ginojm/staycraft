CREATE TABLE scheduled_messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id UUID NOT NULL REFERENCES users(id),
 name TEXT NOT NULL,
 body TEXT NOT NULL,
 event TEXT NOT NULL CHECK (event IN ('manual','confirmed','arrival','departure')),
 hours_before INTEGER NOT NULL DEFAULT 24 CHECK (hours_before BETWEEN 0 AND 720),
 enabled BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE scheduled_message_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 template_id UUID NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE,
 reservation_id UUID NOT NULL REFERENCES reservations(id),
 message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
 sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(template_id, reservation_id)
);
