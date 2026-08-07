-- Powers merchant-history category matching's "most recently updated" tie-break —
-- transactions never had this column, unlike every other table in this schema.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
