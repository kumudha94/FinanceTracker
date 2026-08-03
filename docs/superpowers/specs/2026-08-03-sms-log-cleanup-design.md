# SMS Log Retention Cleanup

TODO.md Section 8.8: "How old records will get archived / deleted in DB... Plan
this." Confirmed via discussion this is precautionary, not driven by an actual
storage/performance problem. Checked the schema: no archival/retention logic
exists anywhere in this codebase today (only a full "delete my account" wipe).

## Scope

Of every table in `shared/schema.ts`, only `sms_logs` is a genuine candidate
right now: it's the only table with fast, unbounded growth (every bank-relevant
SMS, forever), and it's low-value to keep once its purpose is served — the
transaction it produced already lives independently in `transactions`, keyed
via `smsLogs.transactionId`. Every other table (`transactions`, loans,
insurance, savings, statements, salary cycles...) grows slowly enough for a
single user that it won't matter for years, and `transactions` specifically is
the app's core financial ledger — not something to add deletion risk to for a
problem that doesn't exist. This spec covers `sms_logs` only. Extending the
same mechanism to another table later is a new config entry, not a redesign.

The real justification here isn't storage size (a single user's `sms_logs`
volume is small enough that capacity won't bite for years either) — it's that
this table holds raw bank SMS text (account numbers, balances) sitting around
indefinitely. Pruning it after a year is a data-hygiene practice.

## Retention rule

An `sms_logs` row is eligible for deletion when **both**:
1. `receivedAt` is older than 12 months, **and**
2. it is not still awaiting user action — excluded if `institutionMappingId`
   references a `sender_institution_mappings` row with `status = 'pending'`,
   or `billMappingId` references a `bill_sender_mappings` row with
   `status = 'pending'`.

Rule 2 exists so an old, never-triaged SMS in the review queue is never
silently destroyed by a cleanup pass — it stays eligible only once resolved
(mapped or ignored) and then aged past 12 months from that point on, same as
any other row.

Deletion is a straight `DELETE`, no archive/soft-delete step — the parsed
transaction (if any) already exists independently, so there's nothing in the
row worth preserving elsewhere.

## Trigger mechanism

Manual only, scoped to the authenticated user. No cron, no background job, no
new infrastructure (Render's free tier has no built-in scheduler, and this
isn't urgent enough to justify a paid add-on or an external scheduler hitting
an endpoint).

## Backend — two endpoints

**`GET /api/sms-logs/cleanup-preview`** (authenticated): computes and returns
the eligible set per the retention rule above, scoped to `req.user.userId`.
Response: `{ count: number; oldestReceivedAt: string | null; newestReceivedAt: string | null }`.
No deletion. `null` timestamps when `count` is 0.

**`POST /api/sms-logs/cleanup`** (authenticated): deletes exactly the same
eligible set (identical WHERE conditions as the preview query — same age
cutoff, same pending-exclusion joins, same `userId` scope) and returns
`{ deletedCount: number }`.

Both queries filter `sms_logs.userId = req.user.userId` directly — `sms_logs.userId`
is nullable in the schema (some historical rows may have been logged without a
resolved user), so rows with `userId IS NULL` are never touched by either
endpoint regardless of age; only a user's own rows are ever eligible.

## Mobile — Settings screen

A new "Data Cleanup" row in `SettingsScreen.tsx`, placed near the existing
"Delete Account" section and following the same file's established
confirm-before-destructive convention (`Alert.alert` with a Cancel/Confirm
pair, matching how "Delete Account" is already implemented in this screen).

Tap sequence:
1. Fetch `GET /api/sms-logs/cleanup-preview`.
2. If `count === 0`: show an informational alert ("No SMS logs older than 12
   months to clean up.") and stop — no confirm step, nothing to confirm.
3. If `count > 0`: show a confirmation `Alert` with the count (e.g. "142 SMS
   logs older than 12 months will be deleted. This can't be undone.") and
   Cancel/Delete buttons.
4. On confirm: call `POST /api/sms-logs/cleanup`, then show a success alert
   with the actual `deletedCount` returned.

No loading-state UI beyond what `Alert`-driven flows already do elsewhere in
this screen (e.g. `isDeletingAccount`) — a lightweight `isCleaningUp` boolean
disables the row while the preview/delete calls are in flight, mirroring that
existing pattern.

## Out of scope

- No archiving step — straight delete only.
- No cron/scheduled/automatic execution.
- No changes to `transactions`, `payment_occurrences`, or any other table.
- No admin-only gating beyond normal request authentication — this is a
  single-user app, "authenticated" already means "you."

## Testing

No automated test suite exists for this app (server or mobile) — established
throughout prior work on this codebase. Verification is `npm run check`
(root, for the new endpoints) and `cd mobile && npx tsc --noEmit` (for the
Settings screen change) against whatever the current baseline error counts
are at implementation time, plus manual verification once run: confirm the
preview count matches expectation for known test data, confirm a pending
review-queue SMS is excluded even if old, confirm the delete count matches
the preview count, confirm a second preview immediately after shows 0.
