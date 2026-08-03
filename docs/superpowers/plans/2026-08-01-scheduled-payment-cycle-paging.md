# Scheduled Payment Cycle-Based Paging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile Scheduled Payments checklist screen pages by the user's salary cycle (e.g. "Jul 29 - Aug 28") instead of plain calendar month, so bills paid mid-cycle no longer feel misfiled into the wrong month bucket.

**Architecture:** Add a new server endpoint that computes the salary cycle for a given anchor date, ensures occurrences are generated for every calendar month the cycle spans, and returns only the occurrences whose actual due date falls inside that cycle. The mobile Scheduled Payments screen swaps its month-state paging for cycle-anchor paging against this new endpoint. Occurrence generation, dedup, and the existing `/api/payment-occurrences` + `/api/payment-occurrences/generate` endpoints (used by web) are untouched.

**Tech Stack:** Express + TypeScript (`server/`), Drizzle ORM/Postgres, Expo React Native + TanStack Query (`mobile/`).

## Global Constraints

- Mobile only. Web app (`client/src/pages/scheduled-payments.tsx`) is out of scope and must not be touched.
- Scheduled Payments (bills) only. Loan EMIs and credit-card bills are out of scope.
- Occurrence generation logic (`generatePaymentOccurrencesForMonth` in `server/storage.ts`) is unchanged.
- Non-salary-cycle users (no active salary profile) must see behavior identical to today's month-paging — verify this explicitly, don't just assume the fallback path covers it.
- `npm run check` (tsc) must not introduce new errors beyond the pre-existing baseline of 13 errors in unrelated files (`client/src/pages/dashboard.tsx`, `server/routes.ts:1467`, `server/storage.ts:305,465,471,1397,1406,1718,1724`).

---

### Task 1: `getSpannedMonths` helper in `server/salaryUtils.ts`

**Files:**
- Modify: `server/salaryUtils.ts` (add after `getCyclePrimaryMonth`, i.e. after line 353)
- Test: `server/salaryUtils.test.ts` (new file — no existing test file for this module; check if a test runner is configured first)

**Interfaces:**
- Produces: `getSpannedMonths(cycleStart: Date, cycleEnd: Date): { month: number; year: number }[]` — returns 1 or 2 distinct `{month, year}` pairs (1-based month) that `cycleStart` and `cycleEnd` fall in, in chronological order, no duplicates.

- [ ] **Step 1: Check whether a test runner is already configured**

Run: `cat package.json | grep -i '"test"'` and `ls *.config.* vitest.config.* jest.config.* 2>/dev/null`

If no test script/runner exists, skip Steps 2 and 4 (write the function directly and verify it manually via a throwaway `tsx` script instead — see Step 3b). If a runner exists, follow Steps 2-5 as written.

- [ ] **Step 2 (if a test runner exists): Write the failing test**

```typescript
// server/salaryUtils.test.ts
import { describe, it, expect } from 'vitest'; // or the project's actual runner import
import { getSpannedMonths } from './salaryUtils';

describe('getSpannedMonths', () => {
  it('returns a single month when the cycle stays within one calendar month', () => {
    const start = new Date(2026, 7, 5); // Aug 5, 2026
    const end = new Date(2026, 7, 25);  // Aug 25, 2026
    expect(getSpannedMonths(start, end)).toEqual([{ month: 8, year: 2026 }]);
  });

  it('returns two months in order when the cycle crosses a month boundary', () => {
    const start = new Date(2026, 6, 29); // Jul 29, 2026
    const end = new Date(2026, 7, 28);   // Aug 28, 2026
    expect(getSpannedMonths(start, end)).toEqual([
      { month: 7, year: 2026 },
      { month: 8, year: 2026 },
    ]);
  });

  it('returns two months in order when the cycle crosses a year boundary', () => {
    const start = new Date(2026, 11, 29); // Dec 29, 2026
    const end = new Date(2027, 0, 28);    // Jan 28, 2027
    expect(getSpannedMonths(start, end)).toEqual([
      { month: 12, year: 2026 },
      { month: 1, year: 2027 },
    ]);
  });
});
```

- [ ] **Step 3a (if a test runner exists): Run test to verify it fails**

