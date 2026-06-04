# SMS Auto-Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bank SMS messages automatically create transactions in FinanceTracker by replacing the broken OpenAI-dependent parser with a comprehensive Indian bank regex parser and adding smart account matching.

**Architecture:** Extract SMS parsing into a standalone `server/smsParser.ts` module (pure functions, no external deps), wire it into `parseSmsMessage()` in `openai.ts` (removing the OpenAI call), and add a `matchAccountBySender()` helper in `routes.ts` to route transactions to the correct account instead of always defaulting.

**Tech Stack:** TypeScript, Node.js 18+, `tsx` (dev runner), Express, Drizzle ORM

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `server/smsParser.ts` | Pure regex parser — `parseSmsByRegex()` |
| Create | `server/__tests__/smsParser.test.ts` | Unit tests for all bank formats |
| Modify | `server/openai.ts` lines 116–167 | Replace OpenAI call with `parseSmsByRegex`, fix undefined bug |
| Modify | `server/routes.ts` | Add `matchAccountBySender()`, update `/api/parse-sms` and `/api/parse-sms-batch` |

---

## Task 1: Create the test file (TDD — tests first)

**Files:**
- Create: `server/__tests__/smsParser.test.ts`

- [ ] **Step 1.1: Create the test file**

Create `server/__tests__/smsParser.test.ts` with this content:

