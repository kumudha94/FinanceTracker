# Weekly Summary Dashboard Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Monday–Sunday weekly summary card to the mobile Dashboard showing income, expense, spend split by account vs. credit card, and a week-over-week percentage comparison.

**Architecture:** A new isolated week-boundary helper (`server/weekUtils.ts`), a new standalone authenticated endpoint (`GET /api/dashboard/weekly-summary`) that aggregates transactions over the current and previous week using the existing `storage.getAllTransactions({userId, startDate, endDate})` pattern, and a new card section on the live mobile Dashboard screen styled to match its existing secondary cards (Top Spending, Budget Tracking, etc.).

**Tech Stack:** Express + TypeScript (`server/`), `date-fns` (already a dependency), Expo React Native + TanStack Query (`mobile/`).

## Global Constraints

- Mobile only — do not touch `client/src/` (the web app has no equivalent dashboard section for this).
- Week boundary is fixed Monday–Sunday for now, isolated behind one function (`getWeekBounds`) so a future configurable week-start-day setting only requires changing that one function.
- The new endpoint must be `userId`-scoped in `storage.getAllTransactions(...)` from the very first version of the code — do not repeat the missing-`userId` bug fixed earlier in this project's history.
- No new database tables or migrations.
- `npm run check` (root tsc) must not introduce new errors beyond the current baseline. Run `npm run check 2>&1 | grep -c "error TS"` before starting to record the current baseline count, since it may have shifted from earlier in this project's history — do not assume a specific number.
- The live Dashboard screen is `mobile/src/screens/DashboardScreen.tsx` (confirmed via `mobile/App.tsx`'s import at line 13 and route registration). `mobile/src/screens/DashboardScreenV2.tsx` and `mobile/src/screens/DashboardScreen.backup.tsx` are dead files — do not edit them.

---

### Task 1: `server/weekUtils.ts` — week boundary helpers

**Files:**
- Create: `server/weekUtils.ts`

**Interfaces:**
- Produces: `getWeekBounds(referenceDate: Date): { weekStart: Date; weekEnd: Date }` and `getPreviousWeekBounds(referenceDate: Date): { weekStart: Date; weekEnd: Date }`. Task 2 consumes both. All `date-fns` usage for this feature lives in this file — Task 2 must not import `date-fns` directly.

- [ ] **Step 1: Check whether a test runner exists**

Run: `grep -i '"test"' package.json` and `ls vitest.config.* jest.config.* 2>/dev/null`. This repo has had no test runner throughout this project's history — expect no matches. If none exist, skip to Step 3 and verify manually via a throwaway `tsx` script instead of a committed test file.

- [ ] **Step 2 (only if a test runner exists): Write the failing test**

```typescript
// server/weekUtils.test.ts
import { describe, it, expect } from 'vitest'; // or the project's actual runner import
import { getWeekBounds, getPreviousWeekBounds } from './weekUtils';

describe('getWeekBounds', () => {
  it('returns Monday 00:00:00 to Sunday 23:59:59.999 for a mid-week date', () => {
    const { weekStart, weekEnd } = getWeekBounds(new Date(2026, 7, 5)); // Wed Aug 5, 2026
    expect(weekStart.getFullYear()).toBe(2026);
    expect(weekStart.getMonth()).toBe(7);
    expect(weekStart.getDate()).toBe(3); // Monday Aug 3
    expect(weekStart.getHours()).toBe(0);
    expect(weekEnd.getDate()).toBe(9); // Sunday Aug 9
    expect(weekEnd.getHours()).toBe(23);
  });

  it('a Sunday reference date belongs to the week that already started', () => {
    const { weekStart, weekEnd } = getWeekBounds(new Date(2026, 7, 9)); // Sun Aug 9, 2026
    expect(weekStart.getDate()).toBe(3);
    expect(weekEnd.getDate()).toBe(9);
  });
});

describe('getPreviousWeekBounds', () => {
  it('returns the 7-days-earlier week', () => {
    const { weekStart, weekEnd } = getPreviousWeekBounds(new Date(2026, 7, 5)); // Wed Aug 5, 2026
    expect(weekStart.getDate()).toBe(27); // Monday Jul 27
    expect(weekStart.getMonth()).toBe(6);
    expect(weekEnd.getDate()).toBe(2); // Sunday Aug 2
    expect(weekEnd.getMonth()).toBe(7);
  });
});
```

- [ ] **Step 3a (if a test runner exists): Run test to verify it fails**

Expected: FAIL with an import/module-not-found error.

- [ ] **Step 3b (only if no test runner exists): Prepare a throwaway verification script**

Do not run this yet — write it now, run it after Step 4:

```typescript
// /tmp/verify-week-utils.ts (do not commit)
import { getWeekBounds, getPreviousWeekBounds } from '/home/kgd122/personal/FinanceTracker/server/weekUtils';

console.log(getWeekBounds(new Date(2026, 7, 5)));   // expect Mon Aug 3 00:00 - Sun Aug 9 23:59
console.log(getWeekBounds(new Date(2026, 7, 9)));   // expect Mon Aug 3 00:00 - Sun Aug 9 23:59 (Sunday belongs to the week that started)
console.log(getPreviousWeekBounds(new Date(2026, 7, 5))); // expect Mon Jul 27 00:00 - Sun Aug 2 23:59
```

- [ ] **Step 4: Write the implementation**

```typescript
// server/weekUtils.ts
import { startOfWeek, endOfWeek, subDays } from "date-fns";

export interface WeekBounds {
  weekStart: Date;
  weekEnd: Date;
}

/**
 * Monday 00:00:00 - Sunday 23:59:59.999 for the week containing referenceDate.
 * Fixed to Monday-Sunday for now; a future per-user configurable week-start
 * day only needs to change this function, nothing that calls it.
 */
export function getWeekBounds(referenceDate: Date): WeekBounds {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 });
  return { weekStart, weekEnd };
}

/** The Monday-Sunday week immediately before the one containing referenceDate. */
export function getPreviousWeekBounds(referenceDate: Date): WeekBounds {
  return getWeekBounds(subDays(referenceDate, 7));
}
```

- [ ] **Step 5a (if a test runner exists): Run test to verify it passes**

Expected: PASS, all assertions green.

- [ ] **Step 5b (only if no test runner exists): Run the throwaway script and verify manually**

Run: `npx tsx /tmp/verify-week-utils.ts` (from the repo root, `/home/kgd122/personal/FinanceTracker`)
Expected: the three logged objects match the comments in Step 3b exactly (dates, and `weekEnd` at hour 23).

- [ ] **Step 6: Commit**

```bash
git add server/weekUtils.ts server/weekUtils.test.ts
git commit -m "feat: add getWeekBounds/getPreviousWeekBounds helpers for the weekly summary card"
```

(Drop `server/weekUtils.test.ts` from `git add` if no test runner exists and it wasn't created.)

---

### Task 2: `GET /api/dashboard/weekly-summary` endpoint

**Files:**
- Modify: `server/routes.ts` — add the new route immediately after the `/api/dashboard-summary` route's closing `});` (currently ends right before the `/api/next-month-forecast` route begins; search for the line `app.get("/api/next-month-forecast", authenticateToken, async (req, res) => {` and insert the new route directly above it). Add `getWeekBounds, getPreviousWeekBounds` to the existing `salaryUtils` import area — as a **separate** import line, since `weekUtils.ts` is a different module from `salaryUtils.ts` (do not add these into the existing `from "./salaryUtils"` import).

**Interfaces:**
- Consumes: `getWeekBounds`, `getPreviousWeekBounds` from `./weekUtils` (Task 1); `storage.getAllTransactions({userId, startDate, endDate})` (pre-existing, unchanged).
- Produces: `GET /api/dashboard/weekly-summary` → JSON:
  ```typescript
  {
    weekStart: string;   // ISO
    weekEnd: string;     // ISO
    weekLabel: string;   // e.g. "Aug 3 - Aug 9"
    income: number;
    expense: number;
    spentFromAccount: number;
    spentFromCreditCard: number;
    incomeChangePercent: number | null;
    expenseChangePercent: number | null;
  }
  ```
  Task 3 (mobile client) consumes this exact shape.

- [ ] **Step 1: Add the import**

Find this line near the top of `server/routes.ts`:
```typescript
import { getPaydayForMonth, getNextPaydays, getPastPaydays, getCurrentCycleDates, getNextCycleDates, getCyclePrimaryMonth, findOccurrenceInCycle, getSpannedMonths, filterOccurrencesInCycle } from "./salaryUtils";
```
Add immediately after it:
```typescript
import { getWeekBounds, getPreviousWeekBounds } from "./weekUtils";
```

- [ ] **Step 2: Add the route**

Find this exact text in `server/routes.ts`:
```typescript
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });

  app.get("/api/next-month-forecast", authenticateToken, async (req, res) => {
```

Replace it with (this inserts the new route between the two, changing nothing else):
```typescript
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });

  app.get("/api/dashboard/weekly-summary", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const now = new Date();

      const { weekStart, weekEnd } = getWeekBounds(now);
      const { weekStart: lastWeekStart, weekEnd: lastWeekEnd } = getPreviousWeekBounds(now);

      const [thisWeekTxns, lastWeekTxns] = await Promise.all([
        storage.getAllTransactions({ userId, startDate: weekStart, endDate: weekEnd }),
        storage.getAllTransactions({ userId, startDate: lastWeekStart, endDate: lastWeekEnd }),
      ]);

      const income = thisWeekTxns
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      const expense = thisWeekTxns
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      const spentFromCreditCard = thisWeekTxns
        .filter(t => t.type === 'debit' && t.account?.type === 'credit_card')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      const spentFromAccount = expense - spentFromCreditCard;

      const lastWeekIncome = lastWeekTxns
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      const lastWeekExpense = lastWeekTxns
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const incomeChangePercent = lastWeekIncome > 0
        ? ((income - lastWeekIncome) / lastWeekIncome) * 100
        : null;
      const expenseChangePercent = lastWeekExpense > 0
        ? ((expense - lastWeekExpense) / lastWeekExpense) * 100
        : null;

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
        ? `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} - ${weekEnd.getDate()}`
        : `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} - ${monthNames[weekEnd.getMonth()]} ${weekEnd.getDate()}`;

      res.json({
        weekStart,
        weekEnd,
        weekLabel,
        income,
        expense,
        spentFromAccount,
        spentFromCreditCard,
        incomeChangePercent,
        expenseChangePercent,
      });
    } catch (error) {
      console.error("Error fetching weekly summary:", error);
      res.status(500).json({ error: "Failed to fetch weekly summary" });
    }
  });

  app.get("/api/next-month-forecast", authenticateToken, async (req, res) => {
```

