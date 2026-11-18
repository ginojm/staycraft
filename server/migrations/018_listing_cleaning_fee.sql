ALTER TABLE listings ADD COLUMN cleaning_fee NUMERIC(10,2) NOT NULL DEFAULT 35
  CHECK (cleaning_fee >= 0 AND cleaning_fee <= 100000);