```typescript
import assert from "node:assert/strict";
import { parseSmsByRegex } from "../smsParser";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

console.log("\n=== SMS Parser Tests ===\n");

// ── Amount extraction ──────────────────────────────────────────────────────
console.log("Amount extraction:");

test("Rs. format with paise", () => {
  const r = parseSmsByRegex("Rs.500.00 debited from A/c XX1234", "HDFCBK");
  assert(r !== null);
  assert.equal(r!.amount, 500);
});

test("INR format", () => {
  const r = parseSmsByRegex("INR 1000.00 has been debited from your A/c XX9012", "AXISBK");
  assert(r !== null);
  assert.equal(r!.amount, 1000);
});

test("Rs with comma thousands", () => {
  const r = parseSmsByRegex("Rs.1,500.00 debited from A/c XX1234", "HDFCBK");
  assert(r !== null);
  assert.equal(r!.amount, 1500);
});

test("Lakh format", () => {
  const r = parseSmsByRegex("Rs.1,50,000.00 debited from A/c XX1234", "HDFCBK");
  assert(r !== null);
  assert.equal(r!.amount, 150000);
});

// ── Transaction type ───────────────────────────────────────────────────────
console.log("\nTransaction type:");

test("debit detection", () => {
  const r = parseSmsByRegex("Rs.500 debited from A/c XX1234", "HDFCBK");
  assert.equal(r!.type, "debit");
});

test("credit detection", () => {
  const r = parseSmsByRegex("Rs.5000 credited to A/c XX5678 from SALARY", "ICICIBK");
  assert.equal(r!.type, "credit");
});

test("non-transaction SMS returns null", () => {
  const r = parseSmsByRegex("Your OTP is 123456. Do not share.", "HDFCBK");
  assert.equal(r, null);
});

test("promotional SMS returns null", () => {
  const r = parseSmsByRegex("Congratulations! You have won a prize.", "ADS");
  assert.equal(r, null);
});

// ── Account last digits ────────────────────────────────────────────────────
console.log("\nAccount last digits:");

test("A/c XX format", () => {
  const r = parseSmsByRegex("Rs.500 debited from A/c XX1234 at SWIGGY", "HDFCBK");
  assert.equal(r!.accountLastDigits, "1234");
});

test("A/C uppercase asterisk format", () => {
  const r = parseSmsByRegex("Rs 500 debited from Kotak Savings A/C XXXXXXXX5678", "KOTAK");
  assert.equal(r!.accountLastDigits, "5678");
});

test("card ending format", () => {
  const r = parseSmsByRegex("Rs.500 spent on card ending 9012 at AMAZON", "HDFCBK");
  assert.equal(r!.accountLastDigits, "9012");
});

// ── Merchant extraction ────────────────────────────────────────────────────
console.log("\nMerchant extraction:");

test("'at MERCHANT' pattern", () => {
  const r = parseSmsByRegex(
    "Rs.500.00 debited from A/c XX1234 on 04-Jun-26 at SWIGGY. Avl Bal: Rs.15,000.00",
    "HDFCBK"
  );
  assert(r!.merchant?.toUpperCase().includes("SWIGGY"), `Expected SWIGGY, got: ${r!.merchant}`);
});

test("'to UPI-MERCHANT' pattern", () => {
  const r = parseSmsByRegex(
    "Rs 250.50 debited from A/c XX5678 on 24-05-26 to UPI-ZOMATO PAYMENTS. Available Balance: Rs 12,500.75",
    "ICICIBK"
  );
  assert(r!.merchant?.toUpperCase().includes("ZOMATO"), `Expected ZOMATO, got: ${r!.merchant}`);
});

test("'for MERCHANT' pattern (Axis)", () => {
  const r = parseSmsByRegex(
    "INR 1000.00 has been debited from your A/c XX9012 on 24-MAY-26 for AMAZON PURCHASE. Avl Bal: INR 8,000.00",
    "AXISBK"
  );
  assert(r!.merchant?.toUpperCase().includes("AMAZON"), `Expected AMAZON, got: ${r!.merchant}`);
});

// ── Reference number ───────────────────────────────────────────────────────
console.log("\nReference number:");

test("UPI ref format", () => {
  const r = parseSmsByRegex(
    "Rs.500.00 debited from A/c XX1234. Ref No: UPI/12345678",
    "HDFCBK"
  );
  assert(r!.referenceNumber?.includes("12345678"), `Got: ${r!.referenceNumber}`);
});

test("UTR format", () => {
  const r = parseSmsByRegex(
    "Rs.500 debited from A/c XX1234. UTR: 987654321012",
    "SBIINB"
  );
  assert(r!.referenceNumber?.includes("987654321012"), `Got: ${r!.referenceNumber}`);
});

// ── Bank-specific formats ──────────────────────────────────────────────────
console.log("\nBank-specific formats:");

test("HDFC full format", () => {
  const r = parseSmsByRegex(
    "Rs.500.00 debited from A/c XX1234 on 04-Jun-26 at STARBUCKS CAFE. Avl Bal: Rs.15,000.00. Ref No: UPI/12345678",
    "HDFCBK"
  );
  assert(r !== null);
  assert.equal(r!.amount, 500);
  assert.equal(r!.type, "debit");
  assert.equal(r!.accountLastDigits, "1234");
});

test("ICICI full format", () => {
  const r = parseSmsByRegex(
    "Rs 250.50 debited from A/c XX5678 on 24-05-26 to UPI-ZOMATO PAYMENTS. Available Balance: Rs 12,500.75",
    "ICICIBK"
  );
  assert(r !== null);
  assert.equal(r!.amount, 250.50);
  assert.equal(r!.type, "debit");
  assert.equal(r!.accountLastDigits, "5678");
});

test("SBI format", () => {
  const r = parseSmsByRegex(
    "Your A/c XX3456 debited with Rs.750.00 on 24May26 Ref UPI/98765432. Avl Bal Rs.20,000.00",
    "SBIINB"
  );
  assert(r !== null);
  assert.equal(r!.amount, 750);
  assert.equal(r!.type, "debit");
  assert.equal(r!.accountLastDigits, "3456");
});

test("Axis format", () => {
  const r = parseSmsByRegex(
    "INR 1000.00 has been debited from your A/c XX9012 on 24-MAY-26 for AMAZON. Avl Bal: INR 8,000.00",
    "AXISBK"
  );
  assert(r !== null);
  assert.equal(r!.amount, 1000);
  assert.equal(r!.type, "debit");
  assert.equal(r!.accountLastDigits, "9012");
});

test("credit card spend format", () => {
  const r = parseSmsByRegex(
    "Your HDFC Bank Credit Card XX1234 has been used for Rs 500.00 at MERCHANT NAME on 04-Jun-26.",
    "HDFCBK"
  );
  assert(r !== null);
  assert.equal(r!.amount, 500);
  assert.equal(r!.type, "debit");
  assert.equal(r!.accountLastDigits, "1234");
});

test("salary credit", () => {
  const r = parseSmsByRegex(
    "Rs.50,000.00 credited to A/c XX5678 on 04-Jun-26 from SALARY PAYMENT. Available Balance: Rs.65,000.00",
    "ICICIBK"
  );
  assert(r !== null);
  assert.equal(r!.amount, 50000);
  assert.equal(r!.type, "credit");
});

test("EMI debit", () => {
  const r = parseSmsByRegex(
    "Rs.5000 debited from A/c XX1234 on 04-Jun-26. Info: EMI for HOME LOAN",
    "HDFCBK"
  );
  assert(r !== null);
  assert.equal(r!.amount, 5000);
  assert.equal(r!.type, "debit");
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 1.2: Run the tests — confirm they all FAIL (module not found)**

```bash
cd /home/kgd122/personal/FinanceTracker
npx tsx server/__tests__/smsParser.test.ts
```

Expected output: `Error: Cannot find module '../smsParser'`

---

## Task 2: Implement `server/smsParser.ts`

**Files:**
- Create: `server/smsParser.ts`

- [ ] **Step 2.1: Create the parser module**

Create `server/smsParser.ts` with this content:

```typescript
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
```

- [ ] **Step 2.2: Run the tests — all should pass**

```bash
npx tsx server/__tests__/smsParser.test.ts
```

Expected output:
```
=== SMS Parser Tests ===

