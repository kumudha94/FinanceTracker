# Next Cycle Plan Others Quick-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible "Others" section to the Dashboard's Next Cycle Plan card where the user can jot down ad-hoc spending entries (topic + amount) that count toward the card's totals immediately, with an optional save action that persists one entry as a real one-time scheduled payment.

**Architecture:** Mostly client-side (`mobile/src/screens/DashboardScreen.tsx`), with two small, necessary backend changes to `server/routes.ts` — the forecast endpoint must expose the cycle's numeric month/year so a saved entry's `startMonth` can be set correctly, and a pre-existing bug in one-time-payment matching must be fixed so a saved entry doesn't incorrectly resurface a year later. Local drafts are pure ephemeral React state (never sent to the server until explicitly saved) and reset on the same triggers the existing what-if scratchpad already resets on.

**Tech Stack:** Express + Drizzle (backend), React Native (Expo) + TypeScript + `@tanstack/react-query` (mobile). No new dependencies.

## Global Constraints

- No new database table or migration — reuses the existing `scheduled_payments` table as-is.
- No new API route for creating the payment — reuses the existing `POST /api/scheduled-payments` (`api.createScheduledPayment` in `mobile/src/lib/api.ts:340-341`).
- The Others section renders unconditionally (unlike every other Next Cycle Plan section, which only renders when `forecast.<section>.length > 0`) — it must always be visible so the feature is discoverable.
- Draft rows use their own new render function (`renderOthersDraftRow`), never the shared `renderForecastRow` — that function is typed around server-shaped `NextMonthForecastItem` (`dueDate`/`subLabel`/`excluded`), which a client-only draft doesn't have.
- `accountId` is intentionally omitted from the create-payment payload — the server already falls back to `storage.getDefaultAccount()` when no account is given.
- No `onError` handler on the save mutation — matches the existing convention in this file (`toggleExclusionMutation`, `dismissBillMappingMutation` also have none); a failed save just leaves the draft in the list for retry.
- This app has no automated test harness (no Jest config, no test script in `mobile/package.json`, no test script for the server). The verification gates are: `npm run check` (root `tsc`, run from the repo root) for `server/routes.ts` changes — current baseline is **14** pre-existing `error TS` occurrences, unrelated to this work; and `cd mobile && npx tsc --noEmit` for mobile changes — current baseline is **31** pre-existing `error TS` occurrences. Every task's bar is **no new errors** against the relevant baseline, not zero.

---

### Task 1: Backend — expose cycle month/year, fix one-time payment year matching

