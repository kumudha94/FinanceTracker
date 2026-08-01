# Next Cycle Plan What-If Amount Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user tap the amount on a Credit Card Bills or Savings Plan row inside the Dashboard's "Next Cycle Plan" card, type a hypothetical number, and see the section subtotal and the card's Income/Outflow/Balance stats update live — as a disposable what-if scratchpad with zero persistence.

**Architecture:** Entirely client-side, entirely inside `mobile/src/screens/DashboardScreen.tsx`. A new `whatIfAmounts: Record<string, number>` state map overrides `item.amount` for display/calculation purposes only; nothing is sent to the server. The existing `renderForecastRow` helper (already shared by all five forecast sections) gains an `editable` flag passed only from the two call sites that need it. Totals are recomputed client-side by subtracting the API's real Credit-Card/Savings subtotals and adding back the what-if-adjusted ones.

**Tech Stack:** React Native (Expo SDK 50), TypeScript, `@expo/vector-icons` Ionicons. No new dependencies.

## Global Constraints

- No backend changes: `server/routes.ts`, `shared/schema.ts`, and the `/api/next-month-forecast` / `/api/forecast-exclusions/toggle` endpoints are untouched.
- No persistence: what-if edits never survive a pull-to-refresh, screen refocus, or app restart.
- Only Credit Card Bills and Savings Plan rows are editable — Scheduled Payments, Loan EMIs, and Insurance rows are unaffected.
- Excluded rows (existing +/− toggle) are never editable.
- Follow existing code style in `DashboardScreen.tsx`: inline `StyleSheet` object at the bottom of the file, `colors.*` theming via `getThemedColors`, `Ionicons` for icons, `formatCurrency` for money display.
- Verify every task with `cd mobile && npx tsc --noEmit` (no test harness exists for this app — this is the project's real automated gate, per `docs/superpowers/specs/2026-08-01-next-cycle-whatif-amount-edit-design.md`).

---

### Task 1: What-if state, helpers, and per-row inline edit interaction

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx:1` (react-native import list)
- Modify: `mobile/src/screens/DashboardScreen.tsx:39-51` (component state block)
- Modify: `mobile/src/screens/DashboardScreen.tsx:301-327` (`renderForecastRow`)
- Modify: `mobile/src/screens/DashboardScreen.tsx:891-894` and `:925` (the two call sites that must pass `editable: true`)
- Modify: `mobile/src/screens/DashboardScreen.tsx` styles block (`StyleSheet.create`, near `forecastRowAmt` at line ~1994)

**Interfaces:**
- Consumes: existing `NextMonthForecastItem` / `ForecastItemType` types from `mobile/src/lib/types.ts` (no changes to that file), existing `colors`, `formatCurrency`, `getOrdinalSuffix` already in scope inside `DashboardScreen`.
- Produces (used by Tasks 2–4):
  - `whatIfAmounts: Record<string, number>` state (key format: `` `${itemType}:${itemId}` ``)
  - `setWhatIfAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>`
  - `whatIfKey(itemType: ForecastItemType, itemId: number | string): string`
  - `effectiveAmount(itemType: ForecastItemType, item: NextMonthForecastItem): number`
  - `renderForecastRow(item, itemType, dotColor, keyPrefix, metaText?, editable?)` — new optional 6th param

- [ ] **Step 1: Add `TextInput` to the react-native import**

Current line 1:
```ts
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, LayoutAnimation, Platform, UIManager, Modal, Alert } from 'react-native';
```
Change to:
```ts
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, LayoutAnimation, Platform, UIManager, Modal, Alert } from 'react-native';
```

- [ ] **Step 2: Add what-if state after the existing state block**

Existing block (lines 39-51) ends with:
```ts
  const [hideBalance, setHideBalance] = useState(true);
  const [showCycleInfoModal, setShowCycleInfoModal] = useState(false);
```
Add immediately after:
```ts
  const [whatIfAmounts, setWhatIfAmounts] = useState<Record<string, number>>({});
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
```

- [ ] **Step 3: Add `whatIfKey` / `effectiveAmount` helpers**

Place these directly above the existing `renderForecastRow` definition (currently at line 301), so they're in scope for it:
```ts
  const whatIfKey = (itemType: ForecastItemType, itemId: number | string) => `${itemType}:${itemId}`;

  const effectiveAmount = (itemType: ForecastItemType, item: NextMonthForecastItem) =>
    whatIfAmounts[whatIfKey(itemType, item.id)] ?? item.amount;
