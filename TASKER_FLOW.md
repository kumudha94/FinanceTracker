# Tasker SMS Automation Flow

## Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  📱 BANK                                                               │
│  Sends transaction SMS                                                │
│                                                                         │
│  Example: "Rs.500 debited from A/c XX1234 at Starbucks"              │
│                                                                         │
└────────────────────────────┬───────────────────────────────────────────┘
                             │
                             │ SMS Received
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  📱 ANDROID DEVICE                                                     │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  TASKER PROFILE: "Finance Tracker SMS"                       │     │
│  │                                                               │     │
│  │  Trigger: Received Text (SMS)                                │     │
│  │  • Type: SMS                                                  │     │
│  │  • Sender: Any (or filtered bank numbers)                    │     │
│  │  • Content: Any                                               │     │
│  └─────────────────────────┬───────────────────────────────────┘     │
│                             │                                           │
│                             │ Profile Triggered                         │
│                             ▼                                           │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  TASK: "Finance Tracker SMS"                                 │     │
│  │                                                               │     │
│  │  [Action 1] JavaScriptlet - Extract Data                     │     │
│  │  • Get sender: global('SMSRF')                               │     │
│  │  • Get message: global('SMSRB')                              │     │
│  │  • Get timestamp: new Date()                                 │     │
│  │  • Store in global variables                                 │     │
│  │                                                               │     │
│  │  [Action 2] HTTP Request - Send to API                       │     │
│  │  • Method: POST                                               │     │
│  │  • URL: http://YOUR_IP:5000/api/parse-sms                    │     │
│  │  • Headers: X-API-Key, Content-Type                          │     │
│  │  • Body: JSON with sender, message, timestamp                │     │
│  │                                                               │     │
│  │  [Action 3] Notify - Success (Optional)                      │     │
│  │  • Show notification: "Transaction logged"                   │     │
│  └─────────────────────────┬───────────────────────────────────┘     │
│                             │                                           │
└─────────────────────────────┼───────────────────────────────────────────┘
                             │
                             │ HTTP POST
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  💻 FINANCE TRACKER SERVER                                             │
│                                                                         │
│  [Middleware] validateApiKey                                          │
│  • Check X-API-Key header                                              │
│  • Compare with TASKER_API_KEY from .env                              │
│  • Reject if invalid (401/403)                                         │
│                             │                                           │
│                             │ Authenticated ✓                          │
│                             ▼                                           │
│  [Endpoint] POST /api/parse-sms                                       │
│  • Receive: sender, message, receivedAt                               │
│  • Create SMS log entry (for audit trail)                             │
│                             │                                           │
│                             │                                           │
│                             ▼                                           │
│  [OpenAI Parser] parseSmsMessage()                                    │
│  • Use GPT-4o-mini to extract:                                         │
│    - amount: 500                                                       │
│    - type: "debit"                                                     │
│    - merchant: "Starbucks"                                             │
│    - referenceNumber: "UPI/12345678"                                   │
│    - accountLastDigits: "1234"                                         │
│  • Fallback to regex parser if OpenAI unavailable                     │
│                             │                                           │
│                             │ Parsed ✓                                 │
│                             ▼                                           │
│  [OpenAI Categorizer] suggestCategory()                               │
│  • Input: merchant/description ("Starbucks")                          │
│  • OpenAI suggests category: "Dining"                                  │
│  • Fallback to keyword matching if unavailable                        │
│                             │                                           │
│                             │ Categorized ✓                            │
│                             ▼                                           │
│  [Storage Layer] createTransaction()                                  │
│  • Build transaction object:                                           │
│    - amount: "500.00"                                                  │
│    - type: "debit"                                                     │
│    - merchant: "Starbucks"                                             │
│    - categoryId: 3 (Dining)                                            │
│    - accountId: 5 (default account)                                    │
│    - smsId: 45 (link to SMS log)                                      │
│  • Save to PostgreSQL database                                         │
│  • Update account balance (-500.00)                                    │
│  • Link SMS log to transaction                                         │
│                             │                                           │
│                             │ Saved ✓                                  │
│                             ▼                                           │
│  [Response] JSON                                                       │
│  {                                                                      │
│    "success": true,                                                    │
│    "transaction": { id: 123, amount: "500.00", ... },                 │
│    "parsed": { amount: 500, type: "debit", ... }                      │
│  }                                                                      │
│                                                                         │
└────────────────────────────┬───────────────────────────────────────────┘
                             │
                             │ Response Received
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  📱 ANDROID DEVICE                                                     │
│  Shows notification: "Transaction logged from SMS"                    │
│                                                                         │
└────────────────────────────┬───────────────────────────────────────────┘
                             │
                             │ User opens app
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  📱 FINANCE TRACKER APP                                                │
│                                                                         │
│  Dashboard shows:                                                      │
│  • New transaction: ₹500 at Starbucks                                 │
│  • Updated account balance: ₹14,500                                   │
│  • Category: Dining                                                    │
│  • Date: Today, 10:30 AM                                               │
│                                                                         │
│  ✅ Transaction automatically created! No manual entry needed!         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Input (Tasker → Server)
```json
{
  "sender": "HDFC-BANK",
  "message": "Rs.500.00 debited from A/c XX1234 on 24-May-26 at STARBUCKS CAFE DELHI. Avl Bal: Rs.15,000.00. Ref No: UPI/12345678",
  "receivedAt": "2026-05-24T10:30:00Z"
}
```

