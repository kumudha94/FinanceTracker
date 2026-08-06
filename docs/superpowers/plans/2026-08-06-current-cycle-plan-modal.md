# Current Cycle Plan Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the current-cycle main card an "Actual vs Projected" planning modal — reached via a new icon that replaces the settings gear — where the user can see a projected end-of-cycle balance (actual + pending bills + ad-hoc plans), mark a pending bill paid inline, and add/edit/delete ad-hoc income/expense entries for the rest of this cycle.

**Architecture:** Mostly client-side (`mobile/src/screens/DashboardScreen.tsx`), reusing the existing `/api/dashboard-summary` endpoint's per-item pending/paid data (no new aggregation logic needed there) plus the existing `planned_income_entries` and one-time `scheduled_payments` machinery already built for Next Cycle Plan's Others section. One backend change exposes the occurrence/installment/premium child-record ids that the existing mark-paid endpoints need but `dashboard-summary` doesn't currently return (it only returns the parent record's id).

**Tech Stack:** Express + Drizzle (backend), React Native (Expo) + TypeScript + `@tanstack/react-query` (mobile). No new dependencies, no new database tables.

## Global Constraints

- No new database tables or migrations — reuses `scheduled_payments` (one-time), `planned_income_entries`, `payment_occurrences`, loan installments, and insurance premiums exactly as they exist today.
- No what-if amount override on pending bills — Projected uses each item's real due amount as-is (confirmed design decision, see spec).
- No account picker / transaction-toggle options in the mark-paid sheet — it uses the same default-account convention already used elsewhere in this screen (`accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id`), with `createTransaction`/`affectAccountBalance` both fixed `true`. A user who needs those toggles still uses the existing dedicated screens (Scheduled Payments / Loan Details / Insurance Details), unchanged.
- This app has no automated test harness (no Jest config, no test script in `mobile/package.json` or the server). Verification gates: `npm run check` (root `tsc`, repo root) for `server/routes.ts` changes, and `cd mobile && npx tsc --noEmit` for mobile changes. **Before Task 1**, run both and record the current baseline error count — every task's bar is *no new errors* against that baseline, not zero. (The two prior plans in this repo recorded baselines of 14 server / 31 mobile errors as of 2026-08-02 and 2026-08-03 respectively — re-check rather than assume these still hold, since other uncommitted/committed work may have changed them.)
- Every new screen-local piece of state, memo, and mutation must be declared **before** the component's early return at `mobile/src/screens/DashboardScreen.tsx` (`if (isLoading || !summary) { return ...; }`, currently around line 311) — this is a React hooks-rules requirement, and the exact bug class a prior plan in this repo had to fix in review. Guard the body of any new memo that reads `summary` with `if (!summary) return <default>;`, the same pattern `effectiveCreditCardTotal` etc. already use for `forecast`.

---

### Task 1: Backend — expose occurrence/installment/premium/category ids and cycle month/year

**Files:**
- Modify: `server/routes.ts` (`GET /api/dashboard-summary` handler, the `scheduledPaymentsBills`/`creditCardBills` item builder around lines 2661-2674, the `loanBills` builder around lines 2741-2752, the `insuranceBills` builder around lines 2767-2778, and the final `res.json({...})` block around lines 2808-2821)

**Interfaces:**
- Consumes: `occurrence`, `currentInstallment`, `currentPremium`, `currentMonth`, `currentYear` — all already computed earlier in the same handler, no new queries.
- Produces (used by Task 2 onward): `billsDueDetails.scheduledPayments[]` and `billsDueDetails.creditCardBills[]` items gain `occurrenceId: number | null` and `categoryId: number | null`; `billsDueDetails.loans[]` items gain `installmentId: number | null`; `billsDueDetails.insurance[]` items gain `premiumId: number | null`; the top-level response gains `currentMonth: number` and `currentYear: number`.

- [ ] **Step 1: Add `occurrenceId`/`categoryId` to scheduled payment / credit card bill items**

Current code (`server/routes.ts`, inside the `billItems` map, ~lines 2661-2674):
```ts
        return {
          paymentType: p.paymentType,
          billItem: {
            id: p.id,
            name: p.name,
            amount,
            dueDate: p.dueDate,
            dueDateType: p.dueDateType || 'fixed_day',
            frequency: p.frequency || 'monthly',
            isPaid,
            paidAmount,
            status: isPaid ? 'paid' : (p.dueDate && resolveDueDate(p.dueDate) < startOfToday ? 'overdue' : 'pending'),
          },
        };
```
Replace with:
```ts
        return {
          paymentType: p.paymentType,
          billItem: {
            id: p.id,
            name: p.name,
            amount,
            dueDate: p.dueDate,
            dueDateType: p.dueDateType || 'fixed_day',
            frequency: p.frequency || 'monthly',
            isPaid,
            paidAmount,
            status: isPaid ? 'paid' : (p.dueDate && resolveDueDate(p.dueDate) < startOfToday ? 'overdue' : 'pending'),
            occurrenceId: occurrence?.id ?? null,
            categoryId: p.categoryId ?? null,
          },
        };
```

- [ ] **Step 2: Add `installmentId` to loan bill items**

Current code (~lines 2741-2752):
```ts
        return {
          id: loan.id,
          name: loan.name,
          loanType: loan.type,
          amount: currentInstallment ? parseFloat(currentInstallment.emiAmount) : parseFloat(loan.emiAmount || '0'),
          dueDate: loan.emiDay,
          isPaid: currentInstallment?.status === 'paid',
          paidAmount: currentInstallment?.paidAmount ? parseFloat(currentInstallment.paidAmount) : 0,
          status: currentInstallment?.status || (loan.emiDay && resolveDueDate(loan.emiDay) < startOfToday ? 'overdue' : 'pending'),
          lenderName: loan.lenderName || '',
        };
```
Replace with:
```ts
        return {
          id: loan.id,
          name: loan.name,
          loanType: loan.type,
          amount: currentInstallment ? parseFloat(currentInstallment.emiAmount) : parseFloat(loan.emiAmount || '0'),
          dueDate: loan.emiDay,
          isPaid: currentInstallment?.status === 'paid',
          paidAmount: currentInstallment?.paidAmount ? parseFloat(currentInstallment.paidAmount) : 0,
          status: currentInstallment?.status || (loan.emiDay && resolveDueDate(loan.emiDay) < startOfToday ? 'overdue' : 'pending'),
          lenderName: loan.lenderName || '',
          installmentId: currentInstallment?.id ?? null,
        };
```

- [ ] **Step 3: Add `premiumId` to insurance bill items**

Current code (~lines 2767-2778):
```ts
        if (currentPremium) {
          insuranceBills.push({
            id: ins.id,
            name: ins.name,
            insuranceType: ins.type,
            providerName: ins.providerName || '',
            amount: parseFloat(currentPremium.amount),
            dueDate: new Date(currentPremium.dueDate).getDate(),
            isPaid: currentPremium.status === 'paid',
            paidAmount: currentPremium.paidAmount ? parseFloat(currentPremium.paidAmount) : 0,
            status: currentPremium.status || 'pending',
          });
        }
```
Replace with:
```ts
        if (currentPremium) {
          insuranceBills.push({
            id: ins.id,
            name: ins.name,
            insuranceType: ins.type,
            providerName: ins.providerName || '',
            amount: parseFloat(currentPremium.amount),
            dueDate: new Date(currentPremium.dueDate).getDate(),
            isPaid: currentPremium.status === 'paid',
            paidAmount: currentPremium.paidAmount ? parseFloat(currentPremium.paidAmount) : 0,
            status: currentPremium.status || 'pending',
            premiumId: currentPremium.id ?? null,
          });
        }
```

- [ ] **Step 4: Add `currentMonth`/`currentYear` to the response**

Current code (~lines 2808-2821):
```ts
      res.json({
        monthLabel: cycleDatesObj.cycleLabel,
        totalIncome,
        totalSpent,
        totalSpentToday,
        billsDue: totalBillsDue,
        incomeByAccount: Array.from(incomeByAccount.values()).sort((a, b) => b.amount - a.amount),
        expenseByAccount: Array.from(expenseByAccount.values()).sort((a, b) => b.amount - a.amount),
        billsDueDetails: {
```
Replace with:
```ts
      res.json({
        monthLabel: cycleDatesObj.cycleLabel,
        currentMonth,
        currentYear,
        totalIncome,
        totalSpent,
        totalSpentToday,
        billsDue: totalBillsDue,
        incomeByAccount: Array.from(incomeByAccount.values()).sort((a, b) => b.amount - a.amount),
        expenseByAccount: Array.from(expenseByAccount.values()).sort((a, b) => b.amount - a.amount),
        billsDueDetails: {
```
(`currentMonth`/`currentYear` are the exact identifiers already in scope from `const { month: currentMonth, year: currentYear } = getCyclePrimaryMonth(startOfMonth, endOfMonth);` earlier in this same handler — no renaming, no recomputation.)

