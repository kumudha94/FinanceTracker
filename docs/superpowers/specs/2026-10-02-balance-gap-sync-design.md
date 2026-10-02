# Bank Balance Sync and Balance Gaps — Design

**Date:** 2026-10-02
**Status:** Approved (brainstorming), pending spec review

## Goal

Some bank alerts never arrive as SMS. On 29 Sep, YES Bank only emailed the alert for an
incoming ₹27,000 NEFT from HDFC Savings. So the app recorded the HDFC debit as an ordinary
expense and never learned about the YES Bank credit. Account balances in the app also drift
over time.

Most bank SMS end with the bank's own balance ("Avl bal …"). Use that figure to:
1. keep the app's account balance equal to the bank's;
2. notice when money moved without an SMS (a **balance gap**) and let the user explain it in
   one tap, especially a transfer between their own accounts.

## Decisions (from brainstorming)

- **The app's balance follows the bank's figure automatically.** The prompt only explains
  the gap. It never asks permission to correct the balance.
- **Scope: `bank` and `wallet` accounts only.** Credit cards are excluded. Card SMS rarely
  carry a balance (2 of 21 for HDFC CC), and when they do, "balance" can mean the amount owed
  or the credit available, so syncing could corrupt card balances.
- **The first gap per account is quiet.** The balance is corrected and logged, but no review
  item is raised, so the user isn't asked to explain months of old drift on day one.
- **Transfer matching window: 3 days.** Amounts match within ₹1.

## 1. Data model (`shared/schema.ts`)

New table `balance_gaps`:

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer FK users, not null | |
| `accountId` | integer FK accounts, not null | the account whose balance was synced |
| `smsTransactionId` | integer FK transactions, nullable, on delete set null | the SMS transaction that carried the bank's balance |
| `appBalanceBefore` | decimal(14,2), not null | the app's balance after applying that SMS's own transaction, before syncing |
| `bankBalance` | decimal(14,2), not null | the bank's reported balance |
| `gapAmount` | decimal(14,2), not null | `bankBalance − appBalanceBefore`; positive = missed credit, negative = missed debit |
| `status` | varchar(20), not null | `'auto_synced'` (first gap per account, never shown), `'pending'`, `'resolved'`, `'dismissed'` |
| `resolution` | varchar(20), nullable | `'transfer'`, `'income'`, `'expense'`, set when resolved |
| `resolvedTransactionId` | integer FK transactions, nullable, on delete set null | the transfer, income or expense that explains it |
| `createdAt` / `resolvedAt` | timestamp | |

Add an insert schema and types, following `smsPaymentMatchReviews`.

**Deploy ordering:** `npm run db:push` before, or together with, the server deploy.

## 2. Pure logic (`server/balanceSync.ts`, unit-tested, no DB)

```ts
detectBalanceGap(input: {
  accountType: string;           // only 'bank' | 'wallet' are eligible
  appBalanceAfterSms: number;    // the account balance after this SMS's own transaction was applied
  bankBalance: number;           // the SMS's availableBalance
  isFirstGapForAccount: boolean; // no balance_gaps row exists yet for this account
}): { gapAmount: number; status: 'auto_synced' | 'pending' } | null   // null = no sync needed (|gap| < 1) or not eligible

findTransferCandidates(input: {
  gapAmount: number;             // > 0 only; returns [] for a negative gap
  gapAccountId: number;
  smsDate: Date;
  debits: CandidateDebit[];      // the user's recent debits from other bank/wallet accounts
}): CandidateDebit[]             // same amount within ₹1, smsDate − 3 days ≤ date ≤ smsDate,
                                 // different account, type 'debit' (never 'transfer'), not already
                                 // used by another gap; nearest in time first
```

A gap under ₹1 in absolute terms is rounding, not a gap.

## 3. Where the sync runs (`server/routes.ts`, `processSingleSms`)

After `finishWithTransaction` creates a **new** transaction (not the duplicate path), when
`parsedData.availableBalance` is set and the matched account is a `bank` or `wallet`:

1. **Newest-figure guard:** sync only if this SMS's transaction date is on or after the
   latest transaction date that already carries an `availableBalance` for this account. A
   rescan of old SMS (parse-sms-batch) or an out-of-order delivery must never set the
   balance back to an older figure. Mapping backfills (`backfillQueuedSmsForMapping`) don't sync at
   all.
