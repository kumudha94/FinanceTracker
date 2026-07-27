import assert from "node:assert/strict";
import { parseSmsByRegex, parseDueSms } from "../smsParser";

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
  assert(r !== null, "Parser returned null for this SMS");
  assert.equal(r!.type, "debit");
});

test("credit detection", () => {
  const r = parseSmsByRegex("Rs.5000 credited to A/c XX5678 from SALARY", "ICICIBK");
  assert(r !== null, "Parser returned null for this SMS");
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
  assert(r !== null, "Parser returned null for this SMS");
  assert.equal(r!.accountLastDigits, "1234");
});

test("A/C uppercase asterisk format", () => {
  const r = parseSmsByRegex("Rs 500 debited from Kotak Savings A/C XXXXXXXX5678", "KOTAK");
  assert(r !== null, "Parser returned null for this SMS");
  assert.equal(r!.accountLastDigits, "5678");
});

test("card ending format", () => {
  const r = parseSmsByRegex("Rs.500 spent on card ending 9012 at AMAZON", "HDFCBK");
  assert(r !== null, "Parser returned null for this SMS");
  assert.equal(r!.accountLastDigits, "9012");
});

// ── Merchant extraction ────────────────────────────────────────────────────
console.log("\nMerchant extraction:");

test("'at MERCHANT' pattern", () => {
  const r = parseSmsByRegex(
    "Rs.500.00 debited from A/c XX1234 on 04-Jun-26 at SWIGGY. Avl Bal: Rs.15,000.00",
    "HDFCBK"
  );
  assert(r !== null, "Parser returned null for this SMS");
  assert(r!.merchant?.toUpperCase().includes("SWIGGY"), `Expected SWIGGY, got: ${r!.merchant}`);
});

test("'to UPI-MERCHANT' pattern", () => {
  const r = parseSmsByRegex(
    "Rs 250.50 debited from A/c XX5678 on 24-05-26 to UPI-ZOMATO PAYMENTS. Available Balance: Rs 12,500.75",
    "ICICIBK"
  );
  assert(r !== null, "Parser returned null for this SMS");
  assert(r!.merchant?.toUpperCase().includes("ZOMATO"), `Expected ZOMATO, got: ${r!.merchant}`);
});

test("'for MERCHANT' pattern (Axis)", () => {
  const r = parseSmsByRegex(
    "INR 1000.00 has been debited from your A/c XX9012 on 24-MAY-26 for AMAZON PURCHASE. Avl Bal: INR 8,000.00",
    "AXISBK"
  );
  assert(r !== null, "Parser returned null for this SMS");
  assert(r!.merchant?.toUpperCase().includes("AMAZON"), `Expected AMAZON, got: ${r!.merchant}`);
});

// ── Reference number ───────────────────────────────────────────────────────
console.log("\nReference number:");

test("UPI ref format", () => {
  const r = parseSmsByRegex(
    "Rs.500.00 debited from A/c XX1234. Ref No: UPI/12345678",
    "HDFCBK"
  );
  assert(r !== null, "Parser returned null for this SMS");
  assert(r!.referenceNumber?.includes("12345678"), `Got: ${r!.referenceNumber}`);
});

test("UTR format", () => {
  const r = parseSmsByRegex(
    "Rs.500 debited from A/c XX1234. UTR: 987654321012",
    "SBIINB"
  );
  assert(r !== null, "Parser returned null for this SMS");
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

// ── Due SMS parsing ─────────────────────────────────────────────────────────

test("credit card due with promo text and card last-4", () => {
  const r = parseDueSms(
    "Dear Customer, Your YES BANK Credit Card x2613 has dues of Rs. 9,629.90.\nConvert it into EMIs with no hidden charges.\nConfirm: ccybl.in/YESBNK/MAt7Sk1jgU -YES BANK LTD"
  );
  assert(r !== null);
  assert.equal(r!.amount, 9629.90);
  assert.equal(r!.cardLastFourDigits, "2613");
});

test("minimum due phrasing", () => {
  const r = parseDueSms("Your minimum due of Rs.1,500 on card ending 4321 is payable by 15-Aug-26.");
  assert(r !== null);
  assert.equal(r!.amount, 1500);
  assert.equal(r!.cardLastFourDigits, "4321");
  assert.equal(r!.dueDate, "2026-08-15T00:00:00.000Z");
});

test("total outstanding with no card digits (routes to Bills Inbox)", () => {
  const r = parseDueSms("Your Jio postpaid bill of Rs.499 total outstanding is due on 05-Aug-26. Pay now to avoid service interruption.");
  assert(r !== null);
  assert.equal(r!.amount, 499);
  assert.equal(r!.cardLastFourDigits, undefined);
});

test("due SMS must not be misclassified as a transaction", () => {
  const r = parseSmsByRegex(
    "Dear Customer, Your YES BANK Credit Card x2613 has dues of Rs. 9,629.90.\nConvert it into EMIs with no hidden charges.\nConfirm: ccybl.in/YESBNK/MAt7Sk1jgU -YES BANK LTD"
  );
  assert.equal(r, null);
});

test("non-due, non-transaction SMS is rejected by both parsers", () => {
  const promo = "Get Rs.500 cashback on your next flight booking! Use code FLY500.";
  assert.equal(parseSmsByRegex(promo), null);
  assert.equal(parseDueSms(promo), null);
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
