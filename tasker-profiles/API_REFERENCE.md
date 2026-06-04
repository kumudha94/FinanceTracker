# SMS Parsing API Reference

## Endpoint: Parse SMS

**URL**: `/api/parse-sms`  
**Method**: `POST`  
**Authentication**: API Key (via `X-API-Key` header)

### Request

**Headers:**
```
Content-Type: application/json
X-API-Key: your_tasker_api_key
```

**Body:**
```json
{
  "sender": "HDFC-BANK",           // Optional: SMS sender ID
  "message": "Rs.500 debited...",  // Required: SMS message text
  "receivedAt": "2026-05-24T..."   // Optional: ISO 8601 timestamp
}
```

### Response

**Success (200):**
```json
{
  "success": true,
  "transaction": {
    "id": 123,
    "amount": "500.00",
    "type": "debit",
    "merchant": "Starbucks",
    "description": "Payment at Starbucks Cafe",
    "referenceNumber": "UPI/12345678",
    "transactionDate": "2026-05-24T10:30:00Z",
    "accountId": 5,
    "categoryId": 3,
    "smsId": 45
  },
  "parsed": {
    "amount": 500,
    "type": "debit",
    "merchant": "Starbucks",
    "description": "Payment at Starbucks Cafe",
    "referenceNumber": "UPI/12345678",
    "accountLastDigits": "1234"
  }
}
```

**Could Not Parse (200):**
```json
{
  "success": false,
  "message": "Could not parse transaction from SMS",
  "smsLogId": 45
}
```

**Error (401/403/500):**
```json
{
  "error": "API key required"
}
```

---

## Endpoint: Batch Parse SMS

**URL**: `/api/parse-sms-batch`  
**Method**: `POST`  
**Authentication**: API Key (via `X-API-Key` header)

### Request

**Headers:**
```
Content-Type: application/json
X-API-Key: your_tasker_api_key
```

**Body:**
```json
{
  "messages": [
    {
      "sender": "HDFC",
      "message": "Rs.100 debited from A/c XX1234..."
    },
    {
      "sender": "ICICI",
      "message": "Rs.200 credited to A/c XX5678..."
    },
    "Simple string messages also work"
  ]
}
```

### Response

**Success (200):**
```json
{
  "total": 3,
  "successful": 2,
  "failed": 1,
  "results": [
    {
      "success": true,
      "transaction": { ... },
      "message": "Rs.100 debited from A/c XX1234..."
    },
    {
      "success": true,
      "transaction": { ... },
      "message": "Rs.200 credited to A/c XX5678..."
    },
    {
      "success": false,
      "message": "Simple string messages also work",
      "error": "Could not parse transaction data"
    }
  ]
}
```

---

## Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 401 | API key missing | Add `X-API-Key` header |
| 403 | Invalid API key | Check `TASKER_API_KEY` in `.env` |
| 400 | Bad request | Check request body format |
| 500 | Server error | Check server logs |

---

## Notes

- **SMS Log**: All received SMS are logged regardless of parsing success
- **Default Account**: Uses first active or default-marked account
- **Category**: Auto-suggested by OpenAI or fallback rules
- **Idempotency**: Safe to retry - SMS log prevents duplicates
- **Transaction Date**: Uses parsed date from SMS or current timestamp

---

## Example cURL Commands

**Single SMS:**
```bash
curl -X POST http://localhost:5000/api/parse-sms \
  -H "Content-Type: application/json" \
  -H "X-API-Key: abc123xyz789" \
  -d '{
    "sender": "HDFC",
    "message": "Rs.500 debited from A/c XX1234 at Starbucks",
    "receivedAt": "2026-05-24T10:30:00Z"
  }'
```

**Batch SMS:**
```bash
curl -X POST http://localhost:5000/api/parse-sms-batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: abc123xyz789" \
  -d '{
    "messages": [
      {"sender": "HDFC", "message": "Rs.100 debited..."},
      {"sender": "ICICI", "message": "Rs.200 credited..."}
    ]
  }'
```

---

**See Also:**
- [Tasker Integration Guide](../TASKER_INTEGRATION.md) - Full setup instructions
- [OpenAI SMS Parser](../server/openai.ts) - Parsing logic
- [API Routes](../server/routes.ts) - Endpoint implementation
