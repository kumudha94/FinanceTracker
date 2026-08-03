# Merchant category bulk-update on transaction edit

TODO.md Section 10 #1: "If I update Category check the DB if the same
merchant is available more than once, show the list to the user once
confirmed update category for all the transaction from that merchant."
Reference screenshot: after saving an edited transaction, a full-screen
modal appears — green "Transaction is updated successfully!" header, text
asking to select other similar transactions to also update, a
"DE-SELECT ALL" toggle, a checklist of matching transactions (name, date,
amount, account), and NO / YES buttons.

Confirmed via discussion:

- Trigger scope: **edit only**, not create — matches the TODO wording and
  the screenshot (the modal only makes sense once a category has actually
  *changed* on an existing record).
- Matching field: **`merchant` only**, exact (trimmed, case-insensitive).
  No fallback to `description` — transactions with no merchant set are
  simply never matched. Keeps the feature predictable; avoids false
  positives from free-text descriptions.
- Type scope: candidates must share the same `type` (`debit`/`credit`/
  `transfer`) as the transaction being edited. A merchant name coincidence
  across a debit and a credit isn't a real match.

Assumed defaults (low-risk, not asked as separate questions): no cap on
match-list length, no account restriction (matches across all accounts for
the user), list sorted by `transactionDate` descending.

## Scope

Both mobile (`mobile/src/screens/AddTransactionScreen.tsx`) and backend
(`server/routes.ts`, `server/storage.ts`) — a bulk update needs a
dedicated, user-scoped endpoint rather than N individual PATCH calls from
the client.

## Backend changes

**1. `server/storage.ts`:** add `bulkUpdateTransactionCategory`:

```ts
async bulkUpdateTransactionCategory(
  userId: number,
  transactionIds: number[],
  categoryId: number
): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const result = await db.update(transactions)
    .set({ categoryId })
    .where(and(
      eq(transactions.userId, userId),
      inArray(transactions.id, transactionIds)
    ))
    .returning({ id: transactions.id });
  return result.length;
}
```

Scoping the `WHERE` on `userId` (not just the id list) means a crafted
request naming another user's transaction ids silently updates zero rows
for those ids rather than erroring or leaking cross-user writes.

**2. `server/routes.ts`:** new route, placed next to the existing
`PATCH /api/transactions/:id`:

```ts
app.patch("/api/transactions/bulk-category", authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const schema = z.object({
      transactionIds: z.array(z.number().int()).min(1),
      categoryId: z.number().int(),
    });
    const { transactionIds, categoryId } = schema.parse(req.body);
    const updatedCount = await storage.bulkUpdateTransactionCategory(userId, transactionIds, categoryId);
    res.json({ updatedCount });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Invalid request" });
  }
});
```

Must be registered **before** `PATCH /api/transactions/:id` if Express
route ordering could otherwise let `:id` greedily match the literal path
segment `bulk-category` — confirm ordering when implementing (Express
matches path literals fine regardless of param routes typically, but this
repo should double check for `id = parseInt("bulk-category")` producing
`NaN` and a confusing 404 rather than silently misrouting).

## Mobile API client

**`mobile/src/lib/api.ts`:** add

```ts
bulkUpdateTransactionCategory: (transactionIds: number[], categoryId: number) =>
  apiRequest<{ updatedCount: number }>('/api/transactions/bulk-category', {
    method: 'PATCH',
    body: JSON.stringify({ transactionIds, categoryId }),
  }),
```

## Client state (`AddTransactionScreen.tsx`)

```ts
const [merchantMatches, setMerchantMatches] = useState<Transaction[]>([]);
const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());
const [showMerchantMatchModal, setShowMerchantMatchModal] = useState(false);
```

`originalCategoryId` is captured once when the edit-mode load effect runs
(alongside the existing `setSelectedCategoryId(transaction.categoryId ||
null)` at line 78), so the save handler can tell whether the category
actually changed:

```ts
const [originalCategoryId, setOriginalCategoryId] = useState<number | null>(null);
// in the edit-mode load effect:
setOriginalCategoryId(transaction.categoryId || null);
```

## Detection, on save success

`updateMutation`'s `onSuccess` changes from unconditionally calling
`navigation.goBack()` + `Toast.show(...)` to first checking whether a
merchant-match modal is warranted:

