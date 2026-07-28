-- Variable-amount scheduled payments (e.g. electricity bills with no fixed amount)
ALTER TABLE scheduled_payments
  ADD COLUMN IF NOT EXISTS variable_amount BOOLEAN DEFAULT false;

-- Per-cycle actual bill amount, distinct from paid_amount (what was actually paid)
ALTER TABLE payment_occurrences
  ADD COLUMN IF NOT EXISTS amount DECIMAL(12, 2);
