# Savings Plan Forecast Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Savings Plan" section to the Next Cycle Plan forecast card on the mobile Dashboard, showing active savings goals with the same +/− include/exclude toggle already used for Scheduled Payments, Loan EMIs, Insurance, and Credit Card Bills.

**Architecture:** Reuse the existing forecast-exclusion mechanism end to end — no new tables, no new API routes. `GET /api/next-month-forecast` gains a fifth item category (`savings`) built the same way the other four are built, using `storage.getAllSavingsGoals` and the existing generic `isExcluded('savings_goal', id)` helper already defined in that handler. `POST /api/forecast-exclusions/toggle` needs zero changes — it's already itemType-agnostic. Mobile gains a fifth accordion block, structurally copy-pasted from the existing four, using the same `renderForecastRow` helper (already itemType-agnostic).

**Tech Stack:** Express + Drizzle ORM (server/routes.ts, server/storage.ts), Zod (shared/schema.ts), React Native + TanStack Query (mobile/src/screens/DashboardScreen.tsx, mobile/src/lib/types.ts).

## Global Constraints

- Only savings goals with `status === 'active'` are shown — paused/completed/inactive goals are omitted entirely (not shown greyed out).
- Only goals with a positive `monthlyExpectedAmount` are included.
- `itemType` string for this category is exactly `'savings_goal'` (not `'savings'` — that string is reserved for the response field name that holds the array).
- No database migration — `forecastExclusions.itemType` is a plain `varchar`, not a Postgres enum type.
- Accent color for this category: `#22c55e` (not otherwise used among the four existing forecast category colors: `#6366f1`, `#8b5cf6`, `#f59e0b`, `#ec4899`).

---

### Task 1: Backend — extend the forecast-exclusion itemType enum

**Files:**
- Modify: `shared/schema.ts:1102`

**Interfaces:**
- Consumes: nothing new.
- Produces: `insertForecastExclusionSchema`'s `itemType` field now accepts `'savings_goal'` in addition to the existing four values. Task 2 relies on this to call `storage.toggleForecastExclusion`/`isExcluded` with `'savings_goal'` without a validation mismatch elsewhere in the codebase that references this schema.

- [ ] **Step 1: Update the enum**

In `shared/schema.ts`, line 1102 currently reads:

```ts
  itemType: z.enum(["scheduled_payment", "insurance", "loan", "credit_card_bill"]),
```

Change it to:

```ts
  itemType: z.enum(["scheduled_payment", "insurance", "loan", "credit_card_bill", "savings_goal"]),
```

- [ ] **Step 2: Type-check**

Run: `cd /home/kgd122/personal/FinanceTracker && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `14` (the same pre-existing unrelated count as before this plan started — confirms this one-line enum change introduced no new type errors).

- [ ] **Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: allow savings_goal as a forecast-exclusion itemType"
```

---

### Task 2: Backend — add savings items to the next-month-forecast endpoint

**Files:**
- Modify: `server/routes.ts:2818-2820` (insert new block between the end of the insurance loop and the credit-card-account lookup)
- Modify: `server/routes.ts:2909` (totalOutflow calculation)
- Modify: `server/routes.ts:2911-2930` (response JSON)

**Interfaces:**
- Consumes: `storage.getAllSavingsGoals(userId): Promise<SavingsGoal[]>` (already exists, used elsewhere in the codebase — e.g. `server/routes.ts` savings-goals routes). `SavingsGoal` has `id: number`, `name: string`, `status: string`, `monthlyExpectedAmount: string | null` (decimal column, returned as string). Consumes `isExcluded(itemType: string, itemId: string | number): boolean`, already defined earlier in this same handler (search `const isExcluded =` within `/api/next-month-forecast`).
- Produces: `savingsItems: any[]` — each item shaped `{ id: number, name: string, amount: number, dueDate: null, subLabel: 'Savings Goal', excluded: boolean }`, matching the `NextMonthForecastItem` shape used by every other category in this response. Produces `totalSavings: number`. Task 3 (mobile types) and Task 4 (mobile UI) consume the response fields `savings` and `totalSavings` by these exact names.

- [ ] **Step 1: Insert the savings items block**

In `server/routes.ts`, find this exact line (currently line 2818, the last line of the insurance `for` loop):

```ts
          if (!excluded) totalInsurance += amount;
        }
      }
```

Immediately after that closing `}` (and before `const allAccounts = await storage.getAllAccounts(userId);`), insert:

