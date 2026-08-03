# Merchant Category Bulk-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user changes a transaction's category during edit, and other transactions share that merchant (same type, different category), offer a confirmation modal to bulk-apply the new category to selected matches.

**Architecture:** Detection is entirely client-side (uses the transaction list already fetched for edit mode — no new query). Applying the bulk change is a new user-scoped backend endpoint (`PATCH /api/transactions/bulk-category`) backed by a new `storage.bulkUpdateTransactionCategory` method, called from a new modal added inline to `AddTransactionScreen.tsx`.

**Tech Stack:** Express + Drizzle ORM (backend), React Native + `@tanstack/react-query` (mobile). No test framework exists in this repo — verification is `npm run check` (backend/shared) and `cd mobile && npx tsc --noEmit` (mobile) against the current baseline, plus a manual test pass.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-03-merchant-category-bulk-update-design.md`
- Matching field: `merchant` only, trimmed + case-insensitive exact match. No fallback to `description`.
- Candidates must share the same `type` (`debit`/`credit`/`transfer`) as the transaction being edited.
- Trigger scope: edit only, never on create.
- The new backend route must be registered **before** `PATCH /api/transactions/:id` (currently `server/routes.ts:831`) so Express doesn't route `bulk-category` through the `:id` param handler.
- Follow this codebase's existing convention of manual `Array.isArray`/`typeof` body validation in `routes.ts` (see `/api/import/transactions` at `server/routes.ts:683`) rather than introducing a fresh top-level `zod` import — this file has no existing `import { z } from "zod"` and every other route either uses the shared `insertXSchema` objects or manual checks.
- Icon names used must exist in the installed Ionicons glyph map. Confirmed valid for this plan: `checkbox`, `square-outline`, `close`, `add`, `save-outline` (already used elsewhere in this codebase).

---

### Task 1: Backend — `storage.bulkUpdateTransactionCategory`

**Files:**
- Modify: `server/storage.ts:37` (import line), `server/storage.ts:89` (interface declaration), `server/storage.ts:716-718` (new method implementation, inserted between the end of `updateTransaction` and the start of `deleteTransaction`)

**Interfaces:**
- Produces: `IStorage.bulkUpdateTransactionCategory(userId: number, transactionIds: number[], categoryId: number): Promise<number>` — returns the count of rows actually updated (rows belonging to `userId` and present in `transactionIds`).

- [ ] **Step 1: Add `inArray` to the drizzle-orm import**

Current line 37:
```ts
import { eq, and, gte, lte, desc, sql, ilike, or } from "drizzle-orm";
```

Change to:
```ts
import { eq, and, gte, lte, desc, sql, ilike, or, inArray } from "drizzle-orm";
```

- [ ] **Step 2: Add the method signature to `IStorage`**

Current line 89:
```ts
  updateTransaction(id: number, transaction: Partial<InsertTransaction>): Promise<Transaction>;
```

Insert immediately after it:
```ts
  updateTransaction(id: number, transaction: Partial<InsertTransaction>): Promise<Transaction>;
  bulkUpdateTransactionCategory(userId: number, transactionIds: number[], categoryId: number): Promise<number>;
