# Notification-Based Bill/Due-Reminder Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Android notification text the same privacy-conscious way SMS auto-read already works, and feed bill/due-reminder-shaped notifications into the existing Bills Inbox pipeline.

**Architecture:** Mirrors the existing SMS auto-read pipeline file-for-file (config plugin → native listener → headless task → on-device keyword filter → dedup → POST to the existing `/api/parse-sms` endpoint, which already falls through to the due-reminder path for non-transaction text). One new piece with no SMS precedent: a small local Expo Module (native permission-check bridge, since checking notification-listener grant status requires a bidirectional JS↔native call the SMS feature never needed).

**Tech Stack:** Expo config plugins, Kotlin (Android native), Expo Modules API (`expo-modules-core`, already present at v1.11.14), React Native, Express + Drizzle (backend).

**Spec:** `docs/superpowers/specs/2026-08-09-notification-bill-capture-design.md`

## Global Constraints

- Android-only — gate every new screen/module with `Platform.OS === 'android'` at each call site, matching the existing SMS feature's pattern exactly (no centralized guard component exists in this codebase; don't introduce one).
- Keyword filter across all apps, not a user-maintained allowlist (confirmed design decision).
- No new backend endpoint — reuses `POST /api/parse-sms` (`server/routes.ts:4045`) unchanged; only a `source` field is added to the request body and threaded through.
- Dedup key is `sbn.key` **+** a content hash of the extracted text, not `sbn.key` alone — Android reuses the same key across updates to the same logical notification, so key-only dedup would silently swallow real updates with materially different text.
- `onNotificationPosted()` must do only cheap, in-memory extraction (`packageName`, `key`, `postTime`, raw extras) — no `PackageManager` calls, no string work, no filtering inline. That work is deferred to the headless task service.
- Read `EXTRA_BIG_TEXT` before falling back to `EXTRA_TEXT` — `BigTextStyle` notifications (the common shape for anything with real detail, like a bill reminder) truncate `EXTRA_TEXT`.
- `payment` is deliberately excluded from the keyword list as a bare word (matches too much confirmation/success noise) — final list: `due|bill|recharge|expires|expiring|outstanding|overdue|renew|premium`.
- No automated test harness exists for this app (established convention). Verification gates: `npm run check` (root `tsc`) for backend changes, `cd mobile && npx tsc --noEmit` for mobile changes. **Before Task 1**, run both in a fresh worktree and record the baseline `error TS` counts — every task's bar is *no new errors* against that baseline, not zero.
- Schema changes apply via `npm run db:push` against the real database — not possible in this sandboxed implementation environment (no `DATABASE_URL`). Task 2's DB-touching verification is code-inspection only; the user runs `db:push` afterward, same as every prior schema change in this project.
- No emulator/simulator is available in this implementation environment. Every native-code task's verification is code-inspection only — real on-device testing happens after this plan is fully implemented and pushed, same as the SMS feature's own development history.

---

### Task 1: Expand due-reminder keyword detection for notification-style phrasing

**Files:**
- Modify: `server/smsParser.ts` (`DUE_KEYWORDS`, ~line 28-31)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by a later task — this is a standalone fix, verified necessary by this plan's own pre-implementation trace (see below), independent of everything else in this plan.

This task exists because of a concrete finding: tracing the two example notifications from the spec ("New Bill: Airtel ₹979 due tomorrow", "...recharge pack of Rs.979...expires tomorrow") through the existing `parseDueSms` function showed **neither would be captured** — `DUE_KEYWORDS` only contains bank/DLT-SMS-style phrases ("is due on", "total outstanding", etc.), none of which match casual "due tomorrow"/"expires tomorrow" phrasing common in app notifications. Without this fix, the rest of this plan would build a fully working capture pipeline that silently drops exactly the kind of notification it's meant to catch.

- [ ] **Step 1: Add notification-style due phrases to `DUE_KEYWORDS`**

Current code (`server/smsParser.ts:28-31`):
```ts
const DUE_KEYWORDS = [
  "dues of", "minimum due", "total due", "total outstanding",
  "outstanding amount", "amount due", "bill amount", "payment due",
  "e-mandate", "will be deducted", "will be debited", "is due on"
];
```
Replace with:
```ts
const DUE_KEYWORDS = [
  "dues of", "minimum due", "total due", "total outstanding",
  "outstanding amount", "amount due", "bill amount", "payment due",
  "e-mandate", "will be deducted", "will be debited", "is due on",
  // Casual due-date phrasing common in app push notifications (vs. bank/DLT SMS wording
  // above) — added for notification-based capture, but applies to SMS too since nothing
  // here is notification-specific.
  "due tomorrow", "due today", "expires tomorrow", "expires today",
  "expiring tomorrow", "expiring today"
];
```

- [ ] **Step 2: Type-check**

Run: `npm run check` (from the repo root)
Expected: no new `error TS` occurrences vs. the baseline recorded before Task 1.

- [ ] **Step 3: Verify by tracing both spec examples through the real function**

There's no live database or test harness in this environment — verify by direct inspection/reasoning against the actual `parseDueSms` function body (`server/smsParser.ts`, right after `DUE_KEYWORDS`):
1. `"New Bill: Airtel ₹979 due tomorrow"` — `hasCurrencyMarker` is true (`₹`). `hasDueKeyword`: lowercased message is `"new bill: airtel ₹979 due tomorrow"`, which now contains `"due tomorrow"` — `true`. `extractAmount` finds `979`. Confirm this now returns a non-null `ParsedDueSmsData`.
2. `"Your Airtel recharge pack of Rs.979 for mobile number 9566115998 expires tomorrow. Ignore if already paid..."` — `hasCurrencyMarker` true (`rs`). `hasDueKeyword`: contains `"expires tomorrow"` — `true`. `extractAmount` finds `979`. Confirm this now also returns non-null.
3. Confirm neither example accidentally matches `extractAccountLastDigits` (`server/smsParser.ts:83-96`) — none of its 5 patterns (`a/c XXXX1234`, `XX1234`, `**1234`, `ending 1234`, `card XXXX1234`) can match a bare phone number like `9566115998` with no masking prefix immediately before it, so `cardLastFourDigits` stays `undefined` for example 2 and neither example risks misrouting into the credit-card-dues branch of `processDueSms`.

