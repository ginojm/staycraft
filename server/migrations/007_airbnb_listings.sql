ALTER TABLE listings ADD COLUMN IF NOT EXISTS external_url TEXT;

UPDATE listings
SET status = 'archived'
WHERE id NOT IN (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003'
);

UPDATE listings
SET title = 'Ibiskis Lodge - calme, passion, serenite',
    description = 'Studio paisible a Fort-de-France, ideal pour un sejour a deux. Profitez d une cuisine equipee, du Wi-Fi, d un espace de travail et d un environnement calme a proximite des commerces, restaurants et grands axes.',
    city = 'Fort-de-France',
    region = 'Martinique',
    country = 'Martinique',
    category = 'Ville',
    price_per_night = 95,
    max_guests = 2,
    cover_image_url = 'https://a0.muscache.com/im/pictures/miso/Hosting-704205391981755330/original/5171f336-98a6-462d-be88-aed3a1076508.jpeg?im_w=960',
    badge = 'Annonce Airbnb',
    average_rating = 4.64,
    review_count = 83,
    status = 'published',
    external_url = 'https://airbnb.com/h/foyaltoloman-ibiskis'
WHERE id = '20000000-0000-4000-8000-000000000001';

UPDATE listings
SET title = 'Karanbol Studio - paix, confort et intimite',
    description = 'Studio confortable et soigne a Fort-de-France pour deux voyageurs. Il propose une cuisine complete, le Wi-Fi, un espace de travail et une place de parking gratuite, dans un quartier calme proche des commerces et des grands axes.',
    city = 'Fort-de-France',
    region = 'Martinique',
    country = 'Martinique',
    category = 'Ville',
    price_per_night = 105,
    max_guests = 2,
    cover_image_url = 'https://a0.muscache.com/im/pictures/hosting/Hosting-1681260218486340720/original/3b03f61d-6239-408d-ac9b-ea95df7fa7f1.jpeg?im_w=960',
    badge = 'Nouveau',
    average_rating = 5.00,
    review_count = 4,
    status = 'published',
    external_url = 'https://airbnb.com/h/foyaltoloman-karanbol'
WHERE id = '20000000-0000-4000-8000-000000000002';

UPDATE listings
SET title = 'Luxury Lodge - calme, design et parking',
    description = 'Appartement elegant et calme a Fort-de-France, adapte aux sejours a deux ou professionnels. Vous disposez d une chambre, d une cuisine equipee, du Wi-Fi et d une place de parking privee.',
    city = 'Fort-de-France',
    region = 'Martinique',
    country = 'Martinique',
    category = 'Ville',
    price_per_night = 125,
    max_guests = 2,
    cover_image_url = 'https://a0.muscache.com/im/pictures/hosting/Hosting-U3RheVN1cHBseUxpc3Rpbmc6MTE5MDQ2NjQxNzU3MzkwNzYzMg%3D%3D/original/32f5698b-cb31-403b-b5c7-72c1c0eaec11.jpeg?im_w=960',
    badge = 'Parking gratuit',
    average_rating = 4.48,
    review_count = 29,
    status = 'published',
    external_url = 'https://airbnb.com/h/luxurylodge972'
WHERE id = '20000000-0000-4000-8000-000000000003';

DELETE FROM listing_amenities
WHERE listing_id IN (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003'
);

INSERT INTO listing_amenities (listing_id, amenity) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Cuisine equipee'),
  ('20000000-0000-4000-8000-000000000001', 'Wifi'),
  ('20000000-0000-4000-8000-000000000001', 'Espace de travail'),
  ('20000000-0000-4000-8000-000000000001', 'Lave-linge'),
  ('20000000-0000-4000-8000-000000000002', 'Cuisine equipee'),
  ('20000000-0000-4000-8000-000000000002', 'Wifi'),
  ('20000000-0000-4000-8000-000000000002', 'Parking gratuit'),
  ('20000000-0000-4000-8000-000000000002', 'Espace de travail'),
  ('20000000-0000-4000-8000-000000000003', 'Cuisine equipee'),
  ('20000000-0000-4000-8000-000000000003', 'Wifi'),
  ('20000000-0000-4000-8000-000000000003', 'Parking prive'),
  ('20000000-0000-4000-8000-000000000003', 'Chambre confortable');
