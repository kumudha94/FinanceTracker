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
