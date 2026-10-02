# Bank Balance Sync and Balance Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep bank and wallet balances equal to the bank's own "Avl bal" from SMS, and let the user explain each gap in one tap. The main case is a transfer whose credit alert came only by email.

**Architecture:** Pure gap and candidate logic lives in `server/balanceSync.ts` (tested). `processSingleSms` syncs after creating a new SMS transaction and records a `balance_gaps` row. Three endpoints list, resolve and dismiss gaps. Resolving creates or converts transactions **without** moving balances, because the balance was already synced. The app gets a Needs Review screen and a notification.

**Tech Stack:** Express + Drizzle (Neon Postgres), zod, React Native 0.73 / Expo 50 / React Query. Tests are plain scripts run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-10-02-balance-gap-sync-design.md`

## Global Constraints

- Only `bank` and `wallet` accounts are synced. Never `credit_card`.
- A gap is `bankBalance − appBalanceAfterSms`. If its absolute value is under ₹1, there is no gap.
- The first gap per account gets `status 'auto_synced'`: no review item and no notification. Later gaps get `'pending'`.
- Transfer candidates: same amount within ₹1, dated from `smsDate − 3 days` to `smsDate`, on a different bank or wallet account, `type 'debit'`, not already used by another gap. Nearest in time comes first.
- Sync only when this SMS carries the newest bank figure for the account. Rescans and out-of-order SMS must never move a balance backwards. Mapping backfills never sync.
- Resolving a gap must not move any account balance.
- A failure in the sync step must never fail the SMS request.
- `npm run db:push` must run before, or together with, the server deploy.

## Review Focus

1. **Two balance-bearing SMS for one account in quick succession:** each syncs against the balance left by the previous one. The second gap is 0, not a repeat. Pinned in Task 2 (`detectBalanceGap` returns null under ₹1).
2. **A rescan imports a month-old SMS that has a balance:** no sync. Pinned in Task 2 (`isNewestBalanceFigure`).
3. **The gap equals two candidate debits:** both are listed, nearest first, and the user picks one. Pinned in Task 2.
4. **Resolving the same gap twice (a double tap):** the second call returns 409, and nothing is created twice. Implemented in Task 4 (a status check under the update's `WHERE status='pending'`).
5. **The candidate debit was edited or deleted after the gap was found:** resolve returns 400 "no longer matches", and the gap stays pending. Implemented in Task 4.

---

### Task 1: Schema and storage

**Files:** Modify `shared/schema.ts` (after `smsPaymentMatchReviews`) and `server/storage.ts` (interface plus implementation).

**Produces:**
`storage.createBalanceGap(data)`, `storage.countBalanceGapsForAccount(accountId): Promise<number>`, `storage.getBalanceGap(id)`, `storage.getPendingBalanceGaps(userId)`, `storage.getUsedGapDebitIds(userId): Promise<Set<number>>`, `storage.markBalanceGap(id, fields, onlyIfPending=true): Promise<BalanceGap|undefined>`, `storage.setAccountBalance(accountId, balance: string)`, `storage.getLatestBalanceFigureDate(accountId, excludeTransactionId): Promise<Date|null>`, `storage.insertTransactionWithoutBalance(data: InsertTransaction)`, `storage.convertDebitToSyncedTransfer(debitId, toAccountId)`.

- [ ] **Step 1: Schema.** Add:

```ts
// Gaps between the app's balance and the bank's own "Avl bal" from an SMS. The balance is synced
// to the bank's figure when a gap is found; the row lets the user explain it (a transfer whose
// credit alert came only by email, a missed income, a fee). See balanceSync.ts.
export const balanceGaps = pgTable("balance_gaps", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  smsTransactionId: integer("sms_transaction_id").references(() => transactions.id, { onDelete: 'set null' }),
  appBalanceBefore: decimal("app_balance_before", { precision: 14, scale: 2 }).notNull(),
  bankBalance: decimal("bank_balance", { precision: 14, scale: 2 }).notNull(),
  gapAmount: decimal("gap_amount", { precision: 14, scale: 2 }).notNull(), // positive = missed credit, negative = missed debit
  status: varchar("status", { length: 20 }).notNull(), // 'auto_synced' | 'pending' | 'resolved' | 'dismissed'
  resolution: varchar("resolution", { length: 20 }), // 'transfer' | 'income' | 'expense'
  resolvedTransactionId: integer("resolved_transaction_id").references(() => transactions.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});
