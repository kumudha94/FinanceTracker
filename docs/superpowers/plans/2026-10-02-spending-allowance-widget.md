# Spending Allowance Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how much the user can safely spend today, this week and until payday, as a home-screen widget and an in-app screen.

**Architecture:** The server does all the maths behind one endpoint, `GET /api/spending-allowance`. It reuses the Forecast screen's committed-items logic, which this plan extracts into `server/cycleCommitments.ts`. The calculation itself is pure and unit-tested (`server/spendingAllowance.ts`). The Glance widget and the React Native screen only display the endpoint's JSON. An SMS-added transaction triggers an immediate widget refresh through the widget-bridge module.

**Tech Stack:** Express + Drizzle (Postgres/Neon), zod, React Native 0.73 / Expo 50 / React Query, Kotlin Glance widgets, tests run with `npx tsx` (plain `node:assert`, no framework).

**Spec:** `docs/superpowers/specs/2026-10-02-spending-allowance-widget-design.md`

## Global Constraints

- Counted account types: `bank`, `debit_card`, `wallet`. Never `credit_card`.
- Income: salary (actual once credited, else `salaryProfiles.monthlyAmount`) plus credits into `wallet` accounts. Nothing else.
- "Today" and day boundaries are IST (UTC+5:30). Cycle dates come from `getCurrentCycleDates` unchanged.
- `dailyLimit = (income − heldBack − spentBeforeToday) ÷ daysLeft`, where `daysLeft` includes today and is at least 1.
- Default never-count categories: **Repayment, EMI, Investment, Transfer** (only those that exist).
- `npm run db:push` must run before or together with the server deploy.
- Never edit `mobile/android/`. It's generated (gitignored). Native sources live in `mobile/plugins/native/widgets/` and `mobile/modules/`.
- Never `git stash` or overwrite the user's uncommitted `TODO.md` edits.
- The JSON property names in Task 5's response are a contract shared by Task 5 (server), Task 7 (app types) and Task 9 (Kotlin parser). Copy them exactly.

## Review Focus

1. **Payday morning before 05:30 IST.** Cycle boundaries are UTC midnight, so a debit at 02:00 IST on payday falls in the previous cycle. Expected: it isn't counted in the new cycle, and nothing crashes. Pinned by a test in Task 4.
2. **No salary profile, or salary not yet credited.** Expected: `{ configured: false }` without a profile, and the expected amount (marked as expected) before crediting. Pinned in Tasks 4 and 5.
3. **The same amount moving twice in one day** (two ₹500 transfers, or one transfer plus one real ₹500 spend). Expected: each credit pairs with only one debit, so the real spend still counts. Pinned in Task 4.
4. **Over budget for the whole cycle** (negative daily limit). Expected: negative numbers come through as is, and the widget and screen show them red as "over". Pinned in Tasks 4 and 9.
5. **Last day of the cycle and the day after payday** (`daysLeft` at its minimum, and a stale cycle before the next salary is marked credited). Expected: `daysLeft` is never 0 and nothing divides by zero. Pinned in Task 4.

## File Structure

| File | Responsibility |
|---|---|
| `shared/schema.ts` | +3 columns (`transactions.excludedFromAllowance`, `salaryProfiles.allowanceHoldBackSavings`, `salaryProfiles.allowanceExcludedCategoryIds`) |
| `server/storage.ts` | Select the new column; `getPaymentLinkedTransactionIds()` |
| `server/salaryUtils.ts` | `getClosedCardCycle()` (pure) |
| `server/cycleCommitments.ts` (new) | `buildCycleCommitments()`: committed items for a cycle, moved out of the forecast route |
| `server/spendingAllowance.ts` (new) | Pure: `istDayKey`, `resolveSalaryIncome`, `selectCountedDebits`, `computeSpendingAllowance` |
| `server/routes.ts` | Forecast route calls `buildCycleCommitments`; new allowance GET and PATCH settings |
| `server/smsParser.ts`, `mobile/src/lib/smsAutoReader.ts` | Recognise "loaded" (Meal Card top-up) |
| `mobile/src/lib/types.ts`, `mobile/src/lib/api.ts` | `SpendingAllowance` types and API calls |
| `mobile/src/screens/SpendingAllowanceScreen.tsx` (new) | The in-app breakdown and settings |
| `mobile/src/components/AllowanceCard.tsx` (new) | Dashboard card |
| `mobile/src/screens/AddTransactionScreen.tsx` | "Not daily spending" switch |
| `mobile/App.tsx`, `mobile/src/screens/MoreScreen.tsx` | Route, deep link, menu item |
| `mobile/plugins/native/widgets/SpendingAllowanceWidget.kt` (new) | Glance widget, receiver, refresh receiver |
| `mobile/plugins/native/widgets/WidgetRepository.kt`, `WidgetUpdateWorker.kt` | Fetch and store allowance |
| `mobile/plugins/native/widgets/res-xml/spending_allowance_widget_info.xml` (new), `mobile/plugins/withWidgets.js` | Registration |
| `mobile/modules/widget-bridge/...` | `refreshWidgets()` |

## Setup (before Task 1)

- [ ] Create the worktree (project convention):

```bash
cd /home/kgd122/personal/FinanceTracker
git worktree add .worktrees/spending-allowance -b spending-allowance main
cd .worktrees/spending-allowance && npm install && (cd mobile && npm install)
cp ../../.env .env && cp ../../mobile/.env mobile/.env
```

- [ ] Baseline: every server test passes.

```bash
for f in server/__tests__/*.test.ts; do npx tsx $f | tail -1; done
```

Expected: every line ends `0 failed`.

---

### Task 1: Schema columns and storage support

**Files:**
- Modify: `shared/schema.ts` (transactions ~line 133, insertTransactionSchema ~line 147, salaryProfiles ~line 536, insertSalaryProfileSchema ~line 549)
- Modify: `server/storage.ts` (IStorage interface near `getLoanInstallments` ~line 270; `getAllTransactions` select ~line 603; new method near `getLoanInstallments` ~line 2462)

**Interfaces:**
- Produces: `Transaction.excludedFromAllowance: boolean`; `SalaryProfile.allowanceHoldBackSavings: boolean`; `SalaryProfile.allowanceExcludedCategoryIds: number[] | null`; `storage.getPaymentLinkedTransactionIds(ids: number[]): Promise<Set<number>>`

- [ ] **Step 1: Add the columns.** In `shared/schema.ts`, `transactions` table, after `spendingTrackerEnabled`:

```ts
  excludedFromAllowance: boolean("excluded_from_allowance").notNull().default(false), // user marked this debit "Not daily spending" for the spending allowance
```

In `insertTransactionSchema`'s `.extend({...})`, add:

```ts
  excludedFromAllowance: z.boolean().optional(),
```

In `salaryProfiles`, after `autoMarkKeyword`:

```ts
  allowanceHoldBackSavings: boolean("allowance_hold_back_savings").notNull().default(true), // spending allowance holds back savings goal amounts
  allowanceExcludedCategoryIds: integer("allowance_excluded_category_ids").array(), // never-count categories for the allowance; null = never set (seeded on first read)
```

In `insertSalaryProfileSchema`'s `.extend({...})`, add:

```ts
  allowanceHoldBackSavings: z.boolean().optional(),
  allowanceExcludedCategoryIds: z.array(z.number().int()).nullish(),
```

- [ ] **Step 2: Select the new transaction column.** In `server/storage.ts` `getAllTransactions`, add to the `db.select({...})` object after `spendingTrackerEnabled: transactions.spendingTrackerEnabled,`:

```ts
      excludedFromAllowance: transactions.excludedFromAllowance,
```

- [ ] **Step 3: Add `getPaymentLinkedTransactionIds`.** Add to the `IStorage` interface:

```ts
  getPaymentLinkedTransactionIds(transactionIds: number[]): Promise<Set<number>>;
```

Implement it in `DatabaseStorage` next to `getLoanInstallments`:

```ts
  // Transactions that paid a loan installment, loan payment or insurance premium. These pay a
  // committed item the spending allowance already holds back, so they must not count as spending.
  async getPaymentLinkedTransactionIds(transactionIds: number[]): Promise<Set<number>> {
    if (transactionIds.length === 0) return new Set();
    const [installmentRows, loanPaymentRows, premiumRows] = await Promise.all([
      db.select({ id: loanInstallments.transactionId }).from(loanInstallments).where(inArray(loanInstallments.transactionId, transactionIds)),
      db.select({ id: loanPayments.transactionId }).from(loanPayments).where(inArray(loanPayments.transactionId, transactionIds)),
      db.select({ id: insurancePremiums.transactionId }).from(insurancePremiums).where(inArray(insurancePremiums.transactionId, transactionIds)),
    ]);
    return new Set(
      [...installmentRows, ...loanPaymentRows, ...premiumRows]
        .map(r => r.id)
        .filter((id): id is number => id !== null)
    );
  }
```