```

- [ ] **Step 4: Replace `renderForecastRow` with the editable version**

Replace the existing function (lines 301-327):
```ts
  const renderForecastRow = (item: NextMonthForecastItem, itemType: ForecastItemType, dotColor: string, keyPrefix: string, metaText?: string) => (
    <View key={`${keyPrefix}-${item.id}`} style={[styles.forecastRow, { borderBottomColor: colors.border }, item.excluded && { opacity: 0.5 }]}>
      <View style={[styles.forecastDot, { backgroundColor: dotColor }]} />
      <View style={styles.forecastRowInfo}>
        <Text style={[styles.forecastRowName, { color: colors.text }, item.excluded && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.forecastRowMeta, { color: colors.textMuted }]}>
          {metaText ?? `${item.subLabel || ''}${item.dueDate ? ` · Due: ${item.dueDate}${getOrdinalSuffix(item.dueDate)}` : ''}`}
        </Text>
      </View>
      <Text style={[styles.forecastRowAmt, { color: item.excluded ? colors.textMuted : '#ef4444' }]}>
        -{formatCurrency(item.amount)}
      </Text>
      <TouchableOpacity
        onPress={() => toggleExclusionMutation.mutate({ itemType, itemId: item.id })}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.forecastToggleBtn}
      >
        <Ionicons
          name={item.excluded ? 'add-circle' : 'remove-circle'}
          size={20}
          color={item.excluded ? '#10b981' : colors.textMuted}
        />
      </TouchableOpacity>
    </View>
  );