export type BalanceGap = typeof balanceGaps.$inferSelect;
export type InsertBalanceGap = typeof balanceGaps.$inferInsert;
```

- [ ] **Step 2: Storage.** Add `balanceGaps` to the schema import, and implement each method on both the interface and the class:

```ts
  async createBalanceGap(data: InsertBalanceGap): Promise<BalanceGap> {
    const [row] = await db.insert(balanceGaps).values(data).returning();
    return row;
  }
  async countBalanceGapsForAccount(accountId: number): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(balanceGaps).where(eq(balanceGaps.accountId, accountId));
    return r?.n ?? 0;
  }
  async getBalanceGap(id: number): Promise<BalanceGap | undefined> {
    const [row] = await db.select().from(balanceGaps).where(eq(balanceGaps.id, id));
    return row;
  }
  async getPendingBalanceGaps(userId: number): Promise<BalanceGap[]> {
    return db.select().from(balanceGaps)
      .where(and(eq(balanceGaps.userId, userId), eq(balanceGaps.status, 'pending')))
      .orderBy(desc(balanceGaps.createdAt));
  }
  // Debits already used to explain a gap, so one debit can't explain two gaps.
  async getUsedGapDebitIds(userId: number): Promise<Set<number>> {
    const rows = await db.select({ id: balanceGaps.resolvedTransactionId }).from(balanceGaps)
      .where(and(eq(balanceGaps.userId, userId), eq(balanceGaps.resolution, 'transfer')));
    return new Set(rows.map(r => r.id).filter((id): id is number => id !== null));
  }
  // Updates only while still pending (when onlyIfPending), so a double tap can't resolve twice.
  async markBalanceGap(id: number, fields: Partial<InsertBalanceGap>, onlyIfPending = true): Promise<BalanceGap | undefined> {
    const where = onlyIfPending ? and(eq(balanceGaps.id, id), eq(balanceGaps.status, 'pending')) : eq(balanceGaps.id, id);
    const [row] = await db.update(balanceGaps).set(fields).where(where).returning();
    return row;
  }
  async setAccountBalance(accountId: number, balance: string): Promise<void> {
    await db.update(accounts).set({ balance, updatedAt: new Date() }).where(eq(accounts.id, accountId));
  }
  // Date of the newest other transaction on this account that carried the bank's balance.
  async getLatestBalanceFigureDate(accountId: number, excludeTransactionId: number): Promise<Date | null> {
    const [r] = await db.select({ d: sql<Date | null>`max(${transactions.transactionDate})` }).from(transactions)
      .where(and(eq(transactions.accountId, accountId), isNotNull(transactions.availableBalance), ne(transactions.id, excludeTransactionId)));
    return r?.d ? new Date(r.d) : null;
  }
  // For transactions that explain a gap the balance was already synced for.
  async insertTransactionWithoutBalance(data: InsertTransaction): Promise<Transaction> {
    const [row] = await db.insert(transactions).values({
      ...data,
      transactionDate: data.transactionDate ? new Date(data.transactionDate) : new Date(),
    }).returning();
    return row;
  }
  // The source already paid this debit and the destination was synced to the bank's figure, so
  // turning it into a transfer must not move either balance (updateTransaction would).
  async convertDebitToSyncedTransfer(debitId: number, toAccountId: number): Promise<Transaction | undefined> {
    const [row] = await db.update(transactions)
      .set({ type: 'transfer', toAccountId, updatedAt: new Date() })
      .where(and(eq(transactions.id, debitId), eq(transactions.type, 'debit')))
      .returning();
    return row;
  }
