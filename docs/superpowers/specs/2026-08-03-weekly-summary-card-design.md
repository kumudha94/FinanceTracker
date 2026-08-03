# Weekly Summary Dashboard Card

## Problem

TODO.md Section 5, item 8: the dashboard has no at-a-glance weekly view. The user wants a small card on the mobile Dashboard showing weekly income, weekly expense, spend split by account vs. credit card, and a week-over-week percentage comparison ("12% more than last week"). Explicitly no push notification — an in-app card only.

## Scope

- Mobile only (the live `mobile/src/screens/DashboardScreen.tsx` — confirmed via `mobile/App.tsx`'s routing that `DashboardScreenV2.tsx` and `DashboardScreen.backup.tsx` are not wired up and are dead files, not touched by this work).
- Week boundary is fixed to Monday–Sunday for now. The user has a future configuration screen planned (mirroring the existing salary-day/cycle-day settings) that will let this vary; today's implementation isolates the boundary calculation behind one function so that future change doesn't touch anything else.
- No new database tables or migrations — this is pure aggregation over existing `transactions` data, the same shape as the (already `userId`-scoped, per this session's security fixes) monthly aggregation endpoints.

## Design

### `server/weekUtils.ts` (new file)

```typescript
import { startOfWeek, endOfWeek } from "date-fns";

export interface WeekBounds {
  weekStart: Date;
  weekEnd: Date;
}

/** Monday 00:00:00 – Sunday 23:59:59 for the week containing referenceDate. */
export function getWeekBounds(referenceDate: Date): WeekBounds {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 });
  return { weekStart, weekEnd };
}
```

A standalone file, not added to `server/salaryUtils.ts` — this is a fixed calendar-week concept, unrelated to the salary-cycle system that file owns. Keeping it separate is what makes "swap this one function for a per-user-configurable version later" a contained change.

### `GET /api/dashboard/weekly-summary` (new route in `server/routes.ts`)

1. `userId = req.user!.userId` (authenticated from the start — this session's audit found several endpoints that forgot this; this one doesn't repeat that mistake).
2. `{ weekStart, weekEnd } = getWeekBounds(new Date())` for the current week; `{ weekStart: lastWeekStart, weekEnd: lastWeekEnd } = getWeekBounds(subWeeks(new Date(), 1))` for the comparison week.
3. Fetch both ranges via the existing `storage.getAllTransactions({ userId, startDate, endDate })` — the same call already used by the monthly-expense endpoints, just parameterized to a week instead of a month.
4. Aggregate the current week's transactions:
   - `income` = sum of `type === 'credit'`
   - `expense` = sum of `type === 'debit'`
   - `spentFromCreditCard` = sum of debit transactions where the joined `account.type === 'credit_card'`
   - `spentFromAccount` = sum of debit transactions where `account.type !== 'credit_card'` (bank, debit_card, wallet, pf — grouped together as "account" per the user's two-bucket phrasing: "how much spent from account, credit card")
5. Aggregate last week's transactions the same way for `income` and `expense` only (that's all the % comparison needs).
6. Compute `incomeChangePercent` and `expenseChangePercent` as `((thisWeek - lastWeek) / lastWeek) * 100`, each `null` when last week's value is `0` (avoids a divide-by-zero/`Infinity%` badge).
7. Respond:
   ```typescript
   {
     weekStart: string;      // ISO
     weekEnd: string;        // ISO
     weekLabel: string;      // e.g. "Jul 28 - Aug 3"
     income: number;
     expense: number;
     spentFromAccount: number;
     spentFromCreditCard: number;
     incomeChangePercent: number | null;
     expenseChangePercent: number | null;
   }
   ```

This is a standalone endpoint, not folded into the existing `/api/dashboard-summary` handler — that handler is already large and models the salary-cycle system; bolting a fixed-calendar-week concept onto it would blur both. A separate handler, separate client query, and separate card component stay independently understandable and independently testable.

### Mobile (`mobile/src/lib/api.ts`, `mobile/src/lib/types.ts`, `mobile/src/screens/DashboardScreen.tsx`)

- New type `WeeklySummary` matching the response shape above.
- New `api.getWeeklySummary(): Promise<WeeklySummary>`.
- New `useQuery(['weekly-summary'], api.getWeeklySummary)` in `DashboardScreen.tsx`.
- New card section, styled as another `mainCard` (matching the existing Current Cycle / Next Cycle Plan cards' visual convention already in this file), placed immediately after the Next Cycle Plan card — the last of the two existing top-level cards in the screen's render order. Shows:
  - Header: "This Week" + `weekLabel`
  - Income row, Expense row
  - "Spent from Account" / "Spent from Credit Card" rows
  - A small badge next to Expense: "+X% vs last week" (red-ish tint if up, green-ish if down) or nothing when `expenseChangePercent` is `null`

## Testing plan

No automated test suite exists in this repo (confirmed earlier this session). Manual verification:
1. Live curl against the new endpoint with a real user token, across a week boundary that includes both credit-card and bank transactions — confirm the two spend buckets sum correctly and match the account `type` values actually in the account.
2. Confirm `incomeChangePercent`/`expenseChangePercent` are `null` (not `Infinity` or `NaN`) when the prior week has zero transactions.
3. `npm run check` (root) — no new errors beyond the current baseline.
4. Visual check of the new card's layout/spacing against the existing cards in the same screen (no simulator available in this environment — flag as a residual manual check, same as prior features this session).
