# Transaction Spending Tracker — Design

**Date:** 2026-09-28
**Status:** Approved (brainstorming), pending spec review

## Goal

Lump-sum credits (PF advance, ITR refund, bonus, maturity payout) arrive as ordinary income
transactions. The user wants to record how each such amount was spent, so they can look back
later and keep spending focused. This mirrors the existing loan **Spending Breakdown** feature
(`loan_spending_entries` + `SpendingBreakdownModal`), applied to individual transactions.

## Decisions (from brainstorming)

- **Where:** a toggle on the existing transaction edit screen — not a separate More-menu screen.
  Transactions are already auto-added from SMS/notifications, so no separate "pick a transaction"
  step is needed. A filter chip on the Transactions list gives the "all tracked amounts" overview.
- **Entry shape:** free-text reason + amount only, identical to loan entries. No linking to
  actual debit transactions, no effect on account balances — pure record-keeping.
- **Eligibility:** income (`type = 'credit'`) transactions only.
- **Total:** the transaction's own `amount`. No editable "received amount" (unlike loans).

## 1. Data model (`shared/schema.ts`)

- `transactions.spendingTrackerEnabled` — `boolean`, not null, default `false`.
- New table `transaction_spending_entries`, mirroring `loan_spending_entries`:
  - `id` serial PK
  - `transactionId` integer, FK → `transactions.id` with `onDelete: 'cascade'`, not null
  - `amount` decimal(14,2), not null
  - `reason` text, nullable
  - `createdAt` timestamp, not null, default now
- Relations, `insertTransactionSpendingEntrySchema` (amount required string, reason optional),
  and `TransactionSpendingEntry` / `InsertTransactionSpendingEntry` types, following the loan
  entry definitions.

**Deploy ordering:** `npm run db:push` must run before (or atomically with) the server deploy —
`storage.ts` will read the new column unconditionally once live.

## 2. Storage (`server/storage.ts`)

Add to the `IStorage` interface and implementation, mirroring the loan methods:

- `getTransactionSpendingEntries(transactionId)` — ordered by `createdAt` desc
- `createTransactionSpendingEntry(entry)`
- `updateTransactionSpendingEntry(id, { amount?, reason? })`
- `deleteTransactionSpendingEntry(id)`

Transaction delete: handled by the FK's `ON DELETE CASCADE`. Transactions are deleted from
more than one place (single delete, and bulk delete inside account deletion), so a DB-level
cascade covers every path without touching each one.

`getTransaction` and `getAllTransactions` select an explicit column list — both must add
`spendingTrackerEnabled` or the flag never reaches the client.

Transaction list: `GET /api/transactions` results include `spendingAllocated: string | null` —
sum of entry amounts for transactions with `spendingTrackerEnabled = true`, `null` otherwise.
Computed with one grouped aggregate query over the returned transaction IDs (no N+1).

## 3. API (`server/routes.ts`)

All routes use `authenticateToken` and return 404 if the transaction does not belong to the user.

- `GET    /api/transactions/:id/spending-entries`
- `POST   /api/transactions/:id/spending-entries` — body `{ amount, reason? }`
- `PATCH  /api/transactions/:id/spending-entries/:entryId` — body `{ amount?, reason? }`
- `DELETE /api/transactions/:id/spending-entries/:entryId`

POST and PATCH additionally return 400 if the transaction is not `credit` or
`spendingTrackerEnabled` is false.

**Validation:** reuse `validateNewSpendingEntry` from `server/loanSpendingValidation.ts`, passing
the transaction `amount` as the total. For PATCH, validate against the existing entries minus the
one being edited (check how the loan PATCH route does this and match it). Entries may not sum above the
transaction amount.

**Toggle:** the existing transaction update route accepts `spendingTrackerEnabled`. Setting it
`true` on a non-credit transaction returns 400. If a transaction's type is changed away from
`credit`, the server forces `spendingTrackerEnabled = false`.

**Amount edits:** lowering a tracked transaction's `amount` below its already-allocated total
returns 400.

**Money comparison:** allocation checks compare in integer paise, not floats, so e.g. entries
of 0.10 + 0.20 exactly fill a 0.30 total. This fix is made in the shared
`validateNewSpendingEntry`, so loans benefit too.

**Toggling off** keeps existing entries (hidden in the UI); toggling back on restores them.

## 4. Mobile UI

### Shared modal — `mobile/src/components/SpendingBreakdownModal.tsx`

Generalize props from `{ loanId }` to a discriminated source:

```ts
type Source = { kind: 'loan'; loanId: number } | { kind: 'transaction'; transactionId: number };
```

- Loan: unchanged behaviour (editable received amount, loan query keys).
- Transaction: total = transaction amount (read-only display), no received-amount editor;
  queries/mutations use the transaction endpoints and query key
  `['transaction-spending-entries', transactionId]`. Mutations also invalidate the transactions
  list query so "₹X left" refreshes.
- `LoanDetailsScreen` updated to pass `source={{ kind: 'loan', loanId }}`.

New API client methods in `mobile/src/lib/api.ts` and `TransactionSpendingEntry` type in
`mobile/src/lib/types.ts`; `Transaction` type gains `spendingTrackerEnabled` and
`spendingAllocated`.

### Edit transaction — `mobile/src/screens/AddTransactionScreen.tsx`

- Only in edit mode (existing transaction) and only when the type is `credit`: a
  **"Track spending"** switch. It saves immediately on flip (its own PATCH with just
  `spendingTrackerEnabled`), independent of the Update Transaction button, so the Spending
  Breakdown button can appear right away without leaving the screen.
- When the saved transaction has the tracker on, a **"Spending Breakdown"** button opens the
  shared modal.

### Transactions list — `mobile/src/screens/TransactionsScreen.tsx`

- Tracked transactions show a small icon plus **"₹X left"** (amount − spendingAllocated) under
  the amount.
- New **"Spending Tracked"** filter chip beside the existing type filter; when active, only
  transactions with `spendingTrackerEnabled = true` are shown. Combines with other filters.

## 5. Testing

- Unit tests for validation reuse with a transaction total (pure function, no DB), following
  the existing `loanSpendingValidation` tests.
- Route-level checks: non-credit / tracker-off rejection, ownership 404, over-allocation 400.
- On-device verification (toggle, modal, list icon, filter chip) is left to the user — no
  Android emulator in this environment.

## Out of scope

- Linking entries to real debit transactions.
- A separate More-menu screen.
- Tracking on debit/transfer transactions.
- Web client (`client/`) changes — mobile only.