Note: `spentFromAccount` is computed as `expense - spentFromCreditCard` rather than a second filter pass, since every debit transaction's account is either `credit_card` or not — this is exactly equivalent to filtering for `t.account?.type !== 'credit_card'` and sums to the same total as `expense`, with one fewer array pass.

- [ ] **Step 3: Manually verify against a running dev server**

Run: `npm run dev` (from the repo root; a working `.env` with `DATABASE_URL` must be present — check for it first with `ls .env`).

In a separate step, mint a test token and call the endpoint (reuse the token-minting approach already established in this project: a short `tsx` script importing `generateAccessToken` from `server/jwtService.ts` and a real user id/email from the `users` table via `server/db.ts` + `shared/schema.ts`'s `users` table). Then:
```bash
curl -s "http://localhost:5000/api/dashboard/weekly-summary" -H "Authorization: Bearer <token>"
```
Expected: a 200 JSON response matching the shape above. Confirm `spentFromAccount + spentFromCreditCard === expense` (within floating-point rounding) using whatever real transaction data exists for that user this week. If the test user has zero transactions this week, that's fine — confirm the response is all zeros/`null` rather than erroring.

Stop the dev server when done (`pkill -f "tsx server/index.ts"` or equivalent), and delete any throwaway verification scripts you created — do not commit them.

- [ ] **Step 4: Run `npm run check` and confirm no new errors**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: same count recorded in this plan's Global Constraints step, unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add GET /api/dashboard/weekly-summary endpoint"
```

---

### Task 3: Mobile API client + types

**Files:**
- Modify: `mobile/src/lib/types.ts` — add a new `WeeklySummary` interface (place it near `DashboardSummary`, e.g. immediately after that interface's closing brace).
- Modify: `mobile/src/lib/api.ts` — add a new `getWeeklySummary` function (place it immediately after the existing `getDashboardSummary` entry).

**Interfaces:**
- Consumes: `GET /api/dashboard/weekly-summary` from Task 2.
- Produces: `WeeklySummary` type; `api.getWeeklySummary(): Promise<WeeklySummary>`. Task 4 consumes both.

- [ ] **Step 1: Add the type**

In `mobile/src/lib/types.ts`, find the end of the `DashboardSummary` interface:
```typescript
  savedThisCycle: number;
  cycleInfo?: CycleInfo;
}
```
Insert immediately after its closing `}`:
```typescript

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  income: number;
  expense: number;
  spentFromAccount: number;
  spentFromCreditCard: number;
  incomeChangePercent: number | null;
  expenseChangePercent: number | null;
}
```

- [ ] **Step 2: Add the API function**

In `mobile/src/lib/api.ts`, find:
```typescript
  getDashboardSummary: () => apiRequest<DashboardSummary>('/api/dashboard-summary'),
