# Current Cycle Plan modal

TODO context: unlike Next Cycle Plan, the current cycle (the main "Welcome
back" card on Dashboard) is read-only — no way to see a projected end-of-cycle
balance if pending bills get paid, no way to jot down an ad-hoc expense/income
for the rest of the month, and no way to mark a bill paid without leaving the
card. This adds that planning power via a new modal reached from the main
card header, without adding a second card to the Dashboard.

## Scope

Mobile app only (`mobile/src/screens/DashboardScreen.tsx`), plus backend
changes to `server/routes.ts` (`GET /api/dashboard-summary`) needed to expose
occurrence/installment/premium ids for inline mark-paid. No new database
tables — reuses `scheduled_payments` (one-time), `planned_income_entries`,
`payment_occurrences`, loan installments, and insurance premiums exactly as
Next Cycle Plan and the existing bill-paying screens already do.

## Entry point

Replace the settings gear icon (`DashboardScreen.tsx:783-785`) with a new
icon, `calculator-outline` (`colors.primary`), `data-testid="button-plan-current-cycle"`,
that opens `showCurrentCyclePlanModal`. Settings navigation moves into the
new modal's own header as a small `settings-outline` icon (see below) — this
is the only place Settings is reachable from Dashboard once the swap lands.

## Modal structure

New `Modal` block (same slide-up/overlay pattern as the existing
`showCycleInfoModal`/`showNextCycleInfoModal` blocks at
`DashboardScreen.tsx:1643+`).

**Header:** title "Plan This Cycle", subtitle `summary.monthLabel`, a
`settings-outline` icon (→ `navigation.navigate('Settings')`, closing the
modal first) and a close icon.

**Actual / Projected segmented control** below the header — two pill buttons
styled like the existing tab bar (`styles.tab`/`styles.activeTab`). Local
state `const [cycleView, setCycleView] = useState<'actual' | 'projected'>('actual')`,
reset to `'actual'` whenever the modal opens (`useEffect` keyed on
`showCurrentCyclePlanModal`).

**3-stat row** (Income / Outflow / Balance), visually identical to Next Cycle
Plan's (`DashboardScreen.tsx:1117-1134`), values swap based on `cycleView`:

- `actual`: `summary.totalIncome`, `summary.totalSpent`,
  `summary.totalIncome - summary.totalSpent` (all already on hand, zero new
  fetches).
- `projected`: `projectedIncome`, `projectedOutflow`,
  `projectedIncome - projectedOutflow` (see Calculations below).

**Accordion sections**, reusing `renderAccordionSection` +
`renderBillItem` exactly as the Bills tab already does — but each section is
filtered to `isPaid === false` items only (nothing to plan around for
already-paid items), sourced from `summary.billsDueDetails`:

1. Scheduled Payments (pending)
2. Credit Card Bills (pending)
3. Loan EMIs (pending)
4. Insurance Premiums (pending)
5. **Others** — this cycle's ad-hoc plans (below)

Each row in sections 1–4 reuses `renderBillItem`, with one addition: a
trailing checkmark icon that opens the mark-paid sheet (see below). Sections
only render (and only count toward pending totals) when `cycleView ===
'projected'` — in `'actual'` view there is nothing pending to show, so the
modal shows just the Others section and an "Actual reflects only what's
already happened" empty-state note in place of sections 1–4.

## Backend change: expose occurrence/installment/premium ids

`billsDueDetails` items today carry the *parent* record's id (`p.id` for a
scheduled payment, `loan.id`, `ins.id`) — not the id the pay endpoints
actually need (`payment_occurrences.id`, `installments.id`, `premiums.id`).
Confirmed by reading the three pay flows:

- Scheduled payments / CC bills: `PATCH /api/payment-occurrences/:id`
- Loans: `POST /api/loans/:loanId/installments/:id/pay`
- Insurance: `POST /api/insurances/:insuranceId/premiums/:id/pay`

