CREATE TABLE scheduled_message_listings (
 template_id UUID NOT NULL REFERENCES scheduled_messages(id) ON DELETE CASCADE,
 listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
 PRIMARY KEY (template_id, listing_id)
);
-- Existing models are paused until their scope is explicitly selected.
UPDATE scheduled_messages SET enabled=false;