```
Insert immediately after it:
```typescript
  getWeeklySummary: () => apiRequest<WeeklySummary>('/api/dashboard/weekly-summary'),
```

Add `WeeklySummary` to the existing `import type { ... } from './types'` statement at the top of `mobile/src/lib/api.ts` (find it with `grep -n "from './types'" mobile/src/lib/api.ts` — it already imports `DashboardSummary` from the same statement, so add `WeeklySummary` as a sibling in that same import list).

- [ ] **Step 3: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -60`
Expected: no errors referencing `api.ts` or `types.ts`. `mobile/node_modules` should already be installed in this checkout from earlier work in this project's history; if it is not, run `cd mobile && npm install` first.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts
git commit -m "feat: add mobile API client for the weekly summary endpoint"
```

---

### Task 4: Dashboard card UI

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx`

**Interfaces:**
- Consumes: `api.getWeeklySummary` and `WeeklySummary` from Task 3.
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Add the import**

Find:
```typescript
import { BillItem, NextMonthForecast, NextMonthForecastItem, ForecastItemType } from '../lib/types';
```
Replace with:
```typescript
import { BillItem, NextMonthForecast, NextMonthForecastItem, ForecastItemType, WeeklySummary } from '../lib/types';
```

- [ ] **Step 2: Add the query**

