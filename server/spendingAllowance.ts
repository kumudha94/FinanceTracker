// Pure maths for the spending allowance ("safe to spend"): which debits count, what the salary
// income is, and the daily / weekly / cycle figures. No DB access, so it's unit-tested directly.

export const COUNTED_ACCOUNT_TYPES = ['bank', 'debit_card', 'wallet'];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar day in IST as 'YYYY-MM-DD'. */
export function istDayKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type CommitmentType = 'scheduled_payment' | 'loan' | 'insurance' | 'credit_card_bill' | 'savings_goal';

export interface CommitmentItem {
  itemType: CommitmentType;
  id: number | string;
  name: string;
  amount: number;
  subLabel: string;
}

export interface AllowanceTxn {
  id: number;
  type: string;
  amount: number;
  transactionDate: Date;
  accountId: number | null;
  accountType: string | null;
  accountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string | null;
  excludedFromAllowance: boolean;
  paymentOccurrenceId: number | null;
  savingsContributionId: number | null;
}

export interface ExcludedDebit {
  txn: AllowanceTxn;
  reason: string;
  /** Set only when the debit was paired with a credit on another account (transfer or card bill paid from a counted account). */
  pairedCreditId?: number;
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Splits this cycle's debits on counted accounts into counted spending and excluded debits
 * (with the reason shown to the user). `txns` may include credits and other account types from
 * up to a day before the cycle: those are only used to pair transfers.
 */
export function selectCountedDebits(
  txns: AllowanceTxn[],
  cycleStart: Date,
  ctx: { linkedPaymentTxnIds: Set<number>; neverCountCategoryIds: Set<number>; cardBillItems: CommitmentItem[] }
): { counted: AllowanceTxn[]; excluded: ExcludedDebit[] } {
  const debits = txns
    .filter(t => t.type === 'debit' && t.transactionDate >= cycleStart && COUNTED_ACCOUNT_TYPES.includes(t.accountType ?? ''))
    .sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime() || a.id - b.id);
  const unusedCredits = txns.filter(t => t.type === 'credit' && t.accountId !== null);
  const unusedBills = [...ctx.cardBillItems];

  const counted: AllowanceTxn[] = [];
  const excluded: ExcludedDebit[] = [];

  for (const d of debits) {
    let reason: string | null = null;
    let pairedCreditId: number | undefined;

    if (d.excludedFromAllowance) {
      reason = 'Marked not daily spending';
    } else if (d.paymentOccurrenceId || d.savingsContributionId || ctx.linkedPaymentTxnIds.has(d.id)) {
      reason = 'Planned payment';
    } else if (d.categoryId !== null && ctx.neverCountCategoryIds.has(d.categoryId)) {
      reason = `Category: ${d.categoryName ?? 'Excluded'}`;
    } else {
      const creditIdx = unusedCredits.findIndex(c =>
        c.accountId !== d.accountId
        && sameAmount(c.amount, d.amount)
        && Math.abs(c.transactionDate.getTime() - d.transactionDate.getTime()) <= DAY_MS
      );
      if (creditIdx >= 0) {
        const [credit] = unusedCredits.splice(creditIdx, 1);
        pairedCreditId = credit.id;
        reason = credit.accountType === 'credit_card' ? 'Card bill (held back)' : 'Transfer between your accounts';
      } else {
        const billIdx = unusedBills.findIndex(b => Math.abs(b.amount - d.amount) <= 1);
        if (billIdx >= 0) {
          unusedBills.splice(billIdx, 1);
          reason = 'Card bill (held back)';
        }
      }
    }

    if (reason) excluded.push(pairedCreditId !== undefined ? { txn: d, reason, pairedCreditId } : { txn: d, reason });
    else counted.push(d);
  }

  return { counted, excluded };
}

/**
 * Credits into wallet accounts within the cycle, less any wallet credit that `selectCountedDebits`
 * paired with an excluded debit (the wallet half of a bank -> wallet top-up: that money is already
 * in the salary, so counting it again would double it). Wallet credits nobody paired (e.g.
 * employer-funded meal card loads) still count.
 */
export function computeWalletIncome(txns: AllowanceTxn[], excluded: ExcludedDebit[], cycleStart: Date): number {
  const paired = new Set(excluded.flatMap(e => (e.pairedCreditId !== undefined ? [e.pairedCreditId] : [])));
  return round2(txns
    .filter(t => t.type === 'credit' && t.accountType === 'wallet' && t.transactionDate >= cycleStart && !paired.has(t.id))
    .reduce((sum, t) => sum + t.amount, 0));
}

/**
 * Salary for the cycle: the actual credited amount when the latest salary cycle was paid within
 * this cycle (5 days of slack before the start, since salary often lands the day before payday),
 * otherwise the profile's expected monthly amount.
 */
export function resolveSalaryIncome(
  monthlyAmount: string,
  lastCycle: { actualAmount: string | null; actualPayDate: Date | null; expectedPayDate: Date } | null,
  cycleStart: Date,
  cycleEnd: Date
): { amount: number; isActual: boolean } {
  if (lastCycle?.actualAmount) {
    const paidOn = new Date(lastCycle.actualPayDate ?? lastCycle.expectedPayDate);
    if (paidOn.getTime() >= cycleStart.getTime() - 5 * DAY_MS && paidOn <= cycleEnd) {
      return { amount: parseFloat(lastCycle.actualAmount), isActual: true };
    }
  }
  return { amount: parseFloat(monthlyAmount), isActual: false };
}

export interface SpendingAllowance {
  daysLeft: number;
  dailyLimit: number;
  spentToday: number;
  spentBeforeToday: number;
  todayLeft: number;
  weekLeft: number;
  cycleLeft: number;
  heldBack: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeSpendingAllowance(input: {
  now: Date;
  cycleEnd: Date;
  salaryIncome: number;
  walletIncome: number;
  commitments: CommitmentItem[];
  counted: AllowanceTxn[];
}): SpendingAllowance {
  const today = istDayKey(input.now);
  // cycleEnd is a server-local (UTC) end-of-day, so its UTC date is the cycle's last calendar day.
  const lastDay = input.cycleEnd.toISOString().slice(0, 10);
  const daysLeft = Math.max(1, Math.round((Date.parse(lastDay) - Date.parse(today)) / DAY_MS) + 1);

  const heldBack = input.commitments.reduce((sum, c) => sum + c.amount, 0);
  let spentToday = 0;
  let spentBeforeToday = 0;
  for (const t of input.counted) {
    if (istDayKey(t.transactionDate) === today) spentToday += t.amount;
    else spentBeforeToday += t.amount;
  }

  const income = input.salaryIncome + input.walletIncome;
  const dailyLimit = (income - heldBack - spentBeforeToday) / daysLeft;

  return {
    daysLeft,
    dailyLimit: round2(dailyLimit),
    spentToday: round2(spentToday),
    spentBeforeToday: round2(spentBeforeToday),
    todayLeft: round2(dailyLimit - spentToday),
    weekLeft: round2(dailyLimit * Math.min(7, daysLeft) - spentToday),
    cycleLeft: round2(income - heldBack - spentBeforeToday - spentToday),
    heldBack: round2(heldBack),
  };
}
