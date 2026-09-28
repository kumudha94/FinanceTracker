# Android Home-Screen Widgets — Design

**Date:** 2026-09-18
**Status:** Approved, ready for planning
**Scope:** Phase 1 of a multi-phase rollout. Later phases (not covered here) add Budget progress, Upcoming bills/EMIs, and Credit card usage widgets, reusing the infrastructure built in this phase.

## Context

FinanceTracker's Expo React Native mobile app (Expo SDK 50, RN 0.73.6) already has two native Android features built as hand-rolled Expo modules + config plugins: `mobile/modules/notification-listener-bridge` (native module) and `mobile/plugins/withNotificationListener.js` / `withSmsReceiver.js` (config plugins that inject `AndroidManifest.xml` entries). This project follows that same established pattern to add OS home-screen widgets — Android only; iOS was explicitly descoped.

Auth tokens (`accessToken`, `refreshToken`) currently live only in `AsyncStorage` (`mobile/src/lib/api.ts`), which is a JS-only storage layer not readable by native widget code running in a separate process/context.

## Goals

- Two home-screen widgets in phase 1: **Balance summary** and **Recent transactions**.
- Widgets fetch live data directly from the Cloud Run API on a periodic background schedule — not a snapshot of whatever the app last cached.
- Reliable background refresh under Android's battery/doze restrictions (no reliance on the RN JS engine being alive).
- Tapping a widget deep-links into the relevant app screen.
- Shared infrastructure (auth bridging, refresh scheduling, config plugin pattern) built so phases 2+ (Budget progress, Upcoming bills/EMIs, Credit card usage) can add new `GlanceAppWidget`s without re-solving auth/refresh.

## Non-goals (phase 1)

- iOS widgets (WidgetKit/SwiftUI) — separate toolchain, not attempted.
- Budget progress, Upcoming bills/EMIs, Credit card usage widgets — phase 2+.
- Multiple widget sizes/configurable layouts — one fixed size per widget for now.
- Per-account balance breakdown — total balance only.

## Architecture

**New Expo module:** `mobile/modules/widget-bridge/` (mirrors `notification-listener-bridge`'s structure: `expo-module.config.json`, `android/build.gradle`, `android/src/main/java/...`, `index.ts`).

- Exposes `syncWidgetAuth(accessToken: string, refreshToken: string): Promise<void>` and `clearWidgetAuth(): Promise<void>`.
- `mobile/src/lib/api.ts` calls `syncWidgetAuth()` immediately after `storeTokens()`/`storeToken()`/any successful refresh, and `clearWidgetAuth()` on logout — so native widget code always has a current token without polling JS state.
- Native side writes both tokens into Android `EncryptedSharedPreferences` (not `AsyncStorage`, which lives in a SQLite DB tied to the RN JS/bridge process and isn't reliably readable from a widget's `WorkManager` job).

**New Kotlin package:** `com.mytracker.widgets` (inside `mobile/android/app/src/main/java/com/mytracker/`):

- `BalanceWidget` and `RecentTransactionsWidget` — both `GlanceAppWidget` (Jetpack Glance, not legacy `RemoteViews` XML — Glance is the current recommended Android API for widgets and composes similarly to the rest of modern Android UI code).
- `WidgetRepository` — shared class, one `OkHttp` client, calls `GET /api/accounts` and `GET /api/transactions?limit=4` against the Cloud Run backend using the Bearer token from `EncryptedSharedPreferences`.
- On a 401, `WidgetRepository` POSTs `/api/auth/refresh-token` with the stored refresh token, writes the new access token back to prefs, and retries the original request once — mirroring the existing retry logic in `api.ts`'s `apiRequest()`. If refresh also fails (refresh token invalid/expired — user logged out elsewhere), the widget renders its auth-failure state instead of throwing.
- `WidgetUpdateWorker` (`WorkManager` `CoroutineWorker`) — runs both widgets' data refresh on a periodic 30-minute schedule (Android's OS-enforced floor for widget updates; requesting anything shorter is silently clamped by the platform anyway). Scheduled via `PeriodicWorkRequest`, enqueued once (idempotently, `ExistingPeriodicWorkPolicy.KEEP`) when either widget is first added to a home screen (`onUpdate`/`onEnabled` in each `GlanceAppWidgetReceiver`).

**New config plugin:** `mobile/plugins/withWidgets.js` — follows `withNotificationListener.js`'s pattern exactly: `withAndroidManifest` to register both `AppWidgetProvider`/`GlanceAppWidgetReceiver` entries with their `<meta-data android:name="android.appwidget.provider">` pointing at generated `xml/balance_widget_info.xml` / `xml/recent_transactions_widget_info.xml` resource files (widget size, min size, update period metadata — the last one is advisory only since `WorkManager` drives actual refresh).

