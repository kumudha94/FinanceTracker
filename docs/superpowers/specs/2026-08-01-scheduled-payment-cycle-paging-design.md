# Scheduled Payments — cycle-based paging (mobile)

## Problem

TODO.md Section 1, item 4 (`New Priority:High2`): the mobile Scheduled Payments checklist pages by plain calendar month ("July"/"August"), independent of the user's salary cycle. For a salary-cycle user (e.g. salary credited July 29, cycle runs "Jul 29 – Aug 28"), a bill due Aug 1 that's paid within that cycle can feel misfiled, because the checklist screen still buckets it under "August" rather than the cycle the user actually experiences.

Note: the exact symptom "shows paid on Scheduled Payments screen but pending on Dashboard" was already fixed server-side (`findOccurrenceInCycle` in `server/salaryUtils.ts`, used by `/api/dashboard-summary`, TODO Section 5 item 6). This spec addresses the deeper, still-open complaint: the Scheduled Payments screen itself should organize around the salary cycle, not the calendar month.

## Scope

- Mobile app only (`mobile/src/screens/ScheduledPaymentsScreen.tsx`). The web app's Scheduled Payments screen and dashboard have no salary-cycle concept today and are out of scope.
- Scheduled Payments (bills) only. Loan EMIs and credit-card bills have the same class of calendar-month-bucket bug but are explicitly out of scope for this change.
- Occurrence *generation* is unchanged (still keyed to a calendar-month bucket via `generatePaymentOccurrencesForMonth`, with existing dedup/day-interval-rollover/SMS-matching logic untouched). Only the *fetching/paging* for the checklist screen becomes cycle-aware. This keeps the change small and reuses the pattern already proven by `findOccurrenceInCycle` on the Dashboard.

## Design

### Server (`server/routes.ts`, `server/salaryUtils.ts`, `server/storage.ts`)

New endpoint: `GET /api/payment-occurrences/cycle?anchor=<ISO date>` (anchor optional, defaults to now).

1. Load the requesting user's `salaryProfile` and `lastSalaryCycle` (same lookup pattern already used by `/api/dashboard-summary`).
2. `cycle = getCurrentCycleDates(salaryProfile, lastSalaryCycle, anchorDate)` — reuses the existing function unchanged.
3. New helper `getSpannedMonths(cycleStart: Date, cycleEnd: Date): { month: number; year: number }[]` in `server/salaryUtils.ts` — returns the 1–2 distinct calendar `{month, year}` pairs the cycle's date range touches.
4. For each spanned month, call the existing `storage.generatePaymentOccurrencesForMonth(month, year, userId)` (idempotent; no changes to that function).
5. Fetch occurrences for each spanned month via the existing `storage.getPaymentOccurrences({ userId, month, year })` (called once per spanned month, results merged — no changes to that function's signature).
6. Filter the merged list to occurrences whose `dueDate` falls within `[cycle.cycleStart, cycle.cycleEnd]` inclusive (new small helper, e.g. `filterOccurrencesInCycle`, distinct from `findOccurrenceInCycle` — this one returns *all* matches rather than reducing to one, so a day-interval bill occurring twice within a single cycle shows both occurrences).
7. Respond with:
   ```
   {
     occurrences: (PaymentOccurrence & { scheduledPayment })[],
     cycleStart, cycleEnd, cycleLabel,
     cycleStartFormatted, cycleEndFormatted,
     isSalaryCycle: boolean,
     prevAnchor: string,  // ISO, = cycleStart - 1s
     nextAnchor: string,  // ISO, = cycleEnd + 1s
   }
   ```

Non-salary-cycle users: `getCurrentCycleDates` already falls back to calendar-month bounds with `isSalaryCycle: false` when there's no active salary profile. `getSpannedMonths` then returns exactly one `{month, year}` pair, so this endpoint is behaviorally identical to today's month-paging for those users — no separate code path, no regression.

Existing endpoints (`GET /api/payment-occurrences`, `POST /api/payment-occurrences/generate`) are unchanged and keep serving the web client.

### Client (`mobile/src/screens/ScheduledPaymentsScreen.tsx`, `mobile/src/lib/api.ts`)

- New `api.getPaymentOccurrencesCycle(anchorIso?: string)` calling the new endpoint.
- Replace `currentMonth`/`currentYear` state with a single `cycleAnchor: Date` state (default: `new Date()`).
- Replace the occurrences query (`queryKey: ['payment-occurrences', currentMonth, currentYear]`) with `queryKey: ['payment-occurrences-cycle', cycleAnchor.toISOString()]`, calling the new endpoint.
- Remove the `currentMonth`/`currentYear`-driven `useEffect` that auto-triggers `generateOccurrencesMutation`, and remove that mutation — generation now happens inside the new endpoint. The existing manual "Generate" button becomes a plain refetch of the cycle query (kept as an empty-state fallback affordance).
- `goToPreviousMonth`/`goToNextMonth` become `goToPreviousCycle`/`goToNextCycle`: set `cycleAnchor` from the current query result's `prevAnchor`/`nextAnchor` (parsed back to `Date`).
- Header label: replace `${MONTH_NAMES[currentMonth - 1]} ${currentYear}` with the response's `cycleLabel` (already correctly formatted for both cycle and calendar-month cases).
- "This Month (N) active" label becomes conditional on `isSalaryCycle`: `"This Cycle (N) active"` vs `"This Month (N) active"`, preserving today's exact wording for non-salary-profile users.
- The billing-amount-fetch `useEffect`'s dependency array swaps `[occurrences, currentMonth, currentYear]` for `[occurrences, cycleAnchor]`.

## Testing plan

Manual verification (no existing automated test suite covers this screen):
1. Salary profile with `monthCycleStartRule = 'salary_day'`, last actual pay date in late July. Confirm the checklist's header shows a cycle range (e.g. "Jul 29 - Aug 28"), a bill due Aug 1 appears inside it, and marking it paid is reflected consistently between this screen and the Dashboard's Current Cycle Bills tab.
2. Cycle prev/next navigation correctly walks across a month boundary (spanning both Jul and Aug occurrence generation).
3. An account with no active salary profile sees unchanged month-by-month paging and labeling ("This Month (N) active", "August 2026").
4. `npm run check` (tsc) shows no *new* errors beyond the pre-existing baseline (13 errors, unrelated files, confirmed before starting this work).
