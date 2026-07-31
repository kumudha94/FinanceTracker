# Fresh-user "Get Started" card

TODO.md Section 8, item 3 (New-Priority:Low): a brand-new user landing on the
Dashboard sees the Current Cycle and Next Cycle Plan cards, which are meaningless
with no accounts and no transaction history — confusing for a first-time user who
doesn't yet know they need to create an account and set up a salary profile.

## Trigger

`accounts.length === 0`, where `accounts` comes from a new `useQuery` in
`DashboardScreen.tsx` (`queryKey: ['/api/accounts']`, `queryFn: api.getAccounts`),
matching the pattern already used for this same query in other screens (e.g.
`ScheduledPaymentsScreen.tsx`). `DashboardScreen.tsx` does not currently fetch
accounts at all.

## Scope

Only the Current Cycle card and Next Cycle Plan card are replaced. Every other
Dashboard element renders unchanged — critically, the existing "Set up Salary
Profile" banner (`DashboardScreen.tsx:425-443`, shown whenever `!salaryProfile`)
already handles the second half of the TODO's ask ("then they need to set Salary
setup") independently of accounts. Once the user adds their first account via this
new card, the normal Dashboard (including that existing salary banner, if still
unconfigured) takes over with no additional work needed here.

## Content and visual treatment

A single static card, matching the container weight (`styles.mainCard`) of the two
cards it replaces:

- An icon in a colored circle, following the same `iconWrap` visual pattern already
  used throughout the Dashboard (e.g. the salary banner's icon, accordion icons in
  the forecast card) — an Ionicons glyph, no custom illustration.
- Headline: "Welcome to My Tracker!"
- One line of subtext: "Add your first account to start tracking your money."
- One primary button, "+ Add Account", navigating to the existing `AddAccount`
  screen (the same route already used by the Accounts tab's FAB).

No animation library is added — none exists in this project today
(`mobile/package.json` has no Lottie/Reanimated-based animation dependency), and
adding one is out of proportion for a Low-priority onboarding nicety. No backend
changes; this is a client-side-only, single-file change to `DashboardScreen.tsx`.

## Out of scope

- No changes to the existing salary-profile banner logic.
- No dismiss/skip mechanism — the card simply stops rendering once `accounts.length
  > 0`, so there's nothing to persist or dismiss.
- No changes to any other screen (Accounts, Salary, etc.).

## Testing

No new pure logic is introduced — this is conditional JSX rendering plus one new
data query, mirroring patterns already used elsewhere in this exact file. No
automated test is warranted; verification is manual: log in as (or create) a user
with zero accounts, confirm the Get Started card appears in place of the two cycle
cards, tap "+ Add Account", confirm navigation to the Add Account screen, add an
account, confirm the card disappears and the normal Dashboard (Current Cycle / Next
Cycle Plan cards) renders on next load.
