# Merchant-History Category Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before an SMS-created transaction falls back to AI category suggestion, check whether the user already has a prior transaction from the same merchant (same debit/credit type) with a real category, and reuse it.

**Architecture:** A new `storage.getCategoryIdByMerchant(userId, merchant, type)` query, wrapped by a small `resolveTransactionCategoryId` orchestration helper in `server/routes.ts` (placed alongside the existing `matchAccountBySender` helper it structurally mirrors — normalize → query → return best candidate). This helper owns the full category-resolution decision for both SMS-processing call sites that currently go straight to AI suggestion (`finishWithTransaction` in the live auto-read path, `backfillQueuedSmsForMapping` in the rescan path): try the merchant-history match first, and only call the existing `suggestCategory` AI chain if it returns nothing — so the fallback logic lives in one place, not duplicated at each call site. A new `updatedAt` column on `transactions` (added for consistency with every other table in this schema, which already has one) breaks ties when a merchant has multiple prior categorized transactions.

**Tech Stack:** Express + Drizzle ORM + PostgreSQL (backend only — no mobile changes in this plan).

## Global Constraints

- Match is scoped to the **same transaction type** — a `debit` SMS only ever matches prior `debit` transactions from that merchant, a `credit` SMS only prior `credit` transactions.
- Merchant match is **exact, normalized** (trimmed, case-insensitive via `ilike` with no wildcards) — no fuzzy/partial matching.
- "Most recently updated" tie-break uses the new `updatedAt` column, descending.
- A transaction categorized as **"Other"** never counts as a match (only a real category counts).
- Any failure in the new lookup path (DB error, missing merchant, etc.) must fall through to the existing `suggestCategory` behavior unchanged — never block a transaction from being categorized because of this new step.
- Applies to **both** existing `suggestCategory` call sites inside SMS processing (`finishWithTransaction`, `backfillQueuedSmsForMapping`) — not the two unrelated `suggestCategory` call sites elsewhere in `server/routes.ts` (the bank-statement PDF import at line 738, and the standalone `POST /api/suggest-category` endpoint at line 3521 — both out of scope, do not touch them).
- This app has no automated test harness for the server (no test script wired to a runner as of this plan's writing — note: `server/__tests__/smsParser.test.ts` exists in the working tree from unrelated concurrent work; if a test runner turns out to be wired up by the time you implement, that's a bonus, not a requirement — the verification gate below applies regardless). Verification gate: `npm run check` (root `tsc`, run from the repo root). **Before Task 1**, run it and record the current baseline `error TS` count in a fresh worktree — every task's bar is *no new errors* against that baseline, not zero.
- This project applies schema changes via `npm run db:push` (`drizzle-kit push`, which diffs `shared/schema.ts` directly against the live database) — **not** via replaying the numbered `.sql` files under `migrations/`. Those files exist purely as a hand-maintained history of each schema change (every prior schema change has a matching one) and are not consumed by any migration runner in this codebase (confirmed: `migrations/meta/_journal.json` is stale relative to the actual numbered files, and no code in `server/` reads the `migrations/` directory). Write the migration file for this reason — history/documentation — but the actual schema change takes effect only when `npm run db:push` is run against a real database, which is **not possible in this sandboxed environment** (no `DATABASE_URL`/live DB available). Task 1's verification is therefore code-inspection only; flag clearly in your report that `npm run db:push` still needs to be run by the user against the real database before this feature works end-to-end.

---

### Task 1: Add `updatedAt` to `transactions`

