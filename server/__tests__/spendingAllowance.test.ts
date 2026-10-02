import assert from "node:assert/strict";
import {
  istDayKey, selectCountedDebits, resolveSalaryIncome, computeSpendingAllowance,
  type AllowanceTxn, type CommitmentItem,
} from "../spendingAllowance";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err: any) { console.log(`  ❌ ${name}: ${err.message}`); failed++; }
}

let nextId = 1;
function txn(over: Partial<AllowanceTxn>): AllowanceTxn {
  return {
    id: nextId++, type: "debit", amount: 100, transactionDate: new Date("2026-10-01T06:00:00Z"),
    accountId: 28, accountType: "bank", accountName: "HDFC Savings",
    categoryId: null, categoryName: null, merchant: "Shop",
    excludedFromAllowance: false, paymentOccurrenceId: null, savingsContributionId: null,
    ...over,
  };
}
const cycleStart = new Date("2026-09-29T00:00:00Z");
const ctx = (over: Partial<Parameters<typeof selectCountedDebits>[2]> = {}) => ({
  linkedPaymentTxnIds: new Set<number>(), neverCountCategoryIds: new Set<number>(), cardBillItems: [] as CommitmentItem[],
  ...over,
});
const reasons = (r: ReturnType<typeof selectCountedDebits>) => r.excluded.map(e => e.reason);

console.log("\n=== IST day ===\n");

test("02:17 IST on 29 Sep is 28 Sep in UTC but 29 Sep in IST", () => {
  assert.equal(istDayKey(new Date("2026-09-28T20:47:29Z")), "2026-09-29");
});

console.log("\n=== Which debits count ===\n");