Run the project's test command (from Step 1) targeting `server/salaryUtils.test.ts`.
Expected: FAIL with "getSpannedMonths is not a function" or similar import error.

- [ ] **Step 3b (only if no test runner exists): Write a throwaway verification script**

```typescript
// /tmp/verify-spanned-months.ts (do not commit)
import { getSpannedMonths } from '/home/kgd122/personal/FinanceTracker/.worktrees/scheduled-payment-cycle-paging/server/salaryUtils';

console.log(getSpannedMonths(new Date(2026, 7, 5), new Date(2026, 7, 25)));
console.log(getSpannedMonths(new Date(2026, 6, 29), new Date(2026, 7, 28)));
console.log(getSpannedMonths(new Date(2026, 11, 29), new Date(2027, 0, 28)));
```

Run: `npx tsx /tmp/verify-spanned-months.ts` after writing the implementation in Step 4, and confirm the three lines print `[{month:8,year:2026}]`, `[{month:7,year:2026},{month:8,year:2026}]`, `[{month:12,year:2026},{month:1,year:2027}]` respectively.

- [ ] **Step 4: Write the implementation**

Add to `server/salaryUtils.ts` immediately after the `getCyclePrimaryMonth` function (after line 353):

```typescript
/**
 * Return the distinct calendar {month, year} pairs a cycle's date range touches,
 * in chronological order. A cycle normally spans one or two calendar months.
 */
export function getSpannedMonths(cycleStart: Date, cycleEnd: Date): { month: number; year: number }[] {
  const start = { month: cycleStart.getMonth() + 1, year: cycleStart.getFullYear() };
  const end = { month: cycleEnd.getMonth() + 1, year: cycleEnd.getFullYear() };
  if (start.month === end.month && start.year === end.year) {
    return [start];
  }
  return [start, end];
}
```

- [ ] **Step 5 (if a test runner exists): Run test to verify it passes**

Run the project's test command targeting `server/salaryUtils.test.ts`.
Expected: PASS, all 3 assertions green.

- [ ] **Step 6: Commit**

```bash
git add server/salaryUtils.ts server/salaryUtils.test.ts
git commit -m "feat: add getSpannedMonths helper for cycle-to-calendar-month mapping"
```

