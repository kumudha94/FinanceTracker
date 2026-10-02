# Spending Allowance Widget — Design

**Date:** 2026-10-02
**Status:** Approved (brainstorming), pending spec review

## Goal

Tell the user how much they can safely spend **today, this week, and until next payday**,
given their salary and everything already committed for the cycle (scheduled payments, loan
EMIs, insurance, credit card bills, optionally savings goals). Shown as a home-screen widget
and a matching in-app screen. Money not spent is savings, so being under the limit is the
goal. Being over is shown plainly, never hidden.

## Decisions (from brainstorming)

- **Daily limit is recalculated every day** (not a fixed allowance): what's left ÷ days left.
  Overspending lowers every later day a little; underspending raises them.
- **Period = the salary cycle** (payday to the day before next payday), the same as the Dashboard.
- **Income = salary only**: the cycle's actual credited amount once marked credited,
  otherwise the Salary profile's `monthlyAmount`. Other bank credits (PF advance, refunds,
  family transfers) never raise the limit. **One exception:** credits into a `wallet`
  account (the ICICI Meal Card, an employer-funded meal allowance) count as income, because
  that account's spending counts.
- **Committed items are held back at cycle start, paid or not**, and their payments are not
  counted again as spending.
- **Credit card bills are held back as committed items.** Card *purchases* are out of scope
  (the Credit cards widget covers them). Only bank-side spending counts.
- **Counted accounts:** `bank`, `debit_card`, `wallet`. Never `credit_card`.
- **Savings goals:** one setting, "Hold back savings goals", on by default.
- **Non-everyday debits are kept out three ways:** categories that never count, a
  per-transaction "Not daily spending" switch, and automatic detection of transfers between
  the user's own accounts.

## 1. Shared cycle commitments (refactor, `server/cycleCommitments.ts`)

`GET /api/next-month-forecast` (routes.ts ~3311) builds, inline, the list of committed items
for the *next* cycle: scheduled payments due (with frequency rules), active loan installments,
insurance premiums (skipping auto-funded policies), credit card bills (manual
`credit_card_bill` scheduled payments plus auto-detected `cc-auto-<accountId>` bills), savings
goals, planned income, and per-cycle `forecast_exclusions`.

Extract that into one function used by both endpoints:

```ts
buildCycleCommitments(userId, { cycleStart, cycleEnd }): Promise<{
  scheduledPayments: CommitmentItem[];
  loans: CommitmentItem[];
  insurance: CommitmentItem[];
  creditCardBills: CommitmentItem[];
  savingsGoals: CommitmentItem[];
  plannedIncome: CommitmentItem[];
}>
// CommitmentItem = { itemType, id, name, amount, dueDate, subLabel, excluded }
```

It takes a `mode`. In `'next'` mode it behaves exactly like today's forecast code. In
`'current'` mode, used by the allowance, two things differ because the cycle is already
under way:

- **Insurance premiums already paid still count** (the forecast drops paid ones). Their
  payment is excluded from spending instead (§3 rule 2), so dropping them would make the
  money vanish from the calculation.
- **Card bills use the card's last *closed* billing cycle**, relative to the salary cycle's
  start. That's the bill falling due in this salary cycle. For example, the YES Bank card
  bills on the 12th, so for the cycle starting 29 Sep it uses 12 Aug–11 Sep, due 1 Oct. The
  forecast's `'next'` mode keeps using the card's open cycle (what will be due next cycle).

`next-month-forecast` calls it with the next cycle's dates and keeps its response shape
exactly, so the Forecast screen is unchanged. **Verification:** capture the endpoint's JSON for
the live user before the refactor and compare it after. It must be identical.

Exclusions are keyed by `cycleStart`, so an item excluded for the current cycle on the
Forecast screen is also excluded from the allowance. One place to manage it.

## 2. Allowance calculation (pure, `server/spendingAllowance.ts`)

A pure function, no DB access, unit-tested on its own:

```ts
computeSpendingAllowance(input: {
  now: Date;                       // evaluated in IST (Asia/Kolkata)
  cycleStart: Date; cycleEnd: Date;
  salaryIncome: number;            // actual if credited, else profile monthlyAmount
  walletIncome: number;            // credits into wallet accounts this cycle
  commitments: CommitmentItem[];   // already filtered: not excluded; savings dropped if setting off
  debits: AllowanceDebit[];        // counted-account debits this cycle, see §3
}): SpendingAllowance
```