```ts

      const activeSavingsGoals = (await storage.getAllSavingsGoals(userId)).filter(
        (g) => g.status === 'active' && parseFloat(g.monthlyExpectedAmount || '0') > 0
      );
      const savingsItems: any[] = activeSavingsGoals.map((g) => ({
        id: g.id,
        name: g.name,
        amount: parseFloat(g.monthlyExpectedAmount || '0'),
        dueDate: null,
        subLabel: 'Savings Goal',
        excluded: isExcluded('savings_goal', g.id),
      }));
      const totalSavings = savingsItems.filter(item => !item.excluded).reduce((sum, item) => sum + item.amount, 0);
```

- [ ] **Step 2: Fold totalSavings into totalOutflow**

Find (currently line 2909):

```ts
      const totalOutflow = totalScheduled + totalLoans + totalInsurance + totalCreditCardBills;
```

Change to:

```ts
      const totalOutflow = totalScheduled + totalLoans + totalInsurance + totalCreditCardBills + totalSavings;
```

- [ ] **Step 3: Add savings to the response**

Find the response block (currently lines 2911-2930):

```ts
      res.json({
        monthLabel,
        salary: salaryItems,
        scheduledPayments: scheduledPaymentItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        loans: loanItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        insurance: insuranceItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        creditCardBills: creditCardBillItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        totalIncome,
        totalOutflow,
        net: totalIncome - totalOutflow,
        totalScheduled,
        totalLoans,
        totalInsurance,
        totalCreditCardBills,
        cycleInfo: {
          cycleStartFormatted: nextCycle.cycleStartFormatted,
          cycleEndFormatted: nextCycle.cycleEndFormatted,
          isSalaryCycle: nextCycle.isSalaryCycle,
        },
      });
```

Change to:

```ts
      res.json({
        monthLabel,
        salary: salaryItems,
        scheduledPayments: scheduledPaymentItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        loans: loanItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        insurance: insuranceItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        creditCardBills: creditCardBillItems.sort((a, b) => (a.dueDate || 99) - (b.dueDate || 99)),
        savings: savingsItems,
        totalIncome,
        totalOutflow,
        net: totalIncome - totalOutflow,
        totalScheduled,
        totalLoans,
        totalInsurance,
        totalCreditCardBills,
        totalSavings,
        cycleInfo: {
          cycleStartFormatted: nextCycle.cycleStartFormatted,
          cycleEndFormatted: nextCycle.cycleEndFormatted,
          isSalaryCycle: nextCycle.isSalaryCycle,
        },
      });
```

- [ ] **Step 4: Type-check**

Run: `cd /home/kgd122/personal/FinanceTracker && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `14` (still the same pre-existing count — no new errors from this task).

- [ ] **Step 5: Manual verification against a running server**

Run: `cd /home/kgd122/personal/FinanceTracker && npm run dev` (leave running in one terminal).

In another terminal, log in and hit the endpoint (replace `<TOKEN>` with a valid access token for a test user that has at least one active savings goal with `monthlyExpectedAmount` set):

```bash
curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:5000/api/next-month-forecast | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log('savings:', JSON.stringify(data.savings, null, 2));
console.log('totalSavings:', data.totalSavings);
console.log('totalOutflow:', data.totalOutflow);
"
```

Expected: `savings` is a non-empty array with one entry per active goal that has a `monthlyExpectedAmount > 0`; `totalSavings` equals the sum of those entries' `amount`; `totalOutflow` includes `totalSavings` (compare against `totalScheduled + totalLoans + totalInsurance + totalCreditCardBills + totalSavings`).

If the test user has no active savings goal with a monthly amount set, first create one via the mobile app's Savings screen (Active status, "Monthly Expected Amount" filled in), or via `POST /api/savings-goals`, before re-running this check.

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts
git commit -m "feat: include active savings goals in next-month-forecast response"
```

---

### Task 3: Mobile — extend forecast types

**Files:**
- Modify: `mobile/src/lib/types.ts:231` (ForecastItemType)
- Modify: `mobile/src/lib/types.ts:246` (NextMonthForecast — add `savings` array field)
- Modify: `mobile/src/lib/types.ts:253` (NextMonthForecast — add `totalSavings` field)

**Interfaces:**
- Consumes: none (type-only change).
- Produces: `ForecastItemType` now includes `'savings_goal'`. `NextMonthForecast` now has `savings: NextMonthForecastItem[]` and `totalSavings: number`. Task 4 consumes both.

- [ ] **Step 1: Extend ForecastItemType**

Find (currently line 231):

```ts
export type ForecastItemType = 'scheduled_payment' | 'insurance' | 'loan' | 'credit_card_bill';
```

Change to:

```ts
export type ForecastItemType = 'scheduled_payment' | 'insurance' | 'loan' | 'credit_card_bill' | 'savings_goal';
```

- [ ] **Step 2: Add savings array field to NextMonthForecast**

