CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE reservation_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');
CREATE TYPE listing_status AS ENUM ('draft', 'published', 'paused', 'archived');
CREATE TYPE payment_status AS ENUM ('pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE message_status AS ENUM ('sent', 'read');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  description TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'France',
  category TEXT NOT NULL,
  price_per_night NUMERIC(10, 2) NOT NULL CHECK (price_per_night > 0),
  max_guests SMALLINT NOT NULL DEFAULT 8 CHECK (max_guests BETWEEN 1 AND 32),
  cover_image_url TEXT NOT NULL,
  badge TEXT,
  status listing_status NOT NULL DEFAULT 'published',
  average_rating NUMERIC(3, 2) NOT NULL DEFAULT 0 CHECK (average_rating BETWEEN 0 AND 5),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE listing_amenities (
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  amenity TEXT NOT NULL CHECK (length(trim(amenity)) BETWEEN 1 AND 80),
  PRIMARY KEY (listing_id, amenity)
);

CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  guest_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  guests SMALLINT NOT NULL CHECK (guests BETWEEN 1 AND 32),
  price_per_night NUMERIC(10, 2) NOT NULL CHECK (price_per_night > 0),
  service_fee NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
  cleaning_fee NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (cleaning_fee >= 0),
  total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount > 0),
  status reservation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in),
  EXCLUDE USING gist (
    listing_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed'))
);

CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status payment_status NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);

CREATE TABLE payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  provider_refund_id TEXT UNIQUE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversations_reservation_unique
  ON conversations (reservation_id) WHERE reservation_id IS NOT NULL;

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  status message_status NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 5 AND 3000),
  host_response TEXT,
  host_responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_id, reviewer_id, reservation_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listings_browse_idx ON listings (status, category, price_per_night);
CREATE INDEX listings_host_idx ON listings (host_id, created_at DESC);
CREATE INDEX reservations_guest_idx ON reservations (guest_id, created_at DESC);
CREATE INDEX reservations_listing_dates_idx ON reservations (listing_id, check_in, check_out);
CREATE INDEX payments_reservation_idx ON payment_transactions (reservation_id, created_at DESC);
CREATE INDEX conversations_updated_idx ON conversations (updated_at DESC);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
CREATE INDEX reviews_listing_idx ON reviews (listing_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER listings_set_updated_at BEFORE UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER reservations_set_updated_at BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION refresh_listing_rating() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_listing UUID;
BEGIN
  target_listing = COALESCE(NEW.listing_id, OLD.listing_id);
  UPDATE listings
  SET average_rating = COALESCE((SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE listing_id = target_listing), 0),
      review_count = (SELECT count(*) FROM reviews WHERE listing_id = target_listing)
  WHERE id = target_listing;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER reviews_refresh_listing_rating
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION refresh_listing_rating();

INSERT INTO users (id, full_name, email) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Camille', 'seed-camille@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'Mathieu', 'seed-mathieu@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000003', 'Louise', 'seed-louise@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000004', 'Antoine', 'seed-antoine@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000005', 'Nina', 'seed-nina@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000006', 'Élodie', 'seed-elodie@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000007', 'Théo', 'seed-theo@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000008', 'Maëlle', 'seed-maelle@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000009', 'Baptiste', 'seed-baptiste@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000010', 'Sarah', 'seed-sarah@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000011', 'Manon', 'seed-manon@foyaltoloman.invalid'),
  ('10000000-0000-4000-8000-000000000012', 'Hugo', 'seed-hugo@foyaltoloman.invalid');

INSERT INTO listings (id, host_id, title, description, city, region, country, category, price_per_night, cover_image_url, badge) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'La cabane des pins', 'Une cabane lumineuse nichée entre les pins, à quelques minutes du lac. Le refuge parfait pour ralentir et respirer.', 'Biscarrosse', 'Nouvelle-Aquitaine', 'France', 'Cabane', 128, 'photo-1449158743715-0a90ebb6d2d8', 'Coup de cœur'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Villa au bord de l’eau', 'Une maison contemporaine ouverte sur le lac, avec ponton privé et grande terrasse pour les longues soirées d’été.', 'Annecy', 'Auvergne-Rhône-Alpes', 'France', 'Villa', 210, 'photo-1600607687939-ce8a6c25118c', NULL),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'Maison bleue face à l’océan', 'Les volets bleus s’ouvrent sur l’océan. Plage à pied, vélos à disposition et douceur de vivre rétaise.', 'Île de Ré', 'Nouvelle-Aquitaine', 'France', 'Bord de mer', 174, 'photo-1499793983690-e29da59ef1c2', NULL),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'Le petit chalet des cimes', 'Un chalet de montagne tout en bois, avec poêle à bois et panorama sur les sommets depuis le balcon.', 'Chamonix', 'Auvergne-Rhône-Alpes', 'France', 'Montagne', 156, 'photo-1510798831971-661eb04b3739', 'Rare'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'L’atelier sous les toits', 'Un appartement d’artiste calme et baigné de lumière, à deux pas des cafés et des petites galeries du quartier.', 'Paris', 'Île-de-France', 'France', 'Ville', 142, 'photo-1502672260266-1c1ef2d93688', NULL),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', 'Domaine des oliviers', 'Une ancienne bergerie restaurée au milieu des oliviers, avec piscine au sel et vue sur le Luberon.', 'Gordes', 'Provence-Alpes-Côte d’Azur', 'France', 'Nature', 198, 'photo-1613977257363-707ba9348227', 'Coup de cœur'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', 'Nid perché dans la forêt', 'Une cabane perchée pensée pour deux, avec bain nordique et petit-déjeuner de producteurs locaux.', 'Sarlat', 'Nouvelle-Aquitaine', 'France', 'Cabane', 112, 'photo-1449158743715-0a90ebb6d2d8', NULL),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008', 'L’appartement des marées', 'Une adresse douce au cœur de la cité corsaire, avec les remparts et la plage à quelques pas.', 'Saint-Malo', 'Bretagne', 'France', 'Bord de mer', 136, 'photo-1499793983690-e29da59ef1c2', NULL),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009', 'Refuge au-dessus des nuages', 'Un refuge chaleureux avec sauna et cheminée, idéal après une journée sur les sentiers ou les pistes.', 'Megève', 'Auvergne-Rhône-Alpes', 'France', 'Montagne', 224, 'photo-1510798831971-661eb04b3739', NULL),
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000010', 'La maison des canuts', 'Un appartement plein de caractère au cœur de la Croix-Rousse, entre marché, traboules et bonnes tables.', 'Lyon', 'Auvergne-Rhône-Alpes', 'France', 'Ville', 119, 'photo-1600210492486-724fe5c67fb0', NULL),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011', 'Le mas des lavandes', 'Un mas provençal entouré de lavande, avec une cour ombragée et un marché de village tout proche.', 'Lourmarin', 'Provence-Alpes-Côte d’Azur', 'France', 'Nature', 185, 'photo-1613977257363-707ba9348227', NULL),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', 'La maison du cap', 'Une maison de vacances élégante avec piscine chauffée, à vélo des plages et des halles de Biarritz.', 'Biarritz', 'Nouvelle-Aquitaine', 'France', 'Villa', 246, 'photo-1600607687939-ce8a6c25118c', NULL);