- `heldBack` = sum of commitment amounts.
- `spentBeforeToday`, `spentToday` = sums of counted debits (IST day boundary).
- `daysLeft` = days from today to `cycleEnd`, **including today**, minimum 1.
- `dailyLimit` = (salaryIncome + walletIncome − heldBack − spentBeforeToday) ÷ daysLeft.
- `todayLeft` = dailyLimit − spentToday (negative = over today).
- `weekLeft` = dailyLimit × min(7, daysLeft) − spentToday.
- `cycleLeft` = salaryIncome + walletIncome − heldBack − spentBeforeToday − spentToday.
- All money values are rounded to 2 decimals at the end only.
- A negative `dailyLimit` is returned as is (already over for the cycle). The UI shows it red.

## 3. Which debits count (`server/spendingAllowance.ts`, pure helper)

`selectCountedDebits(transactions, context)` returns each cycle debit as counted or excluded,
**with a reason**, so the in-app screen can show its working. A debit from a counted account is
excluded when any of these hold (first match wins, in this order):

1. `excludedFromAllowance = true` → reason "Marked not daily spending".
2. Linked to a held-back item: `paymentOccurrenceId`, `savingsContributionId`, a
   `loan_installments.transactionId`, or an `insurance_premiums.transactionId` → "Planned payment".
3. Its category is in the never-count list → "Category: `<name>`".
4. **Own-account transfer:** a `credit` of the same amount into a *different* account of the
   same user within ±24 hours. Each credit pairs with at most one debit. The reason is
   "Card bill (held back)" when that credit lands on a `credit_card` account, otherwise
   "Transfer between your accounts".
5. **Credit card bill payment with no card-side credit:** a debit whose amount equals (within
   ₹1) a held-back credit card bill item of this cycle → "Card bill (held back)". Each bill
   item pairs with at most one debit. This catches the real 29 Sep case: YES Bank
   −₹8,790.35 paid the YES Bank card bill, but no credit was recorded on the card account.
   Rules 4 and 5 together keep a held-back card bill from also being counted as spending.

Only `type = 'debit'` transactions are considered. `transfer`-type rows never count.

## 4. Endpoint

`GET /api/spending-allowance` (authenticated). Loads the salary profile, current cycle
(`getCurrentCycleDates`, same as dashboard-summary), cycle commitments (§1), cycle
transactions, and settings. It then runs §3 and §2 and returns:

```json
{
  "configured": true,
  "cycle": { "start": "...", "end": "...", "daysLeft": 18 },
  "today": { "limit": 1500, "spent": 260, "left": 1240 },
  "week": { "left": 9800 },
  "cycleLeft": 42000,
  "income": { "salary": 182052, "salaryIsActual": true, "wallet": 8800 },
  "heldBack": { "total": 98000, "items": [ /* CommitmentItem, grouped by itemType */ ] },
  "spent": { "total": 7300, "counted": [ /* id, date, merchant, amount, account */ ] },
  "excluded": [ /* id, date, merchant, amount, reason */ ],
  "settings": { "holdBackSavings": true, "neverCountCategoryIds": [12, 15] }
}
```

When there is no active salary profile it returns `{ "configured": false }`. The widget and
screen then show "Set up salary to see your daily limit".

`PATCH /api/spending-allowance/settings` takes `{ holdBackSavings?, neverCountCategoryIds? }`
and validates with zod (category ids must exist).

## 5. Data model (`shared/schema.ts`)

- `transactions.excludedFromAllowance`: boolean, not null, default `false`. Accepted by the
  existing transaction PATCH and insert schemas.
- `salaryProfiles.allowanceHoldBackSavings`: boolean, not null, default `true`.
- `salaryProfiles.allowanceExcludedCategoryIds`: `integer[]`, **nullable**. `null` means
  "never set" (an empty array means the user cleared the list). On first read while it's
  null, the endpoint seeds it with the ids of the categories named **Repayment, EMI,
  Investment, Transfer** (those that exist). It stores them, so the user sees and can change
  the starting list.

**Deploy ordering:** `npm run db:push` must run before (or atomically with) the server
deploy. The transactions query selects the new column unconditionally (same lesson as
`sms_logs.source` and `spending_tracker_enabled`).

## 6. Meal Card top-up SMS (`server/smsParser.ts`)

