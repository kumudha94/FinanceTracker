# Loan Spending Breakdown Design
**Date:** 2026-07-30
**Status:** Approved

## Problem

When a loan is disbursed, the amount actually received can be lower than the principal (processing fees, deductions). There's currently no way to record what the loan was actually used for once it lands in the account (TODO.md, "Loan Screen" item 1). This is purely a bookkeeping gap — the loan's own principal/EMI/repayment tracking is unaffected and out of scope here.

Mobile only: web has a single `loans.tsx` list page with no separate detail/edit screens, so this feature isn't designed for web in this pass.

## Solution Overview

Add a "Spending Breakdown" icon to `LoanDetailsScreen.tsx` and `AddLoanScreen.tsx` (edit mode only — it needs an existing loan). Tapping it opens a modal where the user can set the loan's actual **Received Amount** and log multiple **spending entries** (amount + optional reason) recording how that money was used. This is pure record-keeping: no transactions are created and no account balances change.

---

## Data Model

- `loans.receivedAmount: decimal(14,2), nullable` — new column. Null means "not yet set"; the UI pre-fills the input with `principalAmount` the first time the modal opens, but the stored value stays null until the user explicitly saves it.
- New table `loan_spending_entries`:
  - `id: serial primary key`
  - `loanId: integer references loans(id), not null`
  - `amount: decimal(14,2), not null`
  - `reason: text, nullable`
  - `createdAt: timestamp, not null, default now()`

No link to `transactions` or `accounts` — this table is standalone.

## API

- `PATCH /api/loans/:id` — extend `insertLoanSchema`/update path to accept `receivedAmount`. Reuses the existing loan update endpoint rather than adding a new one.
- `GET /api/loans/:id/spending-entries` — list entries for a loan, newest first.
- `POST /api/loans/:id/spending-entries` — body `{ amount, reason? }`. Server validates `amount > 0` and that `sum(existing entries) + amount <= loan.receivedAmount`; rejects with 400 otherwise. If `receivedAmount` is null on the loan, reject with a clear error ("Set the received amount before adding entries") rather than silently allowing an unbounded total.
- `DELETE /api/spending-entries/:id` — verifies the entry's loan belongs to the authenticated user before deleting (same ownership-check pattern used throughout `routes.ts`).

## UI (Mobile)

- Icon (pie-chart style) added to the header action row of `LoanDetailsScreen.tsx`, and to `AddLoanScreen.tsx` but only when `isEditMode` is true (a new, unsaved loan has no ID to attach entries to).
- Opens a `Modal`, following the same slide-up pattern as the existing loan action modals in `LoanDetailsScreen.tsx` (top-up, part-payment, pay-EMI, etc.) for visual consistency.
- Modal layout, top to bottom:
  1. **Loan Amount** — read-only, from `loan.principalAmount`.
  2. **Received Amount** — currency input, pre-filled with `principalAmount` on first open if `receivedAmount` is null. A small inline "Save" button next to the field commits it via `PATCH /api/loans/:id` (explicit save, not save-on-blur — avoids accidental writes from the mobile keyboard).
  3. **Allocated so far** — informational text: `"₹X of ₹Y allocated, ₹Z unaccounted"`. Never blocks anything; partial allocation is expected and fine.
  4. **Entry list** — each row shows Amount + Reason (if present) + a trash-icon delete button. Deleting is immediate (no confirmation dialog, matching how lightweight list edits work elsewhere in this app) and refetches the list.
  5. **Add Entry** — an inline expandable mini-form (Amount + optional Reason + Add button) at the bottom of the list, rather than a second nested modal. Submitting immediately POSTs and appends to the list; the mini-form clears and collapses on success.
- All mutations (`receivedAmount` save, entry add, entry delete) invalidate the loan-details query so the modal and any parent screen totals stay in sync.

## Edge Cases & Error Handling

- **Adding an entry with no `receivedAmount` set yet**: server rejects (see API section); client should also disable/hint on the Add button in this state rather than let the user hit the error.
- **Entry amount would exceed the remaining unallocated balance**: rejected server-side with a clear message; client shows the same message inline near the Add form rather than a toast, so it's visible next to the input that caused it.
- **Deleting an entry**: always allowed (deleting only frees up allocation room, never violates the total-\<=-received invariant).
- **Loan itself deleted**: this codebase doesn't use DB-level cascades for loan child tables — `storage.deleteLoan()` explicitly deletes `loanPayments`, `loanInstallments`, `loanTerms`, `loanComponents`, and `loanBtAllocations` before deleting the loan row. Add a matching `await db.delete(loanSpendingEntries).where(eq(loanSpendingEntries.loanId, id));` line to that same function, following the established convention instead of introducing DB-level cascade as a one-off.
- **Editing an existing entry**: out of scope (see below) — correcting a typo means delete + re-add.

## Testing

No automated test suite covers mobile screens today (same situation the variable-amount-scheduled-payments spec noted). Verification is manual, in the running app:

1. Open Spending Breakdown on a loan with no `receivedAmount` set → confirm the input pre-fills with the loan amount, confirm Add Entry is disabled/hinted until Received Amount is explicitly saved.
2. Save a Received Amount lower than the loan amount → confirm it persists across screen navigation.
3. Add two entries that together are under the received amount → confirm both show up, "Allocated so far" updates correctly.
4. Attempt to add an entry that would exceed the remaining balance → confirm it's rejected with a clear inline message.
5. Delete an entry → confirm it disappears and "Allocated so far" updates.
6. Open the modal from both `LoanDetailsScreen` and `AddLoanScreen` (edit mode) → confirm it's the same data both places.
7. Confirm the icon does NOT appear on `AddLoanScreen` while creating a brand-new loan (before the first save).

## Out of Scope

- Editing an existing spending entry (only add/delete, per the original request).
- Any link between spending entries and transactions/account balances — this is pure record-keeping.
- Web support (`client/src/pages/loans.tsx`) — no separate detail/edit screens exist there today; would need its own design if requested later.
- Categorizing spending entries (e.g. by category) — just amount + free-text reason.
- Any change to the loan's own principal/EMI/repayment tracking.