**Files:**
- Modify: `server/routes.ts:2738-2744` (the `case 'one_time':` branch inside `isPaymentDueNextMonth`, used by the `/api/next-month-forecast` handler)
- Modify: `server/routes.ts:2924-2945` (the forecast endpoint's `res.json({...})` block)

**Interfaces:**
- Consumes: `nextMonth`, `nextYear` — already computed earlier in the same handler (`const { month: nextMonth, year: nextYear } = getCyclePrimaryMonth(nextCycle.cycleStart, nextCycle.cycleEnd);`), no new computation needed.
- Produces (used by Task 3): `GET /api/next-month-forecast` response gains two new top-level fields, `nextMonth: number` and `nextYear: number`.

- [ ] **Step 1: Fix the one-time payment year-matching bug**

Current code at `server/routes.ts:2738-2744`:
```ts
          case 'one_time': {
            if (startMonth) {
              const createdYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
              return nextMonth === startMonth && nextYear >= createdYear;
            }
            return false;
          }
```
Change `nextYear >= createdYear` to `nextYear === createdYear`:
```ts
          case 'one_time': {
            if (startMonth) {
              const createdYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
              return nextMonth === startMonth && nextYear === createdYear;
            }
            return false;
          }
```
This is the only change in this step — a one-time payment now only matches the exact year it was created in, not every subsequent year with the same calendar month.

- [ ] **Step 2: Add `nextMonth`/`nextYear` to the forecast response**

Current code at `server/routes.ts:2924-2945`:
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
Add `nextMonth` and `nextYear` right after `monthLabel`:
```ts
      res.json({
        monthLabel,
        nextMonth,
        nextYear,
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

- [ ] **Step 3: Type-check**

Run: `npm run check` (from the repo root, `/home/kgd122/personal/FinanceTracker`)
Expected: exactly **14** `error TS` occurrences (count with `2>&1 | grep -c "error TS"` if the raw output is hard to eyeball), matching the pre-existing baseline. No new errors.

- [ ] **Step 4: Verify by reading, not by running the server**

There's no way to exercise this endpoint against the real Neon database in this environment. Verify by inspection: re-read the edited `case 'one_time':` block and confirm the only change is `>=` → `===`; re-read the edited `res.json` block and confirm `nextMonth`/`nextYear` are the exact same identifiers already in scope earlier in the handler (not renamed, not recomputed).

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: expose next-cycle month/year on forecast endpoint, fix one-time payment year match"
```

---

### Task 2: Mobile — Others section (add, remove, live local total)

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx:28` (the `ForecastAccordion` union type)
- Modify: `mobile/src/screens/DashboardScreen.tsx:39-54` (component state block)
- Modify: `mobile/src/screens/DashboardScreen.tsx:106-131` (`useFocusEffect` and `onRefresh`)
- Modify: `mobile/src/screens/DashboardScreen.tsx:172-187` (the `effectiveSavingsTotal`/`effectiveTotalOutflow`/`effectiveNet` memo block)
- Modify: `mobile/src/screens/DashboardScreen.tsx:423-425` (insert new helper functions between the end of `renderForecastRow` and the start of `renderBillsInboxSection`)
- Modify: `mobile/src/screens/DashboardScreen.tsx:1038-1046` (insert the new accordion section between the end of the Savings Plan block and the closing of the Next Cycle Plan sub-card)
- Modify: `mobile/src/screens/DashboardScreen.tsx` styles block (add three new styles near the existing `forecastRow`/`accordionContent` styles)

**Interfaces:**
- Consumes: existing `colors`, `formatCurrency`, `Ionicons`, `styles.forecastRow`/`forecastDot`/`forecastRowInfo`/`forecastRowName`/`forecastRowAmt`/`forecastToggleBtn`/`accordionHeader`/`accordionIconWrap`/`accordionTitleArea`/`accordionTitle`/`accordionSubtitle`/`accordionRight`/`accordionTotal`/`accordionContent`/`forecastTabTotal`/`forecastTabTotalLabel`/`forecastTabTotalValue` (all already defined in this file), `forecastAccordion`/`toggleForecastAccordion` (already defined).
- Produces (used by Task 3):
  - `type OthersDraft = { id: string; name: string; amount: number };`
  - `othersDrafts: OthersDraft[]` state and `setOthersDrafts: React.Dispatch<React.SetStateAction<OthersDraft[]>>`
  - `removeOthersDraft(id: string): void`
  - `renderOthersDraftRow(draft: OthersDraft)` — a render function Task 3 will modify (add a save icon) but must exist and compile first
  - `othersTotal: number` (memoized)

- [ ] **Step 1: Add `'others'` to the `ForecastAccordion` type**

Current line 28:
```ts
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings' | null;
```
Change to:
```ts
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings' | 'others' | null;
```

- [ ] **Step 2: Add Others state**

Current state block ends at line 54 with:
```ts
  const [editingText, setEditingText] = useState('');
```
Add immediately after:
```ts
  const [othersDrafts, setOthersDrafts] = useState<OthersDraft[]>([]);
  const [othersNameInput, setOthersNameInput] = useState('');
  const [othersAmountInput, setOthersAmountInput] = useState('');
```

- [ ] **Step 3: Declare the `OthersDraft` type**

Add this near the other screen-local type aliases at the top of the file, right after the existing `ForecastAccordion` type (now on line 28 after Step 1's edit):
```ts
type OthersDraft = { id: string; name: string; amount: number };
```

- [ ] **Step 4: Add the `othersTotal` memo and fold it into `effectiveTotalOutflow`**

Current code at lines 172-187:
```ts
  const effectiveSavingsTotal = useMemo(() => {
    if (!forecast) return 0;
    return forecast.savings
      .filter(item => !item.excluded)
      .reduce((sum, item) => sum + effectiveAmount('savings_goal', item), 0);
  }, [forecast, whatIfAmounts]);

  const effectiveTotalOutflow = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalOutflow - forecast.totalCreditCardBills - forecast.totalSavings + effectiveCreditCardTotal + effectiveSavingsTotal;
  }, [forecast, effectiveCreditCardTotal, effectiveSavingsTotal]);

  const effectiveNet = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalIncome - effectiveTotalOutflow;
  }, [forecast, effectiveTotalOutflow]);
