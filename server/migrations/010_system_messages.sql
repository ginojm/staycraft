ALTER TABLE messages ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
UPDATE messages m SET is_system = true
FROM conversations c JOIN reservations r ON r.id = c.reservation_id
WHERE m.conversation_id = c.id AND m.sender_id = r.guest_id
  AND m.body LIKE 'Réservation confirmée · %Afficher la réservation';