2. Read the account's balance (already updated by `createTransaction`) and call
   `detectBalanceGap`.
3. On a result: set the account balance to `bankBalance`, insert a `balance_gaps` row with
   the returned status, and add `balanceGap: { id, accountName, gapAmount, status }` to the
   parse-sms response.

Any failure here is logged and swallowed. The transaction is already saved, and a missed sync
only means the balance is corrected on the next balance-bearing SMS.

## 4. Endpoints

- `GET /api/balance-gaps?status=pending`: the user's pending gaps, newest first. Each comes
  with its account name and, for a positive gap, its transfer candidates (id, date, amount,
  account name, merchant/description), computed with `findTransferCandidates`.
- `POST /api/balance-gaps/:id/resolve` with body
  `{ action: 'transfer', debitTransactionId } | { action: 'income' | 'expense', amount?, categoryId?, description?, date? }`.
  - **transfer:** convert the candidate debit to `type: 'transfer'` with `toAccountId = gap.accountId`.
    This must leave **both balances where they are**. The source account already paid the
    debit, and the destination was already synced to the bank's figure. Do it in one storage
    method (`convertDebitToSyncedTransfer`) that updates the row without the usual
    reverse-and-reapply balance moves. Validate that the debit belongs to the user, is still a
    `debit`, and is a candidate for this gap.
  - **income / expense:** create a credit (positive gap) or debit (negative gap) on the
    gap's account for `|gapAmount|`, the user's amount override, or the defaults. Create it
    **without moving the balance** (already synced), using a storage flag or a dedicated
    method. Mark it so it isn't mistaken for SMS data.
  - Set `status 'resolved'`, `resolution`, `resolvedTransactionId` and `resolvedAt`.
- `POST /api/balance-gaps/:id/dismiss`: set `status 'dismissed'`.
- Everything is scoped to `req.user.userId`. A gap belonging to another user returns 404.

## 5. App

- **Needs Review hub:** a new "Balance gaps" entry with a pending count, next to "Payment Matches".
- **`BalanceGapsScreen`:** one card per pending gap:
  - **Positive gap with candidates:** "YES Bank was ₹27,000 higher than expected. Was it the
    ₹27,000 from HDFC Savings on 29 Sep?" → **Yes, it's a transfer** (if there are several
    candidates, pick one), or **Add as income**, or **Dismiss**.
  - **Positive gap with no candidates:** "YES Bank received ₹X that wasn't recorded." →
    **Add as income** (category picker, defaulting to Other) or **Dismiss**.
  - **Negative gap:** "₹X left YES Bank without an SMS." → **Add as expense** (category
    picker) or **Dismiss**.
  - Each action invalidates `['/api/balance-gaps']`, `['/api/transactions']`,
    `['/api/accounts']`, `['/api/spending-allowance']` and the dashboard, and calls
    `refreshWidgets()`.
- **Notification:** when a parse-sms response has `balanceGap.status === 'pending'`, show a
  second notification: "YES Bank balance was ₹27,000 higher than expected. Tap to review."
  The deep link `com.mytracker.finance://balance-gaps` opens the screen. Build it in
  `smsNotificationContent.ts`, with a test, like the existing notification. The auto-synced
  first gap produces no notification.

## 6. Testing

- `server/__tests__/balanceSync.test.ts` covers:
  - eligibility: card excluded, bank and wallet included;
  - the ₹1 threshold;
  - first gap auto-synced, later gaps pending;
  - the sign of the gap;
  - the real 29 Sep case: YES Bank +27,000 against the HDFC Savings −27,000 debit at
    07:26 IST → one candidate;
  - window edges (3 days);
  - same account excluded, `transfer` excluded, already-used debit excluded;
  - nearest-first ordering.
- Newest-figure guard: a pure helper with a test (older SMS → no sync).
- `smsNotificationContent` test for the gap notification.
- Live check after deploy: on the user's next YES Bank SMS with a balance, a gap row appears,
  or an `auto_synced` one on the first sync.

## Out of scope

- Reading email alerts.
- Credit card balance sync.
- Retroactively explaining the 29 Sep ₹27,000. That gap predates the feature, and the
  first sync on YES Bank will be quiet. The user fixes it once by hand: edit the HDFC debit
  into a transfer to YesBank Account, then check the YES Bank balance.
- Showing a sync history screen. The `auto_synced` and resolved rows stay in the table for
  later use.