```
Replace with (adds the `othersTotal` memo between `effectiveSavingsTotal` and `effectiveTotalOutflow`, and adds `+ othersTotal` to `effectiveTotalOutflow`'s formula and `othersTotal` to its deps array — `effectiveNet` is unchanged, it already derives from `effectiveTotalOutflow`):
```ts
  const effectiveSavingsTotal = useMemo(() => {
    if (!forecast) return 0;
    return forecast.savings
      .filter(item => !item.excluded)
      .reduce((sum, item) => sum + effectiveAmount('savings_goal', item), 0);
  }, [forecast, whatIfAmounts]);

  const othersTotal = useMemo(
    () => othersDrafts.reduce((sum, d) => sum + d.amount, 0),
    [othersDrafts]
  );

  const effectiveTotalOutflow = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalOutflow - forecast.totalCreditCardBills - forecast.totalSavings + effectiveCreditCardTotal + effectiveSavingsTotal + othersTotal;
  }, [forecast, effectiveCreditCardTotal, effectiveSavingsTotal, othersTotal]);

  const effectiveNet = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalIncome - effectiveTotalOutflow;
  }, [forecast, effectiveTotalOutflow]);
```
This keeps `othersTotal` a `useMemo` declared before the component's early return (same hook-ordering requirement as the other four memos in this block — do not move it after the `if (isLoading || !summary) { return ...; }` check further down the file).

- [ ] **Step 5: Add `removeOthersDraft` and `renderOthersDraftRow`**

Current code at lines 421-425:
```ts
      </View>
    );
  };

  const renderBillsInboxSection = () => {
```
Insert two new functions between the closing `};` of `renderForecastRow` and `renderBillsInboxSection`:
```ts
      </View>
    );
  };

  const removeOthersDraft = (id: string) => {
    setOthersDrafts(prev => prev.filter(d => d.id !== id));
  };

  const renderOthersDraftRow = (draft: OthersDraft) => (
    <View key={draft.id} style={[styles.forecastRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.forecastDot, { backgroundColor: '#0ea5e9' }]} />
      <View style={styles.forecastRowInfo}>
        <Text style={[styles.forecastRowName, { color: colors.text }]} numberOfLines={1}>
          {draft.name}
        </Text>
      </View>
      <Text style={[styles.forecastRowAmt, { color: '#ef4444' }]}>
        -{formatCurrency(draft.amount)}
      </Text>
      <TouchableOpacity
        onPress={() => removeOthersDraft(draft.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.forecastToggleBtn}
      >
        <Ionicons name="remove-circle" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  const renderBillsInboxSection = () => {
```
(Task 3 will replace `renderOthersDraftRow`'s body to add a save icon — this version is deliberately remove-only, and is fully functional on its own.)

- [ ] **Step 6: Add `addOthersDraft`**

Add this function directly after `removeOthersDraft` (from Step 5), before `renderOthersDraftRow`:
```ts
  const removeOthersDraft = (id: string) => {
    setOthersDrafts(prev => prev.filter(d => d.id !== id));
  };

  const addOthersDraft = () => {
    const trimmedName = othersNameInput.trim();
    const parsedAmount = parseFloat(othersAmountInput);
    if (!trimmedName || isNaN(parsedAmount) || parsedAmount <= 0) return;
    setOthersDrafts(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, name: trimmedName, amount: parsedAmount }]);
    setOthersNameInput('');
    setOthersAmountInput('');
  };

  const renderOthersDraftRow = (draft: OthersDraft) => (
```
(This shows the full surrounding context so the ordering is unambiguous: `removeOthersDraft`, then `addOthersDraft`, then `renderOthersDraftRow`.)

- [ ] **Step 7: Add the three new styles**

In the `StyleSheet.create({...})` block, near the existing `forecastRowAmtInput` style, add:
```ts
  othersAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 4,
  },
  othersNameInput: {
    flex: 1,
    fontSize: 13,
    borderBottomWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  othersAmountInput: {
    width: 90,
    fontSize: 13,
    borderBottomWidth: 1,
    textAlign: 'right',
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
```

- [ ] **Step 8: Render the Others accordion section**

Current code at (approximately) lines 1038-1046 — the end of the Savings Plan block, the "no outflow planned" empty state, and the closing of the sub-card:
```ts
              )}

              {forecast.scheduledPayments.length === 0 && forecast.loans.length === 0 && forecast.insurance.length === 0 && forecast.creditCardBills.length === 0 && forecast.savings.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No outflow planned for {forecast.monthLabel}</Text>
                </View>
              )}
            </View>
          </View>
        )}
