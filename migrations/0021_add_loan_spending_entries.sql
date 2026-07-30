-- Record-keeping for how a loan's received amount was actually spent
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS received_amount DECIMAL(14, 2);

CREATE TABLE IF NOT EXISTS loan_spending_entries (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  amount DECIMAL(14, 2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