- [ ] **Step 5: Type-check**

Run: `npm run check` (from the repo root, `/home/kgd122/personal/FinanceTracker`)
Expected: no new `error TS` occurrences vs. the baseline recorded before Task 1.

- [ ] **Step 6: Verify by inspection**

There's no way to exercise this endpoint against the real Neon database in this environment. Re-read all four edited blocks and confirm: each new field reads from a variable already in scope in that exact block (no typos, no new queries introduced); `occurrenceId`/`installmentId`/`premiumId` are `?? null` (never `undefined`, which would be dropped by `JSON.stringify` and make the field silently absent instead of explicitly `null`).

- [ ] **Step 7: Commit**

```bash
git add server/routes.ts
git commit -m "feat: expose occurrence/installment/premium ids and cycle month/year on dashboard-summary"
```

---

### Task 2: Mobile — extend types for the new backend fields

**Files:**
- Modify: `mobile/src/lib/types.ts` (`BillItem` interface, `DashboardSummary` interface, the `markPremiumPaid` data type in `mobile/src/lib/api.ts`)
- Modify: `mobile/src/lib/api.ts` (`markPremiumPaid`)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 5, 6, 7): `BillItem.occurrenceId`, `BillItem.categoryId`, `BillItem.installmentId`, `BillItem.premiumId` (all `number | null | undefined`); `DashboardSummary.currentMonth`, `DashboardSummary.currentYear`; `api.markPremiumPaid`'s third argument accepts `affectAccountBalance?: boolean`.

- [ ] **Step 1: Extend `BillItem`**

Current code (`mobile/src/lib/types.ts:188-205`):
```ts
export interface BillItem {
  id: number | string;
  name: string;
  amount: number;
  dueDate: number | null;
  dueDateType?: string;
  frequency?: string;
  isPaid: boolean;
  paidAmount: number;
  status: string;
  loanType?: string;
  lenderName?: string;
  insuranceType?: string;
  providerName?: string;
  creditLimit?: number | null;
  bankName?: string;
  isAutoCalculated?: boolean;
}
```
Replace with:
```ts
export interface BillItem {
  id: number | string;
  name: string;
  amount: number;
  dueDate: number | null;
  dueDateType?: string;
  frequency?: string;
  isPaid: boolean;
  paidAmount: number;
  status: string;
  loanType?: string;
  lenderName?: string;
  insuranceType?: string;
  providerName?: string;
  creditLimit?: number | null;
  bankName?: string;
  isAutoCalculated?: boolean;
  occurrenceId?: number | null;
  categoryId?: number | null;
  installmentId?: number | null;
  premiumId?: number | null;
}
```

- [ ] **Step 2: Extend `DashboardSummary`**

Current code (`mobile/src/lib/types.ts:232-241`):
```ts
export interface DashboardSummary {
  monthLabel: string;
  totalIncome: number;
  totalSpent: number;
  totalSpentToday: number;
  billsDue: number;
  incomeByAccount: AccountBreakdown[];
  expenseByAccount: AccountBreakdown[];
  billsDueDetails: BillsDueDetails;
```
Replace with:
```ts
export interface DashboardSummary {
  monthLabel: string;
  currentMonth: number;
  currentYear: number;
  totalIncome: number;
  totalSpent: number;
  totalSpentToday: number;
  billsDue: number;
  incomeByAccount: AccountBreakdown[];
  expenseByAccount: AccountBreakdown[];
  billsDueDetails: BillsDueDetails;
```

- [ ] **Step 3: Widen `markPremiumPaid`'s data type**