test("plain bank debit counts", () => {
  const r = selectCountedDebits([txn({})], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
});

test("wallet (Meal Card) debit counts, credit card debit is ignored entirely", () => {
  const r = selectCountedDebits([
    txn({ accountId: 37, accountType: "wallet" }),
    txn({ accountId: 34, accountType: "credit_card" }),
  ], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.length, 0);
});

test("debits before the cycle start are ignored (payday before 05:30 IST)", () => {
  const r = selectCountedDebits([txn({ transactionDate: new Date("2026-09-28T20:00:00Z") })], cycleStart, ctx());
  assert.equal(r.counted.length + r.excluded.length, 0);
});

test("rule 1: marked not daily spending", () => {
  const r = selectCountedDebits([txn({ excludedFromAllowance: true })], cycleStart, ctx());
  assert.deepEqual(reasons(r), ["Marked not daily spending"]);
});

test("rule 2: linked to a scheduled payment, savings, or loan/insurance payment", () => {
  const a = txn({ paymentOccurrenceId: 166 });
  const b = txn({ savingsContributionId: 3 });
  const c = txn({});
  const r = selectCountedDebits([a, b, c], cycleStart, ctx({ linkedPaymentTxnIds: new Set([c.id]) }));
  assert.deepEqual(reasons(r), ["Planned payment", "Planned payment", "Planned payment"]);
});

test("rule 3: never-count category", () => {
  const r = selectCountedDebits([txn({ categoryId: 12, categoryName: "Repayment" })], cycleStart, ctx({ neverCountCategoryIds: new Set([12]) }));
  assert.deepEqual(reasons(r), ["Category: Repayment"]);
});

test("rule order: the flag wins over a linked payment", () => {
  const r = selectCountedDebits([txn({ excludedFromAllowance: true, paymentOccurrenceId: 1 })], cycleStart, ctx());
  assert.deepEqual(reasons(r), ["Marked not daily spending"]);
});

test("real 29 Sep chain: HDFC->YES transfer, then YES pays the held-back card bill", () => {
  const hdfcOut = txn({ amount: 8790.35, transactionDate: new Date("2026-09-29T11:24:50Z") });
  const yesIn = txn({ type: "credit", amount: 8790.35, accountId: 29, accountType: "bank", transactionDate: new Date("2026-09-29T11:32:56Z") });
  const yesOut = txn({ amount: 8790.35, accountId: 29, accountType: "bank", transactionDate: new Date("2026-09-29T11:25:16Z") });
  const bill: CommitmentItem = { itemType: "credit_card_bill", id: 42, name: "YesBank CC Bill Pay", amount: 8790.35, subLabel: "Monthly" };
  const r = selectCountedDebits([hdfcOut, yesIn, yesOut], cycleStart, ctx({ cardBillItems: [bill] }));
  assert.equal(r.counted.length, 0);
  const byId = new Map(r.excluded.map(e => [e.txn.id, e.reason]));
  assert.equal(byId.get(hdfcOut.id), "Transfer between your accounts");
  assert.equal(byId.get(yesOut.id), "Card bill (held back)");
});

test("rule 4: credit landing on a credit card account reads as a card bill", () => {
  const out = txn({ amount: 4628 });
  const cardIn = txn({ type: "credit", amount: 4628, accountId: 34, accountType: "credit_card" });
  const r = selectCountedDebits([out, cardIn], cycleStart, ctx());
  assert.deepEqual(reasons(r), ["Card bill (held back)"]);
});

test("rule 4: each credit pairs with only one debit", () => {
  const out1 = txn({ amount: 500 });
  const out2 = txn({ amount: 500 });
  const inn = txn({ type: "credit", amount: 500, accountId: 29 });
  const r = selectCountedDebits([out1, out2, inn], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.length, 1);
});

test("rule 4: credit into the same account is not a transfer (refund)", () => {
  const r = selectCountedDebits([txn({ amount: 500 }), txn({ type: "credit", amount: 500 })], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
});

test("rule 4: credit more than 24h away does not pair", () => {
  const r = selectCountedDebits([
    txn({ amount: 500, transactionDate: new Date("2026-10-01T06:00:00Z") }),
    txn({ type: "credit", amount: 500, accountId: 29, transactionDate: new Date("2026-10-02T07:00:00Z") }),
  ], cycleStart, ctx());
  assert.equal(r.counted.length, 1);
});

test("rule 5: card bill matches within Rs 1, and only once", () => {
  const bill: CommitmentItem = { itemType: "credit_card_bill", id: "cc-auto-34", name: "HDFC CC Bill", amount: 5000, subLabel: "" };
  const r = selectCountedDebits([txn({ amount: 5000.8 }), txn({ amount: 5000 })], cycleStart, ctx({ cardBillItems: [bill] }));
  assert.equal(r.excluded.length, 1);
  assert.equal(r.counted.length, 1);
});

console.log("\n=== Salary income ===\n");

const sepCycle = { actualAmount: "182052.00", actualPayDate: new Date("2026-09-29T00:00:00Z"), expectedPayDate: new Date("2026-09-30T00:00:00Z") };

test("credited this cycle: actual amount", () => {
  assert.deepEqual(resolveSalaryIncome("182000.00", sepCycle, cycleStart, new Date("2026-10-29T23:59:59Z")), { amount: 182052, isActual: true });
});

test("last credited cycle is the previous one: expected amount", () => {
  const nextStart = new Date("2026-10-30T00:00:00Z");
  assert.deepEqual(resolveSalaryIncome("182000.00", sepCycle, nextStart, new Date("2026-11-27T23:59:59Z")), { amount: 182000, isActual: false });
});

test("no salary cycle row yet: expected amount", () => {
  assert.deepEqual(resolveSalaryIncome("182000.00", null, cycleStart, new Date("2026-10-29T23:59:59Z")), { amount: 182000, isActual: false });
});

console.log("\n=== Allowance maths ===\n");

const cycleEnd = new Date("2026-10-29T23:59:59Z");
const held: CommitmentItem[] = [{ itemType: "loan", id: 1, name: "EMI", amount: 50000, subLabel: "" }];

test("recalculates from what's left: (income - held - spent before today) / days left", () => {
  // Today is 2 Oct (IST); 2 Oct..29 Oct inclusive = 28 days.
  const a = computeSpendingAllowance({
    now: new Date("2026-10-02T06:00:00Z"), cycleEnd, salaryIncome: 182000, walletIncome: 8000,
    commitments: held,
    counted: [
      txn({ amount: 4000, transactionDate: new Date("2026-10-01T06:00:00Z") }),
      txn({ amount: 260, transactionDate: new Date("2026-10-02T04:00:00Z") }),
    ],
  });
  assert.equal(a.daysLeft, 28);
  assert.equal(a.heldBack, 50000);
  assert.equal(a.spentBeforeToday, 4000);
  assert.equal(a.spentToday, 260);
  assert.equal(a.dailyLimit, 4857.14);       // (190000 - 50000 - 4000) / 28
  assert.equal(a.todayLeft, 4597.14);
  assert.equal(a.weekLeft, 33740);           // 136000 / 28 * 7 - 260
  assert.equal(a.cycleLeft, 135740);
});

test("spend at 00:10 IST counts as today, not yesterday", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-02T06:00:00Z"), cycleEnd, salaryIncome: 1000, walletIncome: 0, commitments: [],
    counted: [txn({ amount: 100, transactionDate: new Date("2026-10-01T18:40:00Z") })], // 2 Oct 00:10 IST
  });
  assert.equal(a.spentToday, 100);
  assert.equal(a.spentBeforeToday, 0);
});

test("last day of the cycle: daysLeft 1, week capped at 1 day", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-29T10:00:00Z"), cycleEnd, salaryIncome: 1000, walletIncome: 0, commitments: [], counted: [],
  });
  assert.equal(a.daysLeft, 1);
  assert.equal(a.dailyLimit, 1000);
  assert.equal(a.weekLeft, 1000);
});

test("after cycle end (salary not marked yet): daysLeft never below 1", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-31T10:00:00Z"), cycleEnd, salaryIncome: 1000, walletIncome: 0, commitments: [], counted: [],
  });
  assert.equal(a.daysLeft, 1);
});

test("over budget for the cycle: negative numbers come through", () => {
  const a = computeSpendingAllowance({
    now: new Date("2026-10-02T06:00:00Z"), cycleEnd, salaryIncome: 10000, walletIncome: 0,
    commitments: held, counted: [],
  });
  assert.ok(a.dailyLimit < 0);
  assert.ok(a.todayLeft < 0);
  assert.equal(a.cycleLeft, -40000);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