**Deep linking:** `app.json` currently has no `scheme`. This phase adds `"scheme": "mytracker"` plus a minimal `Linking` config in the RN app so:
- Balance widget tap → opens app at the Dashboard (`mytracker://dashboard`, or just the default route — no widget-specific screen needed).
- Each transaction row tap → `mytracker://transaction/:id`, opening that transaction's detail screen.
- If the user isn't logged in, the app's existing auth-gate/redirect-to-login behavior applies unchanged — the deep link just lands on whatever screen the app already shows an unauthenticated user.

## Data & content

**Balance widget** (small size, 2x1 or 2x2 cells):
- Fetches `GET /api/accounts`, sums each account's `balance` field the same way the existing dashboard total is computed.
- Displays: total balance (large), "Last updated Xm/h ago" (small, muted).
- If data is older than 2 hours (e.g. device was offline or in deep doze), the widget does not silently show stale numbers as if current — the "last updated" line becomes the primary visible signal instead of being deprioritized.

**Recent transactions widget** (medium size, 4x2 cells):
- Fetches `GET /api/transactions?limit=4`.
- Displays up to 4 rows: merchant name, amount (green for credit, red for debit — matching existing app color convention), relative date.
- Empty state (`accounts.length === 0` or `transactions.length === 0`): "Add an account in the app" / "No transactions yet" with a tap target that opens the app.

**Shared error/auth-failure state** (both widgets): if the initial request 401s and the refresh-token retry also fails, render "Open app to sign in" — tapping opens the app directly (deep link lands wherever the app's own auth gate sends an unauthenticated user).

## Testing

No Android emulator is available in this dev environment (consistent with prior native-Android work on this project — see notification-listener-bridge). The following is locally verifiable without a device:

- `./gradlew assembleDebug` compiles cleanly (Kotlin + Glance + WorkManager wiring).
- `npx expo prebuild --platform android` regenerates the manifest with both widget receivers correctly registered by `withWidgets.js`.
- `syncWidgetAuth`/`clearWidgetAuth` JS-side call sites in `api.ts` are covered by existing test patterns for that file, if any exist.

The following is **deferred to the user, on a real device**, same as prior native-Android features in this project:
- Add both widgets to a home screen; confirm real data loads within one `WorkManager` cycle.
- Force-kill the app entirely; confirm widgets still refresh on schedule (validates the "no JS engine needed" design goal).
- Log out of the app; confirm both widgets transition to the auth-failure state within one refresh cycle, and tapping opens the app to login.
- Tap a transaction row; confirm it deep-links to the correct transaction detail screen.
- Leave the device offline for 2+ hours; confirm the "last updated" state appears instead of stale data looking current.

## Phase 2+ (not built now, noted for future spec-writing)

Once this infrastructure lands, adding Budget progress, Upcoming bills/EMIs, and Credit card usage widgets should each be a new `GlanceAppWidget` + `WidgetRepository` method + manifest entry via `withWidgets.js` — no new auth/refresh/deep-link plumbing needed. Each should still get its own short design pass for its specific data shape and empty/error states before implementation.

## Phase 1.1 — Visual redesign (2026-09-28)

On-device feedback: the phase 1 widgets were unstyled text drawn straight on the wallpaper, rows showed a literal `null` merchant, text clipped at the left edge, and the balance total was wrong.

- **Balance widget → "Bank balance" (3x2):** lists each active `type = 'bank'` account with its balance, then a divider and the **Total**. Debit cards (cards on the same banks) and credit cards (outstanding, not money held) are excluded from both list and total — the old widget summed every active account (≈₹11.7L vs ≈₹1.29L real). Zero-balance bank accounts are hidden from the list. Negative balances render red.
- **Recent transactions:** header with "Updated …", each row has a ↓/↑ badge (green credit / red debit), merchant (1 line, ellipsized), relative date ("Today · 2:15 PM" / "Yesterday" / "12 Sep"), right-aligned signed amount, dividers between rows.
- **Merchant fallback fix:** `org.json`'s `optString` returns the string `"null"` for JSON null, so it never fell back to `description`. Now merchant → description → "Transaction".
- **Shared styling (`WidgetUi.kt`):** rounded card, app palette from `mobile/src/lib/utils.ts`, day/night via Glance `ColorProvider(day, night)`. Staleness (>2h) now turns the header's "Last updated" red/bold.
- **Widget picker:** receivers get `android:label` and the info XMLs a `android:description` string resource.

## Phase 1.2 — Credit cards and Top spending widgets (2026-09-28)

Mirrors the Dashboard's "Credit Cards" and "Top Spending" cards. Both widgets read one shared `GET /api/dashboard-summary` fetch (`KEY_SPENDING_*` prefs), so they always agree with the Dashboard:

- **Credit cards (4x2):** per active card, spend in the current billing cycle vs `monthlySpendingLimit`, with a progress bar (amber ≥80%, red ≥100%); "no limit set" when there's no limit.
- **Top spending (4x2):** top 5 debit categories for the current salary cycle, with category-coloured dot, amount, share %, bar, and "Spent this cycle" total.

Verified on the Android emulator (Pixel, API 36) in light and dark mode against live data.
