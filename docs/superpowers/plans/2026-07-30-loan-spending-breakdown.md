# Loan Spending Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user record how a loan's actual received amount (after deductions) was spent, via a "Spending Breakdown" modal reachable from both the mobile Loan Details and Edit Loan screens.

**Architecture:** New `loan_spending_entries` table + `received_amount` column on `loans`, three new/extended API routes, and a single reusable mobile modal component (`SpendingBreakdownModal.tsx`) mounted from both `LoanDetailsScreen.tsx` and `AddLoanScreen.tsx`. Pure record-keeping — no transaction or account-balance side effects.

**Tech Stack:** Express + Drizzle ORM + PostgreSQL (Neon) on the server; React Native + Expo + TanStack Query on mobile. No test framework is configured beyond a hand-rolled `node:assert`-based runner (see `server/__tests__/smsParser.test.ts`) — this plan follows that same convention for the one piece of pure business logic worth unit testing, and uses manual `curl`/`tsc` verification for everything that touches the database or UI.

## Global Constraints

- Mobile only — spec explicitly excludes web (`client/src/pages/loans.tsx` has no separate detail/edit screens).
- No transaction or account-balance integration — spending entries are pure notes.
- Editing an existing spending entry is out of scope — only add/delete.
- The total of a loan's spending entries must never exceed its `receivedAmount`, enforced server-side (not just client-side).
- Migrations in this project are applied via `drizzle-kit push` against the Neon database manually — they are NOT auto-run on deploy (confirmed: `package.json`'s only DB script is `"db:push": "drizzle-kit push"`, and Render's build/start scripts don't invoke it). The migration file this plan creates will need a manual `npm run db:push` (or direct SQL apply) after merging, same as every other migration in `migrations/`.

---

### Task 1: Pure validation helper (TDD)

**Files:**
- Create: `server/loanSpendingValidation.ts`
- Test: `server/__tests__/loanSpendingValidation.test.ts`

**Interfaces:**
- Produces: `validateNewSpendingEntry(receivedAmount: string | null, existingEntries: { amount: string }[], newAmount: number): string | null` — returns an error message string if the entry is invalid, or `null` if it's valid. Later tasks (the POST route in Task 4) call this directly.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/loanSpendingValidation.test.ts`:

```typescript
import assert from "node:assert/strict";
import { validateNewSpendingEntry } from "../loanSpendingValidation";

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

console.log("\n=== Loan Spending Validation Tests ===\n");

test("rejects when receivedAmount is not set", () => {
  const result = validateNewSpendingEntry(null, [], 1000);
  assert.equal(result, "Set the received amount before adding entries");
});

test("rejects zero amount", () => {
  const result = validateNewSpendingEntry("100000", [], 0);
  assert.equal(result, "Amount must be greater than 0");
});

test("rejects negative amount", () => {
  const result = validateNewSpendingEntry("100000", [], -500);
  assert.equal(result, "Amount must be greater than 0");
});

test("accepts a valid entry with no existing entries", () => {
  const result = validateNewSpendingEntry("792000", [], 300000);
  assert.equal(result, null);
});

test("accepts an entry that exactly fills the remaining balance", () => {
  const result = validateNewSpendingEntry("792000", [{ amount: "792000" }], 0.0001);
  // Note: amount must be > 0, and 792000 + 0.0001 > 792000, so this should still reject —
  // exact-fill boundary is tested properly below with a non-degenerate example.
  assert.notEqual(result, undefined);
});

test("accepts an entry that exactly fills the remaining balance (non-degenerate)", () => {
  const result = validateNewSpendingEntry("792000", [{ amount: "492000" }], 300000);
  assert.equal(result, null);
});

test("sums multiple existing entries before checking the new one", () => {
  const existing = [{ amount: "200000" }, { amount: "150000" }, { amount: "100000" }];
  // 200000 + 150000 + 100000 = 450000 allocated of 792000 received, 342000 remaining
  const result = validateNewSpendingEntry("792000", existing, 342000);
  assert.equal(result, null);
});

test("rejects an entry that would exceed the received amount", () => {
  const existing = [{ amount: "700000" }];
  const result = validateNewSpendingEntry("792000", existing, 100000);
  assert.match(result!, /exceed/i);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx server/__tests__/loanSpendingValidation.test.ts`
Expected: FAILS with a module-not-found error for `../loanSpendingValidation` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `server/loanSpendingValidation.ts`:

```typescript
// Pure validation for loan spending entries — kept separate from routes.ts so it can be
// unit tested without a database, following the same pattern as smsParser.ts.
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
  const received = parseFloat(receivedAmount);
  const allocated = existingEntries.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  if (allocated + newAmount > received) {
    const remaining = received - allocated;
    return `This would exceed the received amount — ₹${remaining.toFixed(2)} remaining to allocate`;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx server/__tests__/loanSpendingValidation.test.ts`
Expected: `8 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add server/loanSpendingValidation.ts server/__tests__/loanSpendingValidation.test.ts
git commit -m "feat: add pure validation for loan spending entries"
```

---

### Task 2: Database schema + migration

**Files:**
- Modify: `shared/schema.ts:557` (add `receivedAmount` column to `loans`), `shared/schema.ts:588-612` (add to `insertLoanSchema`), after `shared/schema.ts:735` (new `loanSpendingEntries` table + relations + insert schema + types)
- Create: `migrations/0021_add_loan_spending_entries.sql`

**Interfaces:**
- Produces: `loanSpendingEntries` (Drizzle table), `insertLoanSpendingEntrySchema`, `InsertLoanSpendingEntry` type, `LoanSpendingEntry` type. Task 3 (storage layer) imports all of these.

- [ ] **Step 1: Add `receivedAmount` to the `loans` table**

In `shared/schema.ts`, in the `loans` table definition, add a new line right after `outstandingAmount`:

```typescript
  outstandingAmount: decimal("outstanding_amount", { precision: 14, scale: 2 }).notNull(),
  receivedAmount: decimal("received_amount", { precision: 14, scale: 2 }), // actual amount credited after deductions (processing fees etc.) — null until the user sets it via Spending Breakdown
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }).notNull(), // ROI in percentage
```

- [ ] **Step 2: Add `receivedAmount` to `insertLoanSchema`**

In the same file, inside `insertLoanSchema`'s `.extend({...})` block, add:

```typescript
  outstandingAmount: z.string().min(1, "Outstanding amount is required"),
  receivedAmount: z.string().optional(),
  interestRate: z.string().min(1, "Interest rate is required"),
```

- [ ] **Step 3: Add the `loanSpendingEntries` table, relations, and types**

Immediately after the `insertLoanInstallmentSchema`/`InsertLoanInstallment`/`LoanInstallment` block (ends around line 735 with `export type LoanInstallment = typeof loanInstallments.$inferSelect;`), add:

```typescript

// Loan Spending Entries (how a loan's received amount was actually spent — pure record-keeping,
// no transaction or account-balance link)
export const loanSpendingEntries = pgTable("loan_spending_entries", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").references(() => loans.id).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanSpendingEntriesRelations = relations(loanSpendingEntries, ({ one }) => ({
  loan: one(loans, { fields: [loanSpendingEntries.loanId], references: [loans.id] }),
}));

export const insertLoanSpendingEntrySchema = createInsertSchema(loanSpendingEntries).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.string().min(1, "Amount is required"),
  reason: z.string().optional(),
});

export type InsertLoanSpendingEntry = z.infer<typeof insertLoanSpendingEntrySchema>;
export type LoanSpendingEntry = typeof loanSpendingEntries.$inferSelect;
```

- [ ] **Step 4: Write the migration file**

Create `migrations/0021_add_loan_spending_entries.sql`:

```sql
-- Record-keeping for how a loan's received amount was actually spent
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS received_amount DECIMAL(14, 2);

CREATE TABLE IF NOT EXISTS loan_spending_entries (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  amount DECIMAL(14, 2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 5: Verify the schema file compiles**

Run: `npx tsc --noEmit`
Expected: No new errors introduced by this file (the pre-existing unrelated `savings goal` error at `server/routes.ts:1466` may still appear — that's not from this change).

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts migrations/0021_add_loan_spending_entries.sql
git commit -m "feat: add loan_spending_entries table and received_amount column"
```

---

### Task 3: Storage layer

**Files:**
- Modify: `server/storage.ts:4` (import), `server/storage.ts:191` (interface), `server/storage.ts:1954` (`getAllLoans` select list), `server/storage.ts:1997` (`getLoan` select list), `server/storage.ts:2044-2055` (`deleteLoan` cascade), after `server/storage.ts:2143` (new CRUD methods)

**Interfaces:**
- Consumes: `loanSpendingEntries`, `insertLoanSpendingEntrySchema`, `InsertLoanSpendingEntry`, `LoanSpendingEntry` from `shared/schema.ts` (Task 2).
- Produces: `storage.getLoanSpendingEntries(loanId: number): Promise<LoanSpendingEntry[]>`, `storage.createLoanSpendingEntry(entry: InsertLoanSpendingEntry): Promise<LoanSpendingEntry>`, `storage.deleteLoanSpendingEntry(id: number): Promise<boolean>`. Task 4 (routes) calls all three.

- [ ] **Step 1: Import the new schema symbols**

In `server/storage.ts`, line 4 currently reads:

```typescript
  loans, loanComponents, loanInstallments, loanTerms, loanPayments, loanBtAllocations, cardDetails,
```

Change to:

```typescript
  loans, loanComponents, loanInstallments, loanSpendingEntries, loanTerms, loanPayments, loanBtAllocations, cardDetails,
```

And in the type-imports block starting at line 18-20:

```typescript
  type LoanInstallment, type InsertLoanInstallment,
```

Change to:

```typescript
  type LoanInstallment, type InsertLoanInstallment,
  type LoanSpendingEntry, type InsertLoanSpendingEntry,
```

- [ ] **Step 2: Add the three methods to `IStorage`**

In the interface, right after `updateLoanInstallment` (around line 195), add:

```typescript
  getLoanInstallments(loanId: number): Promise<LoanInstallment[]>;
  getLoanInstallment(id: number): Promise<LoanInstallment | undefined>;
  createLoanInstallment(installment: InsertLoanInstallment): Promise<LoanInstallment>;
  updateLoanInstallment(id: number, installment: Partial<InsertLoanInstallment>): Promise<LoanInstallment | undefined>;

  // Loan Spending Entries
  getLoanSpendingEntries(loanId: number): Promise<LoanSpendingEntry[]>;
  createLoanSpendingEntry(entry: InsertLoanSpendingEntry): Promise<LoanSpendingEntry>;
  deleteLoanSpendingEntry(id: number): Promise<boolean>;
```

(Only the last three lines are new — the four `LoanInstallment` lines above are shown for exact placement context, don't duplicate them.)

- [ ] **Step 3: Add `receivedAmount` to the two explicit column-select lists**

`getAllLoans` (around line 1940) and `getLoan` (around line 1979) both build their `db.select({...})` with an explicit column list rather than `select *` — `receivedAmount` must be added to BOTH or the API will silently never return it. In both places, find:

```typescript
      outstandingAmount: loans.outstandingAmount,
```

and change to:

```typescript
      outstandingAmount: loans.outstandingAmount,
      receivedAmount: loans.receivedAmount,
```

- [ ] **Step 4: Add cascade delete to `deleteLoan`**

In `deleteLoan` (around line 2044), find:

```typescript
  async deleteLoan(id: number): Promise<boolean> {
    // Delete related records first (due to foreign key constraints)
    await db.delete(loanPayments).where(eq(loanPayments.loanId, id));
    await db.delete(loanInstallments).where(eq(loanInstallments.loanId, id));
```

Change to:

```typescript
  async deleteLoan(id: number): Promise<boolean> {
    // Delete related records first (due to foreign key constraints)
    await db.delete(loanPayments).where(eq(loanPayments.loanId, id));
    await db.delete(loanInstallments).where(eq(loanInstallments.loanId, id));
    await db.delete(loanSpendingEntries).where(eq(loanSpendingEntries.loanId, id));
```

- [ ] **Step 5: Add the three new methods**

Right after `createLoanInstallment` (ends around line 2143 with its closing `}`), add:

```typescript

  // Loan Spending Entries
  async getLoanSpendingEntries(loanId: number): Promise<LoanSpendingEntry[]> {
    return db.select().from(loanSpendingEntries)
      .where(eq(loanSpendingEntries.loanId, loanId))
      .orderBy(desc(loanSpendingEntries.createdAt));
  }

  async createLoanSpendingEntry(entry: InsertLoanSpendingEntry): Promise<LoanSpendingEntry> {
    const [newEntry] = await db.insert(loanSpendingEntries).values(entry).returning();
    return newEntry;
  }

  async deleteLoanSpendingEntry(id: number): Promise<boolean> {
    const result = await db.delete(loanSpendingEntries).where(eq(loanSpendingEntries.id, id)).returning();
    return result.length > 0;
  }
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "storage.ts"`
Expected: No output (no errors in `storage.ts`).

- [ ] **Step 7: Commit**

```bash
git add server/storage.ts
git commit -m "feat: add loan spending entry storage methods, wire receivedAmount into loan reads"
```

---

### Task 4: API routes

**Files:**
- Modify: `server/routes.ts` (add import near top; add three new routes near the existing `/api/loans/:loanId/installments` routes, around line 4530)

**Interfaces:**
- Consumes: `validateNewSpendingEntry` (Task 1), `storage.getLoanSpendingEntries` / `createLoanSpendingEntry` / `deleteLoanSpendingEntry` / `getLoan` (Task 3).
- Produces: `GET /api/loans/:loanId/spending-entries`, `POST /api/loans/:loanId/spending-entries`, `DELETE /api/spending-entries/:id`. Task 5 (mobile API client) calls all three.

- [ ] **Step 1: Import the validation helper**

Near the top of `server/routes.ts`, alongside the existing `salaryUtils` import (around line 30), add:

```typescript
import { validateNewSpendingEntry } from "./loanSpendingValidation";
```

- [ ] **Step 2: Add the three routes**

Immediately after the existing `app.get("/api/loans/:loanId/installments", ...)` / `app.patch("/api/loans/:loanId/installments/:id", ...)` block (ends around line 4543), add:

```typescript

  app.get("/api/loans/:loanId/spending-entries", async (req, res) => {
    try {
      const entries = await storage.getLoanSpendingEntries(parseInt(req.params.loanId));
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch spending entries" });
    }
  });

  app.post("/api/loans/:loanId/spending-entries", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const loanId = parseInt(req.params.loanId);

      const loan = await storage.getLoan(loanId);
      if (!loan || loan.userId !== userId) {
        return res.status(404).json({ error: "Loan not found" });
      }

      const { amount, reason } = req.body;
      const existingEntries = await storage.getLoanSpendingEntries(loanId);
      const validationError = validateNewSpendingEntry(loan.receivedAmount, existingEntries, parseFloat(amount));
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const entry = await storage.createLoanSpendingEntry({ loanId, amount, reason: reason || null });
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid spending entry data" });
    }
  });

  app.delete("/api/spending-entries/:id", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const entryId = parseInt(req.params.id);

      // No direct getLoanSpendingEntry(id) lookup exists — fetch via the loan's list instead,
      // matching the pattern used for other sub-resources that lack a single-row getter.
      const allLoans = await storage.getAllLoans(userId);
      let owned = false;
      for (const loan of allLoans) {
        const entries = await storage.getLoanSpendingEntries(loan.id);
        if (entries.some(e => e.id === entryId)) {
          owned = true;
          break;
        }
      }
      if (!owned) {
        return res.status(404).json({ error: "Spending entry not found" });
      }

      const deleted = await storage.deleteLoanSpendingEntry(entryId);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Spending entry not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete spending entry" });
    }
  });
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "routes.ts"`
Expected: No output (aside from the pre-existing unrelated savings-goal error at line 1466, if your grep is broad enough to catch it — check the line number matches 1466, not a new location).

- [ ] **Step 4: Manual verification against a local dev server**

Run: `npm run dev` (in one terminal), then in another terminal, replace `<TOKEN>` and `<LOAN_ID>` with a real JWT and an existing loan's ID from your dev DB:

```bash
# Set a received amount lower than the loan's principal
curl -X PATCH http://localhost:5000/api/loans/<LOAN_ID> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"receivedAmount": "792000"}'

# Add a valid entry
curl -X POST http://localhost:5000/api/loans/<LOAN_ID>/spending-entries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"amount": "300000", "reason": "Home renovation"}'
# Expected: 201, JSON with id/loanId/amount/reason/createdAt

# Try to exceed the received amount
curl -X POST http://localhost:5000/api/loans/<LOAN_ID>/spending-entries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"amount": "999999999", "reason": "too much"}'
# Expected: 400, {"error": "This would exceed the received amount — ..."}

# List entries
curl http://localhost:5000/api/loans/<LOAN_ID>/spending-entries
# Expected: array containing the entry just created

# Delete it (use the id returned above)
curl -X DELETE http://localhost:5000/api/spending-entries/<ENTRY_ID> \
  -H "Authorization: Bearer <TOKEN>"
# Expected: 204 empty response
```

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add loan spending entry API routes"
```

---

### Task 5: Mobile types and API client

**Files:**
- Modify: `mobile/src/lib/types.ts` (add `receivedAmount` to `Loan`, add `LoanSpendingEntry` and `InsertLoanSpendingEntry`)
- Modify: `mobile/src/lib/api.ts` (import new types, add three API functions)

**Interfaces:**
- Produces: `LoanSpendingEntry` type, `api.getLoanSpendingEntries(loanId)`, `api.createLoanSpendingEntry(loanId, data)`, `api.deleteLoanSpendingEntry(id)`. Task 6 (the modal component) consumes all of these, plus the existing `api.updateLoan` for saving `receivedAmount`.

- [ ] **Step 1: Add `receivedAmount` to the `Loan` interface**

In `mobile/src/lib/types.ts`, in the `Loan` interface (starts around line 379), find:

```typescript
  outstandingAmount: string;
```

Change to:

```typescript
  outstandingAmount: string;
  receivedAmount: string | null;
```

- [ ] **Step 2: Add `receivedAmount` to the `InsertLoan` interface**

`api.updateLoan(id, data: Partial<InsertLoan>)` is how the modal (Task 6) will save the received amount — `InsertLoan` (starts around line 483) doesn't mirror every `Loan` field (e.g. it also omits `outstandingAmount`), so `receivedAmount` must be added explicitly or `Partial<InsertLoan>` won't accept it. Find:

```typescript
  principalAmount: string;
  interestRate: string;
```

Change to:

```typescript
  principalAmount: string;
  receivedAmount?: string | null;
  interestRate: string;
```

- [ ] **Step 3: Add the `LoanSpendingEntry` and `InsertLoanSpendingEntry` types**

Right after the `LoanInstallment` interface closes (find it starting around line 426; add these after its closing `}`):

```typescript

export interface LoanSpendingEntry {
  id: number;
  loanId: number;
  amount: string;
  reason: string | null;
  createdAt: string;
}

export interface InsertLoanSpendingEntry {
  amount: string;
  reason?: string | null;
}
```

- [ ] **Step 3: Add the API client functions**

In `mobile/src/lib/api.ts`, add `LoanSpendingEntry, InsertLoanSpendingEntry,` to the type-import list at the top (find the line starting `Loan, LoanInstallment, InsertLoan, LoanBtAllocation,` around line 7, and change it to):

```typescript
  Loan, LoanInstallment, InsertLoan, LoanBtAllocation, LoanSpendingEntry, InsertLoanSpendingEntry,
```

Then, right after the existing `updateInstallment` function (around line 506, ends with the closing `}),`), add:

```typescript
  getLoanSpendingEntries: (loanId: number) =>
    apiRequest<LoanSpendingEntry[]>(`/api/loans/${loanId}/spending-entries`),
  createLoanSpendingEntry: (loanId: number, data: InsertLoanSpendingEntry) =>
    apiRequest<LoanSpendingEntry>(`/api/loans/${loanId}/spending-entries`, { method: 'POST', body: JSON.stringify(data) }),
  deleteLoanSpendingEntry: (id: number) =>
    apiRequest<void>(`/api/spending-entries/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 4: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `31` (the same pre-existing count as before this plan — no new errors).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts
git commit -m "feat: add mobile types and API client for loan spending entries"
```

---

### Task 6: SpendingBreakdownModal component

**Files:**
- Create: `mobile/src/components/SpendingBreakdownModal.tsx`

**Interfaces:**
- Consumes: `api.getLoan`, `api.updateLoan`, `api.getLoanSpendingEntries`, `api.createLoanSpendingEntry`, `api.deleteLoanSpendingEntry` (Task 5); `getThemedColors`, `useTheme`, `formatCurrency` (existing utils).
- Produces: `SpendingBreakdownModal` React component with props `{ loanId: number; visible: boolean; onClose: () => void }`. Tasks 7 and 8 render this component from `LoanDetailsScreen.tsx` and `AddLoanScreen.tsx`.

- [ ] **Step 1: Create the component**

Create `mobile/src/components/SpendingBreakdownModal.tsx`:

```typescript
import { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { api } from '../lib/api';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

interface SpendingBreakdownModalProps {
  loanId: number;
  visible: boolean;
  onClose: () => void;
}

export default function SpendingBreakdownModal({ loanId, visible, onClose }: SpendingBreakdownModalProps) {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const queryClient = useQueryClient();

  const [receivedAmountInput, setReceivedAmountInput] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntryAmount, setNewEntryAmount] = useState('');
  const [newEntryReason, setNewEntryReason] = useState('');

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

  // Pre-fill the input with the loan's principal the first time it's opened for a loan that
  // has no receivedAmount saved yet — the stored value stays null until the user hits Save.
  useEffect(() => {
    if (loan) {
      setReceivedAmountInput(loan.receivedAmount ?? loan.principalAmount);
    }
  }, [loan?.id, loan?.receivedAmount]);

  const saveReceivedAmountMutation = useMutation({
    mutationFn: (amount: string) => api.updateLoan(loanId, { receivedAmount: amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      Toast.show({ type: 'success', text1: 'Received amount saved', position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to save received amount', position: 'bottom' });
    },
  });

  const addEntryMutation = useMutation({
    mutationFn: () => api.createLoanSpendingEntry(loanId, { amount: newEntryAmount, reason: newEntryReason.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-spending-entries', loanId] });
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
    mutationFn: (id: number) => api.deleteLoanSpendingEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-spending-entries', loanId] });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to delete entry', position: 'bottom' });
    },
  });

  const allocated = (entries || []).reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const received = loan?.receivedAmount ? parseFloat(loan.receivedAmount) : null;
  const remaining = received !== null ? received - allocated : null;

  const handleAddEntry = () => {
    const amountNum = parseFloat(newEntryAmount);
    if (!newEntryAmount || isNaN(amountNum) || amountNum <= 0) {
      Toast.show({ type: 'error', text1: 'Enter a valid amount', position: 'bottom' });
      return;
    }
    addEntryMutation.mutate();
  };

  if (!loan) {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={[styles.content, { backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Spending Breakdown</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
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
                  style={[styles.saveButton, { backgroundColor: colors.primary }]}
                  onPress={() => saveReceivedAmountMutation.mutate(receivedAmountInput)}
                  disabled={saveReceivedAmountMutation.isPending}
                >
                  {saveReceivedAmountMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {received !== null && (
              <Text style={[styles.allocatedText, { color: colors.textMuted }]}>
                {formatCurrency(allocated)} of {formatCurrency(received)} allocated
                {remaining! >= 0 ? `, ${formatCurrency(remaining!)} unaccounted` : ''}
              </Text>
            )}

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {entriesLoading ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
            ) : entries && entries.length > 0 ? (
              entries.map((entry) => (
                <View key={entry.id} style={[styles.entryRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.entryAmount, { color: colors.text }]}>{formatCurrency(parseFloat(entry.amount))}</Text>
                    {entry.reason && <Text style={[styles.entryReason, { color: colors.textMuted }]}>{entry.reason}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => deleteEntryMutation.mutate(entry.id)} disabled={deleteEntryMutation.isPending}>
                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No spending entries yet</Text>
            )}

            {showAddForm ? (
              <View style={[styles.addForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.amountInputContainer, { backgroundColor: colors.background, borderColor: colors.border, marginBottom: 8 }]}>
                  <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.text }]}
                    keyboardType="decimal-pad"
                    value={newEntryAmount}
                    onChangeText={setNewEntryAmount}
                    placeholder="Amount"
                    placeholderTextColor={colors.textMuted}
                    autoFocus
                  />
                </View>
                <TextInput
                  style={[styles.reasonInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                  value={newEntryReason}
                  onChangeText={setNewEntryReason}
                  placeholder="Reason (optional)"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.addFormButtons}>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowAddForm(false); setNewEntryAmount(''); setNewEntryReason(''); }}>
                    <Text style={{ color: colors.textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: colors.primary }]}
                    onPress={handleAddEntry}
                    disabled={addEntryMutation.isPending}
                  >
                    {addEntryMutation.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>Add</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addEntryRow, { borderColor: colors.border }]}
                onPress={() => setShowAddForm(true)}
                disabled={received === null}
              >
                <Ionicons name="add-circle-outline" size={20} color={received === null ? colors.textMuted : colors.primary} />
                <Text style={[styles.addEntryText, { color: received === null ? colors.textMuted : colors.primary }]}>
                  {received === null ? 'Save received amount first' : 'Add Entry'}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  content: {
    maxHeight: '85%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    flexGrow: 0,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  readOnlyValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  receivedRow: {
    flexDirection: 'row',
    gap: 10,
  },
  amountInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  currencyPrefix: {
    fontSize: 16,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  saveButton: {
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  allocatedText: {
    fontSize: 12,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    marginBottom: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  entryAmount: {
    fontSize: 15,
    fontWeight: '600',
  },
  entryReason: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
  addForm: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  reasonInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  addFormButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    alignItems: 'center',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  addButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  addEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    justifyContent: 'center',
  },
  addEntryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `31` (unchanged — this component isn't imported anywhere yet, so it must compile standalone with zero errors of its own; the count staying at the pre-existing baseline confirms that).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/SpendingBreakdownModal.tsx
git commit -m "feat: add SpendingBreakdownModal component"
```

---

### Task 7: Wire into LoanDetailsScreen

**Files:**
- Modify: `mobile/src/screens/LoanDetailsScreen.tsx`

**Interfaces:**
- Consumes: `SpendingBreakdownModal` (Task 6).

- [ ] **Step 1: Import the component and add modal-visibility state**

At the top of `mobile/src/screens/LoanDetailsScreen.tsx`, add the import alongside the other local imports:

```typescript
import SpendingBreakdownModal from '../components/SpendingBreakdownModal';
```

Near the other `useState` modal-visibility declarations (e.g. `const [topupModalVisible, setTopupModalVisible] = useState(false);` around line 35), add:

```typescript
  const [spendingBreakdownVisible, setSpendingBreakdownVisible] = useState(false);
```

- [ ] **Step 2: Add the action row**

In the loan actions section (the `{loan && (<View style={styles.loanActionsContainer}>...` block starting around line 760), add a new row. Place it right after the closing `</TouchableOpacity>` of the "Part Payment" button and before the `</>` that closes the `loan.status === 'active'` conditional (around line 815-816), so it appears alongside the other primary actions:

```typescript
            {/* Spending Breakdown Action */}
            <TouchableOpacity
              style={[styles.loanActionButton, { backgroundColor: colors.card, borderColor: '#8b5cf6' }]}
              onPress={() => setSpendingBreakdownVisible(true)}
            >
              <Ionicons name="pie-chart-outline" size={20} color="#8b5cf6" />
              <View style={styles.preclosureButtonContent}>
                <Text style={[styles.preclosureButtonTitle, { color: colors.text }]}>Spending Breakdown</Text>
                <Text style={[styles.preclosureButtonSubtitle, { color: colors.textMuted }]}>
                  Track how the received amount was used
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
```

- [ ] **Step 3: Render the modal**

Near the end of the component's returned JSX, alongside the other modals (e.g. right before or after the existing `<Modal visible={topupModalVisible} ...>` block), add:

```typescript
      <SpendingBreakdownModal
        loanId={loanId}
        visible={spendingBreakdownVisible}
        onClose={() => setSpendingBreakdownVisible(false)}
      />
```

- [ ] **Step 4: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `31` (unchanged).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/LoanDetailsScreen.tsx
git commit -m "feat: wire Spending Breakdown into LoanDetailsScreen"
```

---

### Task 8: Wire into AddLoanScreen (edit mode only)

**Files:**
- Modify: `mobile/src/screens/AddLoanScreen.tsx`

**Interfaces:**
- Consumes: `SpendingBreakdownModal` (Task 6).

- [ ] **Step 1: Import the component and add modal-visibility state**

Add the import:

```typescript
import SpendingBreakdownModal from '../components/SpendingBreakdownModal';
```

Near the top of the component body (alongside other `useState` declarations, e.g. near `const [showAccountPicker, setShowAccountPicker] = useState(false);`), add:

```typescript
  const [spendingBreakdownVisible, setSpendingBreakdownVisible] = useState(false);
```

- [ ] **Step 2: Add the action row, edit-mode only**

Right after the "Edit Mode Information Banner" block (the `{isEditMode && (<View style={[styles.infoBanner, ...]}>...</View>)}` around lines 341-349), add a new conditional block — this only renders once a loan actually exists (`isEditMode` implies `loanId` is set):

```typescript
        {isEditMode && loanId && (
          <TouchableOpacity
            style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}
            onPress={() => setSpendingBreakdownVisible(true)}
          >
            <Ionicons name="pie-chart-outline" size={20} color="#8b5cf6" />
            <Text style={[styles.dropdownText, { color: colors.text, flex: 1 }]}>Spending Breakdown</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
```

- [ ] **Step 3: Render the modal**

Near the end of the component's returned JSX (after the closing `</KeyboardAwareScrollView>`, alongside any other top-level modals in this file, or as a sibling to it inside the outermost `<View style={[styles.container, ...]}>`), add:

```typescript
      {loanId && (
        <SpendingBreakdownModal
          loanId={loanId}
          visible={spendingBreakdownVisible}
          onClose={() => setSpendingBreakdownVisible(false)}
        />
      )}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `31` (unchanged).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/AddLoanScreen.tsx
git commit -m "feat: wire Spending Breakdown into AddLoanScreen edit mode"
```

---

## After Implementation

- Update `TODO.md` Section 7 item 1 to reflect "Development completed", per the convention used for every other item in that file.
- The migration (`migrations/0021_add_loan_spending_entries.sql`) needs to be applied to the production Neon database via `npm run db:push` (or a direct SQL apply, as was done for migration 0020) — it will NOT take effect automatically on deploy.
- Like the earlier scheduled-payment and SMS fixes this session, the mobile-side changes need a new EAS build + Play Store update before they reach the phone; the server-side change (routes/storage) goes live on the next push to `main` (Render auto-deploys).