```
Insert the new Others section between the empty-state block and the sub-card's closing `</View>`:
```ts
              )}

              {forecast.scheduledPayments.length === 0 && forecast.loans.length === 0 && forecast.insurance.length === 0 && forecast.creditCardBills.length === 0 && forecast.savings.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No outflow planned for {forecast.monthLabel}</Text>
                </View>
              )}

              <View>
                <TouchableOpacity
                  style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                  onPress={() => toggleForecastAccordion('others')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.accordionIconWrap, { backgroundColor: '#0ea5e9' + '15' }]}>
                    <Ionicons name="receipt-outline" size={16} color="#0ea5e9" />
                  </View>
                  <View style={styles.accordionTitleArea}>
                    <Text style={[styles.accordionTitle, { color: colors.text }]}>Others</Text>
                    <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>
                      {othersDrafts.length > 0 ? `${othersDrafts.length} item${othersDrafts.length > 1 ? 's' : ''}` : 'Tap to add'}
                    </Text>
                  </View>
                  <View style={styles.accordionRight}>
                    <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(othersTotal)}</Text>
                    <Ionicons name={forecastAccordion === 'others' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
                {forecastAccordion === 'others' && (
                  <View style={styles.accordionContent}>
                    {othersDrafts.map((draft) => renderOthersDraftRow(draft))}
                    <View style={styles.othersAddRow}>
                      <TextInput
                        style={[styles.othersNameInput, { color: colors.text, borderColor: colors.border }]}
                        value={othersNameInput}
                        onChangeText={setOthersNameInput}
                        placeholder="Topic"
                        placeholderTextColor={colors.textMuted}
                      />
                      <TextInput
                        style={[styles.othersAmountInput, { color: colors.text, borderColor: colors.border }]}
                        value={othersAmountInput}
                        onChangeText={setOthersAmountInput}
                        placeholder="Amount"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        onSubmitEditing={addOthersDraft}
                      />
                      <TouchableOpacity onPress={addOthersDraft} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="add-circle" size={22} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                    {othersDrafts.length > 0 && (
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(othersTotal)}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
```

- [ ] **Step 9: Reset `othersDrafts` on the same triggers as the what-if scratchpad**

Current code at lines 106-131:
```ts
  useFocusEffect(
    useCallback(() => {
      clearWhatIf();
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    }, [queryClient])
  );

  const onRefresh = useCallback(async () => {
    clearWhatIf();
    setRefreshing(true);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['/api/dashboard-summary'] }),
      queryClient.refetchQueries({ queryKey: ['/api/next-month-forecast'] }),
      queryClient.refetchQueries({ queryKey: ['/api/savings-goals'] }),
      queryClient.refetchQueries({ queryKey: ['/api/institution-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/bill-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/accounts'] }),
    ]);
    setRefreshing(false);
```
Add `setOthersDrafts([]);` right after each `clearWhatIf();` call:
```ts
  useFocusEffect(
    useCallback(() => {
      clearWhatIf();
      setOthersDrafts([]);
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    }, [queryClient])
  );

  const onRefresh = useCallback(async () => {
    clearWhatIf();
    setOthersDrafts([]);
    setRefreshing(true);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['/api/dashboard-summary'] }),
      queryClient.refetchQueries({ queryKey: ['/api/next-month-forecast'] }),
      queryClient.refetchQueries({ queryKey: ['/api/savings-goals'] }),
      queryClient.refetchQueries({ queryKey: ['/api/institution-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/bill-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/accounts'] }),
    ]);
    setRefreshing(false);