```

(`sql`, `and`, `eq`, `desc`, `ne` and `isNotNull` are already imported from drizzle-orm in storage.ts. Check with grep and add any that are missing.)

- [ ] **Step 3:** Run `npx tsc --noEmit -p . 2>&1 | grep -E "schema.ts|storage.ts"`. Expect only the pre-existing storage.ts errors.
- [ ] **Step 4:** Commit: `feat(balance-sync): balance_gaps table and storage`.

### Task 2: Pure gap logic (TDD)

**Files:** Create `server/balanceSync.ts` and `server/__tests__/balanceSync.test.ts`.

**Produces:**

```ts
export const SYNCED_ACCOUNT_TYPES: string[]; // ['bank', 'wallet']
export function detectBalanceGap(i: { accountType: string; appBalanceAfterSms: number; bankBalance: number; isFirstGapForAccount: boolean }): { gapAmount: number; status: 'auto_synced' | 'pending' } | null;
export function isNewestBalanceFigure(smsDate: Date, latestOtherFigureDate: Date | null): boolean;
export interface CandidateDebit { id: number; type: string; amount: number; transactionDate: Date; accountId: number; accountType: string; accountName: string; merchant: string | null }
export function findTransferCandidates(i: { gapAmount: number; gapAccountId: number; smsDate: Date; debits: CandidateDebit[]; usedDebitIds: Set<number> }): CandidateDebit[];
```

- [ ] **Step 1: Write the tests** (`server/__tests__/balanceSync.test.ts`). Use the same `test()` helper pattern as `spendingAllowance.test.ts`. Cases:
  - `detectBalanceGap`:
    - credit_card → null
    - bank with gap 0.6 → null
    - YES Bank app 17520.23 vs bank 44520.23, not first → `{ gapAmount: 27000, status: 'pending' }`
    - the same as a first gap → `'auto_synced'`
    - bank lower by 250 → `gapAmount: -250`
    - wallet included
  - `isNewestBalanceFigure`:
    - null latest → true
    - smsDate equal to latest → true
    - smsDate older than latest → false
  - `findTransferCandidates`, with the HDFC −27000 debit at `2026-09-29T01:56:57Z`, YES gap at `2026-09-29T11:00Z`:
    - the HDFC debit → returns it
    - gap negative → []
    - debit on the same account → excluded
    - `type 'transfer'` → excluded
    - debit id in usedDebitIds → excluded
    - debit 3 days + 1 minute before the SMS → excluded; exactly 3 days → included
    - debit after the SMS → excluded
    - amount 27000.80 → included; 27001.5 → excluded
    - two matches → nearest first
    - credit_card debit → excluded
- [ ] **Step 2:** Run `npx tsx server/__tests__/balanceSync.test.ts`. It should fail because the module is missing.
- [ ] **Step 3: Implement:**

```ts
// Pure logic for syncing app balances to the bank's own "Avl bal" from SMS and explaining the
// gaps. See docs/superpowers/specs/2026-10-02-balance-gap-sync-design.md.

export const SYNCED_ACCOUNT_TYPES = ['bank', 'wallet'];
const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function detectBalanceGap(i: {
  accountType: string; appBalanceAfterSms: number; bankBalance: number; isFirstGapForAccount: boolean;
}): { gapAmount: number; status: 'auto_synced' | 'pending' } | null {
  if (!SYNCED_ACCOUNT_TYPES.includes(i.accountType)) return null;
  const gapAmount = round2(i.bankBalance - i.appBalanceAfterSms);
  if (Math.abs(gapAmount) < 1) return null;
  return { gapAmount, status: i.isFirstGapForAccount ? 'auto_synced' : 'pending' };
}

// A rescan or a late SMS must never set the balance back to an older figure.
export function isNewestBalanceFigure(smsDate: Date, latestOtherFigureDate: Date | null): boolean {
  return latestOtherFigureDate === null || smsDate.getTime() >= latestOtherFigureDate.getTime();
}

