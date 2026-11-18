ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;