`server/routes.ts`, `GET /api/dashboard-summary` handler: add the resolved
child id to each bill item already being built —

- `scheduledPaymentsBills`/`creditCardBills` (~routes.ts:2661-2674): add
  `occurrenceId: occurrence?.id ?? null` (`null` when no occurrence exists
  yet for this cycle — mark-paid is disabled client-side for that row, same
  as it would be from the Bills screen).
- `loanBills` (~routes.ts:2741-2752): add
  `installmentId: currentInstallment?.id ?? null`.
- `insuranceBills` (~routes.ts:2767-2778): add
  `premiumId: currentPremium?.id ?? null`.

`mobile/src/lib/types.ts`, `BillItem`: add
`occurrenceId?: number | null; installmentId?: number | null; premiumId?: number | null;`.

## Mark-paid sheet

Tapping a pending row's checkmark opens a small confirm sheet (a `Modal`
nested state, not a full screen) — reusing the "quick default" pattern
already established for Others saves: prefilled amount (the bill's `amount`),
account defaulted via the same default-account fallback logic used
elsewhere, `createTransaction`/`affectBalance` both `true` (matching the
normal path on the dedicated screens). One "Confirm Paid" button, one
"Cancel". No account picker or toggle switches in the sheet itself — a user
who needs those goes to the existing dedicated screen (Scheduled Payments /
Loan Details / Insurance Details), unchanged from today.

Submit logic branches on the row's category:

```ts
const markPaidMutation = useMutation({
  mutationFn: (row: MarkPaidTarget) => {
    const today = new Date().toISOString();
    if (row.category === 'scheduled' || row.category === 'creditCard') {
      return api.updatePaymentOccurrence(row.occurrenceId!, {
        status: 'paid', paidAmount: row.amount.toString(),
        affectTransaction: true, affectAccountBalance: true,
      });
    }
    if (row.category === 'loans') {
      return api.payLoanInstallment(row.loanId, row.installmentId!, {
        paidDate: today, paidAmount: row.amount.toString(),
        accountId: defaultAccountId, createTransaction: true, affectBalance: true,
      });
    }
    return api.payInsurancePremium(row.insuranceId, row.premiumId!, {
      paidDate: today, paidAmount: row.amount.toString(),
      accountId: defaultAccountId, createTransaction: true, affectBalance: true,
    });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
    queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    setMarkPaidTarget(null);
  },
});
```

`api.payLoanInstallment` / `api.payInsurancePremium` are thin new wrappers in
`mobile/src/lib/api.ts` around the existing `.../pay` endpoints (mirroring
the shape `updatePaymentOccurrence` already uses) — the endpoints themselves
are unchanged.

On success the item disappears from Projected's pending list (its `isPaid`
flips true on the next `dashboard-summary` fetch) — Actual's totals pick it
up automatically since it's now a real transaction/payment record.

## Others (ad-hoc add/edit/delete, current cycle)

Fetched only while the modal is open — a new query,
`['/api/planned-income-entries', 'current', currentMonth, currentYear]` →
`api.getPlannedIncomeEntries(currentMonth, currentYear)` — kept separate from
the always-on `dashboard-summary` query so the main card's normal load stays
light. `currentMonth`/`currentYear` for this purpose: same
`getCyclePrimaryMonth(cycleStart, cycleEnd)` convention already used
server-side (exposed the same way the next-cycle spec exposed
`nextMonth`/`nextYear` — add `currentMonth`/`currentYear` to the
`dashboard-summary` response).

Unlike Next Cycle's Others (which is draft-then-save, unsaved items are
disposable), Current Cycle's Others entries are **saved immediately on add**
— this cycle is already underway, so there's no "maybe next month" scratch
phase to support, and the approved design calls for real add/edit/delete, not
drafts:

- **Add** debit → `api.createScheduledPayment({ name, amount, frequency:
  'one_time', startMonth: currentMonth, dueDate: null })`. Add credit →
  `api.createPlannedIncomeEntry({ name, amount, expectedMonth: currentMonth,
  expectedYear: currentYear })`.
