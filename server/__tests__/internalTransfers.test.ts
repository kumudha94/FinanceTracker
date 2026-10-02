import assert from "node:assert/strict";
import { findInternalTransfers, type FlowTxn } from "../internalTransfers";

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

let nextId = 1;
function txn(over: Partial<FlowTxn>): FlowTxn {
  return {
    id: nextId++, type: "debit", amount: 100, transactionDate: new Date("2026-09-29T06:00:00Z"),
    accountId: 28, accountType: "bank",
    ...over,
  };
}

console.log("\n=== Internal Transfers Tests ===\n");

test("real 29 Sep: HDFC -> YES transfer is neither expense nor income", () => {
  const out = txn({ amount: 8790.35, transactionDate: new Date("2026-09-29T11:24:50Z") });
  const inn = txn({ type: "credit", amount: 8790.35, accountId: 29, transactionDate: new Date("2026-09-29T11:32:56Z") });
  const r = findInternalTransfers([out, inn]);
  assert.ok(r.notExpense.has(out.id));
  assert.ok(r.notIncome.has(inn.id));
});

test("real 30 Sep: credit on HDFC CC is not income even with no matching bank debit", () => {
  const cardCredit = txn({ type: "credit", amount: 4628, accountId: 34, accountType: "credit_card" });
  const r = findInternalTransfers([cardCredit]);
  assert.ok(r.notIncome.has(cardCredit.id));
  assert.equal(r.notExpense.size, 0);
});

test("bank payment that lands on a card is not an expense (purchases already counted)", () => {
  const out = txn({ amount: 5000 });
  const cardIn = txn({ type: "credit", amount: 5000, accountId: 34, accountType: "credit_card" });
  const r = findInternalTransfers([out, cardIn]);
  assert.ok(r.notExpense.has(out.id));
  assert.ok(r.notIncome.has(cardIn.id));
});

test("card bill paid with no credit recorded on the card stays an expense", () => {
  const yesOut = txn({ amount: 8790.35, accountId: 29 });
  const r = findInternalTransfers([yesOut]);
  assert.equal(r.notExpense.size, 0);
});

test("salary and other unmatched credits stay income", () => {
  const salary = txn({ type: "credit", amount: 182052 });
  const r = findInternalTransfers([salary]);
  assert.equal(r.notIncome.size, 0);
});

test("credit into the same account is a refund, not a transfer", () => {
  const out = txn({ amount: 500 });
  const refund = txn({ type: "credit", amount: 500 });
  const r = findInternalTransfers([out, refund]);
  assert.equal(r.notExpense.size, 0);
  assert.equal(r.notIncome.size, 0);
});

test("each credit pairs with only one debit", () => {
  const out1 = txn({ amount: 500 });
  const out2 = txn({ amount: 500, transactionDate: new Date("2026-09-29T07:00:00Z") });
  const inn = txn({ type: "credit", amount: 500, accountId: 29 });
  const r = findInternalTransfers([out1, out2, inn]);
  assert.equal(r.notExpense.size, 1);
  assert.equal(r.notIncome.size, 1);
});

test("pairs with the credit nearest in time", () => {
  const out = txn({ amount: 1000, transactionDate: new Date("2026-09-29T10:00:00Z") });
  const far = txn({ type: "credit", amount: 1000, accountId: 29, transactionDate: new Date("2026-09-28T12:00:00Z") });
  const near = txn({ type: "credit", amount: 1000, accountId: 30, transactionDate: new Date("2026-09-29T10:05:00Z") });
  const r = findInternalTransfers([far, out, near]);
  assert.ok(r.notIncome.has(near.id));
  assert.ok(!r.notIncome.has(far.id));
});

test("credit more than 24h away does not pair", () => {
  const out = txn({ amount: 500, transactionDate: new Date("2026-09-29T06:00:00Z") });
  const inn = txn({ type: "credit", amount: 500, accountId: 29, transactionDate: new Date("2026-09-30T07:00:00Z") });
  const r = findInternalTransfers([out, inn]);
  assert.equal(r.notExpense.size, 0);
  assert.equal(r.notIncome.size, 0);
});

test("card purchases are never treated as the sending side of a transfer", () => {
  const cardBuy = txn({ amount: 700, accountId: 34, accountType: "credit_card" });
  const bankIn = txn({ type: "credit", amount: 700, accountId: 28 });
  const r = findInternalTransfers([cardBuy, bankIn]);
  assert.equal(r.notExpense.size, 0);
  assert.equal(r.notIncome.size, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
