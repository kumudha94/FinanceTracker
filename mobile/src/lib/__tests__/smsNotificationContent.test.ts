import assert from 'node:assert/strict';
import { buildSmsNotification, buildBalanceGapNotification } from '../smsNotificationContent';

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

console.log('\n=== SMS Notification Content Tests ===\n');

// Built from local-time parts so the expected "1 Oct, 12:18 PM" holds in any timezone.
const when = new Date(2026, 9, 1, 12, 18).toISOString();

const debit = {
  transaction: { id: 469, transactionDate: when },
  parsed: { amount: 300, type: 'debit' as const, merchant: 'M S AAKASH HOSPITAL' },
  summary: { accountName: 'HDFC Savings', accountType: 'bank', categoryName: 'Medical', balance: '218372.86' },
};

test('debit shows account, merchant, category, balance, time', () => {
  const n = buildSmsNotification(debit)!;
  assert.equal(n.title, '₹300 debited · HDFC Savings');
  assert.equal(n.body, 'To: M S AAKASH HOSPITAL\nCategory: Medical\nBalance: ₹2,18,372.86\n1 Oct, 12:18 PM · Tap to edit');
  assert.equal(n.data.url, 'com.mytracker.finance://transaction/469');
});

test('credit says From', () => {
  const n = buildSmsNotification({ ...debit, parsed: { ...debit.parsed, type: 'credit', merchant: 'COMCAST' } })!;
  assert.equal(n.title, '₹300 credited · HDFC Savings');
  assert.ok(n.body.startsWith('From: COMCAST\n'));
});

test('credit card shows available limit', () => {
  const n = buildSmsNotification({ ...debit, summary: { ...debit.summary, accountType: 'credit_card', balance: '8790.35' } })!;
  assert.ok(n.body.includes('Available limit: ₹8,790.35'));
});

test('duplicate SMS does not notify', () => {
  assert.equal(buildSmsNotification({ ...debit, duplicate: true }), null);
});

test('unparsed SMS does not notify', () => {
  assert.equal(buildSmsNotification({ transaction: null }), null);
});

test('pending review opens the account mapping screen', () => {
  const n = buildSmsNotification({ transaction: null, pendingReview: true, parsed: { amount: 500, type: 'debit' } })!;
  assert.equal(n.title, 'New account detected: ₹500 debited');
  assert.equal(n.data.url, 'com.mytracker.finance://institution-mappings');
});

test('older server without summary still gives a useful message', () => {
  const n = buildSmsNotification({ transaction: { id: 1, transactionDate: when }, parsed: { amount: 99.5, type: 'debit' } })!;
  assert.equal(n.title, '₹99.50 debited');
  assert.equal(n.body, '1 Oct, 12:18 PM · Tap to edit');
});

console.log('\n=== Balance Gap Notification Tests ===\n');

test('pending gap, bank higher: tap to review', () => {
  const n = buildBalanceGapNotification({ balanceGap: { id: 1, accountName: 'YesBank Account', gapAmount: 27000, status: 'pending' } })!;
  assert.equal(n.title, 'YesBank Account balance was ₹27,000 higher than expected');
  assert.equal(n.body, 'Tap to review what it was.');
  assert.equal(n.data.url, 'com.mytracker.finance://balance-gaps');
});

test('pending gap, bank lower', () => {
  const n = buildBalanceGapNotification({ balanceGap: { id: 2, accountName: 'HDFC Savings', gapAmount: -250, status: 'pending' } })!;
  assert.equal(n.title, 'HDFC Savings balance was ₹250 lower than expected');
});

test('first (auto-synced) gap does not notify', () => {
  assert.equal(buildBalanceGapNotification({ balanceGap: { id: 3, accountName: 'X', gapAmount: 500, status: 'auto_synced' } }), null);
});

test('no gap, no notification', () => {
  assert.equal(buildBalanceGapNotification({}), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
