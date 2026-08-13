# Notification-based bill/due-reminder capture

TODO context: SMS auto-read only catches bill-due reminders that arrive as
SMS. Some banks/merchants send due reminders only as app push notifications
instead (e.g. a bill-aggregator app's "New Bill: Airtel ₹979 due tomorrow",
or a merchant's own "Recharge Reminder... expires tomorrow"). Idea: read
Android system notifications the same privacy-conscious way SMS auto-read
already works, and feed matching ones into the existing Bills Inbox /
scheduled-payment / loan / insurance due-reminder pipeline.

Confirmed via discussion:
- These are due-date reminders, not completed payments — they feed the
  **existing** Bills Inbox review flow, not the transaction-creation flow.
- Filtering strategy: keyword filter across all apps (mirrors SMS auto-read's
  "only SMS containing debited/credited is processed" model), not a
  user-maintained app allowlist.
- Android-only — iOS has no equivalent capability. Same `Platform.OS`
  guard pattern used throughout the SMS feature, applied at each call site
  (no centralized wrapper exists in this codebase; don't introduce one here).
- This is a materially more sensitive Android permission
  (`BIND_NOTIFICATION_LISTENER_SERVICE`, system-wide notification read
  access) than SMS — flagged explicitly, not hidden, in the consent screen
  and in this spec.

## Scope

Mobile app (new native module + config plugin + settings screen + JS
capture logic) and one small backend schema addition. **No new backend
endpoint** — see "Backend integration" below for why `POST /api/parse-sms`
is reused unchanged.

## Architecture overview

Mirrors the existing SMS auto-read pipeline end to end, file-for-file:

| SMS auto-read (existing) | Notification capture (new) |
|---|---|
| `mobile/plugins/withSmsReceiver.js` | `mobile/plugins/withNotificationListener.js` |
| `mobile/plugins/native/SmsReceiver.kt` (`BroadcastReceiver`) | `mobile/plugins/native/NotificationListener.kt` (`NotificationListenerService`) |
| `mobile/plugins/native/SmsHeadlessTaskService.kt` | `mobile/plugins/native/NotificationHeadlessTaskService.kt` |
| `mobile/src/tasks/smsHeadlessTask.ts` (`"SmsAutoParseTask"`) | `mobile/src/tasks/notificationHeadlessTask.ts` (`"NotificationAutoParseTask"`) |
| `mobile/src/lib/smsAutoReader.ts` (`looksFinancial`, dedupe, queue, POST) | `mobile/src/lib/notificationAutoReader.ts` (`looksLikeBillReminder`, dedupe, queue, POST) |
| `mobile/src/screens/SmsAutoReadScreen.tsx` | `mobile/src/screens/NotificationAutoReadScreen.tsx` |

## 1. Native capture layer

`mobile/plugins/withNotificationListener.js` — new Expo config plugin,
structured exactly like `withSmsReceiver.js`:
- `withNotificationListenerManifest`: injects a `<service>` into
  `AndroidManifest.xml` — `android:name=".NotificationListener"`,
  `android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"`,
  `android:exported="true"`, with an `<intent-filter>` for
  `android.service.notification.NotificationListenerService`.
- `withNotificationListenerNativeFiles`: copies
  `NotificationListener.kt` + `NotificationHeadlessTaskService.kt` into the
  package java dir, same package-rewrite mechanism as the existing plugin.

`mobile/plugins/native/NotificationListener.kt` — extends
`NotificationListenerService`, overrides `onNotificationPosted(sbn:
StatusBarNotification)`. This callback must stay extremely lightweight —
it runs on the listener service's main thread, and blocking here (e.g. a
`PackageManager` lookup, which can be slow on a cache miss) risks ANR-class
delays across every notification the device posts, not just this app's own.
So `onNotificationPosted` does **only** cheap, in-memory extraction:
`sbn.packageName`, `sbn.key` (for dedup, see below), `sbn.postTime`, and the
raw `sbn.notification.extras` bundle — then immediately starts
`NotificationHeadlessTaskService` with that bundle. No `PackageManager` call,
no string concatenation, no filtering logic in this method.

Extras read from the bundle: `EXTRA_TITLE`, then **`EXTRA_BIG_TEXT` in
preference to `EXTRA_TEXT`** — `BigTextStyle` notifications (common for
anything with real detail, which is exactly the shape of a bill reminder)
truncate `EXTRA_TEXT` and put the full body in `EXTRA_BIG_TEXT`; reading only
`EXTRA_TEXT` would silently lose the due-date/amount detail on those.
Fall back to `EXTRA_TEXT` when `EXTRA_BIG_TEXT` is absent.

`NotificationHeadlessTaskService.kt` — identical shape to
`SmsHeadlessTaskService.kt`, launching JS task `"NotificationAutoParseTask"`.
This is where the deferred work happens: resolving the app's display label
via `PackageManager.getApplicationLabel(...)` (falls back to the raw package
name if resolution fails — never block the task on this) and concatenating
title+body into one string (mirrors `SmsReceiver.kt` joining multi-part SMS
bodies) before handing `{ appLabel, appPackage, title, text, notificationKey,
timestamp }` to the JS task. Moving label resolution here, off
`onNotificationPosted`'s critical path, is the whole point of splitting it
out this way.

`mobile/src/tasks/notificationHeadlessTask.ts` — identical shape to
`smsHeadlessTask.ts`, calling a new `processIncomingNotification(payload)` in
`notificationAutoReader.ts`.

## 2. Consent & permission flow

New screen, `mobile/src/screens/NotificationAutoReadScreen.tsx`, reachable
from the same "More" area as "Auto-Read SMS". Same transparency framing as
the existing SMS screen ("What this permission is used for" bullet list),
explicitly naming the broader scope:
- "This reads notification **text** from apps on your device to detect bill
  due-reminders — only notifications matching bill/due keywords are ever
  sent to the server; everything else is discarded on your device,
  unread by the app in any lasting way."
- "This is a broader permission than SMS access — once granted, Android
  technically allows this app to see notification text from any app, not
  just bill-related ones. The on-device filter above is what keeps
  everything else from ever leaving your device."

No in-app permission prompt exists for this (unlike
`PermissionsAndroid.requestMultiple` for SMS) — Android requires opening
`Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS` via `Linking.openSettings()`
… actually via a dedicated intent, not the generic app-settings deep link;
implementation detail for the plan, not this spec. The screen checks current
grant status on mount and on focus (`useFocusEffect`, mirroring
`SmsAutoReadScreen.tsx`'s `refreshStatus` pattern exactly) via
`NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)`
— exposed to JS via a small native module method
(`isNotificationListenerEnabled()`), since there is no way to detect this
from pure JS/Expo APIs. A toggle mirrors the SMS screen's `enabled` switch,
but "off" here can only stop *processing* (guard flag checked in
`processIncomingNotification`, same as SMS auto-read's own
`isAutoReadEnabled()` check) — the app cannot programmatically revoke the OS
grant; the screen explains this and links to the same system settings page
to revoke manually.

## 3. On-device keyword filtering

`looksLikeBillReminder(text: string): boolean` in `notificationAutoReader.ts`,
same "cheap pre-filter, must stay a superset of what the server actually
acts on" comment convention as `looksFinancial`. Starting keyword set (not
final — tunable based on real usage, same as SMS's own keyword list has
grown over time per its comment history):
`due|bill|recharge|expires|expiring|outstanding|overdue|renew|premium`

`payment` is deliberately **not** included as a bare keyword — it matches
far too much non-reminder noise ("Your payment of ₹500 was successful",
"payment method added", generic UPI confirmations), none of which are due
reminders, and every match here creates a Bills Inbox entry downstream. The
other keywords already cover the concept without it. If `payment` needs to
be included later, it should require a due-signal companion word in the
same match (e.g. `payment due`, `payment pending`), not stand alone.

## 4. Backend integration

**No new endpoint.** `POST /api/parse-sms` (`server/routes.ts:4045`) already
takes generic `{ sender, message, receivedAt }`, and `processSingleSms`
already falls through to `processDueSms` (`server/routes.ts:3661`) for any
text `parseSmsMessage` can't extract a transaction from — which notification
text like "Recharge Reminder... expires tomorrow" won't, since it doesn't
match the transaction regex patterns in `server/smsParser.ts`.
`deriveInstitutionKey` (`server/smsParser.ts:205-208`) already has a
non-DLT-header fallback (`sender.trim().toUpperCase()`) — an app label like
`"Amazon"` flows through that path with no changes needed.
`postNotificationToBackend` in `notificationAutoReader.ts` calls the exact
same `postSmsToBackend`-shaped request (same `X-API-Key` auth via
`TASKER_API_KEY`, same endpoint), passing `sender: payload.appLabel`,
`message: payload.title + '\n' + payload.text`, `receivedAt`.

**One schema addition** — `shared/schema.ts`, `smsLogs` table
(`shared/schema.ts:923-936`): add
`source: varchar("source", { length: 20 }).notNull().default("sms")`.
Set explicitly to `"notification"` in the one new call site
(`notificationAutoReader.ts`'s POST payload gains a `source: "notification"`
field; `processSingleSms`/wherever `smsLogData` is built reads it, defaulting
to `"sms"` when absent — matches how every other new optional field in this
flow has been threaded through `smsLogData` historically). Surfaced in
`BillsInboxScreen.tsx` as a small "via notification" vs. "via SMS" badge on
each entry, reusing whatever badge/tag pattern that screen already has for
status — implementation detail for the plan.

## 5. Deduplication

Android re-posts/updates a notification as it changes (e.g. a persistent
reminder ticking down "expires tomorrow" → "expires today", or the amount
changing). `sbn.key` is a deterministic `pkg|tag|id|userId` composite —
Android reuses the *same* key across updates to the *same* logical
notification, which is exactly what makes it dedup-worthy, but it's also
why key-alone dedup is wrong here: an app updating a notification with
materially different text (a new due date, a new amount) keeps the same
key, so pure key-based dedup would silently swallow real updates the user
would want reflected in Bills Inbox.

Dedup key is therefore **`sbn.key` + a hash of the extracted title+body
text**, not `sbn.key` alone. Same posting key with an unchanged content hash
→ genuine repost, discard. Same posting key with a *changed* content hash →
treat as new (the underlying reminder materially changed), reprocess.
Stored the same way SMS auto-read tracks `processedKey` via `AsyncStorage`
(`getProcessedIds` / `markProcessed` / `wasAlreadyProcessed`, same
`MAX_PROCESSED_IDS` cap) — `notificationAutoReader.ts` gets its own parallel
storage key, not sharing the SMS feature's `AsyncStorage` key/list (different
event stream, no reason to intermix and prematurely evict either's dedup
history).

