-- Auto-funded / linked insurance policies (e.g. a market/sub policy funded by a main policy's benefit)
ALTER TABLE insurances
  ADD COLUMN IF NOT EXISTS auto_funded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_insurance_id INTEGER REFERENCES insurances(id);