Current code (`mobile/src/lib/api.ts:727-728`):
```ts
  markPremiumPaid: (insuranceId: number, premiumId: number, data: { amount: string; accountId?: number; createTransaction?: boolean }) => 
    apiRequest<InsurancePremium>(`/api/insurances/${insuranceId}/premiums/${premiumId}/pay`, { method: 'POST', body: JSON.stringify(data) }),
```
Replace with:
```ts
  markPremiumPaid: (insuranceId: number, premiumId: number, data: { amount: string; accountId?: number; createTransaction?: boolean; affectAccountBalance?: boolean }) => 
    apiRequest<InsurancePremium>(`/api/insurances/${insuranceId}/premiums/${premiumId}/pay`, { method: 'POST', body: JSON.stringify(data) }),
```
(The backend handler at `server/routes.ts:5820+` already reads `affectAccountBalance` from the body — this was simply missing from the client's type signature.)

- [ ] **Step 4: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase vs. the baseline recorded before Task 1.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/lib/types.ts src/lib/api.ts
git commit -m "feat: add occurrence/installment/premium id fields and widen markPremiumPaid type"
```

---

### Task 3: Mobile — decouple `renderAccordionSection` from Bills-tab-only state, add mark-paid hook

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (`renderBillItem`, `renderAccordionSection`, and their 4 call sites in the Bills tab)

**Interfaces:**
- Consumes: existing `styles.billDetailRow`/`billStatusDot`/`billDetailInfo`/`billDetailName`/`billMetaRow`/`billSubLabel`/`billDueText`/`billDetailRight`/`billDetailAmt`/`statusBadge`/`statusBadgeText`/`accordionHeader`/`accordionIconWrap`/`accordionTitleArea`/`accordionTitle`/`accordionSubtitle`/`accordionRight`/`accordionTotal`/`accordionContent` (all already defined), `colors`, `formatCurrency`.
- Produces (used by Task 5, 6): `renderBillItem(bill: BillItem, showSubLabel?: string, onMarkPaid?: (bill: BillItem) => void)` — unchanged behavior when the third argument is omitted. `renderAccordionSection(title: string, icon: keyof typeof Ionicons.glyphMap, iconColor: string, isOpen: boolean, onToggle: () => void, items: BillItem[], subLabelFn?: (item: BillItem) => string, onMarkPaid?: (item: BillItem) => void)` — the `sectionKey: BillsAccordion` parameter is removed; callers now pass `isOpen`/`onToggle` explicitly instead of a key the function looked up internally.

This is a pure refactor — the Bills tab must render identically before and after. No new UI appears until Task 5.

- [ ] **Step 1: Add the mark-paid checkmark to `renderBillItem`**

Current code (`mobile/src/screens/DashboardScreen.tsx:364-398`):
```ts
  const renderBillItem = (bill: BillItem, showSubLabel?: string) => {
    const statusColor = bill.isPaid ? '#10b981' : bill.status === 'overdue' ? '#ef4444' : bill.status === 'due_today' ? '#3b82f6' : '#f59e0b';
    const statusIcon: keyof typeof Ionicons.glyphMap = bill.isPaid ? 'checkmark-circle' : bill.status === 'overdue' ? 'alert-circle' : bill.status === 'due_today' ? 'today' : 'time';
    const statusText = bill.isPaid ? 'Paid' : bill.status === 'overdue' ? 'Overdue' : bill.status === 'due_today' ? 'Due Today' : 'Pending';

    return (
      <View key={`bill-${bill.id}-${showSubLabel}`} style={[styles.billDetailRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.billStatusDot, { backgroundColor: statusColor }]} />
        <View style={styles.billDetailInfo}>
          <Text style={[styles.billDetailName, { color: colors.text }]} numberOfLines={1}>{bill.name}</Text>
          <View style={styles.billMetaRow}>
            {showSubLabel ? (
              <Text style={[styles.billSubLabel, { color: colors.textMuted }]}>{showSubLabel}</Text>
            ) : null}
            {bill.dueDate ? (
              <Text style={[styles.billDueText, { color: colors.textMuted }]}>
                Due: {bill.dueDate}{getOrdinalSuffix(bill.dueDate)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.billDetailRight}>
          <Text style={[styles.billDetailAmt, { color: colors.text }]}>
            {formatCurrency(bill.amount)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <Ionicons name={statusIcon} size={10} color={statusColor} />
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {statusText}
            </Text>
          </View>
        </View>
      </View>
    );
  };
```
Replace with:
```ts
  const renderBillItem = (bill: BillItem, showSubLabel?: string, onMarkPaid?: (bill: BillItem) => void) => {
    const statusColor = bill.isPaid ? '#10b981' : bill.status === 'overdue' ? '#ef4444' : bill.status === 'due_today' ? '#3b82f6' : '#f59e0b';
    const statusIcon: keyof typeof Ionicons.glyphMap = bill.isPaid ? 'checkmark-circle' : bill.status === 'overdue' ? 'alert-circle' : bill.status === 'due_today' ? 'today' : 'time';
    const statusText = bill.isPaid ? 'Paid' : bill.status === 'overdue' ? 'Overdue' : bill.status === 'due_today' ? 'Due Today' : 'Pending';

    return (
      <View key={`bill-${bill.id}-${showSubLabel}`} style={[styles.billDetailRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.billStatusDot, { backgroundColor: statusColor }]} />
        <View style={styles.billDetailInfo}>
          <Text style={[styles.billDetailName, { color: colors.text }]} numberOfLines={1}>{bill.name}</Text>
          <View style={styles.billMetaRow}>
            {showSubLabel ? (
              <Text style={[styles.billSubLabel, { color: colors.textMuted }]}>{showSubLabel}</Text>
            ) : null}
            {bill.dueDate ? (
              <Text style={[styles.billDueText, { color: colors.textMuted }]}>
                Due: {bill.dueDate}{getOrdinalSuffix(bill.dueDate)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.billDetailRight}>
          <Text style={[styles.billDetailAmt, { color: colors.text }]}>
            {formatCurrency(bill.amount)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <Ionicons name={statusIcon} size={10} color={statusColor} />
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {statusText}
            </Text>
          </View>
        </View>
        {onMarkPaid && !bill.isPaid && (
          <TouchableOpacity
            onPress={() => onMarkPaid(bill)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginLeft: 8 }}
            data-testid={`button-mark-paid-${bill.id}`}
          >
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
    );
  };
```

- [ ] **Step 2: Decouple `renderAccordionSection` from `billsAccordion` state**

Current code (`mobile/src/screens/DashboardScreen.tsx:400-443`):
```ts
  const renderAccordionSection = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    iconColor: string,
    sectionKey: BillsAccordion,
    items: BillItem[],
    subLabelFn?: (item: BillItem) => string,
  ) => {
    const isOpen = billsAccordion === sectionKey;
    const paidCount = items.filter(b => b.isPaid).length;
    const totalAmount = items.reduce((s, b) => s + b.amount, 0);
    const pendingAmount = items.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0);

    if (items.length === 0) return null;

    return (
      <View key={sectionKey}>
        <TouchableOpacity
          style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
          onPress={() => toggleBillsAccordion(sectionKey)}
          activeOpacity={0.7}
        >
          <View style={[styles.accordionIconWrap, { backgroundColor: iconColor + '15' }]}>
            <Ionicons name={icon} size={16} color={iconColor} />
          </View>
          <View style={styles.accordionTitleArea}>
            <Text style={[styles.accordionTitle, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>
              {paidCount}/{items.length} paid{pendingAmount > 0 ? ` · ${formatCurrency(pendingAmount)} pending` : ''}
            </Text>
          </View>
          <View style={styles.accordionRight}>
            <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(totalAmount)}</Text>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        {isOpen && (
          <View style={styles.accordionContent}>
            {items.map(item => renderBillItem(item, subLabelFn ? subLabelFn(item) : undefined))}
          </View>
        )}
      </View>
    );
  };
```
Replace with:
```ts
  const renderAccordionSection = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    iconColor: string,
    isOpen: boolean,
    onToggle: () => void,
    items: BillItem[],
    subLabelFn?: (item: BillItem) => string,
    onMarkPaid?: (item: BillItem) => void,
  ) => {
    const paidCount = items.filter(b => b.isPaid).length;
    const totalAmount = items.reduce((s, b) => s + b.amount, 0);
    const pendingAmount = items.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0);

    if (items.length === 0) return null;

    return (
      <View>
        <TouchableOpacity
          style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <View style={[styles.accordionIconWrap, { backgroundColor: iconColor + '15' }]}>
            <Ionicons name={icon} size={16} color={iconColor} />
          </View>
          <View style={styles.accordionTitleArea}>
            <Text style={[styles.accordionTitle, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>
              {paidCount}/{items.length} paid{pendingAmount > 0 ? ` · ${formatCurrency(pendingAmount)} pending` : ''}
            </Text>
          </View>
          <View style={styles.accordionRight}>
            <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(totalAmount)}</Text>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        {isOpen && (
          <View style={styles.accordionContent}>
            {items.map(item => renderBillItem(item, subLabelFn ? subLabelFn(item) : undefined, onMarkPaid))}
          </View>
        )}
      </View>
    );
  };
```

- [ ] **Step 3: Update the 4 Bills-tab call sites**

Current code (`mobile/src/screens/DashboardScreen.tsx:988-1007`):
```ts
                      {renderAccordionSection(
                        'Scheduled Payments', 'repeat-outline', '#6366f1', 'scheduled',
                        billsDueDetails?.scheduledPayments || [],
                        (item) => item.frequency === 'monthly' ? 'Monthly' : item.frequency === 'quarterly' ? 'Quarterly' : item.frequency === 'half_yearly' ? 'Half Yearly' : item.frequency === 'yearly' ? 'Yearly' : item.frequency === 'custom' ? 'Custom' : '',
                      )}
                      {renderAccordionSection(
                        'Credit Card Bills', 'card-outline', '#ec4899', 'creditCard',
                        billsDueDetails?.creditCardBills || [],
                        (item) => `${item.bankName || ''}${item.creditLimit ? ` · Limit: ${formatCurrency(item.creditLimit)}` : ''}`.replace(/^[\s·]+/, ''),
                      )}
                      {renderAccordionSection(
                        'Loan EMIs', 'cash-outline', '#f59e0b', 'loans',
                        billsDueDetails?.loans || [],
                        (item) => `${getLoanTypeLabel(item.loanType)}${item.lenderName ? ` · ${item.lenderName}` : ''}`,
                      )}
                      {renderAccordionSection(
                        'Insurance Premiums', 'shield-checkmark-outline', '#8b5cf6', 'insurance',
                        billsDueDetails?.insurance || [],
                        (item) => `${getInsuranceTypeLabel(item.insuranceType)}${item.providerName ? ` · ${item.providerName}` : ''}`,
                      )}
```
Replace with:
```ts
                      {renderAccordionSection(
                        'Scheduled Payments', 'repeat-outline', '#6366f1',
                        billsAccordion === 'scheduled', () => toggleBillsAccordion('scheduled'),
                        billsDueDetails?.scheduledPayments || [],
                        (item) => item.frequency === 'monthly' ? 'Monthly' : item.frequency === 'quarterly' ? 'Quarterly' : item.frequency === 'half_yearly' ? 'Half Yearly' : item.frequency === 'yearly' ? 'Yearly' : item.frequency === 'custom' ? 'Custom' : '',
                      )}
                      {renderAccordionSection(
                        'Credit Card Bills', 'card-outline', '#ec4899',
                        billsAccordion === 'creditCard', () => toggleBillsAccordion('creditCard'),
                        billsDueDetails?.creditCardBills || [],
                        (item) => `${item.bankName || ''}${item.creditLimit ? ` · Limit: ${formatCurrency(item.creditLimit)}` : ''}`.replace(/^[\s·]+/, ''),
                      )}
                      {renderAccordionSection(
                        'Loan EMIs', 'cash-outline', '#f59e0b',
                        billsAccordion === 'loans', () => toggleBillsAccordion('loans'),
                        billsDueDetails?.loans || [],
                        (item) => `${getLoanTypeLabel(item.loanType)}${item.lenderName ? ` · ${item.lenderName}` : ''}`,
                      )}
                      {renderAccordionSection(
                        'Insurance Premiums', 'shield-checkmark-outline', '#8b5cf6',
                        billsAccordion === 'insurance', () => toggleBillsAccordion('insurance'),
                        billsDueDetails?.insurance || [],
                        (item) => `${getInsuranceTypeLabel(item.insuranceType)}${item.providerName ? ` · ${item.providerName}` : ''}`,
                      )}
```
(No `onMarkPaid` argument is passed here — the Bills tab keeps its current read-only behavior. `key={sectionKey}` is gone from the returned element too; it was never load-bearing since these four calls are individual JSX expressions, not the result of an array `.map()`.)

- [ ] **Step 4: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase vs. baseline.

- [ ] **Step 5: Manual verification**

No device/simulator available — verify by code trace: confirm all four Bills-tab call sites now pass exactly 6 positional arguments (title, icon, color, isOpen boolean, onToggle function, items array) plus the existing optional `subLabelFn`, matching the new signature; confirm none of the four passes a 8th `onMarkPaid` argument (Bills tab must stay read-only); confirm `billsAccordion`/`toggleBillsAccordion` (declared earlier in the file, unchanged by this task) are the values being passed, so opening "Scheduled Payments" on the Bills tab still shows/hides exactly that section as it did before this refactor.

- [ ] **Step 6: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "refactor: decouple renderAccordionSection from Bills-tab-only state, add mark-paid hook"
```

---

### Task 4: Mobile — entry point icon swap and modal skeleton

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (type aliases near line 28-31, state block ~line 71, header icon ~lines 783-785, new Modal block inserted after the last existing `</Modal>` ~line 1885)

**Interfaces:**
- Consumes: `colors`, `styles.settingsBtn`, `styles.tab`/`activeTab`/`tabText`/`activeTabText` (all existing), `navigation.navigate('Settings')` (existing).
- Produces (used by Task 5, 6, 7): `showCurrentCyclePlanModal`/`setShowCurrentCyclePlanModal`, `cycleView: 'actual' | 'projected'`/`setCycleView`, `currentCycleAccordion: CurrentCyclePlanAccordion`/`setCurrentCycleAccordion`, `toggleCurrentCycleAccordion(section)`.

- [ ] **Step 1: Add the `CurrentCyclePlanAccordion` type**

Current code (`mobile/src/screens/DashboardScreen.tsx:28-31`):
```ts
type BillsAccordion = 'scheduled' | 'creditCard' | 'loans' | 'insurance' | 'billsInbox' | null;
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings' | 'others' | null;
type OthersDraft = { id: string; name: string; amount: number; type: 'debit' | 'credit' };
type OthersTipModal = { title: string; message: string; onConfirm: () => void };
```
Replace with:
```ts
type BillsAccordion = 'scheduled' | 'creditCard' | 'loans' | 'insurance' | 'billsInbox' | null;
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings' | 'others' | null;
type CurrentCyclePlanAccordion = 'scheduled' | 'creditCard' | 'loans' | 'insurance' | 'others' | null;
type OthersDraft = { id: string; name: string; amount: number; type: 'debit' | 'credit' };
type OthersTipModal = { title: string; message: string; onConfirm: () => void };
```

- [ ] **Step 2: Add new state**

Current code (`mobile/src/screens/DashboardScreen.tsx:70-72`):
```ts
  const [othersTipModal, setOthersTipModal] = useState<OthersTipModal | null>(null);
  const [othersTipDontShowAgain, setOthersTipDontShowAgain] = useState(false);

  useEffect(() => {
```
Replace with:
```ts
  const [othersTipModal, setOthersTipModal] = useState<OthersTipModal | null>(null);
  const [othersTipDontShowAgain, setOthersTipDontShowAgain] = useState(false);
  const [showCurrentCyclePlanModal, setShowCurrentCyclePlanModal] = useState(false);
  const [cycleView, setCycleView] = useState<'actual' | 'projected'>('actual');
  const [currentCycleAccordion, setCurrentCycleAccordion] = useState<CurrentCyclePlanAccordion>(null);

  useEffect(() => {
    if (showCurrentCyclePlanModal) {
      setCycleView('actual');
      setCurrentCycleAccordion(null);
    }
  }, [showCurrentCyclePlanModal]);

  useEffect(() => {
```

- [ ] **Step 3: Add `toggleCurrentCycleAccordion`**

Current code (`mobile/src/screens/DashboardScreen.tsx:228-231`):
```ts
  const toggleForecastAccordion = useCallback((section: ForecastAccordion) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setForecastAccordion(prev => prev === section ? null : section);
  }, []);
```
Replace with:
```ts
  const toggleForecastAccordion = useCallback((section: ForecastAccordion) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setForecastAccordion(prev => prev === section ? null : section);
  }, []);

  const toggleCurrentCycleAccordion = useCallback((section: CurrentCyclePlanAccordion) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCurrentCycleAccordion(prev => prev === section ? null : section);
  }, []);
```

- [ ] **Step 4: Swap the settings gear icon for the new planning icon**

Current code (`mobile/src/screens/DashboardScreen.tsx:783-785`):
```ts
              <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.settingsBtn} data-testid="button-settings">
                <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
```
Replace with:
```ts
              <TouchableOpacity onPress={() => setShowCurrentCyclePlanModal(true)} style={styles.settingsBtn} data-testid="button-plan-current-cycle">
                <Ionicons name="calculator-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
```

- [ ] **Step 5: Add the modal skeleton**

Current code (`mobile/src/screens/DashboardScreen.tsx:1883-1887`, the end of the `showSmsNudgeModal` block and the component's closing tags):
```ts
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
```
Replace with (inserts a new `Modal` between the existing last one and the component's closing `</View>`):
```ts
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showCurrentCyclePlanModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCurrentCyclePlanModal(false)}
      >
        <View style={styles.cyclePlanModalOverlay}>
          <View style={[styles.cyclePlanModalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.cyclePlanModalHeader, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Plan This Cycle</Text>
                <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{summary.monthLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <TouchableOpacity
                  onPress={() => {
                    setShowCurrentCyclePlanModal(false);
                    navigation.navigate('Settings');
                  }}
                  data-testid="button-cycle-plan-settings"
                >
                  <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowCurrentCyclePlanModal(false)} data-testid="button-close-cycle-plan">
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={styles.cyclePlanModalScroll} contentContainerStyle={{ padding: 20 }}>
              <View style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.tab, cycleView === 'actual' && styles.activeTab]}
                  onPress={() => setCycleView('actual')}
                  data-testid="button-cycle-view-actual"
                >
                  <Text style={[styles.tabText, { color: cycleView === 'actual' ? colors.text : colors.textMuted }, cycleView === 'actual' && styles.activeTabText]}>
                    Actual
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tab, cycleView === 'projected' && styles.activeTab]}
                  onPress={() => setCycleView('projected')}
                  data-testid="button-cycle-view-projected"
                >
                  <Text style={[styles.tabText, { color: cycleView === 'projected' ? colors.text : colors.textMuted }, cycleView === 'projected' && styles.activeTabText]}>
                    Projected
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
```
This modal is only reachable once `summary` exists (the icon that opens it, `button-plan-current-cycle`, only renders inside the `accounts.length > 0` branch which itself is only reached after the component's early loading-return) — so `summary.monthLabel` here is always safe to read without an optional-chain guard.

- [ ] **Step 6: Add the three new styles**

In the `StyleSheet.create({...})` block, near the existing `modalOverlay`/`modalContent` styles, add:
```ts
  cyclePlanModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  cyclePlanModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  cyclePlanModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  cyclePlanModalScroll: {
    maxHeight: '100%',
  },
```

- [ ] **Step 7: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase vs. baseline.

- [ ] **Step 8: Manual verification**

No device/simulator available — verify by code trace: confirm `button-plan-current-cycle` is the only remaining `TouchableOpacity` in the main card header row that calls `navigation.navigate('Settings')` directly — it should now call `setShowCurrentCyclePlanModal(true)` instead, and Settings should only be reachable via the new `button-cycle-plan-settings` inside the modal; confirm the `useEffect` resetting `cycleView`/`currentCycleAccordion` depends only on `[showCurrentCyclePlanModal]`, so it fires exactly once per open, not on every render.

- [ ] **Step 9: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: add Plan This Cycle icon and modal skeleton, move Settings into modal"
```

---

### Task 5: Mobile — Actual/Projected stat row and pending accordions

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (new memo block after `effectiveNet`, ~line 291; modal body from Task 4)

**Interfaces:**
- Consumes: `summary.billsDueDetails` (from `DashboardSummary`, unchanged shape plus Task 1/2's new optional fields), `renderAccordionSection`/`renderBillItem` (Task 3), `currentCycleAccordion`/`toggleCurrentCycleAccordion` (Task 4), `styles.forecastSummaryRow`/`forecastSummaryStat`/`forecastStatLabel`/`forecastStatValue`/`forecastStatValueSmall`/`loanDivider`/`subCard`/`emptyState`/`emptyText` (all existing).
- Produces (used by Task 6, 7): `pendingOutflow: number`, `projectedIncome: number`, `projectedOutflow: number` (memoized). Task 7 will extend `projectedIncome`'s formula in place — its shape (a `useMemo` returning a number) does not change.

- [ ] **Step 1: Add the calculation memos**

Current code (`mobile/src/screens/DashboardScreen.tsx:283-292`):
```ts
  const effectiveTotalOutflow = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalOutflow - forecast.totalCreditCardBills - forecast.totalSavings + effectiveCreditCardTotal + effectiveSavingsTotal + othersDebitTotal;
  }, [forecast, effectiveCreditCardTotal, effectiveSavingsTotal, othersDebitTotal]);

  const effectiveNet = useMemo(() => {
    if (!forecast) return 0;
    return effectiveTotalIncome - effectiveTotalOutflow;
  }, [effectiveTotalIncome, effectiveTotalOutflow]);

  useEffect(() => {
    if (!isLoading) return;
```
Replace with:
```ts
  const effectiveTotalOutflow = useMemo(() => {
    if (!forecast) return 0;
    return forecast.totalOutflow - forecast.totalCreditCardBills - forecast.totalSavings + effectiveCreditCardTotal + effectiveSavingsTotal + othersDebitTotal;
  }, [forecast, effectiveCreditCardTotal, effectiveSavingsTotal, othersDebitTotal]);

  const effectiveNet = useMemo(() => {
    if (!forecast) return 0;
    return effectiveTotalIncome - effectiveTotalOutflow;
  }, [effectiveTotalIncome, effectiveTotalOutflow]);

  // Sum of every not-yet-paid item across all four current-cycle bill categories. A
  // saved current-cycle Others debit is a real one-time scheduled payment, so it's
  // already inside billsDueDetails.scheduledPayments and already counted here — it
  // must not be added again in Task 7.
  const pendingOutflow = useMemo(() => {
    if (!summary) return 0;
    const d = summary.billsDueDetails;
    return [...d.scheduledPayments, ...d.creditCardBills, ...d.loans, ...d.insurance]
      .filter(b => !b.isPaid)
      .reduce((sum, b) => sum + b.amount, 0);
  }, [summary]);

  // othersCreditTotal is 0 until Task 7 introduces current-cycle planned income entries —
  // this line is replaced in Task 7 to add that term.
  const projectedIncome = useMemo(() => {
    if (!summary) return 0;
    return summary.totalIncome;
  }, [summary]);

  const projectedOutflow = useMemo(() => {
    if (!summary) return 0;
    return summary.totalSpent + pendingOutflow;
  }, [summary, pendingOutflow]);

  useEffect(() => {
    if (!isLoading) return;
```

- [ ] **Step 2: Render the stat row and pending accordions in the modal**

Current code (from Task 4, inside the new modal's `ScrollView`):
```ts
            <ScrollView style={styles.cyclePlanModalScroll} contentContainerStyle={{ padding: 20 }}>
              <View style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.tab, cycleView === 'actual' && styles.activeTab]}
                  onPress={() => setCycleView('actual')}
                  data-testid="button-cycle-view-actual"
                >
                  <Text style={[styles.tabText, { color: cycleView === 'actual' ? colors.text : colors.textMuted }, cycleView === 'actual' && styles.activeTabText]}>
                    Actual
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tab, cycleView === 'projected' && styles.activeTab]}
                  onPress={() => setCycleView('projected')}
                  data-testid="button-cycle-view-projected"
                >
                  <Text style={[styles.tabText, { color: cycleView === 'projected' ? colors.text : colors.textMuted }, cycleView === 'projected' && styles.activeTabText]}>
                    Projected
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
```
Replace with:
```ts
            <ScrollView style={styles.cyclePlanModalScroll} contentContainerStyle={{ padding: 20 }}>
              <View style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.tab, cycleView === 'actual' && styles.activeTab]}
                  onPress={() => setCycleView('actual')}
                  data-testid="button-cycle-view-actual"
                >
                  <Text style={[styles.tabText, { color: cycleView === 'actual' ? colors.text : colors.textMuted }, cycleView === 'actual' && styles.activeTabText]}>
                    Actual
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tab, cycleView === 'projected' && styles.activeTab]}
                  onPress={() => setCycleView('projected')}
                  data-testid="button-cycle-view-projected"
                >
                  <Text style={[styles.tabText, { color: cycleView === 'projected' ? colors.text : colors.textMuted }, cycleView === 'projected' && styles.activeTabText]}>
                    Projected
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.forecastSummaryRow, { marginTop: 16 }]}>
                <View style={styles.forecastSummaryStat}>
                  <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Income</Text>
                  <Text style={[styles.forecastStatValue, { color: '#10b981' }]}>
                    +{formatCurrency(cycleView === 'actual' ? summary.totalIncome : projectedIncome)}
                  </Text>
                </View>
                <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
                <View style={styles.forecastSummaryStat}>
                  <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Outflow</Text>
                  <Text style={[styles.forecastStatValue, { color: '#ef4444' }]}>
                    -{formatCurrency(cycleView === 'actual' ? summary.totalSpent : projectedOutflow)}
                  </Text>
                </View>
                <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
                <View style={styles.forecastSummaryStat}>
                  <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Balance</Text>
                  <Text style={[styles.forecastStatValueSmall, { color: colors.text }]}>
                    {(() => {
                      const balance = cycleView === 'actual'
                        ? summary.totalIncome - summary.totalSpent
                        : projectedIncome - projectedOutflow;
                      return `${balance >= 0 ? '+' : ''}${formatCurrency(balance)}`;
                    })()}
                  </Text>
                </View>
              </View>

              {cycleView === 'projected' ? (
                <View style={[styles.subCard, { backgroundColor: colors.background, borderColor: colors.border, marginTop: 16 }]}>
                  {renderAccordionSection(
                    'Scheduled Payments', 'repeat-outline', '#6366f1',
                    currentCycleAccordion === 'scheduled', () => toggleCurrentCycleAccordion('scheduled'),
                    (summary.billsDueDetails.scheduledPayments || []).filter(b => !b.isPaid && b.frequency !== 'one_time'),
                  )}
                  {renderAccordionSection(
                    'Credit Card Bills', 'card-outline', '#ec4899',
                    currentCycleAccordion === 'creditCard', () => toggleCurrentCycleAccordion('creditCard'),
                    (summary.billsDueDetails.creditCardBills || []).filter(b => !b.isPaid),
                  )}
                  {renderAccordionSection(
                    'Loan EMIs', 'cash-outline', '#f59e0b',
                    currentCycleAccordion === 'loans', () => toggleCurrentCycleAccordion('loans'),
                    (summary.billsDueDetails.loans || []).filter(b => !b.isPaid),
                  )}
                  {renderAccordionSection(
                    'Insurance Premiums', 'shield-checkmark-outline', '#8b5cf6',
                    currentCycleAccordion === 'insurance', () => toggleCurrentCycleAccordion('insurance'),
                    (summary.billsDueDetails.insurance || []).filter(b => !b.isPaid),
                  )}
                  {pendingOutflow === 0 && (
                    <View style={styles.emptyState}>
                      <Ionicons name="checkmark-circle-outline" size={24} color="#10b981" />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>Nothing pending — you're all caught up</Text>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={[styles.modalExplain, { color: colors.textMuted, marginTop: 16 }]}>
                  Actual reflects only what's already happened this cycle. Switch to Projected to include pending bills.
                </Text>
              )}
            </ScrollView>
```
(One-time scheduled payments are deliberately excluded from the "Scheduled Payments" pending accordion here — Task 7 surfaces them in a dedicated Others section instead, so they must not appear in both places. `pendingOutflow` itself is unaffected by this display-level filter since it already sums the unfiltered list from Task 5 Step 1.)

- [ ] **Step 3: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase vs. baseline.

- [ ] **Step 4: Manual verification**

No device/simulator available — verify by code trace: confirm `pendingOutflow`, `projectedIncome`, `projectedOutflow` are declared as `useMemo` calls above the component's early return (same hooks-ordering requirement noted in Global Constraints); confirm the Balance stat's sign/color logic matches the existing Next Cycle Plan pattern (`effectiveNet >= 0 ? '+' : ''`) rather than always showing a `+`; confirm switching to "Actual" hides all four accordions and the "Nothing pending" empty state (neither should render outside the `cycleView === 'projected'` branch); confirm the one-time-payment exclusion filter (`b.frequency !== 'one_time'`) is present only on the `scheduledPayments` accordion, not on `creditCardBills`/`loans`/`insurance` (those bill types have no `frequency: 'one_time'` concept).

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: add Actual/Projected stat row and pending bill accordions to Current Cycle Plan modal"
```

---

### Task 6: Mobile — inline mark-paid sheet

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (new state, new mutation, new nested modal, wiring into Task 5's four `renderAccordionSection` calls)

**Interfaces:**
- Consumes: `BillItem.occurrenceId`/`installmentId`/`premiumId`/`categoryId` (Task 1/2), `accounts` (existing query, `mobile/src/screens/DashboardScreen.tsx:122-125`), `api.createTransaction`, `api.updatePaymentOccurrence`, `api.markInstallmentPaid`, `api.markPremiumPaid` (all existing, `markPremiumPaid` widened in Task 2).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add mark-paid sheet state and the mutation**

Current code (`mobile/src/screens/DashboardScreen.tsx`, the `updatePlannedIncomeStatusMutation` block, ~lines 177-184):
```ts
  const updatePlannedIncomeStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'received' | 'cancelled' }) =>
      api.updatePlannedIncomeEntry(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
    },
    onSettled: () => setUpdatingPlannedIncomeId(null),
  });

  useFocusEffect(
```
Replace with:
```ts
  const updatePlannedIncomeStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'received' | 'cancelled' }) =>
      api.updatePlannedIncomeEntry(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
    },
    onSettled: () => setUpdatingPlannedIncomeId(null),
  });

  type MarkPaidCategory = 'scheduled' | 'creditCard' | 'loans' | 'insurance';
  const [markPaidTarget, setMarkPaidTarget] = useState<{ item: BillItem; category: MarkPaidCategory } | null>(null);
  const [markPaidAmountInput, setMarkPaidAmountInput] = useState('');

  const openMarkPaidSheet = (item: BillItem, category: MarkPaidCategory) => {
    setMarkPaidTarget({ item, category });
    setMarkPaidAmountInput(String(item.amount));
  };

  const markPaidMutation = useMutation({
    mutationFn: async ({ item, category, amount }: { item: BillItem; category: MarkPaidCategory; amount: string }) => {
      const defaultAccountId = accounts.find(a => a.isDefault)?.id ?? accounts[0]?.id;

      if (category === 'scheduled' || category === 'creditCard') {
        if (!item.occurrenceId) throw new Error('No occurrence found for this cycle yet');
        if (defaultAccountId) {
          await api.createTransaction({
            type: 'debit',
            amount,
            merchant: item.name,
            description: `Scheduled payment: ${item.name}`,
            categoryId: item.categoryId ?? null,
            accountId: defaultAccountId,
            transactionDate: new Date().toISOString(),
            paymentOccurrenceId: item.occurrenceId,
          });
        }
        return api.updatePaymentOccurrence(item.occurrenceId, {
          status: 'paid',
          affectTransaction: true,
          affectAccountBalance: true,
          paidAmount: amount,
        });
      }

      if (category === 'loans') {
        if (!item.installmentId) throw new Error('No installment found for this cycle yet');
        return api.markInstallmentPaid(item.id as number, item.installmentId, {
          paidDate: new Date().toISOString(),
          paidAmount: amount,
          accountId: defaultAccountId,
          createTransaction: true,
          affectBalance: true,
        });
      }

      if (!item.premiumId) throw new Error('No premium found for this cycle yet');
      return api.markPremiumPaid(item.id as number, item.premiumId, {
        amount,
        accountId: defaultAccountId,
        createTransaction: true,
        affectAccountBalance: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      setMarkPaidTarget(null);
    },
  });

  useFocusEffect(
```
(For `loans`, `item.id` is the loan's own id — `loanBills` in `server/routes.ts` sets `id: loan.id`. For `insurance`, `item.id` is the insurance's own id — `insuranceBills` sets `id: ins.id`. Neither needs a separate parent-id lookup.)

- [ ] **Step 2: Wire `onMarkPaid` into the four Task 5 accordion calls**

Current code (from Task 5, the four `renderAccordionSection` calls inside `cycleView === 'projected'`):
```ts
                  {renderAccordionSection(
                    'Scheduled Payments', 'repeat-outline', '#6366f1',
                    currentCycleAccordion === 'scheduled', () => toggleCurrentCycleAccordion('scheduled'),
                    (summary.billsDueDetails.scheduledPayments || []).filter(b => !b.isPaid && b.frequency !== 'one_time'),
                  )}
                  {renderAccordionSection(
                    'Credit Card Bills', 'card-outline', '#ec4899',
                    currentCycleAccordion === 'creditCard', () => toggleCurrentCycleAccordion('creditCard'),
                    (summary.billsDueDetails.creditCardBills || []).filter(b => !b.isPaid),
                  )}
                  {renderAccordionSection(
                    'Loan EMIs', 'cash-outline', '#f59e0b',
                    currentCycleAccordion === 'loans', () => toggleCurrentCycleAccordion('loans'),
                    (summary.billsDueDetails.loans || []).filter(b => !b.isPaid),
                  )}
                  {renderAccordionSection(
                    'Insurance Premiums', 'shield-checkmark-outline', '#8b5cf6',
                    currentCycleAccordion === 'insurance', () => toggleCurrentCycleAccordion('insurance'),
                    (summary.billsDueDetails.insurance || []).filter(b => !b.isPaid),
                  )}
```
Replace with (adds a `subLabelFn` of `undefined` explicitly, then the `onMarkPaid` closure, to each call):
```ts
                  {renderAccordionSection(
                    'Scheduled Payments', 'repeat-outline', '#6366f1',
                    currentCycleAccordion === 'scheduled', () => toggleCurrentCycleAccordion('scheduled'),
                    (summary.billsDueDetails.scheduledPayments || []).filter(b => !b.isPaid && b.frequency !== 'one_time'),
                    undefined,
                    (item) => openMarkPaidSheet(item, 'scheduled'),
                  )}
                  {renderAccordionSection(
                    'Credit Card Bills', 'card-outline', '#ec4899',
                    currentCycleAccordion === 'creditCard', () => toggleCurrentCycleAccordion('creditCard'),
                    (summary.billsDueDetails.creditCardBills || []).filter(b => !b.isPaid),
                    undefined,
                    (item) => openMarkPaidSheet(item, 'creditCard'),
                  )}
                  {renderAccordionSection(
                    'Loan EMIs', 'cash-outline', '#f59e0b',
                    currentCycleAccordion === 'loans', () => toggleCurrentCycleAccordion('loans'),
                    (summary.billsDueDetails.loans || []).filter(b => !b.isPaid),
                    undefined,
                    (item) => openMarkPaidSheet(item, 'loans'),
                  )}
                  {renderAccordionSection(
                    'Insurance Premiums', 'shield-checkmark-outline', '#8b5cf6',
                    currentCycleAccordion === 'insurance', () => toggleCurrentCycleAccordion('insurance'),
                    (summary.billsDueDetails.insurance || []).filter(b => !b.isPaid),
                    undefined,
                    (item) => openMarkPaidSheet(item, 'insurance'),
                  )}
```

- [ ] **Step 3: Add the mark-paid confirm sheet (nested modal)**

Current code (Task 4's modal, the closing of the outer `Modal`):
```ts
          </View>
        </View>
      </Modal>
    </View>
  );
```
Replace with (inserts a second, small modal immediately after the Plan This Cycle modal, before the component's closing tags):
```ts
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!markPaidTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setMarkPaidTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Mark Paid</Text>
              <TouchableOpacity onPress={() => setMarkPaidTarget(null)} data-testid="button-close-mark-paid">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={[styles.infoValue, { color: colors.text }]}>{markPaidTarget?.item.name}</Text>
              <View style={[styles.amountInputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.currencySymbol, { color: colors.primary }]}>₹</Text>
                <TextInput
                  style={[styles.amountInput, { color: colors.text }]}
                  value={markPaidAmountInput}
                  onChangeText={setMarkPaidAmountInput}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  data-testid="input-mark-paid-amount"
                />
              </View>
              <TouchableOpacity
                style={[styles.getStartedButton, { backgroundColor: colors.primary, opacity: markPaidMutation.isPending ? 0.6 : 1 }]}
                disabled={markPaidMutation.isPending}
                onPress={() => {
                  if (!markPaidTarget) return;
                  const parsed = parseFloat(markPaidAmountInput);
                  if (isNaN(parsed) || parsed <= 0) return;
                  markPaidMutation.mutate({ item: markPaidTarget.item, category: markPaidTarget.category, amount: parsed.toString() });
                }}
                activeOpacity={0.8}
                data-testid="button-confirm-mark-paid"
              >
                <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                <Text style={styles.getStartedButtonText}>Confirm Paid</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
```
`styles.amountInputContainer`/`currencySymbol`/`amountInput` do not yet exist in this file (they're defined in `ScheduledPaymentsScreen.tsx`, a different file's stylesheet) — add them in the next step.

- [ ] **Step 4: Add the three missing input styles**

In the `StyleSheet.create({...})` block, near `cyclePlanModalScroll` (added in Task 4), add:
```ts
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    marginBottom: 16,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '600',
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    paddingVertical: 10,
  },
```

- [ ] **Step 5: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase vs. baseline.

- [ ] **Step 6: Manual verification**

No device/simulator available — verify by code trace: confirm `markPaidMutation`'s `mutationFn` branches on `category` and never calls two of the three mark-paid paths for the same item; confirm the `scheduled`/`creditCard` branch creates the transaction **before** calling `updatePaymentOccurrence` (matching the working reference in `ScheduledPaymentsScreen.tsx`'s `markAsPaidMutation`, which does the same ordering — `updatePaymentOccurrence`'s own toggle-handling code only reacts to *changes* in `affectTransaction` relative to the occurrence's prior stored value, it does not create a transaction on a fresh pending→paid transition by itself); confirm every branch throws (not silently no-ops) when its required child id (`occurrenceId`/`installmentId`/`premiumId`) is missing, so a race with another mark-paid action surfaces as a rejected mutation rather than a silent no-op; confirm `onSuccess` invalidates `/api/dashboard-summary` (so the item flips from Projected-pending to Actual on next fetch) and `/api/accounts` (so the balance shown elsewhere on the card updates too).

- [ ] **Step 7: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: add inline mark-paid sheet to Current Cycle Plan modal"
```

---

### Task 7: Mobile — Others section (current-cycle ad-hoc add/edit/delete)

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx` (new query, new state, new mutations, `projectedIncome` memo extension from Task 5, new accordion section in the modal)

**Interfaces:**
- Consumes: `summary.currentMonth`/`currentYear` (Task 1/2), `api.getPlannedIncomeEntries`, `api.createPlannedIncomeEntry`, `api.updatePlannedIncomeEntry`, `api.deletePlannedIncomeEntry`, `api.createScheduledPayment`, `api.updateScheduledPayment`, `api.deleteScheduledPayment` (all existing, unchanged), `PlannedIncomeEntry` type (already imported at the top of this file).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Fetch current-cycle planned income entries**

Current code (`mobile/src/screens/DashboardScreen.tsx:112-115`):
```ts
  const { data: forecast } = useQuery({
    queryKey: ['/api/next-month-forecast'],
    queryFn: api.getNextMonthForecast,
  });
```
Replace with:
```ts
  const { data: forecast } = useQuery({
    queryKey: ['/api/next-month-forecast'],
    queryFn: api.getNextMonthForecast,
  });

  const { data: currentCyclePlannedIncome = [] } = useQuery({
    queryKey: ['/api/planned-income-entries', 'current', summary?.currentMonth, summary?.currentYear],
    queryFn: () => api.getPlannedIncomeEntries(summary!.currentMonth, summary!.currentYear),
    enabled: !!summary && showCurrentCyclePlanModal,
  });
```
(`enabled` is gated on both `summary` — since `currentMonth`/`currentYear` come from it — and `showCurrentCyclePlanModal`, so this query only runs while the modal is actually open, matching the spec's intent to keep the always-on dashboard load light.)

- [ ] **Step 2: Add Others state and the one-time-debit subset**

Current code (from Task 6, immediately after `markPaidMutation`):
```ts
  const markPaidMutation = useMutation({
    /* ...mutationFn from Task 6... */
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      setMarkPaidTarget(null);
    },
  });

  useFocusEffect(
```
Insert between the mutation and `useFocusEffect`:
```ts
  type CurrentCycleOthersEntry =
    | { kind: 'debit'; id: number; name: string; amount: number }
    | { kind: 'credit'; id: number; name: string; amount: number };

  const currentCycleOneTimeDebits = useMemo(() => {
    if (!summary) return [];
    return (summary.billsDueDetails.scheduledPayments || []).filter(b => b.frequency === 'one_time');
  }, [summary]);

  const othersCreditTotal = useMemo(
    () => currentCyclePlannedIncome.reduce((sum, e) => sum + parseFloat(e.amount), 0),
    [currentCyclePlannedIncome]
  );

  const [editingOthersEntry, setEditingOthersEntry] = useState<CurrentCycleOthersEntry | null>(null);
  const [othersCurrentNameInput, setOthersCurrentNameInput] = useState('');
  const [othersCurrentAmountInput, setOthersCurrentAmountInput] = useState('');
  const [addingOthersType, setAddingOthersType] = useState<'debit' | 'credit'>('debit');

  const createOthersEntryMutation = useMutation({
    mutationFn: (entry: { type: 'debit' | 'credit'; name: string; amount: string }) =>
      entry.type === 'credit'
        ? api.createPlannedIncomeEntry({
            name: entry.name,
            amount: entry.amount,
            expectedMonth: summary!.currentMonth,
            expectedYear: summary!.currentYear,
          })
        : api.createScheduledPayment({
            name: entry.name,
            amount: entry.amount,
            frequency: 'one_time',
            startMonth: summary!.currentMonth,
            dueDate: null,
          }),
    onSuccess: (_data, entry) => {
      setOthersCurrentNameInput('');
      setOthersCurrentAmountInput('');
      if (entry.type === 'credit') {
        queryClient.invalidateQueries({ queryKey: ['/api/planned-income-entries', 'current', summary?.currentMonth, summary?.currentYear] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      }
    },
  });

  const updateOthersEntryMutation = useMutation({
    mutationFn: (entry: CurrentCycleOthersEntry) =>
      entry.kind === 'credit'
        ? api.updatePlannedIncomeEntry(entry.id, { name: entry.name, amount: entry.amount.toString() })
        : api.updateScheduledPayment(entry.id, { name: entry.name, amount: entry.amount.toString() }),
    onSuccess: (_data, entry) => {
      setEditingOthersEntry(null);
      if (entry.kind === 'credit') {
        queryClient.invalidateQueries({ queryKey: ['/api/planned-income-entries', 'current', summary?.currentMonth, summary?.currentYear] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      }
    },
  });

  const deleteOthersEntryMutation = useMutation({
    mutationFn: (entry: CurrentCycleOthersEntry) =>
      entry.kind === 'credit' ? api.deletePlannedIncomeEntry(entry.id) : api.deleteScheduledPayment(entry.id),
    onSuccess: (_data, entry) => {
      if (entry.kind === 'credit') {
        queryClient.invalidateQueries({ queryKey: ['/api/planned-income-entries', 'current', summary?.currentMonth, summary?.currentYear] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      }
    },
  });

  useFocusEffect(
```

- [ ] **Step 3: Extend `projectedIncome` to include planned income**

Current code (from Task 5 Step 1):
```ts
  // othersCreditTotal is 0 until Task 7 introduces current-cycle planned income entries —
  // this line is replaced in Task 7 to add that term.
  const projectedIncome = useMemo(() => {
    if (!summary) return 0;
    return summary.totalIncome;
  }, [summary]);
```
Replace with:
```ts
  const projectedIncome = useMemo(() => {
    if (!summary) return 0;
    return summary.totalIncome + othersCreditTotal;
  }, [summary, othersCreditTotal]);
```
(This memo must now be declared *after* `othersCreditTotal`, from Step 2 above — move it if the two end up in the wrong order relative to each other; both must still be above the component's early return.)

- [ ] **Step 4: Add `renderOthersEntryRow`, a shared row renderer for both debit and credit Others entries**

Add this function directly after `openMarkPaidSheet` (Task 6 Step 1) and before `markPaidMutation`, so it's available to the JSX added in Step 5 below:
```ts
  const renderOthersEntryRow = (entry: CurrentCycleOthersEntry, dotColor: string, amountColor: string, amountPrefix: '+' | '-') => {
    const isEditing = editingOthersEntry?.kind === entry.kind && editingOthersEntry.id === entry.id;
    return (
      <View key={`${entry.kind}-${entry.id}`} style={[styles.forecastRow, { borderBottomColor: colors.border }]}>
        {isEditing ? (
          <>
            <TextInput
              style={[styles.othersNameInput, { color: colors.text, borderColor: colors.border }]}
              value={othersCurrentNameInput}
              onChangeText={setOthersCurrentNameInput}
            />
            <TextInput
              style={[styles.othersAmountInput, { color: colors.text, borderColor: colors.border }]}
              value={othersCurrentAmountInput}
              onChangeText={setOthersCurrentAmountInput}
              keyboardType="numeric"
            />
            <TouchableOpacity onPress={() => {
              const parsed = parseFloat(othersCurrentAmountInput);
              const trimmed = othersCurrentNameInput.trim();
              if (!trimmed || isNaN(parsed) || parsed <= 0) return;
              updateOthersEntryMutation.mutate({ ...entry, name: trimmed, amount: parsed });
            }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.forecastDot, { backgroundColor: dotColor }]} />
            <TouchableOpacity style={styles.forecastRowInfo} onPress={() => {
              setEditingOthersEntry(entry);
              setOthersCurrentNameInput(entry.name);
              setOthersCurrentAmountInput(String(entry.amount));
            }}>
              <Text style={[styles.forecastRowName, { color: colors.text }]} numberOfLines={1}>{entry.name}</Text>
            </TouchableOpacity>
            <Text style={[styles.forecastRowAmt, { color: amountColor }]}>{amountPrefix}{formatCurrency(entry.amount)}</Text>
            <TouchableOpacity onPress={() => deleteOthersEntryMutation.mutate(entry)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };
```
This single function renders both debit rows (`dotColor="#0ea5e9"`, `amountColor="#ef4444"`, `amountPrefix="-"`) and credit rows (`dotColor="#10b981"`, `amountColor="#10b981"`, `amountPrefix="+"`) — the two lists differ only in these three display values, not in structure or behavior, so they share one implementation rather than two near-identical copies.

- [ ] **Step 5: Render the Others accordion**

Current code (from Task 6 Step 2, the end of the four bill accordions inside `cycleView === 'projected'`):
```ts
                  {pendingOutflow === 0 && (
                    <View style={styles.emptyState}>
                      <Ionicons name="checkmark-circle-outline" size={24} color="#10b981" />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>Nothing pending — you're all caught up</Text>
                    </View>
                  )}
                </View>
              ) : (
```
Replace with (inserts the Others accordion between the empty state and the closing of the `subCard` `View`):
```ts
                  {pendingOutflow === 0 && (
                    <View style={styles.emptyState}>
                      <Ionicons name="checkmark-circle-outline" size={24} color="#10b981" />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>Nothing pending — you're all caught up</Text>
                    </View>
                  )}

                  <View>
                    <TouchableOpacity
                      style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                      onPress={() => toggleCurrentCycleAccordion('others')}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.accordionIconWrap, { backgroundColor: '#0ea5e9' + '15' }]}>
                        <Ionicons name="receipt-outline" size={16} color="#0ea5e9" />
                      </View>
                      <View style={styles.accordionTitleArea}>
                        <Text style={[styles.accordionTitle, { color: colors.text }]}>Others</Text>
                        <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>
                          {currentCycleOneTimeDebits.length + currentCyclePlannedIncome.length} item{(currentCycleOneTimeDebits.length + currentCyclePlannedIncome.length) === 1 ? '' : 's'}
                        </Text>
                      </View>
                      <Ionicons name={currentCycleAccordion === 'others' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                    {currentCycleAccordion === 'others' && (
                      <View style={styles.accordionContent}>
                        {currentCycleOneTimeDebits.map((d) =>
                          renderOthersEntryRow({ kind: 'debit', id: d.id as number, name: d.name, amount: d.amount }, '#0ea5e9', '#ef4444', '-')
                        )}
                        {currentCyclePlannedIncome.map((e) =>
                          renderOthersEntryRow({ kind: 'credit', id: e.id, name: e.name, amount: parseFloat(e.amount) }, '#10b981', '#10b981', '+')
                        )}

                        <View style={styles.othersAddRow}>
                          <TouchableOpacity
                            onPress={() => setAddingOthersType(prev => prev === 'debit' ? 'credit' : 'debit')}
                            style={{ paddingHorizontal: 4 }}
                          >
                            <Ionicons
                              name={addingOthersType === 'debit' ? 'arrow-down-circle' : 'arrow-up-circle'}
                              size={22}
                              color={addingOthersType === 'debit' ? '#ef4444' : '#10b981'}
                            />
                          </TouchableOpacity>
                          <TextInput
                            style={[styles.othersNameInput, { color: colors.text, borderColor: colors.border }]}
                            value={othersCurrentNameInput}
                            onChangeText={setOthersCurrentNameInput}
                            placeholder="Topic"
                            placeholderTextColor={colors.textMuted}
                          />
                          <TextInput
                            style={[styles.othersAmountInput, { color: colors.text, borderColor: colors.border }]}
                            value={othersCurrentAmountInput}
                            onChangeText={setOthersCurrentAmountInput}
                            placeholder="Amount"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                          />
                          <TouchableOpacity onPress={() => {
                            const trimmed = othersCurrentNameInput.trim();
                            const parsed = parseFloat(othersCurrentAmountInput);
                            if (!trimmed || isNaN(parsed) || parsed <= 0) return;
                            createOthersEntryMutation.mutate({ type: addingOthersType, name: trimmed, amount: parsed.toString() });
                          }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="add-circle" size={22} color={colors.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              ) : (
```
(`styles.othersNameInput`/`othersAmountInput`/`forecastRow`/`forecastDot`/`forecastRowInfo`/`forecastRowName`/`forecastRowAmt`/`othersAddRow` all already exist in this file, added by the earlier Next Cycle Plan Others feature — no new styles needed for this step.)

- [ ] **Step 6: Reset Others editing state when the modal closes**

Current code (Task 4 Step 2's `useEffect`):
```ts
  useEffect(() => {
    if (showCurrentCyclePlanModal) {
      setCycleView('actual');
      setCurrentCycleAccordion(null);
    }
  }, [showCurrentCyclePlanModal]);
```
Replace with:
```ts
  useEffect(() => {
    if (showCurrentCyclePlanModal) {
      setCycleView('actual');
      setCurrentCycleAccordion(null);
    } else {
      setEditingOthersEntry(null);
      setOthersCurrentNameInput('');
      setOthersCurrentAmountInput('');
      setAddingOthersType('debit');
    }
  }, [showCurrentCyclePlanModal]);
```

- [ ] **Step 7: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no increase vs. baseline.

- [ ] **Step 8: Manual verification**

No device/simulator available — verify by code trace: confirm `currentCyclePlannedIncome` query's `enabled` flag prevents it from firing while the modal is closed (check by reading the `enabled` expression, not by running the app); confirm `projectedIncome`'s Step 3 edit is textually after `othersCreditTotal`'s declaration in the file (JS doesn't require this for `useMemo` correctness since both are plain function calls evaluated in render order, but reading top-to-bottom should still make the dependency obvious to a future reader); confirm add/edit for both debit and credit reject an empty trimmed name or non-positive amount identically (mirrors the validation already used by `addOthersDraft`, `mobile/src/screens/DashboardScreen.tsx`, for the Next Cycle Others feature); confirm delete never asks for confirmation (matches this file's existing convention — `removeOthersDraft` also deletes without a confirm dialog) but only ever targets the tapped entry's own `id`+`kind` pair, never affecting the other list; confirm a saved one-time debit entry does **not** appear in the "Scheduled Payments" pending accordion from Task 5 (its `frequency !== 'one_time'` filter excludes it) so it shows exactly once, under Others.

- [ ] **Step 9: Commit**

```bash
cd mobile && git add src/screens/DashboardScreen.tsx
git commit -m "feat: add Others add/edit/delete section to Current Cycle Plan modal"
```

---

## Post-plan check (do this after Task 7, not as its own task)

Re-read the full modal block end-to-end once (Tasks 4-7 combined) and confirm: `showCurrentCyclePlanModal`'s open/close, `cycleView`, `currentCycleAccordion`, `markPaidTarget`, and the Others editing state all reset correctly on close (Task 4 Step 2 + Task 7 Step 6's combined `useEffect`); the Bills tab (Task 3's refactor target) still opens/closes its own four sections independently of the new modal's four sections, since they now use separate state (`billsAccordion` vs. `currentCycleAccordion`) — this was the specific coupling bug this plan's Task 3 exists to avoid.
