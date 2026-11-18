ALTER TABLE booking_addons ADD COLUMN image_url TEXT;

UPDATE booking_addons
SET image_url = CASE code
  WHEN 'breakfast-box-for-two' THEN 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085'
  WHEN 'late-arrival-menu' THEN 'https://images.unsplash.com/photo-1547592180-85f173990554'
  WHEN 'rose-gift-box' THEN 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3'
  WHEN 'cremant-gift-box' THEN 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b'
  WHEN 'beer-gift-box' THEN 'https://images.unsplash.com/photo-1535958636474-b021ee887b13'
  WHEN 'soda-gift-box' THEN 'https://images.unsplash.com/photo-1551024709-8f23befc6f87'
  WHEN 'romantic-gift-box' THEN 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7'
  WHEN 'romantic-elite-gift-box' THEN 'https://images.unsplash.com/photo-1513278974582-3e1b4a4fa21e'
  WHEN 'romantic-nonalcoholic-gift-box' THEN 'https://images.unsplash.com/photo-1516594915697-87eb3b1c14ea'
  WHEN 'romantic-pack-nonalcoholic' THEN 'https://images.unsplash.com/photo-1544145945-f90425340c7e'
  WHEN 'romantic-pack' THEN 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622'
  WHEN 'romantic-deluxe-pack' THEN 'https://images.unsplash.com/photo-1513151233558-d860c5398176'
  WHEN 'sleep-well-pack' THEN 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9'
  WHEN 'early-check-in-hourly' THEN 'https://images.unsplash.com/photo-1611892440504-42a792e24d32'
  WHEN 'late-check-out-hourly' THEN 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace'
  WHEN 'baby-travel-cot' THEN 'https://images.unsplash.com/photo-1519689680058-324335c77eba'
  WHEN 'express-cleaning' THEN 'https://images.unsplash.com/photo-1581578731548-c64695cc6952'
  WHEN 'premium-cleaning' THEN 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c'
  WHEN 'essentials-pack' THEN 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0'
  WHEN 'linen-replacement' THEN 'https://images.unsplash.com/photo-1631679706909-1844bbd07221'
  WHEN 'extra-linen' THEN 'https://images.unsplash.com/photo-1600369671236-e74521d4b6ad'
  WHEN 'grocery-delivery' THEN 'https://images.unsplash.com/photo-1542838132-92c53300491e'
  WHEN 'cruise-island-transfer' THEN 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21'
  WHEN 'airport-transfer' THEN 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05'
  WHEN 'luggage-storage' THEN 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62'
  ELSE 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0'
END;

ALTER TABLE booking_addons ALTER COLUMN image_url SET NOT NULL;