```ts
const updateMutation = useMutation({
  mutationFn: ({ id, data }: { id: number; data: any }) => api.updateTransaction(id, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
    queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });

    const merchantChanged = merchant.trim().length > 0;
    const categoryChanged = selectedCategoryId !== originalCategoryId;

    if (merchantChanged && categoryChanged && selectedCategoryId && transactions) {
      const normalizedMerchant = merchant.trim().toLowerCase();
      const matches = transactions
        .filter((t: Transaction) =>
          t.id !== transactionId &&
          t.type === type &&
          t.categoryId !== selectedCategoryId &&
          (t.merchant || '').trim().toLowerCase() === normalizedMerchant
        )
        .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

      if (matches.length > 0) {
        setMerchantMatches(matches);
        setSelectedMatchIds(new Set(matches.map(m => m.id)));
        setShowMerchantMatchModal(true);
        return; // hold off on navigating back / toast until the modal resolves
      }
    }

    navigation.goBack();
    Toast.show({
      type: 'success',
      text1: 'Transaction Updated',
      text2: 'Transaction has been updated successfully',
      position: 'bottom',
    });
  },
  onError: () => { /* unchanged */ },
});
```

`transactions` here is the same query already loaded for edit mode
(`useQuery(['/api/transactions'], api.getTransactions, { enabled:
isEditMode })`) — no new fetch needed for detection.

## Bulk-apply mutation

```ts
const bulkCategoryMutation = useMutation({
  mutationFn: ({ ids, categoryId }: { ids: number[]; categoryId: number }) =>
    api.bulkUpdateTransactionCategory(ids, categoryId),
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
    setShowMerchantMatchModal(false);
    navigation.goBack();
    Toast.show({
      type: 'success',
      text1: 'Transaction Updated',
      text2: 'Transaction has been updated successfully',
      position: 'bottom',
    });
  },
});
```

`onSettled` (not `onSuccess`) so the same close/navigate/toast sequence
runs whether the bulk call succeeds or fails — a failed bulk update still
leaves the original single-transaction edit intact (already saved before
the modal ever opened), so there's nothing to roll back and no reason to
block navigation on it.

## Modal UI

A `Modal` added inline in `AddTransactionScreen.tsx`, following the same
pattern as the file's existing category/account/date picker modals.
Rendered only when `showMerchantMatchModal` is true.

- Header: green (`#10b981` or existing `colors.success`-equivalent used
  elsewhere in the app) text "Transaction is updated successfully!"
- Subtext: `Select other transactions from "${merchant}" you'd like to
  update to ${categoryName}` — `categoryName` looked up from
  `categories` by `selectedCategoryId`.
- Toggle link, label flips between "DE-SELECT ALL" and "SELECT ALL"
  depending on whether `selectedMatchIds.size === merchantMatches.length`:
  ```ts
  onPress={() => setSelectedMatchIds(
    selectedMatchIds.size === merchantMatches.length ? new Set() : new Set(merchantMatches.map(m => m.id))
  )}
  ```
- List: `merchantMatches.map(...)`, each row a checkbox (checked state
  from `selectedMatchIds.has(m.id)`, toggling adds/removes `m.id` from the
  set) plus merchant name, date via the existing `formatDate` helper
  (`mobile/src/lib/utils.ts`), amount via the existing `formatCurrency`
  helper, and an account label (`m.account?.name`, falling back to last 4
  of `m.account?.accountNumber` if `name` is empty).
- Footer buttons: **NO** (outlined) → `setShowMerchantMatchModal(false);
  navigation.goBack(); Toast.show(...)` (same success toast as the
  no-match path, since the original edit already succeeded); **YES**
  (filled, primary color) → `bulkCategoryMutation.mutate({ ids:
  Array.from(selectedMatchIds), categoryId: selectedCategoryId! })`. If
  `selectedMatchIds.size === 0` when YES is tapped, behave identically to
  NO (skip the network call, just close/navigate/toast) — no need to
  special-case this beyond a `size === 0` short-circuit before calling
  `bulkCategoryMutation.mutate`.

## Out of scope

- No new detection endpoint — matching happens client-side against
  already-fetched data, per the "edit only" scope decision.
- No account or date-range restriction on candidate matches.
- No pagination/limit on the match list.
- No change to the create-transaction flow.
- No retroactive re-check if the user edits merchant text and category in
  the same save without merchant actually being duplicated elsewhere —
  covered naturally since `matches.length > 0` gates the whole flow.

## Testing

No automated test suite exists for this app (established precedent in
prior specs). Verification: `cd mobile && npx tsc --noEmit` against the
current baseline. Manual: edit a transaction's category where merchant
has 3+ other same-type transactions under a different category — confirm
the modal appears with all pre-checked, confirm DE-SELECT ALL/SELECT ALL
toggling, confirm YES with a subset selected updates only those
transactions' `categoryId` (verify via the Transactions list or DB),
confirm NO leaves every other transaction's category untouched, confirm
editing a transaction whose merchant has no other matches (or where
category didn't change) skips the modal entirely and behaves exactly as
before.
