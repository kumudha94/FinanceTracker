# Tasker Integration Guide

Automate transaction tracking by configuring Tasker to intercept bank SMS notifications and automatically create transactions in your Finance Tracker.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Tasker Configuration](#tasker-configuration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)

## Overview

This integration allows Tasker (Android automation app) to:
1. **Intercept** SMS messages from your bank
2. **Extract** transaction details using AI parsing
3. **Auto-create** transactions in Finance Tracker
4. **Categorize** expenses automatically using OpenAI

**Flow**: Bank SMS → Tasker Profile → HTTP POST → Finance Tracker API → Transaction Created

## Prerequisites

### Required
- **Android device** with Tasker app installed ([Google Play](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm))
- **Finance Tracker server** accessible from your phone (same WiFi or public URL)
- **TASKER_API_KEY** environment variable set on server (for security)

### Optional (but recommended)
- **OpenAI API key** configured for better SMS parsing and categorization
- **Static IP or domain** for your Finance Tracker server

## Server Setup

### 1. Configure Environment Variables

Add to your `.env` file in the project root:

```env
# Existing variables
DATABASE_URL=your_postgres_connection_string
OPENAI_API_KEY=your_openai_api_key  # Optional but recommended
JWT_SECRET=your_jwt_secret

# NEW: Tasker Integration
TASKER_API_KEY=your_secure_random_string_here
```

**Generate a secure API key:**
```bash
# Linux/Mac
openssl rand -hex 32

# Or use any strong random string (32+ characters)
```

### 2. Restart Your Server

```bash
npm run dev
```

### 3. Find Your Server URL

**For local testing (same WiFi):**
```bash
# Find your local IP
ifconfig  # Linux/Mac
ipconfig  # Windows

# Your API URL will be:
http://192.168.X.X:5000
```

**For remote access:**
- Use your server's public IP or domain
- Example: `https://financetracker.yourdomain.com`
- Ensure port 5000 is accessible (configure firewall/router)

## Tasker Configuration

### Method 1: Import Profile (Recommended)

1. Download the pre-configured Tasker profile: [`FinanceTracker-SMS.prf.xml`](./tasker-profiles/FinanceTracker-SMS.prf.xml)
2. Open Tasker app
3. Long-press on the **Profiles** tab header
4. Tap **Import Profile**
5. Select the downloaded file
6. Edit the task:
   - Replace `YOUR_SERVER_URL` with your actual server URL
   - Replace `YOUR_API_KEY_HERE` with your `TASKER_API_KEY`
7. Enable the profile

### Method 2: Manual Configuration

#### Step 1: Create Profile

1. Open **Tasker** app
2. Tap **Profiles** tab (bottom)
3. Tap **+** (add new profile)
4. Select **Event** → **Phone** → **Received Text**
5. Configure:
   - **Type**: `SMS`
   - **Sender**: Leave blank (or specify bank numbers like `HDFC,ICICI,AXIS` for filtering)
   - **Content**: Leave blank
6. Tap **Back** to save

#### Step 2: Create Task

1. Tasker will ask "New Task+"
2. Name it: `Finance Tracker SMS`
3. Tap **✓** to create

#### Step 3: Add Actions

**Action 1: Parse Transaction Data**
1. Tap **+** → **Code** → **JavaScriptlet**
2. Name: `Extract SMS Data`
3. Code:
```javascript
// Get SMS details
var sender = global('SMSRF');
var message = global('SMSRB');
var receivedAt = new Date().toISOString();

// Store in global variables for next action
global('SMS_SENDER', sender);
global('SMS_MESSAGE', message);
global('SMS_TIME', receivedAt);
```
4. Tap **Back** to save

**Action 2: Send to Finance Tracker**
1. Tap **+** → **Net** → **HTTP Request**
2. Configure:
   - **Method**: `POST`
   - **URL**: `http://YOUR_SERVER_URL:5000/api/parse-sms`
   - **Headers**: 
     ```
     Content-Type: application/json
     X-API-Key: YOUR_API_KEY_HERE
     ```
   - **Body**:
     ```json
     {
       "sender": "%SMS_SENDER",
       "message": "%SMS_MESSAGE",
       "receivedAt": "%SMS_TIME"
     }
     ```
   - **Trust Any Certificate**: `ON` (if using self-signed SSL)
3. Tap **Back** to save

**Action 3: Show Notification (Optional)**
1. Tap **+** → **Alert** → **Notify**
2. Configure:
   - **Title**: `Finance Tracker`
   - **Text**: `Transaction logged: %HTTPD`
   - **Icon**: Pick your preference
3. Tap **Back** to save

#### Step 4: Enable Profile

1. Tap **Back** until you're at Profiles screen
2. Ensure the profile is **enabled** (green toggle)

## Testing

### 1. Test with Sample SMS

Create a test task to simulate bank SMS:

1. Go to **Tasks** tab in Tasker
2. Create new task: `Test Finance Tracker`
3. Add action: **Phone** → **Send SMS**
   - **Number**: Your own number
   - **Message**: 
     ```
     Rs.500.00 debited from A/c XX1234 on 24-May-26 at Starbucks Cafe. Avl Bal: Rs.15000.00. Ref: UPI/12345678
     ```
4. Run the task
5. Check Finance Tracker app - transaction should appear!

### 2. Verify API Connection

Use `curl` to test the endpoint directly:

```bash
curl -X POST http://YOUR_SERVER_URL:5000/api/parse-sms \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  -d '{
    "sender": "HDFC",
    "message": "Rs.500 debited from A/c XX1234 at Starbucks. Ref: UPI/123",
    "receivedAt": "2026-05-24T10:30:00Z"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "transaction": {
    "id": 1,
    "amount": "500.00",
    "type": "debit",
    "merchant": "Starbucks",
    ...
  },
  "parsed": {
    "amount": 500,
    "type": "debit",
    "merchant": "Starbucks",
    ...
  }
}
```

## Troubleshooting

### "Connection failed" in Tasker

**Check:**
1. ✅ Server is running (`npm run dev`)
2. ✅ Phone is on same WiFi network (for local testing)
3. ✅ Firewall allows port 5000
4. ✅ URL is correct (use IP, not `localhost`)

**Test connectivity:**
```bash
# From your phone's browser, visit:
http://YOUR_SERVER_URL:5000/api/accounts
```

### "401 API key required" error

**Solution:**
- Add `TASKER_API_KEY` to your `.env` file
- Restart server
- Update `X-API-Key` header in Tasker HTTP Request action

### "Could not parse transaction from SMS"

**Reasons:**
- SMS format doesn't match bank transaction patterns
- OpenAI API key not configured (uses fallback parser)
- SMS is not actually a transaction notification

**Check server logs:**
```bash
# Server will log parsing attempts
npm run dev
# Watch for: "SMS parsing error:" or "Could not parse transaction from SMS"
```

### Transactions created but wrong category

**Solutions:**
1. **Enable OpenAI categorization**: Set `OPENAI_API_KEY` in `.env`
2. **Update fallback rules**: Edit `server/openai.ts` → `fallbackCategorization()`
3. **Manually recategorize** in Finance Tracker app

### Profile not triggering

**Check:**
1. ✅ Profile is **enabled** (green toggle in Tasker)
2. ✅ Tasker has **SMS permissions** (Android settings)
3. ✅ Tasker is **not battery optimized** (Android settings)
4. ✅ Test with **real SMS** (not just notification)

## Advanced Configuration

### Filter Specific Banks Only

In Profile configuration, set **Sender** field:
```
*HDFC*|*ICICI*|*AXIS*|*SBI*
```
This uses regex to match only these bank SMS senders.

### Add Balance Tracking

Modify JavaScriptlet to extract balance:
```javascript
// Extract balance if present
var balanceMatch = message.match(/Avl Bal[:\s]*Rs\.?\s*([\d,]+(?:\.\d{2})?)/i);
if (balanceMatch) {
  global('SMS_BALANCE', balanceMatch[1].replace(/,/g, ''));
}
```

Then update HTTP Body:
```json
{
  "sender": "%SMS_SENDER",
  "message": "%SMS_MESSAGE",
  "receivedAt": "%SMS_TIME",
  "balance": "%SMS_BALANCE"
}
```

### Batch Processing

For processing multiple pending SMS at once:
```bash
curl -X POST http://YOUR_SERVER_URL:5000/api/parse-sms-batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  -d '{
    "messages": [
      {"sender": "HDFC", "message": "Rs.100 debited..."},
      {"sender": "ICICI", "message": "Rs.200 credited..."}
    ]
  }'
```

### Custom Notification Sounds

In Notify action:
- **Sound**: Select custom ringtone
- **Vibration Pattern**: `0,100,50,100` (custom pattern)
- **LED Color**: Choose color

### Conditional Notifications

Add **If** condition before Notify action:
```
If %HTTPD matches *"success":true*
  Then: Show success notification
Else:
  Show error notification
End If
```

## Security Best Practices

1. **Use strong API key** (32+ characters, random)
2. **Never commit** `.env` file to Git
3. **Use HTTPS** in production (self-signed cert okay for local)
4. **Rotate API keys** periodically
5. **Monitor logs** for unauthorized access attempts
6. **Consider IP whitelisting** if server is public-facing

## Bank SMS Format Examples

The parser handles common Indian bank formats:

**HDFC:**
```
Rs.500.00 debited from A/c XX1234 on 24-May-26 at STARBUCKS CAFE DELHI. Avl Bal: Rs.15,000.00. Ref No: UPI/12345678
```

**ICICI:**
```
Rs 250.50 debited from A/c XX5678 on 24-05-26 to UPI-ZOMATO PAYMENTS. Available Balance: Rs 12,500.75
```

**Axis:**
```
Dear Customer, INR 1000.00 has been debited from your A/c XX9012 on 24-MAY-26 for Amazon Purchase. Avl Bal: INR 8,000.00
```

**SBI:**
```
Your A/c XX3456 debited with Rs.750.00 on 24May26 Ref UPI/98765432. Avl Bal Rs.20,000.00
```

The OpenAI parser adapts to various formats automatically!

## Support

- **GitHub Issues**: [Submit a bug/feature request](../../issues)
- **Logs**: Check server console for parsing errors
- **Tasker Logs**: Enable logging in Tasker Preferences

---

**Last Updated**: May 24, 2026  
**API Version**: v1  
**Tasker Compatible Version**: 6.0+