(`inArray`, `loanInstallments`, `loanPayments` and `insurancePremiums` are already imported in `storage.ts`.)

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "schema.ts|storage.ts"`
Expected: only the errors that already existed before this task (storage.ts around lines 354, 544, 550, 1730, 1739 and 2051, shifted by the lines you added). Any error on a line you touched is new and must be fixed.

- [ ] **Step 5: Apply the schema to the database. Ask the user first.** The dev `.env` points at the production Neon DB. The change is additive with defaults, so the live server keeps working, but it is a production write. Ask: "Task 1 adds 3 columns to the live database (additive, with defaults). OK to run `npm run db:push` now?" On yes:

Run: `npm run db:push`
Then verify:

```bash
node -e "
require('dotenv/config'); const pg=require('pg'); const c=new pg.Client({connectionString:process.env.DATABASE_URL});
c.connect().then(()=>c.query(\"select table_name,column_name from information_schema.columns where column_name in ('excluded_from_allowance','allowance_hold_back_savings','allowance_excluded_category_ids')\")).then(r=>{console.table(r.rows);c.end()})"
```

Expected: 3 rows.

- [ ] **Step 6: Commit.**

```bash
git add shared/schema.ts server/storage.ts
git commit -m "feat(allowance): schema columns and payment-linked transaction lookup"
```

---

### Task 2: Extract cycle commitments from the forecast route (no behaviour change)

> **Order:** do Task 3 (`getClosedCardCycle`, a small pure helper) before this task, because this task imports it. Take the "before" snapshot (Step 1) before touching `routes.ts`.

**Files:**
- Create: `server/cycleCommitments.ts`
- Modify: `server/routes.ts` (`/api/next-month-forecast`, ~lines 3311–3643)

**Interfaces:**
- Produces:

```ts
export type CommitmentMode = 'current' | 'next';
export interface CycleCommitmentGroups {
  plannedIncome: any[];      // { id, name, amount, dueDate: null, excluded }
  scheduledPayments: any[];  // { id, name, amount, dueDate, subLabel, excluded }
  loans: any[];              // { id, name, amount, dueDate, subLabel, excluded }
  insurance: any[];          // { id, name, amount, dueDate, subLabel, excluded }
  creditCardBills: any[];    // { id, name, amount, dueDate, subLabel, creditLimit, excluded }
  savings: any[];            // { id, name, amount, dueDate: null, subLabel, excluded }
}
export async function buildCycleCommitments(
  userId: number,
  opts: { cycleStart: Date; cycleEnd: Date; now: Date; mode: CommitmentMode }
): Promise<CycleCommitmentGroups>;
```

The item arrays are returned **unsorted**. The forecast route keeps its own sorting and totals.

- [ ] **Step 1: Capture the "before" snapshot.** Write a throwaway token helper in the worktree root. It's dot-prefixed so it's easy to spot. Delete it at the end of Step 4 and never commit it:

```bash
SCRATCH=/tmp/claude-1001/-home-kgd122-personal/78ff5d78-d69f-468e-bed8-35fe70f4885f/scratchpad
cat > .dev-token.ts <<'EOF'
import 'dotenv/config';
import pg from 'pg';
import { generateAccessToken } from './server/jwtService';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query('select email from users where id = 8');
console.log(generateAccessToken(8, rows[0].email));
await c.end();
EOF
```

Then run the local server. It signs with the local `.env` secret, so a locally minted token is valid against it (but not against Cloud Run):

```bash
PORT=5055 npm run dev > $SCRATCH/server.log 2>&1 &
sleep 8
TOKEN=$(npx tsx .dev-token.ts)
curl -s -H "Authorization: Bearer $TOKEN" localhost:5055/api/next-month-forecast > $SCRATCH/forecast-before.json
kill %1
```

Expected: `forecast-before.json` contains `"monthLabel"`. Take the before and after snapshots on the **same day**, because the card bill amounts depend on today's date.

- [ ] **Step 2: Create `server/cycleCommitments.ts`.** Move the forecast route's code into it verbatim, from `const exclusions = await storage.getForecastExclusions(...)` through the `creditCardBillItems` array. Keep salary items in the route: they need `getPaydayForMonth`, which the allowance doesn't use. Parameterise it like this:

```ts
import { storage } from "./storage";
import { getCyclePrimaryMonth, getCreditCardBillingCycle, getClosedCardCycle } from "./salaryUtils";

export type CommitmentMode = 'current' | 'next';

export interface CycleCommitmentGroups {
  plannedIncome: any[];
  scheduledPayments: any[];
  loans: any[];
  insurance: any[];
  creditCardBills: any[];
  savings: any[];
}

// Everything committed for one salary cycle: scheduled payments, loan EMIs, insurance premiums,
// credit card bills, savings goals and planned income. Used by the Next Cycle Plan ('next') and
// the spending allowance ('current'). Items keep their `excluded` flag; callers decide what to sum.
export async function buildCycleCommitments(
  userId: number,
  opts: { cycleStart: Date; cycleEnd: Date; now: Date; mode: CommitmentMode }
): Promise<CycleCommitmentGroups> {
  const { cycleStart, cycleEnd, now, mode } = opts;
  const { month: cycleMonth, year: cycleYear } = getCyclePrimaryMonth(cycleStart, cycleEnd);

  const exclusions = await storage.getForecastExclusions(userId, cycleStart);
  const excludedKeys = new Set(exclusions.map(e => `${e.itemType}:${e.itemId}`));
  const isExcluded = (itemType: string, itemId: string | number) => excludedKeys.has(`${itemType}:${itemId}`);

  // ... moved code, with these mechanical renames only:
  //   nextMonth -> cycleMonth, nextYear -> cycleYear
  //   isPaymentDueNextMonth -> isPaymentDueInCycle
  //   nextCycle.cycleStart -> cycleStart
  // ... and these two mode switches (exact code below).
}
```

**Mode switch 1 (insurance).** Replace the `nextPremium` finder's condition:

```ts
          return d.getMonth() + 1 === cycleMonth && d.getFullYear() === cycleYear
            // A paid premium still counts for the cycle under way: its payment is left out of
            // spending instead, so dropping it would lose the money from the calculation.
            && (mode === 'current' || p.status !== 'paid');
```

**Mode switch 2 (card bills).** In the auto-detected card branch, replace the block that computes `curCycleStart`/`curCycleEnd` and queries up to `new Date()` with:

```ts
          let curCycleStart: Date;
          let queryEnd: Date;
          if (mode === 'current') {
            // The bill falling due in this salary cycle is the card's last closed billing cycle.
            const closed = getClosedCardCycle(cycleStart, billingDay);
            curCycleStart = closed.cycleStart;
            queryEnd = closed.cycleEnd;
          } else {
            // (original currentDay >= billingDay branch, unchanged, assigning curCycleStart)
            queryEnd = new Date();
          }
          const curCycleTxns = await storage.getAllTransactions({
            userId,
            accountId: card.id,
            startDate: curCycleStart,
            endDate: queryEnd,
          });
```

In the manual card-bill branch, replace `getCreditCardBillingCycle(now, creditCardAccount.billingDate)` with:

```ts
                const { cycleStart: billStart, cycleEnd: billEnd } = mode === 'current'
                  ? getClosedCardCycle(cycleStart, creditCardAccount.billingDate)
                  : getCreditCardBillingCycle(now, creditCardAccount.billingDate);
```

and use `billStart`/`billEnd` in its `getAllTransactions` call. Return:

```ts
  return {
    plannedIncome: plannedIncomeItems,
    scheduledPayments: scheduledPaymentItems,
    loans: loanItems,
    insurance: insuranceItems,
    creditCardBills: [...autoCcItems, ...manualCcItems],
    savings: savingsItems,
  };
```

The planned-income loop must stop adding to a running total. The route sums from the returned arrays (Step 3).

- [ ] **Step 3: Rewire the forecast route.** In `/api/next-month-forecast`, keep the salary-profile lookup, `nextCycle`, `nextMonth`/`nextYear`, `monthLabel` and the `salaryItems` block. Replace everything from `const exclusions = ...` up to `const totalOutflow = ...` with:

```ts
      const groups = await buildCycleCommitments(userId, {
        cycleStart: nextCycle.cycleStart,
        cycleEnd: nextCycle.cycleEnd,
        now,
        mode: 'next',
      });
      const sumIncluded = (items: any[]) => items.filter(i => !i.excluded).reduce((sum, i) => sum + i.amount, 0);
      const plannedIncomeItems = groups.plannedIncome;
      const scheduledPaymentItems = groups.scheduledPayments;
      const loanItems = groups.loans;
      const insuranceItems = groups.insurance;
      const creditCardBillItems = groups.creditCardBills;
      const savingsItems = groups.savings;
      const totalPlannedIncome = sumIncluded(plannedIncomeItems);
      totalIncome += totalPlannedIncome;
      const totalScheduled = sumIncluded(scheduledPaymentItems);
      const totalLoans = sumIncluded(loanItems);
      const totalInsurance = sumIncluded(insuranceItems);
      const totalCreditCardBills = sumIncluded(creditCardBillItems);
      const totalSavings = sumIncluded(savingsItems);

      const totalOutflow = totalScheduled + totalLoans + totalInsurance + totalCreditCardBills + totalSavings;
```

`getCyclePrimaryMonth(nextCycle.cycleStart, nextCycle.cycleEnd)` inside `buildCycleCommitments` gives the same month and year as the route's `nextMonth`/`nextYear`, so the due checks are unchanged. Leave `res.json({...})` exactly as it is. Add the import:

```ts
import { buildCycleCommitments } from "./cycleCommitments";
```

`getClosedCardCycle` doesn't exist until Task 3. Do Task 3 Steps 1–4 first if you want this step to typecheck, or temporarily stub it. The order is fine as long as Task 2 Step 4 runs after both.

- [ ] **Step 4: Snapshot "after" and compare.**

```bash
PORT=5055 npm run dev > $SCRATCH/server.log 2>&1 &
sleep 8
curl -s -H "Authorization: Bearer $TOKEN" localhost:5055/api/next-month-forecast > $SCRATCH/forecast-after.json
kill %1
node -e "const a=require('$SCRATCH/forecast-before.json'),b=require('$SCRATCH/forecast-after.json');console.log(JSON.stringify(a)===JSON.stringify(b)?'IDENTICAL':'DIFFERENT')"
```

Expected: `IDENTICAL`. If it's `DIFFERENT`, diff the two files (`diff <(jq -S . before) <(jq -S . after)`) and fix the move. Don't continue until they're identical. Keep `$TOKEN` for Task 5 (it's valid for an hour, so mint a fresh one if needed), then `rm .dev-token.ts` at the end of Task 5.

- [ ] **Step 5: Run all server tests, then commit.**

```bash
for f in server/__tests__/*.test.ts; do npx tsx $f | tail -1; done
git add server/cycleCommitments.ts server/routes.ts
git commit -m "refactor(forecast): move cycle commitments into a shared module"
```

---

### Task 3: `getClosedCardCycle`

**Files:**
- Modify: `server/salaryUtils.ts` (after `getCreditCardBillingCycle`, ~line 454)
- Create: `server/__tests__/closedCardCycle.test.ts`

**Interfaces:**
- Produces: `getClosedCardCycle(reference: Date, billingDay: number): { cycleStart: Date; cycleEnd: Date; cycleLabel: string }`

- [ ] **Step 1: Write the failing test.**

```ts
import assert from "node:assert/strict";
import { getClosedCardCycle } from "../salaryUtils";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err: any) { console.log(`  ❌ ${name}: ${err.message}`); failed++; }
}

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

console.log("\n=== Closed Card Cycle Tests ===\n");

test("YES Bank card (bills on 12th), salary cycle from 29 Sep: 12 Aug - 11 Sep", () => {
  const c = getClosedCardCycle(new Date(2026, 8, 29), 12);
  assert.equal(ymd(c.cycleStart), "2026-8-12");
  assert.equal(ymd(c.cycleEnd), "2026-9-11");
});

test("HDFC card (bills on 17th), salary cycle from 29 Sep: 17 Aug - 16 Sep", () => {
  const c = getClosedCardCycle(new Date(2026, 8, 29), 17);
  assert.equal(ymd(c.cycleStart), "2026-8-17");
  assert.equal(ymd(c.cycleEnd), "2026-9-16");
});

test("reference before the billing day: closed cycle ends last month", () => {
  const c = getClosedCardCycle(new Date(2026, 9, 5), 12);
  assert.equal(ymd(c.cycleStart), "2026-8-12");
  assert.equal(ymd(c.cycleEnd), "2026-9-11");
});

test("reference on the billing day itself: the cycle that just closed", () => {
  const c = getClosedCardCycle(new Date(2026, 8, 12), 12);
  assert.equal(ymd(c.cycleStart), "2026-8-12");
  assert.equal(ymd(c.cycleEnd), "2026-9-11");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx tsx server/__tests__/closedCardCycle.test.ts`
Expected: a crash or failure, because `getClosedCardCycle` isn't exported.

- [ ] **Step 3: Implement.**

```ts
/**
 * The card billing cycle that had already closed at `reference`, i.e. the statement whose bill
 * falls due after it. A salary cycle starting 29 Sep pays the YES Bank card's 12 Aug - 11 Sep
 * statement (due 1 Oct), not the 12 Sep - 11 Oct cycle still open.
 */
export function getClosedCardCycle(reference: Date, billingDay: number) {
  const open = getCreditCardBillingCycle(reference, billingDay);
  return getCreditCardBillingCycle(new Date(open.cycleStart.getTime() - 1000), billingDay);
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `npx tsx server/__tests__/closedCardCycle.test.ts`
Expected: `4 passed, 0 failed`

- [ ] **Step 5: Commit.**

```bash
git add server/salaryUtils.ts server/__tests__/closedCardCycle.test.ts
git commit -m "feat(allowance): closed card billing cycle helper"
```

---

### Task 4: Pure allowance calculation

**Files:**
- Create: `server/spendingAllowance.ts`
- Create: `server/__tests__/spendingAllowance.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export const COUNTED_ACCOUNT_TYPES: string[];          // ['bank', 'debit_card', 'wallet']
export function istDayKey(d: Date): string;            // 'YYYY-MM-DD' in IST
export type CommitmentType = 'scheduled_payment' | 'loan' | 'insurance' | 'credit_card_bill' | 'savings_goal';
export interface CommitmentItem { itemType: CommitmentType; id: number | string; name: string; amount: number; subLabel: string; }
export interface AllowanceTxn {
  id: number; type: string; amount: number; transactionDate: Date;
  accountId: number | null; accountType: string | null; accountName: string | null;
  categoryId: number | null; categoryName: string | null; merchant: string | null;
  excludedFromAllowance: boolean; paymentOccurrenceId: number | null; savingsContributionId: number | null;
}
export interface ExcludedDebit { txn: AllowanceTxn; reason: string; }
export function selectCountedDebits(
  txns: AllowanceTxn[], cycleStart: Date,
  ctx: { linkedPaymentTxnIds: Set<number>; neverCountCategoryIds: Set<number>; cardBillItems: CommitmentItem[] }
): { counted: AllowanceTxn[]; excluded: ExcludedDebit[] };
export function resolveSalaryIncome(
  monthlyAmount: string,
  lastCycle: { actualAmount: string | null; actualPayDate: Date | null; expectedPayDate: Date } | null,
  cycleStart: Date, cycleEnd: Date
): { amount: number; isActual: boolean };
export interface SpendingAllowance {
  daysLeft: number; dailyLimit: number; spentToday: number; spentBeforeToday: number;
  todayLeft: number; weekLeft: number; cycleLeft: number; heldBack: number;
}
export function computeSpendingAllowance(input: {
  now: Date; cycleEnd: Date; salaryIncome: number; walletIncome: number;
  commitments: CommitmentItem[]; counted: AllowanceTxn[];
}): SpendingAllowance;
```

- [ ] **Step 1: Write the failing tests.** These use the user's real 29 Sep data.

```ts
import assert from "node:assert/strict";
import {
  istDayKey, selectCountedDebits, resolveSalaryIncome, computeSpendingAllowance,
  type AllowanceTxn, type CommitmentItem,
} from "../spendingAllowance";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err: any) { console.log(`  ❌ ${name}: ${err.message}`); failed++; }
}

let nextId = 1;
function txn(over: Partial<AllowanceTxn>): AllowanceTxn {
  return {
    id: nextId++, type: "debit", amount: 100, transactionDate: new Date("2026-10-01T06:00:00Z"),
    accountId: 28, accountType: "bank", accountName: "HDFC Savings",
    categoryId: null, categoryName: null, merchant: "Shop",
    excludedFromAllowance: false, paymentOccurrenceId: null, savingsContributionId: null,
    ...over,
  };
}
const cycleStart = new Date("2026-09-29T00:00:00Z");
const ctx = (over: Partial<Parameters<typeof selectCountedDebits>[2]> = {}) => ({
  linkedPaymentTxnIds: new Set<number>(), neverCountCategoryIds: new Set<number>(), cardBillItems: [] as CommitmentItem[],
  ...over,
});
const reasons = (r: ReturnType<typeof selectCountedDebits>) => r.excluded.map(e => e.reason);

console.log("\n=== IST day ===\n");

test("02:17 IST on 29 Sep is 28 Sep in UTC but 29 Sep in IST", () => {
  assert.equal(istDayKey(new Date("2026-09-28T20:47:29Z")), "2026-09-29");
});

console.log("\n=== Which debits count ===\n");

test("plain bank debit counts", () => {
  const r = selectCountedDebits([txn({})], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
});

test("wallet (Meal Card) debit counts, credit card debit is ignored entirely", () => {
  const r = selectCountedDebits([
    txn({ accountId: 37, accountType: "wallet" }),
    txn({ accountId: 34, accountType: "credit_card" }),
  ], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.length, 0);
});

test("debits before the cycle start are ignored (payday before 05:30 IST)", () => {
  const r = selectCountedDebits([txn({ transactionDate: new Date("2026-09-28T20:00:00Z") })], cycleStart, ctx());
  assert.equal(r.counted.length + r.excluded.length, 0);
});

test("rule 1: marked not daily spending", () => {
  const r = selectCountedDebits([txn({ excludedFromAllowance: true })], cycleStart, ctx());
  assert.deepEqual(reasons(r), ["Marked not daily spending"]);
});

test("rule 2: linked to a scheduled payment, savings, or loan/insurance payment", () => {
  const a = txn({ paymentOccurrenceId: 166 });
  const b = txn({ savingsContributionId: 3 });
  const c = txn({});
  const r = selectCountedDebits([a, b, c], cycleStart, ctx({ linkedPaymentTxnIds: new Set([c.id]) }));
  assert.deepEqual(reasons(r), ["Planned payment", "Planned payment", "Planned payment"]);
});

test("rule 3: never-count category", () => {
  const r = selectCountedDebits([txn({ categoryId: 12, categoryName: "Repayment" })], cycleStart, ctx({ neverCountCategoryIds: new Set([12]) }));
  assert.deepEqual(reasons(r), ["Category: Repayment"]);
});

test("rule order: the flag wins over a linked payment", () => {
  const r = selectCountedDebits([txn({ excludedFromAllowance: true, paymentOccurrenceId: 1 })], cycleStart, ctx());
  assert.deepEqual(reasons(r), ["Marked not daily spending"]);
});

test("real 29 Sep chain: HDFC->YES transfer, then YES pays the held-back card bill", () => {
  const hdfcOut = txn({ amount: 8790.35, transactionDate: new Date("2026-09-29T11:24:50Z") });
  const yesIn = txn({ type: "credit", amount: 8790.35, accountId: 29, accountType: "bank", transactionDate: new Date("2026-09-29T11:32:56Z") });
  const yesOut = txn({ amount: 8790.35, accountId: 29, accountType: "bank", transactionDate: new Date("2026-09-29T11:25:16Z") });
  const bill: CommitmentItem = { itemType: "credit_card_bill", id: 42, name: "YesBank CC Bill Pay", amount: 8790.35, subLabel: "Monthly" };
  const r = selectCountedDebits([hdfcOut, yesIn, yesOut], cycleStart, ctx({ cardBillItems: [bill] }));
  assert.equal(r.counted.length, 0);
  const byId = new Map(r.excluded.map(e => [e.txn.id, e.reason]));
  assert.equal(byId.get(hdfcOut.id), "Transfer between your accounts");
  assert.equal(byId.get(yesOut.id), "Card bill (held back)");
});

test("rule 4: credit landing on a credit card account reads as a card bill", () => {
  const out = txn({ amount: 4628 });
  const cardIn = txn({ type: "credit", amount: 4628, accountId: 34, accountType: "credit_card" });
  const r = selectCountedDebits([out, cardIn], cycleStart, ctx());
  assert.deepEqual(reasons(r), ["Card bill (held back)"]);
});

test("rule 4: each credit pairs with only one debit", () => {
  const out1 = txn({ amount: 500 });
  const out2 = txn({ amount: 500 });
  const inn = txn({ type: "credit", amount: 500, accountId: 29 });
  const r = selectCountedDebits([out1, out2, inn], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.length, 1);
});

test("rule 4: credit into the same account is not a transfer (refund)", () => {
  const r = selectCountedDebits([txn({ amount: 500 }), txn({ type: "credit", amount: 500 })], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
});

test("rule 4: credit more than 24h away does not pair", () => {
  const r = selectCountedDebits([
    txn({ amount: 500, transactionDate: new Date("2026-10-01T06:00:00Z") }),
    txn({ type: "credit", amount: 500, accountId: 29, transactionDate: new Date("2026-10-02T07:00:00Z") }),
  ], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
});

test("rule 5: card bill matches within Rs 1, and only once", () => {
  const bill: CommitmentItem = { itemType: "credit_card_bill", id: "cc-auto-34", name: "HDFC CC Bill", amount: 5000, subLabel: "" };
  const r = selectCountedDebits([txn({ amount: 5000.8 }), txn({ amount: 5000 })], cycleStart, ctx({ cardBillItems: [bill] }));
  assert.equal(r.excluded.length, 1);
  assert.equal(r.counted.length, 1);
});

console.log("\n=== Salary income ===\n");

const sepCycle = { actualAmount: "182052.00", actualPayDate: new Date("2026-09-29T00:00:00Z"), expectedPayDate: new Date("2026-09-30T00:00:00Z") };

test("credited this cycle: actual amount", () => {
  assert.deepEqual(resolveSalaryIncome("182000.00", sepCycle, cycleStart, new Date("2026-10-29T23:59:59Z")), { amount: 182052, isActual: true });
});

test("last credited cycle is the previous one: expected amount", () => {
  const nextStart = new Date("2026-10-30T00:00:00Z");
  assert.deepEqual(resolveSalaryIncome("182000.00", sepCycle, nextStart, new Date("2026-11-27T23:59:59Z")), { amount: 182000, isActual: false });
});

test("no salary cycle row yet: expected amount", () => {
  assert.deepEqual(resolveSalaryIncome("182000.00", null, cycleStart, new Date("2026-10-29T23:59:59Z")), { amount: 182000, isActual: false });
});

console.log("\n=== Allowance maths ===\n");

const cycleEnd = new Date("2026-10-29T23:59:59Z");
const held: CommitmentItem[] = [{ itemType: "loan", id: 1, name: "EMI", amount: 50000, subLabel: "" }];

test("recalculates from what's left: (income - held - spent before today) / days left", () => {
  // Today is 2 Oct (IST); 2 Oct..29 Oct inclusive = 28 days.
  const a = computeSpendingAllowance({
    now: new Date("2026-10-02T06:00:00Z"), cycleEnd, salaryIncome: 182000, walletIncome: 8000,
    commitments: held,
    counted: [
      txn({ amount: 4000, transactionDate: new Date("2026-10-01T06:00:00Z") }),
      txn({ amount: 260, transactionDate: new Date("2026-10-02T04:00:00Z") }),
    ],
  });
  assert.equal(a.daysLeft, 28);
  assert.equal(a.heldBack, 50000);
  assert.equal(a.spentBeforeToday, 4000);
  assert.equal(a.spentToday, 260);
  assert.equal(a.dailyLimit, 4857.14);       // (190000 - 50000 - 4000) / 28
  assert.equal(a.todayLeft, 4597.14);
  assert.equal(a.weekLeft, 33740);           // 136000 / 28 * 7 - 260
  assert.equal(a.cycleLeft, 135740);
});

test("spend at 00:10 IST counts as today, not yesterday", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-02T06:00:00Z"), cycleEnd, salaryIncome: 1000, walletIncome: 0, commitments: [],
    counted: [txn({ amount: 100, transactionDate: new Date("2026-10-01T18:40:00Z") })], // 2 Oct 00:10 IST
  });
  assert.equal(a.spentToday, 100);
  assert.equal(a.spentBeforeToday, 0);
});

test("last day of the cycle: daysLeft 1, week capped at 1 day", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-29T10:00:00Z"), cycleEnd, salaryIncome: 1000, walletIncome: 0, commitments: [], counted: [],
  });
  assert.equal(a.daysLeft, 1);
  assert.equal(a.dailyLimit, 1000);
  assert.equal(a.weekLeft, 1000);
});

test("after cycle end (salary not marked yet): daysLeft never below 1", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-31T10:00:00Z"), cycleEnd, salaryIncome: 1000, walletIncome: 0, commitments: [], counted: [],
  });
  assert.equal(a.daysLeft, 1);
});

test("over budget for the cycle: negative numbers come through", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-02T06:00:00Z"), cycleEnd, salaryIncome: 10000, walletIncome: 0,
    commitments: held, counted: [],
  });
  assert.ok(a.dailyLimit < 0);
  assert.ok(a.todayLeft < 0);
  assert.equal(a.cycleLeft, -40000);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx tsx server/__tests__/spendingAllowance.test.ts`
Expected: crash, `Cannot find module '../spendingAllowance'`.

- [ ] **Step 3: Implement `server/spendingAllowance.ts`.**

```ts
// Pure maths for the spending allowance ("safe to spend"): which debits count, what the salary
// income is, and the daily / weekly / cycle figures. No DB access, so it's unit-tested directly.

export const COUNTED_ACCOUNT_TYPES = ['bank', 'debit_card', 'wallet'];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar day in IST as 'YYYY-MM-DD'. */
export function istDayKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type CommitmentType = 'scheduled_payment' | 'loan' | 'insurance' | 'credit_card_bill' | 'savings_goal';

export interface CommitmentItem {
  itemType: CommitmentType;
  id: number | string;
  name: string;
  amount: number;
  subLabel: string;
}

export interface AllowanceTxn {
  id: number;
  type: string;
  amount: number;
  transactionDate: Date;
  accountId: number | null;
  accountType: string | null;
  accountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string | null;
  excludedFromAllowance: boolean;
  paymentOccurrenceId: number | null;
  savingsContributionId: number | null;
}

export interface ExcludedDebit {
  txn: AllowanceTxn;
  reason: string;
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Splits this cycle's debits on counted accounts into counted spending and excluded debits
 * (with the reason shown to the user). `txns` may include credits and other account types from
 * up to a day before the cycle: those are only used to pair transfers.
 */
export function selectCountedDebits(
  txns: AllowanceTxn[],
  cycleStart: Date,
  ctx: { linkedPaymentTxnIds: Set<number>; neverCountCategoryIds: Set<number>; cardBillItems: CommitmentItem[] }
): { counted: AllowanceTxn[]; excluded: ExcludedDebit[] } {
  const debits = txns
    .filter(t => t.type === 'debit' && t.transactionDate >= cycleStart && COUNTED_ACCOUNT_TYPES.includes(t.accountType ?? ''))
    .sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime() || a.id - b.id);
  const unusedCredits = txns.filter(t => t.type === 'credit' && t.accountId !== null);
  const unusedBills = [...ctx.cardBillItems];

  const counted: AllowanceTxn[] = [];
  const excluded: ExcludedDebit[] = [];

  for (const d of debits) {
    let reason: string | null = null;

    if (d.excludedFromAllowance) {
      reason = 'Marked not daily spending';
    } else if (d.paymentOccurrenceId || d.savingsContributionId || ctx.linkedPaymentTxnIds.has(d.id)) {
      reason = 'Planned payment';
    } else if (d.categoryId !== null && ctx.neverCountCategoryIds.has(d.categoryId)) {
      reason = `Category: ${d.categoryName ?? 'Excluded'}`;
    } else {
      const creditIdx = unusedCredits.findIndex(c =>
        c.accountId !== d.accountId
        && sameAmount(c.amount, d.amount)
        && Math.abs(c.transactionDate.getTime() - d.transactionDate.getTime()) <= DAY_MS
      );
      if (creditIdx >= 0) {
        const [credit] = unusedCredits.splice(creditIdx, 1);
        reason = credit.accountType === 'credit_card' ? 'Card bill (held back)' : 'Transfer between your accounts';
      } else {
        const billIdx = unusedBills.findIndex(b => Math.abs(b.amount - d.amount) <= 1);
        if (billIdx >= 0) {
          unusedBills.splice(billIdx, 1);
          reason = 'Card bill (held back)';
        }
      }
    }

    if (reason) excluded.push({ txn: d, reason });
    else counted.push(d);
  }

  return { counted, excluded };
}

/**
 * Salary for the cycle: the actual credited amount when the latest salary cycle was paid within
 * this cycle (5 days of slack before the start, since salary often lands the day before payday),
 * otherwise the profile's expected monthly amount.
 */
export function resolveSalaryIncome(
  monthlyAmount: string,
  lastCycle: { actualAmount: string | null; actualPayDate: Date | null; expectedPayDate: Date } | null,
  cycleStart: Date,
  cycleEnd: Date
): { amount: number; isActual: boolean } {
  if (lastCycle?.actualAmount) {
    const paidOn = new Date(lastCycle.actualPayDate ?? lastCycle.expectedPayDate);
    if (paidOn.getTime() >= cycleStart.getTime() - 5 * DAY_MS && paidOn <= cycleEnd) {
      return { amount: parseFloat(lastCycle.actualAmount), isActual: true };
    }
  }
  return { amount: parseFloat(monthlyAmount), isActual: false };
}

export interface SpendingAllowance {
  daysLeft: number;
  dailyLimit: number;
  spentToday: number;
  spentBeforeToday: number;
  todayLeft: number;
  weekLeft: number;
  cycleLeft: number;
  heldBack: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeSpendingAllowance(input: {
  now: Date;
  cycleEnd: Date;
  salaryIncome: number;
  walletIncome: number;
  commitments: CommitmentItem[];
  counted: AllowanceTxn[];
}): SpendingAllowance {
  const today = istDayKey(input.now);
  // cycleEnd is a server-local (UTC) end-of-day, so its UTC date is the cycle's last calendar day.
  const lastDay = input.cycleEnd.toISOString().slice(0, 10);
  const daysLeft = Math.max(1, Math.round((Date.parse(lastDay) - Date.parse(today)) / DAY_MS) + 1);

  const heldBack = input.commitments.reduce((sum, c) => sum + c.amount, 0);
  let spentToday = 0;
  let spentBeforeToday = 0;
  for (const t of input.counted) {
    if (istDayKey(t.transactionDate) === today) spentToday += t.amount;
    else spentBeforeToday += t.amount;
  }

  const income = input.salaryIncome + input.walletIncome;
  const dailyLimit = (income - heldBack - spentBeforeToday) / daysLeft;

  return {
    daysLeft,
    dailyLimit: round2(dailyLimit),
    spentToday: round2(spentToday),
    spentBeforeToday: round2(spentBeforeToday),
    todayLeft: round2(dailyLimit - spentToday),
    weekLeft: round2(dailyLimit * Math.min(7, daysLeft) - spentToday),
    cycleLeft: round2(income - heldBack - spentBeforeToday - spentToday),
    heldBack: round2(heldBack),
  };
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `npx tsx server/__tests__/spendingAllowance.test.ts`
Expected: `22 passed, 0 failed`

- [ ] **Step 5: Commit.**

```bash
git add server/spendingAllowance.ts server/__tests__/spendingAllowance.test.ts
git commit -m "feat(allowance): pure spending allowance calculation"
```

---

### Task 5: Allowance endpoints

**Files:**
- Modify: `server/routes.ts` (add after `/api/forecast-exclusions/toggle`, ~line 3672; imports at top)

**Interfaces:**
- Consumes: `buildCycleCommitments` (Task 2); everything from `server/spendingAllowance.ts` (Task 4); `storage.getPaymentLinkedTransactionIds` (Task 1); `getCurrentCycleDates` (salaryUtils)
- Produces: `GET /api/spending-allowance` → JSON below; `PATCH /api/spending-allowance/settings` body `{ holdBackSavings?: boolean; neverCountCategoryIds?: number[] }` → `{ holdBackSavings, neverCountCategoryIds }`

Response contract (Tasks 7 and 9 rely on these names):

```json
{
  "configured": true,
  "cycle": { "start": "ISO", "end": "ISO", "daysLeft": 28 },
  "today": { "limit": 4857.14, "spent": 260, "left": 4597.14 },
  "week": { "left": 33739.98 },
  "cycleLeft": 135740,
  "income": { "salary": 182052, "salaryIsActual": true, "wallet": 8800 },
  "heldBack": { "total": 50000, "items": [{ "itemType": "loan", "id": 1, "name": "EMI", "amount": 50000, "subLabel": "" }] },
  "spent": { "total": 4260, "counted": [{ "id": 1, "date": "ISO", "merchant": "Swiggy", "amount": 459, "accountName": "ICICI Meal Card", "categoryName": "Food" }] },
  "excluded": [{ "id": 2, "date": "ISO", "merchant": "SUMATHI BEULAH", "amount": 20000, "accountName": "HDFC Savings", "reason": "Category: Repayment" }],
  "settings": { "holdBackSavings": true, "neverCountCategoryIds": [12, 15] }
}
```

When the user has no active salary profile with a `monthlyAmount`, the response is `{ "configured": false }`.

- [ ] **Step 1: Add the imports** at the top of `routes.ts`:

```ts
import {
  selectCountedDebits, resolveSalaryIncome, computeSpendingAllowance,
  type AllowanceTxn, type CommitmentItem, type CommitmentType,
} from "./spendingAllowance";
```

(`buildCycleCommitments` is already imported from Task 2. `getCurrentCycleDates` is already imported from `./salaryUtils`.)

- [ ] **Step 2: Add the settings helper and endpoints** after the forecast-exclusions toggle route:

```ts
  const DEFAULT_NEVER_COUNT_CATEGORIES = ["Repayment", "EMI", "Investment", "Transfer"];

  // Allowance settings live on the salary profile. A null category list means "never set":
  // seed it once with the default categories (those that exist) and store it, so the user sees
  // and can change the starting list. An empty array means the user cleared it.
  async function resolveAllowanceSettings(profile: SalaryProfile) {
    let neverCountCategoryIds = profile.allowanceExcludedCategoryIds;
    if (neverCountCategoryIds == null) {
      const all = await storage.getAllCategories();
      neverCountCategoryIds = all.filter(c => DEFAULT_NEVER_COUNT_CATEGORIES.includes(c.name)).map(c => c.id);
      await storage.updateSalaryProfile(profile.id, { allowanceExcludedCategoryIds: neverCountCategoryIds });
    }
    return { holdBackSavings: profile.allowanceHoldBackSavings, neverCountCategoryIds };
  }

  const COMMITMENT_GROUP_TYPES: Array<[keyof Omit<CycleCommitmentGroups, 'plannedIncome'>, CommitmentType]> = [
    ['scheduledPayments', 'scheduled_payment'],
    ['loans', 'loan'],
    ['insurance', 'insurance'],
    ['creditCardBills', 'credit_card_bill'],
    ['savings', 'savings_goal'],
  ];

  app.get("/api/spending-allowance", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const now = new Date();
      const profile = await storage.getSalaryProfile(userId);
      if (!profile || !profile.isActive || !profile.monthlyAmount) {
        return res.json({ configured: false });
      }
      const lastSalaryCycle = (await storage.getSalaryCycles(profile.id, 1))[0] ?? null;
      const { cycleStart, cycleEnd } = getCurrentCycleDates(profile, lastSalaryCycle, now);
      const settings = await resolveAllowanceSettings(profile);

      const groups = await buildCycleCommitments(userId, { cycleStart, cycleEnd, now, mode: 'current' });
      const commitments: CommitmentItem[] = COMMITMENT_GROUP_TYPES
        .filter(([, itemType]) => settings.holdBackSavings || itemType !== 'savings_goal')
        .flatMap(([group, itemType]) => groups[group]
          .filter((i: any) => !i.excluded && i.amount > 0)
          .map((i: any) => ({ itemType, id: i.id, name: i.name, amount: i.amount, subLabel: i.subLabel ?? '' })));

      // A day before the cycle too, so a transfer's other half just before payday still pairs.
      const rows = await storage.getAllTransactions({ userId, startDate: new Date(cycleStart.getTime() - 24 * 60 * 60 * 1000), endDate: now });
      const txns: AllowanceTxn[] = rows.map(t => ({
        id: t.id,
        type: t.type,
        amount: parseFloat(t.amount),
        transactionDate: new Date(t.transactionDate),
        accountId: t.accountId,
        accountType: t.account?.type ?? null,
        accountName: t.account?.name ?? null,
        categoryId: t.categoryId,
        categoryName: t.category?.name ?? null,
        merchant: t.merchant || t.description || null,
        excludedFromAllowance: !!t.excludedFromAllowance,
        paymentOccurrenceId: t.paymentOccurrenceId,
        savingsContributionId: t.savingsContributionId,
      }));

      const cycleDebitIds = txns.filter(t => t.type === 'debit' && t.transactionDate >= cycleStart).map(t => t.id);
      const linkedPaymentTxnIds = await storage.getPaymentLinkedTransactionIds(cycleDebitIds);
      const { counted, excluded } = selectCountedDebits(txns, cycleStart, {
        linkedPaymentTxnIds,
        neverCountCategoryIds: new Set(settings.neverCountCategoryIds),
        cardBillItems: commitments.filter(c => c.itemType === 'credit_card_bill'),
      });

      const salary = resolveSalaryIncome(profile.monthlyAmount, lastSalaryCycle, cycleStart, cycleEnd);
      const walletIncome = txns
        .filter(t => t.type === 'credit' && t.accountType === 'wallet' && t.transactionDate >= cycleStart)
        .reduce((sum, t) => sum + t.amount, 0);

      const a = computeSpendingAllowance({ now, cycleEnd, salaryIncome: salary.amount, walletIncome, commitments, counted });
      const row = (t: AllowanceTxn) => ({
        id: t.id, date: t.transactionDate.toISOString(), merchant: t.merchant, amount: t.amount,
        accountName: t.accountName, categoryName: t.categoryName,
      });
      const newestFirst = (x: { date: string }, y: { date: string }) => y.date.localeCompare(x.date);

      res.json({
        configured: true,
        cycle: { start: cycleStart.toISOString(), end: cycleEnd.toISOString(), daysLeft: a.daysLeft },
        today: { limit: a.dailyLimit, spent: a.spentToday, left: a.todayLeft },
        week: { left: a.weekLeft },
        cycleLeft: a.cycleLeft,
        income: { salary: salary.amount, salaryIsActual: salary.isActual, wallet: Math.round(walletIncome * 100) / 100 },
        heldBack: { total: a.heldBack, items: commitments },
        spent: { total: Math.round((a.spentToday + a.spentBeforeToday) * 100) / 100, counted: counted.map(row).sort(newestFirst) },
        excluded: excluded.map(e => ({ ...row(e.txn), reason: e.reason })).sort(newestFirst),
        settings,
      });
    } catch (error) {
      console.error("Error computing spending allowance:", error);
      res.status(500).json({ error: "Failed to compute spending allowance" });
    }
  });

  const allowanceSettingsSchema = z.object({
    holdBackSavings: z.boolean().optional(),
    neverCountCategoryIds: z.array(z.number().int()).optional(),
  });

  app.patch("/api/spending-allowance/settings", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const parsed = allowanceSettingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid settings" });
      const profile = await storage.getSalaryProfile(userId);
      if (!profile) return res.status(404).json({ error: "Set up a salary profile first" });

      const { holdBackSavings, neverCountCategoryIds } = parsed.data;
      if (neverCountCategoryIds) {
        const known = new Set((await storage.getAllCategories()).map(c => c.id));
        const unknown = neverCountCategoryIds.filter(id => !known.has(id));
        if (unknown.length > 0) return res.status(400).json({ error: `Unknown category id(s): ${unknown.join(', ')}` });
      }
      const updated = await storage.updateSalaryProfile(profile.id, {
        ...(holdBackSavings !== undefined && { allowanceHoldBackSavings: holdBackSavings }),
        ...(neverCountCategoryIds !== undefined && { allowanceExcludedCategoryIds: neverCountCategoryIds }),
      });
      res.json({
        holdBackSavings: updated!.allowanceHoldBackSavings,
        neverCountCategoryIds: updated!.allowanceExcludedCategoryIds ?? [],
      });
    } catch (error: any) {
      console.error("Error updating allowance settings:", error.message);
      res.status(500).json({ error: "Failed to update allowance settings" });
    }
  });
