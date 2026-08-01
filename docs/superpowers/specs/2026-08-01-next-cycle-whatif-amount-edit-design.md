# Next Cycle Plan — inline what-if amount edit

TODO.md Section 5.7 (New Priority:High1): "Next Cycle Plan-> Credit card bills and
Savings Plan allow user to click and edit the amount for each row." Confirmed intent
(via discussion): this is a **temporary "what-if" scratchpad**, not a way to correct
or persist data. Example given: current tracked credit card bill is ₹2,000 — user
wants to type ₹5,000 to see what Balance would look like *if* they spent that much,
then move on. Nothing is saved.

## Scope

Only the **Credit Card Bills** and **Savings Plan** accordion sections of the Next
Cycle Plan card (`mobile/src/screens/DashboardScreen.tsx`). Scheduled Payments, Loan
EMIs, and Insurance rows are untouched — those are less prone to estimate drift and
weren't requested.

Purely client-side, mobile app only. No new API route, no new database table, no
change to `server/routes.ts` or `shared/schema.ts`. This is deliberately simpler than
the existing `forecast_exclusions` per-cycle-persisted pattern — that table exists
because include/exclude is a real decision the user wants remembered; a what-if amount
is disposable by definition.

## State

New local state in `DashboardScreen`:

```ts
const [whatIfAmounts, setWhatIfAmounts] = useState<Record<string, number>>({});
```

Keyed the same way exclusions are keyed elsewhere in this file: `` `${itemType}:${itemId}` ``
(e.g. `credit_card_bill:cc-auto-16`, `savings_goal:42`).

Cleared (`setWhatIfAmounts({})`) whenever the forecast data is refetched — i.e. inside
`onRefresh` (pull-to-refresh) and the `useFocusEffect` invalidation block already
present for `/api/next-month-forecast`. Refresh is treated as "start over": the what-if
is a scratchpad for the currently-loaded numbers, not something layered on top of new
data.

## Interaction

In `renderForecastRow` (currently itemType-agnostic and shared by all five sections):

- New optional `editable?: boolean` param, passed `true` only from the two call sites
  for Credit Card Bills and Savings Plan rows.
- When `editable && !item.excluded`: tapping the amount `<Text>` swaps it for a
  `TextInput` (`keyboardType="numeric"`, auto-focused, pre-filled with the current
  effective amount — see Calculation below). On blur/submit: parse the input; if it's
  a valid non-negative number and differs from the real `item.amount`, store it in
  `whatIfAmounts`; otherwise clear that key (typing the real value back, or leaving it
  blank/invalid, removes the override rather than setting `0`).
- When `item.excluded`: amount is not tappable (same as today — excluded rows already
  render dimmed/struck-through and aren't part of any total, so there's nothing
  meaningful to what-if). Re-including a row via the existing +/− toggle always shows
  the real amount, never a stale what-if from before it was excluded.
- A row with an active override renders its amount in a distinct style (existing
  `colors.primary` accent, matching the app's other "modified" affordances) plus a
  small inline reset icon (`refresh-outline` or similar, reusing the existing
  `forecastToggleBtn` hit-slop pattern) that clears just that row's entry from
  `whatIfAmounts`.

## Calculation

```ts
const effectiveAmount = (itemType: ForecastItemType, item: NextMonthForecastItem) =>
  whatIfAmounts[`${itemType}:${item.id}`] ?? item.amount;
```

- Section subtotal (the `forecastTabTotalValue` / `accordionTotal` shown for the
  Credit Card Bills and Savings Plan accordions) is computed client-side from
  `forecast.creditCardBills` / `forecast.savings` using `effectiveAmount` over
  non-excluded items, instead of reading `forecast.totalCreditCardBills` /
  `forecast.totalSavings` directly.
- The card-level Income/Outflow/Balance stat row (`forecastSummaryRow`) recomputes
  `totalOutflow` and `net` client-side the same way: take the API's `totalOutflow`,
  subtract the real (API) subtotal for Credit Card Bills and Savings, add back the
  what-if-adjusted subtotal for those two sections. `totalIncome` is never affected
  (salary isn't editable here).
- All five sections' *individual rows* still render via the one shared
  `renderForecastRow`; only Credit Card Bills and Savings Plan pass `editable`, so
  `effectiveAmount` for the other three simply always returns `item.amount`.

## Reset-all affordance

Whenever `whatIfAmounts` is non-empty, a small banner/chip appears on the Next Cycle
Plan card header (e.g. "Viewing a what-if · Reset") with a single tap that clears the
whole `whatIfAmounts` map, snapping every total back to real data. This is in addition
to (not a replacement for) the per-row reset icon.

## Out of scope

- No persistence of any kind — a what-if never survives a refresh, a screen
  unmount/remount, or app restart.
- Scheduled Payments, Loan EMIs, and Insurance rows are not editable.
- No change to `forecast_exclusions` or the +/− include/exclude toggle — the two
  features are independent and compose (excluded rows just aren't editable).
- No validation beyond "non-negative number" — this is a scratchpad, not a form.

## Testing

No new backend logic, so no server-side test. Manual verification on the mobile app:
tap a Credit Card Bills amount, type a different value, confirm the section subtotal
and the card's Outflow/Balance stats update immediately; confirm the row shows the
reset icon and the "what-if" banner appears; tap reset and confirm everything reverts;
repeat for Savings Plan; confirm an excluded row's amount is not tappable; confirm
pull-to-refresh clears any active what-if.
