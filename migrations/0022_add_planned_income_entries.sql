-- Ad-hoc planned income entries (freelance payment, refund, bonus, etc.) — the income-side
-- counterpart to saving an "Others" ad-hoc entry as a one-time scheduled payment.
-- Isolated table since scheduled_payments is structurally expense-only.
CREATE TABLE IF NOT EXISTS planned_income_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  expected_month INTEGER NOT NULL,
  expected_year INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS planned_income_entries_user_month_year_idx
  ON planned_income_entries (user_id, expected_year, expected_month);