(Drop `server/salaryUtils.test.ts` from the `git add` if no test runner exists and it wasn't created.)

---

### Task 2: `filterOccurrencesInCycle` helper in `server/salaryUtils.ts`

**Files:**
- Modify: `server/salaryUtils.ts` (add after `findOccurrenceInCycle`, i.e. after line 373)
- Test: `server/salaryUtils.test.ts` (append to the file from Task 1, if it exists)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `filterOccurrencesInCycle<T extends { dueDate: Date }>(occurrences: T[], cycleStart: Date, cycleEnd: Date): T[]` — returns every occurrence whose `dueDate` falls within `[cycleStart, cycleEnd]` inclusive, preserving input order. Unlike `findOccurrenceInCycle` (which reduces to a single "most recent" match per caller's need on the Dashboard), this returns *all* matches, because a day-interval bill can have more than one occurrence due inside a single cycle.

- [ ] **Step 1: Write the failing test** (skip to Step 2 if no test runner, per Task 1's Step 1 finding)

```typescript
// append to server/salaryUtils.test.ts
import { filterOccurrencesInCycle } from './salaryUtils';

describe('filterOccurrencesInCycle', () => {
  const cycleStart = new Date(2026, 6, 29); // Jul 29
  const cycleEnd = new Date(2026, 7, 28, 23, 59, 59); // Aug 28

  it('includes occurrences with dueDate inside the cycle, inclusive of boundaries', () => {
    const occurrences = [
      { id: 1, dueDate: new Date(2026, 6, 29) },   // exactly cycleStart
      { id: 2, dueDate: new Date(2026, 7, 1) },    // inside
      { id: 3, dueDate: new Date(2026, 7, 28, 23, 59, 59) }, // exactly cycleEnd
    ];
    expect(filterOccurrencesInCycle(occurrences, cycleStart, cycleEnd).map(o => o.id)).toEqual([1, 2, 3]);
  });

  it('excludes occurrences outside the cycle', () => {
    const occurrences = [
      { id: 1, dueDate: new Date(2026, 6, 28) },  // before cycleStart
      { id: 2, dueDate: new Date(2026, 7, 29) },  // after cycleEnd
    ];
    expect(filterOccurrencesInCycle(occurrences, cycleStart, cycleEnd)).toEqual([]);
  });

  it('returns multiple matches for the same scheduled payment when both fall in range', () => {
    const occurrences = [
      { id: 1, scheduledPaymentId: 5, dueDate: new Date(2026, 7, 2) },
      { id: 2, scheduledPaymentId: 5, dueDate: new Date(2026, 7, 9) },
    ];
    expect(filterOccurrencesInCycle(occurrences, cycleStart, cycleEnd).map(o => o.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL with "filterOccurrencesInCycle is not a function" (or skip, per Task 1 Step 1).

- [ ] **Step 3: Write the implementation**

Add to `server/salaryUtils.ts` immediately after `findOccurrenceInCycle` (after line 373):

```typescript
/**
 * Return every occurrence whose dueDate falls within [cycleStart, cycleEnd], inclusive.
 * Unlike findOccurrenceInCycle (which picks one "latest" match per scheduled payment for
 * the Dashboard's isPaid lookup), this keeps all matches — a day-interval payment can have
 * more than one occurrence due inside a single ~30-day cycle, and a checklist screen should
 * list every one of them.
 */
export function filterOccurrencesInCycle<T extends { dueDate: Date }>(
  occurrences: T[],
  cycleStart: Date,
  cycleEnd: Date
): T[] {
  return occurrences.filter(o => o.dueDate >= cycleStart && o.dueDate <= cycleEnd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, all assertions green (or, if no test runner: manually verify via a throwaway `tsx` script the same way as Task 1 Step 3b).

- [ ] **Step 5: Commit**

```bash
git add server/salaryUtils.ts server/salaryUtils.test.ts
git commit -m "feat: add filterOccurrencesInCycle helper for cycle-scoped occurrence lists"
```

---

### Task 3: `GET /api/payment-occurrences/cycle` endpoint

**Files:**
- Modify: `server/routes.ts` (add new route immediately after the existing `GET /api/payment-occurrences` handler, i.e. after line 1212; add `getSpannedMonths` and `filterOccurrencesInCycle` to the existing salaryUtils import at line 30)

**Interfaces:**
- Consumes: `getCurrentCycleDates`, `getSpannedMonths` (Task 1), `filterOccurrencesInCycle` (Task 2) from `./salaryUtils`; `storage.getSalaryProfile(userId)`, `storage.getSalaryCycles(salaryProfileId, 1)`, `storage.generatePaymentOccurrencesForMonth(month, year, userId)`, `storage.getPaymentOccurrences({userId, month, year})` (all pre-existing, unchanged).
- Produces: `GET /api/payment-occurrences/cycle?anchor=<ISO date, optional>` → JSON:
  ```typescript
  {
    occurrences: (PaymentOccurrence & { scheduledPayment?: ScheduledPayment })[],
    cycleStart: string,   // ISO
    cycleEnd: string,     // ISO
    cycleLabel: string,
    cycleStartFormatted: string,
    cycleEndFormatted: string,
    isSalaryCycle: boolean,
    prevAnchor: string,   // ISO, pass as `anchor` to page to the previous cycle
    nextAnchor: string,   // ISO, pass as `anchor` to page to the next cycle
  }
  ```
  Task 4 (mobile client) consumes this exact shape.

- [ ] **Step 1: Add the new route**

In `server/routes.ts`, change line 30's import to add the two new helpers:

```typescript
import { getPaydayForMonth, getNextPaydays, getPastPaydays, getCurrentCycleDates, getNextCycleDates, getCyclePrimaryMonth, findOccurrenceInCycle, getSpannedMonths, filterOccurrencesInCycle } from "./salaryUtils";
```

Then insert this new route immediately after the closing `});` of the existing `GET /api/payment-occurrences` handler (after line 1212, before the `// ========== Credit Card Bills ==========` comment):

```typescript
  app.get("/api/payment-occurrences/cycle", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { anchor } = req.query;
      const anchorDate = anchor ? new Date(anchor as string) : new Date();

      const salaryProfile = await storage.getSalaryProfile(userId);
      let lastSalaryCycle = null;
      if (salaryProfile) {
        const recentCycles = await storage.getSalaryCycles(salaryProfile.id, 1);
        if (recentCycles.length > 0) {
          lastSalaryCycle = recentCycles[0];
        }
      }

      const cycle = getCurrentCycleDates(salaryProfile, lastSalaryCycle, anchorDate);
      const spannedMonths = getSpannedMonths(cycle.cycleStart, cycle.cycleEnd);

      for (const { month, year } of spannedMonths) {
        await storage.generatePaymentOccurrencesForMonth(month, year, userId);
      }

      const occurrenceLists = await Promise.all(
        spannedMonths.map(({ month, year }) =>
          storage.getPaymentOccurrences({ userId, month, year })
        )
      );
      const allOccurrences = occurrenceLists.flat();
      const inCycle = filterOccurrencesInCycle(allOccurrences, cycle.cycleStart, cycle.cycleEnd);

      const prevAnchor = new Date(cycle.cycleStart.getTime() - 1000);
      const nextAnchor = new Date(cycle.cycleEnd.getTime() + 1000);

      res.json({
        occurrences: inCycle,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        cycleLabel: cycle.cycleLabel,
        cycleStartFormatted: cycle.cycleStartFormatted,
        cycleEndFormatted: cycle.cycleEndFormatted,
        isSalaryCycle: cycle.isSalaryCycle,
        prevAnchor: prevAnchor.toISOString(),
        nextAnchor: nextAnchor.toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch payment occurrences for cycle" });
    }
  });
```

- [ ] **Step 2: Manually verify against a running dev server**

Run: `npm run dev` (from the worktree root, requires `DATABASE_URL` env — check `.env` exists; if not, ask the user for the Neon connection string or copy `.env` from the main checkout).

In a separate terminal, log in as the test user (userId 7 per project memory) and call:
```bash
curl -s "http://localhost:5000/api/payment-occurrences/cycle" -H "Authorization: Bearer <token>" | head -c 2000
```
Expected: a 200 JSON response with the shape above; `cycleLabel` reflects either a salary-cycle range or a plain month name depending on whether userId 7 has an active salary profile.

- [ ] **Step 3: Run `npm run check` and confirm no new errors**

Run: `npm run check`
Expected: same 13 pre-existing errors as the documented baseline (see Global Constraints), none of them in `server/routes.ts` near the new route or in `server/salaryUtils.ts`.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add GET /api/payment-occurrences/cycle endpoint"
```

---

### Task 4: Mobile API client function

**Files:**
- Modify: `mobile/src/lib/types.ts` (add new response type near `CycleInfo`, after line 192)
- Modify: `mobile/src/lib/api.ts` (add new function near `getPaymentOccurrences`, after line 350)

**Interfaces:**
- Consumes: `GET /api/payment-occurrences/cycle` from Task 3.
- Produces: `PaymentOccurrencesCycleResponse` type; `api.getPaymentOccurrencesCycle(anchorIso?: string): Promise<PaymentOccurrencesCycleResponse>`. Task 5 consumes both.

- [ ] **Step 1: Add the response type**

In `mobile/src/lib/types.ts`, insert after the `CycleInfo` interface (after line 192):

```typescript
export interface PaymentOccurrencesCycleResponse {
  occurrences: PaymentOccurrence[];
  cycleStart: string;
  cycleEnd: string;
  cycleLabel: string;
  cycleStartFormatted: string;
  cycleEndFormatted: string;
  isSalaryCycle: boolean;
  prevAnchor: string;
  nextAnchor: string;
}
```

(`PaymentOccurrence` is already defined later in this file at line 308 — forward references are fine in TypeScript interfaces within the same module.)

- [ ] **Step 2: Add the API function**

In `mobile/src/lib/api.ts`, insert immediately after the existing `getPaymentOccurrences` entry (after line 350, before `generatePaymentOccurrences`):

```typescript
  getPaymentOccurrencesCycle: (anchorIso?: string) =>
    apiRequest<PaymentOccurrencesCycleResponse>(
      `/api/payment-occurrences/cycle${anchorIso ? `?anchor=${encodeURIComponent(anchorIso)}` : ''}`
    ),
```

Add `PaymentOccurrencesCycleResponse` to the existing `import type { ... } from './types'` statement at the top of `mobile/src/lib/api.ts` (find it with `grep -n "from './types'" mobile/src/lib/api.ts`).

- [ ] **Step 3: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit` (if this is slow or the mobile package has its own pre-existing baseline errors, just confirm no *new* errors reference `api.ts` or `types.ts`).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts
git commit -m "feat: add mobile API client for cycle-based payment occurrences"
```

---

### Task 5: `ScheduledPaymentsScreen.tsx` — cycle-based paging

**Files:**
- Modify: `mobile/src/screens/ScheduledPaymentsScreen.tsx`

**Interfaces:**
- Consumes: `api.getPaymentOccurrencesCycle` and `PaymentOccurrencesCycleResponse` from Task 4.
- Produces: nothing consumed by later tasks (this is the last task).

This task has several small, sequential edits to the same file. Each edit is its own step; run a manual smoke test after all edits are in, then commit once.

- [ ] **Step 1: Replace month state with cycle anchor state**

Replace lines 58-59:
```typescript
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
```
with:
```typescript
  const [cycleAnchor, setCycleAnchor] = useState(new Date());
```

- [ ] **Step 2: Replace the occurrences query**

Replace lines 101-104:
```typescript
  const { data: occurrences = EMPTY_OCCURRENCES, refetch: refetchOccurrences } = useQuery<PaymentOccurrence[]>({
    queryKey: ['payment-occurrences', currentMonth, currentYear],
    queryFn: () => api.getPaymentOccurrences(currentMonth, currentYear),
  });
```
with:
```typescript
  const { data: cycleData, refetch: refetchOccurrences } = useQuery<PaymentOccurrencesCycleResponse>({
    queryKey: ['payment-occurrences-cycle', cycleAnchor.toISOString()],
    queryFn: () => api.getPaymentOccurrencesCycle(cycleAnchor.toISOString()),
  });
  const occurrences = cycleData?.occurrences ?? EMPTY_OCCURRENCES;
```

Add `PaymentOccurrencesCycleResponse` to the existing `import type { ScheduledPayment, PaymentOccurrence, Category, Account } from '../lib/types';` at line 13.

- [ ] **Step 3: Update the billing-amounts effect dependency array**

Replace line 162:
```typescript
  }, [occurrences, currentMonth, currentYear]);
```
with:
```typescript
  }, [occurrences, cycleAnchor]);
```

- [ ] **Step 4: Remove the auto-generate effect and mutation**

Delete the `generateOccurrencesMutation` definition (lines 164-169):
```typescript
  const generateOccurrencesMutation = useMutation({
    mutationFn: () => api.generatePaymentOccurrences(currentMonth, currentYear),
    onSuccess: () => {
      refetchOccurrences();
    },
  });
```

Delete the effect that auto-triggers it (lines 361-365):
```typescript
  useEffect(() => {
    if (payments && payments.length > 0) {
      generateOccurrencesMutation.mutate();
    }
  }, [payments?.length, currentMonth, currentYear]);
```

(Generation now happens server-side inside `/api/payment-occurrences/cycle`, triggered automatically by the occurrences query itself — no client-side trigger needed.)

- [ ] **Step 5: Replace the "Generate Checklist" button**

Replace line 711-716's `onPress`:
```typescript
                <TouchableOpacity
                  style={[styles.generateButton, { borderColor: colors.border }]}
                  onPress={() => generateOccurrencesMutation.mutate()}
                >
                  <Text style={[styles.generateButtonText, { color: colors.text }]}>Generate Checklist</Text>
                </TouchableOpacity>
```
with:
```typescript
                <TouchableOpacity
                  style={[styles.generateButton, { borderColor: colors.border }]}
                  onPress={() => refetchOccurrences()}
                >
                  <Text style={[styles.generateButtonText, { color: colors.text }]}>Refresh</Text>
                </TouchableOpacity>
```

- [ ] **Step 6: Replace cycle navigation functions**

Replace lines 548-564:
```typescript
  const goToPreviousMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };
