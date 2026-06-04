#!/bin/bash

# Test SMS Parsing Endpoint
# Usage: ./test-sms-parser.sh

# Configuration
API_URL="${API_URL:-http://localhost:5000}"
API_KEY="${TASKER_API_KEY:-test_key_12345}"

echo "🧪 Testing SMS Parsing API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "API URL: $API_URL"
echo "API Key: ${API_KEY:0:10}..."
echo ""

# Test 1: Debit Transaction
echo "📤 Test 1: HDFC Debit Transaction"
curl -X POST "$API_URL/api/parse-sms" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "sender": "HDFC-BANK",
    "message": "Rs.500.00 debited from A/c XX1234 on 24-May-26 at STARBUCKS CAFE DELHI. Avl Bal: Rs.15,000.00. Ref No: UPI/12345678",
    "receivedAt": "2026-05-24T10:30:00Z"
  }' \
  | jq '.'
echo ""
echo ""

# Test 2: Credit Transaction
echo "📥 Test 2: ICICI Credit Transaction"
curl -X POST "$API_URL/api/parse-sms" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "sender": "ICICI",
    "message": "Rs 5000.00 credited to A/c XX5678 on 24-05-26 from SALARY PAYMENT. Available Balance: Rs 25,500.75",
    "receivedAt": "2026-05-24T09:00:00Z"
  }' \
  | jq '.'
echo ""
echo ""

# Test 3: UPI Payment
echo "💸 Test 3: Axis UPI Payment"
curl -X POST "$API_URL/api/parse-sms" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "sender": "AXISBK",
    "message": "Dear Customer, INR 250.50 has been debited from your A/c XX9012 on 24-MAY-26 for ZOMATO ONLINE ORDER. Avl Bal: INR 12,750.25",
    "receivedAt": "2026-05-24T13:45:00Z"
  }' \
  | jq '.'
echo ""
echo ""

# Test 4: Non-transaction SMS (should fail gracefully)
echo "❌ Test 4: Non-transaction SMS"
curl -X POST "$API_URL/api/parse-sms" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "sender": "HDFC",
    "message": "Your OTP for login is 123456. Do not share with anyone.",
    "receivedAt": "2026-05-24T14:00:00Z"
  }' \
  | jq '.'
echo ""
echo ""

# Test 5: Missing API Key (should fail)
echo "🔒 Test 5: Missing API Key (should fail with 401)"
curl -X POST "$API_URL/api/parse-sms" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "HDFC",
    "message": "Rs.100 debited",
    "receivedAt": "2026-05-24T15:00:00Z"
  }' \
  | jq '.'
echo ""
echo ""

# Test 6: Batch Processing
echo "📦 Test 6: Batch SMS Processing"
curl -X POST "$API_URL/api/parse-sms-batch" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "messages": [
      {
        "sender": "HDFC",
        "message": "Rs.100 debited from A/c XX1234 at Amazon. Ref: UPI/111"
      },
      {
        "sender": "ICICI",
        "message": "Rs.200 credited to A/c XX5678 from Refund. Ref: TXN/222"
      },
      {
        "sender": "SBI",
        "message": "Rs.300 debited from A/c XX9012 at UBER. Ref: UPI/333"
      }
    ]
  }' \
  | jq '.'
echo ""
echo ""

echo "✅ All tests completed!"
echo ""
echo "💡 Tips:"
echo "   - Check server logs for detailed parsing information"
echo "   - Verify transactions in Finance Tracker app"
echo "   - SMS logs are saved even if parsing fails"
echo "   - Use your actual TASKER_API_KEY from .env file"