- [ ] **Step 4: Commit**

```bash
git add server/smsParser.ts
git commit -m "feat: recognize casual due-date phrasing in due-reminder detection"
```

---

### Task 2: Add `source` tracking to `sms_logs`

**Files:**
- Modify: `shared/schema.ts` (`smsLogs` table, ~line 923-936)
- Modify: `server/routes.ts` (`processSingleSms`, ~line 3837-3847; `POST /api/parse-sms`, ~line 4045-4055)
- Create: `migrations/0024_add_source_to_sms_logs.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 5, Task 7): `smsLogs.source: 'sms' | 'notification'` (defaults `'sms'`); `processSingleSms(messageText, sender, receivedAt, accounts, source?)` gains a 5th optional parameter; `POST /api/parse-sms` accepts an optional `source` field in its JSON body.

- [ ] **Step 1: Add the column to the schema**

Current code (`shared/schema.ts:923-936`):
```ts
export const smsLogs = pgTable("sms_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  sender: varchar("sender", { length: 50 }),
  message: text("message").notNull(),
  receivedAt: timestamp("received_at").notNull(),
  isParsed: boolean("is_parsed").default(false),
  transactionId: integer("transaction_id").references(() => transactions.id),
  institutionMappingId: integer("institution_mapping_id").references(() => senderInstitutionMappings.id), // set when the sender didn't match a known account, for the review queue
  billMappingId: integer("bill_mapping_id").references(() => billSenderMappings.id), // set when this SMS was classified as a due/bill message routed through the Bills Inbox
  creditCardStatementId: integer("credit_card_statement_id").references(() => creditCardStatements.id), // set when this SMS confirmed/flagged a credit card statement
  paymentOccurrenceId: integer("payment_occurrence_id").references(() => paymentOccurrences.id), // set when this SMS confirmed a scheduled payment occurrence
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```
Replace with (adds `source` right after `receivedAt`):
```ts
export const smsLogs = pgTable("sms_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  sender: varchar("sender", { length: 50 }),
  message: text("message").notNull(),
  receivedAt: timestamp("received_at").notNull(),
  source: varchar("source", { length: 20 }).notNull().default("sms"), // 'sms' or 'notification' — where this text was captured from
  isParsed: boolean("is_parsed").default(false),
  transactionId: integer("transaction_id").references(() => transactions.id),
  institutionMappingId: integer("institution_mapping_id").references(() => senderInstitutionMappings.id), // set when the sender didn't match a known account, for the review queue
  billMappingId: integer("bill_mapping_id").references(() => billSenderMappings.id), // set when this SMS was classified as a due/bill message routed through the Bills Inbox
  creditCardStatementId: integer("credit_card_statement_id").references(() => creditCardStatements.id), // set when this SMS confirmed/flagged a credit card statement
  paymentOccurrenceId: integer("payment_occurrence_id").references(() => paymentOccurrences.id), // set when this SMS confirmed a scheduled payment occurrence
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Thread `source` through `processSingleSms`**

Current code (`server/routes.ts:3837-3847`):
```ts
  async function processSingleSms(
    messageText: string,
    sender: string | undefined,
    receivedAt: string | undefined,
    accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>
  ): Promise<ParseSmsResult> {
    const smsLogData: any = {
      message: messageText,
      receivedAt: receivedAt || new Date().toISOString(),
      isParsed: false,
    };
```
Replace with:
```ts
  async function processSingleSms(
    messageText: string,
    sender: string | undefined,
    receivedAt: string | undefined,
    accounts: Awaited<ReturnType<typeof storage.getAllAccounts>>,
    source?: string
  ): Promise<ParseSmsResult> {
    const smsLogData: any = {
      message: messageText,
      receivedAt: receivedAt || new Date().toISOString(),
      isParsed: false,
      source: source === 'notification' ? 'notification' : 'sms',
    };
```

- [ ] **Step 3: Pass `source` from the route into `processSingleSms`**

Current code (`server/routes.ts:4045-4055`):
```ts
  app.post("/api/parse-sms", validateApiKey, async (req, res) => {
    try {
      const { sender, message, receivedAt } = req.body;
      const accounts = await storage.getAllAccounts();
      const result = await processSingleSms(message, sender, receivedAt, accounts);
      res.json(result);
    } catch (error: any) {
      console.error("SMS parsing error:", error.message);
      res.status(500).json({ error: error.message || "Failed to parse SMS" });
    }
  });
```
Replace with:
```ts
  app.post("/api/parse-sms", validateApiKey, async (req, res) => {
    try {
      const { sender, message, receivedAt, source } = req.body;
      const accounts = await storage.getAllAccounts();
      const result = await processSingleSms(message, sender, receivedAt, accounts, source);
      res.json(result);
    } catch (error: any) {
      console.error("SMS parsing error:", error.message);
      res.status(500).json({ error: error.message || "Failed to parse SMS" });
    }
  });
```
(The two other callers of `processSingleSms`/`processDueSms` in this file that don't pass a 5th argument — the batch and rescan/preview paths — are unaffected: `source` is optional and defaults to `'sms'` inside the function itself, exactly the correct behavior for those paths, which are genuinely SMS-only.)

- [ ] **Step 4: Write the migration history file**

Create `migrations/0024_add_source_to_sms_logs.sql`:
```sql
-- Distinguishes SMS-sourced vs. notification-sourced sms_logs rows, for the notification-based
-- bill/due-reminder capture feature. Existing rows default to 'sms', which is already correct
-- (they predate notification capture entirely).
ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'sms';
```

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: no new `error TS` occurrences vs. baseline.

- [ ] **Step 6: Verify by inspection**

No live database in this environment. Verify by reading: confirm `smsLogData.source` is set unconditionally (never left `undefined`, since the column is `NOT NULL` — the ternary `source === 'notification' ? 'notification' : 'sms'` guarantees this even if `source` is `undefined`/any other value); confirm the two other `processSingleSms` call sites in `server/routes.ts` (grep for `processSingleSms(`) still compile with only 4 arguments (the 5th being optional means this is fine, but confirm no caller was accidentally also changed).

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts server/routes.ts migrations/0024_add_source_to_sms_logs.sql
git commit -m "feat: track sms_logs source (sms vs. notification)"
```

---

### Task 3: Native notification capture — config plugin and listener service

**Files:**
- Create: `mobile/plugins/withNotificationListener.js`
- Create: `mobile/plugins/native/NotificationListener.kt`
- Create: `mobile/plugins/native/NotificationHeadlessTaskService.kt`
- Modify: `mobile/app.json` (`plugins` array, ~line 42-61)

**Interfaces:**
- Consumes: nothing new (this task is self-contained native scaffolding).
- Produces (used by Task 5): a `NotificationHeadlessTaskService` that launches JS task `"NotificationAutoParseTask"` with a bundle of `{ appPackage: string, key: string, postTime: number, extras: Bundle }` — `extras` carries whatever the source notification set (`EXTRA_TITLE`, `EXTRA_TEXT`, `EXTRA_BIG_TEXT`, potentially absent). App-label resolution and title/text extraction happen in Task 5's JS layer reading this raw bundle — deliberately not done here (see Global Constraints on keeping `onNotificationPosted` lightweight).

- [ ] **Step 1: Write the Expo config plugin**

Create `mobile/plugins/withNotificationListener.js`:
```js
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_NAME = 'NotificationListener';
const HEADLESS_SERVICE_NAME = 'NotificationHeadlessTaskService';

function withNotificationListenerManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];

    if (!application.service) application.service = [];
    if (!application.service.some((s) => s.$['android:name'] === `.${SERVICE_NAME}`)) {
      application.service.push({
        $: {
          'android:name': `.${SERVICE_NAME}`,
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.service.notification.NotificationListenerService' } },
            ],
          },
        ],
      });
    }

    if (!application.service.some((s) => s.$['android:name'] === `.${HEADLESS_SERVICE_NAME}`)) {
      application.service.push({
        $: {
          'android:name': `.${HEADLESS_SERVICE_NAME}`,
          'android:exported': 'false',
        },
      });
    }

    return config;
  });
}

function withNotificationListenerNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android.package;
      const packagePath = packageName.split('.').join(path.sep);
      const javaDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        packagePath
      );

      fs.mkdirSync(javaDir, { recursive: true });

      const nativeSrcDir = path.join(__dirname, 'native');
      for (const fileName of ['NotificationListener.kt', 'NotificationHeadlessTaskService.kt']) {
        const source = fs.readFileSync(path.join(nativeSrcDir, fileName), 'utf8');
        const rewritten = source.replace(/^package .+$/m, `package ${packageName}`);
        fs.writeFileSync(path.join(javaDir, fileName), rewritten);
      }

      return config;
    },
  ]);
}

module.exports = function withNotificationListener(config) {
  config = withNotificationListenerManifest(config);
  config = withNotificationListenerNativeFiles(config);
  return config;
};
```
(This is `withSmsReceiver.js` line-for-line in structure, differing only in service names, the `<intent-filter>` action, and the `android:permission` value. One deliberate difference from `withSmsReceiver.js`: this uses `config.modResults.manifest.application[0]` directly to get `application`, rather than `AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults)` that `withSmsReceiver.js` uses — both are valid, but check `@expo/config-plugins`' actual exported API at implementation time; if `AndroidConfig.Manifest.getMainApplicationOrThrow` is available and preferred for consistency with the existing plugin, use that form instead — the *result* must be the same `application` object either way.)

- [ ] **Step 2: Write the listener service (lightweight callback)**

Create `mobile/plugins/native/NotificationListener.kt`:
```kotlin
package com.mytracker.finance

import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.HeadlessJsTaskService

class NotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    // Deliberately minimal: this callback runs on the listener's main thread and blocking
    // here (e.g. a PackageManager call) risks delaying notification delivery system-wide,
    // not just for this app. All resolution/parsing work happens in the headless task,
    // off this critical path.
    val serviceIntent = Intent(this, NotificationHeadlessTaskService::class.java)
    serviceIntent.putExtra("appPackage", sbn.packageName)
    serviceIntent.putExtra("key", sbn.key)
    serviceIntent.putExtra("postTime", sbn.postTime)
    serviceIntent.putExtra("extras", sbn.notification.extras)

    startService(serviceIntent)
    HeadlessJsTaskService.acquireWakeLockNow(this)
  }
}
```

- [ ] **Step 3: Write the headless task service**

Create `mobile/plugins/native/NotificationHeadlessTaskService.kt`:
```kotlin
package com.mytracker.finance

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class NotificationHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig? {
    val extras = intent.extras ?: return null
    return HeadlessJsTaskConfig(
      "NotificationAutoParseTask",
      Arguments.fromBundle(extras),
      30000,
      true
    )
  }
}
```
(Identical shape to `SmsHeadlessTaskService.kt` — the `extras` bundle here contains `appPackage`/`key`/`postTime`/`extras` as set in Step 2, forwarded to JS via `Arguments.fromBundle`. `Arguments.fromBundle` converts the nested `extras` Bundle — which itself may contain `CharSequence` values like `EXTRA_TITLE`/`EXTRA_TEXT`/`EXTRA_BIG_TEXT` — into a JS-consumable form; verify at implementation time that nested Bundle values survive this conversion as expected (they should, since `SmsReceiver.kt`'s own bundle already nests a `String` body successfully through the same `Arguments.fromBundle` call), and if a `CharSequence` value doesn't serialize cleanly, convert it to `.toString()` before calling `putExtra` in Step 2 instead.)

- [ ] **Step 4: Register the plugin in `app.json`**

Current code (`mobile/app.json:42-61`):
```json
    "plugins": [
      "./plugins/withSmsReceiver.js",
      [
        "expo-notifications",
        {
          "icon": "./assets/icon.png",
          "color": "#16a34a"
        }
      ],
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 35,
            "targetSdkVersion": 35,
            "buildToolsVersion": "35.0.0"
          }
        }
      ]
    ],
```
Replace with:
```json
    "plugins": [
      "./plugins/withSmsReceiver.js",
      "./plugins/withNotificationListener.js",
      [
        "expo-notifications",
        {
          "icon": "./assets/icon.png",
          "color": "#16a34a"
        }
      ],
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 35,
            "targetSdkVersion": 35,
            "buildToolsVersion": "35.0.0"
          }
        }
      ]
    ],