```
(`setOthersDrafts` is a `useState` setter, referentially stable — it does not need to be added to either dependency array, same reasoning already established for `setWhatIfAmounts` in this file.)

- [ ] **Step 10: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: exactly **31**, matching the pre-existing baseline. No new errors.

- [ ] **Step 11: Manual verification**

No device/simulator is available in this environment — verify by code trace instead: confirm `othersTotal` and the `effectiveTotalOutflow` change are both declared before the component's `if (isLoading || !summary) { return ...; }` early return (this is the exact bug class fixed in the prior what-if plan's final review — do not repeat it); confirm `addOthersDraft` rejects empty name / non-numeric / zero/negative amount (no state change, no crash); confirm `removeOthersDraft` only ever calls `setOthersDrafts`, never an API call; confirm the Others accordion header/content renders unconditionally (not gated behind `forecast.others` or any array-length check, since there's no such server field).

- [ ] **Step 12: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: add Others quick-add section to Next Cycle Plan (add, remove, live total)"
```

---

### Task 3: Mobile — save a draft as a real one-time scheduled payment

**Files:**
- Modify: `mobile/src/lib/types.ts:233-257` (`NextMonthForecast` interface)
- Modify: `mobile/src/lib/types.ts:296-306` (`InsertScheduledPayment` interface)
- Modify: `mobile/src/screens/DashboardScreen.tsx:98-104` (insert the new mutation after `toggleExclusionMutation`, before `useFocusEffect`)
- Modify: `mobile/src/screens/DashboardScreen.tsx` (`renderOthersDraftRow`, added in Task 2 — add a save icon)