```
with:
```typescript
  const goToPreviousCycle = () => {
    if (cycleData?.prevAnchor) {
      setCycleAnchor(new Date(cycleData.prevAnchor));
    }
  };

  const goToNextCycle = () => {
    if (cycleData?.nextAnchor) {
      setCycleAnchor(new Date(cycleData.nextAnchor));
    }
  };
```

- [ ] **Step 7: Update the header label and nav buttons**

Replace lines 676-686:
```typescript
            <View style={styles.monthNav}>
              <TouchableOpacity onPress={goToPreviousMonth} style={styles.monthNavButton}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.monthText, { color: colors.text }]}>
                {MONTH_NAMES[currentMonth - 1]} {currentYear}
              </Text>
              <TouchableOpacity onPress={goToNextMonth} style={styles.monthNavButton}>
                <Ionicons name="chevron-forward" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
```
with:
```typescript
            <View style={styles.monthNav}>
              <TouchableOpacity onPress={goToPreviousCycle} style={styles.monthNavButton}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.monthText, { color: colors.text }]}>
                {cycleData?.cycleLabel ?? ''}
              </Text>
              <TouchableOpacity onPress={goToNextCycle} style={styles.monthNavButton}>
                <Ionicons name="chevron-forward" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
```

`MONTH_NAMES` (line 19) is now unused by this file — remove that constant declaration only if a repo-wide grep confirms nothing else imports it from this file (it's a local `const`, not exported, so this is safe): `grep -n "MONTH_NAMES" mobile/src/screens/ScheduledPaymentsScreen.tsx` should show only the declaration and its two now-deleted usages; delete line 19.

- [ ] **Step 8: Update the tab label**

Replace line 658-660:
```typescript
          <Text style={[styles.tabText, { color: activeTab === 'checklist' ? colors.primary : colors.textMuted }]}>
            This Month ({activePayments.length}) active
          </Text>