```

- [ ] **Step 5: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no new `error TS` occurrences vs. baseline (the `.js`/`.kt` files added here aren't part of the TypeScript project, but this confirms nothing else broke).

- [ ] **Step 6: Verify by inspection**

No emulator/device in this environment — cannot run `expo prebuild` or a real build here. Verify by reading: confirm `withNotificationListener.js`'s structure matches `withSmsReceiver.js`'s exactly except for the documented differences (service names, intent-filter action, permission string); confirm both new `.kt` files use `package com.mytracker.finance` as their placeholder package (matching `SmsReceiver.kt`'s convention — the plugin's `.replace(/^package .+$/m, ...)` rewrites this at prebuild time to the real configured package, so the placeholder value itself doesn't matter functionally, but should match the existing files' convention for readability); confirm `app.json`'s plugin is added as a new array entry, not replacing the existing `withSmsReceiver.js` entry.

- [ ] **Step 7: Commit**

```bash
cd mobile && git add plugins/withNotificationListener.js plugins/native/NotificationListener.kt plugins/native/NotificationHeadlessTaskService.kt app.json
git commit -m "feat: add native notification listener service and config plugin"
```

---

### Task 4: Native permission-check bridge (local Expo Module)

**Files:**
- Create: `mobile/modules/notification-listener-bridge/expo-module.config.json`
- Create: `mobile/modules/notification-listener-bridge/android/build.gradle`
- Create: `mobile/modules/notification-listener-bridge/android/src/main/java/com/mytracker/finance/notificationlistenerbridge/NotificationListenerBridgeModule.kt`
- Create: `mobile/modules/notification-listener-bridge/index.ts`

**Interfaces:**
- Consumes: `expo-modules-core` (already present, v1.11.14, confirmed in `mobile/node_modules`).
- Produces (used by Task 6): `isNotificationListenerEnabled(): Promise<boolean>`, exported from `mobile/modules/notification-listener-bridge/index.ts`.

This is a local Expo Module — the standard, prebuild-safe way to add custom native functionality that Expo's autolinking discovers automatically (searches `modules/` at the project root, same as any installed native package), without hand-editing generated files like `MainApplication.kt` directly. Hand-editing generated native files is fragile against EAS's managed prebuild regeneration — this project already hit exactly that problem once this session with `android/app/build.gradle`'s `versionCode` being silently ignored by EAS cloud builds because `eas.json` has `appVersionSource: "remote"`. A local Expo Module avoids the same class of problem for this permission check.

- [ ] **Step 1: Write the module config**

Create `mobile/modules/notification-listener-bridge/expo-module.config.json`:
```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["com.mytracker.finance.notificationlistenerbridge.NotificationListenerBridgeModule"]
  }
}
```

- [ ] **Step 2: Write the module's Android build config**

Create `mobile/modules/notification-listener-bridge/android/build.gradle`:
```gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

group = 'com.mytracker.finance.notificationlistenerbridge'
version = '1.0.0'

def expoModulesCorePlugin = new File(project(":expo-modules-core").projectDir.absolutePath, "ExpoModulesCorePlugin.gradle")
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()
useCoreDependencies()
useExpoPublishing()

android {
  namespace "com.mytracker.finance.notificationlistenerbridge"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
  }
  lintOptions {
    abortOnError false
  }
}
```
(This is the standard template Expo's own `create-expo-module` scaffolding tool generates for a local module — verify against `expo-modules-core`'s actual installed version's `ExpoModulesCorePlugin.gradle` path at implementation time in case the exact plugin file location has moved between Expo SDK versions; `mobile/node_modules/expo-modules-core` is confirmed present to check against.)

- [ ] **Step 3: Write the native module**

Create `mobile/modules/notification-listener-bridge/android/src/main/java/com/mytracker/finance/notificationlistenerbridge/NotificationListenerBridgeModule.kt`:
```kotlin
package com.mytracker.finance.notificationlistenerbridge

import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationListenerBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationListenerBridge")

    AsyncFunction("isEnabled") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }
  }
}
```
(`NotificationManagerCompat.getEnabledListenerPackages(context)` is the canonical AndroidX API for this exact check — reads the same OS-level grant state a user sets via `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`. `androidx.core` is already a transitive dependency of every RN/Expo Android app, so no new dependency is needed for this import.)

- [ ] **Step 4: Write the JS wrapper**

Create `mobile/modules/notification-listener-bridge/index.ts`:
```ts
import { requireNativeModule } from 'expo-modules-core';

const NotificationListenerBridge = requireNativeModule('NotificationListenerBridge');

export function isNotificationListenerEnabled(): Promise<boolean> {
  return NotificationListenerBridge.isEnabled();
}
```

- [ ] **Step 5: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no new `error TS` occurrences vs. baseline.

- [ ] **Step 6: Verify by inspection**

No emulator/device in this environment. Verify by reading: confirm the module name string `"NotificationListenerBridge"` matches exactly between `expo-module.config.json`'s Kotlin class path (which is independent of the `Name(...)` call — the config json points autolinking at the *class*, the `Name(...)` call sets the *JS-visible module name* `requireNativeModule` looks up) and `index.ts`'s `requireNativeModule('NotificationListenerBridge')` call; confirm the Kotlin package path (`com.mytracker.finance.notificationlistenerbridge`) is consistent across `expo-module.config.json`, the `android/build.gradle` namespace, and the `.kt` file's own `package` declaration and directory path (`android/src/main/java/com/mytracker/finance/notificationlistenerbridge/`).

- [ ] **Step 7: Commit**

```bash
cd mobile && git add modules/notification-listener-bridge
git commit -m "feat: add local Expo Module for notification-listener permission check"
```

---

### Task 5: JS capture layer

**Files:**
- Create: `mobile/src/tasks/notificationHeadlessTask.ts`
- Create: `mobile/src/lib/notificationAutoReader.ts`
- Modify: `mobile/index.js`

**Interfaces:**
- Consumes: `NotificationHeadlessTaskService`'s bundle shape from Task 3 (`{ appPackage, key, postTime, extras }`); `API_BASE_URL`/`TASKER_API_KEY` from `mobile/src/lib/api.ts` (already exported, used identically by `smsAutoReader.ts`).
- Produces: `processIncomingNotification(payload: RawNotificationPayload): Promise<void>`, exported from `notificationAutoReader.ts`; `isNotificationAutoReadEnabled()`/`setNotificationAutoReadEnabled(enabled: boolean)`, used by Task 6.

- [ ] **Step 1: Write `notificationAutoReader.ts`**

Create `mobile/src/lib/notificationAutoReader.ts`:
```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { API_BASE_URL, TASKER_API_KEY } from './api';

