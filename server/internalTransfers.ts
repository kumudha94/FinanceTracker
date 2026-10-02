// Money moving between the user's own accounts is neither income nor expense. Without this,
// an HDFC -> YES Bank transfer shows up as spending on HDFC and income on YES, and a card
// bill payment shows up as income on the card (its purchases were already counted as spending).

export interface FlowTxn {
  id: number;
  type: string;
  amount: number;
  transactionDate: Date;
  accountId: number | null;
  accountType: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Returns the transactions to leave out of income and expense totals:
 * - every credit on a credit card account (bill payments and refunds, never income);
 * - transfers between the user's own accounts: a debit from a non-card account paired with a
 *   same-amount credit on a different account within 24 hours, nearest in time, one-to-one.
 *   When that credit lands on a card it's a bill payment, so the debit isn't an expense either.
 * A card bill paid with no credit recorded on the card stays an expense: if the card's
 * purchases aren't recorded, that payment is the only record of the spending.
 * Pass transactions from a day either side of the period so pairs across its edges match.
 */
export function findInternalTransfers(txns: FlowTxn[]): { notIncome: Set<number>; notExpense: Set<number> } {
  const notIncome = new Set<number>();
  const notExpense = new Set<number>();

  for (const t of txns) {
    if (t.type === 'credit' && t.accountType === 'credit_card') notIncome.add(t.id);
  }

  const unusedCredits = txns.filter(t => t.type === 'credit' && t.accountId !== null);
  const debits = txns
    .filter(t => t.type === 'debit' && t.accountId !== null && t.accountType !== 'credit_card')
    .sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime() || a.id - b.id);

  for (const d of debits) {
    let best = -1;
    let bestGap = Infinity;
    unusedCredits.forEach((c, i) => {
      const gap = Math.abs(c.transactionDate.getTime() - d.transactionDate.getTime());
      if (c.accountId !== d.accountId && sameAmount(c.amount, d.amount) && gap <= DAY_MS && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0) {
      const [credit] = unusedCredits.splice(best, 1);
      notExpense.add(d.id);
      notIncome.add(credit.id);
    }
  }

  return { notIncome, notExpense };
}