```
with:
```typescript
          <Text style={[styles.tabText, { color: activeTab === 'checklist' ? colors.primary : colors.textMuted }]}>
            {cycleData?.isSalaryCycle ? 'This Cycle' : 'This Month'} ({activePayments.length}) active
          </Text>
```

- [ ] **Step 9: Update the empty-state copy**

Replace line 710:
```typescript
                <Text style={[styles.emptyText, { color: colors.text }]}>No payments due this month</Text>
```
with:
```typescript
                <Text style={[styles.emptyText, { color: colors.text }]}>
                  No payments due {cycleData?.isSalaryCycle ? 'this cycle' : 'this month'}
                </Text>
```

- [ ] **Step 10: Run `npx tsc --noEmit` on the mobile package and confirm no new errors**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -60`
Expected: no errors referencing `ScheduledPaymentsScreen.tsx` (compare against mobile's own pre-existing baseline if one exists — run this same command on the `main` branch checkout first if unsure what's pre-existing).

- [ ] **Step 11: Manual smoke test on a device/simulator**

Run: `cd mobile && npx expo start`, open the app, navigate to Scheduled Payments:
1. Checklist tab loads without error, header shows a cycle range (or plain month, depending on the test account's salary profile).
2. Chevron buttons page forward/backward across at least one month boundary without error.
3. Mark a bill paid; confirm it stays marked paid after navigating away and back to the tab.
4. "This Cycle"/"This Month" wording and empty-state copy match the account's `isSalaryCycle` status.

- [ ] **Step 12: Commit**

```bash
git add mobile/src/screens/ScheduledPaymentsScreen.tsx
git commit -m "feat: page Scheduled Payments checklist by salary cycle instead of calendar month"
```

---

### Task 6: Update TODO.md

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Mark the item resolved**

In `TODO.md`, change Section 1, item 4 (currently ending `**New Priority:High2**`) to end with `**Development completed | Test Pending**` (matching the convention used elsewhere in the file — leave "Deployed in prod" off until the user confirms after testing on their device).

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: mark scheduled payment cycle-paging TODO item as development complete"
```
