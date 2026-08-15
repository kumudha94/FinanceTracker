-- Distinguishes SMS-sourced vs. notification-sourced sms_logs rows, for the notification-based
-- bill/due-reminder capture feature. Existing rows default to 'sms', which is already correct
-- (they predate notification capture entirely).
-- Must be applied before/atomically with the corresponding server deploy: storage.ts's
-- getSmsLogsForBillMapping and createSmsLog reference this column unconditionally, so the
-- pre-existing SMS pipeline breaks too (not just notification capture) if it's missing.
ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'sms';
