# SMS Auto-Transaction Design
**Date:** 2026-06-04  
**Status:** Approved

## Problem

FinanceTracker has a working `/api/parse-sms` endpoint and a pre-built Tasker profile, but the feature fails in production because:

1. `parseSmsMessage()` calls OpenAI first — the API key's quota is exhausted (HTTP 429), causing a 500 error before the regex fallback can run.
2. The regex fallback (`fallbackSmsParser`) is weak — it misses many real Indian bank SMS formats.
3. There is a bug on line 118 of `server/openai.ts`: when `OPENAI_API_KEY` is unset, it calls `fallbackParseSms()` which does not exist, causing a runtime crash.
4. The `/api/parse-sms` endpoint always assigns transactions to the **default account**, ignoring which bank actually sent the SMS. Credit card limit and per-account balance tracking break as a result.
5. MacroDroid's HTTP timeout was 5 seconds — too short for Render free-tier cold starts.

## Solution Overview

**Option A chosen: Pure regex SMS parsing — remove OpenAI from the SMS parsing path entirely.**

Indian bank SMS formats are standardised and predictable. A comprehensive regex parser covers 95%+ of real transactions with zero API cost, zero latency, zero quota risk.

MacroDroid (already installed and configured by user) handles the phone-side SMS interception. No custom app installation required on the Samsung Galaxy S24 Ultra.

---

## Architecture

```
Bank SMS
  ↓
MacroDroid (Android)
  - Trigger: SMS received containing "debited" OR "credited"
  - Action: HTTP POST to Render server
  - Timeout: 30 seconds
  ↓
POST /api/parse-sms  (Render — financetracker-ckvf.onrender.com)
  - validateApiKey middleware (passthrough if TASKER_API_KEY unset)
  ↓
parseSmsMessage()  ← REGEX ONLY, no OpenAI
  - Extract: amount, type (debit/credit), merchant, accountLastDigits,
             referenceNumber, date
  ↓
Smart account matching
  - Match SMS sender name against account name/bankName in DB
  - Confirm with accountLastDigits if available
  - Fall back to default account if no match
  ↓
suggestCategory()  ← keyword fallback only (OpenAI already skipped on 429)
  ↓
storage.createTransaction()
  - Updates account.balance automatically
  - Credit card: newCharges/statementBalance recalculated from transactions
  ↓
SMS log entry saved (for audit)
```

---

## Section 1: SMS Parser Overhaul (`server/openai.ts`)

### What changes

`parseSmsMessage()` is rewritten to be **regex-first, OpenAI-never**:
- Remove the OpenAI call from this function entirely
- Fix the `fallbackParseSms` bug (undefined reference on line 118) — replace with the internal `fallbackSmsParser`
- Expand `fallbackSmsParser` into a comprehensive parser renamed `parseSmsByRegex`

`suggestCategory()` is **unchanged** — it already has proper try/catch that falls back to keyword matching when OpenAI fails.

### Regex patterns to cover

**Transaction type detection (debit):**
`debited`, `deducted`, `withdrawn`, `spent`, `used for`, `paid`, `purchase`, `charged`, `sent`

**Transaction type detection (credit):**
`credited`, `received`, `deposited`, `refunded`, `added`, `reversed`

**Amount extraction (handles all Indian formats):**
- `Rs.500.00` / `Rs 500.00` / `Rs500`
- `INR 500.00` / `INR500`
- `₹500.00` / `₹ 500`
- Comma-separated: `Rs.1,500.00` / `Rs.1,50,000.00`

**Merchant extraction:**
- `at MERCHANT NAME` (POS transactions)
- `to MERCHANT` / `towards MERCHANT`
- `for MERCHANT` (Axis pattern)
- `Info: MERCHANT`
- UPI VPA: `to VPA xxx@bank`

**Account last digits:**
- `A/c XX1234` / `A/c **1234` / `A/C XXXXXXXX1234`
- `account ending 1234` / `card ending 1234`
- `xx1234` / `XX1234`

**Reference number:**
- `Ref No: UPI/12345678`
- `Ref: 12345678` / `UTR: 12345678`
- `UPI Ref: 12345678` / `Txn ID: 12345678`

**Bank-specific patterns tested:**