```

Make sure `SalaryProfile` is in the `@shared/schema` import list, `CycleCommitmentGroups` is imported from `./cycleCommitments`, and `z` is imported from `zod`. Check each with `grep -n` first, and add only what's missing.

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "routes.ts|cycleCommitments|spendingAllowance"`
Expected: only the error that already existed near routes.ts line 2030 (a savings-goal date type). Anything else is new and must be fixed.

- [ ] **Step 4: Live check against the user's real data.** Start the local server with the token from Task 2:

```bash
PORT=5055 npm run dev > $SCRATCH/server.log 2>&1 &
sleep 8
curl -s -H "Authorization: Bearer $TOKEN" localhost:5055/api/spending-allowance | tee $SCRATCH/allowance.json | head -c 3000
kill %1
```

Check by hand against the DB (see the 29 Sep data in the spec):
- `configured: true`, `income.salary` = 182052, `salaryIsActual: true`.
- `heldBack.items` includes the YES Bank and HDFC card bills, Radiance Maintenance, Spotify, Child Trust, FMPB Donation, and the loans.
- `excluded` contains the 29 Sep HDFC −8,790.35 ("Transfer between your accounts"). The YES Bank −8,790.35 should be "Card bill (held back)" **if** the YES Bank card's closed-cycle amount is within ₹1 of 8,790.35. If it isn't, report the actual bill amount instead of forcing a match.
- `excluded` contains the Repayment-category debits (Sumathi Beulah, Velagala…) as "Category: Repayment".
- `spent.counted` contains the Meal Card Swiggy/Amazon debits.