The real top-up SMS is never turned into a transaction today:

> Dear Customer, your ICICI Bank Prepaid Card XX1286 is now active and loaded with Rs 8,800.00.
> The Available Balance is Rs 9,170.52 .

"loaded" is not in `CREDIT_KEYWORDS`. Add `"loaded"` (word-boundary matching, as for every
keyword since `ba3ad10`) and a parser test using this exact message. Expected: credit, 8800,
last digits 1286, available balance 9170.52. Account matching then picks the ICICI Meal Card,
which is the only ICICI account under the owner since the fix in `smsProcessingUtils.ts`.
Also add `loaded` to the phone-side `looksFinancial` regex (`smsAutoReader.ts`), or the SMS
never reaches the server.

## 7. Widget (`mobile/plugins/native/widgets/`)

New `SpendingAllowanceWidget` (Glance, 4×2 medium), registered in `withWidgets.js` like the
existing four, with its own receiver, info xml and picker description string.

```text
┌──────────────────────────────────────┐
│ Safe to spend today          ↻ 9:41  │
│ ₹1,240  left of ₹1,500               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  ₹260 spent      │
│                                      │
│ This week  ₹9,800   Cycle  ₹42,000   │
│ 18 days to payday                    │
└──────────────────────────────────────┘
```

- Over today: big number red, "₹800 over today", bar fully red. A negative daily limit shows
  "Over budget for this cycle by ₹X".
- Reuses `WidgetUi.kt` styles (light and dark), `WidgetRepository.authenticatedGet`, and the
  "Loading…", signed-out and error states of the other widgets.
- `WidgetRepository.fetchSpendingAllowance()` → `/api/spending-allowance`.
- `WidgetUpdateWorker` updates it alongside the others (30-minute periodic schedule).
- Tap opens `com.mytracker.finance://spending-allowance` (new linking path).

**Refresh after an SMS transaction:** add `refreshWidgets()` to the widget-bridge module
(calls `runImmediateWidgetUpdate`). `smsAutoReader.ts` calls it, best-effort with errors
swallowed, after a result with a new transaction. All widgets then show the new debit within
seconds.

## 8. In-app screen (`mobile/src/screens/SpendingAllowanceScreen.tsx`)

Root-stack screen, linked from the widget, from a Dashboard card (today's figure, tap to open),
and from the More menu.

- **Top:** today left / limit, week left, cycle left, days to payday. Same colours as the widget.
- **How it's worked out:** salary (actual or expected label) + Meal Card top-ups,
  − held back (expandable list grouped by type), − spent so far = left.
- **Spent:** counted debits, newest first. Tap → edit transaction.
- **Not counted:** excluded debits with their reason. Tap → edit transaction (to change the
  switch or category).
- **Settings:** "Hold back savings goals" switch, and a "Categories that never count"
  multi-select.

## 9. Transaction edit switch (`AddTransactionScreen.tsx`)

"Not daily spending" switch, shown only in edit mode for `debit` transactions on a counted
account type. Like the existing "Track spending" switch, it saves immediately with its own
PATCH (`{ excludedFromAllowance }`), no Save tap needed. Invalidates `['/api/transactions']`
and `['/api/spending-allowance']`.

## 10. Testing

- `server/__tests__/spendingAllowance.test.ts`: §2 maths (recalculation, today and week, IST
  day boundary at 00:00–05:30 UTC, daysLeft minimum 1, negative results) and §3 exclusion
  rules. Each rule, rule order, one-credit-one-debit pairing, ±24 h window, and the real
  29 Sep chain: HDFC −8,790.35 → YES +8,790.35 (rule 4, transfer), YES −8,790.35 → held-back
  YES Bank card bill of 8,790.35 (rule 5).
- `smsParser.test.ts`: the Meal Card top-up SMS (§6).
- Forecast refactor: before/after JSON comparison against the live user (§1).
- Live check against the user's real data. Run the endpoint and walk through every
  counted/excluded row with the user before shipping the widget.
- On-emulator: the widget in light and dark, the over-limit state, tap-through, and refresh
  after a posted test SMS.

## Out of scope

- Credit card purchase tracking (the Credit cards widget covers it).
- Fixing the missing YES Bank credit for the 29 Sep ₹27,000 HDFC → YES transfer. The user
  logged it as a separate follow-up.
- Notifications or alerts when going over the limit.
- Any income other than salary and wallet top-ups.
