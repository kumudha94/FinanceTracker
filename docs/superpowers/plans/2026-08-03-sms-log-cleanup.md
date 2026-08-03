# SMS Log Retention Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user manually preview and delete `sms_logs` rows older than 12 months from Settings, skipping any row still tied to an unresolved review-queue item.

**Architecture:** Two new authenticated backend endpoints (preview count, execute delete) sharing one condition-builder so the two can never disagree about what's "eligible." One new row in the mobile Settings screen driving both, following the screen's existing confirm-before-destructive pattern (same shape as "Delete Account").

**Tech Stack:** Express + Drizzle ORM (backend), React Native + `@tanstack/react-query`-free plain `fetch` wrapper via `apiRequest` (mobile, unchanged pattern).

## Global Constraints

- No new database table, no migration — this only deletes from the existing `sms_logs` table.
- Eligibility rule (identical for preview and delete): `receivedAt` older than 12 months, **and** not excluded by the pending-review check below.
- Pending-review exclusion: a row is excluded if `institutionMappingId` references a `sender_institution_mappings` row with `status = 'pending'`, or `billMappingId` references a `bill_sender_mappings` row with `status = 'pending'`.
- Manual trigger only — no cron, no scheduled job, no background execution.
- Straight `DELETE`, no archiving step.
- Every query scoped to the authenticated user (`sms_logs.userId = req.user.userId`) — rows with `userId IS NULL` are never touched by either endpoint.
- No automated test suite exists for this app (server or mobile) — verification is `npm run check` (root, for backend changes) and `cd mobile && npx tsc --noEmit` (for mobile changes). Current baselines, independently confirmed immediately before this plan was written: **14** pre-existing `error TS` occurrences at the repo root, **31** pre-existing `error TS` occurrences in `mobile/`. Every task's bar is no new errors against the relevant baseline, not zero.

---

### Task 1: Backend — cleanup-preview and cleanup endpoints

**Files:**
- Modify: `server/storage.ts:37` (drizzle-orm import — add `lt`)
- Modify: `server/storage.ts:120-138` (add two new method signatures to the `IStorage` interface, near the existing `smsLogs`-related entries)
- Modify: `server/storage.ts:1304-1308` (add two new method implementations, right after `getSmsLogsForBillMapping`)
- Modify: `server/routes.ts:3739-3775` (add two new route handlers, right after the `/api/parse-sms-batch` handler closes, before the `// ========== Institution Mapping Review ==========` comment)

**Interfaces:**
- Consumes: `smsLogs`, `senderInstitutionMappings`, `billSenderMappings` tables (already imported in `server/storage.ts`); `eq`, `and`, `sql` (already imported from `drizzle-orm`); `authenticateToken` middleware, `storage` singleton (already imported in `server/routes.ts`).
- Produces (used by Task 2): `GET /api/sms-logs/cleanup-preview` → `{ count: number; oldestReceivedAt: string | null; newestReceivedAt: string | null }`. `POST /api/sms-logs/cleanup` → `{ deletedCount: number }`.

- [ ] **Step 1: Add `lt` to the drizzle-orm import**

Current line 37 in `server/storage.ts`:
```ts
import { eq, and, gte, lte, desc, sql, ilike, or } from "drizzle-orm";
```
Change to:
```ts
import { eq, and, gte, lte, lt, desc, sql, ilike, or } from "drizzle-orm";
```

- [ ] **Step 2: Add the two method signatures to `IStorage`**

Current lines 120-121 in `server/storage.ts`:
```ts
  createSmsLog(smsLog: InsertSmsLog): Promise<SmsLog>;
  updateSmsLogTransaction(id: number, transactionId: number): Promise<SmsLog | undefined>;
```
Add two new lines immediately after:
```ts
  createSmsLog(smsLog: InsertSmsLog): Promise<SmsLog>;
  updateSmsLogTransaction(id: number, transactionId: number): Promise<SmsLog | undefined>;
  getSmsLogsCleanupPreview(userId: number): Promise<{ count: number; oldestReceivedAt: Date | null; newestReceivedAt: Date | null }>;
  deleteEligibleSmsLogs(userId: number): Promise<number>;
```

- [ ] **Step 3: Implement the shared eligibility condition and the two methods**