const STORAGE_KEYS = {
  AUTO_READ_ENABLED: '@finance_tracker_notification_auto_read_enabled',
  PROCESSED_IDS: '@finance_tracker_notification_processed_ids',
  FAILED_QUEUE: '@finance_tracker_notification_failed_queue',
};

const MAX_PROCESSED_IDS = 200;
const MAX_QUEUE_SIZE = 50;

export interface RawNotificationPayload {
  appPackage: string;
  key: string;
  postTime: number;
  extras?: {
    'android.title'?: string;
    'android.text'?: string;
    'android.bigText'?: string;
    [k: string]: unknown;
  };
}

interface QueuedNotification {
  sender: string;
  message: string;
  receivedAt: string;
  processedKey: string;
}

interface ParseNotificationResult {
  success: boolean;
  transaction?: { id: number; amount: string; type: string; merchant?: string } | null;
  parsed?: { amount: number; type: 'debit' | 'credit'; merchant?: string };
  message?: string;
}

export async function isNotificationAutoReadEnabled(): Promise<boolean> {
  const value = await AsyncStorage.getItem(STORAGE_KEYS.AUTO_READ_ENABLED);
  return value === 'true';
}

export async function setNotificationAutoReadEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.AUTO_READ_ENABLED, enabled ? 'true' : 'false');
}

// Cheap on-device pre-filter so most notifications never reach the server. Must stay a
// superset of what server/smsParser.ts's DUE_KEYWORDS actually acts on — deliberately
// excludes bare "payment" (matches confirmation/success notifications, not just reminders;
// see docs/superpowers/specs/2026-08-09-notification-bill-capture-design.md).
function looksLikeBillReminder(text: string): boolean {
  return /due|bill|recharge|expires|expiring|outstanding|overdue|renew|premium/i.test(text);
}

// FNV-1a, good enough for a cheap local content fingerprint (not cryptographic use).
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function extractText(payload: RawNotificationPayload): { title: string; body: string } {
  const extras = payload.extras || {};
  const title = typeof extras['android.title'] === 'string' ? extras['android.title'] : '';
  // Prefer bigText (BigTextStyle notifications truncate the plain text field) — see Global
  // Constraints in the plan this file was built from.
  const body =
    typeof extras['android.bigText'] === 'string' ? extras['android.bigText'] :
    typeof extras['android.text'] === 'string' ? extras['android.text'] : '';
  return { title, body };
}

async function getProcessedIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.PROCESSED_IDS);
  return raw ? JSON.parse(raw) : [];
}

async function markProcessed(key: string): Promise<void> {
  const ids = await getProcessedIds();
  if (ids.includes(key)) return;
  const updated = [...ids, key].slice(-MAX_PROCESSED_IDS);
  await AsyncStorage.setItem(STORAGE_KEYS.PROCESSED_IDS, JSON.stringify(updated));
}

async function wasAlreadyProcessed(key: string): Promise<boolean> {
  const ids = await getProcessedIds();
  return ids.includes(key);
}

async function getQueue(): Promise<QueuedNotification[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.FAILED_QUEUE);
  return raw ? JSON.parse(raw) : [];
}

async function enqueue(item: QueuedNotification): Promise<void> {
  const queue = await getQueue();
  const updated = [...queue, item].slice(-MAX_QUEUE_SIZE);
  await AsyncStorage.setItem(STORAGE_KEYS.FAILED_QUEUE, JSON.stringify(updated));
}

async function setQueue(queue: QueuedNotification[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.FAILED_QUEUE, JSON.stringify(queue));
}

