import assert from "node:assert/strict";
import { getClosedCardCycle } from "../salaryUtils";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err: any) { console.log(`  ❌ ${name}: ${err.message}`); failed++; }
}

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

console.log("\n=== Closed Card Cycle Tests ===\n");

test("YES Bank card (bills on 12th), salary cycle from 29 Sep: 12 Aug - 11 Sep", () => {
  const c = getClosedCardCycle(new Date(2026, 8, 29), 12);
  assert.equal(ymd(c.cycleStart), "2026-8-12");
  assert.equal(ymd(c.cycleEnd), "2026-9-11");
});

test("HDFC card (bills on 17th), salary cycle from 29 Sep: 17 Aug - 16 Sep", () => {
  const c = getClosedCardCycle(new Date(2026, 8, 29), 17);
  assert.equal(ymd(c.cycleStart), "2026-8-17");
  assert.equal(ymd(c.cycleEnd), "2026-9-16");
});

test("reference before the billing day: closed cycle ends last month", () => {
  const c = getClosedCardCycle(new Date(2026, 9, 5), 12);
  assert.equal(ymd(c.cycleStart), "2026-8-12");
  assert.equal(ymd(c.cycleEnd), "2026-9-11");
});

test("reference on the billing day itself: the cycle that just closed", () => {
  const c = getClosedCardCycle(new Date(2026, 8, 12), 12);
  assert.equal(ymd(c.cycleStart), "2026-8-12");
  assert.equal(ymd(c.cycleEnd), "2026-9-11");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