Current code at `server/storage.ts:1304-1308` (the end of the `DatabaseStorage` class's sms-log-related methods):
```ts
  async getSmsLogsForBillMapping(billMappingId: number): Promise<SmsLog[]> {
    return db.select().from(smsLogs)
      .where(eq(smsLogs.billMappingId, billMappingId))
      .orderBy(desc(smsLogs.receivedAt));
  }
```
Add the following directly after it (still inside the `DatabaseStorage` class body):
```ts
  async getSmsLogsForBillMapping(billMappingId: number): Promise<SmsLog[]> {
    return db.select().from(smsLogs)
      .where(eq(smsLogs.billMappingId, billMappingId))
      .orderBy(desc(smsLogs.receivedAt));
  }

  // Shared by getSmsLogsCleanupPreview and deleteEligibleSmsLogs so the two can never
  // disagree about which rows are "eligible" — same age cutoff, same pending-review
  // exclusion, computed exactly once.
  private eligibleSmsLogsCondition(userId: number) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    return and(
      eq(smsLogs.userId, userId),
      lt(smsLogs.receivedAt, cutoff),
      sql`(${smsLogs.institutionMappingId} IS NULL OR NOT EXISTS (
        SELECT 1 FROM ${senderInstitutionMappings}
        WHERE ${senderInstitutionMappings.id} = ${smsLogs.institutionMappingId}
        AND ${senderInstitutionMappings.status} = 'pending'
      ))`,
      sql`(${smsLogs.billMappingId} IS NULL OR NOT EXISTS (
        SELECT 1 FROM ${billSenderMappings}
        WHERE ${billSenderMappings.id} = ${smsLogs.billMappingId}
        AND ${billSenderMappings.status} = 'pending'
      ))`
    );
  }

  async getSmsLogsCleanupPreview(userId: number): Promise<{ count: number; oldestReceivedAt: Date | null; newestReceivedAt: Date | null }> {
    const [result] = await db.select({
      count: sql<number>`count(*)`,
      oldest: sql<Date | null>`min(${smsLogs.receivedAt})`,
      newest: sql<Date | null>`max(${smsLogs.receivedAt})`,
    }).from(smsLogs).where(this.eligibleSmsLogsCondition(userId));

    return {
      count: Number(result?.count || 0),
      oldestReceivedAt: result?.oldest ?? null,
      newestReceivedAt: result?.newest ?? null,
    };
  }

  async deleteEligibleSmsLogs(userId: number): Promise<number> {
    const deleted = await db.delete(smsLogs)
      .where(this.eligibleSmsLogsCondition(userId))
      .returning({ id: smsLogs.id });
    return deleted.length;
  }
```
`senderInstitutionMappings` and `billSenderMappings` are already imported at the top of `server/storage.ts` (line 4) — no new import needed for them.

- [ ] **Step 4: Add the two route handlers**

Current code at `server/routes.ts:3739-3776` (end of `/api/parse-sms-batch`, start of the next section):
```ts
      const successful = results.filter(r => r.success).length;
      res.json({ 
        total: messages.length,
        successful,
        failed: messages.length - successful,
        results 
      });
    } catch (error: any) {
      console.error("Batch SMS parsing error:", error.message);
      res.status(500).json({ error: error.message || "Failed to parse batch SMS" });
    }
  });

  // ========== Institution Mapping Review ==========
```
Insert the two new routes between the closing `});` of `/api/parse-sms-batch` and the `// ========== Institution Mapping Review ==========` comment:
```ts
      const successful = results.filter(r => r.success).length;
      res.json({ 
        total: messages.length,
        successful,
        failed: messages.length - successful,
        results 
      });
    } catch (error: any) {
      console.error("Batch SMS parsing error:", error.message);
      res.status(500).json({ error: error.message || "Failed to parse batch SMS" });
    }
  });

  // ========== SMS Log Retention Cleanup ==========
  app.get("/api/sms-logs/cleanup-preview", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const preview = await storage.getSmsLogsCleanupPreview(userId);
      res.json(preview);
    } catch (error) {
      console.error("Error fetching sms logs cleanup preview:", error);
      res.status(500).json({ error: "Failed to fetch cleanup preview" });
    }
  });

  app.post("/api/sms-logs/cleanup", authenticateToken, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const deletedCount = await storage.deleteEligibleSmsLogs(userId);
      res.json({ deletedCount });
    } catch (error) {
      console.error("Error cleaning up sms logs:", error);
      res.status(500).json({ error: "Failed to clean up sms logs" });
    }
  });

  // ========== Institution Mapping Review ==========
```

- [ ] **Step 5: Type-check**

Run: `npm run check 2>&1 | grep -c "error TS"` (from the repo root)
Expected: exactly **14**, matching the pre-existing baseline. No new errors.

- [ ] **Step 6: Verify by reading, not by running the server**

There's no way to exercise these endpoints against the real Neon database in this environment. Verify by inspection: confirm `eligibleSmsLogsCondition` is called identically (same `userId`, no extra arguments) from both `getSmsLogsCleanupPreview` and `deleteEligibleSmsLogs` — this is what guarantees preview and delete never disagree. Confirm the two new routes both use `authenticateToken` and read `req.user!.userId`, matching every other authenticated route in this file (e.g. the `/api/accounts` handlers).

- [ ] **Step 7: Commit**

```bash
git add server/storage.ts server/routes.ts
git commit -m "feat: add SMS log cleanup preview and delete endpoints"
```

---

### Task 2: Mobile — Settings screen cleanup action

**Files:**
- Modify: `mobile/src/lib/api.ts:754-756` (add two new `api.*` functions, right after `deleteUserAccount`)
- Modify: `mobile/src/screens/SettingsScreen.tsx:16` (component state — add `isCleaningUpSmsLogs`)
- Modify: `mobile/src/screens/SettingsScreen.tsx` (add a `handleSmsLogCleanup` function, add a new row in the "Danger Zone" section before "Delete Account", add a loading modal)

**Interfaces:**
- Consumes: `api.getSmsLogsCleanupPreview()` and `api.cleanupSmsLogs()` (produced by Task 1's endpoints); existing `colors`, `styles.settingRowButton`/`settingInfo`/`settingTitle`/`settingSubtitle`/`loadingOverlay`/`loadingContent`/`loadingText` (already defined in this file, used by the neighboring "Delete Account" row and its loading modal).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Add the two API functions**

Current code at `mobile/src/lib/api.ts:754-756`:
```ts
  deleteUserAccount: () => 
    apiRequest<{ message: string }>('/api/users/delete-account', { method: 'DELETE' }),
};
```
Change to:
```ts
  deleteUserAccount: () => 
    apiRequest<{ message: string }>('/api/users/delete-account', { method: 'DELETE' }),
  getSmsLogsCleanupPreview: () =>
    apiRequest<{ count: number; oldestReceivedAt: string | null; newestReceivedAt: string | null }>('/api/sms-logs/cleanup-preview'),
  cleanupSmsLogs: () =>
    apiRequest<{ deletedCount: number }>('/api/sms-logs/cleanup', { method: 'POST' }),
};
```

- [ ] **Step 2: Add `isCleaningUpSmsLogs` state**

Current line 16 in `mobile/src/screens/SettingsScreen.tsx`:
```ts
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
```
Add immediately after:
```ts
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isCleaningUpSmsLogs, setIsCleaningUpSmsLogs] = useState(false);
```

- [ ] **Step 3: Add the `handleSmsLogCleanup` function**

Place this near `toggleBiometric` (defined earlier in this file, around line 152) — anywhere in the component body before the `return (` is fine, since it's a plain function, not a hook:
```ts
  const handleSmsLogCleanup = async () => {
    try {
      const preview = await api.getSmsLogsCleanupPreview();
      if (preview.count === 0) {
        Alert.alert('Nothing to Clean Up', 'No SMS logs older than 12 months found.');
        return;
      }
      Alert.alert(
        'Clean Up Old SMS Logs',
        `${preview.count} SMS log${preview.count === 1 ? '' : 's'} older than 12 months will be permanently deleted. This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setIsCleaningUpSmsLogs(true);
              try {
                const result = await api.cleanupSmsLogs();
                setIsCleaningUpSmsLogs(false);
                Alert.alert('Done', `${result.deletedCount} SMS log${result.deletedCount === 1 ? '' : 's'} deleted.`);
              } catch (error: any) {
                setIsCleaningUpSmsLogs(false);
                Alert.alert('Error', error.message || 'Failed to clean up SMS logs. Please try again.');
              }
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to check SMS logs. Please try again.');
    }
  };