export interface CandidateDebit {
  id: number; type: string; amount: number; transactionDate: Date;
  accountId: number; accountType: string; accountName: string; merchant: string | null;
}

export function findTransferCandidates(i: {
  gapAmount: number; gapAccountId: number; smsDate: Date; debits: CandidateDebit[]; usedDebitIds: Set<number>;
}): CandidateDebit[] {
  if (i.gapAmount <= 0) return [];
  const earliest = i.smsDate.getTime() - 3 * DAY_MS;
  return i.debits
    .filter(d =>
      d.type === 'debit'
      && SYNCED_ACCOUNT_TYPES.includes(d.accountType)
      && d.accountId !== i.gapAccountId
      && !i.usedDebitIds.has(d.id)
      && Math.abs(d.amount - i.gapAmount) <= 1
      && d.transactionDate.getTime() >= earliest
      && d.transactionDate.getTime() <= i.smsDate.getTime())
    .sort((a, b) => (i.smsDate.getTime() - a.transactionDate.getTime()) - (i.smsDate.getTime() - b.transactionDate.getTime()));
}
```

- [ ] **Step 4:** Run the tests. All should pass.
- [ ] **Step 5:** Commit: `feat(balance-sync): pure gap detection and transfer matching`.

### Task 3: Sync in the SMS flow

**Files:** Modify `server/routes.ts`: the `ParseSmsResult` type and `finishWithTransaction` (after `createTransaction` and auto-mark, before `buildSmsTransactionSummary`).

- [ ] **Step 1:** Add `balanceGap?: { id: number; accountName: string; gapAmount: number; status: string };` to `ParseSmsResult`, and add this helper next to `buildSmsTransactionSummary`:

```ts
  // Sync a bank/wallet balance to the bank's own figure from this SMS and record any gap.
  // Never throws: the transaction is already saved, and the next balance-bearing SMS resyncs.
  async function syncBalanceFromSms(account: { id: number; userId: number; name: string; type: string }, transaction: { id: number; transactionDate: Date | string }, bankBalance: number | undefined) {
    if (bankBalance === undefined || !SYNCED_ACCOUNT_TYPES.includes(account.type)) return undefined;
    try {
      const smsDate = new Date(transaction.transactionDate);
      const latest = await storage.getLatestBalanceFigureDate(account.id, transaction.id);
      if (!isNewestBalanceFigure(smsDate, latest)) return undefined;
      const current = await storage.getAccount(account.id);
      if (!current) return undefined;
      const appBalanceAfterSms = parseFloat(current.balance || '0');
      const gap = detectBalanceGap({
        accountType: account.type,
        appBalanceAfterSms,
        bankBalance,
        isFirstGapForAccount: (await storage.countBalanceGapsForAccount(account.id)) === 0,
      });
      if (!gap) return undefined;
      await storage.setAccountBalance(account.id, bankBalance.toFixed(2));
      const row = await storage.createBalanceGap({
        userId: account.userId, accountId: account.id, smsTransactionId: transaction.id,
        appBalanceBefore: appBalanceAfterSms.toFixed(2), bankBalance: bankBalance.toFixed(2),
        gapAmount: gap.gapAmount.toFixed(2), status: gap.status,
      });
      return { id: row.id, accountName: account.name, gapAmount: gap.gapAmount, status: gap.status };
    } catch (error) {
      console.error("Balance sync failed:", error);
      return undefined;
    }
  }