async function postNotificationToBackend(sender: string, message: string, receivedAt: string): Promise<ParseNotificationResult> {
  const response = await fetch(`${API_BASE_URL}/api/parse-sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TASKER_API_KEY,
    },
    body: JSON.stringify({ sender, message, receivedAt, source: 'notification' }),
  });

  if (!response.ok) {
    throw new Error(`Notification parse request failed with status ${response.status}`);
  }

  return response.json();
}

export async function drainFailedNotificationQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;

  const netState = await NetInfo.fetch();
  if (!netState.isConnected) return;

  const remaining: QueuedNotification[] = [];
  for (const item of queue) {
    try {
      await postNotificationToBackend(item.sender, item.message, item.receivedAt);
      await markProcessed(item.processedKey);
    } catch {
      remaining.push(item);
    }
  }
  await setQueue(remaining);
}

export async function processIncomingNotification(payload: RawNotificationPayload): Promise<void> {
  const enabled = await isNotificationAutoReadEnabled();
  if (!enabled) return;

  const { title, body } = extractText(payload);
  const fullText = `${title}\n${body}`.trim();
  if (!fullText) return;

  if (!looksLikeBillReminder(fullText)) return;

  // sbn.key alone would miss content changes to the same logical notification (a reminder
  // updating from "expires tomorrow" to "expires today" reuses the same key) — combine with
  // a content hash so a materially changed repost is treated as new, not silently dropped.
  const processedKey = `${payload.key}:${hashText(fullText)}`;
  if (await wasAlreadyProcessed(processedKey)) return;

  await drainFailedNotificationQueue();

  const receivedAt = new Date(payload.postTime).toISOString();
  const sender = payload.appPackage;

  try {
    await postNotificationToBackend(sender, fullText, receivedAt);
    await markProcessed(processedKey);
  } catch {
    await enqueue({
      sender,
      message: fullText,
      receivedAt,
      processedKey,
    });
  }
}
```

Notes on deliberate deviations from `smsAutoReader.ts`'s exact shape:
- `sender` here is `payload.appPackage` (the raw Android package name, e.g. `"com.amazon.mShop.android.shopping"`), not a resolved app label like `"Amazon"`. Resolving a human-readable label requires a `PackageManager.getApplicationLabel(...)` call, which needs a `Context` — doing that from pure JS would require yet another native bridge call for something cosmetic. The package name is a perfectly valid, stable `sender` value for `deriveInstitutionKey`'s fallback path (`server/smsParser.ts:205-208`, `sender.trim().toUpperCase()`) and for display purposes later — Task 7's Bills Inbox badge can show the raw sender string as-is, same as it already does for SMS phone numbers/short codes. If a human-readable label turns out to matter later, that's a separate, optional enhancement, not a blocker here.
- No `notifyTransactionAdded`-equivalent local push confirmation (unlike `smsAutoReader.ts`'s `notifyTransactionAdded`) — a due-reminder capture doesn't create a transaction, so there's nothing transaction-shaped to announce; the item simply appears in Bills Inbox next time the user opens it, matching how SMS-sourced due-reminders already behave (no confirmation push for those either — only completed-transaction SMS get one, per `finishWithTransaction`'s own use of `notifyTransactionAdded`, not `processDueSms`).

- [ ] **Step 2: Write the headless task**

Create `mobile/src/tasks/notificationHeadlessTask.ts`:
```ts
import { processIncomingNotification, RawNotificationPayload } from '../lib/notificationAutoReader';

export default async function notificationAutoParseTask(data: RawNotificationPayload): Promise<void> {
  try {
    await processIncomingNotification(data);
  } catch (error) {
    console.error('[NotificationAutoParseTask] failed to process incoming notification:', error);
  }
}
```

- [ ] **Step 3: Register the headless task**

Current code (`mobile/index.js`):
```js
import { AppRegistry, Platform } from 'react-native';
import registerRootComponent from 'expo/build/launch/registerRootComponent';

import App from './App';
import smsAutoParseTask from './src/tasks/smsHeadlessTask';

// react-native-web's AppRegistry has no registerHeadlessTask — calling it unconditionally
// throws at module load and blanks the whole web bundle before React ever mounts.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('SmsAutoParseTask', () => smsAutoParseTask);
}

registerRootComponent(App);
```
Replace with:
```js
import { AppRegistry, Platform } from 'react-native';
import registerRootComponent from 'expo/build/launch/registerRootComponent';

import App from './App';
import smsAutoParseTask from './src/tasks/smsHeadlessTask';
import notificationAutoParseTask from './src/tasks/notificationHeadlessTask';

// react-native-web's AppRegistry has no registerHeadlessTask — calling it unconditionally
// throws at module load and blanks the whole web bundle before React ever mounts.
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('SmsAutoParseTask', () => smsAutoParseTask);
  AppRegistry.registerHeadlessTask('NotificationAutoParseTask', () => notificationAutoParseTask);
}

registerRootComponent(App);
```

- [ ] **Step 4: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no new `error TS` occurrences vs. baseline.

- [ ] **Step 5: Verify by inspection**

No emulator/device in this environment — verify by code trace: confirm `looksLikeBillReminder`'s regex has no `payment` alternative (per Global Constraints); confirm `processedKey` combines `payload.key` and a hash of `fullText`, not `payload.key` alone; confirm `postNotificationToBackend` sends `source: 'notification'` in its JSON body, matching Task 2's `req.body.source` read exactly; confirm `extras['android.bigText']` is checked before `extras['android.text']` in `extractText`; confirm the `AppRegistry.registerHeadlessTask` call for `'NotificationAutoParseTask'` uses the exact same string as `HeadlessJsTaskConfig("NotificationAutoParseTask", ...)` in Task 3's `NotificationHeadlessTaskService.kt` — a mismatch here would silently fail to deliver any notification data to JS at all, with no compile-time error to catch it.

- [ ] **Step 6: Commit**

```bash
cd mobile && git add src/tasks/notificationHeadlessTask.ts src/lib/notificationAutoReader.ts index.js
git commit -m "feat: add JS capture layer for notification-based bill detection"
```

---

### Task 6: Consent screen and navigation

**Files:**
- Create: `mobile/src/screens/NotificationAutoReadScreen.tsx`
- Modify: `mobile/App.tsx` (`MoreStackParamList`, ~line 94-113; imports; `MoreStack.Screen` registrations, ~line 209-213)
- Modify: `mobile/src/screens/SmsStatementsHubScreen.tsx` (`items`, ~line 20-42)

**Interfaces:**
- Consumes: `isNotificationAutoReadEnabled`/`setNotificationAutoReadEnabled` (Task 5); `isNotificationListenerEnabled` from `../../modules/notification-listener-bridge` (Task 4).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the consent screen**

Create `mobile/src/screens/NotificationAutoReadScreen.tsx`:
```tsx
import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Linking, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import {
  isNotificationAutoReadEnabled,
  setNotificationAutoReadEnabled,
} from '../lib/notificationAutoReader';
import { isNotificationListenerEnabled } from '../../modules/notification-listener-bridge';

export default function NotificationAutoReadScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const [enabled, setEnabled] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const [autoReadOn, listenerGranted] = await Promise.all([
      isNotificationAutoReadEnabled(),
      isNotificationListenerEnabled(),
    ]);
    setEnabled(autoReadOn && listenerGranted);
    setPermissionGranted(listenerGranted);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useFocusEffect(
    useCallback(() => {
      refreshStatus();
    }, [refreshStatus])
  );

  const handleToggle = async (value: boolean) => {
    if (!value) {
      await setNotificationAutoReadEnabled(false);
      setEnabled(false);
      return;
    }

    const granted = await isNotificationListenerEnabled();
    if (!granted) {
      Linking.sendIntent
        ? Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS')
        : Linking.openSettings();
      return;
    }

    await setNotificationAutoReadEnabled(true);
    setEnabled(true);
  };

  if (Platform.OS !== 'android') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Notification-based bill detection is only available on Android.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={[styles.infoCard, { backgroundColor: `${colors.primary}15` }]}>
        <Ionicons name="notifications-outline" size={24} color={colors.primary} />
        <Text style={[styles.infoText, { color: colors.text }]}>
          My Tracker can read notification text from other apps to catch bill/due reminders that never arrive as SMS.
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>What this permission is used for</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            Only notifications matching bill/due-reminder keywords are ever sent to the server — everything else is discarded on your device.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            This is a broader permission than SMS access — once granted, Android technically allows this app to see notification text from any app, not just bill-related ones. The on-device filter above is what keeps everything else from ever leaving your device.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            Matching notifications are sent only to your own My Tracker backend, and route into your existing Bills Inbox for review — nothing is added automatically without you seeing it there.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            You can turn this off anytime below. The app cannot revoke the underlying Android permission on its own — turning it off here only stops processing; to fully revoke access, use the button below to open Android Settings.
          </Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Notification Access</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Auto-Detect Bill Notifications</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>
                {!permissionGranted
                  ? 'Not enabled in Android Settings'
                  : enabled
                    ? 'Enabled — matching notifications are added to Bills Inbox automatically'
                    : 'Disabled'}
              </Text>
            </View>
          </View>
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: `${colors.primary}80` }}
            thumbColor={enabled ? colors.primary : colors.textMuted}
          />
        </View>
        <TouchableOpacity
          style={[styles.settingsLinkRow, { borderTopColor: colors.border }]}
          onPress={() =>
            Linking.sendIntent
              ? Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS')
              : Linking.openSettings()
          }
        >
          <Text style={[styles.settingsLinkText, { color: colors.primary }]}>Open Android Notification Access Settings</Text>
          <Ionicons name="open-outline" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    margin: 16,
    borderRadius: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  settingSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  settingsLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 14,
  },
  settingsLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
```
`Linking.sendIntent` is Android-only and may not exist on the `Linking` type depending on the installed `react-native` types version — check at implementation time; if it's not available as typed, use `Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS')` guarded behind a runtime existence check as written above (`Linking.sendIntent ? ... : Linking.openSettings()`), which degrades to opening the app's own generic settings page (still useful, just one extra tap for the user to reach notification access from there) rather than crashing if the specific intent API isn't present on the RN version in use.

- [ ] **Step 2: Register the screen in navigation types**

Current code (`mobile/App.tsx:94-113`, the `MoreStackParamList` type — locate the exact block by matching this content, line numbers are approximate):
```ts
  Settings: undefined;
  ScanSMS: undefined;
  SmsAutoRead: undefined;
  RescanPreview: { messages: { sender: string; message: string; receivedAt: string }[] };
  ImportStatement: undefined;
  InstitutionMappings: undefined;
  BillsInbox: undefined;
  SmsStatementsHub: undefined;
  NeedsReviewHub: undefined;
  PaymentMatchReviews: undefined;
};
```
Replace with:
```ts
  Settings: undefined;
  ScanSMS: undefined;
  SmsAutoRead: undefined;
  NotificationAutoRead: undefined;
  RescanPreview: { messages: { sender: string; message: string; receivedAt: string }[] };
  ImportStatement: undefined;
  InstitutionMappings: undefined;
  BillsInbox: undefined;
  SmsStatementsHub: undefined;
  NeedsReviewHub: undefined;
  PaymentMatchReviews: undefined;
};
```

- [ ] **Step 3: Add the import and screen registration**

Current code (`mobile/App.tsx`, the import block containing):
```ts
import SmsAutoReadScreen from './src/screens/SmsAutoReadScreen';
```
Add immediately after:
```ts
import SmsAutoReadScreen from './src/screens/SmsAutoReadScreen';
import NotificationAutoReadScreen from './src/screens/NotificationAutoReadScreen';
```

Current code (`mobile/App.tsx:209-213`):
```tsx
      <MoreStack.Screen
        name="SmsAutoRead"
        component={SmsAutoReadScreen}
        options={{ title: 'Auto-Read SMS' }}
      />
