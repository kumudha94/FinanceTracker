import assert from "node:assert/strict";
import { detectBalanceGap, isNewestBalanceFigure, findTransferCandidates, type CandidateDebit } from "../balanceSync";

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

console.log("\n=== Balance Gap Detection ===\n");

test("credit cards are never synced", () => {
  assert.equal(detectBalanceGap({ accountType: "credit_card", appBalanceAfterSms: 100, bankBalance: 500, isFirstGapForAccount: false }), null);
});

test("a difference under Rs 1 is rounding, not a gap", () => {
  assert.equal(detectBalanceGap({ accountType: "bank", appBalanceAfterSms: 100, bankBalance: 100.6, isFirstGapForAccount: false }), null);
});

test("real YES Bank case: Rs 27,000 higher is a pending gap", () => {
  assert.deepEqual(
    detectBalanceGap({ accountType: "bank", appBalanceAfterSms: 17520.23, bankBalance: 44520.23, isFirstGapForAccount: false }),
    { gapAmount: 27000, status: "pending" }
  );
});

test("first gap for an account is synced quietly", () => {
  assert.deepEqual(
    detectBalanceGap({ accountType: "bank", appBalanceAfterSms: 17520.23, bankBalance: 44520.23, isFirstGapForAccount: true }),
    { gapAmount: 27000, status: "auto_synced" }
  );
});

test("bank lower than expected is a negative gap", () => {
  assert.equal(detectBalanceGap({ accountType: "bank", appBalanceAfterSms: 1000, bankBalance: 750, isFirstGapForAccount: false })!.gapAmount, -250);
});

test("wallet accounts (Meal Card) are synced", () => {
  assert.ok(detectBalanceGap({ accountType: "wallet", appBalanceAfterSms: 6871.27, bankBalance: 4698.27, isFirstGapForAccount: false }));
});

console.log("\n=== Newest Balance Figure ===\n");

const now = new Date("2026-09-29T11:30:00Z");

test("no later activity, fresh SMS: sync", () => {
  assert.equal(isNewestBalanceFigure(new Date("2026-09-29T11:25:00Z"), null, now), true);
});

test("another transaction at the same time: sync", () => {
  const d = new Date("2026-09-29T11:25:00Z");
  assert.equal(isNewestBalanceFigure(d, new Date(d), now), true);
});

test("a later transaction exists on the account (late or rescanned SMS): no sync", () => {
  assert.equal(isNewestBalanceFigure(new Date("2026-09-29T09:00:00Z"), new Date("2026-09-29T10:00:00Z"), now), false);
});

test("SMS more than a day old with no later activity (first-ever rescan): no sync", () => {
  assert.equal(isNewestBalanceFigure(new Date("2026-09-01T11:00:00Z"), null, now), false);
});

test("SMS just under a day old: sync", () => {
  assert.equal(isNewestBalanceFigure(new Date(now.getTime() - 86400000 + 60000), null, now), true);
});

console.log("\n=== Transfer Candidates ===\n");

const smsDate = new Date("2026-09-29T11:00:00Z");
let nextId = 1;
function debit(over: Partial<CandidateDebit>): CandidateDebit {
  return {
    id: nextId++, type: "debit", amount: 27000, transactionDate: new Date("2026-09-29T01:56:57Z"),
    accountId: 28, accountType: "bank", accountName: "HDFC Savings", merchant: null,
    ...over,
  };
}
const find = (debits: CandidateDebit[], over: Partial<Parameters<typeof findTransferCandidates>[0]> = {}) =>
  findTransferCandidates({ gapAmount: 27000, gapAccountId: 29, smsDate, debits, usedDebitIds: new Set(), ...over });

test("real 29 Sep: the HDFC Rs 27,000 debit is the candidate", () => {
  const hdfc = debit({});
  assert.deepEqual(find([hdfc]).map(c => c.id), [hdfc.id]);
});

test("a negative gap has no transfer candidates", () => {
  assert.deepEqual(find([debit({})], { gapAmount: -27000 }), []);
});

test("a debit on the gap's own account is not a candidate", () => {
  assert.deepEqual(find([debit({ accountId: 29 })]), []);
});

test("an existing transfer is not a candidate", () => {
  assert.deepEqual(find([debit({ type: "transfer" })]), []);
});

test("a debit already used for another gap is not a candidate", () => {
  const d = debit({});
  assert.deepEqual(find([d], { usedDebitIds: new Set([d.id]) }), []);
});

test("window: exactly 3 days before is in, 3 days + 1 minute is out", () => {
  const inside = debit({ transactionDate: new Date(smsDate.getTime() - 3 * 86400000) });
  const outside = debit({ transactionDate: new Date(smsDate.getTime() - 3 * 86400000 - 60000) });
  assert.deepEqual(find([inside, outside]).map(c => c.id), [inside.id]);
});

test("a debit after the SMS is not a candidate", () => {
  assert.deepEqual(find([debit({ transactionDate: new Date("2026-09-29T12:00:00Z") })]), []);
});

test("amount within Rs 1 matches, beyond does not", () => {
  const near = debit({ amount: 27000.8 });
  const far = debit({ amount: 27001.5 });
  assert.deepEqual(find([near, far]).map(c => c.id), [near.id]);
});

test("several matches: nearest in time first", () => {
  const older = debit({ transactionDate: new Date("2026-09-27T10:00:00Z") });
  const newer = debit({ transactionDate: new Date("2026-09-29T09:00:00Z"), accountId: 30, accountName: "Indusind Account" });
  assert.deepEqual(find([older, newer]).map(c => c.id), [newer.id, older.id]);
});

test("credit card debits are never candidates", () => {
  assert.deepEqual(find([debit({ accountId: 34, accountType: "credit_card" })]), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
