# Transaction Spending Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user flag an income transaction (PF advance, ITR refund…) as "spending tracked" and record a free-text breakdown of how that amount was spent, reusing the loan Spending Breakdown modal.

**Architecture:** A boolean flag on `transactions` plus a new `transaction_spending_entries` table (FK cascade) mirroring `loan_spending_entries`. Pure validation lives in a small unit-tested module; routes are thin. On mobile, `SpendingBreakdownModal` is generalized to a `loan | transaction` source; the edit screen gets an instant-save toggle; the list gets a "₹X left" badge and a filter chip.

**Tech Stack:** Express + Drizzle ORM (Postgres/Neon) server, Expo React Native + TanStack Query mobile. Tests: plain `tsx` scripts using `node:assert` (no test runner in this repo).

**Spec:** `docs/superpowers/specs/2026-09-28-transaction-spending-tracker-design.md`

## Global Constraints

- Work in a git worktree at `.worktrees/transaction-spending-tracker` (branch `transaction-spending-tracker`), created from `main`.
- Tracking is allowed on `type === 'credit'` transactions only.
- Entries are free text + amount only; no link to other transactions, no account-balance effect.
- Entries may never sum above the transaction `amount`; comparisons are in integer paise.
- Mobile app only — do not touch `client/`.
- Do NOT run `npm run db:push` or deploy during implementation — the only database is production Neon. That happens after merge, with the user's confirmation (see "After merge").
- Type-check baselines before this work: server `npm run check` → 14 errors (all pre-existing, in `routes.ts:1901` and `storage.ts`); mobile `cd mobile && npx tsc --noEmit` → 31 errors, none in files this plan touches. Neither count may go up.
- Tests run with `npx tsx server/__tests__/<file>.test.ts` from the repo root; they print `N passed, M failed` and exit 1 on failure.

## Review Focus

1. **Transaction amount edited below what's already allocated** → PATCH `/api/transactions/:id` returns 400 with a clear message (Task 1 `validateAmountChange` tests, wired in Task 3).
2. **Tracked transaction's type changed from Income to Expense/Transfer** → tracker flag is forced off, entries kept (Task 1 `resolveTrackerFlag` tests, wired in Task 3).
3. **Floating-point money sums** (0.10 + 0.20 into a 0.30 total) → accepted, not rejected as "exceeds" (Task 1 paise tests on `validateNewSpendingEntry`).
4. **Editing an existing entry's amount** → validated against the *other* entries only, so re-saving an entry at the full remaining amount works (Task 1 test using siblings, wired in Task 3).
5. **Deleting a transaction, or an account with tracked transactions** → entries go with it, no FK error (Task 2 cascade; verified by reading the generated schema — no DB test infra here).

---

### Task 1: Pure validation (money in paise, tracker rules)

**Files:**
- Modify: `server/loanSpendingValidation.ts`
- Create: `server/transactionSpendingValidation.ts`
- Test: `server/__tests__/loanSpendingValidation.test.ts` (add cases)
- Test: `server/__tests__/transactionSpendingValidation.test.ts` (new)

**Interfaces:**
- Produces:
  - `toPaise(value: number): number` (exported from `loanSpendingValidation.ts`)
  - `validateNewSpendingEntry(receivedAmount: string | null, existingEntries: { amount: string }[], newAmount: number): string | null` — unchanged signature, now paise-based
  - `validateTrackerToggle(type: string, requested: boolean | undefined): string | null`
  - `resolveTrackerFlag(newType: string, requested: boolean | undefined, current: boolean): boolean | undefined`
  - `validateEntryWrite(tx: { type: string; spendingTrackerEnabled: boolean }): string | null`
  - `validateAmountChange(newAmount: number, entries: { amount: string }[]): string | null`

- [ ] **Step 1: Add failing paise tests to the loan validation test file**

Insert before the final `console.log(\`\n${passed} passed…` line of `server/__tests__/loanSpendingValidation.test.ts`:

```ts
test("accepts entries that exactly fill the total despite float rounding", () => {
  const existing = [{ amount: "0.10" }];
  const result = validateNewSpendingEntry("0.30", existing, 0.2);
  assert.equal(result, null);
});

test("accepts an entry for exactly the remaining amount with paise", () => {
  const existing = [{ amount: "1000.35" }, { amount: "2000.40" }];
  const result = validateNewSpendingEntry("5000.00", existing, 1999.25);
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run to verify the first new test fails**

Run: `npx tsx server/__tests__/loanSpendingValidation.test.ts`
Expected: `❌ accepts entries that exactly fill the total despite float rounding` and exit code 1.

- [ ] **Step 3: Switch `validateNewSpendingEntry` to paise**

Replace the body of `server/loanSpendingValidation.ts` after the header comment with:

```ts
// Money is compared in integer paise so float sums like 0.1 + 0.2 don't spuriously exceed 0.3.
export function toPaise(value: number): number {
  return Math.round(value * 100);
}

export function validateNewSpendingEntry(
  receivedAmount: string | null,
  existingEntries: { amount: string }[],
  newAmount: number
): string | null {
  if (receivedAmount === null) {
    return "Set the received amount before adding entries";
  }
  if (!(newAmount > 0)) {
    return "Amount must be greater than 0";
  }
  const received = toPaise(parseFloat(receivedAmount));
  const allocated = existingEntries.reduce((sum, e) => sum + toPaise(parseFloat(e.amount)), 0);
  if (allocated + toPaise(newAmount) > received) {
    const remaining = (received - allocated) / 100;
    return `This would exceed the received amount — ₹${remaining.toFixed(2)} remaining to allocate`;
  }
  return null;
}
```

- [ ] **Step 4: Run loan tests — all pass**

Run: `npx tsx server/__tests__/loanSpendingValidation.test.ts`
Expected: `0 failed`.

- [ ] **Step 5: Write the failing transaction validation tests**

Create `server/__tests__/transactionSpendingValidation.test.ts`:

```ts
import assert from "node:assert/strict";
import { validateNewSpendingEntry } from "../loanSpendingValidation";
import {
  validateTrackerToggle,
  resolveTrackerFlag,
  validateEntryWrite,
  validateAmountChange,
} from "../transactionSpendingValidation";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