Find (currently line 246):

```ts
  creditCardBills: NextMonthForecastItem[];
```

Change to:

```ts
  creditCardBills: NextMonthForecastItem[];
  savings: NextMonthForecastItem[];
```

- [ ] **Step 3: Add totalSavings field to NextMonthForecast**

Find (currently line 253):

```ts
  totalCreditCardBills: number;
```

Change to:

```ts
  totalCreditCardBills: number;
  totalSavings: number;
```

- [ ] **Step 4: Type-check the mobile project**

Run: `cd /home/kgd122/personal/FinanceTracker/mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `31` (the pre-existing baseline count for the mobile project, unrelated to this change — confirms this task introduced no new type errors).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/types.ts
git commit -m "feat: add savings fields to NextMonthForecast type"
```

---

### Task 4: Mobile — add Savings Plan accordion to the Next Cycle Plan card

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx:28` (ForecastAccordion union)
- Modify: `mobile/src/screens/DashboardScreen.tsx:872-874` (insert new accordion block, extend empty-state check)

**Interfaces:**
- Consumes: `NextMonthForecast.savings`, `NextMonthForecast.totalSavings` (from Task 3). Consumes the existing `renderForecastRow(item: NextMonthForecastItem, itemType: ForecastItemType, dotColor: string, keyPrefix: string, metaText?: string)` helper already defined in this file (no changes needed to that function — it's already itemType-agnostic). Consumes the existing `toggleForecastAccordion(section: ForecastAccordion)` callback and `forecastAccordion` state, both already defined in this file.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Extend the ForecastAccordion union**

Find (currently line 28):

```ts
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | null;
```

Change to:

```ts
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings' | null;
```

- [ ] **Step 2: Insert the Savings Plan accordion block**

Find this exact block (the end of the Credit Card Bills accordion, immediately followed by the empty-state check — currently lines 869-874):

```tsx
                    </View>
                  )}
                </View>
              )}

              {forecast.scheduledPayments.length === 0 && forecast.loans.length === 0 && forecast.insurance.length === 0 && forecast.creditCardBills.length === 0 && (
```

Replace it with (this inserts a new accordion block between the Credit Card Bills block and the empty-state check, and extends the empty-state condition):

```tsx
                    </View>
                  )}
                </View>
              )}

              {forecast.savings.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForecastAccordion('savings')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.accordionIconWrap, { backgroundColor: '#22c55e' + '15' }]}>
                      <Ionicons name="trending-up-outline" size={16} color="#22c55e" />
                    </View>
                    <View style={styles.accordionTitleArea}>
                      <Text style={[styles.accordionTitle, { color: colors.text }]}>Savings Plan</Text>
                      <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{forecast.savings.length} goal{forecast.savings.length > 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.accordionRight}>
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalSavings)}</Text>
                      <Ionicons name={forecastAccordion === 'savings' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                  {forecastAccordion === 'savings' && (
                    <View style={styles.accordionContent}>
                      {forecast.savings.map((item) => renderForecastRow(item, 'savings_goal', '#22c55e', 'fsav'))}
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalSavings)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {forecast.scheduledPayments.length === 0 && forecast.loans.length === 0 && forecast.insurance.length === 0 && forecast.creditCardBills.length === 0 && forecast.savings.length === 0 && (
```

- [ ] **Step 3: Type-check the mobile project**

Run: `cd /home/kgd122/personal/FinanceTracker/mobile && npx tsc --noEmit 2>&1 | tail -30`
Expected: no new errors referencing `DashboardScreen.tsx`.

- [ ] **Step 4: Manual verification on device/emulator**

With the backend from Task 2 running and a test user that has an active savings goal with a monthly amount set:

1. Start the mobile app (`cd mobile && npx expo start`) and open the Dashboard tab.
2. Confirm a "Savings Plan" row appears in the Next Cycle Plan card's accordion list, alongside Scheduled Payments / Insurance / Loan EMIs / Credit Card Bills (only the ones with items show).
3. Tap it open — confirm it lists each active goal by name with its `monthlyExpectedAmount`, and a "Total" row at the bottom matching the accordion header's total.
4. Tap the − icon on a goal — confirm the row shows strikethrough/dimmed, the accordion total updates, and the card's top-level "Outflow" and "Balance" figures update accordingly.
5. Tap the now-+ icon to re-include it — confirm everything reverts.
6. Pause (or complete) the savings goal from the Savings screen, pull-to-refresh the Dashboard — confirm the goal disappears from the Savings Plan section entirely (not shown greyed out).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/DashboardScreen.tsx
git commit -m "feat: show Savings Plan accordion in Next Cycle Plan card"
```