Save the JSON. It's shown to the user in Task 10.

The first GET seeds `allowanceExcludedCategoryIds` on the live profile, which is a write to the user's profile. Mention this when reporting the task.

- [ ] **Step 5: Run all server tests, then commit.**

```bash
for f in server/__tests__/*.test.ts; do npx tsx $f | tail -1; done
git add server/routes.ts
git commit -m "feat(allowance): spending allowance and settings endpoints"
```

---

### Task 6: Meal Card top-up SMS

**Files:**
- Modify: `server/smsParser.ts:25-27` (`CREDIT_KEYWORDS`)
- Modify: `mobile/src/lib/smsAutoReader.ts:77` (`looksFinancial`)
- Test: `server/__tests__/smsParser.test.ts`

**Interfaces:**
- Produces: `parseSmsByRegex(topUpSms)` → `{ type: 'credit', amount: 8800, accountLastDigits: '1286', availableBalance: 9170.52 }`

- [ ] **Step 1: Write the failing test.** Look at how `smsParser.test.ts` declares its tests (`grep -n "^test(\|^function test" server/__tests__/smsParser.test.ts | head`) and add a test in the same style, before its results line:

```ts
test("ICICI prepaid (Meal Card) top-up: 'loaded with' is a credit", () => {
  const sms = "Dear Customer, your ICICI Bank Prepaid Card XX1286 is now active and loaded with Rs 8,800.00. The Available Balance is Rs 9,170.52 .";
  const r = parseSmsByRegex(sms, "AX-ICICIT-S");
  assert.ok(r, "should parse");
  assert.equal(r!.type, "credit");
  assert.equal(r!.amount, 8800);
  assert.equal(r!.accountLastDigits, "1286");
  assert.equal(r!.availableBalance, 9170.52);
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx tsx server/__tests__/smsParser.test.ts | tail -3`
Expected: this test fails (no credit keyword, so it returns null).