```

- [ ] **Step 3: Implement the method**

`updateTransaction`'s implementation currently ends at line 716 (`return updatedTransaction;` / `}`), immediately followed by `deleteTransaction` at line 718. Insert the new method between them:

```ts
  async bulkUpdateTransactionCategory(userId: number, transactionIds: number[], categoryId: number): Promise<number> {
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

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new errors introduced by this change (the repo may already have pre-existing unrelated errors — compare against a baseline run before this task if any show up, but this specific method must compile cleanly: correct `and`/`inArray`/`eq` usage, correct return type).

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts
git commit -m "feat: add bulkUpdateTransactionCategory storage method"
```

---

### Task 2: Backend — `PATCH /api/transactions/bulk-category` route

**Files:**
- Modify: `server/routes.ts:831` (insert new route immediately before this line, i.e. before the existing `PATCH /api/transactions/:id` handler)

**Interfaces:**
- Consumes: `storage.bulkUpdateTransactionCategory(userId, transactionIds, categoryId)` from Task 1.
- Produces: `PATCH /api/transactions/bulk-category` — request body `{ transactionIds: number[], categoryId: number }`, response `{ updatedCount: number }` on success, `{ error: string }` with status 400 on validation failure.

- [ ] **Step 1: Add the route**

Insert immediately before line 831 (`app.patch("/api/transactions/:id", ...)`):

```ts
  app.patch("/api/transactions/bulk-category", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { transactionIds, categoryId } = req.body;

      if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
        return res.status(400).json({ error: "transactionIds must be a non-empty array" });
      }
      if (!transactionIds.every((id: any) => typeof id === 'number' && Number.isInteger(id))) {
        return res.status(400).json({ error: "transactionIds must contain only integers" });
      }
      if (typeof categoryId !== 'number' || !Number.isInteger(categoryId)) {
        return res.status(400).json({ error: "categoryId must be an integer" });
      }

      const updatedCount = await storage.bulkUpdateTransactionCategory(userId, transactionIds, categoryId);
      res.json({ updatedCount });
    } catch (error: any) {
      console.error("Error bulk-updating transaction category:", error);
      res.status(400).json({ error: error.message || "Failed to bulk-update category" });
    }
  });

```

Registering it here (immediately before the `:id` route) guarantees Express matches the literal `bulk-category` path segment before it ever reaches the `:id` param handler.

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors from this route (matches the existing handler style used throughout this file, e.g. `req.user!.userId`, `res.status(400).json({ error })`).

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`), then with a valid auth token for a test user:

```bash
curl -X PATCH http://localhost:5000/api/transactions/bulk-category \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"transactionIds": [1, 2], "categoryId": 3}'
```