Amount extraction:
  ✅ Rs. format with paise
  ✅ INR format
  ✅ Rs with comma thousands
  ✅ Lakh format
...
=== Results: 23 passed, 0 failed ===
```

If any test fails, fix the regex in `server/smsParser.ts` and re-run until all pass.

- [ ] **Step 2.3: Commit**

```bash
git add server/smsParser.ts server/__tests__/smsParser.test.ts
git commit -m "feat: add comprehensive Indian bank SMS regex parser with tests"
```

---

## Task 3: Wire the new parser into `parseSmsMessage()`

**Files:**
- Modify: `server/openai.ts` (lines 116–167)

- [ ] **Step 3.1: Replace `parseSmsMessage()` in `server/openai.ts`**

Open `server/openai.ts`. Find the block from line 116 to line 167:

```typescript
export async function parseSmsMessage(message: string, sender?: string): Promise<ParsedSmsData | null> {
  if (!openai) {
    return fallbackParseSms(message, sender);   // ← BUG: function doesn't exist
  }
  
  try {
    const response = await openai.chat.completions.create({ ... });
    ...
  } catch (error) {
    console.error("SMS parsing error:", error);
    return fallbackSmsParser(message);
  }
}
```

Replace **the entire `parseSmsMessage` function** (lines 116–167) with:

```typescript
export async function parseSmsMessage(message: string, sender?: string): Promise<ParsedSmsData | null> {
  return parseSmsByRegex(message, sender);
}
```

Also add this import at the **top of `server/openai.ts`** (line 1, after the existing `import OpenAI`):

```typescript
import { parseSmsByRegex } from "./smsParser";
```

The `ParsedSmsData` interface in `openai.ts` (lines 106–114) must now match the one in `smsParser.ts`. Since both define the same shape, **delete the `ParsedSmsData` interface from `openai.ts`** and update the import line to also import the type:

```typescript
import { parseSmsByRegex, type ParsedSmsData } from "./smsParser";
```

The `fallbackSmsParser` function (lines 169–251) can be left in place — it is referenced nowhere else, TypeScript will warn it's unused. Delete it to keep the file clean.

- [ ] **Step 3.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see `ParsedSmsData` re-export errors, ensure `openai.ts` no longer defines the interface and imports it from `smsParser.ts` instead.

- [ ] **Step 3.3: Commit**

```bash
git add server/openai.ts
git commit -m "fix: replace OpenAI SMS parser with regex-only implementation"
```

---

## Task 4: Smart account matching in `routes.ts`

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 4.1: Add `matchAccountBySender()` helper**

Open `server/routes.ts`. Find the line that imports from `./openai` (around line 26):

```typescript
import { suggestCategory, parseSmsMessage, fallbackCategorization, parseStatementPDF, ExtractedTransaction } from "./openai";
```

Add `ParsedSmsData` to the import (it is now exported from `smsParser.ts` via `openai.ts`):

```typescript
import { suggestCategory, parseSmsMessage, fallbackCategorization, parseStatementPDF, type ParsedSmsData, ExtractedTransaction } from "./openai";
```

Then add this helper function **directly above the `/api/parse-sms` route** (around line 3083). It needs access to the `Account` type — that is already imported via `storage`:

```typescript
// Maps common Indian bank SMS sender names to a keyword used to match account names
const SENDER_BANK_MAP: Record<string, string> = {
  hdfcbk: "hdfc",
  hdfc: "hdfc",
  icicibk: "icici",
  icici: "icici",
  sbiinb: "sbi",
  sbi: "sbi",
  axisbk: "axis",
  axis: "axis",
  kotak: "kotak",
  idfcfirst: "idfc",
  idfc: "idfc",
  indusind: "indusind",
  yesbank: "yes",
  federal: "federal",
  canara: "canara",
  pnb: "pnb",
};

