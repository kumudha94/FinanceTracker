import assert from "node:assert/strict";
import { selectSmsOwnerAccounts, resolveSmsTransactionDate } from "../smsProcessingUtils";

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

console.log("\n=== SMS Owner Accounts Tests ===\n");

const accounts = [
  { id: 7, userId: 3, name: "ICICI Creditt Card", isDefault: false },
  { id: 28, userId: 8, name: "HDFC Savings", isDefault: true },
  { id: 37, userId: 8, name: "ICICI Meal Card", isDefault: false },
];

test("keeps only the default account owner's accounts", () => {
  assert.deepEqual(selectSmsOwnerAccounts(accounts).map(a => a.id), [28, 37]);
});

test("falls back to the first account's owner when none is default", () => {
  const noDefault = accounts.map(a => ({ ...a, isDefault: false }));
  assert.deepEqual(selectSmsOwnerAccounts(noDefault).map(a => a.id), [7]);
});

test("returns an empty list unchanged", () => {
  assert.deepEqual(selectSmsOwnerAccounts([]), []);
});

console.log("\n=== SMS Transaction Date Tests ===\n");

test("uses arrival time when the SMS arrives on the day it names (IST)", () => {
  assert.equal(
    resolveSmsTransactionDate("2026-10-01T00:00:00.000Z", "2026-10-01T06:48:01.917Z"),
    "2026-10-01T06:48:01.917Z"
  );
});

test("compares days in IST, not UTC (02:17 IST on 29 Sep is 28 Sep UTC)", () => {
  assert.equal(
    resolveSmsTransactionDate("2026-09-29T00:00:00.000Z", "2026-09-28T20:47:29.442Z"),
    "2026-09-28T20:47:29.442Z"
  );
});

test("keeps the SMS's own date when it arrived on a different day (rescan)", () => {
  assert.equal(
    resolveSmsTransactionDate("2026-09-19T00:00:00.000Z", "2026-09-28T05:41:01.000Z"),
    "2026-09-19T00:00:00.000Z"
  );
});

test("uses arrival time when the SMS has no date", () => {
  assert.equal(resolveSmsTransactionDate(undefined, "2026-10-01T06:48:01.917Z"), "2026-10-01T06:48:01.917Z");
});

test("keeps the parsed date when arrival time is invalid", () => {
  assert.equal(resolveSmsTransactionDate("2026-10-01T00:00:00.000Z", "garbage"), "2026-10-01T00:00:00.000Z");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
