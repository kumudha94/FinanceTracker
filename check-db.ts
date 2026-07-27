import 'dotenv/config';
import { db } from './server/db';
import { users, accounts } from './shared/schema';

async function main() {
  const userList = await db.select({ id: users.id, email: users.email }).from(users).limit(5);
  console.log('Users:', JSON.stringify(userList));
  const acctList = await db.select({ id: accounts.id, userId: accounts.userId, name: accounts.name }).from(accounts).limit(5);
  console.log('Accounts:', JSON.stringify(acctList));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
