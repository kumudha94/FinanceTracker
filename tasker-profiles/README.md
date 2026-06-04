# Tasker Profiles for Finance Tracker

This directory contains pre-configured Tasker profiles for automating transaction creation from bank SMS notifications.

## Files

- **`FinanceTracker-SMS.prf.xml`** - Main profile for SMS interception and parsing
- **`API_REFERENCE.md`** - Complete API endpoint documentation

## Quick Start

### 1. Import Profile into Tasker

1. Transfer `FinanceTracker-SMS.prf.xml` to your Android device
2. Open **Tasker** app
3. Long-press on **Profiles** tab header
4. Tap **Import Profile**
5. Select `FinanceTracker-SMS.prf.xml`
6. Profile will be imported with the name **"Finance Tracker SMS"**

### 2. Configure the Profile

After importing, you **MUST** edit these values:

1. Tap on the **"Finance Tracker SMS"** task name
2. Find **Action 2** (HTTP Request)
3. Replace these placeholders:

   **URL field:**
   ```
   Replace: http://YOUR_SERVER_URL:5000/api/parse-sms
   With:    http://192.168.1.100:5000/api/parse-sms  (your actual server IP)
   ```

   **Headers field:**
   ```
   Replace: X-API-Key: YOUR_API_KEY_HERE
   With:    X-API-Key: abc123xyz789  (your actual TASKER_API_KEY from .env)
   ```

4. Tap **✓** to save

### 3. Enable the Profile

1. Go back to **Profiles** tab
2. Ensure the profile toggle is **ON** (green)
3. Grant SMS permissions if prompted

### 4. Test It!

Send yourself a test SMS that looks like a bank transaction:

```
Rs.100 debited from A/c XX1234 on 24-May-26 at TEST MERCHANT. Avl Bal: Rs.10,000.00
```

Check Finance Tracker - the transaction should appear automatically! 🎉

## Finding Your Server URL

### For Local Testing (Same WiFi Network)

**On Linux/Mac:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**On Windows:**
```cmd
ipconfig | findstr IPv4
```

Your server URL will be: `http://YOUR_LOCAL_IP:5000`

Example: `http://192.168.1.100:5000`

### For Remote Access

If your server is hosted externally:
- Use your public domain: `https://financetracker.yourdomain.com`
- Or public IP: `http://203.0.113.45:5000`

## Profile Structure

The imported profile contains:

### Profile Trigger
- **Event**: Received Text (SMS)
- **Type**: SMS
- **Sender**: Any (blank = all senders)
- **Content**: Any (blank = all messages)

### Task Actions

**Action 1: JavaScriptlet - Extract SMS Data**
- Reads SMS sender, message, timestamp
- Stores in global Tasker variables

**Action 2: HTTP Request - Send to API**
- POST request to `/api/parse-sms`
- Includes API key authentication
- Sends SMS data as JSON

**Action 3: Notify - Show Success (Optional)**
- Displays notification when transaction is created
- Can be disabled if you prefer silent operation

## Customization

### Filter Specific Banks Only

Edit the Profile trigger:
1. Tap on **Profile name** (not task)
2. Tap on **Received Text** event
3. Set **Sender** field to:
   ```
   *HDFC*|*ICICI*|*AXIS*|*SBI*
   ```
   This will only trigger for these bank SMS.

### Silent Mode (No Notifications)

Delete **Action 3** (Notify) from the task if you don't want notifications.

### Custom Notification

Edit **Action 3**:
- **Title**: Your custom title
- **Text**: Your custom message (can use variables like `%SMS_SENDER`)
- **Icon**: Pick your preferred icon
- **Sound**: Set custom ringtone

### Add Logging

Add this action after HTTP Request:
1. Tap **+** → **Code** → **JavaScriptlet**
2. Code:
   ```javascript
   writeFile('tasker/finance_tracker_log.txt', 
     new Date().toISOString() + ' - ' + 
     global('SMS_MESSAGE') + ' - ' + 
     global('HTTPD') + '\n', 
     true);  // true = append
   ```

## Troubleshooting

### Profile not triggering

**Check:**
- ✅ Profile is enabled (green toggle)
- ✅ Tasker has SMS read permission
- ✅ Tasker is not battery optimized
- ✅ Test with real SMS (not just notifications)

**Fix:**
```
Android Settings → Apps → Tasker → Permissions → SMS (Allow)
Android Settings → Apps → Tasker → Battery → Unrestricted
```

### HTTP Request fails

**Check:**
- ✅ Server is running (`npm run dev`)
- ✅ Phone is on same WiFi network
- ✅ Server URL is correct (use IP, not localhost)
- ✅ API key matches `.env` file
- ✅ Firewall allows port 5000

**Test connection:**
Open Chrome on your phone and visit:
```
http://YOUR_SERVER_URL:5000/api/accounts
```
If it loads, your server is accessible!

### Transactions not parsing

**Check server logs:**
```bash
# In your server terminal
npm run dev
# Watch for: "Could not parse transaction from SMS"
```

**Common causes:**
- SMS format doesn't match bank patterns
- OpenAI API key not configured (uses fallback)
- SMS is not actually a transaction notification

### "401 API key required"

**Solution:**
1. Add `TASKER_API_KEY=your_key_here` to `.env`
2. Restart server: `npm run dev`
3. Update API key in Tasker HTTP Request headers

## Testing Without Real Bank SMS

### Method 1: Tasker Test Task

1. Go to **Tasks** tab in Tasker
2. Create new task: **"Test Finance SMS"**
3. Add action: **Phone** → **Send SMS**
   - Number: Your own number
   - Message: `Rs.500 debited from A/c XX1234 at Starbucks`
4. Run the task

### Method 2: cURL from Terminal

```bash
curl -X POST http://YOUR_SERVER_URL:5000/api/parse-sms \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "sender": "HDFC",
    "message": "Rs.500 debited from A/c XX1234 at Starbucks",
    "receivedAt": "2026-05-24T10:30:00Z"
  }'
```

### Method 3: Use Test Script

From project root:
```bash
./test-sms-parser.sh
```

## Bank SMS Format Examples

The parser handles these Indian bank formats:

**HDFC:**
```
Rs.500.00 debited from A/c XX1234 on 24-May-26 at STARBUCKS CAFE DELHI. 
Avl Bal: Rs.15,000.00. Ref No: UPI/12345678
```

**ICICI:**
```
Rs 250.50 debited from A/c XX5678 on 24-05-26 to UPI-ZOMATO PAYMENTS. 
Available Balance: Rs 12,500.75
```

**Axis:**
```
Dear Customer, INR 1000.00 has been debited from your A/c XX9012 on 24-MAY-26 
for Amazon Purchase. Avl Bal: INR 8,000.00
```

**SBI:**
```
Your A/c XX3456 debited with Rs.750.00 on 24May26 Ref UPI/98765432. 
Avl Bal Rs.20,000.00
```

## Advanced Usage

See [TASKER_INTEGRATION.md](../TASKER_INTEGRATION.md) for:
- Batch processing multiple SMS
- Balance tracking
- Conditional notifications
- Security best practices
- Custom categorization rules

## Support

- **Full Guide**: [TASKER_INTEGRATION.md](../TASKER_INTEGRATION.md)
- **API Docs**: [API_REFERENCE.md](./API_REFERENCE.md)
- **GitHub Issues**: Report bugs or request features

---

**Last Updated**: May 24, 2026  
**Profile Version**: 1.0  
**Tasker Compatibility**: 6.0+