Find:
```typescript
  const { data: summary, isLoading } = useQuery({
    queryKey: ['/api/dashboard-summary'],
    queryFn: api.getDashboardSummary,
  });
```
Insert immediately after it:
```typescript

  const { data: weeklySummary } = useQuery<WeeklySummary>({
    queryKey: ['/api/dashboard/weekly-summary'],
    queryFn: api.getWeeklySummary,
  });
```

- [ ] **Step 3: Add the card**

Find this exact text (the start of the "Remaining Cards" section, immediately before the "Top Spending Categories" card):
```typescript
        {/* ===== Remaining Cards below main card ===== */}

        {/* Top Spending Categories */}
        {summary.topCategories.length > 0 && (
```

Replace it with (this inserts the new card as the first item in that section, right after the Next Cycle Plan card that precedes this comment, and before Top Spending Categories):
```typescript
        {/* ===== Remaining Cards below main card ===== */}

        {/* Weekly Summary */}
        {weeklySummary && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>This Week</Text>
              <Text style={[styles.viewAll, { color: colors.textMuted }]}>{weeklySummary.weekLabel}</Text>
            </View>

            <View style={[styles.loanRow, { marginBottom: 14 }]}>
              <View style={styles.loanStat}>
                <Text style={[styles.loanStatLabel, { color: colors.textMuted }]}>Income</Text>
                <Text style={[styles.loanStatValue, { color: '#10b981' }]}>{formatCurrency(weeklySummary.income)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.loanStat}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.loanStatLabel, { color: colors.textMuted }]}>Expense</Text>
                  {weeklySummary.expenseChangePercent !== null && (
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: (weeklySummary.expenseChangePercent > 0 ? '#ef4444' : '#10b981') + '18' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          { color: weeklySummary.expenseChangePercent > 0 ? '#ef4444' : '#10b981' },
                        ]}
                      >
                        {weeklySummary.expenseChangePercent > 0 ? '+' : ''}
                        {Math.round(weeklySummary.expenseChangePercent)}%
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.loanStatValue, { color: '#ef4444' }]}>{formatCurrency(weeklySummary.expense)}</Text>
              </View>
            </View>

            <View style={styles.loanRow}>
              <View style={styles.loanStat}>
                <Text style={[styles.loanStatLabel, { color: colors.textMuted }]}>From Account</Text>
                <Text style={[styles.loanStatValue, { color: colors.text }]}>{formatCurrency(weeklySummary.spentFromAccount)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.loanStat}>
                <Text style={[styles.loanStatLabel, { color: colors.textMuted }]}>From Credit Card</Text>
                <Text style={[styles.loanStatValue, { color: colors.text }]}>{formatCurrency(weeklySummary.spentFromCreditCard)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Top Spending Categories */}
        {summary.topCategories.length > 0 && (
```

