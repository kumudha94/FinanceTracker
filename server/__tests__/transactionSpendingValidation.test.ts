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