```
With:
```ts
  const renderForecastRow = (item: NextMonthForecastItem, itemType: ForecastItemType, dotColor: string, keyPrefix: string, metaText?: string, editable?: boolean) => {
    const key = whatIfKey(itemType, item.id);
    const hasOverride = whatIfAmounts[key] !== undefined;
    const amount = effectiveAmount(itemType, item);
    const isEditingThisRow = editingRowKey === key;

    const startEditing = () => {
      if (!editable || item.excluded) return;
      setEditingText(String(amount));
      setEditingRowKey(key);
    };

    const commitEdit = () => {
      const parsed = parseFloat(editingText);
      setWhatIfAmounts(prev => {
        const next = { ...prev };
        if (!isNaN(parsed) && parsed >= 0 && parsed !== item.amount) {
          next[key] = parsed;
        } else {
          delete next[key];
        }
        return next;
      });
      setEditingRowKey(null);
    };

    const resetRow = () => {
      setWhatIfAmounts(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };

    return (
      <View key={`${keyPrefix}-${item.id}`} style={[styles.forecastRow, { borderBottomColor: colors.border }, item.excluded && { opacity: 0.5 }]}>
        <View style={[styles.forecastDot, { backgroundColor: dotColor }]} />
        <View style={styles.forecastRowInfo}>
          <Text style={[styles.forecastRowName, { color: colors.text }, item.excluded && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.forecastRowMeta, { color: colors.textMuted }]}>
            {metaText ?? `${item.subLabel || ''}${item.dueDate ? ` · Due: ${item.dueDate}${getOrdinalSuffix(item.dueDate)}` : ''}`}
          </Text>
        </View>
        {isEditingThisRow ? (
          <TextInput
            style={[styles.forecastRowAmtInput, { color: colors.text, borderColor: colors.primary }]}
            value={editingText}
            onChangeText={setEditingText}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            keyboardType="numeric"
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <TouchableOpacity onPress={startEditing} disabled={!editable || item.excluded} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Text style={[styles.forecastRowAmt, { color: item.excluded ? colors.textMuted : hasOverride ? colors.primary : '#ef4444' }]}>
              -{formatCurrency(amount)}
            </Text>
          </TouchableOpacity>
        )}
        {hasOverride && !isEditingThisRow && (
          <TouchableOpacity onPress={resetRow} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.forecastToggleBtn}>
            <Ionicons name="refresh-outline" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => toggleExclusionMutation.mutate({ itemType, itemId: item.id })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.forecastToggleBtn}
        >
          <Ionicons
            name={item.excluded ? 'add-circle' : 'remove-circle'}
            size={20}
            color={item.excluded ? '#10b981' : colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    );
  };
```

- [ ] **Step 5: Pass `editable: true` from the Credit Card Bills and Savings Plan call sites only**

Credit Card Bills call site (currently around line 891-894):
```ts
                      {forecast.creditCardBills.map((item) => renderForecastRow(
                        item, 'credit_card_bill', '#ec4899', 'fcc',
                        `${item.dueDate ? `Due: ${item.dueDate}${getOrdinalSuffix(item.dueDate)}` : ''}${item.creditLimit ? ` · Limit: ${formatCurrency(item.creditLimit)}` : ''}`
                      ))}
```
Add `true` as the 6th argument:
```ts
                      {forecast.creditCardBills.map((item) => renderForecastRow(
                        item, 'credit_card_bill', '#ec4899', 'fcc',
                        `${item.dueDate ? `Due: ${item.dueDate}${getOrdinalSuffix(item.dueDate)}` : ''}${item.creditLimit ? ` · Limit: ${formatCurrency(item.creditLimit)}` : ''}`,
                        true
                      ))}
```

Savings Plan call site (currently around line 925):
```ts
                      {forecast.savings.map((item) => renderForecastRow(item, 'savings_goal', '#22c55e', 'fsav'))}
```
Change to:
```ts
                      {forecast.savings.map((item) => renderForecastRow(item, 'savings_goal', '#22c55e', 'fsav', undefined, true))}
```

Leave the Scheduled Payments (line ~798), Insurance (line ~829), and Loan EMIs (line ~860) call sites unchanged — they'll simply pass `editable: undefined`, which `renderForecastRow` treats as "not editable."

- [ ] **Step 6: Add the `forecastRowAmtInput` style**

In the `StyleSheet.create({...})` block, near the existing `forecastRowAmt` style (~line 1994), add:
```ts
  forecastRowAmtInput: {
    fontSize: 13,
    fontWeight: '700',
    borderBottomWidth: 1,
    minWidth: 70,
    textAlign: 'right',
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
```

- [ ] **Step 7: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors. If `renderForecastRow`'s new signature causes an "expected 4-5 arguments, got 6" type error at a call site, confirm that call site is one of the two updated in Step 5 — all five call sites must compile since `editable` is optional.

- [ ] **Step 8: Manual verification**

Start the app (`cd mobile && npx expo start`), open Dashboard, expand "Credit Card Bills" and "Savings Plan" under Next Cycle Plan:
- Tapping an amount in either section turns it into an editable numeric field, pre-filled with the current amount.
- Typing a new number and tapping elsewhere (blur) shows that new number in red-if-normal / green-primary-if-overridden, plus a small refresh icon next to it.
- Tapping the refresh icon reverts the row to its original amount and the icon disappears.
- Tapping an amount in Scheduled Payments, Loan EMIs, or Insurance does nothing (not editable).
- Excluding a Credit Card Bill or Savings row (existing +/− toggle) makes its amount non-tappable while excluded.

- [ ] **Step 9: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: inline what-if amount edit for Credit Card Bills / Savings Plan rows"
```

---

### Task 2: Recompute Credit Card Bills / Savings Plan section subtotals

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (add two `useMemo` blocks near the other `useMemo`s at lines 144-146; update the Credit Card Bills and Savings Plan accordion JSX, currently ~lines 870-933)

**Interfaces:**
- Consumes: `whatIfAmounts`, `effectiveAmount`, `forecast` (from Task 1 and the existing `useQuery`)
- Produces (used by Task 3): `effectiveCreditCardTotal: number`, `effectiveSavingsTotal: number`

- [ ] **Step 1: Add the two memoized totals**

Existing memo block (lines 144-146):
```ts
  const activeGoals = useMemo(() => savingsGoals?.filter(g => g.status === 'active') || [], [savingsGoals]);
  const monthlyExpectedSavings = useMemo(() => activeGoals.reduce((acc, goal) => acc + parseFloat(goal.monthlyExpectedAmount || "0"), 0), [activeGoals]);
  const savedThisCycle = summary?.savedThisCycle ?? 0;
```
Add after it:
```ts
  const effectiveCreditCardTotal = useMemo(() => {
    if (!forecast) return 0;
    return forecast.creditCardBills
      .filter(item => !item.excluded)
      .reduce((sum, item) => sum + effectiveAmount('credit_card_bill', item), 0);
  }, [forecast, whatIfAmounts]);

  const effectiveSavingsTotal = useMemo(() => {
    if (!forecast) return 0;
    return forecast.savings
      .filter(item => !item.excluded)
      .reduce((sum, item) => sum + effectiveAmount('savings_goal', item), 0);
  }, [forecast, whatIfAmounts]);
```
Note: `forecast` is `undefined` until its query resolves, and this component already early-returns during `isLoading` (line 156), but `forecast` itself has no separate loading guard — keep the `if (!forecast) return 0;` guard so these memos are safe to declare before that data arrives.

- [ ] **Step 2: Use the effective totals in the Credit Card Bills accordion**

In the Credit Card Bills block (~lines 870-902), the header total:
```ts
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalCreditCardBills)}</Text>
```
becomes:
```ts
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(effectiveCreditCardTotal)}</Text>
```
and the footer total inside the expanded accordion:
```ts
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalCreditCardBills)}</Text>
```
becomes:
```ts
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(effectiveCreditCardTotal)}</Text>
```

- [ ] **Step 3: Use the effective total in the Savings Plan accordion**

Same two replacements in the Savings Plan block (~lines 904-933): both occurrences of `forecast.totalSavings` become `effectiveSavingsTotal`.

- [ ] **Step 4: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

In the running app, edit a Credit Card Bill amount — the "Credit Card Bills" accordion header total and the "Total" row inside the expanded section both update to reflect the new number (sum of all non-excluded rows in that section, using the edited value for the edited row). Repeat for Savings Plan. Exclude a row via +/− and confirm the section total drops it regardless of any what-if edit on it.

- [ ] **Step 6: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: recompute Credit Card Bills / Savings Plan subtotals with what-if edits"
```

---

### Task 3: Recompute card-level Income / Outflow / Balance with what-if edits

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (add `useMemo` blocks after Task 2's; update the `forecastSummaryRow` JSX at lines 746-763)

**Interfaces:**
- Consumes: `effectiveCreditCardTotal`, `effectiveSavingsTotal` (Task 2), `forecast.totalOutflow`, `forecast.totalCreditCardBills`, `forecast.totalSavings`, `forecast.totalIncome`
- Produces: `effectiveTotalOutflow: number`, `effectiveNet: number`

- [ ] **Step 1: Add the two memoized card-level totals**

Directly after the `effectiveSavingsTotal` memo from Task 2, add:
```ts
  const effectiveTotalOutflow = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalOutflow - forecast.totalCreditCardBills - forecast.totalSavings + effectiveCreditCardTotal + effectiveSavingsTotal;
  }, [forecast, effectiveCreditCardTotal, effectiveSavingsTotal]);

  const effectiveNet = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalIncome - effectiveTotalOutflow;
  }, [forecast, effectiveTotalOutflow]);