Expected: `{"updatedCount": <n>}` where `<n>` is however many of ids `1, 2` actually belong to that user (0 if none do — not an error). Also verify `PATCH /api/transactions/1` (the existing single-transaction route) still works unaffected — confirms route ordering didn't break the pre-existing endpoint.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add PATCH /api/transactions/bulk-category route"
```

---

### Task 3: Mobile — API client method

**Files:**
- Modify: `mobile/src/lib/api.ts:325-326` (insert immediately after the existing `updateTransaction` entry)

**Interfaces:**
- Consumes: `PATCH /api/transactions/bulk-category` from Task 2.
- Produces: `api.bulkUpdateTransactionCategory(transactionIds: number[], categoryId: number): Promise<{ updatedCount: number }>` — used by Task 6.

- [ ] **Step 1: Add the client method**

Current (lines 325-326):
```ts
  updateTransaction: (id: number, data: Partial<InsertTransaction>) => 
    apiRequest<Transaction>(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
```

Insert immediately after:
```ts
  updateTransaction: (id: number, data: Partial<InsertTransaction>) => 
    apiRequest<Transaction>(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  bulkUpdateTransactionCategory: (transactionIds: number[], categoryId: number) =>
    apiRequest<{ updatedCount: number }>('/api/transactions/bulk-category', {
      method: 'PATCH',
      body: JSON.stringify({ transactionIds, categoryId }),
    }),
```

- [ ] **Step 2: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors (this repo has 19 pre-existing unrelated errors as of this plan's writing — confirm the count doesn't increase).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/lib/api.ts
git commit -m "feat: add bulkUpdateTransactionCategory API client method"
```

---

### Task 4: Mobile — state and type import setup in `AddTransactionScreen.tsx`

**Files:**
- Modify: `mobile/src/screens/AddTransactionScreen.tsx:10` (type import), `:30` (state block, after `selectedCategoryId`), `:70-84` (edit-mode load effect)

**Interfaces:**
- Produces: state variables `originalCategoryId`, `merchantMatches`, `selectedMatchIds`, `showMerchantMatchModal` consumed by Tasks 5–7.

- [ ] **Step 1: Add `Transaction` to the type import**

Current line 10:
```ts
import type { Category, Account } from '../lib/types';
```

Change to:
```ts
import type { Category, Account, Transaction } from '../lib/types';
```

- [ ] **Step 2: Add new state variables**

Current line 30:
```ts
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
```

Insert immediately after:
```ts
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [originalCategoryId, setOriginalCategoryId] = useState<number | null>(null);
  const [merchantMatches, setMerchantMatches] = useState<Transaction[]>([]);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());
  const [showMerchantMatchModal, setShowMerchantMatchModal] = useState(false);
```

- [ ] **Step 3: Capture the original category when edit-mode data loads**

Current (lines 70-84):
```ts
  // Load transaction data for edit mode
  React.useEffect(() => {
    if (isEditMode && transactions) {
      const transaction = transactions.find((t: any) => t.id === transactionId);
      if (transaction) {
        setType(transaction.type as 'debit' | 'credit' | 'transfer');
        setAmount(transaction.amount);
        setMerchant(transaction.merchant || '');
        setDescription(transaction.description || '');
        setSelectedCategoryId(transaction.categoryId || null);
        setSelectedAccountId(transaction.accountId || null);
        setSelectedToAccountId(transaction.toAccountId || null);
        setTransactionDate(new Date(transaction.transactionDate));
      }
    }
  }, [isEditMode, transactions, transactionId]);
```

Add `setOriginalCategoryId(transaction.categoryId || null);` right after the `setSelectedCategoryId` line:
```ts
  // Load transaction data for edit mode
  React.useEffect(() => {
    if (isEditMode && transactions) {
      const transaction = transactions.find((t: any) => t.id === transactionId);
      if (transaction) {
        setType(transaction.type as 'debit' | 'credit' | 'transfer');
        setAmount(transaction.amount);
        setMerchant(transaction.merchant || '');
        setDescription(transaction.description || '');
        setSelectedCategoryId(transaction.categoryId || null);
        setOriginalCategoryId(transaction.categoryId || null);
        setSelectedAccountId(transaction.accountId || null);
        setSelectedToAccountId(transaction.toAccountId || null);
        setTransactionDate(new Date(transaction.transactionDate));
      }
    }
  }, [isEditMode, transactions, transactionId]);
```

- [ ] **Step 4: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors (unused-variable errors are not enabled in this project's tsconfig for local `const`/`useState` declarations not yet consumed — verify by running; if the compiler does flag unused state as an error, that's expected to clear once Tasks 5-7 consume them, which happen next in this same session before any final commit gate).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/AddTransactionScreen.tsx
git commit -m "feat: add merchant-match modal state to AddTransactionScreen"
```

---

### Task 5: Mobile — merchant-match detection in `updateMutation.onSuccess`

**Files:**
- Modify: `mobile/src/screens/AddTransactionScreen.tsx:112-137` (`updateMutation` definition)

**Interfaces:**
- Consumes: state from Task 4 (`originalCategoryId`, `merchantMatches` setter, `selectedMatchIds` setter, `showMerchantMatchModal` setter); `transactions`, `merchant`, `type`, `selectedCategoryId`, `transactionId` (all already in scope in this component).
- Produces: when matches are found, `showMerchantMatchModal` becomes `true` and navigation/toast are deferred to Task 7's modal buttons; when no matches (or category unchanged, or empty merchant), behavior is unchanged from today.

- [ ] **Step 1: Replace the `updateMutation` definition**

Current (lines 112-137):
```ts
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.updateTransaction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Transaction Updated',
        text2: 'Transaction has been updated successfully',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update transaction. Please try again.',
        position: 'bottom',
      });
    },
  });
```

Replace with:
```ts
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.updateTransaction(id, data),
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
          return;
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
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update transaction. Please try again.',
        position: 'bottom',
      });
    },
  });
```

- [ ] **Step 2: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors. `transactions` is already typed as `Transaction[] | undefined` via `api.getTransactions`'s return type, so the `(t: Transaction) =>` filter callback must type-check without casting.

- [ ] **Step 3: Manual verification (partial — full flow only testable after Task 7)**

Not independently testable yet since the modal doesn't exist — the `return` on match means the screen currently appears to "hang" (no navigation, no toast) when matches are found. This is expected and resolved by Task 7. Confirm via `tsc` only at this step; defer behavioral testing to Task 7's manual test.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/AddTransactionScreen.tsx
git commit -m "feat: detect same-merchant transactions on category change"
```

