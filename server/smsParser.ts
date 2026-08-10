export interface ParsedSmsData {
  amount: number;
  type: "debit" | "credit";
  merchant?: string;
  description?: string;
  referenceNumber?: string;
  date?: string;
  accountLastDigits?: string;
  accountContext?: "bank" | "card";
  availableBalance?: number;
}

export interface ParsedDueSmsData {
  amount: number;
  dueDate?: string;
  cardLastFourDigits?: string;
  providerName?: string;
}

const DEBIT_KEYWORDS = [
  "debited", "deducted", "withdrawn", "spent", "used for",
  "paid", "purchase", "charged", "sent"
];

const CREDIT_KEYWORDS = [
  "credited", "received", "deposited", "refunded", "added", "reversed"
];

const DUE_KEYWORDS = [
  "dues of", "minimum due", "total due", "total outstanding",
  "outstanding amount", "amount due", "bill amount", "payment due",
  "e-mandate", "will be deducted", "will be debited", "is due on"
];

// "X will be deducted/debited on <future date>" (e-mandate / subscription pre-notifications)
// use the same verbs as a completed transaction ("deducted", "debited") but describe something
// that HASN'T happened yet — must be checked before the debit/credit keyword match, or these
// get recorded as completed transactions dated in the future.
const PRE_NOTIFICATION_PATTERNS = [/e-mandate/i, /will be deducted/i, /will be debited/i];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function extractAmount(msg: string): number | null {
  const patterns = [
    /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i,
    /(?:rs\.?|inr|₹)([\d,]+(?:\.\d{1,2})?)/i,
    // Loan/EMI due reminders often state the amount with no currency marker at all
    // ("your personal loan EMI of   63,897.00  for a/c ... is due on 04/08/26") — narrowly
    // scoped to "emi/installment of <amount>" rather than loosening the patterns above.
    /(?:emi|installment)\s+of\s+([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const raw = match[1].replace(/,/g, "");
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function extractType(lowerMsg: string): "debit" | "credit" | null {
  const isDebit = DEBIT_KEYWORDS.some(k => lowerMsg.includes(k));
  const isCredit = CREDIT_KEYWORDS.some(k => lowerMsg.includes(k));
  if (!isDebit && !isCredit) return null;
  if (isDebit && isCredit) {
    const debitIdx = Math.min(
      ...DEBIT_KEYWORDS.map(k => lowerMsg.indexOf(k)).filter(i => i >= 0)
    );
    const creditIdx = Math.min(
      ...CREDIT_KEYWORDS.map(k => lowerMsg.indexOf(k)).filter(i => i >= 0)
    );
    return debitIdx < creditIdx ? "debit" : "credit";
  }
  return isDebit ? "debit" : "credit";
}

function extractAccountLastDigits(msg: string): string | undefined {
  const patterns = [
    /(?:a\/c|acc(?:ount)?)\s*[X*]{0,8}(\d{4})\b/i,
    /[Xx]{2,}(\d{4})\b/,
    /\*{2,}(\d{4})\b/,
    /ending\s+(\d{4})\b/i,
    /card\s+[X*]*(\d{4})\b/i,
  ];
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

// Disambiguates which of a bank's accounts an SMS belongs to when the last-4-digit match
// alone is inconclusive (e.g. that field isn't set on one of the user's same-bank accounts —
// it's optional). Card narrations mention "card" ("HDFC Bank Credit Card ending 1234", "card
// XX1234 used for"); bank-account narrations use "a/c"/"account" ("From HDFC Bank A/C *7900").
// Check "card" first since a credit card SMS can still say "a/c" without being a bank-account
// transaction.
function extractAccountContext(msg: string): "bank" | "card" | undefined {
  if (/\bcard\b/i.test(msg)) return "card";
  if (/\b(?:a\/c|acc(?:ount)?)\b/i.test(msg)) return "bank";
  return undefined;
}

function extractAvailableBalance(msg: string): number | undefined {
  const pattern = /(?:avl\.?\s*bal(?:ance)?|available\s*balance|\bbal(?:ance)?)\s*(?:is)?\s*[:\s]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i;
  const match = msg.match(pattern);
  if (match) {
    const parsed = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function extractReferenceNumber(msg: string): string | undefined {
  const patterns = [
    /ref-?upi\/(\d+)/i,
    /(?:ref(?:erence)?(?:\s*no\.?)?|utr|rrn|txn(?:\s*id)?)[:\s]+([A-Z0-9\/]+)/i,
    /(?:upi\s*ref(?:no)?)[:\s]+([A-Z0-9\/]+)/i,
    /(?:imps|neft)\s+(?:ref)?[:\s]*([A-Z0-9]+)/i,
  ];
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match && match[1].length >= 6) {
      return match[1].replace(/\/$/, "");
    }
  }
  return undefined;
}

// Inward remittance narrations (NEFT/RTGS/IMPS credit) follow a fixed dash-delimited shape:
// "NEFT Cr-<sender/IFSC code>-<PAYER NAME>-<purpose>-<UTR>" — the payer name is always the
// segment right after the sender code, which a generic "for X" pattern can't reliably isolate
// since the whole narration runs together as one long hyphenated string.
const REMITTANCE_PAYER_PATTERN = /(?:NEFT|RTGS|IMPS)\s+Cr-[A-Z0-9]+-([A-Za-z0-9 &.]+?)-/i;

function extractMerchant(msg: string): string | undefined {
  const remittanceMatch = msg.match(REMITTANCE_PAYER_PATTERN);
  if (remittanceMatch) {
    const candidate = remittanceMatch[1].trim();
    if (candidate.length >= 2) return candidate;
  }

  const patterns = [
    /\bat\s+([A-Z][A-Z0-9 &\-\.]{2,35}?)(?:\.|,|\s+on\s|\s+avl|\s+ref|\s*\n|$)/i,
    /\bto\s+(?:upi-)?([A-Z][A-Z0-9 &\-\.@]{2,35}?)(?:\.|,|\s+on\s|\s+avl|\s+ref|\s*\n|$)/i,
    /\bfor\s+([A-Z][A-Z0-9 &\-\.]{2,35}?)(?:\.|,|\s+on\s|\s+avl|\s+ref|\s*\n|$)/i,
    /info:\s*([A-Z][A-Z0-9 &\-\.]{2,35}?)(?:\.|,|\n|$)/i,
    /towards\s+([A-Z][A-Z0-9 &\-\.]{2,35}?)(?:\.|,|\s+on\s|\s+avl|\s+ref|\s*\n|$)/i,
  ];
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      // These patterns are case-insensitive (needed so terminators like "avl"/"on" also match
      // "Avl"/"On" in real messages), which defeats [A-Z] as a "looks like a proper name" filter
      // baked into the pattern itself — so re-check case explicitly here, outside the /i match.
      if (/^[A-Z]/.test(candidate) && !candidate.match(/^\d/) && candidate.length >= 2) {
        return candidate;
      }
    }
  }
  return undefined;
}

function extractDate(msg: string): string | undefined {
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => [number, number, number] | null]> = [
    [/(\d{2})-([A-Za-z]{3})-(\d{2,4})/, m => {
      const month = MONTHS[m[2].toLowerCase()];
      return month ? [parseInt(m[1]), month, parseInt(m[3])] : null;
    }],
    [/(\d{2})([A-Za-z]{3})(\d{2,4})/, m => {
      const month = MONTHS[m[2].toLowerCase()];
      return month ? [parseInt(m[1]), month, parseInt(m[3])] : null;
    }],
    [/(\d{2})\/(\d{2})\/(\d{2,4})/, m => [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]],
    [/(\d{2})-(\d{2})-(\d{2,4})/, m => [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]],
  ];

  for (const [pattern, extract] of patterns) {
    const match = msg.match(pattern);
    if (!match) continue;
    const parts = extract(match);
    if (!parts) continue;
    let [day, month, year] = parts;
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}T00:00:00.000Z`;
  }
  return undefined;
}

// Indian DLT SMS headers follow a fixed shape: <2-letter series>-<entity code>-<1-letter type>,
// e.g. "AX-ICICIT-S", "VA-EPFOHO-G". Different message types for the SAME institution rotate the
// series/type letters (AX-INDUSB-S, AD-INDUSB-S, JM-INDUSB-S all belong to IndusInd Bank), so we
// key on the middle entity code to group sender-ID variants of one real institution together.
// Senders that don't follow this pattern fall back to their raw (uppercased) form as the key.
export function deriveInstitutionKey(sender: string): string {
  const match = sender.trim().match(/^[A-Z]{2}-([A-Z0-9]+)-[A-Z]$/i);
  return (match ? match[1] : sender.trim()).toUpperCase();
}

export function parseSmsByRegex(message: string, sender?: string): ParsedSmsData | null {
  const lowerMsg = message.toLowerCase();

  // Must have a currency marker
  if (!lowerMsg.includes("rs") && !lowerMsg.includes("inr") && !lowerMsg.includes("₹")) {
    return null;
  }

  // "Will be deducted/debited" (e-mandate, subscription pre-notifications) describes a future
  // event, not a completed one — must be excluded before the debit-keyword check below, which
  // would otherwise match "deducted"/"debited" and record it as an already-completed transaction.
  if (PRE_NOTIFICATION_PATTERNS.some(p => p.test(message))) {
    return null;
  }

  const type = extractType(lowerMsg);
  if (!type) return null;

  const amount = extractAmount(message);
  if (!amount) return null;

  const accountLastDigits = extractAccountLastDigits(message);
  const accountContext = extractAccountContext(message);
  const referenceNumber = extractReferenceNumber(message);
  const merchant = extractMerchant(message);
  const date = extractDate(message);
  const availableBalance = extractAvailableBalance(message);

  const description = merchant
    ? `${type === "debit" ? "Payment to" : "Received from"} ${merchant}`
    : type === "debit" ? "Amount debited" : "Amount credited";

  return { amount, type, merchant, description, referenceNumber, date, accountLastDigits, accountContext, availableBalance };
}

// Due-reminder SMS ("has dues of Rs X", "minimum due", "total outstanding") are not transactions —
// parseSmsByRegex already rejects them (no debit/credit keyword), so callers should try that first
// and only fall back to this when it returns null. Extracts just enough to route the message:
// an amount plus, when present, a due date and/or a card's last 4 digits — never a merchant/category,
// since a due notice isn't a spend event.
export function parseDueSms(message: string): ParsedDueSmsData | null {
  const lowerMsg = message.toLowerCase();

  // Most due-reminders carry a currency marker next to the amount, but loan/EMI due
  // notices often don't ("personal loan EMI of 63,897.00 ... is due on 04/08/26") — let
  // that narrow, specific phrasing through even with no rs/inr/₹ anywhere in the message.
  const hasCurrencyMarker = lowerMsg.includes("rs") || lowerMsg.includes("inr") || lowerMsg.includes("₹");
  const hasEmiAmountPhrasing = /(?:emi|installment)\s+of\s+[\d,]/i.test(message);
  if (!hasCurrencyMarker && !hasEmiAmountPhrasing) {
    return null;
  }

  const hasDueKeyword = DUE_KEYWORDS.some(k => lowerMsg.includes(k));
  if (!hasDueKeyword) return null;

  const amount = extractAmount(message);
  if (!amount) return null;

  const dueDate = extractDate(message);
  const cardLastFourDigits = extractAccountLastDigits(message);
  const providerName = extractProviderName(message);

  return { amount, dueDate, cardLastFourDigits, providerName };
}

// E-mandate / subscription pre-notifications name the payee as "For X mandate" or
// "For X Ltd mandate" — distinct from extractMerchant's transaction-narration patterns, since
// this phrasing is specific to future-dated mandate alerts, not completed spends.
function extractProviderName(msg: string): string | undefined {
  const match = msg.match(/\bfor\s+([A-Za-z0-9 &.]+?)\s+mandate\b/i);
  if (match) {
    const candidate = match[1].trim();
    if (candidate.length >= 2) return candidate;
  }
  return undefined;
}