**Interfaces:**
- Consumes: `OthersDraft`, `othersDrafts`/`setOthersDrafts`, `removeOthersDraft`, `renderOthersDraftRow` (all from Task 2); `forecast.nextMonth` (from Task 1's backend change, now available on the already-imported `NextMonthForecast` type once this task extends it); `api.createScheduledPayment` (already exported from `mobile/src/lib/api.ts:340-341`, unchanged).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Add `nextMonth`/`nextYear` to the `NextMonthForecast` type**

Current code at `mobile/src/lib/types.ts:233-257`:
```ts
export interface NextMonthForecast {
  monthLabel: string;
  salary: Array<{
```
Add the two new fields right after `monthLabel`:
```ts
export interface NextMonthForecast {
  monthLabel: string;
  nextMonth: number;
  nextYear: number;
  salary: Array<{
```

- [ ] **Step 2: Make `InsertScheduledPayment.dueDate` optional**

Current code at `mobile/src/lib/types.ts:296-306`:
```ts
export interface InsertScheduledPayment {
  name: string;
  amount: string;
  dueDate: number;
  categoryId?: number | null;
  frequency?: string;
  customIntervalMonths?: number | null;
  startMonth?: number | null;
  status?: 'active' | 'inactive';
  notes?: string | null;
}
```
Change `dueDate: number;` to `dueDate?: number | null;`:
```ts
export interface InsertScheduledPayment {
  name: string;
  amount: string;
  dueDate?: number | null;
  categoryId?: number | null;
  frequency?: string;
  customIntervalMonths?: number | null;
  startMonth?: number | null;
  status?: 'active' | 'inactive';
  notes?: string | null;
}
```
This matches the server's actual Zod schema (`insertScheduledPaymentSchema` in `shared/schema.ts`), where `dueDate` has always been optional/nullable — the mobile type was simply stricter than the API it describes.

- [ ] **Step 3: Add the save mutation**

Current code at `mobile/src/screens/DashboardScreen.tsx:98-104`:
```ts
  const toggleExclusionMutation = useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: ForecastItemType; itemId: number | string }) =>
      api.toggleForecastExclusion(itemType, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
    },
  });

  useFocusEffect(
```
Insert the new mutation between `toggleExclusionMutation` and `useFocusEffect`:
```ts
  const toggleExclusionMutation = useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: ForecastItemType; itemId: number | string }) =>
      api.toggleForecastExclusion(itemType, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
    },
  });

  const saveOthersDraftMutation = useMutation({
    mutationFn: (draft: OthersDraft) =>
      api.createScheduledPayment({
        name: draft.name,
        amount: draft.amount.toString(),
        frequency: 'one_time',
        startMonth: forecast?.nextMonth,
        dueDate: null,
      }),
    onSuccess: (_data, draft) => {
      setOthersDrafts(prev => prev.filter(d => d.id !== draft.id));
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
    },
  });

  useFocusEffect(
```
This is a `useMutation` hook, so it must stay above the component's early return, in the same block as the other `useMutation` calls in this file — do not move it down near `renderOthersDraftRow`.

- [ ] **Step 4: Add the save icon to `renderOthersDraftRow`**

Task 2 left this function remove-only:
```ts
  const renderOthersDraftRow = (draft: OthersDraft) => (
    <View key={draft.id} style={[styles.forecastRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.forecastDot, { backgroundColor: '#0ea5e9' }]} />
      <View style={styles.forecastRowInfo}>
        <Text style={[styles.forecastRowName, { color: colors.text }]} numberOfLines={1}>
          {draft.name}
        </Text>
      </View>
      <Text style={[styles.forecastRowAmt, { color: '#ef4444' }]}>
        -{formatCurrency(draft.amount)}
      </Text>
      <TouchableOpacity
        onPress={() => removeOthersDraft(draft.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.forecastToggleBtn}
      >
        <Ionicons name="remove-circle" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
```
Replace with (adds a save `TouchableOpacity` before the remove one):
```ts
  const renderOthersDraftRow = (draft: OthersDraft) => (
    <View key={draft.id} style={[styles.forecastRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.forecastDot, { backgroundColor: '#0ea5e9' }]} />
      <View style={styles.forecastRowInfo}>
        <Text style={[styles.forecastRowName, { color: colors.text }]} numberOfLines={1}>
          {draft.name}
        </Text>
      </View>
      <Text style={[styles.forecastRowAmt, { color: '#ef4444' }]}>
        -{formatCurrency(draft.amount)}
      </Text>
      <TouchableOpacity
        onPress={() => saveOthersDraftMutation.mutate(draft)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.forecastToggleBtn}
      >
        <Ionicons name="save-outline" size={18} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => removeOthersDraft(draft.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.forecastToggleBtn}
      >
        <Ionicons name="remove-circle" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
```

- [ ] **Step 5: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: exactly **31**, matching the pre-existing baseline.

- [ ] **Step 6: Manual verification**

No device/simulator available — verify by code trace: confirm `saveOthersDraftMutation` is declared above the component's early return (it's a hook); confirm its `mutationFn` payload has no `accountId` field at all (not `accountId: null`, simply absent — the server schema treats a missing field and an explicit `null` the same way, but omitting it is what the spec calls for); confirm `onSuccess` removes exactly the saved draft (`d.id !== draft.id`) and not the whole list; confirm the query invalidation key (`'/api/next-month-forecast'`) matches the key used everywhere else in this file for the same query (`useQuery` call and `toggleExclusionMutation`'s own invalidation) character-for-character.

- [ ] **Step 7: Commit**

```bash
cd mobile && git add src/lib/types.ts src/screens/DashboardScreen.tsx
git commit -m "feat: save Others draft as a real one-time scheduled payment"
```
