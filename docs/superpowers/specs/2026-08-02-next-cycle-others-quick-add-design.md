# Next Cycle Plan — "Others" ad-hoc quick-add section

TODO.md Section 8.5: when planning finance, the user ends up doing math on a
calculator or notepad outside the app. Idea: inside the Next Cycle Plan card,
alongside Scheduled Payments / Credit Card Bills / etc., add an **Others**
section where ad-hoc spending entries (topic + amount) can be jotted down. A
save icon persists an entry for future reference; unsaved entries are
disposable.

Confirmed design direction (via discussion): each entry counts toward the
card's live totals the moment it's added — that's the actual point, doing
the math without leaving the app — and "save" is a separate, optional action
that turns one entry into a real record. Unlike the what-if scratchpad
(`2026-08-01-next-cycle-whatif-amount-edit-design.md`), which edits existing
forecast amounts, this adds brand new ones.

## Scope

Mobile app only (`mobile/src/screens/DashboardScreen.tsx`), plus two small,
necessary backend changes (below) — this is not a pure-client feature like
the what-if scratchpad, because a *saved* entry must become a real
scheduled payment, and doing that correctly requires information the
forecast endpoint doesn't currently expose.

## Backend changes

**1. `server/routes.ts`, `GET /api/next-month-forecast`:** add `nextMonth`
and `nextYear` to the JSON response. Both values are already computed
earlier in the handler (`const { month: nextMonth, year: nextYear } =
getCyclePrimaryMonth(...)`) — this just exposes them so the mobile client
can set a new payment's `startMonth` to the cycle it was actually created
from, without re-deriving "next cycle" client-side or parsing the
human-formatted `monthLabel` string.

**2. `server/routes.ts`, `isPaymentDueNextMonth`'s `case 'one_time':`**
fix the year comparison from `nextYear >= createdYear` to `nextYear ===
createdYear`. Today a one-time payment created for August 2026 matches
`isPaymentDueNextMonth` again every August from 2027 onward — nothing
about "one_time" ever stops it recurring in this specific forecast check.
This is a pre-existing bug affecting any one-time scheduled payment (not
new ad-hoc entries specifically), but this feature is what will start
creating one-time payments routinely, so it needs to be correct here.
Confirmed in scope to fix as part of this work.

## Mobile type fix

**`mobile/src/lib/types.ts`, `InsertScheduledPayment`:** `dueDate` is
currently typed as required (`dueDate: number`), which doesn't match the
server's Zod schema (optional/nullable) and would force a fabricated value
for ad-hoc entries, which have no specific day-of-month. Change to
`dueDate?: number | null`. Also add `nextMonth: number; nextYear: number;`
to the `NextMonthForecast` interface for the two new response fields.

## Client state

New local state in `DashboardScreen`, alongside the existing
`whatIfAmounts` cluster:

```ts
type OthersDraft = { id: string; name: string; amount: number };
const [othersDrafts, setOthersDrafts] = useState<OthersDraft[]>([]);
const [othersNameInput, setOthersNameInput] = useState('');
const [othersAmountInput, setOthersAmountInput] = useState('');
```

`id` is a client-only key (`` `${Date.now()}-${Math.random()}` ``), never
sent to the server — it exists purely so a draft can be located for removal
or the save mutation, and never appears in any API payload.

Add `'others'` to the `ForecastAccordion` union type (alongside
`'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings'`).

## Section rendering

A sixth section in the Next Cycle Plan sub-card, after Savings Plan.
Unlike every other section, it does **not** conditionally render on
`forecast.X.length > 0` — it starts empty by definition (nothing comes
from the server) and must always be visible so the feature is
discoverable, sitting after the existing "No outflow planned for {month}"
empty-state block (that block's condition is unchanged — it's fine for it
to show alongside an empty, always-present Others section).

Header: title "Others", icon `receipt-outline`, accent color `#0ea5e9`
(sky blue — the one hue not already used among the five existing sections:
`#6366f1`, `#8b5cf6`, `#f59e0b`, `#ec4899`, `#22c55e`). Subtitle: `{n} item{s}`
(or "Tap to add" when `othersDrafts.length === 0`). Header total: sum of
`othersDrafts` amounts, styled like every other section's total
(`-{formatCurrency(othersTotal)}`, `#ef4444`).

Expanded content: each draft renders as a row (name, amount, a save icon,
and a `(-)` remove-circle icon reusing `Ionicons "remove-circle"` at the
same size/color/hitSlop as the existing include/exclude toggle elsewhere in
this file, for visual consistency — the handler differs, see below). Draft
rows use their own new markup (a small dedicated render function, e.g.
`renderOthersDraftRow`), not the shared `renderForecastRow` — that function
is typed around `NextMonthForecastItem` (server-shaped forecast items with
`dueDate`/`subLabel`/`excluded`), which a client-only `OthersDraft` doesn't
have and shouldn't be forced into. Only *after* a draft is saved and
reappears from the server as a real Scheduled Payments row does it go
through `renderForecastRow` like everything else. Below
the draft rows, an always-present inline add row: two small `TextInput`s
(name, amount — `keyboardType="numeric"` on the amount field) plus a
confirm (`add-circle`) icon. A `forecastTabTotal` footer row matches the
other sections' "Total" style.