- **Edit**: tap a saved Others row to edit name/amount inline →
  `api.updateScheduledPayment(id, {...})` or
  `api.updatePlannedIncomeEntry(id, {...})` depending on which list it came
  from.
- **Delete**: `api.deleteScheduledPayment(id)` /
  `api.deletePlannedIncomeEntry(id)`.

All three mutations invalidate `['/api/dashboard-summary']` (debit entries
reappear there automatically — `isPaymentDueThisMonth`'s existing
`'one_time'` case already matches `startMonth === currentMonth`) and the
planned-income-entries query key above (credit entries).

Row rendering reuses the same list-row visual as Next Cycle's Others
(`receipt-outline`, `#0ea5e9`), through a shared small component extracted
from the Next Cycle version if reasonable, or a sibling copy if the current
cycle's saved-immediately model diverges too much to share cleanly (decide
during implementation by how much the two actually have in common once
written).

## Calculations

```ts
const pendingOutflow = useMemo(() => {
  const { billsDueDetails } = summary;
  return [
    ...billsDueDetails.scheduledPayments,
    ...billsDueDetails.creditCardBills,
    ...billsDueDetails.loans,
    ...billsDueDetails.insurance,
  ].filter(b => !b.isPaid).reduce((sum, b) => sum + b.amount, 0);
}, [summary]);

const othersDebitTotal = useMemo(
  () => currentCycleOneTimeDebits.reduce((sum, d) => sum + d.amount, 0),
  [currentCycleOneTimeDebits]
);
const othersCreditTotal = useMemo(
  () => plannedIncomeEntries.reduce((sum, e) => sum + parseFloat(e.amount), 0),
  [plannedIncomeEntries]
);

const projectedIncome = summary.totalIncome + othersCreditTotal;
const projectedOutflow = summary.totalSpent + pendingOutflow; // othersDebitTotal already inside pendingOutflow via billsDueDetails.scheduledPayments
```

Note: a saved Others debit is a real one-time `scheduledPayments` row, so it
already flows into `billsDueDetails.scheduledPayments` and therefore into
`pendingOutflow` — it does **not** need to be added a second time. This
mirrors how Next Cycle's saved Others entries stopped needing their own
`othersTotal` term once saved (see
`2026-08-02-next-cycle-others-quick-add-design.md`, "Saving an entry").
Before it's saved there's nothing to add either, since this feature has no
unsaved-draft state. `othersCreditTotal` (planned income) has no such
counterpart in `dashboard-summary` and does need its own term.

## Out of scope

- No what-if amount override on pending items (Projected uses real due
  amounts as-is).
- No account picker / transaction-toggle options in the inline mark-paid
  sheet — that stays on the dedicated screens.
- No new database tables or migrations.
- Real (already-happened, SMS-missed) transaction quick-add is not part of
  this modal — unchanged, use the existing Add Transaction flow.
- Shared list-row extraction between Next Cycle's Others and this feature's
  Others is opportunistic, not required — a sibling copy is an acceptable
  outcome if sharing turns out awkward.

## Testing

No automated test suite exists for this app. Verification is `cd mobile &&
npx tsc --noEmit` plus `npm run check` (server) against the current
baseline, and manual verification on a device: open the modal from the new
icon, confirm Settings is still reachable from inside it; toggle
Actual/Projected and confirm the stat row and pending accordions
match `billsDueDetails`; mark a pending scheduled payment, CC bill, loan EMI,
and insurance premium paid from the sheet and confirm each moves out of
Projected and into Actual after refetch, and that the underlying dedicated
screens (Scheduled Payments, Loan Details, Insurance Details) show the same
paid state; add, edit, and delete an Others debit and credit entry and
confirm the stat row updates immediately after each and the debit entry
shows up correctly under Scheduled Payments elsewhere in the app; confirm
none of this touches Next Cycle Plan's own totals or Others drafts.
