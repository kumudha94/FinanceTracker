// Pure logic for syncing app balances to the bank's own "Avl bal" from SMS and explaining the
// gaps. See docs/superpowers/specs/2026-10-02-balance-gap-sync-design.md.

// Card SMS "balance" can mean the amount owed or the credit available, so cards are never synced.
export const SYNCED_ACCOUNT_TYPES = ['bank', 'wallet'];

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function detectBalanceGap(i: {
  accountType: string;
  appBalanceAfterSms: number;
  bankBalance: number;
  isFirstGapForAccount: boolean;
}): { gapAmount: number; status: 'auto_synced' | 'pending' } | null {
  if (!SYNCED_ACCOUNT_TYPES.includes(i.accountType)) return null;
  const gapAmount = round2(i.bankBalance - i.appBalanceAfterSms);
  if (Math.abs(gapAmount) < 1) return null;
  // The first gap is months of old drift; correct it quietly instead of asking about history.
  return { gapAmount, status: i.isFirstGapForAccount ? 'auto_synced' : 'pending' };
}

// A rescan or a late SMS must never set the balance back to an older figure. The bank's figure
// is only current if nothing else has happened on the account since this SMS, and the SMS is
// recent: a rescan can be the first balance figure an account ever gets.
export function isNewestBalanceFigure(smsDate: Date, latestOtherTransactionDate: Date | null, now: Date): boolean {
  if (now.getTime() - smsDate.getTime() >= DAY_MS) return false;
  return latestOtherTransactionDate === null || smsDate.getTime() >= latestOtherTransactionDate.getTime();
}

export interface CandidateDebit {
  id: number;
  type: string;
  amount: number;
  transactionDate: Date;
  accountId: number;
  accountType: string;
  accountName: string;
  merchant: string | null;
}

// Debits from the user's other accounts that could be the sending side of a missed transfer in.
export function findTransferCandidates(i: {
  gapAmount: number;
  gapAccountId: number;
  smsDate: Date;
  debits: CandidateDebit[];
  usedDebitIds: Set<number>;
}): CandidateDebit[] {
  if (i.gapAmount <= 0) return [];
  const smsTime = i.smsDate.getTime();
  const earliest = smsTime - 3 * DAY_MS;
  return i.debits
    .filter(d =>
      d.type === 'debit'
      && SYNCED_ACCOUNT_TYPES.includes(d.accountType)
      && d.accountId !== i.gapAccountId
      && !i.usedDebitIds.has(d.id)
      && Math.abs(d.amount - i.gapAmount) <= 1
      && d.transactionDate.getTime() >= earliest
      && d.transactionDate.getTime() <= smsTime)
    .sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime());
}
