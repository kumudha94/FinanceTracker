# Variable-Amount Scheduled Payments Design
**Date:** 2026-07-27
**Status:** Approved

## Problem

`scheduledPayments.amount` is required at creation for every payment except `paymentType: 'credit_card_bill'` (where it's auto-calculated from transactions). Bills whose amount genuinely varies each cycle — electricity, water, usage-based utilities — have no way to be entered without a fixed number to type in (TO DO.md, "Scheduled Payment" item 1).

A related gap surfaces once this is fixed: the checklist always displays the scheduled payment's fixed `amount`, defaulting to 0 when null, and `paymentOccurrences` has no field for "this cycle's actual bill amount" distinct from `paidAmount` (which only means "amount actually paid"). There's also a pre-existing display bug — `formatCurrency(parseFloat(payment.amount))` in the Manage tab renders "₹NaN" for any null-amount payment (already reachable today via `credit_card_bill`).

## Solution Overview

Add an explicit `variableAmount` flag to `scheduledPayments` so the system can distinguish "this bill's amount is unknown by design" from "someone left the field blank by mistake." Add a per-cycle `amount` column to `paymentOccurrences`, separate from `paidAmount`, so a variable bill's figure can be recorded as soon as it's known (e.g. the day the electricity bill arrives) and counted correctly in the Pending total — before it's actually paid.

---

## Data Model

- `scheduledPayments.variableAmount: boolean` (default `false`). When `true`, `amount` may be null at creation and going forward.
- `paymentOccurrences.amount: decimal(12,2), nullable` — the actual figure for *this specific cycle*. Distinct from `paidAmount`, which continues to mean "what was actually paid" (mirrors the existing `creditCardStatements.statementBalance` vs `paidAmount` split).

## Creation & Validation

- `insertScheduledPaymentSchema`'s `.refine()` for amount relaxes: required unless `paymentType === 'credit_card_bill'` **or** `variableAmount === true`.
- Create/edit form gains a "This bill's amount varies each time" toggle. When on, the Amount input is hidden/optional.

## Checklist UI (`scheduled-payments.tsx`)

- Each occurrence row displays `occurrence.amount ?? payment.amount`.
- If a variable-amount occurrence has no `amount` yet, the row shows an "Enter amount" prompt instead of a number, and **the paid checkbox is disabled** — you can't mark something paid with an unknown amount.
- Tapping the row (not the checkbox) on such an occurrence opens a small inline input to set `occurrence.amount`, saved via `PATCH /api/payment-occurrences/:id` (already supports partial updates — extend it to accept `amount`).
- `totalPending` / `totalPaid` sum `occurrence.amount ?? payment.amount ?? 0` per occurrence instead of always reading `payment.amount`, so a priced-but-unpaid variable bill counts correctly in Pending.
- Fix while touching this code: the Manage tab's `formatCurrency(parseFloat(payment.amount))` (line 473) shows "Amount varies" instead of "₹NaN" when `payment.amount` is null.

## Occurrence Generation (`generatePaymentOccurrencesForMonth`)

- No change to *when* occurrences are generated — same frequency logic as today.
- The `occurrenceAmount` auto-calculation (currently special-cased for `credit_card_bill`) also leaves `amount` null for `variableAmount` payments — nothing to auto-calculate; it's genuinely unknown until entered.

## Edge Cases & Error Handling

- **Server-side enforcement**: `PATCH /api/payment-occurrences/:id` rejects `status: "paid"` when `amount` is null on a `variableAmount` payment's occurrence — the disabled checkbox stops the normal UI path, but the API must not rely on the client alone for this invariant.
- **Marking paid**: `paidAmount` defaults to `occurrence.amount` when checked — no need to re-type the same number. No partial-payment UI is introduced; the existing binary paid/pending model is unchanged.
- **Toggling `variableAmount`** on an existing payment: takes effect only for occurrences generated from that point forward. Already-generated occurrences are untouched.
- **Historical null-amount occurrences** (existing `credit_card_bill` rows): unaffected — `occurrence.amount ?? payment.amount ?? 0` already handles them the same way it handles new variable-amount rows.

## Testing

No automated test suite covers this UI today (only the hand-rolled `server/__tests__/smsParser.test.ts` exists in this codebase). Verification is manual, in the running dev app:

1. Create a variable-amount bill (e.g. "Electricity") with no amount → confirm it saves.
2. Generate this month's checklist → confirm the row shows "Enter amount," checkbox disabled.
3. Tap the row, enter an amount → confirm it saves, checkbox becomes enabled, Pending total updates.
4. Check it paid → confirm `paidAmount` is set and it moves to the Paid total.
5. Regression: an ordinary fixed-amount payment behaves exactly as before.

## Out of Scope

- Partial payments / editing `paidAmount` independently of `amount` at pay-time.
- Suggesting a default/typical amount based on past cycles.
- Retroactively backfilling `amount` on already-generated occurrences.
- TODO item 2 (day-based recurrence cycles, e.g. every 56/84 days) — separate design, tracked independently since it requires reworking the occurrence-generation engine rather than extending this one.