INSERT INTO listing_amenities (listing_id, amenity) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Cuisine équipée'), ('20000000-0000-4000-8000-000000000001', 'Terrasse privée'), ('20000000-0000-4000-8000-000000000001', 'Wifi rapide'), ('20000000-0000-4000-8000-000000000001', 'Parking gratuit'),
  ('20000000-0000-4000-8000-000000000002', 'Vue sur le lac'), ('20000000-0000-4000-8000-000000000002', 'Cuisine équipée'), ('20000000-0000-4000-8000-000000000002', 'Ponton privé'), ('20000000-0000-4000-8000-000000000002', 'Parking gratuit'),
  ('20000000-0000-4000-8000-000000000003', 'Accès plage'), ('20000000-0000-4000-8000-000000000003', 'Vélos'), ('20000000-0000-4000-8000-000000000003', 'Jardin clos'), ('20000000-0000-4000-8000-000000000003', 'Cuisine équipée'),
  ('20000000-0000-4000-8000-000000000004', 'Vue montagne'), ('20000000-0000-4000-8000-000000000004', 'Poêle à bois'), ('20000000-0000-4000-8000-000000000004', 'Balcon'), ('20000000-0000-4000-8000-000000000004', 'Local à skis'),
  ('20000000-0000-4000-8000-000000000005', 'Wifi rapide'), ('20000000-0000-4000-8000-000000000005', 'Cuisine équipée'), ('20000000-0000-4000-8000-000000000005', 'Ascenseur'), ('20000000-0000-4000-8000-000000000005', 'Espace de travail'),
  ('20000000-0000-4000-8000-000000000006', 'Piscine privée'), ('20000000-0000-4000-8000-000000000006', 'Jardin'), ('20000000-0000-4000-8000-000000000006', 'Climatisation'), ('20000000-0000-4000-8000-000000000006', 'Parking gratuit'),
  ('20000000-0000-4000-8000-000000000007', 'Bain nordique'), ('20000000-0000-4000-8000-000000000007', 'Terrasse privée'), ('20000000-0000-4000-8000-000000000007', 'Petit-déjeuner'), ('20000000-0000-4000-8000-000000000007', 'Parking gratuit'),
  ('20000000-0000-4000-8000-000000000008', 'Vue mer'), ('20000000-0000-4000-8000-000000000008', 'Cuisine équipée'), ('20000000-0000-4000-8000-000000000008', 'Wifi rapide'), ('20000000-0000-4000-8000-000000000008', 'Lave-linge'),
  ('20000000-0000-4000-8000-000000000009', 'Sauna'), ('20000000-0000-4000-8000-000000000009', 'Cheminée'), ('20000000-0000-4000-8000-000000000009', 'Vue montagne'), ('20000000-0000-4000-8000-000000000009', 'Local à skis'),
  ('20000000-0000-4000-8000-000000000010', 'Cuisine équipée'), ('20000000-0000-4000-8000-000000000010', 'Wifi rapide'), ('20000000-0000-4000-8000-000000000010', 'Espace de travail'), ('20000000-0000-4000-8000-000000000010', 'Lave-linge'),
  ('20000000-0000-4000-8000-000000000011', 'Jardin'), ('20000000-0000-4000-8000-000000000011', 'Piscine partagée'), ('20000000-0000-4000-8000-000000000011', 'Barbecue'), ('20000000-0000-4000-8000-000000000011', 'Parking gratuit'),
  ('20000000-0000-4000-8000-000000000012', 'Piscine privée'), ('20000000-0000-4000-8000-000000000012', 'Vélos'), ('20000000-0000-4000-8000-000000000012', 'Jardin'), ('20000000-0000-4000-8000-000000000012', 'Cuisine équipée');