- [ ] **Step 3: Implement.** In `server/smsParser.ts`:

```ts
const CREDIT_KEYWORDS = [
  "credited", "received", "deposited", "refunded", "added", "reversed", "loaded"
];
```

In `mobile/src/lib/smsAutoReader.ts`, add `|loaded` to the end of the `looksFinancial` alternation:

```ts
  return /debited|deducted|withdrawn|spent|used for|paid|purchase|charged|sent|credited|received|deposited|refunded|added|reversed|loaded/i.test(body);
```

- [ ] **Step 4: Run it and confirm it passes.** If `accountLastDigits` or `availableBalance` don't come out as expected, fix the extractor for this message shape. Don't loosen the test.

Run: `npx tsx server/__tests__/smsParser.test.ts | tail -1`
Expected: `0 failed`

- [ ] **Step 5: Commit.**

```bash
git add server/smsParser.ts mobile/src/lib/smsAutoReader.ts server/__tests__/smsParser.test.ts
git commit -m "fix(sms): parse prepaid card 'loaded with' top-ups as credits"
```

---

### Task 7: App types, API calls and the "Not daily spending" switch

**Files:**
- Modify: `mobile/src/lib/types.ts` (Transaction interface; add types near `NextMonthForecast`, ~line 292)
- Modify: `mobile/src/lib/api.ts` (~line 334)
- Modify: `mobile/src/screens/AddTransactionScreen.tsx` (mutation near `trackerMutation` ~line 197; UI near the tracker card ~line 546)