```
Add immediately after:
```tsx
      <MoreStack.Screen
        name="SmsAutoRead"
        component={SmsAutoReadScreen}
        options={{ title: 'Auto-Read SMS' }}
      />
      <MoreStack.Screen
        name="NotificationAutoRead"
        component={NotificationAutoReadScreen}
        options={{ title: 'Notification Bill Detection' }}
      />
```
(Only the `MoreStack` registration is added — unlike `SmsAutoRead`, this screen has no direct-from-Dashboard entry point in this plan, so no `RootStackParamList`/root-stack registration is needed. If a future feature wants a Dashboard nudge banner for this, that registration can be added then, mirroring the comment already at `App.tsx:126-129` explaining why `SmsAutoRead` has both.)

- [ ] **Step 4: Add the hub menu entry**

Current code (`mobile/src/screens/SmsStatementsHubScreen.tsx:20-42`):
```ts
const items: HubItem[] = [
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Auto-Read SMS',
    subtitle: 'Automatically log bank SMS as transactions',
    route: 'SmsAutoRead',
    color: '#16a34a',
  },
  {
    icon: 'scan-outline',
    title: 'Scan SMS',
    subtitle: 'Paste a bank SMS to add manually',
    route: 'ScanSMS',
    color: '#0ea5e9',
  },
  {
    icon: 'document-text-outline',
    title: 'Import Statement',
    subtitle: 'Import PDF bank statements',
    route: 'ImportStatement',
    color: '#0ea5e9',
  },
];
```
Replace with:
```ts
const items: HubItem[] = [
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Auto-Read SMS',
    subtitle: 'Automatically log bank SMS as transactions',
    route: 'SmsAutoRead',
    color: '#16a34a',
  },
  {
    icon: 'notifications-outline',
    title: 'Notification Bill Detection',
    subtitle: 'Catch bill reminders that only arrive as app notifications',
    route: 'NotificationAutoRead',
    color: '#16a34a',
  },
  {
    icon: 'scan-outline',
    title: 'Scan SMS',
    subtitle: 'Paste a bank SMS to add manually',
    route: 'ScanSMS',
    color: '#0ea5e9',
  },
  {
    icon: 'document-text-outline',
    title: 'Import Statement',
    subtitle: 'Import PDF bank statements',
    route: 'ImportStatement',
    color: '#0ea5e9',
  },
];
```

- [ ] **Step 5: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no new `error TS` occurrences vs. baseline.

- [ ] **Step 6: Verify by inspection**

No emulator/device in this environment — verify by code trace: confirm `NotificationAutoReadScreen`'s `Platform.OS !== 'android'` early return happens before any call to `isNotificationListenerEnabled` (which is meaningless off-Android); confirm `refreshStatus` is called both on mount (`useEffect`) and on focus (`useFocusEffect`), matching `SmsAutoReadScreen.tsx`'s own `refreshStatus` pattern exactly — this is required, not optional, since granting the OS permission happens outside the app entirely (in system Settings) and the screen has no other way to learn the grant happened; confirm the `MoreStackParamList` addition and the `MoreStack.Screen` `name` prop use the identical string `"NotificationAutoRead"`; confirm `SmsStatementsHubScreen.tsx`'s new item's `route: 'NotificationAutoRead'` also matches that exact string (a typo in any of these three locations compiles fine — `route` is typed as `keyof MoreStackParamList`, so an actual mismatch WOULD be caught by `tsc`, but a matching-but-wrong string like a copy-paste of a different existing route would not be).

- [ ] **Step 7: Commit**

```bash
cd mobile && git add src/screens/NotificationAutoReadScreen.tsx App.tsx src/screens/SmsStatementsHubScreen.tsx
git commit -m "feat: add notification bill detection consent screen and navigation"
```

---

### Task 7: Bills Inbox source badge

**Files:**
- Modify: `server/routes.ts` (`GET /api/bill-mappings/pending`, ~line 4313-4335)
- Modify: `mobile/src/lib/types.ts` (`PendingBillMapping`, ~line 39-52)
- Modify: `mobile/src/screens/BillsInboxScreen.tsx` (card render, ~line 132-135)

**Interfaces:**
- Consumes: `smsLogs.source` (Task 2).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Add `latestSource` to the enrichment**

Current code (`server/routes.ts:4313-4335`):
```ts
  app.get("/api/bill-mappings/pending", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappings = await storage.getPendingBillSenderMappings(userId);

      const enriched = await Promise.all(mappings.map(async (mapping) => {
        const logs = await storage.getSmsLogsForBillMapping(mapping.id);
        const latest = logs[0];
        const latestParsed = latest ? parseDueSms(latest.message) : null;
        return {
          ...mapping,
          latestAmount: latestParsed?.amount ?? null,
          latestDueDate: latestParsed?.dueDate ?? null,
          latestReceivedAt: latest?.receivedAt ?? null,
          latestMessage: latest?.message ?? null,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch pending bill mappings" });
    }
  });
```
Replace with:
```ts
  app.get("/api/bill-mappings/pending", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const mappings = await storage.getPendingBillSenderMappings(userId);

      const enriched = await Promise.all(mappings.map(async (mapping) => {
        const logs = await storage.getSmsLogsForBillMapping(mapping.id);
        const latest = logs[0];
        const latestParsed = latest ? parseDueSms(latest.message) : null;
        return {
          ...mapping,
          latestAmount: latestParsed?.amount ?? null,
          latestDueDate: latestParsed?.dueDate ?? null,
          latestReceivedAt: latest?.receivedAt ?? null,
          latestMessage: latest?.message ?? null,
          latestSource: latest?.source ?? 'sms',
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch pending bill mappings" });
    }
  });
```
(`getSmsLogsForBillMapping`, `server/storage.ts:1419-1423`, does `db.select().from(smsLogs)` with no column list — every column including the new `source` from Task 2 is already selected with no changes needed there.)

- [ ] **Step 2: Add `latestSource` to the type**

Current code (`mobile/src/lib/types.ts:39-52`):
```ts
export interface PendingBillMapping {
  id: number;
  userId: number;
  institutionKey: string;
  status: 'pending' | 'mapped' | 'ignored';
  scheduledPaymentId: number | null;
  suggestedName: string | null;
  lastSeenAt: string;
  createdAt: string;
  latestAmount: number | null;
  latestDueDate: string | null;
  latestReceivedAt: string | null;
  latestMessage: string | null;
}
```
Replace with:
```ts
export interface PendingBillMapping {
  id: number;
  userId: number;
  institutionKey: string;
  status: 'pending' | 'mapped' | 'ignored';
  scheduledPaymentId: number | null;
  suggestedName: string | null;
  lastSeenAt: string;
  createdAt: string;
  latestAmount: number | null;
  latestDueDate: string | null;
  latestReceivedAt: string | null;
  latestMessage: string | null;
  latestSource: 'sms' | 'notification';
}
```

- [ ] **Step 3: Show the badge**

Current code (`mobile/src/screens/BillsInboxScreen.tsx:132-135`):
```tsx
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {mapping.latestAmount != null ? formatCurrency(mapping.latestAmount) : 'Amount unknown'}
                {mapping.latestDueDate ? ` · Due ${format(new Date(mapping.latestDueDate), 'd MMM')}` : ''}
              </Text>
```
Replace with:
```tsx
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {mapping.latestAmount != null ? formatCurrency(mapping.latestAmount) : 'Amount unknown'}
                {mapping.latestDueDate ? ` · Due ${format(new Date(mapping.latestDueDate), 'd MMM')}` : ''}
                {mapping.latestSource === 'notification' ? ' · via notification' : ''}
              </Text>
```
(Matches this screen's existing convention of appending optional segments with a leading ` · ` — the SMS case is intentionally left with no visible tag at all, since SMS is the default/unremarkable case and every existing entry before this feature ships is SMS-sourced.)

- [ ] **Step 4: Type-check**

Run: `npm run check && cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: no new `error TS` occurrences vs. baseline in either.

- [ ] **Step 5: Verify by inspection**

No live database in this environment — verify by reading: confirm `latestSource` defaults to `'sms'` when `latest` is `undefined` (a mapping with zero linked `smsLogs` rows, an edge case that shouldn't occur in practice but the `?? 'sms'` guard handles it the same safe way `latestAmount`/`latestDueDate`/etc. already guard the same `undefined` case); confirm the badge text only appears for `'notification'`, never rendering an empty ` · ` fragment for the `'sms'` case (the ternary's else-branch is `''`, not a space-prefixed string).

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts mobile/src/lib/types.ts mobile/src/screens/BillsInboxScreen.tsx
git commit -m "feat: show notification-vs-SMS source badge in Bills Inbox"
```

---

## Post-plan note for the human running this

`npm run db:push` must be run against the real database before Task 2's `source` column has any effect — same as every other schema change in this project, this cannot be verified end-to-end in the sandboxed implementation environment. After that, the feature needs a real device test that no environment available during implementation can perform: grant notification access via the new screen, trigger a real bill-reminder-shaped notification, confirm it lands in Bills Inbox tagged "via notification." The plan's own Task 1 finding (the two example notifications from the spec would have been silently dropped without the `DUE_KEYWORDS` fix) is a reminder that this kind of gap is exactly what a real device test — not code review — will actually catch.