---

### Task 6: Mobile — bulk-apply mutation

**Files:**
- Modify: `mobile/src/screens/AddTransactionScreen.tsx` (insert immediately after the `updateMutation` block from Task 5, i.e. after its closing `});`, before `const handleParseSms = async () => {` at line 139)

**Interfaces:**
- Consumes: `api.bulkUpdateTransactionCategory` from Task 3; `showMerchantMatchModal` setter from Task 4.
- Produces: `bulkCategoryMutation` — a `useMutation` object consumed by Task 7's "YES" button handler, exposing `.mutate({ ids, categoryId })`.

- [ ] **Step 1: Add the mutation**

Insert after `updateMutation`'s closing `});` (originally line 137, now shifted by Task 5's edit — insert right before `const handleParseSms = async () => {`):

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

- [ ] **Step 2: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/AddTransactionScreen.tsx
git commit -m "feat: add bulk category apply mutation"
```

---

### Task 7: Mobile — merchant-match modal UI

**Files:**
- Modify: `mobile/src/screens/AddTransactionScreen.tsx` (JSX: insert new `<Modal>` after the existing SMS `<Modal>`'s closing tag, currently at line 536, before `</ScrollView>` at line 537; styles: append to the `StyleSheet.create({...})` call, currently closing at line 737)

**Interfaces:**
- Consumes: `merchantMatches`, `selectedMatchIds`, `showMerchantMatchModal` (Task 4), `bulkCategoryMutation` (Task 6), `categories` (already in scope), `formatDate`/`formatCurrency` (already imported from `../lib/utils` — verify import at top of file and add if missing).

- [ ] **Step 1: Add `formatDate` and `formatCurrency` imports**

Neither helper is currently imported in this file (confirmed — the only import from `../lib/utils` is `getThemedColors`, at line 9). Change line 9:

```ts
import { getThemedColors } from '../lib/utils';
```

to:

```ts
import { getThemedColors, formatDate, formatCurrency } from '../lib/utils';
```

Both are existing exports from `mobile/src/lib/utils.ts` (`formatCurrency` at line 1, `formatDate` at line 11), already used elsewhere in the app (e.g. `DashboardScreen.tsx`).

- [ ] **Step 2: Add the modal JSX**

Insert immediately after the SMS modal's closing `</Modal>` (line 536) and before `</ScrollView>` (line 537):

```tsx
      <Modal
        visible={showMerchantMatchModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <Text style={[styles.matchModalSuccessTitle, { color: colors.success }]}>
              Transaction is updated successfully!
            </Text>
            <Text style={[styles.modalDescription, { color: colors.text }]}>
              Select other transactions from "{merchant}" you'd like to update to{' '}
              {categories?.find(c => c.id === selectedCategoryId)?.name || 'this category'}
            </Text>

            <TouchableOpacity
              onPress={() => setSelectedMatchIds(
                selectedMatchIds.size === merchantMatches.length ? new Set() : new Set(merchantMatches.map(m => m.id))
              )}
            >
              <Text style={[styles.matchDeselectAll, { color: colors.primary }]}>
                {selectedMatchIds.size === merchantMatches.length ? 'DE-SELECT ALL' : 'SELECT ALL'}
              </Text>
            </TouchableOpacity>

            <ScrollView style={styles.matchList}>
              {merchantMatches.map((m) => {
                const isSelected = selectedMatchIds.has(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.matchRow}
                    onPress={() => {
                      setSelectedMatchIds(prev => {
                        const next = new Set(prev);
                        if (next.has(m.id)) {
                          next.delete(m.id);
                        } else {
                          next.add(m.id);
                        }
                        return next;
                      });
                    }}
                  >
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.primary : colors.textMuted}
                      style={{ marginRight: 12 }}
                    />
                    <View style={styles.matchRowInfo}>
                      <Text style={[styles.matchRowName, { color: colors.text }]} numberOfLines={1}>
                        {m.merchant}
                      </Text>
                      <Text style={[styles.matchRowMeta, { color: colors.textMuted }]}>
                        {formatDate(m.transactionDate)}
                        {m.account?.name ? ` · ${m.account.name}` : m.account?.accountNumber ? ` · ****${m.account.accountNumber}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.matchRowAmt, { color: colors.text }]}>
                      {formatCurrency(m.amount)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.matchModalFooter}>
              <TouchableOpacity
                style={[styles.matchModalButton, styles.matchModalButtonOutline, { borderColor: colors.border }]}
                onPress={() => {
                  setShowMerchantMatchModal(false);
                  navigation.goBack();
                  Toast.show({
                    type: 'success',
                    text1: 'Transaction Updated',
                    text2: 'Transaction has been updated successfully',
                    position: 'bottom',
                  });
                }}
              >
                <Text style={[styles.matchModalButtonText, { color: colors.text }]}>NO</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.matchModalButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (selectedMatchIds.size === 0 || !selectedCategoryId) {
                    setShowMerchantMatchModal(false);
                    navigation.goBack();
                    Toast.show({
                      type: 'success',
                      text1: 'Transaction Updated',
                      text2: 'Transaction has been updated successfully',
                      position: 'bottom',
                    });
                    return;
                  }
                  bulkCategoryMutation.mutate({ ids: Array.from(selectedMatchIds), categoryId: selectedCategoryId });
                }}
              >
                {bulkCategoryMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.matchModalButtonText, { color: '#fff' }]}>YES</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
```

- [ ] **Step 3: Add new styles**

Current end of `StyleSheet.create({...})` (line 737, the closing `});`). Insert new style keys immediately before that closing `});`:

```ts
  matchModalSuccessTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  matchDeselectAll: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  matchList: {
    maxHeight: 320,
    marginBottom: 16,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  matchRowInfo: {
    flex: 1,
  },
  matchRowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  matchRowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  matchRowAmt: {
    fontSize: 15,
    fontWeight: '600',
  },
  matchModalFooter: {
    flexDirection: 'row',
    gap: 12,
  },
  matchModalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchModalButtonOutline: {
    borderWidth: 1,
  },
  matchModalButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
```

- [ ] **Step 4: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors. Pay particular attention to the `Ionicons name` props (`'checkbox'`, `'square-outline'` are confirmed valid glyph names in this project's installed `@expo/vector-icons` version) and that `m.account` (typed `Account | null | undefined` per `Transaction`) is accessed with optional chaining throughout.

- [ ] **Step 5: Run the app and manually verify the full flow**

Run: `cd mobile && npx expo start` (or the project's existing run convention if different — check `mobile/package.json` scripts first), open on a device/simulator, and:

1. Edit an existing transaction whose merchant (e.g. "SAKTHI") has 2+ other transactions of the same type under a *different* category. Change this transaction's category and save.
   - Expected: the modal appears, listing the other matching transactions, all pre-checked.
2. Tap "DE-SELECT ALL" — expected: all checkboxes clear and the label flips to "SELECT ALL". Tap again — all re-select.
3. Uncheck one row, tap "YES" — expected: modal closes, navigates back, success toast shows. Verify (via the Transactions list) that only the still-checked rows' categories changed; the unchecked one is untouched.
4. Repeat the edit, this time tap "NO" — expected: modal closes, navigates back, success toast shows, and *no* other transaction's category changed (only the originally-edited one, from the initial save).
5. Edit a transaction whose merchant has no other same-type matches, or edit one without changing its category — expected: no modal appears at all; save behaves exactly as it did before this feature (immediate navigate-back + toast).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/AddTransactionScreen.tsx
git commit -m "feat: add merchant-match confirmation modal to transaction edit"
```

---

## Post-implementation

- [ ] Update `TODO.md` Section 10 #1 status line from `**New Priority:High | Development NotStarted**` to `**Development completed | Test Pending**`, matching this repo's existing convention (seen throughout `TODO.md`, e.g. Section 5 #9/#10 after their own recent fixes).