**Interfaces:**
- Produces: `SpendingAllowance` type (mirrors the Task 5 JSON); `api.getSpendingAllowance()`; `api.updateSpendingAllowanceSettings(data)`; React Query key `['/api/spending-allowance']`

- [ ] **Step 1: Types.** In `mobile/src/lib/types.ts`, add `excludedFromAllowance?: boolean;` to the `Transaction` interface, then add:

```ts
export interface AllowanceCommitment {
  itemType: 'scheduled_payment' | 'loan' | 'insurance' | 'credit_card_bill' | 'savings_goal';
  id: number | string;
  name: string;
  amount: number;
  subLabel: string;
}

export interface AllowanceTxnRow {
  id: number;
  date: string;
  merchant: string | null;
  amount: number;
  accountName: string | null;
  categoryName: string | null;
}

export interface AllowanceSettings {
  holdBackSavings: boolean;
  neverCountCategoryIds: number[];
}

export type SpendingAllowance =
  | { configured: false }
  | {
      configured: true;
      cycle: { start: string; end: string; daysLeft: number };
      today: { limit: number; spent: number; left: number };
      week: { left: number };
      cycleLeft: number;
      income: { salary: number; salaryIsActual: boolean; wallet: number };
      heldBack: { total: number; items: AllowanceCommitment[] };
      spent: { total: number; counted: AllowanceTxnRow[] };
      excluded: Array<AllowanceTxnRow & { reason: string }>;
      settings: AllowanceSettings;
    };
```

- [ ] **Step 2: API calls.** In `mobile/src/lib/api.ts`, after `getNextMonthForecast`:

```ts
  getSpendingAllowance: () => apiRequest<SpendingAllowance>('/api/spending-allowance'),
  updateSpendingAllowanceSettings: (data: Partial<AllowanceSettings>) =>
    apiRequest<AllowanceSettings>('/api/spending-allowance/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
```

Add `SpendingAllowance` and `AllowanceSettings` to the `import type {...}` list at the top of `api.ts`.

- [ ] **Step 3: The switch.** In `AddTransactionScreen.tsx`, next to `trackerMutation`:

```ts
  // "Not daily spending": saves straight away like the Track spending switch, so a debit opened
  // from the SMS notification can be taken out of the allowance with one tap.
  const allowanceMutation = useMutation({
    mutationFn: (excluded: boolean) => api.updateTransaction(Number(transactionId), { excludedFromAllowance: excluded }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/spending-allowance'] });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Could not update', text2: 'Please try again', position: 'bottom' });
    },
  });
  const savedAccountType = accounts?.find(a => a.id === savedTransaction?.accountId)?.type;
  const showAllowanceSwitch = savedTransaction?.type === 'debit'
    && ['bank', 'debit_card', 'wallet'].includes(savedAccountType ?? '');
```

Check that `api.updateTransaction`'s data parameter type accepts `excludedFromAllowance`. If it's `Partial<InsertTransaction>`-like, add the optional field to that type. In the JSX, directly before `{savedTransaction?.type === 'credit' && (` (the tracker card), add:

```tsx
      {showAllowanceSwitch && (
        <View style={[styles.trackerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.trackerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.trackerLabel, { color: colors.text }]}>Not daily spending</Text>
              <Text style={[styles.trackerDescription, { color: colors.textMuted }]}>
                Leave this out of your safe-to-spend limit, e.g. a transfer or one-off repayment
              </Text>
            </View>
            <Switch
              value={allowanceMutation.isPending ? !!allowanceMutation.variables : !!savedTransaction!.excludedFromAllowance}
              onValueChange={(v) => allowanceMutation.mutate(v)}
              disabled={allowanceMutation.isPending}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      )}
```

- [ ] **Step 4: Typecheck.**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -E "types.ts|api.ts|AddTransactionScreen" ; cd ..`
Expected: no output.

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/screens/AddTransactionScreen.tsx
git commit -m "feat(allowance): app API types and 'Not daily spending' switch"
```

---

### Task 8: Spending Allowance screen, Dashboard card, menu and deep link

**Files:**
- Create: `mobile/src/screens/SpendingAllowanceScreen.tsx`
- Create: `mobile/src/components/AllowanceCard.tsx`
- Modify: `mobile/App.tsx` (RootStackParamList ~line 119; root stack screens ~line 525; linking config)
- Modify: `mobile/src/screens/MoreScreen.tsx` (`menuItems`, ~line 22)
- Modify: `mobile/src/screens/DashboardScreen.tsx` (before `{/* ===== Remaining Cards below main card ===== */}`, ~line 1674)

**Interfaces:**
- Consumes: `api.getSpendingAllowance`, `api.updateSpendingAllowanceSettings`, `api.getCategories`, `SpendingAllowance` (Task 7); `formatCurrency` from `src/lib/utils.ts`
- Produces: root route `SpendingAllowance: undefined`; deep link `com.mytracker.finance://spending-allowance`

- [ ] **Step 1: Route and deep link.** In `App.tsx`: add `SpendingAllowance: undefined;` to `RootStackParamList`. Import the screen, and register it on the root stack next to `InstitutionMappings` with the same options style:

```tsx
        <RootStack.Screen
          name="SpendingAllowance"
          component={SpendingAllowanceScreen}
          options={{ title: 'Safe to spend' }}
        />
```

In `linking.config.screens`, add `SpendingAllowance: 'spending-allowance',`.

- [ ] **Step 2: The screen.** Create `mobile/src/screens/SpendingAllowanceScreen.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { getThemedColors } from '../lib/utils';
import type { RootStackParamList } from '../../App';
import type { AllowanceCommitment, AllowanceTxnRow } from '../lib/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const GROUP_LABELS: Record<AllowanceCommitment['itemType'], string> = {
  scheduled_payment: 'Scheduled payments',
  loan: 'Loan EMIs',
  insurance: 'Insurance',
  credit_card_bill: 'Credit card bills',
  savings_goal: 'Savings goals',
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function SpendingAllowanceScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const [showHeld, setShowHeld] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['/api/spending-allowance'],
    queryFn: api.getSpendingAllowance,
  });
  const { data: categories = [] } = useQuery({ queryKey: ['/api/categories'], queryFn: api.getCategories });

  const settingsMutation = useMutation({
    mutationFn: api.updateSpendingAllowanceSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/spending-allowance'] }),
  });

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!data || !data.configured) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textMuted, marginBottom: 12 }}>Set up salary to see your daily limit</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Salary')}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Open Salary</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const over = data.today.left < 0;
  const moneyColor = (n: number) => (n < 0 ? colors.danger ?? '#dc2626' : colors.text);
  const openTxn = (row: AllowanceTxnRow) => navigation.navigate('AddTransaction', { transactionId: row.id });
  const grouped = Object.entries(
    data.heldBack.items.reduce<Record<string, AllowanceCommitment[]>>((acc, i) => {
      (acc[i.itemType] ??= []).push(i);
      return acc;
    }, {})
  );
  const neverCount = new Set(data.settings.neverCountCategoryIds);
  const toggleCategory = (id: number) => {
    const next = new Set(neverCount);
    next.has(id) ? next.delete(id) : next.add(id);
    settingsMutation.mutate({ neverCountCategoryIds: [...next] });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Safe to spend today</Text>
        <Text style={[styles.big, { color: over ? colors.danger ?? '#dc2626' : colors.primary }]}>
          {over ? `${formatCurrency(-data.today.left)} over today` : formatCurrency(data.today.left)}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          {formatCurrency(data.today.spent)} spent of {formatCurrency(data.today.limit)}
        </Text>
        <View style={styles.row}>
          <Stat label="This week" value={data.week.left} color={moneyColor(data.week.left)} muted={colors.textMuted} />
          <Stat label="Until payday" value={data.cycleLeft} color={moneyColor(data.cycleLeft)} muted={colors.textMuted} />
        </View>
        <Text style={{ color: colors.textMuted, marginTop: 6 }}>
          {data.cycle.daysLeft} {data.cycle.daysLeft === 1 ? 'day' : 'days'} to payday
        </Text>
      </View>

      <Text style={[styles.section, { color: colors.text }]}>How it's worked out</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Line label={`Salary${data.income.salaryIsActual ? '' : ' (expected)'}`} value={data.income.salary} colors={colors} />
        {data.income.wallet > 0 && <Line label="Meal Card top-ups" value={data.income.wallet} colors={colors} />}
        <TouchableOpacity onPress={() => setShowHeld(v => !v)}>
          <Line label={`Held back ${showHeld ? '▾' : '▸'}`} value={-data.heldBack.total} colors={colors} />
        </TouchableOpacity>
        {showHeld && grouped.map(([type, items]) => (
          <View key={type} style={{ paddingLeft: 12 }}>
            <Text style={{ color: colors.textMuted, marginTop: 6 }}>{GROUP_LABELS[type as AllowanceCommitment['itemType']]}</Text>
            {items.map(i => <Line key={`${type}-${i.id}`} label={i.name} value={-i.amount} colors={colors} small />)}
          </View>
        ))}
        <Line label="Spent so far" value={-data.spent.total} colors={colors} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Line label="Left until payday" value={data.cycleLeft} colors={colors} bold />
      </View>

      <Text style={[styles.section, { color: colors.text }]}>Spent this cycle</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {data.spent.counted.length === 0 && <Text style={{ color: colors.textMuted }}>Nothing yet</Text>}
        {data.spent.counted.map(row => (
          <TxnRow key={row.id} row={row} subtitle={`${shortDate(row.date)} · ${row.accountName ?? ''}`} onPress={() => openTxn(row)} colors={colors} />
        ))}
      </View>

      <TouchableOpacity onPress={() => setShowExcluded(v => !v)}>
        <Text style={[styles.section, { color: colors.text }]}>Not counted ({data.excluded.length}) {showExcluded ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {showExcluded && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {data.excluded.map(row => (
            <TxnRow key={row.id} row={row} subtitle={`${shortDate(row.date)} · ${row.reason}`} onPress={() => openTxn(row)} colors={colors} />
          ))}
        </View>
      )}

      <Text style={[styles.section, { color: colors.text }]}>Settings</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.settingRow}>
          <Text style={{ color: colors.text, flex: 1 }}>Hold back savings goals</Text>
          <Switch
            value={settingsMutation.isPending && settingsMutation.variables?.holdBackSavings !== undefined
              ? !!settingsMutation.variables.holdBackSavings
              : data.settings.holdBackSavings}
            onValueChange={(v) => settingsMutation.mutate({ holdBackSavings: v })}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <TouchableOpacity style={styles.settingRow} onPress={() => setShowCategories(v => !v)}>
          <Text style={{ color: colors.text, flex: 1 }}>Categories that never count</Text>
          <Text style={{ color: colors.textMuted }}>{neverCount.size} {showCategories ? '▾' : '▸'}</Text>
        </TouchableOpacity>
        {showCategories && categories.map(c => (
          <TouchableOpacity key={c.id} style={styles.settingRow} onPress={() => toggleCategory(c.id)} disabled={settingsMutation.isPending}>
            <Ionicons name={neverCount.has(c.id) ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
            <Text style={{ color: colors.text, marginLeft: 10 }}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, color, muted }: { label: string; value: number; color: string; muted: string }) {
  return (
    <View style={{ flex: 1, marginTop: 12 }}>
      <Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{formatCurrency(value)}</Text>
    </View>
  );
}

function Line({ label, value, colors, bold, small }: { label: string; value: number; colors: any; bold?: boolean; small?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={{ color: small ? colors.textMuted : colors.text, flex: 1, fontWeight: bold ? '700' : '400', fontSize: small ? 13 : 15 }}>{label}</Text>
      <Text style={{ color: value < 0 && bold ? colors.danger ?? '#dc2626' : colors.text, fontWeight: bold ? '700' : '500', fontSize: small ? 13 : 15 }}>
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

function TxnRow({ row, subtitle, onPress, colors }: { row: AllowanceTxnRow; subtitle: string; onPress: () => void; colors: any }) {
  return (
    <TouchableOpacity style={styles.line} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text }} numberOfLines={1}>{row.merchant ?? 'Transaction'}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{formatCurrency(row.amount)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  big: { fontSize: 32, fontWeight: '800', marginVertical: 4 },
  row: { flexDirection: 'row' },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  divider: { height: 1, marginVertical: 6 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
```

