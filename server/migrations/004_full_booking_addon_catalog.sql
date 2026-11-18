ALTER TABLE booking_addons
  ADD COLUMN category TEXT NOT NULL DEFAULT 'Autres',
  ADD COLUMN category_order SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN price_unit TEXT NOT NULL DEFAULT 'fixed' CHECK (price_unit IN ('fixed', 'hour'));

ALTER TABLE reservation_addons
  ADD COLUMN billing_unit_snapshot TEXT NOT NULL DEFAULT 'fixed'
  CHECK (billing_unit_snapshot IN ('fixed', 'hour'));

UPDATE booking_addons SET active = false;

INSERT INTO booking_addons (code, name, description, price, category, category_order, sort_order, price_unit) VALUES
  ('breakfast-box-for-two', 'Box petit déjeuner pour 2', 'Un assortiment de viennoiseries, pains, confitures, jus et boissons chaudes pour deux.', 29.99, 'Petits plaisirs', 1, 1, 'fixed'),
  ('late-arrival-menu', 'Pack menu arrivée tardive', 'Un accueil gourmand salé et sucré, préparé pour une arrivée en soirée.', 45.00, 'Petits plaisirs', 1, 2, 'fixed'),
  ('rose-gift-box', 'Coffret rosé', 'Une bouteille de rosé accompagnée de chocolats et de douceurs.', 66.99, 'Petits plaisirs', 1, 3, 'fixed'),
  ('cremant-gift-box', 'Coffret crémant', 'Une bouteille de crémant avec chocolats et gourmandises.', 54.99, 'Petits plaisirs', 1, 4, 'fixed'),
  ('beer-gift-box', 'Coffret bière', 'Une sélection de bières et de spécialités apéritives.', 22.99, 'Petits plaisirs', 1, 5, 'fixed'),
  ('soda-gift-box', 'Coffret soda', 'Un assortiment de boissons sans alcool et de douceurs.', 19.99, 'Petits plaisirs', 1, 6, 'fixed'),
  ('romantic-gift-box', 'Coffret romantique', 'Une bouteille de champagne, des chocolats et une décoration romantique.', 96.99, 'Petits plaisirs', 1, 7, 'fixed'),
  ('romantic-elite-gift-box', 'Coffret romantique élite', 'Une attention romantique premium avec champagne, chocolats et gourmandises.', 130.69, 'Petits plaisirs', 1, 8, 'fixed'),
  ('romantic-nonalcoholic-gift-box', 'Coffret romantique sans alcool', 'Un moment romantique avec boisson pétillante sans alcool, chocolats et décoration.', 76.99, 'Petits plaisirs', 1, 9, 'fixed'),

  ('romantic-pack-nonalcoholic', 'Pack romantique sans alcool', 'Une bouteille pétillante sans alcool, chocolats et décoration romantique.', 129.99, 'Moments d’exception', 2, 1, 'fixed'),
  ('romantic-pack', 'Pack romantique', 'Une bouteille de champagne, chocolats et décoration pour une arrivée inoubliable.', 169.99, 'Moments d’exception', 2, 2, 'fixed'),
  ('romantic-deluxe-pack', 'Pack romantique deluxe', 'Décoration romantique, champagne, chocolats, gourmandises, arrivée anticipée et départ tardif.', 199.99, 'Moments d’exception', 2, 3, 'fixed'),
  ('sleep-well-pack', 'Pack sommeil paisible', 'Masque de sommeil, bouchons d’oreilles et infusions pour une nuit reposante.', 20.00, 'Moments d’exception', 2, 4, 'fixed'),

  ('early-check-in-hourly', 'Arrivée anticipée', 'Profitez du logement avant l’heure habituelle. Sous réserve de disponibilité de l’hôte.', 10.00, 'Confort & praticité', 3, 1, 'hour'),
  ('late-check-out-hourly', 'Départ tardif', 'Prolongez votre séjour après l’heure habituelle. Sous réserve de disponibilité de l’hôte.', 12.00, 'Confort & praticité', 3, 2, 'hour'),
  ('baby-travel-cot', 'Lit parapluie bébé', 'Un lit parapluie installé dans le logement, selon disponibilité.', 7.00, 'Confort & praticité', 3, 3, 'fixed'),
  ('express-cleaning', 'Ménage express', 'Prestation de ménage express, à réserver selon disponibilité.', 40.00, 'Confort & praticité', 3, 4, 'fixed'),
  ('premium-cleaning', 'Ménage premium', 'Prestation de ménage premium avec remise en état approfondie, selon disponibilité.', 55.00, 'Confort & praticité', 3, 5, 'fixed'),
  ('essentials-pack', 'Pack essentiels', 'Le nécessaire pour un séjour confortable : linge, articles de toilette et produits utiles.', 37.00, 'Confort & praticité', 3, 6, 'fixed'),
  ('linen-replacement', 'Remplacement linge de maison', 'Remplacement complet du linge de maison pendant le séjour, selon disponibilité.', 15.00, 'Confort & praticité', 3, 7, 'fixed'),
  ('extra-linen', 'Linge de maison supplémentaire', 'Un jeu de linge supplémentaire pour votre séjour.', 10.00, 'Confort & praticité', 3, 8, 'fixed'),
  ('grocery-delivery', 'Service courses', 'Une sélection de courses livrée au logement avant votre arrivée.', 29.90, 'Confort & praticité', 3, 9, 'fixed'),

  ('cruise-island-transfer', 'Récupération / dépose croisières ou inter-îles', 'Transfert entre votre logement et le port pour une croisière ou une liaison inter-îles.', 10.00, 'Transport & transferts', 4, 1, 'fixed'),
  ('airport-transfer', 'Récupération / dépose à l’aéroport', 'Transfert entre le logement et l’aéroport, à organiser selon les disponibilités.', 15.00, 'Transport & transferts', 4, 2, 'fixed'),

  ('luggage-storage', 'Consigne bagages', 'Déposez vos bagages en lieu sûr avant l’arrivée ou après le départ, selon disponibilité.', 10.00, 'Pour un séjour sans contrainte', 5, 1, 'fixed');
