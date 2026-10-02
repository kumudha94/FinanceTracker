// The SMS endpoints authenticate with an API key, not a user session, so they see every
// account in the DB. The DB holds more than one userId (older ICICI accounts sit under a
// different user than the phone's logged-in one), and matching an SMS to another user's
// account files the transaction where the app can't show it. The phone's owner is whoever
// owns the default account; fall back to the first account's owner when none is default.
export function selectSmsOwnerAccounts<T extends { userId: number | null; isDefault?: boolean | null }>(
  accounts: T[]
): T[] {
  const ownerUserId = (accounts.find(acc => acc.isDefault) ?? accounts[0])?.userId;
  if (ownerUserId == null) return accounts;
  return accounts.filter(acc => acc.userId === ownerUserId);
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// Bank SMS dates carry no time ("on 01-Oct-26"), so the parser returns midnight. Stored as
// is, every SMS from one day ties at 00:00 and sorts below any entry that has a real time.
// When the SMS arrived on the day it names (in IST, the banks' timezone), its arrival time
// is the real transaction time. A rescan of an older SMS keeps the SMS's own date.
export function resolveSmsTransactionDate(parsedDate?: string, receivedAt?: string): string {
  if (parsedDate && receivedAt) {
    const received = new Date(receivedAt);
    if (!isNaN(received.getTime())) {
      const receivedIstDay = new Date(received.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
      if (receivedIstDay === parsedDate.slice(0, 10)) return received.toISOString();
    }
  }
  return parsedDate || receivedAt || new Date().toISOString();
}
