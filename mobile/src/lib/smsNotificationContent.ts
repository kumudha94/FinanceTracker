// Builds the "transaction added" notification shown after an SMS is auto-read. Kept free of
// React Native imports so it can be unit-tested with plain Node.

export const DEEP_LINK_PREFIX = 'com.mytracker.finance://';

export interface SmsNotificationResult {
  transaction?: { id: number; transactionDate?: string } | null;
  parsed?: { amount: number; type: 'debit' | 'credit'; merchant?: string };
  duplicate?: boolean;
  pendingReview?: boolean;
  summary?: {
    accountName: string;
    accountType: string;
    categoryName: string | null;
    balance: string | null;
  };
}

export interface SmsNotificationContent {
  title: string;
  body: string;
  data: { url: string };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRupees(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// "1 Oct, 12:18 PM" in the phone's local time.
function formatWhen(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${hour12}:${minutes} ${period}`;
}

// Returns null when there is nothing to tell the user: unparsed SMS, ignored senders, and
// duplicates (banks often send one transaction twice, which used to notify twice).
export function buildSmsNotification(
  result: SmsNotificationResult,
  now: Date = new Date()
): SmsNotificationContent | null {
  if (!result.parsed) return null;
  const { amount, type, merchant } = result.parsed;
  const verb = type === 'credit' ? 'credited' : 'debited';

  if (result.pendingReview) {
    return {
      title: `New account detected: ${formatRupees(amount)} ${verb}`,
      body: 'This SMS came from a bank or card the app doesn\'t know yet. Tap to choose the account so it gets added.',
      data: { url: `${DEEP_LINK_PREFIX}institution-mappings` },
    };
  }

  if (!result.transaction || result.duplicate) return null;

  const { summary, transaction } = result;
  const title = summary
    ? `${formatRupees(amount)} ${verb} · ${summary.accountName}`
    : `${formatRupees(amount)} ${verb}`;

  const lines: string[] = [];
  if (merchant) lines.push(`${type === 'credit' ? 'From' : 'To'}: ${merchant}`);
  if (summary?.categoryName) lines.push(`Category: ${summary.categoryName}`);
  if (summary?.balance != null) {
    const label = summary.accountType === 'credit_card' ? 'Available limit' : 'Balance';
    lines.push(`${label}: ${formatRupees(summary.balance)}`);
  }
  const when = transaction.transactionDate ? new Date(transaction.transactionDate) : now;
  lines.push(`${formatWhen(isNaN(when.getTime()) ? now : when)} · Tap to edit`);

  return {
    title,
    body: lines.join('\n'),
    data: { url: `${DEEP_LINK_PREFIX}transaction/${transaction.id}` },
  };
}