function matchAccountBySender(
  accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>,
  sender: string,
  accountLastDigits?: string
): (typeof accounts)[0] | undefined {
  const senderLower = sender.toLowerCase().replace(/[^a-z0-9]/g, "");

  let bankKeyword: string | undefined;
  for (const [key, keyword] of Object.entries(SENDER_BANK_MAP)) {
    if (senderLower.includes(key)) {
      bankKeyword = keyword;
      break;
    }
  }

  if (!bankKeyword) return undefined;

  const candidates = accounts.filter(acc => {
    const name = (acc.name ?? "").toLowerCase();
    const bankName = (acc.bankName ?? "").toLowerCase();
    return name.includes(bankKeyword!) || bankName.includes(bankKeyword!);
  });

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Multiple accounts for same bank — use last 4 digits to pick
  if (accountLastDigits) {
    const exact = candidates.find(acc =>
      (acc.accountNumber ?? "").endsWith(accountLastDigits)
    );
    if (exact) return exact;
  }

  return candidates[0];
}
```

- [ ] **Step 4.2: Update the `/api/parse-sms` endpoint**

Find this block inside `app.post("/api/parse-sms", ...)` (around line 3123):

```typescript
        // Get default account or first active account
        const accounts = await storage.getAllAccounts();
        const defaultAccount = accounts.find(acc => acc.isDefault) || accounts.find(acc => acc.isActive) || accounts[0];
```

Replace it with:

```typescript
        // Match account by SMS sender, fall back to default
        const accounts = await storage.getAllAccounts();
        const matchedAccount = matchAccountBySender(accounts, sender || "", parsedData.accountLastDigits);
        const defaultAccount = matchedAccount
          || accounts.find(acc => acc.isDefault)
          || accounts.find(acc => acc.isActive)
          || accounts[0];
```

- [ ] **Step 4.3: Update the `/api/parse-sms-batch` endpoint**

Find the equivalent account lookup inside `app.post("/api/parse-sms-batch", ...)` (around line 3210). It will look the same:

```typescript
        const accounts = await storage.getAllAccounts();
        const defaultAccount = accounts.find(acc => acc.isDefault) || accounts.find(acc => acc.isActive) || accounts[0];
