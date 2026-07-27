-- Bills Inbox / due-SMS reconciliation feature
-- 1. New table for learned sender -> scheduled payment mappings (parallel to sender_institution_mappings)
CREATE TABLE IF NOT EXISTS bill_sender_mappings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  institution_key VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  scheduled_payment_id INTEGER REFERENCES scheduled_payments(id),
  suggested_name VARCHAR(200),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bill_sender_mappings_user_institution_unique
  ON bill_sender_mappings (user_id, institution_key);

-- 2. Evidence columns for due-SMS confirmation against existing due-tracking tables
ALTER TABLE credit_card_statements
  ADD COLUMN IF NOT EXISTS sms_confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sms_reported_balance DECIMAL(12, 2);

ALTER TABLE payment_occurrences
  ADD COLUMN IF NOT EXISTS confirmed_by_sms TIMESTAMP;

-- 3. Link columns on sms_logs so a logged due-SMS can point at whatever it resolved to
ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS bill_mapping_id INTEGER REFERENCES bill_sender_mappings(id),
  ADD COLUMN IF NOT EXISTS credit_card_statement_id INTEGER REFERENCES credit_card_statements(id),
  ADD COLUMN IF NOT EXISTS payment_occurrence_id INTEGER REFERENCES payment_occurrences(id);
