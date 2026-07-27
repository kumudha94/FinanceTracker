import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';

// Deletes a single user and every row that belongs to them, in FK-safe order,
// inside one transaction (all-or-nothing — no partial deletes like before).
const USER_ID = 7;

// WHERE clause each table needs to find rows still belonging to USER_ID.
// Tables with a direct user_id column are scoped by it; dependent tables are
// scoped through their parent's user_id via a subquery.
const REMAINING_ROWS_WHERE: Record<string, string> = {
  loan_payments: `loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`,
  loan_installments: `loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`,
  loan_components: `loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`,
  loan_terms: `loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`,
  loan_bt_allocations: `source_loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID}) OR target_loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`,
  loans: `user_id = ${USER_ID}`,
  insurance_premiums: `insurance_id IN (SELECT id FROM insurances WHERE user_id = ${USER_ID})`,
  insurances: `user_id = ${USER_ID}`,
  card_details: `account_id IN (SELECT id FROM accounts WHERE user_id = ${USER_ID})`,
  credit_card_statements: `account_id IN (SELECT id FROM accounts WHERE user_id = ${USER_ID})`,
  payment_occurrences: `scheduled_payment_id IN (SELECT id FROM scheduled_payments WHERE user_id = ${USER_ID})`,
  scheduled_payments: `user_id = ${USER_ID}`,
  savings_contributions: `savings_goal_id IN (SELECT id FROM savings_goals WHERE user_id = ${USER_ID})`,
  savings_goals: `user_id = ${USER_ID}`,
  salary_cycles: `salary_profile_id IN (SELECT id FROM salary_profiles WHERE user_id = ${USER_ID})`,
  salary_profiles: `user_id = ${USER_ID}`,
  sms_logs: `user_id = ${USER_ID} OR transaction_id IN (SELECT id FROM transactions WHERE user_id = ${USER_ID})`,
  budgets: `user_id = ${USER_ID}`,
  transactions: `user_id = ${USER_ID}`,
  accounts: `user_id = ${USER_ID}`,
  users: `id = ${USER_ID}`,
};

async function countRemaining() {
  const counts: Record<string, number> = {};
  for (const [table, where] of Object.entries(REMAINING_ROWS_WHERE)) {
    const result = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`));
    counts[table] = (result.rows[0] as any).count;
  }
  return counts;
}

async function main() {
  console.log(`Deleting all data for user_id=${USER_ID} ...\n`);

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM loan_payments WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM loan_installments WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM loan_components WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM loan_terms WHERE loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM loan_bt_allocations WHERE source_loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID}) OR target_loan_id IN (SELECT id FROM loans WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM loans WHERE user_id = ${USER_ID}`);

    await tx.execute(sql`DELETE FROM insurance_premiums WHERE insurance_id IN (SELECT id FROM insurances WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM insurances WHERE user_id = ${USER_ID}`);

    await tx.execute(sql`DELETE FROM card_details WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM credit_card_statements WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ${USER_ID})`);

    await tx.execute(sql`DELETE FROM payment_occurrences WHERE scheduled_payment_id IN (SELECT id FROM scheduled_payments WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM scheduled_payments WHERE user_id = ${USER_ID}`);

    await tx.execute(sql`DELETE FROM savings_contributions WHERE savings_goal_id IN (SELECT id FROM savings_goals WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM savings_goals WHERE user_id = ${USER_ID}`);

    await tx.execute(sql`DELETE FROM salary_cycles WHERE salary_profile_id IN (SELECT id FROM salary_profiles WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM salary_profiles WHERE user_id = ${USER_ID}`);

    // Also catches sms_logs rows with a NULL user_id (auto-parsed SMS never set it)
    // whose transaction_id still points at a transaction owned by this user.
    await tx.execute(sql`DELETE FROM sms_logs WHERE user_id = ${USER_ID} OR transaction_id IN (SELECT id FROM transactions WHERE user_id = ${USER_ID})`);
    await tx.execute(sql`DELETE FROM budgets WHERE user_id = ${USER_ID}`);
    await tx.execute(sql`DELETE FROM transactions WHERE user_id = ${USER_ID}`);
    await tx.execute(sql`DELETE FROM accounts WHERE user_id = ${USER_ID}`);
    await tx.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
  });

  console.log('Transaction committed. Verifying...\n');

  const after = await countRemaining();
  const leftover = Object.entries(after).filter(([, c]) => c > 0);

  if (leftover.length === 0) {
    console.log(`Done. User ${USER_ID} and all owned data deleted — verified zero rows remaining.`);
  } else {
    console.error('WARNING: rows still remain after delete:', leftover);
    process.exitCode = 1;
  }
}

try {
  await main();
  process.exit(process.exitCode ?? 0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
