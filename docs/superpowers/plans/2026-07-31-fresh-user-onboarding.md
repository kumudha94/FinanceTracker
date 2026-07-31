# Fresh-User Onboarding Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "Welcome to My Tracker!" Get Started card in place of the account-dependent parts of the Dashboard (salary/accounts-detected banners, net balance, tabs, and the Next Cycle Plan forecast card) whenever the logged-in user has zero accounts, with a single CTA to add their first account.

**Architecture:** Single-file change to `mobile/src/screens/DashboardScreen.tsx`. Add an `accounts` query (a pattern already used identically in other screens, e.g. `ScheduledPaymentsScreen.tsx`). Wrap the existing account-dependent JSX in a conditional so it only renders when `accounts.length > 0`; render a new inline Get Started block in the `else` branch. No new component, no new dependency, no backend change.

**Tech Stack:** React Native, TanStack Query (`useQuery`), React Navigation.

## Global Constraints

- No new npm dependency (no animation library) — spec explicitly rules this out.
- No backend/API changes.
- No changes to any file other than `mobile/src/screens/DashboardScreen.tsx`.
- The existing outer card header ("Welcome back, {username}" + cycle badge + Settings button, lines 404-423) stays visible for zero-account users too — only the content *below* it (banners, balance, tabs) and the separate Next Cycle Plan card are gated.

---

### Task 1: Add accounts query, wire refresh, and render the Get Started card

**Files:**
- Modify: `mobile/src/screens/DashboardScreen.tsx:68-119` (new query + focus/refresh wiring)
- Modify: `mobile/src/screens/DashboardScreen.tsx:423-425` (open conditional)
- Modify: `mobile/src/screens/DashboardScreen.tsx:696-701` (close conditional, add Get Started JSX, gate forecast card)
- Modify: `mobile/src/screens/DashboardScreen.tsx` styles object, after the `salaryBannerSub` style (currently ends at line 1250)

**Interfaces:**
- Consumes: `api.getAccounts(): Promise<Account[]>` (already exists, `mobile/src/lib/api.ts:277`). Consumes the existing `navigation.navigate('AddAccount')` route (already used elsewhere in this exact file, e.g. `FABButton` at line 1109, and in `AccountsScreen.tsx:486`).
- Produces: nothing consumed by other tasks — this is the only task in the plan.

- [ ] **Step 1: Add the accounts query**

In `mobile/src/screens/DashboardScreen.tsx`, find (currently lines 68-71):

```tsx
  const { data: salaryProfile } = useQuery({
    queryKey: ['/api/salary-profile'],
    queryFn: api.getSalaryProfile,
  });
```

Change to:

```tsx
  const { data: salaryProfile } = useQuery({
    queryKey: ['/api/salary-profile'],
    queryFn: api.getSalaryProfile,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });
```

- [ ] **Step 2: Invalidate accounts on screen focus**

Find (currently lines 98-107):

```tsx
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
    }, [queryClient])
  );
```

Change to:

```tsx
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

This is why this step matters: without it, a user who adds their first account and navigates back to the Dashboard would still see the (now stale) zero-accounts Get Started card instead of the normal Dashboard, until some other action happened to refetch `/api/accounts`.

- [ ] **Step 3: Refetch accounts on pull-to-refresh**

Find (currently lines 109-119):

```tsx
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['/api/dashboard-summary'] }),
      queryClient.refetchQueries({ queryKey: ['/api/next-month-forecast'] }),
      queryClient.refetchQueries({ queryKey: ['/api/savings-goals'] }),
      queryClient.refetchQueries({ queryKey: ['/api/institution-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/bill-mappings/pending'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);
```

Change to:

```tsx
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

- [ ] **Step 4: Open the conditional around the account-dependent card content**

Find this exact block — the end of the main card's header, currently lines 422-425 (a closing `</View>`, a blank line, then the salary-profile banner's opening condition):

```tsx
            </View>
          </View>

          {!salaryProfile && (
```

Change to:

```tsx
            </View>
          </View>

          {accounts.length > 0 ? (
          <>
          {!salaryProfile && (
```

(The extra indentation level is intentionally not re-flowed here — fixing indentation on ~270 unchanged lines between this step and Step 5 is out of scope and would make this diff unreviewable. It's cosmetic only; TypeScript/JSX don't care.)

- [ ] **Step 5: Close the conditional and render the Get Started card**

Find this exact block — the end of the tabs sub-card, currently lines 693-701 (closes the `savings` tab conditional, the tab-content wrapper, the sub-card, and the main card, then the comment and opening condition for the Next Cycle Plan card):

```tsx
              )}
            </View>
          </View>
        </View>

        {/* ===== Next Month Plan (Main Card → Sub Card → Tabs) ===== */}
        {forecast && (
```

Change to:

```tsx
              )}
            </View>
          </View>
          </>
          ) : (
            <View style={styles.getStartedContainer}>
              <View style={[styles.getStartedIconWrap, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name="wallet-outline" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.getStartedTitle, { color: colors.text }]}>Welcome to My Tracker!</Text>
              <Text style={[styles.getStartedSubtitle, { color: colors.textMuted }]}>
                Add your first account to start tracking your money.
              </Text>
              <TouchableOpacity
                style={[styles.getStartedButton, { backgroundColor: colors.primary }]}
                onPress={() => navigation.navigate('AddAccount')}
                activeOpacity={0.8}
                data-testid="button-get-started-add-account"
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.getStartedButtonText}>Add Account</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ===== Next Month Plan (Main Card → Sub Card → Tabs) ===== */}
        {accounts.length > 0 && forecast && (
```

Note the last line — the Next Cycle Plan card's own `{forecast && (` condition now also requires `accounts.length > 0`, so it stays hidden for zero-account users the same way the Current Cycle content does.

- [ ] **Step 6: Add the new styles**

Find (currently lines 1247-1250, the end of the `salaryBannerSub` style):

```tsx
  salaryBannerSub: {
    fontSize: 12,
    marginTop: 1,
  },
```

Change to:

```tsx
  salaryBannerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  getStartedContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  getStartedIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  getStartedTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  getStartedSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  getStartedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 6,
  },
  getStartedButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
```

- [ ] **Step 7: Type-check**

Run: `cd /home/kgd122/personal/FinanceTracker/mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `31` (the mobile project's pre-existing baseline error count, unrelated to this change — confirms no new type errors. If the baseline has since changed due to other work, re-establish it on a clean checkout before comparing.)

- [ ] **Step 8: Manual verification**

With the mobile app running (`cd mobile && npx expo start`) against a user account that has zero accounts (or a fresh test user):

1. Open the Dashboard tab. Confirm: the header ("Welcome back, ...", cycle badge, Settings icon) still shows. Below it, instead of the salary banner / net balance / tabs, a centered card shows a wallet icon, "Welcome to My Tracker!", the subtext, and an "Add Account" button. Confirm the Next Cycle Plan card is not shown at all.
2. Tap "Add Account" — confirm it navigates to the Add Account screen.
3. Add an account and navigate back to the Dashboard (or pull-to-refresh if already back). Confirm: the Get Started card is gone, and the normal Dashboard renders (salary banner if `!salaryProfile`, net balance, tabs, and — once forecast data loads — the Next Cycle Plan card).
4. If salary profile is still not configured at this point, confirm the existing "Set up Salary Profile" banner now shows as it always did — this step needs no code changes, just confirms Step 5's gating didn't accidentally suppress it.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/screens/DashboardScreen.tsx
git commit -m "feat: show a Get Started card on the Dashboard for zero-account users"
```