console.log("\n=== Transaction Spending Validation Tests ===\n");

// validateTrackerToggle
test("allows enabling tracker on a credit transaction", () => {
  assert.equal(validateTrackerToggle("credit", true), null);
});
test("rejects enabling tracker on a debit transaction", () => {
  assert.match(validateTrackerToggle("debit", true)!, /income/i);
});
test("rejects enabling tracker on a transfer transaction", () => {
  assert.match(validateTrackerToggle("transfer", true)!, /income/i);
});
test("allows disabling tracker on any type", () => {
  assert.equal(validateTrackerToggle("debit", false), null);
});
test("allows an update that doesn't mention the tracker", () => {
  assert.equal(validateTrackerToggle("debit", undefined), null);
});

// resolveTrackerFlag
test("forces tracker off when a tracked transaction becomes a debit", () => {
  assert.equal(resolveTrackerFlag("debit", undefined, true), false);
});
test("forces tracker off when a tracked transaction becomes a transfer", () => {
  assert.equal(resolveTrackerFlag("transfer", undefined, true), false);
});
test("leaves an untouched flag alone on a credit", () => {
  assert.equal(resolveTrackerFlag("credit", undefined, true), undefined);
});
test("passes through an explicit request on a credit", () => {
  assert.equal(resolveTrackerFlag("credit", true, false), true);
});
test("leaves an untracked debit untouched", () => {
  assert.equal(resolveTrackerFlag("debit", undefined, false), undefined);
});

// validateEntryWrite
test("allows entries on a tracked credit", () => {
  assert.equal(validateEntryWrite({ type: "credit", spendingTrackerEnabled: true }), null);
});
test("rejects entries on a debit", () => {
  assert.match(validateEntryWrite({ type: "debit", spendingTrackerEnabled: true })!, /income/i);
});
test("rejects entries when tracker is off", () => {
  assert.match(validateEntryWrite({ type: "credit", spendingTrackerEnabled: false })!, /turn on/i);
});

// validateAmountChange
test("allows lowering amount to exactly the allocated total", () => {
  assert.equal(validateAmountChange(3000, [{ amount: "1000" }, { amount: "2000" }]), null);
});
test("rejects lowering amount below the allocated total", () => {
  assert.match(validateAmountChange(2999.99, [{ amount: "1000" }, { amount: "2000" }])!, /3000\.00/);
});
test("allows any positive amount when there are no entries", () => {
  assert.equal(validateAmountChange(1, []), null);
});

