// Money is compared in integer paise so float sums like 0.1 + 0.2 don't spuriously exceed 0.3.
export function toPaise(value: number): number {
  return Math.round(value * 100);
}

export function validateNewSpendingEntry(
  receivedAmount: string | null,
  existingEntries: { amount: string }[],
  newAmount: number
): string | null {
  if (receivedAmount === null) {
    return "Set the received amount before adding entries";
  }
  if (!(newAmount > 0)) {
    return "Amount must be greater than 0";
  }
  const received = toPaise(parseFloat(receivedAmount));
  const allocated = existingEntries.reduce((sum, e) => sum + toPaise(parseFloat(e.amount)), 0);
  if (allocated + toPaise(newAmount) > received) {
    const remaining = (received - allocated) / 100;
    return `This would exceed the received amount — ₹${remaining.toFixed(2)} remaining to allocate`;
  }
  return null;
}
