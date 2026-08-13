-- Distinguishes SMS-sourced vs. notification-sourced sms_logs rows, for the notification-based
-- bill/due-reminder capture feature. Existing rows default to 'sms', which is already correct
-- (they predate notification capture entirely).
ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'sms';
