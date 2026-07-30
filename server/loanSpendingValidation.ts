// Pure validation for loan spending entries — kept separate from routes.ts so it can be
// unit tested without a database, following the same pattern as smsParser.ts.
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
  const received = parseFloat(receivedAmount);
  const allocated = existingEntries.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  if (allocated + newAmount > received) {
    const remaining = received - allocated;
    return `This would exceed the received amount — ₹${remaining.toFixed(2)} remaining to allocate`;
  }
  return null;
}