## 6. Scoping & risk (documentation only, no code)

- Android-only: every new screen/module gated by `Platform.OS === 'android'`
  checks at each call site, matching the existing SMS feature's pattern
  exactly (no centralized guard component exists in this codebase; don't
  introduce one as part of this feature).
- Google Play policy: `BIND_NOTIFICATION_LISTENER_SERVICE` is a "sensitive
  permission" under Play's policy for apps beyond internal testing — the
  on-device keyword filter is the privacy-minimizing design Play's review
  expects, but is not a guarantee of approval. Out of scope for this spec to
  resolve; flagged for awareness before any future public release.

## Out of scope

- No user-configurable app allowlist (rejected in favor of keyword
  filtering — see confirmed decisions above).
- No change to `processDueSms`/`billSenderMappings`/Bills Inbox matching
  logic itself — this feature only adds a second *source* of text feeding
  the existing pipeline unchanged.
- No retroactive tagging of existing `sms_logs` rows — the new `source`
  column defaults to `'sms'` for all historical rows, which is already
  correct (they are all SMS-sourced).
- No iOS equivalent — not possible on that platform.
- Keyword list tuning based on real false-positive/false-negative rates is
  explicitly ongoing follow-up work, not a blocking requirement for the
  initial implementation.

## Pre-implementation verification (gates Task 1 of the plan)