```

- [ ] **Step 2: Use the effective totals in the summary stat row**

Current block (lines 746-763):
```ts
            <View style={styles.forecastSummaryRow}>
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Income</Text>
                <Text style={[styles.forecastStatValue, { color: '#10b981' }]}>+{formatCurrency(forecast.totalIncome)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Outflow</Text>
                <Text style={[styles.forecastStatValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalOutflow)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Balance</Text>
                <Text style={[styles.forecastStatValueSmall, { color: colors.text }]}>
                  {forecast.net >= 0 ? '+' : ''}{formatCurrency(forecast.net)}
                </Text>
              </View>
            </View>
```
Replace the Outflow and Balance values only (Income is never what-if-editable, so it stays as `forecast.totalIncome`):
```ts
            <View style={styles.forecastSummaryRow}>
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Income</Text>
                <Text style={[styles.forecastStatValue, { color: '#10b981' }]}>+{formatCurrency(forecast.totalIncome)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Outflow</Text>
                <Text style={[styles.forecastStatValue, { color: '#ef4444' }]}>-{formatCurrency(effectiveTotalOutflow)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Balance</Text>
                <Text style={[styles.forecastStatValueSmall, { color: colors.text }]}>
                  {effectiveNet >= 0 ? '+' : ''}{formatCurrency(effectiveNet)}
                </Text>
              </View>
            </View>
```

- [ ] **Step 3: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Edit a Credit Card Bill or Savings Plan amount up or down and confirm the card's top "Outflow" and "Balance" figures move accordingly, while "Income" never changes. Reset the row and confirm both snap back to the original values.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: reflect what-if edits in Next Cycle Plan Outflow/Balance totals"
```

---

### Task 4: What-if banner, reset-all, and reset-on-refetch

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (JSX after the `mainCardHeader` block, ~line 744; `onRefresh` at lines 115-126; `useFocusEffect` at lines 103-113; styles block)

**Interfaces:**
- Consumes: `whatIfAmounts`, `setWhatIfAmounts` (Task 1)
- Produces: none consumed by later tasks (this is the last task)

- [ ] **Step 1: Add a `clearWhatIf` helper and `hasWhatIf` flag**

Place near the other helpers defined in Task 1 (after `effectiveAmount`):
```ts
  const clearWhatIf = () => setWhatIfAmounts({});
  const hasWhatIf = Object.keys(whatIfAmounts).length > 0;
```

- [ ] **Step 2: Render the banner inside the Next Cycle Plan card**

Current structure (lines 730-746):
```ts
        {accounts.length > 0 && forecast && (
          <View style={[styles.mainCard, { backgroundColor: colors.card }]}>
            <View style={styles.mainCardHeader}>
              <View style={styles.mainCardHeaderLeft}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <View style={[styles.forecastIconWrap, { backgroundColor: '#3b82f6' + '15' }]}>
                    <Ionicons name="calendar-outline" size={16} color="#3b82f6" />
                  </View>
                  <Text style={[styles.username, { color: colors.text }]}>Next Cycle Plan</Text>
                </View>
              </View>
              <View style={[styles.cycleBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.cycleBadgeText, { color: colors.primary }]}>{forecast.monthLabel}</Text>
              </View>
            </View>

            <View style={styles.forecastSummaryRow}>
```
Insert the banner between the header `</View>` and the summary row:
```ts
        {accounts.length > 0 && forecast && (
          <View style={[styles.mainCard, { backgroundColor: colors.card }]}>
            <View style={styles.mainCardHeader}>
              <View style={styles.mainCardHeaderLeft}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <View style={[styles.forecastIconWrap, { backgroundColor: '#3b82f6' + '15' }]}>
                    <Ionicons name="calendar-outline" size={16} color="#3b82f6" />
                  </View>
                  <Text style={[styles.username, { color: colors.text }]}>Next Cycle Plan</Text>
                </View>
              </View>
              <View style={[styles.cycleBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.cycleBadgeText, { color: colors.primary }]}>{forecast.monthLabel}</Text>
              </View>
            </View>

            {hasWhatIf && (
              <TouchableOpacity onPress={clearWhatIf} style={[styles.whatIfBanner, { backgroundColor: colors.warning + '18' }]} activeOpacity={0.7}>
                <Ionicons name="flask-outline" size={13} color={colors.warning} />
                <Text style={[styles.whatIfBannerText, { color: colors.warning }]}>Viewing a what-if scenario</Text>
                <Text style={[styles.whatIfResetText, { color: colors.warning }]}>Reset</Text>
              </TouchableOpacity>
            )}

            <View style={styles.forecastSummaryRow}>
```

- [ ] **Step 3: Add the banner styles**

In the `StyleSheet.create({...})` block, near `forecastSummaryRow` (~line 1938), add:
```ts
  whatIfBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  whatIfBannerText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  whatIfResetText: {
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
```

- [ ] **Step 4: Reset what-if state whenever the forecast refetches**

`onRefresh` (lines 115-126) currently:
```ts
  const onRefresh = useCallback(async () => {
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
  }, [queryClient]);
```
Add `setWhatIfAmounts({});` as the first line inside the function body:
```ts
  const onRefresh = useCallback(async () => {
    setWhatIfAmounts({});
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
  }, [queryClient]);
```

`useFocusEffect` (lines 103-113) currently:
```ts
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    }, [queryClient])
  );
```
Add `setWhatIfAmounts({});` as the first line inside the callback:
```ts
  useFocusEffect(
    useCallback(() => {
      setWhatIfAmounts({});
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    }, [queryClient])
  );
```
(`setWhatIfAmounts` is a `useState` setter, referentially stable — it doesn't need to be added to either dependency array.)

- [ ] **Step 5: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Full manual verification pass**

This closes out every item in the spec's Testing checklist:
- Tap a Credit Card Bill amount, type a different value → section subtotal and card Outflow/Balance update immediately, "Viewing a what-if scenario" banner appears.
- Tap the row's refresh icon → row reverts, and once no rows have overrides, the banner disappears.
- Tap the banner's "Reset" → all what-if edits clear at once, all totals snap back, banner disappears.
- Repeat the amount-edit check for Savings Plan.
- Confirm an excluded row's amount is not tappable.
- Set a what-if edit, then pull-to-refresh → banner disappears and totals show real data.
- Set a what-if edit, navigate to another tab and back to Dashboard → what-if is cleared (via `useFocusEffect`).

- [ ] **Step 7: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: add what-if reset banner and reset-on-refetch for Next Cycle Plan edits"
```