// Entry edit re-validation uses siblings only (how the PATCH route calls it)
test("editing an entry up to the full remaining amount is allowed", () => {
  const entries = [{ id: 1, amount: "40000" }, { id: 2, amount: "10000" }];
  const siblings = entries.filter(e => e.id !== 2);
  assert.equal(validateNewSpendingEntry("100000", siblings, 60000), null);
});
test("editing an entry past the total is rejected", () => {
  const entries = [{ id: 1, amount: "40000" }, { id: 2, amount: "10000" }];
  const siblings = entries.filter(e => e.id !== 2);
  assert.match(validateNewSpendingEntry("100000", siblings, 60000.01)!, /exceed/i);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx tsx server/__tests__/transactionSpendingValidation.test.ts`
Expected: error — cannot find module `../transactionSpendingValidation`.

- [ ] **Step 7: Implement the module**

Create `server/transactionSpendingValidation.ts`:

```ts
// Pure validation for transaction spending tracking — kept separate from routes.ts so it can
// be unit tested without a database, following the same pattern as loanSpendingValidation.ts.
import { toPaise } from "./loanSpendingValidation";

const INCOME_ONLY = "Spending tracking is only available for income transactions";

// Rejects turning the tracker on for anything but an income transaction.
export function validateTrackerToggle(type: string, requested: boolean | undefined): string | null {
  if (requested === true && type !== "credit") return INCOME_ONLY;
  return null;
}

// When a tracked transaction stops being income, the tracker is forced off (entries are kept).
// Returns the value to write, or undefined to leave the column untouched.
export function resolveTrackerFlag(newType: string, requested: boolean | undefined, current: boolean): boolean | undefined {
  if (newType !== "credit" && current) return false;
  return requested;
}

export function validateEntryWrite(tx: { type: string; spendingTrackerEnabled: boolean }): string | null {
  if (tx.type !== "credit") return INCOME_ONLY;
  if (!tx.spendingTrackerEnabled) return "Turn on spending tracking for this transaction first";
  return null;
}

// A tracked transaction's amount can't drop below what its breakdown already allocates.
export function validateAmountChange(newAmount: number, entries: { amount: string }[]): string | null {
  const allocated = entries.reduce((sum, e) => sum + toPaise(parseFloat(e.amount)), 0);
  if (toPaise(newAmount) < allocated) {
    return `Amount can't be lower than the ₹${(allocated / 100).toFixed(2)} already allocated in its spending breakdown`;
  }
  return null;
}
```

- [ ] **Step 8: Run both test files — all pass**

Run: `npx tsx server/__tests__/transactionSpendingValidation.test.ts && npx tsx server/__tests__/loanSpendingValidation.test.ts`
Expected: both print `0 failed`.

- [ ] **Step 9: Commit**

```bash
git add server/loanSpendingValidation.ts server/transactionSpendingValidation.ts server/__tests__/loanSpendingValidation.test.ts server/__tests__/transactionSpendingValidation.test.ts
git commit -m "feat(spending): paise-safe allocation checks and transaction tracker validation"
```

---

### Task 2: Schema + storage

**Files:**
- Modify: `shared/schema.ts` (transactions table ~line 116; after loan spending entry types ~line 827; `TransactionWithRelations` ~line 1251)
- Modify: `server/storage.ts` (imports lines 1–38; `IStorage` ~line 240; `getAllTransactions` ~line 568; `getTransaction` ~line 645; loan spending methods ~line 2606)

**Interfaces:**
- Produces:
  - Column `transactions.spendingTrackerEnabled: boolean` (not null, default false)
  - Table `transactionSpendingEntries`; types `TransactionSpendingEntry`, `InsertTransactionSpendingEntry`; schema `insertTransactionSpendingEntrySchema`
  - `TransactionWithRelations.spendingAllocated?: string | null` — `null` when not tracked, else sum of entry amounts (`"0"` if none)
  - `storage.getTransactionSpendingEntries(transactionId: number): Promise<TransactionSpendingEntry[]>`
  - `storage.createTransactionSpendingEntry(entry: InsertTransactionSpendingEntry): Promise<TransactionSpendingEntry>`
  - `storage.updateTransactionSpendingEntry(id: number, data: { amount?: string; reason?: string | null }): Promise<TransactionSpendingEntry | undefined>`
  - `storage.deleteTransactionSpendingEntry(id: number): Promise<boolean>`

- [ ] **Step 1: Add the flag column**

In `shared/schema.ts`, in the `transactions` pgTable, after the `paymentOccurrenceId` line add:

```ts
  spendingTrackerEnabled: boolean("spending_tracker_enabled").notNull().default(false), // user tracks how this income was spent (transaction_spending_entries)
```

- [ ] **Step 2: Add the entries table**

In `shared/schema.ts`, directly after `export type LoanSpendingEntry = typeof loanSpendingEntries.$inferSelect;` add:

```ts

// Transaction Spending Entries (how a lump-sum income transaction — PF advance, ITR refund — was
// actually spent; pure record-keeping, no account-balance link). Cascade so every transaction
// delete path (single delete, account delete) cleans these up.
export const transactionSpendingEntries = pgTable("transaction_spending_entries", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "cascade" }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transactionSpendingEntriesRelations = relations(transactionSpendingEntries, ({ one }) => ({
  transaction: one(transactions, { fields: [transactionSpendingEntries.transactionId], references: [transactions.id] }),
}));

export const insertTransactionSpendingEntrySchema = createInsertSchema(transactionSpendingEntries).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.string().min(1, "Amount is required"),
  reason: z.string().optional(),
});

export type InsertTransactionSpendingEntry = z.infer<typeof insertTransactionSpendingEntrySchema>;
export type TransactionSpendingEntry = typeof transactionSpendingEntries.$inferSelect;
```

- [ ] **Step 3: Extend `TransactionWithRelations`**

In `shared/schema.ts`, change:

```ts
export type TransactionWithRelations = Transaction & {
  account?: Account | null;
  toAccount?: Account | null;
  category?: Category | null;
};
```

to:

```ts
export type TransactionWithRelations = Transaction & {
  account?: Account | null;
  toAccount?: Account | null;
  category?: Category | null;
  spendingAllocated?: string | null; // sum of spending entries when spendingTrackerEnabled, else null
};
```

- [ ] **Step 4: Storage imports**

In `server/storage.ts`, add `transactionSpendingEntries,` to the value import list next to `loanSpendingEntries,` (line 4), and `type TransactionSpendingEntry, type InsertTransactionSpendingEntry,` next to `type LoanSpendingEntry, type InsertLoanSpendingEntry,` (line 21).

- [ ] **Step 5: Interface methods**

In `IStorage`, after `deleteLoanSpendingEntry(id: number): Promise<boolean>;` add:

```ts
  getTransactionSpendingEntries(transactionId: number): Promise<TransactionSpendingEntry[]>;
  createTransactionSpendingEntry(entry: InsertTransactionSpendingEntry): Promise<TransactionSpendingEntry>;
  updateTransactionSpendingEntry(id: number, data: { amount?: string; reason?: string | null }): Promise<TransactionSpendingEntry | undefined>;
  deleteTransactionSpendingEntry(id: number): Promise<boolean>;