### Parsed Data (OpenAI Output)
```json
{
  "amount": 500,
  "type": "debit",
  "merchant": "Starbucks Cafe Delhi",
  "description": "Payment at Starbucks",
  "referenceNumber": "UPI/12345678",
  "date": "2026-05-24T10:30:00Z",
  "accountLastDigits": "1234"
}
```

### Created Transaction (Database)
```json
{
  "id": 123,
  "amount": "500.00",
  "type": "debit",
  "merchant": "Starbucks Cafe Delhi",
  "description": "Payment at Starbucks",
  "referenceNumber": "UPI/12345678",
  "transactionDate": "2026-05-24T10:30:00Z",
  "accountId": 5,
  "categoryId": 3,
  "smsId": 45,
  "userId": 1,
  "createdAt": "2026-05-24T10:31:00Z"
}
```

### Response (Server → Tasker)
```json
{
  "success": true,
  "transaction": { /* full transaction object */ },
  "parsed": { /* parsed data */ }
}
```

## Security Layer

```
Request Headers:
┌─────────────────────────────┐
│ Content-Type: application/  │
│              json            │
│                              │
│ X-API-Key: abc123xyz789     │◄─── VALIDATED
└─────────────────────────────┘

         │
         ▼
┌─────────────────────────────┐
│ validateApiKey middleware   │
│                              │
│ Check:                       │
│ ✓ Header present?            │
│ ✓ Matches TASKER_API_KEY?   │
│                              │
│ Pass ✓  → Continue           │
│ Fail ✗  → 401/403            │
└─────────────────────────────┘
```

## Error Handling

```
SMS Parsing Failed
       │
       ├─ OpenAI Unavailable → Fallback Regex Parser
       │
       ├─ Regex Failed → Store SMS log, return success: false
       │
       └─ Non-transaction SMS → Store log, no transaction created

Category Suggestion Failed
       │
       ├─ OpenAI Unavailable → Fallback Keyword Matching
       │
       └─ Fallback Failed → Default to "Other" category

API Key Invalid
       │
       └─ Return 403 Forbidden immediately (no processing)

Server Unreachable
       │
       └─ Tasker shows notification: "Connection failed"
              User can manually create transaction later
```

## Time Savings

### Manual Entry (Before Tasker)
```
1. Receive SMS from bank (0 sec)
2. Open Finance Tracker app (5 sec)
3. Navigate to Add Transaction (3 sec)
4. Enter amount manually (10 sec)
5. Select account (3 sec)
6. Select category (5 sec)
7. Enter merchant name (8 sec)
8. Save transaction (2 sec)
────────────────────────────────
Total: 36 seconds per transaction
```

### Automated Entry (With Tasker)
```
1. Receive SMS from bank (0 sec)
2. Tasker intercepts and processes (2 sec)
3. Transaction auto-created (0 sec user time)
4. Notification shown (0 sec)
────────────────────────────────
Total: 0 seconds user time!
```

**💰 With 50 transactions/month:**
- **Manual**: 50 × 36 sec = 30 minutes/month
- **Automated**: 0 minutes/month
- **Saved**: 6 hours/year + improved accuracy!

---

**Last Updated**: May 24, 2026
