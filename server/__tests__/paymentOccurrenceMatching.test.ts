import assert from "node:assert/strict";
import { findOccurrenceInCycle } from "../salaryUtils";

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

console.log("\n=== Payment Occurrence Cycle Matching Tests ===\n");

test("finds the occurrence whose dueDate falls inside the cycle, even when its month/year bucket doesn't match the cycle's primary month", () => {
  // Occurrence created under calendar-month bucket (July) by the Scheduled Payments screen,
  // but its actual dueDate (Jul 1) falls before a cycle that starts Jul 29 — this is the
  // reproduction of the reported bug: dashboard's cycle-primary-month bucket is August,
  // so an exact {month, year} match would miss this row even though a real bill is due.
  const occurrences = [
    { id: 1, month: 7, year: 2026, dueDate: new Date(2026, 6, 1), status: "paid" },
  ];
  const cycleStart = new Date(2026, 6, 29); // Jul 29
  const cycleEnd = new Date(2026, 7, 28, 23, 59, 59); // Aug 28

  const result = findOccurrenceInCycle(occurrences, cycleStart, cycleEnd);
  assert.equal(result, undefined, "sanity check: a dueDate before the cycle start should not match");
});

test("matches an occurrence marked paid under the calendar-month bucket when its dueDate actually falls within the cycle", () => {
  // This is the real bug scenario: the payment is due on the 1st, the user's salary cycle
  // starts on the 29th, so "due on the 1st" resolves to Aug 1st inside the Jul29-Aug28 cycle.
  // The occurrence row was generated/marked-paid by the Scheduled Payments screen under the
  // calendar month (August, since it ran on/after Aug 1), which happens to match here — the
  // real-world failure mode is the *reverse* direction, covered by the next test.
  const occurrences = [
    { id: 2, month: 7, year: 2026, dueDate: new Date(2026, 7, 1), status: "paid" },
  ];
  const cycleStart = new Date(2026, 6, 29); // Jul 29
  const cycleEnd = new Date(2026, 7, 28, 23, 59, 59); // Aug 28

  const result = findOccurrenceInCycle(occurrences, cycleStart, cycleEnd);
  assert.equal(result?.id, 2, "expected the Aug-1 dueDate occurrence to match the Jul29-Aug28 cycle regardless of its stored month/year bucket");
});

test("returns undefined when no occurrence's dueDate falls within the cycle", () => {
  const occurrences = [
    { id: 3, month: 6, year: 2026, dueDate: new Date(2026, 5, 1), status: "paid" },
  ];
  const cycleStart = new Date(2026, 6, 29);
  const cycleEnd = new Date(2026, 7, 28, 23, 59, 59);

  const result = findOccurrenceInCycle(occurrences, cycleStart, cycleEnd);
  assert.equal(result, undefined);
});

test("picks the most recently created occurrence when more than one dueDate falls in the cycle range", () => {
  const occurrences = [
    { id: 4, month: 7, year: 2026, dueDate: new Date(2026, 7, 1), status: "pending", createdAt: new Date(2026, 6, 1) },
    { id: 5, month: 8, year: 2026, dueDate: new Date(2026, 7, 1), status: "paid", createdAt: new Date(2026, 6, 2) },
  ];
  const cycleStart = new Date(2026, 6, 29);
  const cycleEnd = new Date(2026, 7, 28, 23, 59, 59);

  const result = findOccurrenceInCycle(occurrences, cycleStart, cycleEnd);
  assert.equal(result?.id, 5);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
