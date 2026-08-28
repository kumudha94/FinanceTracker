import assert from "node:assert/strict";
import { shouldAutoMarkSalaryCredit } from "../salaryUtils";

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

console.log("\n=== Salary Auto-Mark-as-Paid Matching Tests ===\n");

const enabledProfile = { autoMarkPaidEnabled: true, autoMarkKeyword: "SALARY", accountId: 10 };

test("matches when enabled, account matches, and keyword appears in the SMS (case-insensitive)", () => {
  const result = shouldAutoMarkSalaryCredit(enabledProfile, 10, "Your account has been credited with salary for August");
  assert.equal(result, true);
});

test("does not match when auto-mark is disabled", () => {
  const result = shouldAutoMarkSalaryCredit({ ...enabledProfile, autoMarkPaidEnabled: false }, 10, "salary credited");
  assert.equal(result, false);
});

test("does not match when no profile exists", () => {
  const result = shouldAutoMarkSalaryCredit(null, 10, "salary credited");
  assert.equal(result, false);
});

test("does not match when no keyword is configured", () => {
  const result = shouldAutoMarkSalaryCredit({ ...enabledProfile, autoMarkKeyword: null }, 10, "salary credited");
  assert.equal(result, false);
});

test("does not match when the credited transaction's account differs from the salary profile's account", () => {
  // A credit into some other account (e.g. a refund into a credit card) must never
  // auto-mark the salary cycle, even if the SMS text happens to contain the keyword.
  const result = shouldAutoMarkSalaryCredit(enabledProfile, 99, "salary credited");
  assert.equal(result, false);
});

test("does not match when the profile has no account configured", () => {
  const result = shouldAutoMarkSalaryCredit({ ...enabledProfile, accountId: null }, 10, "salary credited");
  assert.equal(result, false);
});

test("does not match when the keyword is not present in the SMS text", () => {
  const result = shouldAutoMarkSalaryCredit(enabledProfile, 10, "Your account has been credited with a refund");
  assert.equal(result, false);
});

test("does not require the transaction amount to match anything — salary varies month to month", () => {
  // shouldAutoMarkSalaryCredit intentionally takes no amount parameter at all; this test just
  // documents that intent so a future "helpful" amount-matching addition gets caught in review.
  const result = shouldAutoMarkSalaryCredit(enabledProfile, 10, "salary credited: Rs. 87,432.50");
  assert.equal(result, true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
