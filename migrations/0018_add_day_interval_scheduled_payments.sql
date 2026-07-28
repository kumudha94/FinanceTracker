-- Day-based recurrence cycles for scheduled payments (e.g. phone recharge every 84 days)
ALTER TABLE scheduled_payments
  ADD COLUMN IF NOT EXISTS custom_interval_days INTEGER;