## Adding an entry

Confirming the add row (tapping the confirm icon) requires a non-empty
trimmed name and a valid positive amount (`parseFloat` succeeds and result
`> 0`) — if invalid, nothing happens (no alert; this mirrors the
what-if edit's silent-discard-on-invalid-input behavior). On success:
append `{ id: <generated>, name: <trimmed input>, amount: <parsed> }` to
`othersDrafts`, then clear both input fields (ready to add the next entry
immediately — the TODO's own example adds several ad-hoc lines in one
sitting).

## Removing an unsaved entry

The `(-)` icon on a draft row calls a local `removeOthersDraft(id)` that
filters that id out of `othersDrafts` — purely client state, no API call
(there is nothing on the server to exclude; the draft never existed there).

## Saving an entry

A new mutation:

```ts
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
```

Tapping a draft row's save icon calls `saveOthersDraftMutation.mutate(draft)`.
No `onError` handler — this matches the existing convention in this file
(`toggleExclusionMutation`, `dismissBillMappingMutation` also have no
explicit error handling); a failed save simply leaves the draft in the list
so the user can retry.

`accountId` is intentionally omitted from the payload — the server schema
allows it to be null, and `storage.getDefaultAccount()` (already used
elsewhere for exactly this case) is the fallback.

Once saved, the entry disappears from the Others list (it's no longer a
draft) and — after the forecast query refetches — reappears as a normal row
under **Scheduled Payments**, since it's now a genuine one-time scheduled
payment. It automatically gets the standard include/exclude `(-)/(+)`
toggle there for free, since that section already renders through the
shared `renderForecastRow`. No further UI work is needed for a saved
entry's lifecycle — from this point on it's indistinguishable from any
other one-time scheduled payment (removable only via the Scheduled Payments
screen, same as any other payment).

## Live calculation

```ts
const othersTotal = useMemo(
  () => othersDrafts.reduce((sum, d) => sum + d.amount, 0),
  [othersDrafts]
);
```

`effectiveTotalOutflow` (from the what-if plan) gains `othersTotal` as an
additive term — Others has no server-side counterpart to subtract, unlike
Credit Card Bills/Savings:

```ts
const effectiveTotalOutflow = useMemo(() => {
  if (!forecast) return 0;
  return forecast.totalOutflow - forecast.totalCreditCardBills - forecast.totalSavings
    + effectiveCreditCardTotal + effectiveSavingsTotal + othersTotal;
}, [forecast, effectiveCreditCardTotal, effectiveSavingsTotal, othersTotal]);
```

`effectiveNet` needs no change to its own formula — it already derives from
`effectiveTotalOutflow`, so it picks up `othersTotal`'s contribution
automatically once the above change lands.

## Reset behavior

`othersDrafts` resets to `[]` on the same two triggers the what-if
scratchpad already resets on — `useFocusEffect`'s callback and `onRefresh`
— called alongside (not merged into) `clearWhatIf()`, since these are two
independent ephemeral-state clusters with the same lifecycle but different
purposes:

```ts
useFocusEffect(useCallback(() => {
  clearWhatIf();
  setOthersDrafts([]);
  ...
}, [queryClient]));

const onRefresh = useCallback(async () => {
  clearWhatIf();
  setOthersDrafts([]);
  ...
}, [queryClient]);
```

A draft mid-save (mutation in flight) that gets wiped by a reset is an
accepted edge case — identical in spirit to the what-if scratchpad's
existing "reset while editing" behavior, not a new risk class introduced
here.

## Out of scope

- No new database table or migration — reuses `scheduled_payments` as-is.
- No new API route for creating the payment — reuses the existing
  `POST /api/scheduled-payments`.
- Saved entries are not specially tagged as "came from Others" anywhere —
  once saved, a payment is just a normal one-time scheduled payment, no
  different from one created via the full Add Scheduled Payment form.
- No batch/multi-select save or delete — each draft is saved or removed
  individually.
- No editing a draft's name/amount in place — remove and re-add.

## Testing

No automated test suite exists for this app (established in the what-if
plan). Verification is `cd mobile && npx tsc --noEmit` against the current
baseline, plus manual verification once run on a device: add several
Others entries and confirm the section total and card Outflow/Balance
update live; remove one via `(-)` and confirm it disappears with no server
call; save one and confirm it vanishes from Others and (after a refetch)
appears under Scheduled Payments with a working include/exclude toggle;
confirm a one-time payment created this way does *not* reappear in next
year's forecast for the same month (validates the `nextYear === createdYear`
fix); confirm pull-to-refresh and leaving/returning to the Dashboard clear
any unsaved drafts.