```

- [ ] **Step 2:** In `finishWithTransaction`, after the auto-mark block, add `const balanceGap = await syncBalanceFromSms(account, transaction, parsedData.availableBalance);` and include `balanceGap` in the returned object. Move the `buildSmsTransactionSummary` call **after** the sync, so the notification shows the synced balance. Don't add the sync to the duplicate path or to `backfillQueuedSmsForMapping`.
- [ ] **Step 3:** Import `SYNCED_ACCOUNT_TYPES, detectBalanceGap, isNewestBalanceFigure, findTransferCandidates, type CandidateDebit` from `./balanceSync`. Typecheck: only the known routes.ts error should appear.
- [ ] **Step 4:** Commit: `feat(balance-sync): sync bank balance from SMS and record gaps`.

### Task 4: Gap endpoints

**Files:** Modify `server/routes.ts` (next to the `/api/sms-payment-match-reviews` routes).

- [ ] **Step 1: Add these routes** (all behind `authenticateToken`; a gap for another user returns 404):

```ts
  app.get("/api/balance-gaps", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const gaps = await storage.getPendingBalanceGaps(userId);
      if (gaps.length === 0) return res.json([]);
      const accounts = await storage.getAllAccounts(userId);
      const accountById = new Map(accounts.map(a => [a.id, a]));
      const usedDebitIds = await storage.getUsedGapDebitIds(userId);
      const result = await Promise.all(gaps.map(async gap => {
        const smsTxn = gap.smsTransactionId ? await storage.getTransaction(gap.smsTransactionId) : undefined;
        const smsDate = smsTxn ? new Date(smsTxn.transactionDate) : gap.createdAt;
        const gapAmount = parseFloat(gap.gapAmount);
        let candidates: CandidateDebit[] = [];
        if (gapAmount > 0) {
          const recent = await storage.getAllTransactions({ userId, startDate: new Date(smsDate.getTime() - 3 * 24 * 60 * 60 * 1000), endDate: smsDate });
          candidates = findTransferCandidates({
            gapAmount, gapAccountId: gap.accountId, smsDate, usedDebitIds,
            debits: recent.filter(t => t.accountId && t.account).map(t => ({
              id: t.id, type: t.type, amount: parseFloat(t.amount), transactionDate: new Date(t.transactionDate),
              accountId: t.accountId!, accountType: t.account!.type, accountName: t.account!.name,
              merchant: t.merchant || t.description || null,
            })),
          });
        }
        return {
          id: gap.id, accountId: gap.accountId, accountName: accountById.get(gap.accountId)?.name ?? 'Account',
          gapAmount, bankBalance: parseFloat(gap.bankBalance), detectedAt: smsDate.toISOString(),
          candidates: candidates.map(c => ({ id: c.id, date: c.transactionDate.toISOString(), amount: c.amount, accountName: c.accountName, merchant: c.merchant })),
        };
      }));
      res.json(result);
    } catch (error) {
      console.error("Error fetching balance gaps:", error);
      res.status(500).json({ error: "Failed to fetch balance gaps" });
    }
  });

  const resolveGapSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("transfer"), debitTransactionId: z.number().int() }),
    z.object({ action: z.enum(["income", "expense"]), amount: z.string().optional(), categoryId: z.number().int().nullable().optional(), description: z.string().optional() }),
  ]);

  app.post("/api/balance-gaps/:id/resolve", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const gap = await storage.getBalanceGap(parseInt(req.params.id));
      if (!gap || gap.userId !== userId) return res.status(404).json({ error: "Balance gap not found" });
      if (gap.status !== 'pending') return res.status(409).json({ error: "This gap was already handled" });
      const parsed = resolveGapSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
      const gapAmount = parseFloat(gap.gapAmount);
      let resolvedTransactionId: number;

      if (parsed.data.action === 'transfer') {
        if (gapAmount <= 0) return res.status(400).json({ error: "Only a higher bank balance can be a transfer in" });
        const debit = await storage.getTransaction(parsed.data.debitTransactionId);
        const smsTxn = gap.smsTransactionId ? await storage.getTransaction(gap.smsTransactionId) : undefined;
        const smsDate = smsTxn ? new Date(smsTxn.transactionDate) : gap.createdAt;
        const debitAccount = debit?.accountId ? await storage.getAccount(debit.accountId) : undefined;
        const stillMatches = debit && debit.userId === userId && debitAccount && findTransferCandidates({
          gapAmount, gapAccountId: gap.accountId, smsDate, usedDebitIds: await storage.getUsedGapDebitIds(userId),
          debits: [{ id: debit.id, type: debit.type, amount: parseFloat(debit.amount), transactionDate: new Date(debit.transactionDate),
            accountId: debitAccount.id, accountType: debitAccount.type, accountName: debitAccount.name, merchant: debit.merchant }],
        }).length === 1;
        if (!stillMatches) return res.status(400).json({ error: "That transaction no longer matches this gap" });
        const converted = await storage.convertDebitToSyncedTransfer(debit!.id, gap.accountId);
        if (!converted) return res.status(400).json({ error: "That transaction no longer matches this gap" });
        resolvedTransactionId = converted.id;
      } else {
        const wantsIncome = parsed.data.action === 'income';
        if (wantsIncome !== gapAmount > 0) return res.status(400).json({ error: wantsIncome ? "The bank balance was lower, not higher" : "The bank balance was higher, not lower" });
        const created = await storage.insertTransactionWithoutBalance({
          userId, accountId: gap.accountId, type: wantsIncome ? 'credit' : 'debit',
          amount: parsed.data.amount ?? Math.abs(gapAmount).toFixed(2),
          categoryId: parsed.data.categoryId ?? null,
          description: parsed.data.description ?? (wantsIncome ? 'Unrecorded credit (found from bank balance)' : 'Unrecorded debit (found from bank balance)'),
          transactionDate: (gap.createdAt ?? new Date()).toISOString(),
        });
        resolvedTransactionId = created.id;
      }

      const updated = await storage.markBalanceGap(gap.id, {
        status: 'resolved', resolution: parsed.data.action, resolvedTransactionId, resolvedAt: new Date(),
      });
      if (!updated) return res.status(409).json({ error: "This gap was already handled" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error resolving balance gap:", error);
      res.status(500).json({ error: "Failed to resolve balance gap" });
    }
  });

  app.post("/api/balance-gaps/:id/dismiss", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const gap = await storage.getBalanceGap(parseInt(req.params.id));
      if (!gap || gap.userId !== userId) return res.status(404).json({ error: "Balance gap not found" });
      const updated = await storage.markBalanceGap(gap.id, { status: 'dismissed', resolvedAt: new Date() });
      if (!updated) return res.status(409).json({ error: "This gap was already handled" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error dismissing balance gap:", error);
      res.status(500).json({ error: "Failed to dismiss balance gap" });
    }
  });