This reuses `styles.card`/`cardHeader`/`cardTitle`/`viewAll` (the convention already used by every sibling card in this section — Top Spending, Budget Tracking, Credit Card Spending, Loans & EMI, Recent Transactions) and `styles.loanRow`/`loanStat`/`loanStatLabel`/`loanStatValue`/`loanDivider` (the existing two-stat-with-divider layout already used by the Loans & EMI card, reused here twice for four stats) and `styles.statusBadge`/`statusBadgeText` (the existing small-badge style already used elsewhere in this file for status pills). No new style definitions are needed — this task adds zero entries to the `StyleSheet.create({...})` block at the bottom of the file.

- [ ] **Step 4: Run `npx tsc --noEmit` on the mobile package and confirm no new errors**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -60`
Expected: no errors referencing `DashboardScreen.tsx`.

- [ ] **Step 5: Manual smoke test on a device/simulator**

Run: `cd mobile && npx expo start`, open the app, navigate to the Dashboard:
1. "This Week" card appears between the Next Cycle Plan card and the Top Spending Categories card.
2. Income and Expense values are non-negative and match what's expected from the current week's real transactions.
3. The Expense badge shows a sensible percentage (or is absent if last week had zero expenses).
4. "From Account" + "From Credit Card" sum to the Expense value.
5. Card renders correctly in both light and dark theme (this screen already supports theme switching via `colors` from `useTheme()`/`getThemedColors` — no new theme-handling code was added, so this should already work, but confirm visually).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/DashboardScreen.tsx
git commit -m "feat: add This Week summary card to mobile Dashboard"
```

---

### Task 5: Update TODO.md

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Verify the target line still says what this plan expects**

Before editing, run `grep -n "Weeky Summary" TODO.md` and confirm the line still ends with `**New Priority:Medium1 | Development NotStarted**` (Section 5, item 8). If the wording or marker has changed since this plan was written, stop and report what's actually there rather than guessing — TODO.md is user-edited outside of git and has changed mid-session before in this project's history.

- [ ] **Step 2: Mark the item resolved**

Change only the trailing marker on that line from `**New Priority:Medium1 | Development NotStarted**` to `**Development completed | Test Pending**`, matching the convention used elsewhere in the file. Do not change anything else on the line or elsewhere in the file.

- [ ] **Step 3: Commit in isolation**

Check `git status --short` first — if other files show as modified or staged that are not part of this plan's work (this has happened before in this project's history, from unrelated concurrent activity in the same checkout), commit ONLY `TODO.md` explicitly:
```bash
git commit TODO.md -m "docs: mark weekly summary card TODO item as development complete"
```
Do not run a bare `git commit -a` or `git add -A` for this step.