```

- [ ] **Step 6: Implementations**

After the `deleteLoanSpendingEntry` implementation (~line 2625) add:

```ts

  async getTransactionSpendingEntries(transactionId: number): Promise<TransactionSpendingEntry[]> {
    return db.select().from(transactionSpendingEntries)
      .where(eq(transactionSpendingEntries.transactionId, transactionId))
      .orderBy(desc(transactionSpendingEntries.createdAt));
  }

  async createTransactionSpendingEntry(entry: InsertTransactionSpendingEntry): Promise<TransactionSpendingEntry> {
    const [newEntry] = await db.insert(transactionSpendingEntries).values(entry).returning();
    return newEntry;
  }

  async updateTransactionSpendingEntry(id: number, data: { amount?: string; reason?: string | null }): Promise<TransactionSpendingEntry | undefined> {
    const [updated] = await db.update(transactionSpendingEntries)
      .set(data)
      .where(eq(transactionSpendingEntries.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteTransactionSpendingEntry(id: number): Promise<boolean> {
    const result = await db.delete(transactionSpendingEntries).where(eq(transactionSpendingEntries.id, id)).returning();
    return result.length > 0;
  }
```

- [ ] **Step 7: Select the flag in both transaction reads**

In **both** `getAllTransactions` and `getTransaction`, in the explicit `db.select({ ... })` column list, after `paymentOccurrenceId: transactions.paymentOccurrenceId,` add:

```ts
      spendingTrackerEnabled: transactions.spendingTrackerEnabled,
```

- [ ] **Step 8: Attach `spendingAllocated` in `getAllTransactions`**

In `getAllTransactions`, replace:

```ts
    const results = await query;
    return results as TransactionWithRelations[];
```

with:

```ts
    const results = await query as TransactionWithRelations[];

    // One grouped query for all tracked rows (no N+1) so the list can show "₹X left".
    const trackedIds = results.filter(r => r.spendingTrackerEnabled).map(r => r.id);
    const allocatedById = new Map<number, string>();
    if (trackedIds.length > 0) {
      const rows = await db.select({
        transactionId: transactionSpendingEntries.transactionId,
        total: sql<string>`COALESCE(SUM(${transactionSpendingEntries.amount}), 0)`,
      })
        .from(transactionSpendingEntries)
        .where(inArray(transactionSpendingEntries.transactionId, trackedIds))
        .groupBy(transactionSpendingEntries.transactionId);
      for (const row of rows) allocatedById.set(row.transactionId, String(row.total));
    }
    return results.map(r => ({
      ...r,
      spendingAllocated: r.spendingTrackerEnabled ? (allocatedById.get(r.id) ?? "0") : null,
    }));
```

- [ ] **Step 9: Type-check**

Run: `npm run check 2>&1 | grep -c "error TS"`
Expected: `14` (unchanged baseline). If higher, run `npm run check 2>&1 | grep "error TS" | grep -E "schema.ts|storage.ts"` and fix only the new ones.

- [ ] **Step 10: Confirm the cascade is declared**

Run: `grep -n 'onDelete: "cascade"' shared/schema.ts`
Expected: a line inside `transactionSpendingEntries`. (No DB push here — see Global Constraints.)

- [ ] **Step 11: Commit**

```bash
git add shared/schema.ts server/storage.ts
git commit -m "feat(spending): transaction spending tracker schema and storage"
```

---

### Task 3: API routes

**Files:**
- Modify: `server/routes.ts` (imports ~line 33; `PATCH /api/transactions/:id` ~line 1097; new routes after `DELETE /api/transactions/:id` handler)

**Interfaces:**
- Consumes: Task 1 validators; Task 2 storage methods and `transaction.spendingTrackerEnabled`.
- Produces (all behind `authenticateToken`, 404 `{ error: "Transaction not found" }` if not the user's):
  - `GET    /api/transactions/:id/spending-entries` → `TransactionSpendingEntry[]`
  - `POST   /api/transactions/:id/spending-entries` body `{ amount: string, reason?: string }` → 201 entry
  - `PATCH  /api/transactions/:id/spending-entries/:entryId` body `{ amount?: string, reason?: string | null }` → entry
  - `DELETE /api/transactions/:id/spending-entries/:entryId` → 204
  - `PATCH  /api/transactions/:id` now accepts `spendingTrackerEnabled: boolean`

- [ ] **Step 1: Imports**

Next to `import { validateNewSpendingEntry } from "./loanSpendingValidation";` add:

```ts
import { validateTrackerToggle, resolveTrackerFlag, validateEntryWrite, validateAmountChange } from "./transactionSpendingValidation";
```

- [ ] **Step 2: Guard the transaction PATCH**

In `app.patch("/api/transactions/:id", ...)`, replace:

```ts
      const validatedData = insertTransactionSchema.partial().parse(req.body);
      const updated = await storage.updateTransaction(transactionId, validatedData);
```

with:

```ts
      const validatedData = insertTransactionSchema.partial().parse(req.body);

      // Spending tracker rules: income only; switching a tracked transaction away from income
      // turns tracking off (entries kept); amount can't drop below the allocated breakdown.
      const newType = validatedData.type ?? transaction.type;
      const toggleError = validateTrackerToggle(newType, validatedData.spendingTrackerEnabled);
      if (toggleError) {
        return res.status(400).json({ error: toggleError });
      }
      const trackerFlag = resolveTrackerFlag(newType, validatedData.spendingTrackerEnabled, transaction.spendingTrackerEnabled);
      if (trackerFlag !== undefined) {
        validatedData.spendingTrackerEnabled = trackerFlag;
      }
      const stillTracked = validatedData.spendingTrackerEnabled ?? transaction.spendingTrackerEnabled;
      if (validatedData.amount !== undefined && stillTracked) {
        const entries = await storage.getTransactionSpendingEntries(transactionId);
        const amountError = validateAmountChange(parseFloat(validatedData.amount), entries);
        if (amountError) {
          return res.status(400).json({ error: amountError });
        }
      }

      const updated = await storage.updateTransaction(transactionId, validatedData);
```

- [ ] **Step 3: Entry routes**

Immediately after the closing `});` of `app.delete("/api/transactions/:id", ...)` add:

```ts

  // ========== Transaction Spending Entries ==========
  // How a lump-sum income transaction was spent — mirrors the loan spending-entry routes.

  const loadOwnedTransaction = async (userId: number, idParam: string) => {
    const transaction = await storage.getTransaction(parseInt(idParam));
    return transaction && transaction.userId === userId ? transaction : null;
  };

  app.get("/api/transactions/:id/spending-entries", authenticateToken, async (req, res) => {
    try {
      const transaction = await loadOwnedTransaction(req.user!.userId, req.params.id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      const entries = await storage.getTransactionSpendingEntries(transaction.id);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch spending entries" });
    }
  });

  app.post("/api/transactions/:id/spending-entries", authenticateToken, async (req, res) => {
    try {
      const transaction = await loadOwnedTransaction(req.user!.userId, req.params.id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      const writeError = validateEntryWrite(transaction);
      if (writeError) {
        return res.status(400).json({ error: writeError });
      }

      const { amount, reason } = req.body;
      const existingEntries = await storage.getTransactionSpendingEntries(transaction.id);
      const validationError = validateNewSpendingEntry(transaction.amount, existingEntries, parseFloat(amount));
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const entry = await storage.createTransactionSpendingEntry({ transactionId: transaction.id, amount, reason: reason || null });
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid spending entry data" });
    }
  });

  app.patch("/api/transactions/:id/spending-entries/:entryId", authenticateToken, async (req, res) => {
    try {
      const transaction = await loadOwnedTransaction(req.user!.userId, req.params.id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      const writeError = validateEntryWrite(transaction);
      if (writeError) {
        return res.status(400).json({ error: writeError });
      }

      const entryId = parseInt(req.params.entryId);
      const entries = await storage.getTransactionSpendingEntries(transaction.id);
      if (!entries.some(e => e.id === entryId)) {
        return res.status(404).json({ error: "Spending entry not found" });
      }

      const { amount, reason } = req.body;
      if (amount !== undefined) {
        // Re-validate against the other entries only, so this entry's old amount isn't double-counted.
        const siblings = entries.filter(e => e.id !== entryId);
        const validationError = validateNewSpendingEntry(transaction.amount, siblings, parseFloat(amount));
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }
      }

      const updated = await storage.updateTransactionSpendingEntry(entryId, {
        ...(amount !== undefined ? { amount } : {}),
        ...(reason !== undefined ? { reason: reason || null } : {}),
      });
      if (!updated) {
        return res.status(404).json({ error: "Spending entry not found" });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid spending entry data" });
    }
  });

  app.delete("/api/transactions/:id/spending-entries/:entryId", authenticateToken, async (req, res) => {
    try {
      const transaction = await loadOwnedTransaction(req.user!.userId, req.params.id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      const entryId = parseInt(req.params.entryId);
      const entries = await storage.getTransactionSpendingEntries(transaction.id);
      if (!entries.some(e => e.id === entryId)) {
        return res.status(404).json({ error: "Spending entry not found" });
      }
      await storage.deleteTransactionSpendingEntry(entryId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete spending entry" });
    }
  });
```

- [ ] **Step 4: Type-check and re-run tests**

Run: `npm run check 2>&1 | grep -c "error TS"` → Expected `14`.
Run: `npx tsx server/__tests__/transactionSpendingValidation.test.ts && npx tsx server/__tests__/loanSpendingValidation.test.ts` → both `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat(spending): transaction spending entry routes and tracker guards on PATCH"
```

---

### Task 4: Mobile types, API client, and generalized modal

**Files:**
- Modify: `mobile/src/lib/types.ts` (`Transaction` ~line 88, `InsertTransaction` ~line 336, after `InsertLoanSpendingEntry` ~line 542)
- Modify: `mobile/src/lib/api.ts` (import line 8; after `deleteTransaction` ~line 354)
- Modify: `mobile/src/components/SpendingBreakdownModal.tsx`
- Modify: `mobile/src/screens/LoanDetailsScreen.tsx:2397-2401`, `mobile/src/screens/AddLoanScreen.tsx:1023-1027`

**Interfaces:**
- Consumes: Task 3 endpoints.
- Produces:
  - `Transaction.spendingTrackerEnabled?: boolean`, `Transaction.spendingAllocated?: string | null`, `InsertTransaction.spendingTrackerEnabled?: boolean`
  - `interface TransactionSpendingEntry { id: number; transactionId: number; amount: string; reason: string | null; createdAt: string }`
  - `api.getTransactionSpendingEntries(transactionId)`, `api.createTransactionSpendingEntry(transactionId, data: InsertLoanSpendingEntry)`, `api.updateTransactionSpendingEntry(transactionId, id, data)`, `api.deleteTransactionSpendingEntry(transactionId, id)`
  - `export type SpendingSource = { kind: 'loan'; loanId: number } | { kind: 'transaction'; transactionId: number; amount: string }`
  - `<SpendingBreakdownModal source={SpendingSource} visible onClose />` (replaces the `loanId` prop)

- [ ] **Step 1: Types**

In `mobile/src/lib/types.ts`, in `interface Transaction` after `paymentOccurrenceId?: number | null;` add:

```ts
  spendingTrackerEnabled?: boolean;
  spendingAllocated?: string | null;
```

In `interface InsertTransaction` after `paymentOccurrenceId?: number;` add:

```ts
  spendingTrackerEnabled?: boolean;
```

After the `InsertLoanSpendingEntry` interface add:

```ts

export interface TransactionSpendingEntry {
  id: number;
  transactionId: number;
  amount: string;
  reason: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: API client**

In `mobile/src/lib/api.ts`, add `TransactionSpendingEntry,` to the type import on line 8 (after `InsertLoanSpendingEntry,`). After the `deleteTransaction` entry add:

```ts
  getTransactionSpendingEntries: (transactionId: number) =>
    apiRequest<TransactionSpendingEntry[]>(`/api/transactions/${transactionId}/spending-entries`),
  createTransactionSpendingEntry: (transactionId: number, data: InsertLoanSpendingEntry) =>
    apiRequest<TransactionSpendingEntry>(`/api/transactions/${transactionId}/spending-entries`, { method: 'POST', body: JSON.stringify(data) }),
  updateTransactionSpendingEntry: (transactionId: number, id: number, data: { amount?: string; reason?: string | null }) =>
    apiRequest<TransactionSpendingEntry>(`/api/transactions/${transactionId}/spending-entries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransactionSpendingEntry: (transactionId: number, id: number) =>
    apiRequest<void>(`/api/transactions/${transactionId}/spending-entries/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Modal — props and data sources**

In `mobile/src/components/SpendingBreakdownModal.tsx`:

Change the type import to:

```ts
import type { LoanSpendingEntry, TransactionSpendingEntry, InsertLoanSpendingEntry } from '../lib/types';
```

Replace the props interface and function signature:

```ts
interface SpendingBreakdownModalProps {
  loanId: number;
  visible: boolean;
  onClose: () => void;
}

export default function SpendingBreakdownModal({ loanId, visible, onClose }: SpendingBreakdownModalProps) {
```

with:

```ts
// A loan's breakdown is measured against its editable received amount; a transaction's against
// its own (fixed) amount.
export type SpendingSource =
  | { kind: 'loan'; loanId: number }
  | { kind: 'transaction'; transactionId: number; amount: string };

type SpendingEntry = LoanSpendingEntry | TransactionSpendingEntry;

interface SpendingBreakdownModalProps {
  source: SpendingSource;
  visible: boolean;
  onClose: () => void;
}

export default function SpendingBreakdownModal({ source, visible, onClose }: SpendingBreakdownModalProps) {
  const isLoan = source.kind === 'loan';
  const loanId = source.kind === 'loan' ? source.loanId : null;
  const transactionId = source.kind === 'transaction' ? source.transactionId : null;
  const transactionAmount = source.kind === 'transaction' ? source.amount : null;
  const entriesKey = isLoan ? ['loan-spending-entries', loanId] : ['transaction-spending-entries', transactionId];
```

Replace the two queries:

```ts
  const { data: loan } = useQuery({
    queryKey: ['/api/loans', loanId],
    queryFn: () => api.getLoan(loanId),
    enabled: visible,
  });

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ['loan-spending-entries', loanId],
    queryFn: () => api.getLoanSpendingEntries(loanId),
    enabled: visible,
  });
```

with:

```ts
  const { data: loan } = useQuery({
    queryKey: ['/api/loans', loanId],
    queryFn: () => api.getLoan(loanId!),
    enabled: visible && isLoan,
  });

  const { data: entries, isLoading: entriesLoading } = useQuery<SpendingEntry[]>({
    queryKey: entriesKey,
    queryFn: () => isLoan ? api.getLoanSpendingEntries(loanId!) : api.getTransactionSpendingEntries(transactionId!),
    enabled: visible,
  });

  // Entry changes also move the "₹X left" badge on the Transactions list.
  const invalidateEntries = () => {
    queryClient.invalidateQueries({ queryKey: entriesKey });
    if (!isLoan) queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
  };
```

- [ ] **Step 4: Modal — mutations**

In `saveReceivedAmountMutation`, change `api.updateLoan(loanId, …)` to `api.updateLoan(loanId!, …)`; its `invalidateQueries` calls stay as-is (loan-only).

Replace the three entry mutations with:

```ts
  const addEntryMutation = useMutation({
    mutationFn: () => {
      const data: InsertLoanSpendingEntry = { amount: newEntryAmount, reason: newEntryReason.trim() || undefined };
      return isLoan ? api.createLoanSpendingEntry(loanId!, data) : api.createTransactionSpendingEntry(transactionId!, data);
    },
    onSuccess: () => {
      invalidateEntries();
      setNewEntryAmount('');
      setNewEntryReason('');
      setShowAddForm(false);
      Toast.show({ type: 'success', text1: 'Entry added', position: 'bottom' });
    },
    onError: (error: any) => {
      Toast.show({ type: 'error', text1: 'Could not add entry', text2: error?.message || 'Try a smaller amount', position: 'bottom' });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => isLoan ? api.deleteLoanSpendingEntry(id) : api.deleteTransactionSpendingEntry(transactionId!, id),
    onSuccess: () => {
      invalidateEntries();
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to delete entry', position: 'bottom' });
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: (id: number) => {
      const data = { amount: editEntryAmount, reason: editEntryReason.trim() || null };
      return isLoan ? api.updateLoanSpendingEntry(id, data) : api.updateTransactionSpendingEntry(transactionId!, id, data);
    },
    onSuccess: () => {
      invalidateEntries();
      setEditingEntryId(null);
      setEditEntryAmount('');
      setEditEntryReason('');
      Toast.show({ type: 'success', text1: 'Entry updated', position: 'bottom' });
    },
    onError: (error: any) => {
      Toast.show({ type: 'error', text1: 'Could not update entry', text2: error?.message || 'Try a smaller amount', position: 'bottom' });
    },
  });
```

- [ ] **Step 5: Modal — totals, loading guard, entry type**

Replace:

```ts
  const received = loan?.receivedAmount ? parseFloat(loan.receivedAmount) : null;
```

with:

```ts
  const received = isLoan
    ? (loan?.receivedAmount ? parseFloat(loan.receivedAmount) : null)
    : parseFloat(transactionAmount!);
```

Change `const handleStartEditEntry = (entry: LoanSpendingEntry) => {` to `const handleStartEditEntry = (entry: SpendingEntry) => {`.

Change the loading guard `if (!loan) {` to `if (isLoan && !loan) {`.

- [ ] **Step 6: Modal — render the header block per source**

Replace the two header fields (from the `<View style={styles.field}>` containing "Loan Amount" through the closing `</View>` of the "Received Amount" field, i.e. everything inside the `<ScrollView>` before `{received !== null && (`) with:

```tsx
            {isLoan && loan ? (
              <>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Loan Amount</Text>
                  <Text style={[styles.readOnlyValue, { color: colors.text }]}>{formatCurrency(parseFloat(loan.principalAmount))}</Text>
                </View>

                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Received Amount</Text>
                  <View style={styles.receivedRow}>
                    <View style={[styles.amountInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                      <TextInput
                        style={[styles.amountInput, { color: colors.text }]}
                        keyboardType="decimal-pad"
                        value={receivedAmountInput}
                        onChangeText={setReceivedAmountInput}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                    <TouchableOpacity
                      style={[styles.saveButton, { backgroundColor: colors.primary, opacity: !receivedAmountChanged ? 0.5 : 1 }]}
                      onPress={handleSaveReceivedAmount}
                      disabled={saveReceivedAmountMutation.isPending || !receivedAmountChanged}
                    >
                      {saveReceivedAmountMutation.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.saveButtonText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {received === null && (
                    <Text style={[styles.unsavedHint, { color: '#f59e0b' }]}>
                      Not saved yet — this is just a suggestion based on the loan amount. Tap Save to confirm it before adding entries.
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Credited Amount</Text>
                <Text style={[styles.readOnlyValue, { color: colors.text }]}>{formatCurrency(received!)}</Text>
              </View>
            )}
```

The allocated line, entries list, and Add Entry row stay unchanged — for a transaction `received` is never null, so the "save received amount first" branch never shows.

- [ ] **Step 7: Update loan callers**

In `mobile/src/screens/LoanDetailsScreen.tsx` and `mobile/src/screens/AddLoanScreen.tsx`, change `loanId={loanId}` on `<SpendingBreakdownModal` to:

```tsx
          source={{ kind: 'loan', loanId }}
```

- [ ] **Step 8: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `31`.
Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -E "SpendingBreakdownModal|LoanDetailsScreen|AddLoanScreen|lib/api|lib/types"` → Expected no output.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/components/SpendingBreakdownModal.tsx mobile/src/screens/LoanDetailsScreen.tsx mobile/src/screens/AddLoanScreen.tsx
git commit -m "feat(spending): generalize SpendingBreakdownModal to loans and transactions"
```

---

### Task 5: Edit transaction screen — toggle + breakdown button

**Files:**
- Modify: `mobile/src/screens/AddTransactionScreen.tsx`

**Interfaces:**
- Consumes: `api.updateTransaction(id, { spendingTrackerEnabled })`, `SpendingBreakdownModal` with `source={{ kind: 'transaction', transactionId, amount }}`, `Transaction.spendingTrackerEnabled`.

- [ ] **Step 1: Imports**

Add `Switch` to the `react-native` import on line 2, and after the `api` import add:

```ts
import SpendingBreakdownModal from '../components/SpendingBreakdownModal';
```

- [ ] **Step 2: State, saved transaction, and toggle mutation**

Directly after the `updateMutation` `useMutation({ ... });` block add:

```tsx
  const [spendingBreakdownVisible, setSpendingBreakdownVisible] = useState(false);

  // Tracker state comes from the saved transaction, not the unsaved form, so an in-progress
  // type change on screen can't toggle tracking on an expense.
  const savedTransaction = isEditMode ? transactions?.find(t => t.id === Number(transactionId)) : undefined;

  const trackerMutation = useMutation({
    mutationFn: (enabled: boolean) => api.updateTransaction(Number(transactionId), { spendingTrackerEnabled: enabled }),
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      Toast.show({ type: 'success', text1: enabled ? 'Spending tracking on' : 'Spending tracking off', position: 'bottom' });
    },
    onError: (error: any) => {
      Toast.show({ type: 'error', text1: 'Could not update spending tracking', text2: error?.message, position: 'bottom' });
    },
  });
```

- [ ] **Step 3: Toggle card above the submit button**

Immediately before the `<TouchableOpacity` whose style is `styles.submitButton`, add:

```tsx
      {savedTransaction?.type === 'credit' && (
        <View style={[styles.trackerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.trackerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.trackerLabel, { color: colors.text }]}>Track spending</Text>
              <Text style={[styles.trackerDescription, { color: colors.textMuted }]}>
                Record how this amount gets spent — e.g. PF advance, ITR refund
              </Text>
            </View>
            <Switch
              value={trackerMutation.isPending ? !!trackerMutation.variables : !!savedTransaction.spendingTrackerEnabled}
              onValueChange={(v) => trackerMutation.mutate(v)}
              disabled={trackerMutation.isPending}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {savedTransaction.spendingTrackerEnabled && (
            <TouchableOpacity
              style={[styles.breakdownButton, { borderColor: colors.primary }]}
              onPress={() => setSpendingBreakdownVisible(true)}
            >
              <Ionicons name="pie-chart-outline" size={18} color={colors.primary} />
              <Text style={[styles.breakdownButtonText, { color: colors.primary }]}>Spending Breakdown</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}
```

- [ ] **Step 4: Mount the modal**

Immediately before the screen's final closing `</ScrollView>` in the returned JSX, add:

```tsx
      {savedTransaction?.spendingTrackerEnabled && (
        <SpendingBreakdownModal
          source={{ kind: 'transaction', transactionId: savedTransaction.id, amount: savedTransaction.amount }}
          visible={spendingBreakdownVisible}
          onClose={() => setSpendingBreakdownVisible(false)}
        />
      )}
```

- [ ] **Step 5: Styles**

Add to the `StyleSheet.create({ ... })` object:

```ts
  trackerCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  trackerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  trackerLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  trackerDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  breakdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  breakdownButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
```

- [ ] **Step 6: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `31`.
Run: `cd mobile && npx tsc --noEmit 2>&1 | grep AddTransactionScreen` → Expected no output.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/screens/AddTransactionScreen.tsx
git commit -m "feat(spending): track-spending toggle and breakdown on transaction edit screen"
```

---

### Task 6: Transactions list — badge and filter chip

**Files:**
- Modify: `mobile/src/screens/TransactionsScreen.tsx` (state ~line 24; `filteredTransactions` ~line 150; `renderTransaction` amount ~line 234; filters section ~line 327; styles ~line 900)

**Interfaces:**
- Consumes: `Transaction.spendingTrackerEnabled`, `Transaction.spendingAllocated`.

- [ ] **Step 1: Filter state**

After `const [filter, setFilter] = useState<'all' | 'credit' | 'debit' | 'transfer'>('all');` add:

```ts
  const [trackedOnly, setTrackedOnly] = useState(false);
```

- [ ] **Step 2: Filter logic**

In `filteredTransactions`, after the `matchesEndDate` line add:

```ts
    const matchesTracked = !trackedOnly || !!t.spendingTrackerEnabled;
```

and append `&& matchesTracked` to the `return` expression.

- [ ] **Step 3: Chip in the filters section**

Inside `{showFilters && ( <View style={styles.filtersSection}>`, after the closing `</View>` of the Account Filters `dateFilterContainer` (its last child), add:

```tsx
          {/* Spending Tracked filter */}
          <View style={styles.dateFilterContainer}>
            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: trackedOnly ? colors.primary + '20' : colors.card, borderColor: trackedOnly ? colors.primary : colors.border }]}
              onPress={() => setTrackedOnly(v => !v)}
            >
              <Ionicons name="pie-chart-outline" size={18} color={trackedOnly ? colors.primary : colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: trackedOnly ? colors.text : colors.textMuted }]}>Spending Tracked only</Text>
              {trackedOnly && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
            </TouchableOpacity>
          </View>
```

- [ ] **Step 4: "₹X left" badge under the amount**

In `renderTransaction`, replace:

```tsx
        <Text style={[
          styles.transactionAmount,
          { color: transaction.type === 'credit' ? colors.primary : colors.danger }
        ]}>
          {transaction.type === 'credit' ? '+' : '-'}{formatCurrency(transaction.amount)}
        </Text>
```

with:

```tsx
        <View style={styles.amountColumn}>
          <Text style={[
            styles.transactionAmount,
            { color: transaction.type === 'credit' ? colors.primary : colors.danger }
          ]}>
            {transaction.type === 'credit' ? '+' : '-'}{formatCurrency(transaction.amount)}
          </Text>
          {transaction.spendingTrackerEnabled && (() => {
            const left = parseFloat(transaction.amount) - parseFloat(transaction.spendingAllocated ?? '0');
            return (
              <View style={styles.trackedBadge}>
                <Ionicons name="pie-chart-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.trackedBadgeText, { color: colors.textMuted }]}>{formatCurrency(left)} left</Text>
              </View>
            );
          })()}
        </View>
```

- [ ] **Step 5: Styles**

After the `transactionAmount` style add:

```ts
  amountColumn: {
    alignItems: 'flex-end',
  },
  trackedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  trackedBadgeText: {
    fontSize: 11,
  },
```

- [ ] **Step 6: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"` → Expected `31`.
Run: `cd mobile && npx tsc --noEmit 2>&1 | grep TransactionsScreen` → Expected no output.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/screens/TransactionsScreen.tsx
git commit -m "feat(spending): tracked badge and Spending Tracked filter on transactions list"
```

---

### Task 7: Final verification and TODO marker

- [ ] **Step 1: Full checks**

Run from the worktree root:
```bash
npx tsx server/__tests__/transactionSpendingValidation.test.ts
npx tsx server/__tests__/loanSpendingValidation.test.ts
npm run check 2>&1 | grep -c "error TS"
(cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS")
```
Expected: `0 failed`, `0 failed`, `14`, `31`.

- [ ] **Step 2: Scope check**

Run: `git diff main --stat` and confirm every file from Tasks 1–6 appears and nothing under `client/` does.

- [ ] **Step 3: TODO.md**

Only if a matching item exists **in the worktree's** `TODO.md` (`grep -n -i "spending" TODO.md`), mark it `**Development completed | Test Pending**` and commit. If not present, skip — do not edit the main checkout's uncommitted TODO.md.

---

## After merge (user-confirmed, not part of implementation)

1. `npm run db:push` — additive only: new `transaction_spending_entries` table and `transactions.spending_tracker_enabled` (default false). Must run **before or atomically with** the server deploy: `storage.ts` selects the new column unconditionally, so deploying first breaks every transaction read.
2. Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'spending_tracker_enabled';` returns a row.
3. Deploy the server to Cloud Run, then build a new mobile release.
4. On-device checks (no emulator here): toggle on a PF/ITR credit, add/edit/delete entries, see "₹X left" on the list, filter chip, toggle hidden on expenses, try lowering the transaction amount below allocated (expect error toast), loan Spending Breakdown still works.