```

- [ ] **Step 2:** Typecheck, run the server suite, and commit: `feat(balance-sync): list, resolve and dismiss balance gaps`.

### Task 5: App screen and Needs Review entry

**Files:**
- Modify `mobile/src/lib/types.ts`, `mobile/src/lib/api.ts`, `mobile/App.tsx` (RootStackParamList, root screen, linking `'balance-gaps'`) and `mobile/src/screens/NeedsReviewHubScreen.tsx`.
- Create `mobile/src/screens/BalanceGapsScreen.tsx`.

- [ ] **Step 1: Types and API:**

```ts
export interface BalanceGapCandidate { id: number; date: string; amount: number; accountName: string; merchant: string | null }
export interface BalanceGapItem { id: number; accountId: number; accountName: string; gapAmount: number; bankBalance: number; detectedAt: string; candidates: BalanceGapCandidate[] }
```

```ts
  getBalanceGaps: () => apiRequest<BalanceGapItem[]>('/api/balance-gaps'),
  resolveBalanceGap: (id: number, body: { action: 'transfer'; debitTransactionId: number } | { action: 'income' | 'expense'; categoryId?: number | null }) =>
    apiRequest<{ success: boolean }>(`/api/balance-gaps/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),
  dismissBalanceGap: (id: number) => apiRequest<{ success: boolean }>(`/api/balance-gaps/${id}/dismiss`, { method: 'POST' }),
```

- [ ] **Step 2: Screen.** Model it on `PaymentMatchReviewsScreen.tsx`: the same theming, header and empty state ("No balance gaps to review"). One card per gap, with copy as in spec §5:
  - **Positive gap with candidates:** one radio row per candidate (date, account, merchant, amount), defaulting to the first, then a **Yes, it's a transfer** button.
  - **Any positive gap:** an **Add as income** button.
  - **Negative gap:** an **Add as expense** button.
  - **Dismiss** on every card.
  - After any action, invalidate `['/api/balance-gaps']`, `['/api/transactions']`, `['/api/accounts']`, `['/api/spending-allowance']` and `['/api/dashboard-summary']`, call `refreshWidgets().catch(() => {})`, and show a Toast. On error, show a Toast with the server message.
  - Disable the card's buttons while its mutation is pending.
- [ ] **Step 3: Navigation.** Add `BalanceGaps: undefined` to RootStackParamList and register the screen with the title "Balance gaps" (options style like `SpendingAllowance`). Add `BalanceGaps: 'balance-gaps'` to the linking config. In the hub, add the query `['/api/balance-gaps']` (refetched in its `useFocusEffect`) and the item `{ icon: 'scale-outline', title: 'Balance Gaps', subtitle: "Money the bank saw that no SMS told us about", route: 'BalanceGaps', color: '#6366f1', count }`. Widen the hub's route type the way MoreScreen does for root-only routes.
- [ ] **Step 4:** Mobile typecheck filtered to the changed files shows no new errors. Commit: `feat(balance-sync): Balance Gaps review screen`.

### Task 6: Gap notification

**Files:** Modify `mobile/src/lib/smsNotificationContent.ts`, its test, and `mobile/src/lib/smsAutoReader.ts`.

- [ ] **Step 1: Tests first.** Add `buildBalanceGapNotification(result)` tests:
  - `status 'pending'` with gap +27000 on YesBank Account → title "YesBank Account balance was ₹27,000 higher than expected", body "Tap to review what it was.", url `com.mytracker.finance://balance-gaps`
  - a negative gap → "lower"
  - `'auto_synced'` → null
  - no `balanceGap` → null
- [ ] **Step 2: Implement.** Add `balanceGap?: { id: number; accountName: string; gapAmount: number; status: string }` to `SmsNotificationResult`, and:

```ts
// A second notification when the bank's balance showed money moving without an SMS.
export function buildBalanceGapNotification(result: SmsNotificationResult): SmsNotificationContent | null {
  const gap = result.balanceGap;
  if (!gap || gap.status !== 'pending') return null;
  const direction = gap.gapAmount > 0 ? 'higher' : 'lower';
  return {
    title: `${gap.accountName} balance was ${formatRupees(Math.abs(gap.gapAmount))} ${direction} than expected`,
    body: 'Tap to review what it was.',
    data: { url: `${DEEP_LINK_PREFIX}balance-gaps` },
  };
}
```

- [ ] **Step 3:** In `notifyTransactionAdded` (smsAutoReader.ts), after the transaction notification, schedule `buildBalanceGapNotification(result)` when it isn't null. Note that the transaction notification returns early for duplicates, and a gap is never recorded for a duplicate.
- [ ] **Step 4:** Run `npx tsx mobile/src/lib/__tests__/smsNotificationContent.test.ts` and the filtered typecheck. Commit: `feat(balance-sync): notify when a balance gap needs review`.

### Task 7: Verify and review

- [ ] Run the full server suite, the mobile notification test, and both typechecks.
- [ ] Do a read-only live check: run `detectBalanceGap` and `findTransferCandidates` from a script against the real 29 Sep rows (HDFC debit 454, YES balances) to confirm one candidate.
- [ ] Get a whole-branch review on the most capable model, then fix what it finds.
- [ ] Release (only on the user's go): the user runs `npm run db:push` from the worktree, then merge, push, Cloud Run deploy, and an EAS build.
