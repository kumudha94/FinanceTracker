import assert from "node:assert/strict";
import { getRegenerationSchedule } from "../loanUtils";

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

function firstDueMonth(lastPaidDueDate: Date | null, today: Date) {
  const { baseDate, startIndex } = getRegenerationSchedule(lastPaidDueDate, today);
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + startIndex, 1);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

console.log("\n=== Loan Installment Regeneration Start Tests ===\n");

test("continues from the month after the last paid installment, even if that month's EMI day has passed", () => {
  // HDFC PL: Aug 7 paid, regenerated on Sep 29 — September must not be skipped
  assert.equal(firstDueMonth(new Date(2026, 7, 7), new Date(2026, 8, 29)), "2026-9");
});

test("continues after the last paid installment when the paid one is in the current month", () => {
  assert.equal(firstDueMonth(new Date(2026, 8, 4), new Date(2026, 8, 29)), "2026-10");
});

test("rolls over the year after a December payment", () => {
  assert.equal(firstDueMonth(new Date(2026, 11, 5), new Date(2027, 0, 20)), "2027-1");
});

test("with nothing paid, includes the current month even when its EMI day has passed", () => {
  assert.equal(firstDueMonth(null, new Date(2026, 8, 29)), "2026-9");
});

test("with nothing paid, includes the current month when its EMI day is still ahead", () => {
  assert.equal(firstDueMonth(null, new Date(2026, 8, 2)), "2026-9");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
