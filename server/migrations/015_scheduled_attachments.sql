CREATE TABLE scheduled_attachments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 template_id UUID REFERENCES scheduled_messages(id) ON DELETE SET NULL,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 5242880),
 data BYTEA NOT NULL
);
CREATE TABLE message_attachments (
 message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 attachment_id UUID NOT NULL REFERENCES scheduled_attachments(id),
 PRIMARY KEY(message_id, attachment_id)
);