```

- [ ] **Step 4: Add the row to the "Danger Zone" section**

Current code at `mobile/src/screens/SettingsScreen.tsx:435-489` (the "Danger Zone" section, containing only "Delete Account"):
```tsx
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Danger Zone</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity 
          style={styles.settingRowButton}
          onPress={() => {
            Alert.alert(
              'Delete Account',
```
Insert a new row before the "Delete Account" `TouchableOpacity` (so it reads top-to-bottom as "smaller destructive action, then the big one"):
```tsx
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Danger Zone</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={styles.settingRowButton}
          onPress={handleSmsLogCleanup}
          disabled={isCleaningUpSmsLogs}
        >
          <View style={styles.settingInfo}>
            <Ionicons name="trash-outline" size={22} color={colors.warning} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Clean Up SMS Logs</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Delete SMS logs older than 12 months</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.settingRowButton}
          onPress={() => {
            Alert.alert(
              'Delete Account',
```
(The rest of the "Delete Account" block — everything from `'This will permanently delete your account...'` through its closing `</TouchableOpacity>` and the section's closing `</View>` — is unchanged.)

- [ ] **Step 5: Add the loading modal**

Current code at `mobile/src/screens/SettingsScreen.tsx:531-539`:
```tsx
      <Modal visible={isDeletingAccount} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContent, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>Deleting account...</Text>
            <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>Please wait while we remove all your data</Text>
          </View>
        </View>
      </Modal>
```
Add a second modal directly after it:
```tsx
      <Modal visible={isDeletingAccount} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContent, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>Deleting account...</Text>
            <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>Please wait while we remove all your data</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={isCleaningUpSmsLogs} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContent, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>Cleaning up SMS logs...</Text>
          </View>
        </View>
      </Modal>
```

- [ ] **Step 6: Type-check**

Run: `cd mobile && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: exactly **31**, matching the pre-existing baseline.

- [ ] **Step 7: Manual verification**

No device/simulator available — verify by code trace: confirm `handleSmsLogCleanup` never calls `api.cleanupSmsLogs()` without the user tapping "Delete" in the confirm alert; confirm the `count === 0` path shows an informational alert and returns before ever showing the destructive confirm; confirm `isCleaningUpSmsLogs` is set back to `false` in both the success and error branches of the inner `onPress` (no stuck loading modal on failure).

- [ ] **Step 8: Commit**

```bash
cd mobile && git add src/lib/api.ts src/screens/SettingsScreen.tsx
git commit -m "feat: add SMS log cleanup action to Settings"
```
