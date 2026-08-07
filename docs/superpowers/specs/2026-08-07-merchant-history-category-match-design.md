# Merchant-history category matching for SMS auto-read

TODO context: SMS auto-read categorizes new transactions via `suggestCategory`
(`server/openai.ts`) — OpenAI → Anthropic → keyword fallback — on every
transaction, including repeat merchants the user has already categorized
themselves. Idea: before calling `suggestCategory`, check whether this user
has a prior transaction from the same merchant (same debit/credit type) that
already carries a real category (not "Other"), and reuse it. Cuts AI calls
for repeat merchants and respects the user's own past categorization choices
over a generic AI guess.

Confirmed via discussion:
- Applies to **both** places that call `suggestCategory` today: the live SMS
  auto-read path (`finishWithTransaction` inside `processSingleSms`,
  `server/routes.ts:3846-3863`) and the SMS rescan path
  (`server/routes.ts:4126-4154`).
- Match is scoped to the **same transaction type** (debit only matches prior
  debits, credit only prior credits) — prevents a refund/credit inheriting a
  purchase-only category from the same merchant, or vice versa.
- Merchant match is **exact, normalized** (trim + lowercase), no fuzziness —
  same convention already used by the existing manual merchant-match feature
  (`mobile/src/screens/AddTransactionScreen.tsx:130-139`).
- "Most recently updated" tie-break (when multiple prior transactions from
  the same merchant carry different non-"Other" categories) requires a new
  `updatedAt` column on `transactions` — the table doesn't have one today,
  unlike most other tables in this schema.

## Scope

Backend only (`server/`). No mobile changes. One schema migration.

## Schema change

`shared/schema.ts`, `transactions` table: add `updatedAt: timestamp('updated_at').notNull().defaultNow()`, alongside the existing `createdAt`. New Drizzle migration to add the column (defaulting existing rows to `now()` is acceptable — there's no way to reconstruct a true historical "last category edit time" for rows that predate this column, and this only affects the tie-break among multiple *pre-existing* categorized transactions from the same merchant, not correctness of the match itself).

**Where `updatedAt` gets set going forward:** both places that mutate a
transaction's fields must explicitly set `updatedAt: new Date()` in their
`db.update(...).set({...})` call:
- `storage.updateTransaction` (the general single-transaction edit path).
- `storage.bulkUpdateTransactionCategory` (`server/storage.ts:757-767`, backing the existing merchant-match "apply to all" bulk action).

A transaction's `updatedAt` is a plain "last touched" timestamp (any field,
not category-specific) — simpler and more conventional than tracking
category-only edit time, and in practice the two rarely diverge since edits
to a transaction happen close together in time regardless of which field
changed.

## New storage method

`server/storage.ts`, new method:

```ts
async getCategoryIdByMerchant(userId: number, merchant: string, type: 'debit' | 'credit'): Promise<number | null>
```

- Looks up the "Other" category's id once via the existing `getCategoryByName("Other")`.
- Queries `transactions` where `userId` matches, `type` matches, `categoryId`
  is not null and not equal to the "Other" id, and `merchant` matches
  case-insensitively via `ilike(transactions.merchant, merchant)` (no `%`
  wildcards — `ilike` without wildcards is an exact case-insensitive
  comparison in Postgres, and this codebase already uses `ilike` for a
  merchant search filter at `server/storage.ts:597`, so this reuses an
  established pattern rather than introducing a new comparison style).
  Trim `merchant` before passing it in, matching the mobile client's own
  normalization convention.
- Orders by `updatedAt` descending, `limit(1)`.
- Returns the first result's `categoryId`, or `null` if no rows match.

## New orchestration helper

`server/routes.ts`, a new local helper placed near the existing
`matchAccountBySender` (`server/routes.ts:3555-3600+`) — that function is
the closest existing analog (normalize → filter → pick-best-candidate), and
this file already colocates this kind of "smart matching" glue:

```ts
async function resolveCategoryForMerchant(
  userId: number,
  merchant: string | undefined,
  description: string | undefined,
  type: 'debit' | 'credit',
): Promise<Category | null>
```

- If `merchant` is present, calls `storage.getCategoryIdByMerchant(userId, merchant, type)`.
- If that returns an id, loads and returns the full `Category` (callers need
  the object, not just the id, matching what `suggestCategory` already
  returns).
- If no merchant, no match, or the lookup throws for any reason, returns
  `null` — callers treat `null` exactly like "no match found" and fall
  through to the existing `suggestCategory(merchant || description)` call
  unchanged. A failure in this new step must never block categorization
  falling back to the existing behavior.

## Call site changes

Both `finishWithTransaction` (`server/routes.ts:3846-3863`) and the rescan
path (`server/routes.ts:4126-4154`) change their category-resolution step
from:

```ts
const category = await suggestCategory(parsedData.merchant || parsedData.description || "");
```

to:

```ts
const category =
  (await resolveCategoryForMerchant(userId, parsedData.merchant, parsedData.description, parsedData.type))
  ?? (await suggestCategory(parsedData.merchant || parsedData.description || ""));
```

(`parsedData.type` — confirm the exact field name/shape at each call site
during implementation; both paths already have the parsed transaction's
debit/credit type available, since they set `transactionData.type` from it.)
No other logic in either function changes — the existing `if (category) { transactionData.categoryId = category.id; }` guard after this line is untouched.

## Out of scope

- No changes to the manual "Add Transaction" flow or its own merchant-match
  confirmation modal — this feature is about automatic categorization at
  SMS-parse time, not the existing reactive/manual flow.
- No fuzzy/partial merchant matching.
- No backfill of `updatedAt` beyond the migration's default — existing rows
  simply get "now" as their initial value.
- No change to `suggestCategory`'s own internal OpenAI → Anthropic → keyword
  fallback chain — this feature only decides whether that function gets
  called at all for a given transaction.

## Testing

No automated test suite exists for this app's server code in the
conventional sense used elsewhere in this project's specs — though note
`server/__tests__/smsParser.test.ts` exists in the working tree as of this
writing (from unrelated concurrent work); if a test runner is actually
wired up by the time this is implemented, add cases there for
`getCategoryIdByMerchant` and `resolveCategoryForMerchant` covering: a
matching prior transaction of the same type returns its category; a prior
transaction of the *opposite* type is ignored; a prior transaction
categorized as "Other" is ignored; multiple matches pick the one with the
latest `updatedAt`; no prior transactions falls through to `null` (verified
by the caller then invoking `suggestCategory` as before). Otherwise,
verification is `npm run check` (no new TS errors vs. baseline) plus manual
trace: confirm a second SMS from an already-categorized merchant reuses that
category without hitting OpenAI/Anthropic; confirm type-crossing is
prevented; confirm a brand-new merchant still falls through to AI
suggestion unchanged.