```

Replace it with the same pattern — but fetch accounts **once before the loop** (outside the `messages.map`) for efficiency:

```typescript
      // Fetch accounts once for the whole batch
      const accounts = await storage.getAllAccounts();
```

Then inside the per-message block replace the account lookup with:

```typescript
        const matchedAccount = matchAccountBySender(accounts, sender || "", parsedData?.accountLastDigits);
        const defaultAccount = matchedAccount
          || accounts.find(acc => acc.isDefault)
          || accounts.find(acc => acc.isActive)
          || accounts[0];
```

- [ ] **Step 4.4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: smart account matching by SMS sender in parse-sms endpoint"
```

---

## Task 5: End-to-end test against live server

**Files:** none changed — this is verification only

- [ ] **Step 5.1: Start the server locally**

```bash
cd /home/kgd122/personal/FinanceTracker
npm run dev
```

Leave this running. Open a second terminal.

- [ ] **Step 5.2: Run the existing test script**

```bash
cd /home/kgd122/personal/FinanceTracker
./test-sms-parser.sh
```

Expected results:
- Test 1 (HDFC debit): `"success": true` with `amount: 500`, `type: "debit"`, `merchant` containing `STARBUCKS`
- Test 2 (ICICI credit): `"success": true` with `amount: 5000`, `type: "credit"`
- Test 3 (Axis UPI): `"success": true` with `amount: 250.5`, `type: "debit"`
- Test 4 (OTP SMS): `"success": false` — not a transaction ✅
- Test 5 (no API key): HTTP 401 or passes through (TASKER_API_KEY not set = open) ✅
- Test 6 (batch): array of 3 results, all `success: true`

If any test 1–3 returns `"success": false`, check the `parsed` field in the response to see what `parseSmsByRegex` returned. Add a regex pattern to `smsParser.ts` to cover the format, re-run tests.

- [ ] **Step 5.3: Deploy to Render**

```bash
git push
```

Render auto-deploys on push. Watch the Render dashboard logs for:
```
[express] Server running on port 5000
```

- [ ] **Step 5.4: Test from MacroDroid**

Open MacroDroid → find the **Finance SMS Test** macro → tap **▶ Run**.

Check Render live logs — you should see:
```
POST /api/parse-sms 200 in ~Xms
```

Open FinanceTracker in your browser → Transactions — the SWIGGY ₹500 transaction should appear under the HDFC account.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| Remove OpenAI from `parseSmsMessage()` | Task 3 |
| Fix `fallbackParseSms` undefined bug | Task 3 (replaced entire function) |
| Comprehensive regex for HDFC, ICICI, SBI, Axis, Kotak | Task 2 |
| Credit card SMS patterns | Task 1 test + Task 2 |
| EMI/insurance SMS patterns | Task 1 test + Task 2 |
| Non-transaction SMS returns null | Task 1 test + Task 2 |
| Smart account matching by sender | Task 4 |
| accountLastDigits used for disambiguation | Task 4 |
| Fall back to default account if no match | Task 4 |
| Apply to batch endpoint too | Task 4 Step 4.3 |
| MacroDroid Content-Type fix | Not a code task — user sets in app |
| UpTimeRobot 5-min interval | Not a code task — user sets in dashboard |

**Placeholder scan:** No TBDs, no "implement later", all steps have real code. ✅

**Type consistency:**
- `ParsedSmsData` defined once in `smsParser.ts`, imported everywhere else ✅
- `matchAccountBySender` uses `Awaited<ReturnType<typeof storage.getAllAccounts>>` which matches the `accounts` variable already used in that route ✅
- `parseSmsByRegex` signature `(message: string, sender?: string): ParsedSmsData | null` matches `parseSmsMessage` signature ✅
