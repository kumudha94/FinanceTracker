export interface ParsedSmsData {
  amount: number;
  type: "debit" | "credit";
  merchant?: string;
  description?: string;
  referenceNumber?: string;
  date?: string;
  accountLastDigits?: string;
}

const DEBIT_KEYWORDS = [
  "debited", "deducted", "withdrawn", "spent", "used for",
  "paid", "purchase", "charged", "sent"
];

const CREDIT_KEYWORDS = [
  "credited", "received", "deposited", "refunded", "added", "reversed"
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function extractAmount(msg: string): number | null {
  const patterns = [
    /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i,
    /(?:rs\.?|inr|₹)([\d,]+(?:\.\d{1,2})?)/i,
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

function extractReferenceNumber(msg: string): string | undefined {
  const patterns = [
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

function extractMerchant(msg: string): string | undefined {
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
      if (!candidate.match(/^\d/) && candidate.length >= 2) {
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

export function parseSmsByRegex(message: string, sender?: string): ParsedSmsData | null {
  const lowerMsg = message.toLowerCase();

  // Must have a currency marker
  if (!lowerMsg.includes("rs") && !lowerMsg.includes("inr") && !lowerMsg.includes("₹")) {
    return null;
  }

  const type = extractType(lowerMsg);
  if (!type) return null;

  const amount = extractAmount(message);
  if (!amount) return null;

  const accountLastDigits = extractAccountLastDigits(message);
  const referenceNumber = extractReferenceNumber(message);
  const merchant = extractMerchant(message);
  const date = extractDate(message);

  const description = merchant
    ? `${type === "debit" ? "Payment to" : "Received from"} ${merchant}`
    : type === "debit" ? "Amount debited" : "Amount credited";

  return { amount, type, merchant, description, referenceNumber, date, accountLastDigits };
}
