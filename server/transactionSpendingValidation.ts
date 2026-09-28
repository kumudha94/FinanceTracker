// Pure validation for transaction spending tracking — kept separate from routes.ts so it can
// be unit tested without a database, following the same pattern as loanSpendingValidation.ts.
import { toPaise } from "./loanSpendingValidation";

const INCOME_ONLY = "Spending tracking is only available for income transactions";

// Rejects turning the tracker on for anything but an income transaction.
export function validateTrackerToggle(type: string, requested: boolean | undefined): string | null {
  if (requested === true && type !== "credit") return INCOME_ONLY;
  return null;
}

// When a tracked transaction stops being income, the tracker is forced off (entries are kept).
// Returns the value to write, or undefined to leave the column untouched.
export function resolveTrackerFlag(newType: string, requested: boolean | undefined, current: boolean): boolean | undefined {
  if (newType !== "credit" && current) return false;
  return requested;
}

export function validateEntryWrite(tx: { type: string; spendingTrackerEnabled: boolean }): string | null {
  if (tx.type !== "credit") return INCOME_ONLY;
  if (!tx.spendingTrackerEnabled) return "Turn on spending tracking for this transaction first";
  return null;
}

// A tracked transaction's amount can't drop below what its breakdown already allocates.
export function validateAmountChange(newAmount: number, entries: { amount: string }[]): string | null {
  const allocated = entries.reduce((sum, e) => sum + toPaise(parseFloat(e.amount)), 0);
  if (toPaise(newAmount) < allocated) {
    return `Amount can't be lower than the ₹${(allocated / 100).toFixed(2)} already allocated in its spending breakdown`;
  }
  return null;
}
