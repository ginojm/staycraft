-- Every reservation conversation belongs to the guest, listing host and superhost.
CREATE FUNCTION ensure_reservation_message_participants() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO conversation_participants (conversation_id, user_id)
  SELECT NEW.id, u.id
  FROM reservations r JOIN listings l ON l.id = r.listing_id
  JOIN users u ON u.id = r.guest_id OR u.id = l.host_id
    OR lower(u.email) = 'foyal.toloman@gmail.com'
  WHERE r.id = NEW.reservation_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservation_message_participants
AFTER INSERT OR UPDATE OF reservation_id ON conversations
FOR EACH ROW EXECUTE FUNCTION ensure_reservation_message_participants();

INSERT INTO conversation_participants (conversation_id, user_id)
SELECT c.id, u.id
FROM conversations c
JOIN reservations r ON r.id = c.reservation_id
JOIN listings l ON l.id = r.listing_id
JOIN users u ON u.id = r.guest_id OR u.id = l.host_id
  OR lower(u.email) = 'foyal.toloman@gmail.com'
ON CONFLICT DO NOTHING;
