---

---

## Section:1. General

1. We need to have below configuration
  > Week start and end day

## Section:2. Security

1. Audit found (2026-08-04, during merchant-category-bulk-update work) that authorization is inconsistent across `server/routes.ts` `PATCH`/`DELETE .../:id` mutation routes — some resources check ownership correctly, others don't, and some skip auth entirely. Two distinct bug classes, same fix shape (fetch by id, compare to `req.user!.userId`, 404 on mismatch — the pattern already used correctly by `budgets`, `scheduled-payments`, `payment-occurrences`, `savings-contributions`, `salary-cycles`, `spending-entries`, and `cards` after a prior fix in commit `d0ee24f`):
   - **No `authenticateToken` middleware at all** (reachable with zero credentials): `categories` (PATCH/DELETE), `loans` (PATCH/DELETE), `loan-payments` (PATCH/DELETE), `loan-components` (PATCH/DELETE), `loan-installments` (PATCH), `bt-allocations` (PATCH/DELETE), `insurances` (PATCH/DELETE).
   - **Authenticated but no ownership check** (any logged-in user can edit/delete another user's row by guessing/enumerating a sequential id): `accounts` (PATCH/DELETE), `transactions` (PATCH/DELETE), `savings-goals` PATCH only (its sibling DELETE already checks correctly), `salary-profile` PATCH.
   Fix is mechanical per-route but touches ~15 handlers across financial data (loans, insurance, accounts, transactions) — worth its own dedicated pass rather than folding into an unrelated feature branch. **New Priority:High | Development NotStarted**
