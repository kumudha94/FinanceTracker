export const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Privacy Policy - My Tracker</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1f2937; }
  h1 { color: #16a34a; }
  h2 { margin-top: 32px; color: #111827; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  .updated { color: #6b7280; font-size: 14px; }
</style>
</head>
<body>
  <h1>Privacy Policy - My Tracker</h1>
  <p class="updated">Last updated: 2026-07-18</p>

  <p>My Tracker ("the app") is a personal finance tracking application. This policy explains what data the app collects, how it is used, and how it is protected.</p>

  <h2>SMS Access</h2>
  <p>If you enable "Auto-Read Bank SMS" in the app, My Tracker requests permission to read incoming SMS messages on your device. This permission is used only to:</p>
  <ul>
    <li>Detect incoming messages that contain the words "debited" or "credited" (typical bank transaction alerts). All other SMS messages are ignored on your device and never transmitted anywhere.</li>
    <li>Send the text of a matching message to My Tracker's own backend server, where it is parsed to extract the transaction amount, merchant name, and account, and used to automatically create a transaction record and update the matching account's balance in your own data.</li>
  </ul>
  <p>SMS content is never shared with, sold to, or processed by any third party or advertising service. It is used exclusively to power the app's own transaction-tracking feature, for your own account.</p>
  <p>You can disable Auto-Read Bank SMS at any time from the app's "Auto-Read SMS" screen, or revoke SMS permission entirely from your device's Settings &gt; Apps &gt; My Tracker &gt; Permissions.</p>

  <h2>Notifications</h2>
  <p>My Tracker requests notification permission to show you a confirmation each time a transaction is automatically added from an SMS, so you always know what the app did on your behalf.</p>

  <h2>Account &amp; Financial Data</h2>
  <p>The app stores the financial data you enter or that is parsed from SMS - accounts, transactions, budgets, scheduled payments, loans, insurance, and savings goals - in a private database used only to power your own dashboard and reports. This data is not sold or shared with third parties.</p>

  <h2>Authentication</h2>
  <p>Login uses email-based one-time passcodes (OTP) and/or a password you set. Optional device biometric unlock (fingerprint/face) and a 4-digit PIN are handled locally by your device's operating system and are never transmitted to the backend.</p>

  <h2>Data Deletion</h2>
  <p>You can permanently delete your account and all associated data at any time from Settings &gt; Danger Zone &gt; Delete Account within the app.</p>

  <h2>Contact</h2>
  <p>Questions about this policy or your data can be sent to <a href="mailto:kumudhaglory@gmail.com">kumudhaglory@gmail.com</a>.</p>
</body>
</html>
`;
