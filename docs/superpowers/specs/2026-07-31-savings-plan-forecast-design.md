# Savings Plan row for Next Cycle Plan

TODO.md Section 5.5 (New-Priority:Medium): the Next Cycle Plan card shows Scheduled
Payments, Loan EMIs, and Credit Card Bills — each with a per-item +/− toggle that
excludes it from that cycle's Income/Outflow/Balance totals. Savings goals aren't
represented at all. Add a Savings Plan section using the same mechanism.

## Scope

Only **active** savings goals are shown (`status === 'active'`) — paused, completed,
and inactive goals are omitted entirely, not shown greyed out. Only goals with a
positive `monthlyExpectedAmount` are included; a goal with no monthly plan set has
nothing meaningful to forecast.

## Backend

**`server/routes.ts`, `GET /api/next-month-forecast`**: after the existing insurance
block, build a `savingsItems` array from `storage.getAllSavingsGoals(userId)`:

```
savingsItems = activeGoals
  .filter(g => g.status === 'active' && parseFloat(g.monthlyExpectedAmount || '0') > 0)
  .map(g => ({
    id: g.id,
    name: g.name,
    amount: parseFloat(g.monthlyExpectedAmount),
    dueDate: null,           // savings goals have no day-of-month due date
    subLabel: 'Savings Goal',
    excluded: isExcluded('savings_goal', g.id),
  }))
```

`totalSavings` sums non-excluded items' amounts, and is folded into `totalOutflow`
the same way `totalScheduled`/`totalLoans`/`totalInsurance`/`totalCreditCardBills`
already are — so Balance reflects it with no separate calculation path. The response
gains two fields: `savings: savingsItems` and `totalSavings`.

**`shared/schema.ts`**: extend `insertForecastExclusionSchema`'s `itemType` enum from
`["scheduled_payment", "insurance", "loan", "credit_card_bill"]` to add
`"savings_goal"`. The column is `varchar`, not a Postgres enum type, so this is a
code-only change — no migration. `POST /api/forecast-exclusions/toggle` needs no
changes; it already accepts `itemType`/`itemId` untyped and passes them straight to
`storage.toggleForecastExclusion`.

## Mobile

**`mobile/src/lib/types.ts`**: add `'savings_goal'` to the `ForecastItemType` union;
add `savings: NextMonthForecastItem[]` and `totalSavings: number` to
`NextMonthForecast`.

**`mobile/src/screens/DashboardScreen.tsx`**: add a fifth accordion block to the Next
Cycle Plan sub-card, structurally identical to the existing four (Scheduled Payments,
Insurance, Loan EMIs, Credit Card Bills) — same header/content/total layout, same
`renderForecastRow` helper (already itemType-agnostic, so the +/− toggle and
strikethrough-when-excluded styling work with no changes to that function). Title
"Savings Plan", icon `trending-up-outline`, accent color `#22c55e` (not otherwise used
among the four existing category colors: `#6366f1`, `#8b5cf6`, `#f59e0b`, `#ec4899`).
`renderForecastRow(item, 'savings_goal', '#22c55e', 'fsav')` — since `dueDate` is
`null`, the row's meta text falls back to just `subLabel` ("Savings Goal"), which the
function already handles.

Add `'savings'` to the `ForecastAccordion` union type, and extend the "no outflow
planned" empty-state condition to also check `forecast.savings.length === 0`.

## Out of scope

- No new database table or migration.
- No new API route — reuses the existing generic exclusion toggle endpoint.
- Paused/completed goals are not surfaced here at all (confirmed: active only).
- This does not touch the *current*-cycle "TOTAL | MONTHLY | SAVED" savings display
  (TODO Section 5.1) — that's a separate, already-shipped feature on the dashboard's
  current-cycle card, computed client-side from `/api/savings-goals`. This spec is
  scoped only to the *forecast* (Next Cycle Plan) card.

## Testing

`storage.getAllSavingsGoals` and the exclusion toggle are already exercised
indirectly by existing manual test flows for the other three categories, which use
the identical code path (`isExcluded` / `toggleForecastExclusion`). No new pure logic
is introduced that warrants a standalone unit test — the only new computation is the
`filter` + `map` + `sum` above, which mirrors the existing insurance block line for
line. Verification will be a manual pass on the mobile app: create an active goal
with a monthly amount, confirm it appears in the accordion, confirm the +/− toggle
removes/restores it from the Outflow and Balance totals, confirm a paused goal does
not appear.