**Files:**
- Modify: `shared/schema.ts` (`transactions` table definition, ~line 116-134)
- Modify: `server/storage.ts` (`updateTransaction`, ~line 697-755; `bulkUpdateTransactionCategory`, ~line 757-767)
- Create: `migrations/0023_add_updated_at_to_transactions.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 2): `transactions.updatedAt` column, of type `timestamp`, available as `transactions.updatedAt` wherever the Drizzle table object is already imported in `server/storage.ts`. Kept current by every write path that already exists (`updateTransaction`, `bulkUpdateTransactionCategory`) — Task 2's read-only query can rely on it being accurate.

- [ ] **Step 1: Add the column to the schema**

Current code (`shared/schema.ts`, ~lines 116-134):
```ts
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").references(() => accounts.id),
  toAccountId: integer("to_account_id").references(() => accounts.id), // For transfer transactions
  categoryId: integer("category_id").references(() => categories.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'debit', 'credit', 'transfer'
  description: text("description"),
  merchant: varchar("merchant", { length: 200 }),
  referenceNumber: varchar("reference_number", { length: 100 }),
  transactionDate: timestamp("transaction_date").notNull(),
  smsId: integer("sms_id"),
  availableBalance: decimal("available_balance", { precision: 14, scale: 2 }), // bank-reported balance after this transaction, when the SMS included one
  isRecurring: boolean("is_recurring").default(false),
  savingsContributionId: integer("savings_contribution_id"), // Link to savings contribution if this is a contribution transaction
  paymentOccurrenceId: integer("payment_occurrence_id"), // Link to scheduled payment occurrence if this is a scheduled payment transaction
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```
Replace with (adds `updatedAt` right after `createdAt`, matching the exact style already used by every other table with this column, e.g. `users`, `accounts`):
```ts
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").references(() => accounts.id),
  toAccountId: integer("to_account_id").references(() => accounts.id), // For transfer transactions
  categoryId: integer("category_id").references(() => categories.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'debit', 'credit', 'transfer'
  description: text("description"),
  merchant: varchar("merchant", { length: 200 }),
  referenceNumber: varchar("reference_number", { length: 100 }),
  transactionDate: timestamp("transaction_date").notNull(),
  smsId: integer("sms_id"),
  availableBalance: decimal("available_balance", { precision: 14, scale: 2 }), // bank-reported balance after this transaction, when the SMS included one
  isRecurring: boolean("is_recurring").default(false),
  savingsContributionId: integer("savings_contribution_id"), // Link to savings contribution if this is a contribution transaction
  paymentOccurrenceId: integer("payment_occurrence_id"), // Link to scheduled payment occurrence if this is a scheduled payment transaction
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Set `updatedAt` in `updateTransaction`**

Current code (`server/storage.ts`, ~lines 720-730):
```ts
    // Update the transaction
    const updateData: any = { ...updates };
    if (updates.transactionDate) {
      updateData.transactionDate = new Date(updates.transactionDate);
    }

    const [updatedTransaction] = await db
      .update(transactions)
      .set(updateData)
      .where(eq(transactions.id, id))
      .returning();
```
Replace with:
```ts
    // Update the transaction
    const updateData: any = { ...updates, updatedAt: new Date() };
    if (updates.transactionDate) {
      updateData.transactionDate = new Date(updates.transactionDate);
    }

    const [updatedTransaction] = await db
      .update(transactions)
      .set(updateData)
      .where(eq(transactions.id, id))
      .returning();
```

- [ ] **Step 3: Set `updatedAt` in `bulkUpdateTransactionCategory`**

Current code (`server/storage.ts`, ~lines 757-765):
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
```
Replace with:
```ts
  async bulkUpdateTransactionCategory(userId: number, transactionIds: number[], categoryId: number): Promise<number> {
    if (transactionIds.length === 0) return 0;
    const result = await db.update(transactions)
      .set({ categoryId, updatedAt: new Date() })
      .where(and(
        eq(transactions.userId, userId),
        inArray(transactions.id, transactionIds)
      ))
      .returning({ id: transactions.id });
```

- [ ] **Step 4: Write the migration history file**

Create `migrations/0023_add_updated_at_to_transactions.sql`:
```sql
-- Powers merchant-history category matching's "most recently updated" tie-break —
-- transactions never had this column, unlike every other table in this schema.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
```

- [ ] **Step 5: Type-check**

Run: `npm run check` (from the repo root)
Expected: no new `error TS` occurrences vs. the baseline recorded before Task 1.

- [ ] **Step 6: Verify by inspection**

There is no live database available in this environment (`npm run db:push` cannot be run here). Verify by reading: confirm `updatedAt` in the schema uses the exact same `timestamp(...).notNull().defaultNow()` shape as `createdAt` on the same table and as `updatedAt` on other tables (e.g. `users`, `accounts`); confirm both `.set(...)` calls you edited now include `updatedAt: new Date()` (or, for `updateTransaction`, that it's folded into the spread via `{ ...updates, updatedAt: new Date() }`) and that no other write path to `transactions` exists that you missed (search the file for `db.update(transactions)` and confirm every result was either already handled or is intentionally out of scope — `createTransaction` doesn't need this, it already sets `createdAt`/`updatedAt` via the column defaults on insert).

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts server/storage.ts migrations/0023_add_updated_at_to_transactions.sql
git commit -m "feat: add updatedAt to transactions for merchant-history category tie-break"
```

---

### Task 2: `storage.getCategoryIdByMerchant`

**Files:**
- Modify: `server/storage.ts` (`IStorage` interface, ~line 104-109; `DatabaseStorage` class, near `getCategoryByName` at ~line 450 or near the other transaction methods — either location is fine, place it directly after `getCategoryByName` since it depends on that method)

**Interfaces:**
- Consumes: `transactions.updatedAt` (Task 1), the existing `storage.getCategoryByName(name: string): Promise<Category | undefined>`, existing Drizzle imports already present in this file (`eq`, `and`, `ne`, `desc`, `ilike` — all confirmed already imported at the top of `server/storage.ts`).
- Produces (used by Task 3): `storage.getCategoryIdByMerchant(userId: number, merchant: string, type: string): Promise<number | null>`.

- [ ] **Step 1: Add the interface declaration**

Current code (`server/storage.ts`, ~lines 104-109):
```ts
  getTransactionByReferenceNumber(userId: number, referenceNumber: string): Promise<Transaction | undefined>;
  getTransactionByFallbackKey(userId: number, accountId: number, amount: string, type: string, date: Date): Promise<Transaction | undefined>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(id: number, transaction: Partial<InsertTransaction>): Promise<Transaction>;
  bulkUpdateTransactionCategory(userId: number, transactionIds: number[], categoryId: number): Promise<number>;
  deleteTransaction(id: number): Promise<boolean>;
```
Replace with:
```ts
  getTransactionByReferenceNumber(userId: number, referenceNumber: string): Promise<Transaction | undefined>;
  getTransactionByFallbackKey(userId: number, accountId: number, amount: string, type: string, date: Date): Promise<Transaction | undefined>;
  getCategoryIdByMerchant(userId: number, merchant: string, type: string): Promise<number | null>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(id: number, transaction: Partial<InsertTransaction>): Promise<Transaction>;
  bulkUpdateTransactionCategory(userId: number, transactionIds: number[], categoryId: number): Promise<number>;
  deleteTransaction(id: number): Promise<boolean>;
```

- [ ] **Step 2: Implement the method**

Current code (`server/storage.ts`, ~lines 450-453):
```ts
  async getCategoryByName(name: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.name, name));
    return category || undefined;
  }
```
Insert immediately after it:
```ts
  async getCategoryByName(name: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.name, name));
    return category || undefined;
  }

  // Looks up the category the user has already applied to their own prior transactions
  // from this exact merchant (same debit/credit type), most-recently-touched first, so
  // SMS auto-read can reuse a real category instead of calling out to AI suggestion. A
  // transaction categorized as "Other" never counts as a match. ne(transactions.categoryId,
  // otherCategoryId) already excludes rows with a NULL categoryId on its own — SQL's <>
  // comparison against NULL evaluates to NULL, which WHERE treats as no-match — so no
  // separate "IS NOT NULL" condition is needed.
  async getCategoryIdByMerchant(userId: number, merchant: string, type: string): Promise<number | null> {
    const otherCategory = await this.getCategoryByName("Other");

    const conditions = [
      eq(transactions.userId, userId),
      eq(transactions.type, type),
      ilike(transactions.merchant, merchant.trim()),
    ];
    if (otherCategory) {
      conditions.push(ne(transactions.categoryId, otherCategory.id));
    }

    const [result] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.updatedAt))
      .limit(1);

    return result?.categoryId ?? null;
  }
```
(`conditions.push(...)` into an array then spread into `and(...conditions)` is the same pattern already used by `getAllTransactions`'s filter-building code elsewhere in this file — no new query-building style introduced.)

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new `error TS` occurrences vs. baseline.

- [ ] **Step 4: Verify by inspection**

No live database available in this environment — verify by reading: confirm the method reads `Category | undefined` correctly from `getCategoryByName` (using `otherCategory.id`, not `otherCategory?.id` redundantly inside the already-guarded `if (otherCategory)` block); confirm `ilike(transactions.merchant, merchant.trim())` has **no** `%` wildcards (unlike the existing search-filter usage of `ilike` elsewhere in this file, which does use `%...%` — this one must be an exact case-insensitive match, not a substring search); confirm the `and(...conditions)` array always includes exactly 3 or 4 entries depending on whether `otherCategory` was found; confirm `.orderBy(desc(transactions.updatedAt))` references the column added in Task 1 (not `createdAt` or `transactionDate`).

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts
git commit -m "feat: add storage.getCategoryIdByMerchant for merchant-history lookup"
```

---

### Task 3: Wire merchant-history matching into both SMS category-resolution call sites

**Files:**
- Modify: `server/routes.ts` — new helper placed after `matchAccountBySender` (~line 3584-3588), and the two call sites: `finishWithTransaction` inside `processSingleSms` (~line 3828-3830, plus the later `if (category?.id) transactionData.categoryId = category.id;` line inside the same function), and `backfillQueuedSmsForMapping` (~line 4111-4113, plus its own later `if (category?.id) transactionData.categoryId = category.id;` line).

**Interfaces:**
- Consumes: `storage.getCategoryIdByMerchant` (Task 2), the existing `suggestCategory(description: string): Promise<string>` and `storage.getCategoryByName(name: string): Promise<Category | undefined>` (both already imported/used in this file, unchanged), `ParsedSmsData.type: "debit" | "credit"` (already the parsed SMS type, from `server/smsParser.ts`, unchanged by this plan).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Add the `resolveTransactionCategoryId` helper**

This single helper owns the entire category-resolution decision — merchant-history
match first, AI suggestion fallback second — so neither call site duplicates the
fallback glue (`suggestCategory` + `getCategoryByName`) itself.

Current code (`server/routes.ts`, the end of `matchAccountBySender` and the start of `suggestInstitutionName`, ~lines 3578-3589):
```ts
        (acc.accountNumber ?? "").endsWith(accountLastDigits)
      );
      if (exact) return exact;
    }

    return candidates[0];
  }

  // Best-effort display name for the "New Accounts Detected" review screen —
  // just a starting suggestion, the user edits/confirms it when mapping the institution.
  function suggestInstitutionName(message: string, institutionKey: string): string {
```
Replace with (inserts the new helper between the two existing functions):
```ts
        (acc.accountNumber ?? "").endsWith(accountLastDigits)
      );
      if (exact) return exact;
    }

    return candidates[0];
  }

  // Decides a transaction's category during SMS processing: first tries the user's own
  // prior categorization of this exact merchant (same debit/credit type), then falls back
  // to AI suggestion exactly as before this feature existed. A failure in the
  // merchant-history lookup itself (e.g. a DB error) falls through to AI suggestion rather
  // than blocking categorization — it must never throw out of this function.
  async function resolveTransactionCategoryId(
    userId: number,
    merchant: string | undefined,
    description: string | undefined,
    type: "debit" | "credit"
  ): Promise<number | null> {
    if (merchant) {
      try {
        const merchantCategoryId = await storage.getCategoryIdByMerchant(userId, merchant, type);
        if (merchantCategoryId) return merchantCategoryId;
      } catch (error) {
        console.error("Merchant-history category lookup failed, falling back to AI suggestion:", error);
      }
    }
    const categoryName = await suggestCategory(merchant || description || "");
    const category = await storage.getCategoryByName(categoryName);
    return category?.id ?? null;
  }

  // Best-effort display name for the "New Accounts Detected" review screen —
  // just a starting suggestion, the user edits/confirms it when mapping the institution.
  function suggestInstitutionName(message: string, institutionKey: string): string {
```

- [ ] **Step 2: Wire it into `finishWithTransaction`**

Current code (`server/routes.ts`, ~lines 3828-3830):
```ts
    const finishWithTransaction = async (account: (typeof accounts)[number]): Promise<ParseSmsResult> => {
      const categoryName = await suggestCategory(parsedData.merchant || parsedData.description || "");
      const category = await storage.getCategoryByName(categoryName);

      const transactionData: any = {
```
Replace with:
```ts
    const finishWithTransaction = async (account: (typeof accounts)[number]): Promise<ParseSmsResult> => {
      const categoryId = await resolveTransactionCategoryId(account.userId, parsedData.merchant, parsedData.description, parsedData.type);

      const transactionData: any = {
```

Then, further down in the same function, current code:
```ts
      if (parsedData.availableBalance !== undefined) transactionData.availableBalance = parsedData.availableBalance.toString();
      if (category?.id) transactionData.categoryId = category.id;
```
Replace with:
```ts
      if (parsedData.availableBalance !== undefined) transactionData.availableBalance = parsedData.availableBalance.toString();
      if (categoryId) transactionData.categoryId = categoryId;
```
(The local `category` variable no longer exists in this function after Step 2's first
replacement — this second edit is required for the file to still compile, not optional.)

- [ ] **Step 3: Wire it into `backfillQueuedSmsForMapping`**

Current code (`server/routes.ts`, ~lines 4103-4114):
```ts
  async function backfillQueuedSmsForMapping(mappingId: number, account: { id: number; userId: number }): Promise<number> {
    const queued = await storage.getQueuedSmsLogsForMapping(mappingId);
    let backfilled = 0;

    for (const smsLog of queued) {
      const parsedData = await parseSmsMessage(smsLog.message, smsLog.sender || undefined);
      if (!parsedData || !parsedData.amount) continue;

      const categoryName = await suggestCategory(parsedData.merchant || parsedData.description || "");
      const category = await storage.getCategoryByName(categoryName);

      const existingTransaction = parsedData.referenceNumber
```
Replace with:
```ts
  async function backfillQueuedSmsForMapping(mappingId: number, account: { id: number; userId: number }): Promise<number> {
    const queued = await storage.getQueuedSmsLogsForMapping(mappingId);
    let backfilled = 0;

    for (const smsLog of queued) {
      const parsedData = await parseSmsMessage(smsLog.message, smsLog.sender || undefined);
      if (!parsedData || !parsedData.amount) continue;

      const categoryId = await resolveTransactionCategoryId(account.userId, parsedData.merchant, parsedData.description, parsedData.type);

      const existingTransaction = parsedData.referenceNumber
```

Then, further down in the same function, current code:
```ts
      if (parsedData.availableBalance !== undefined) transactionData.availableBalance = parsedData.availableBalance.toString();
      if (category?.id) transactionData.categoryId = category.id;
```
Replace with:
```ts
      if (parsedData.availableBalance !== undefined) transactionData.availableBalance = parsedData.availableBalance.toString();
      if (categoryId) transactionData.categoryId = categoryId;
```

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new `error TS` occurrences vs. baseline.

- [ ] **Step 5: Verify by inspection**

No live database available in this environment — verify by reading: confirm `resolveTransactionCategoryId` is defined once, before both call sites use it (function declarations are hoisted in this file's style, but place it textually before its first use anyway for readability, matching where `matchAccountBySender` already sits relative to its own call sites); confirm neither call site references the old `category` variable name anywhere after your edits (search each function body for `category?.id` — there should be zero remaining occurrences in `finishWithTransaction` and `backfillQueuedSmsForMapping`, only `categoryId` truthiness checks, and neither function should have its own separate `suggestCategory`/`getCategoryByName` calls anymore — both now live only inside the shared helper); confirm `parsedData.type` and `parsedData.description` are both passed through at both call sites (not hardcoded, not omitted); confirm the two untouched `suggestCategory` call sites (bank-statement import at ~line 738, standalone `/api/suggest-category` endpoint at ~line 3521) are unmodified — grep the full diff for `suggestCategory` and confirm it now appears exactly once in the whole file's routes-registration scope (inside the new helper), with the two other pre-existing standalone call sites untouched.

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts
git commit -m "feat: try merchant-history category match before AI suggestion in SMS auto-read"
```

---

## Post-plan note for the human running this

`npm run db:push` must be run against the real database (outside this sandboxed environment) before this feature has any effect — the code changes alone don't touch the live schema. Nothing in this plan can verify the feature end-to-end without that step and a real device/SMS test, consistent with how every other backend change in this project has been verified (code inspection here, live confirmation by the user afterward).