Before writing any native code, trace the existing
`/api/parse-sms` → `processSingleSms` → `processDueSms` → `sms_logs` chain
with a concrete notification-shaped string (e.g. "New Bill: Airtel ₹979 due
tomorrow" as `message`, `"Amazon"` as `sender`) rather than relying on the
structural reasoning in this spec alone. Specifically confirm: (a)
`parseSmsMessage` genuinely returns null/no-amount for this text (doesn't
accidentally match a transaction pattern); (b) the credit-card-dues branch
inside `processDueSms` (which matches on `cardLastFourDigits` extracted via
regex from the message) doesn't misfire just because a bill amount happens
to contain a 4-digit sequence; (c) `deriveInstitutionKey`'s fallback path
produces a sane institution key for an app-label sender like `"Amazon"`
end to end. If any of these don't hold as assumed, that's a plan-blocking
finding to resolve before Task 1, not something to discover mid-implementation.

## Testing

No automated test harness exists for this app (established convention).
Verification: `npm run check` / `cd mobile && npx tsc --noEmit` against
baseline, no new errors. Manual, on-device only (no emulator/simulator
available in the implementation environment): grant notification access,
trigger a real bill-reminder-shaped notification (or use a test/dummy
notification from another app), confirm it appears in Bills Inbox tagged
"via notification"; confirm a non-matching notification (e.g. a WhatsApp
message, or a "payment successful" style confirmation per the keyword
change above) never reaches the network (verify via a temporary log line,
removed before merge, or via not seeing it in `sms_logs` at all); confirm
toggling the in-app switch off stops processing without needing to revisit
Android Settings; confirm the same logical notification reposting with
*unchanged* text doesn't create a second Bills Inbox entry, and that one
reposting with *changed* text (different due date/amount) does create a
second entry rather than being silently dropped.
