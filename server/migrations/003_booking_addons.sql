CREATE TABLE booking_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reservation_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES booking_addons(id) ON DELETE SET NULL,
  code_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price > 0),
  quantity SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total NUMERIC(10, 2) NOT NULL CHECK (line_total > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, code_snapshot)
);

CREATE INDEX reservation_addons_reservation_idx ON reservation_addons (reservation_id);
CREATE TRIGGER booking_addons_set_updated_at BEFORE UPDATE ON booking_addons
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO booking_addons (id, code, name, description, price, sort_order) VALUES
  ('30000000-0000-4000-8000-000000000001', 'early-check-in', 'Arrivée hâtive', 'Profitez du logement plus tôt, selon les disponibilités de l’hôte.', 25, 1),
  ('30000000-0000-4000-8000-000000000002', 'late-check-out', 'Départ tardif', 'Prolongez votre matinée, sous réserve de disponibilité.', 30, 2),
  ('30000000-0000-4000-8000-000000000003', 'romantic-box', 'Coffret romantique', 'Une attention avec douceurs et décoration pour une arrivée spéciale.', 55, 3),
  ('30000000-0000-4000-8000-000000000004', 'breakfast-for-two', 'Petit-déjeuner pour deux', 'Un petit-déjeuner local livré pour bien commencer la journée.', 28, 4);