Before relying on them, check: the `useTheme` import path (`grep -n "useTheme" mobile/src/screens/AddTransactionScreen.tsx | head -2`), whether `getThemedColors` lives in `utils.ts`, and whether `colors.danger` exists (`grep -n "danger" mobile/src/lib/utils.ts`). Fix the imports to match. If there's no `danger`, keep the `?? '#dc2626'` fallback. Check that `'Salary'` is a root route (it is, in `RootStackParamList`).

- [ ] **Step 3: Dashboard card.** Create `mobile/src/components/AllowanceCard.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';

// Today's safe-to-spend figure on the Dashboard. Hidden until a salary profile exists.
export function AllowanceCard({ colors }: { colors: any }) {
  const navigation = useNavigation<any>();
  const { data } = useQuery({ queryKey: ['/api/spending-allowance'], queryFn: api.getSpendingAllowance });
  if (!data || !data.configured) return null;
  const over = data.today.left < 0;
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => navigation.navigate('SpendingAllowance')}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '600' }}>Safe to spend today</Text>
        <Text style={{ color: over ? colors.danger ?? '#dc2626' : colors.primary, fontSize: 24, fontWeight: '800' }}>
          {over ? `${formatCurrency(-data.today.left)} over` : formatCurrency(data.today.left)}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          Week {formatCurrency(data.week.left)} · {data.cycle.daysLeft} days to payday
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
});
```

In `DashboardScreen.tsx`, import it and render `<AllowanceCard colors={colors} />` directly above `{/* ===== Remaining Cards below main card ===== */}`. Match the horizontal margin of the neighbouring cards (`grep -n "marginHorizontal" ...` around line 1676) and adjust `styles.card` if they differ. Also add `queryClient.invalidateQueries({ queryKey: ['/api/spending-allowance'] })` wherever the Dashboard's pull-to-refresh invalidates its other queries.

- [ ] **Step 4: More menu.** In `MoreScreen.tsx` `menuItems`, after the "Budget Planner" entry:

```ts
  {
    icon: 'wallet-outline',
    title: 'Safe to Spend',
    subtitle: 'Daily, weekly and payday limits',
    route: 'SpendingAllowance',
    color: '#16a34a',
  },
```

- [ ] **Step 5: Typecheck.**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -E "SpendingAllowanceScreen|AllowanceCard|App.tsx|MoreScreen|DashboardScreen" ; cd ..`
Expected: no output.

- [ ] **Step 6: Commit.**

```bash
git add mobile/src/screens/SpendingAllowanceScreen.tsx mobile/src/components/AllowanceCard.tsx mobile/App.tsx mobile/src/screens/MoreScreen.tsx mobile/src/screens/DashboardScreen.tsx
git commit -m "feat(allowance): Safe to Spend screen, Dashboard card and menu entry"
```

---

### Task 9: Home-screen widget and refresh after SMS

**Files:**
- Create: `mobile/plugins/native/widgets/SpendingAllowanceWidget.kt`
- Create: `mobile/plugins/native/widgets/res-xml/spending_allowance_widget_info.xml`
- Modify: `mobile/plugins/native/widgets/WidgetRepository.kt`, `mobile/plugins/native/widgets/WidgetUpdateWorker.kt`
- Modify: `mobile/plugins/withWidgets.js` (`RECEIVERS`, native file list ~line 109, manifest)
- Modify: `mobile/modules/widget-bridge/android/src/main/java/com/mytracker/finance/widgetbridge/WidgetBridgeModule.kt`, `mobile/modules/widget-bridge/index.ts`
- Modify: `mobile/src/lib/smsAutoReader.ts`

**Interfaces:**
- Consumes: the Task 5 JSON (`configured`, `today.limit/spent/left`, `week.left`, `cycleLeft`, `cycle.daysLeft`)
- Produces: `WidgetRepository.fetchSpendingAllowance(context)`; JS `refreshWidgets(): Promise<void>`; broadcast action `"${packageName}.REFRESH_WIDGETS"` handled by `WidgetRefreshReceiver`

- [ ] **Step 1: Repository.** In `WidgetRepository.kt`, add the data class next to the others:

```kotlin
/** /api/spending-allowance, reduced to what the widget shows. null fields = not configured. */
data class AllowanceSummary(
  val configured: Boolean,
  val todayLimit: Double,
  val todaySpent: Double,
  val todayLeft: Double,
  val weekLeft: Double,
  val cycleLeft: Double,
  val daysLeft: Int
)
```

and the fetch, following `fetchDashboardSpending`:

```kotlin
  suspend fun fetchSpendingAllowance(context: Context): WidgetDataResult<AllowanceSummary> {
    return when (val result = authenticatedGet(context, "$API_BASE_URL/api/spending-allowance")) {
      is WidgetDataResult.Success -> {
        try {
          WidgetDataResult.Success(parseAllowance(JSONObject(result.data)))
        } catch (e: JSONException) {
          WidgetDataResult.NetworkError
        }
      }
      is WidgetDataResult.AuthFailure -> WidgetDataResult.AuthFailure
      is WidgetDataResult.NetworkError -> WidgetDataResult.NetworkError
    }
  }
```

Add a top-level parser in the same file. The worker stores the raw JSON, and the widget parses it again with this same function:

```kotlin
fun parseAllowance(obj: JSONObject): AllowanceSummary {
  if (!obj.optBoolean("configured", false)) return AllowanceSummary(false, 0.0, 0.0, 0.0, 0.0, 0.0, 0)
  val today = obj.getJSONObject("today")
  return AllowanceSummary(
    configured = true,
    todayLimit = today.optDouble("limit", 0.0),
    todaySpent = today.optDouble("spent", 0.0),
    todayLeft = today.optDouble("left", 0.0),
    weekLeft = obj.getJSONObject("week").optDouble("left", 0.0),
    cycleLeft = obj.optDouble("cycleLeft", 0.0),
    daysLeft = obj.getJSONObject("cycle").optInt("daysLeft", 0)
  )
}
```

- [ ] **Step 2: Worker.** In `WidgetUpdateWorker.kt`, add keys next to the others:

```kotlin
val KEY_ALLOWANCE_JSON = stringPreferencesKey("allowance_json")
val KEY_ALLOWANCE_UPDATED_AT = stringPreferencesKey("allowance_updated_at")
val KEY_ALLOWANCE_ERROR = stringPreferencesKey("allowance_error")
```

Add the update function, same shape as `updateSpendingWidgets`:

```kotlin
/** Returns true if this fetch failed with a [WidgetDataResult.NetworkError]. */
private suspend fun updateAllowanceWidget(context: Context): Boolean {
  val glanceIds = GlanceAppWidgetManager(context).getGlanceIds(SpendingAllowanceWidget::class.java)
  if (glanceIds.isEmpty()) return false

  val result = WidgetRepository.fetchSpendingAllowance(context)
  for (glanceId in glanceIds) {
    updateAppWidgetState(context, glanceId) { prefs ->
      when (result) {
        is WidgetDataResult.Success -> {
          val a = result.data
          prefs[KEY_ALLOWANCE_JSON] = JSONObject()
            .put("configured", a.configured)
            .put("today", JSONObject().put("limit", a.todayLimit).put("spent", a.todaySpent).put("left", a.todayLeft))
            .put("week", JSONObject().put("left", a.weekLeft))
            .put("cycleLeft", a.cycleLeft)
            .put("cycle", JSONObject().put("daysLeft", a.daysLeft))
            .toString()
          prefs[KEY_ALLOWANCE_UPDATED_AT] = System.currentTimeMillis().toString()
          prefs.remove(KEY_ALLOWANCE_ERROR)
        }
        is WidgetDataResult.AuthFailure -> prefs[KEY_ALLOWANCE_ERROR] = "auth"
        is WidgetDataResult.NetworkError -> prefs[KEY_ALLOWANCE_ERROR] = "network"
      }
    }
  }
  SpendingAllowanceWidget().updateAll(context)
  return result is WidgetDataResult.NetworkError
}
```

In `doWork()`, add `val allowanceHadNetworkError = updateAllowanceWidget(applicationContext)` and include it in the retry condition.

- [ ] **Step 3: The widget.** Create `SpendingAllowanceWidget.kt`:

```kotlin
package __PACKAGE__.widgets

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import org.json.JSONObject

class SpendingAllowanceWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val prefs = currentState<Preferences>()
      val error = prefs[KEY_ALLOWANCE_ERROR]
      val data = prefs[KEY_ALLOWANCE_JSON]?.let { runCatching { parseAllowance(JSONObject(it)) }.getOrNull() }
      val updatedText = formatUpdatedAt(prefs[KEY_ALLOWANCE_UPDATED_AT]?.toLongOrNull())
      val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://spending-allowance"))
      val title = "Safe to spend today"

      WidgetCard(modifier = GlanceModifier.clickable(actionStartActivity(openIntent))) {
        when {
          error == "auth" -> { WidgetHeader(title, null); WidgetMessage("Open app to sign in") }
          data == null -> { WidgetHeader(title, null); WidgetMessage(if (error == null) "Loading…" else "Unable to load") }
          !data.configured -> { WidgetHeader(title, null); WidgetMessage("Set up salary to see your daily limit") }
          else -> AllowanceContent(data, title, updatedText)
        }
      }
    }
  }
}

@androidx.compose.runtime.Composable
private fun AllowanceContent(a: AllowanceSummary, title: String, updatedText: String) {
  val overToday = a.todayLeft < 0
  val overCycle = a.todayLimit < 0
  val mainColor = if (overToday) WidgetColors.danger else WidgetColors.primary

  WidgetHeader(title, updatedText)
  Spacer(modifier = GlanceModifier.height(4.dp))
  if (overCycle) {
    Text(
      "Over budget for this cycle by ${formatRupees(-a.cycleLeft)}",
      maxLines = 2,
      style = TextStyle(color = WidgetColors.danger, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    )
  } else {
    Row(verticalAlignment = Alignment.Bottom) {
      Text(
        if (overToday) "${formatRupees(-a.todayLeft)} over today" else formatRupees(a.todayLeft),
        maxLines = 1,
        style = TextStyle(color = mainColor, fontSize = 24.sp, fontWeight = FontWeight.Bold)
      )
      if (!overToday) {
        Text(
          "  left of ${formatRupees(a.todayLimit)}",
          maxLines = 1,
          style = TextStyle(color = WidgetColors.textMuted, fontSize = 12.sp)
        )
      }
    }
    Spacer(modifier = GlanceModifier.height(4.dp))
    LinearProgressIndicator(
      progress = if (a.todayLimit > 0) (a.todaySpent / a.todayLimit).toFloat().coerceIn(0f, 1f) else 1f,
      modifier = GlanceModifier.fillMaxWidth().height(6.dp).cornerRadius(3.dp),
      color = mainColor,
      backgroundColor = WidgetColors.divider
    )
    Text("${formatRupees(a.todaySpent)} spent today", maxLines = 1, style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
  }
  Spacer(modifier = GlanceModifier.height(6.dp))
  WidgetDivider()
  Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp)) {
    Column(modifier = GlanceModifier.defaultWeight()) {
      Text("This week", style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
      Text(formatRupees(a.weekLeft), maxLines = 1, style = TextStyle(color = if (a.weekLeft < 0) WidgetColors.danger else WidgetColors.text, fontSize = 14.sp, fontWeight = FontWeight.Bold))
    }
    Column(modifier = GlanceModifier.defaultWeight()) {
      Text("Until payday · ${a.daysLeft}d", style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
      Text(formatRupees(a.cycleLeft), maxLines = 1, style = TextStyle(color = if (a.cycleLeft < 0) WidgetColors.danger else WidgetColors.text, fontSize = 14.sp, fontWeight = FontWeight.Bold))
    }
  }
}

class SpendingAllowanceWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SpendingAllowanceWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    schedulePeriodicWidgetUpdates(context)
    runImmediateWidgetUpdate(context)
  }
}

/**
 * Lets the widget-bridge module (a separate Gradle module that can't see this package) ask for
 * an immediate refresh of every widget, e.g. right after an SMS adds a transaction.
 */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    runImmediateWidgetUpdate(context)
  }
}
```

Check that `formatUpdatedAt` takes a `Long?` and returns `String`: `grep -n "fun formatUpdatedAt" mobile/plugins/native/widgets/*.kt`. Adapt the call if it differs.

- [ ] **Step 4: Info xml.** Create `res-xml/spending_allowance_widget_info.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="110dp"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:updatePeriodMillis="0"
    android:resizeMode="horizontal|vertical"
    android:description="@string/spending_allowance_widget_description"
    android:widgetCategory="home_screen"
    android:initialLayout="@android:layout/simple_list_item_1" />
```

- [ ] **Step 5: Registration.** In `withWidgets.js`, add to `RECEIVERS`:

```js
  {
    className: 'SpendingAllowanceWidgetReceiver',
    infoXml: 'spending_allowance_widget_info',
    label: 'Safe to spend',
    descriptionKey: 'spending_allowance_widget_description',
    description: 'How much you can spend today, this week and until payday',
  },
```

Add `'SpendingAllowanceWidget.kt'` to the native file copy list (next to `'SpendingWidgets.kt'`). In `withWidgetsManifest`, after the receivers loop, register the refresh receiver once. It isn't exported, so only this app can trigger it:

```js
    const refreshName = '.widgets.WidgetRefreshReceiver';
    if (!application.receiver.some((r) => r.$['android:name'] === refreshName)) {
      application.receiver.push({ $: { 'android:name': refreshName, 'android:exported': 'false' } });
    }
```

Read `withWidgetsManifest` first and match how it names the existing receivers (full `.widgets.` prefix or not) and the `application.receiver` initialisation.

- [ ] **Step 6: Bridge.** In `WidgetBridgeModule.kt`, add:

```kotlin
    // Explicit broadcast to the app's WidgetRefreshReceiver: this module can't reference the
    // widget classes directly (they live in the app module), but an explicit intent needs no link.
    AsyncFunction("refreshWidgets") {
      val context = appContext.reactContext ?: return@AsyncFunction Unit
      val intent = android.content.Intent().setClassName(context, "${context.packageName}.widgets.WidgetRefreshReceiver")
      context.sendBroadcast(intent)
    }
```

In `mobile/modules/widget-bridge/index.ts`:

```ts
export function refreshWidgets(): Promise<void> {
  if (!WidgetBridge) return Promise.resolve();
  return WidgetBridge.refreshWidgets();
}
```

In `mobile/src/lib/smsAutoReader.ts`, import `refreshWidgets` from `'../../modules/widget-bridge'`. In `notifyTransactionAdded`, after `scheduleNotificationAsync`, call:

```ts
  // Best-effort: widgets also refresh every 30 minutes, so a failure here is harmless.
  refreshWidgets().catch(() => {});
```

The early `return` when `content` is null means duplicates and ignored SMS don't trigger a refresh, which is intended.

- [ ] **Step 7: Prebuild and build check.** Run Gradle with the settings that work in this environment (see project memory):

```bash
cd mobile
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -Dorg.gradle.java.home=/usr/lib/jvm/java-17-openjdk-amd64 -Dorg.gradle.jvmargs="-Xmx3g" -Pkotlin.compiler.execution.strategy=in-process --max-workers=2 2>&1 | tail -15
cd ../..
grep -c "SpendingAllowanceWidgetReceiver\|WidgetRefreshReceiver" mobile/android/app/src/main/AndroidManifest.xml
```

Expected: `BUILD SUCCESSFUL`, and the grep prints `2`.

- [ ] **Step 8: Commit.** `mobile/android/` is gitignored, so only sources are committed:

```bash
git add mobile/plugins/native/widgets mobile/plugins/withWidgets.js mobile/modules/widget-bridge/index.ts mobile/modules/widget-bridge/android/src mobile/src/lib/smsAutoReader.ts
git status --short | grep -v "build/\|\.gradle/" 
git commit -m "feat(widgets): Safe to spend widget, refreshed right after SMS transactions"
```

---

### Task 10: Verify on the emulator and with the user's real data

**Files:** none (verification only)

- [ ] **Step 1: Show the user the live breakdown.** Using `$SCRATCH/allowance.json` from Task 5 (re-fetch it if it's from a different day), present: income, every held-back item, every counted debit, and every excluded debit with its reason. Ask the user to confirm or correct each excluded or counted row. Fix rule bugs in Task 4's code with a new test first. Category or switch corrections are the user's data, not code.

- [ ] **Step 2: Emulator run.** Boot the Windows AVD and install the release build (commands in project memory: `emulator.exe -avd Medium_Phone_API_36.1`, then copy the APK under `C:\Users\kgd122\` and install with Windows `adb.exe`). Point the app at the **local** server (`EXPO_PUBLIC_API_URL=http://10.0.2.2:5055` for this build only) or at Cloud Run after deploy. Ask the user to log in (OTP to their email). Then check, taking a screenshot of each:
  - the widget added in light and dark mode (`adb shell cmd uimode night yes|no`)
  - tapping the widget opens Safe to Spend
  - Dashboard card → screen; the "Not counted" list; the category settings toggle, with the numbers changing
  - "Not daily spending" switch on a debit → allowance updates
  - the back button from Safe to Spend returns to the previous screen (yesterday's back-button fix)
  - a test SMS (`adb emu sms send HDFCBK "Sent Rs.1.00 From HDFC Bank A/C *7900 To TEST On 02/10/26 Ref 1"`) → the notification arrives and the widget refreshes within ~10 seconds

  The test SMS creates a real ₹1 transaction in the production DB. Ask the user before sending it, and delete the transaction afterwards with their OK.

- [ ] **Step 3: Report.** Share the screenshots and anything that didn't match.

---

### Task 11: Release (only after the user says go)

- [ ] **Step 1:** Merge the branch into `main` with `git merge --no-ff spending-allowance` from the main checkout. If `TODO.md` has uncommitted edits that block the merge, ask the user. Don't stash.
- [ ] **Step 2:** Confirm `db:push` already ran (Task 1 Step 5). If it didn't, run it now with the user's OK, **before** the deploy.
- [ ] **Step 3:** `git push origin main`.
- [ ] **Step 4:** Deploy the server: `~/google-cloud-sdk/bin/gcloud run deploy financetracker --source . --region asia-south1 --project financetracker-506110`. Then smoke-test `GET /api/spending-allowance` on the Cloud Run URL. Expect 401 without a token, not 404.
- [ ] **Step 5:** Start the EAS production build (versionCode auto-increments remotely) and tell the user to update from the Play Store internal track when it's done.
- [ ] **Step 6:** Update `TODO.md` markers only if the user asks. Record the release in project memory.