| Bank | Example SMS |
|------|-------------|
| HDFC | `Rs.500.00 debited from A/c XX1234 on 24-May-26 at SWIGGY. Avl Bal: Rs.15,000.00. Ref No: UPI/12345678` |
| ICICI | `Rs 250.50 debited from A/c XX5678 on 24-05-26 to UPI-ZOMATO. Available Balance: Rs 12,500.75` |
| SBI | `Your A/c XX3456 debited with Rs.750.00 on 24May26 Ref UPI/98765432. Avl Bal Rs.20,000.00` |
| Axis | `INR 1000.00 has been debited from your A/c XX9012 on 24-MAY-26 for Amazon. Avl Bal: INR 8,000.00` |
| Kotak | `Rs 500.00 has been debited from Kotak Savings A/C XXXXXXXX1234 on 24/05/26` |
| Credit card | `Your HDFC Bank Credit Card XX1234 has been used for Rs 500.00 at MERCHANT on 24-May-26` |
| EMI | `Rs.5000 debited from A/c XX1234. Info: EMI for LoanXXX` |
| Insurance | `Rs.1200 debited from A/c XX1234. Info: ICICI PRUDENTIAL INSURANCE PREMIUM` |

**Non-transaction rejection:**
If the SMS contains none of the debit/credit keywords AND no currency marker (Rs/INR/₹), return `null` — OTPs and promotional SMS are ignored.

---

## Section 2: Smart Account Matching (`server/routes.ts`)

### What changes

The `/api/parse-sms` endpoint currently does:
```typescript
const defaultAccount = accounts.find(acc => acc.isDefault) || accounts[0];
```

Replace with a `matchAccountBySender()` helper that:
1. Normalises the SMS sender: `HDFCBK` → `HDFC`, `ICICIBK` → `ICICI`, `SBIINB` → `SBI`, `AXISBK` → `AXIS`
2. Searches `accounts` for one whose `name` or `bankName` contains that keyword (case-insensitive)
3. If `accountLastDigits` was extracted from the SMS, further confirms the match (last 4 digits of account number match)
4. Falls back to default account if no match

Same logic applied to the `/api/parse-sms-batch` endpoint.

### Why this matters

- SMS from ICICI credit card → transaction linked to ICICI credit card account → `newCharges` updates → available limit shown correctly in dashboard
- SMS from HDFC savings → HDFC account balance updates
- EMI/insurance SMS → matched to the correct bank account

---

## Section 3: MacroDroid Configuration (phone-side — already done by user)

| Setting | Value | Status |
|---------|-------|--------|
| Trigger | SMS containing "debited" OR "credited" | ✅ configured |
| HTTP method | POST | ✅ |
| URL | `https://financetracker-ckvf.onrender.com/api/parse-sms` | ✅ |
| Content-Type | `application/json` | needs fix |
| Body | `{"sender":"[sms_sender]","message":"[sms_message]","receivedAt":"[date_time]"}` | ✅ |
| Timeout | 30000 ms | ✅ |
| Notification action | Display Notification (not Notification Reply) | needs fix |

**Test macro:** separate macro with no trigger, hardcoded JSON body with fake HDFC debit SMS, run manually via ▶ button.

---

## Section 4: Render Keep-Alive

UpTimeRobot must ping every **5 minutes** (not 15). Render free tier sleeps after 15 minutes of inactivity. A 5-minute ping interval guarantees the server stays awake between bank SMS arrivals.

No code change required — this is a UpTimeRobot dashboard setting.

---

## Files Changed

| File | Change |
|------|--------|
| `server/openai.ts` | Rewrite `parseSmsMessage()` — remove OpenAI, fix undefined bug, expand regex patterns |
| `server/routes.ts` | Replace default-account lookup with `matchAccountBySender()` in `/api/parse-sms` and `/api/parse-sms-batch` |

No schema changes. No new dependencies. No migration needed.

---

## Success Criteria

- A real bank debit SMS received on the S24 Ultra → MacroDroid fires → transaction appears in FinanceTracker within 5 seconds (server awake) or 35 seconds (cold start)
- Transaction is linked to the correct account (not always the default)
- Credit card account: `newCharges` and available limit update correctly
- Non-bank SMS (OTPs, promos) do not create transactions
- No OpenAI calls made during SMS parsing — zero quota risk
