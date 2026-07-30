import { 
  users, accounts, categories, transactions, budgets, scheduledPayments, smsLogs,
  paymentOccurrences, savingsGoals, savingsContributions, salaryProfiles, salaryCycles,
  loans, loanComponents, loanInstallments, loanSpendingEntries, loanTerms, loanPayments, loanBtAllocations, cardDetails,
  insurances, insurancePremiums, creditCardStatements, senderInstitutionMappings, billSenderMappings,
  forecastExclusions,
  type User, type InsertUser,
  type Account, type InsertAccount,
  type Category, type InsertCategory,
  type Transaction, type InsertTransaction, type TransactionWithRelations,
  type Budget, type InsertBudget,
  type ScheduledPayment, type InsertScheduledPayment,
  type PaymentOccurrence, type InsertPaymentOccurrence,
  type SavingsGoal, type InsertSavingsGoal,
  type SavingsContribution, type InsertSavingsContribution,
  type SalaryProfile, type InsertSalaryProfile,
  type SalaryCycle, type InsertSalaryCycle,
  type Loan, type InsertLoan, type LoanWithRelations,
  type LoanComponent, type InsertLoanComponent,
  type LoanInstallment, type InsertLoanInstallment,
  type LoanSpendingEntry, type InsertLoanSpendingEntry,
  type LoanTerm, type InsertLoanTerm,
  type LoanPayment, type InsertLoanPayment,
  type LoanBtAllocation, type InsertLoanBtAllocation,
  type CardDetails, type InsertCardDetails,
  type Insurance, type InsertInsurance, type InsuranceWithRelations,
  type InsurancePremium, type InsertInsurancePremium,
  type CreditCardStatement, type InsertCreditCardStatement,
  type SmsLog, type InsertSmsLog,
  type SenderInstitutionMapping, type InsertSenderInstitutionMapping,
  type BillSenderMapping, type InsertBillSenderMapping,
  type ForecastExclusion, type InsertForecastExclusion,
  type DashboardStats,
  DEFAULT_CATEGORIES
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  updateUserPin(id: number, pinHash: string): Promise<User | undefined>;
  updateUserBiometric(id: number, biometricEnabled: boolean): Promise<User | undefined>;

  // Accounts
  getAllAccounts(userId?: number): Promise<Account[]>;
  getAccount(id: number): Promise<Account | undefined>;
  getDefaultAccount(): Promise<Account | undefined>;
  createAccount(account: InsertAccount): Promise<Account>;
  updateAccount(id: number, account: Partial<InsertAccount>): Promise<Account | undefined>;
  deleteAccount(id: number): Promise<boolean>;
  updateAccountBalance(id: number, amount: string, type: 'add' | 'subtract'): Promise<Account | undefined>;

  // Categories
  getAllCategories(): Promise<Category[]>;
  getCategory(id: number): Promise<Category | undefined>;
  getCategoryByName(name: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category | undefined>;
  deleteCategory(id: number): Promise<boolean>;
  getCategoryUsage(): Promise<Array<{
    categoryId: number;
    transactionCount: number;
    scheduledPaymentCount: number;
    budgetCount: number;
    insuranceCount: number;
    loanCount: number;
  }>>;
  seedDefaultCategories(): Promise<void>;

  // Transactions
  getAllTransactions(filters?: {
    userId?: number;
    accountId?: number;
    categoryId?: number;
    startDate?: Date;
    endDate?: Date;
    search?: string;
    limit?: number;
  }): Promise<TransactionWithRelations[]>;
  getTransaction(id: number): Promise<TransactionWithRelations | undefined>;
  getTransactionByReferenceNumber(userId: number, referenceNumber: string): Promise<Transaction | undefined>;
  getTransactionByFallbackKey(userId: number, accountId: number, amount: string, type: string, date: Date): Promise<Transaction | undefined>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(id: number, transaction: Partial<InsertTransaction>): Promise<Transaction>;
  deleteTransaction(id: number): Promise<boolean>;

  // Budgets
  getAllBudgets(filters?: { userId?: number; month?: number; year?: number }): Promise<Budget[]>;
  getBudget(id: number): Promise<Budget | undefined>;
  createBudget(budget: InsertBudget): Promise<Budget>;
  updateBudget(id: number, budget: Partial<InsertBudget>): Promise<Budget | undefined>;
  deleteBudget(id: number): Promise<boolean>;

  // Scheduled Payments
  getAllScheduledPayments(userId?: number): Promise<ScheduledPayment[]>;
  getScheduledPayment(id: number): Promise<ScheduledPayment | undefined>;
  createScheduledPayment(payment: InsertScheduledPayment): Promise<ScheduledPayment>;
  updateScheduledPayment(id: number, payment: Partial<InsertScheduledPayment>): Promise<ScheduledPayment | undefined>;
  deleteScheduledPayment(id: number): Promise<boolean>;
  getCreditCardBills(): Promise<any[]>;

  // Credit Card Statements
  getCreditCardStatements(accountId: number): Promise<CreditCardStatement[]>;
  getCreditCardStatement(id: number): Promise<CreditCardStatement | undefined>;
  getOrCreateCurrentStatement(accountId: number): Promise<CreditCardStatement>;
  createCreditCardStatement(statement: InsertCreditCardStatement): Promise<CreditCardStatement>;
  updateCreditCardStatement(id: number, data: Partial<InsertCreditCardStatement>): Promise<CreditCardStatement | undefined>;
  recordCreditCardPayment(statementId: number, amount: number, paidDate: Date): Promise<CreditCardStatement | undefined>;
  confirmCreditCardStatementSms(id: number, reportedBalance: number, matched: boolean): Promise<CreditCardStatement | undefined>;

  // Card Details
  getCardDetailsByLastFourDigits(lastFourDigits: string, userId?: number): Promise<CardDetails | undefined>;

  // SMS Logs
  createSmsLog(smsLog: InsertSmsLog): Promise<SmsLog>;
  updateSmsLogTransaction(id: number, transactionId: number): Promise<SmsLog | undefined>;
  clearSmsLogTransaction(id: number): Promise<void>;

  // Sender Institution Mappings
  getSenderInstitutionMapping(userId: number, institutionKey: string): Promise<SenderInstitutionMapping | undefined>;
  createSenderInstitutionMapping(mapping: InsertSenderInstitutionMapping): Promise<SenderInstitutionMapping>;
  touchSenderInstitutionMapping(id: number): Promise<void>;
  getPendingSenderInstitutionMappings(userId: number): Promise<SenderInstitutionMapping[]>;
  resolveSenderInstitutionMapping(id: number, data: { status: 'mapped' | 'ignored'; accountId?: number }): Promise<SenderInstitutionMapping | undefined>;
  getQueuedSmsLogsForMapping(institutionMappingId: number): Promise<SmsLog[]>;

  // Bill Sender Mappings (Bills Inbox)
  getBillSenderMapping(userId: number, institutionKey: string): Promise<BillSenderMapping | undefined>;
  createBillSenderMapping(mapping: InsertBillSenderMapping): Promise<BillSenderMapping>;
  touchBillSenderMapping(id: number): Promise<void>;
  getPendingBillSenderMappings(userId: number): Promise<BillSenderMapping[]>;
  resolveBillSenderMapping(id: number, data: { status: 'mapped' | 'ignored'; scheduledPaymentId?: number }): Promise<BillSenderMapping | undefined>;
  getSmsLogsForBillMapping(billMappingId: number): Promise<SmsLog[]>;

  // Forecast Exclusions
  getForecastExclusions(userId: number, cycleStart: Date): Promise<ForecastExclusion[]>;
  toggleForecastExclusion(userId: number, itemType: string, itemId: string, cycleStart: Date): Promise<{ excluded: boolean }>;

  // Payment Occurrences
  getPaymentOccurrences(filters?: { userId?: number; month?: number; year?: number; scheduledPaymentId?: number }): Promise<(PaymentOccurrence & { scheduledPayment?: ScheduledPayment })[]>;
  getPaymentOccurrence(id: number): Promise<PaymentOccurrence | undefined>;
  createPaymentOccurrence(occurrence: InsertPaymentOccurrence): Promise<PaymentOccurrence>;
  updatePaymentOccurrence(id: number, data: Partial<InsertPaymentOccurrence>): Promise<PaymentOccurrence | undefined>;
  generatePaymentOccurrencesForMonth(month: number, year: number, userId?: number): Promise<PaymentOccurrence[]>;
  confirmPaymentOccurrenceSms(id: number): Promise<PaymentOccurrence | undefined>;

  // Savings Goals
  getAllSavingsGoals(userId?: number): Promise<SavingsGoal[]>;
  getSavingsGoal(id: number): Promise<SavingsGoal | undefined>;
  createSavingsGoal(goal: InsertSavingsGoal & { startDate: Date; targetDate: Date }): Promise<SavingsGoal>;
  updateSavingsGoal(id: number, goal: Partial<InsertSavingsGoal> & { startDate?: Date; targetDate?: Date }): Promise<SavingsGoal | undefined>;
  deleteSavingsGoal(id: number): Promise<boolean>;

  // Savings Contributions
  getSavingsContributions(goalId: number): Promise<SavingsContribution[]>;
  getSavingsContribution(id: number): Promise<SavingsContribution | undefined>;
  createSavingsContribution(contribution: InsertSavingsContribution): Promise<SavingsContribution>;
  deleteSavingsContribution(id: number): Promise<boolean>;

  // Salary Profiles
  getSalaryProfile(userId?: number): Promise<SalaryProfile | undefined>;
  createSalaryProfile(profile: InsertSalaryProfile): Promise<SalaryProfile>;
  updateSalaryProfile(id: number, profile: Partial<InsertSalaryProfile>): Promise<SalaryProfile | undefined>;

  // Salary Cycles
  getSalaryCycles(profileId: number, limit?: number): Promise<SalaryCycle[]>;
  getSalaryCycle(id: number): Promise<SalaryCycle | undefined>;
  createSalaryCycle(cycle: InsertSalaryCycle): Promise<SalaryCycle>;
  updateSalaryCycle(id: number, cycle: Partial<InsertSalaryCycle>): Promise<SalaryCycle | undefined>;

  // Dashboard Analytics
  getDashboardStats(userId?: number): Promise<DashboardStats>;

  // Loans
  getAllLoans(userId?: number): Promise<LoanWithRelations[]>;
  getLoan(id: number): Promise<LoanWithRelations | undefined>;
  createLoan(loan: InsertLoan): Promise<Loan>;
  updateLoan(id: number, loan: Partial<InsertLoan>): Promise<Loan | undefined>;
  deleteLoan(id: number): Promise<boolean>;

  // Loan Components
  getLoanComponents(loanId: number): Promise<LoanComponent[]>;
  createLoanComponent(component: InsertLoanComponent): Promise<LoanComponent>;
  updateLoanComponent(id: number, component: Partial<InsertLoanComponent>): Promise<LoanComponent | undefined>;
  deleteLoanComponent(id: number): Promise<boolean>;

  // Loan Installments
  getLoanInstallments(loanId: number): Promise<LoanInstallment[]>;
  getLoanInstallment(id: number): Promise<LoanInstallment | undefined>;
  createLoanInstallment(installment: InsertLoanInstallment): Promise<LoanInstallment>;
  updateLoanInstallment(id: number, installment: Partial<InsertLoanInstallment>): Promise<LoanInstallment | undefined>;
  generateLoanInstallments(loanId: number): Promise<LoanInstallment[]>;
  markInstallmentPaid(id: number, paidAmount: string, transactionId?: number): Promise<LoanInstallment | undefined>;

  // Loan Spending Entries
  getLoanSpendingEntries(loanId: number): Promise<LoanSpendingEntry[]>;
  createLoanSpendingEntry(entry: InsertLoanSpendingEntry): Promise<LoanSpendingEntry>;
  deleteLoanSpendingEntry(id: number): Promise<boolean>;

  // Card Details
  getCardDetails(accountId: number): Promise<CardDetails | undefined>;
  createCardDetails(card: InsertCardDetails): Promise<CardDetails>;
  updateCardDetails(id: number, card: Partial<InsertCardDetails>): Promise<CardDetails | undefined>;
  deleteCardDetails(id: number): Promise<boolean>;

  // Loan Terms
  getLoanTerms(loanId: number): Promise<LoanTerm[]>;
  getLoanTerm(id: number): Promise<LoanTerm | undefined>;
  createLoanTerm(term: InsertLoanTerm): Promise<LoanTerm>;
  updateLoanTerm(id: number, term: Partial<InsertLoanTerm>): Promise<LoanTerm | undefined>;

  // Loan Payments
  getLoanPayments(loanId: number): Promise<LoanPayment[]>;
  getLoanPayment(id: number): Promise<LoanPayment | undefined>;
  createLoanPayment(payment: InsertLoanPayment): Promise<LoanPayment>;
  updateLoanPayment(id: number, payment: Partial<InsertLoanPayment>): Promise<LoanPayment | undefined>;
  deleteLoanPayment(id: number): Promise<boolean>;

  // Insurance
  getAllInsurances(userId?: number): Promise<InsuranceWithRelations[]>;
  getInsurance(id: number): Promise<InsuranceWithRelations | undefined>;
  createInsurance(insurance: InsertInsurance): Promise<Insurance>;
  updateInsurance(id: number, insurance: Partial<InsertInsurance>): Promise<Insurance | undefined>;
  deleteInsurance(id: number): Promise<boolean>;

  // Insurance Premiums
  getInsurancePremiums(insuranceId: number): Promise<InsurancePremium[]>;
  getInsurancePremium(id: number): Promise<InsurancePremium | undefined>;
  createInsurancePremium(premium: InsertInsurancePremium): Promise<InsurancePremium>;
  updateInsurancePremium(id: number, premium: Partial<InsertInsurancePremium>): Promise<InsurancePremium | undefined>;
  deleteInsurancePremium(id: number): Promise<boolean>;
  generateInsurancePremiums(insuranceId: number): Promise<InsurancePremium[]>;
  markPremiumPaid(id: number, paidAmount: string, accountId?: number, transactionId?: number): Promise<InsurancePremium | undefined>;

  // Loan BT Allocations
  getLoanBtAllocations(sourceLoanId: number): Promise<LoanBtAllocation[]>;
  getLoanBtAllocation(id: number): Promise<LoanBtAllocation | undefined>;
  getLoanBtAllocationsByTarget(targetLoanId: number): Promise<LoanBtAllocation[]>;
  createLoanBtAllocation(allocation: InsertLoanBtAllocation): Promise<LoanBtAllocation>;
  updateLoanBtAllocation(id: number, allocation: Partial<InsertLoanBtAllocation>): Promise<LoanBtAllocation | undefined>;
  deleteLoanBtAllocation(id: number): Promise<boolean>;
  processLoanBtPayment(id: number, actualBtAmount: string, processedDate: Date, processingFee?: string): Promise<{ allocation: LoanBtAllocation; targetLoan: Loan }>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ ...user, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated || undefined;
  }

  async updateUserPin(id: number, pinHash: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ pinHash, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated || undefined;
  }

  async updateUserBiometric(id: number, biometricEnabled: boolean): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ biometricEnabled, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated || undefined;
  }

  // Accounts
  async getAllAccounts(userId?: number): Promise<Account[]> {
    if (userId) {
      return db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.name);
    }
    return db.select().from(accounts).orderBy(accounts.name);
  }

  async getAccount(id: number): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account || undefined;
  }

  async getDefaultAccount(): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.isDefault, true));
    return account || undefined;
  }

  async createAccount(account: InsertAccount): Promise<Account> {
    // If setting as default, unset all other defaults
    if (account.isDefault) {
      await db.update(accounts).set({ isDefault: false }).where(eq(accounts.isDefault, true));
    }
    const [newAccount] = await db.insert(accounts).values(account).returning();
    return newAccount;
  }

  async updateAccount(id: number, account: Partial<InsertAccount>): Promise<Account | undefined> {
    // If setting as default, unset all other defaults
    if (account.isDefault) {
      await db.update(accounts).set({ isDefault: false }).where(eq(accounts.isDefault, true));
    }
    const [updated] = await db.update(accounts).set({ ...account, updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
    return updated || undefined;
  }

  async deleteAccount(id: number): Promise<boolean> {
    try {
      // Delete all related records in order of dependencies
      
      // 1. Delete payment occurrences linked to scheduled payments of this account
      const scheduledPaymentsForAccount = await db.select().from(scheduledPayments).where(
        or(
          eq(scheduledPayments.accountId, id),
          eq(scheduledPayments.creditCardAccountId, id)
        )
      );
      
      for (const payment of scheduledPaymentsForAccount) {
        await db.delete(paymentOccurrences).where(eq(paymentOccurrences.scheduledPaymentId, payment.id));
      }
      
      // 2. Delete scheduled payments
      await db.delete(scheduledPayments).where(
        or(
          eq(scheduledPayments.accountId, id),
          eq(scheduledPayments.creditCardAccountId, id)
        )
      );
      
      // 3. Delete credit card statements
      await db.delete(creditCardStatements).where(eq(creditCardStatements.accountId, id));
      
      // 4. Delete card details
      await db.delete(cardDetails).where(eq(cardDetails.accountId, id));
      
      // 5. Delete transactions
      await db.delete(transactions).where(
        or(
          eq(transactions.accountId, id),
          eq(transactions.toAccountId, id)
        )
      );
      
      // 6. Delete savings contributions
      await db.delete(savingsContributions).where(eq(savingsContributions.accountId, id));
      
      // 7. Delete savings goals
      await db.delete(savingsGoals).where(
        or(
          eq(savingsGoals.accountId, id),
          eq(savingsGoals.toAccountId, id)
        )
      );
      
      // 8. Delete loans
      await db.delete(loans).where(eq(loans.accountId, id));
      
      // 9. Delete salary profiles
      await db.delete(salaryProfiles).where(eq(salaryProfiles.accountId, id));
      
      // 10. Delete insurances
      await db.delete(insurances).where(eq(insurances.accountId, id));
      
      // 11. Finally, delete the account
      const result = await db.delete(accounts).where(eq(accounts.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error("Error deleting account:", error);
      throw error;
    }
  }

  async updateAccountBalance(id: number, amount: string, type: 'add' | 'subtract'): Promise<Account | undefined> {
    const account = await this.getAccount(id);
    if (!account) return undefined;
    
    const currentBalance = parseFloat(account.balance || "0");
    const changeAmount = parseFloat(amount);
    const newBalance = type === 'add' ? currentBalance + changeAmount : currentBalance - changeAmount;
    
    const [updated] = await db.update(accounts)
      .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    return updated || undefined;
  }

  // Categories
  async getAllCategories(): Promise<Category[]> {
    return db.select().from(categories).orderBy(categories.name);
  }

  async getCategory(id: number): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    return category || undefined;
  }

  async getCategoryByName(name: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.name, name));
    return category || undefined;
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const [newCategory] = await db.insert(categories).values(category).returning();
    return newCategory;
  }

  async updateCategory(id: number, category: Partial<InsertCategory>): Promise<Category | undefined> {
    const [updated] = await db.update(categories)
      .set(category)
      .where(eq(categories.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteCategory(id: number): Promise<boolean> {
    const result = await db.delete(categories).where(eq(categories.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getCategoryUsage(): Promise<Array<{
    categoryId: number;
    transactionCount: number;
    scheduledPaymentCount: number;
    budgetCount: number;
    insuranceCount: number;
    loanCount: number;
  }>> {
    const allCategories = await this.getAllCategories();
    
    const usage = await Promise.all(allCategories.map(async (category) => {
      // Count transactions
      const transactionCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(eq(transactions.categoryId, category.id));
      const transactionCount = Number(transactionCountResult[0]?.count || 0);

      // Count scheduled payments
      const scheduledPaymentCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(scheduledPayments)
        .where(eq(scheduledPayments.categoryId, category.id));
      const scheduledPaymentCount = Number(scheduledPaymentCountResult[0]?.count || 0);

      // Count budgets
      const budgetCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(budgets)
        .where(eq(budgets.categoryId, category.id));
      const budgetCount = Number(budgetCountResult[0]?.count || 0);

      // Count insurances
      const insuranceCountResult = await db.select({ count: sql<number>`count(*)` })
        .from(insurances)
        .where(eq(insurances.categoryId, category.id));
      const insuranceCount = Number(insuranceCountResult[0]?.count || 0);

      // Count loans (from loan_components)
      const loanCountResult = await db.select({ count: sql<number>`count(distinct ${loanComponents.loanId})` })
        .from(loanComponents)
        .where(eq(loanComponents.categoryId, category.id));
      const loanCount = Number(loanCountResult[0]?.count || 0);

      return {
        categoryId: category.id,
        transactionCount,
        scheduledPaymentCount,
        budgetCount,
        insuranceCount,
        loanCount,
      };
    }));

    return usage;
  }

  async seedDefaultCategories(): Promise<void> {
    const existing = await this.getAllCategories();
    if (existing.length === 0) {
      for (const cat of DEFAULT_CATEGORIES) {
        await db.insert(categories).values(cat).onConflictDoNothing();
      }
    }
  }

  // Transactions
  async getAllTransactions(filters?: {
    userId?: number;
    accountId?: number;
    categoryId?: number;
    startDate?: Date;
    endDate?: Date;
    search?: string;
    limit?: number;
  }): Promise<TransactionWithRelations[]> {
    const toAccountAlias = alias(accounts, 'to_account');
    
    let query = db.select({
      id: transactions.id,
      userId: transactions.userId,
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
      categoryId: transactions.categoryId,
      amount: transactions.amount,
      type: transactions.type,
      description: transactions.description,
      merchant: transactions.merchant,
      referenceNumber: transactions.referenceNumber,
      transactionDate: transactions.transactionDate,
      smsId: transactions.smsId,
      isRecurring: transactions.isRecurring,
      savingsContributionId: transactions.savingsContributionId,
      paymentOccurrenceId: transactions.paymentOccurrenceId,
      createdAt: transactions.createdAt,
      account: accounts,
      toAccount: toAccountAlias,
      category: categories,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(toAccountAlias, eq(transactions.toAccountId, toAccountAlias.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .orderBy(desc(transactions.transactionDate))
    .$dynamic();

    const conditions = [];

    if (filters?.userId) {
      conditions.push(eq(transactions.userId, filters.userId));
    }
    if (filters?.accountId) {
      conditions.push(eq(transactions.accountId, filters.accountId));
    }
    if (filters?.categoryId) {
      conditions.push(eq(transactions.categoryId, filters.categoryId));
    }
    if (filters?.startDate) {
      conditions.push(gte(transactions.transactionDate, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(transactions.transactionDate, filters.endDate));
    }
    if (filters?.search) {
      conditions.push(
        or(
          ilike(transactions.description, `%${filters.search}%`),
          ilike(transactions.merchant, `%${filters.search}%`)
        )
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const results = await query;
    return results as TransactionWithRelations[];
  }

  async getTransaction(id: number): Promise<TransactionWithRelations | undefined> {
    const toAccountAlias = alias(accounts, 'to_account');
    
    const [result] = await db.select({
      id: transactions.id,
      userId: transactions.userId,
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
      categoryId: transactions.categoryId,
      amount: transactions.amount,
      type: transactions.type,
      description: transactions.description,
      merchant: transactions.merchant,
      referenceNumber: transactions.referenceNumber,
      transactionDate: transactions.transactionDate,
      smsId: transactions.smsId,
      isRecurring: transactions.isRecurring,
      savingsContributionId: transactions.savingsContributionId,
      paymentOccurrenceId: transactions.paymentOccurrenceId,
      createdAt: transactions.createdAt,
      account: accounts,
      toAccount: toAccountAlias,
      category: categories,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(toAccountAlias, eq(transactions.toAccountId, toAccountAlias.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.id, id));

    return result as TransactionWithRelations || undefined;
  }

  async getTransactionByReferenceNumber(userId: number, referenceNumber: string): Promise<Transaction | undefined> {
    const [result] = await db.select().from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.referenceNumber, referenceNumber)));
    return result || undefined;
  }

  // Fallback dedupe for SMS with no reference number — matches same account, amount, type,
  // and calendar day. Used by rescans, where the same historical SMS could otherwise be
  // re-added on a repeat scan.
  async getTransactionByFallbackKey(userId: number, accountId: number, amount: string, type: string, date: Date): Promise<Transaction | undefined> {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    const [result] = await db.select().from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        eq(transactions.amount, amount),
        eq(transactions.type, type),
        gte(transactions.transactionDate, dayStart),
        lte(transactions.transactionDate, dayEnd),
      ));
    return result || undefined;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values({
      ...transaction,
      transactionDate: transaction.transactionDate ? new Date(transaction.transactionDate) : new Date(),
    }).returning();

    // Update account balances based on transaction type
    if (transaction.type === 'transfer') {
      // For transfers: deduct from source account and add to destination account
      if (transaction.accountId) {
        await this.updateAccountBalance(transaction.accountId, transaction.amount, 'subtract');
      }
      if (transaction.toAccountId) {
        await this.updateAccountBalance(transaction.toAccountId, transaction.amount, 'add');
      }
    } else {
      // For regular debit/credit transactions
      if (transaction.accountId) {
        const balanceType = transaction.type === 'debit' ? 'subtract' : 'add';
        await this.updateAccountBalance(transaction.accountId, transaction.amount, balanceType);
      }
    }

    return newTransaction;
  }

  async updateTransaction(id: number, updates: Partial<InsertTransaction>): Promise<Transaction> {
    const oldTransaction = await this.getTransaction(id);
    if (!oldTransaction) {
      throw new Error('Transaction not found');
    }

    // Reverse old balance changes
    if (oldTransaction.type === 'transfer') {
      // Reverse transfer: add back to source, subtract from destination
      if (oldTransaction.accountId) {
        await this.updateAccountBalance(oldTransaction.accountId, oldTransaction.amount, 'add');
      }
      if (oldTransaction.toAccountId) {
        await this.updateAccountBalance(oldTransaction.toAccountId, oldTransaction.amount, 'subtract');
      }
    } else {
      // Reverse regular transaction
      if (oldTransaction.accountId) {
        const oldBalanceType = oldTransaction.type === 'debit' ? 'add' : 'subtract';
        await this.updateAccountBalance(oldTransaction.accountId, oldTransaction.amount, oldBalanceType);
      }
    }

    // Update the transaction
    const updateData: any = { ...updates };
    if (updates.transactionDate) {
      updateData.transactionDate = new Date(updates.transactionDate);
    }

    const [updatedTransaction] = await db
      .update(transactions)
      .set(updateData)
      .where(eq(transactions.id, id))
      .returning();

    // Apply new balance changes
    const newAccountId = updates.accountId !== undefined ? updates.accountId : oldTransaction.accountId;
    const newToAccountId = updates.toAccountId !== undefined ? updates.toAccountId : oldTransaction.toAccountId;
    const newAmount = updates.amount !== undefined ? updates.amount : oldTransaction.amount;
    const newType = updates.type !== undefined ? updates.type : oldTransaction.type;

    if (newType === 'transfer') {
      // Apply transfer: subtract from source, add to destination
      if (newAccountId) {
        await this.updateAccountBalance(newAccountId, newAmount, 'subtract');
      }
      if (newToAccountId) {
        await this.updateAccountBalance(newToAccountId, newAmount, 'add');
      }
    } else {
      // Apply regular transaction
      if (newAccountId) {
        const newBalanceType = newType === 'debit' ? 'subtract' : 'add';
        await this.updateAccountBalance(newAccountId, newAmount, newBalanceType);
      }
    }

    return updatedTransaction;
  }

  async deleteTransaction(id: number): Promise<boolean> {
    const transaction = await this.getTransaction(id);
    if (transaction) {
      // Reverse the balance change
      if (transaction.type === 'transfer') {
        // Reverse transfer: add back to source, subtract from destination
        if (transaction.accountId) {
          await this.updateAccountBalance(transaction.accountId, transaction.amount, 'add');
        }
        if (transaction.toAccountId) {
          await this.updateAccountBalance(transaction.toAccountId, transaction.amount, 'subtract');
        }
      } else {
        // Reverse regular transaction
        if (transaction.accountId) {
          const balanceType = transaction.type === 'debit' ? 'add' : 'subtract';
          await this.updateAccountBalance(transaction.accountId, transaction.amount, balanceType);
        }
      }
    }
    const result = await db.delete(transactions).where(eq(transactions.id, id)).returning();
    return result.length > 0;
  }

  // Budgets
  async getAllBudgets(filters?: { userId?: number; month?: number; year?: number }): Promise<Budget[]> {
    const conditions = [];
    
    if (filters?.userId) {
      conditions.push(eq(budgets.userId, filters.userId));
    }
    if (filters?.month) {
      conditions.push(eq(budgets.month, filters.month));
    }
    if (filters?.year) {
      conditions.push(eq(budgets.year, filters.year));
    }

    const query = db.select({
      id: budgets.id,
      userId: budgets.userId,
      categoryId: budgets.categoryId,
      amount: budgets.amount,
      month: budgets.month,
      year: budgets.year,
      createdAt: budgets.createdAt,
      category: categories,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id));

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getBudget(id: number): Promise<Budget | undefined> {
    const [budget] = await db.select().from(budgets).where(eq(budgets.id, id));
    return budget || undefined;
  }

  async createBudget(budget: InsertBudget): Promise<Budget> {
    const [newBudget] = await db.insert(budgets).values(budget).returning();
    return newBudget;
  }

  async updateBudget(id: number, budget: Partial<InsertBudget>): Promise<Budget | undefined> {
    const [updated] = await db.update(budgets).set(budget).where(eq(budgets.id, id)).returning();
    return updated || undefined;
  }

  async deleteBudget(id: number): Promise<boolean> {
    const result = await db.delete(budgets).where(eq(budgets.id, id)).returning();
    return result.length > 0;
  }

  // Scheduled Payments
  async getAllScheduledPayments(userId?: number): Promise<ScheduledPayment[]> {
    if (userId) {
      return db.select().from(scheduledPayments).where(eq(scheduledPayments.userId, userId)).orderBy(scheduledPayments.dueDate);
    }
    return db.select().from(scheduledPayments).orderBy(scheduledPayments.dueDate);
  }

  async getScheduledPayment(id: number): Promise<ScheduledPayment | undefined> {
    const [payment] = await db.select().from(scheduledPayments).where(eq(scheduledPayments.id, id));
    return payment || undefined;
  }

  async createScheduledPayment(payment: InsertScheduledPayment): Promise<ScheduledPayment> {
    const [newPayment] = await db.insert(scheduledPayments).values(payment).returning();
    return newPayment;
  }

  async updateScheduledPayment(id: number, payment: Partial<InsertScheduledPayment>): Promise<ScheduledPayment | undefined> {
    const [updated] = await db.update(scheduledPayments)
      .set({ ...payment, updatedAt: new Date() })
      .where(eq(scheduledPayments.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteScheduledPayment(id: number): Promise<boolean> {
    // First delete all payment occurrences for this scheduled payment
    await db.delete(paymentOccurrences).where(eq(paymentOccurrences.scheduledPaymentId, id));
    
    // Then delete the scheduled payment
    const result = await db.delete(scheduledPayments).where(eq(scheduledPayments.id, id)).returning();
    return result.length > 0;
  }

  async getCreditCardBills(): Promise<any[]> {
    // Get all credit card accounts
    const creditCardAccounts = await db.select().from(accounts).where(eq(accounts.type, 'credit_card'));
    
    if (creditCardAccounts.length === 0) {
      return [];
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const bills = await Promise.all(
      creditCardAccounts.map(async (account) => {
        // Get or create current statement for this account
        const statement = await this.getOrCreateCurrentStatement(account.id);
        
        // Find credit card bill payment occurrence for this month
        const billPayment = await db
          .select()
          .from(scheduledPayments)
          .where(
            and(
              eq(scheduledPayments.paymentType, 'credit_card_bill'),
              eq(scheduledPayments.creditCardAccountId, account.id)
            )
          )
          .limit(1);

        // Get payment occurrence for this month
        let paymentOccurrence = null;
        let paymentStatus = statement.status || 'unpaid';
        if (billPayment.length > 0) {
          const occurrences = await db
            .select()
            .from(paymentOccurrences)
            .where(
              and(
                eq(paymentOccurrences.scheduledPaymentId, billPayment[0].id),
                eq(paymentOccurrences.month, currentMonth),
                eq(paymentOccurrences.year, currentYear)
              )
            )
            .limit(1);
          
          if (occurrences.length > 0) {
            paymentOccurrence = occurrences[0];
            if (paymentOccurrence.status === 'paid') {
              paymentStatus = 'paid';
            }
          }
        }

        // Calculate days until due
        const dueDate = new Date(statement.dueDate);
        const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        return {
          accountId: account.id,
          accountName: account.name,
          bankName: account.bankName,
          billingDate: account.billingDate,
          // Statement-based data
          statementId: statement.id,
          openingBalance: statement.openingBalance,
          newCharges: statement.newCharges,
          payments: statement.payments,
          credits: statement.credits,
          statementBalance: statement.statementBalance,
          minimumDue: statement.minimumDue,
          paidAmount: statement.paidAmount,
          paidDate: statement.paidDate,
          // Legacy compatibility
          cycleSpending: statement.newCharges,
          cycleStartDate: new Date(statement.billingCycleStart).toISOString().split('T')[0],
          cycleEndDate: new Date(statement.billingCycleEnd).toISOString().split('T')[0],
          dueDate: dueDate.toISOString().split('T')[0],
          daysUntilDue,
          paymentStatus,
          paymentOccurrenceId: paymentOccurrence?.id || null,
          scheduledPaymentId: billPayment[0]?.id || null,
          limit: account.creditLimit ? parseFloat(account.creditLimit) : null,
          monthlyLimit: account.monthlySpendingLimit ? parseFloat(account.monthlySpendingLimit) : null,
        };
      })
    );

    return bills;
  }

  // Credit Card Statements
  async getCreditCardStatements(accountId: number): Promise<CreditCardStatement[]> {
    return await db
      .select()
      .from(creditCardStatements)
      .where(eq(creditCardStatements.accountId, accountId))
      .orderBy(desc(creditCardStatements.statementYear), desc(creditCardStatements.statementMonth));
  }

  async getCreditCardStatement(id: number): Promise<CreditCardStatement | undefined> {
    const result = await db.select().from(creditCardStatements).where(eq(creditCardStatements.id, id)).limit(1);
    return result[0];
  }

  async getOrCreateCurrentStatement(accountId: number): Promise<CreditCardStatement> {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Check if statement exists for current month
    const existing = await db
      .select()
      .from(creditCardStatements)
      .where(
        and(
          eq(creditCardStatements.accountId, accountId),
          eq(creditCardStatements.statementMonth, currentMonth),
          eq(creditCardStatements.statementYear, currentYear)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update the statement with latest transactions
      return await this.refreshStatement(existing[0]);
    }

    // Get account details
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // Calculate billing cycle dates
    const billingDate = account.billingDate || 1;
    const cycleStartDate = new Date(currentYear, currentMonth - 2, billingDate);
    const cycleEndDate = new Date(currentYear, currentMonth - 1, billingDate - 1, 23, 59, 59);
    const statementDate = new Date(currentYear, currentMonth - 1, billingDate);
    const dueDate = new Date(currentYear, currentMonth - 1, billingDate + 20); // 20 days after statement

    // Get previous month's unpaid balance (opening balance)
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    
    const previousStatement = await db
      .select()
      .from(creditCardStatements)
      .where(
        and(
          eq(creditCardStatements.accountId, accountId),
          eq(creditCardStatements.statementMonth, previousMonth),
          eq(creditCardStatements.statementYear, previousYear)
        )
      )
      .limit(1);

    let openingBalance = 0;
    if (previousStatement.length > 0) {
      const prevBalance = parseFloat(previousStatement[0].statementBalance || '0');
      const prevPaid = parseFloat(previousStatement[0].paidAmount || '0');
      openingBalance = Math.max(0, prevBalance - prevPaid);
    }

    // Calculate new charges (spending during this cycle)
    const cycleTransactions = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.type, 'debit'),
          gte(transactions.transactionDate, cycleStartDate),
          lte(transactions.transactionDate, cycleEndDate)
        )
      );
    const newCharges = cycleTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Calculate credits/refunds during this cycle
    const creditTransactions = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.type, 'credit'),
          gte(transactions.transactionDate, cycleStartDate),
          lte(transactions.transactionDate, cycleEndDate)
        )
      );
    const credits = creditTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Calculate statement balance
    const statementBalance = openingBalance + newCharges - credits;
    const minimumDue = Math.max(100, statementBalance * 0.05); // 5% or minimum 100

    // Create new statement
    const result = await db
      .insert(creditCardStatements)
      .values({
        accountId,
        statementMonth: currentMonth,
        statementYear: currentYear,
        billingCycleStart: cycleStartDate,
        billingCycleEnd: cycleEndDate,
        statementDate,
        dueDate,
        openingBalance: openingBalance.toFixed(2),
        newCharges: newCharges.toFixed(2),
        payments: '0',
        credits: credits.toFixed(2),
        statementBalance: statementBalance.toFixed(2),
        minimumDue: minimumDue.toFixed(2),
        paidAmount: '0',
        status: 'unpaid',
      })
      .returning();

    return result[0];
  }

  private async refreshStatement(statement: CreditCardStatement): Promise<CreditCardStatement> {
    // Recalculate new charges and credits from transactions
    const cycleStartDate = new Date(statement.billingCycleStart);
    const cycleEndDate = new Date(statement.billingCycleEnd);

    // Calculate new charges
    const cycleTransactions = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, statement.accountId),
          eq(transactions.type, 'debit'),
          gte(transactions.transactionDate, cycleStartDate),
          lte(transactions.transactionDate, cycleEndDate)
        )
      );
    const newCharges = cycleTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Calculate credits
    const creditTransactions = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, statement.accountId),
          eq(transactions.type, 'credit'),
          gte(transactions.transactionDate, cycleStartDate),
          lte(transactions.transactionDate, cycleEndDate)
        )
      );
    const credits = creditTransactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const openingBalance = parseFloat(statement.openingBalance || '0');
    const paidAmount = parseFloat(statement.paidAmount || '0');
    const statementBalance = openingBalance + newCharges - credits;
    const minimumDue = Math.max(100, statementBalance * 0.05);

    // Determine status
    let status = 'unpaid';
    if (paidAmount >= statementBalance) {
      status = 'paid';
    } else if (paidAmount > 0) {
      status = 'partial';
    } else if (new Date() > new Date(statement.dueDate)) {
      status = 'overdue';
    }

    // Update statement
    const result = await db
      .update(creditCardStatements)
      .set({
        newCharges: newCharges.toFixed(2),
        credits: credits.toFixed(2),
        statementBalance: statementBalance.toFixed(2),
        minimumDue: minimumDue.toFixed(2),
        status,
      })
      .where(eq(creditCardStatements.id, statement.id))
      .returning();

    return result[0];
  }

  async createCreditCardStatement(statement: InsertCreditCardStatement): Promise<CreditCardStatement> {
    const result = await db.insert(creditCardStatements).values(statement).returning();
    return result[0];
  }

  async updateCreditCardStatement(id: number, data: Partial<InsertCreditCardStatement>): Promise<CreditCardStatement | undefined> {
    const result = await db
      .update(creditCardStatements)
      .set(data)
      .where(eq(creditCardStatements.id, id))
      .returning();
    return result[0];
  }

  async recordCreditCardPayment(statementId: number, amount: number, paidDate: Date): Promise<CreditCardStatement | undefined> {
    const statement = await this.getCreditCardStatement(statementId);
    if (!statement) return undefined;

    const currentPaid = parseFloat(statement.paidAmount || '0');
    const newPaidAmount = currentPaid + amount;
    const statementBalance = parseFloat(statement.statementBalance || '0');

    let status = 'partial';
    if (newPaidAmount >= statementBalance) {
      status = 'paid';
    }

    const result = await db
      .update(creditCardStatements)
      .set({
        paidAmount: newPaidAmount.toFixed(2),
        paidDate,
        status,
      })
      .where(eq(creditCardStatements.id, statementId))
      .returning();

    return result[0];
  }

  async confirmCreditCardStatementSms(id: number, reportedBalance: number, matched: boolean): Promise<CreditCardStatement | undefined> {
    const result = await db
      .update(creditCardStatements)
      .set(
        matched
          ? { smsConfirmedAt: new Date() }
          : { smsReportedBalance: reportedBalance.toFixed(2) }
      )
      .where(eq(creditCardStatements.id, id))
      .returning();
    return result[0];
  }

  // SMS Logs
  async createSmsLog(smsLog: InsertSmsLog): Promise<SmsLog> {
    // Build insert data with only defined values
    const insertData: any = {
      message: smsLog.message,
      receivedAt: smsLog.receivedAt ? new Date(smsLog.receivedAt) : new Date(),
      isParsed: smsLog.isParsed !== undefined ? smsLog.isParsed : false,
    };
    
    // Only add optional fields if they have proper values
    if (smsLog.sender && typeof smsLog.sender === 'string') {
      insertData.sender = smsLog.sender;
    }
    if (smsLog.userId && typeof smsLog.userId === 'number') {
      insertData.userId = smsLog.userId;
    }
    if (smsLog.transactionId && typeof smsLog.transactionId === 'number') {
      insertData.transactionId = smsLog.transactionId;
    }
    if (smsLog.institutionMappingId && typeof smsLog.institutionMappingId === 'number') {
      insertData.institutionMappingId = smsLog.institutionMappingId;
    }
    if (smsLog.billMappingId && typeof smsLog.billMappingId === 'number') {
      insertData.billMappingId = smsLog.billMappingId;
    }
    if (smsLog.creditCardStatementId && typeof smsLog.creditCardStatementId === 'number') {
      insertData.creditCardStatementId = smsLog.creditCardStatementId;
    }
    if (smsLog.paymentOccurrenceId && typeof smsLog.paymentOccurrenceId === 'number') {
      insertData.paymentOccurrenceId = smsLog.paymentOccurrenceId;
    }

    const [newLog] = await db.insert(smsLogs).values(insertData).returning();
    return newLog;
  }

  async updateSmsLogTransaction(id: number, transactionId: number): Promise<SmsLog | undefined> {
    const [updated] = await db.update(smsLogs)
      .set({ transactionId, isParsed: true })
      .where(eq(smsLogs.id, id))
      .returning();
    return updated || undefined;
  }

  async clearSmsLogTransaction(id: number): Promise<void> {
    await db.update(smsLogs)
      .set({ transactionId: null, isParsed: false })
      .where(eq(smsLogs.id, id));
  }

  // Sender Institution Mappings
  async getSenderInstitutionMapping(userId: number, institutionKey: string): Promise<SenderInstitutionMapping | undefined> {
    const [mapping] = await db.select().from(senderInstitutionMappings)
      .where(and(
        eq(senderInstitutionMappings.userId, userId),
        eq(senderInstitutionMappings.institutionKey, institutionKey)
      ));
    return mapping || undefined;
  }

  async createSenderInstitutionMapping(mapping: InsertSenderInstitutionMapping): Promise<SenderInstitutionMapping> {
    const [newMapping] = await db.insert(senderInstitutionMappings).values(mapping).returning();
    return newMapping;
  }

  async touchSenderInstitutionMapping(id: number): Promise<void> {
    await db.update(senderInstitutionMappings)
      .set({ lastSeenAt: new Date() })
      .where(eq(senderInstitutionMappings.id, id));
  }

  async getPendingSenderInstitutionMappings(userId: number): Promise<SenderInstitutionMapping[]> {
    return db.select().from(senderInstitutionMappings)
      .where(and(
        eq(senderInstitutionMappings.userId, userId),
        eq(senderInstitutionMappings.status, 'pending')
      ))
      .orderBy(desc(senderInstitutionMappings.lastSeenAt));
  }

  async resolveSenderInstitutionMapping(id: number, data: { status: 'mapped' | 'ignored'; accountId?: number }): Promise<SenderInstitutionMapping | undefined> {
    const [updated] = await db.update(senderInstitutionMappings)
      .set({ status: data.status, accountId: data.accountId })
      .where(eq(senderInstitutionMappings.id, id))
      .returning();
    return updated || undefined;
  }

  async getQueuedSmsLogsForMapping(institutionMappingId: number): Promise<SmsLog[]> {
    return db.select().from(smsLogs)
      .where(and(
        eq(smsLogs.institutionMappingId, institutionMappingId),
        sql`${smsLogs.transactionId} IS NULL`
      ))
      .orderBy(smsLogs.receivedAt);
  }

  // Bill Sender Mappings (Bills Inbox)
  async getBillSenderMapping(userId: number, institutionKey: string): Promise<BillSenderMapping | undefined> {
    const [mapping] = await db.select().from(billSenderMappings)
      .where(and(
        eq(billSenderMappings.userId, userId),
        eq(billSenderMappings.institutionKey, institutionKey)
      ));
    return mapping || undefined;
  }

  async createBillSenderMapping(mapping: InsertBillSenderMapping): Promise<BillSenderMapping> {
    const [newMapping] = await db.insert(billSenderMappings).values(mapping).returning();
    return newMapping;
  }

  async touchBillSenderMapping(id: number): Promise<void> {
    await db.update(billSenderMappings)
      .set({ lastSeenAt: new Date() })
      .where(eq(billSenderMappings.id, id));
  }

  async getPendingBillSenderMappings(userId: number): Promise<BillSenderMapping[]> {
    return db.select().from(billSenderMappings)
      .where(and(
        eq(billSenderMappings.userId, userId),
        eq(billSenderMappings.status, 'pending')
      ))
      .orderBy(desc(billSenderMappings.lastSeenAt));
  }

  async resolveBillSenderMapping(id: number, data: { status: 'mapped' | 'ignored'; scheduledPaymentId?: number }): Promise<BillSenderMapping | undefined> {
    const [updated] = await db.update(billSenderMappings)
      .set({ status: data.status, scheduledPaymentId: data.scheduledPaymentId })
      .where(eq(billSenderMappings.id, id))
      .returning();
    return updated || undefined;
  }

  async getSmsLogsForBillMapping(billMappingId: number): Promise<SmsLog[]> {
    return db.select().from(smsLogs)
      .where(eq(smsLogs.billMappingId, billMappingId))
      .orderBy(desc(smsLogs.receivedAt));
  }

  // Forecast Exclusions
  async getForecastExclusions(userId: number, cycleStart: Date): Promise<ForecastExclusion[]> {
    return db.select().from(forecastExclusions)
      .where(and(
        eq(forecastExclusions.userId, userId),
        eq(forecastExclusions.cycleStart, cycleStart),
      ));
  }

  async toggleForecastExclusion(userId: number, itemType: string, itemId: string, cycleStart: Date): Promise<{ excluded: boolean }> {
    const [existing] = await db.select().from(forecastExclusions)
      .where(and(
        eq(forecastExclusions.userId, userId),
        eq(forecastExclusions.itemType, itemType),
        eq(forecastExclusions.itemId, itemId),
        eq(forecastExclusions.cycleStart, cycleStart),
      ));

    if (existing) {
      await db.delete(forecastExclusions).where(eq(forecastExclusions.id, existing.id));
      return { excluded: false };
    }

    await db.insert(forecastExclusions).values({ userId, itemType, itemId, cycleStart });
    return { excluded: true };
  }

  // Dashboard Analytics
  async getDashboardStats(userId?: number): Promise<DashboardStats> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Get today's spending (excluding transfers)
    const todayTransactions = await this.getAllTransactions({
      userId,
      startDate: startOfToday,
      endDate: now,
    });
    const totalSpentToday = todayTransactions
      .filter(t => t.type === 'debit')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Get monthly spending (excluding transfers)
    const monthTransactions = await this.getAllTransactions({
      userId,
      startDate: startOfMonth,
      endDate: endOfMonth,
    });
    const totalSpentMonth = monthTransactions
      .filter(t => t.type === 'debit')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Get monthly expenses by category (excluding transfers)
    const categoryTotals = new Map<number, { name: string; total: number; color: string }>();
    for (const t of monthTransactions.filter(t => t.type === 'debit')) {
      if (t.categoryId && t.category) {
        const existing = categoryTotals.get(t.categoryId) || { name: t.category.name, total: 0, color: t.category.color || '#9E9E9E' };
        existing.total += parseFloat(t.amount);
        categoryTotals.set(t.categoryId, existing);
      }
    }
    const monthlyExpensesByCategory = Array.from(categoryTotals.entries()).map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.name,
      total: data.total,
      color: data.color,
    })).sort((a, b) => b.total - a.total);

    // Get budget usage
    const monthBudgets = await this.getAllBudgets({ userId, month: now.getMonth() + 1, year: now.getFullYear() });
    const allCategories = await this.getAllCategories();
    const budgetUsage = monthBudgets.map(b => {
      const category = allCategories.find(c => c.id === b.categoryId);
      const spent = categoryTotals.get(b.categoryId!)?.total || 0;
      const budgetAmount = parseFloat(b.amount);
      return {
        categoryId: b.categoryId!,
        categoryName: category?.name || 'Unknown',
        spent,
        budget: budgetAmount,
        percentage: budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0,
      };
    });

    // Get next scheduled payment
    const allPayments = await this.getAllScheduledPayments(userId);
    const activePayments = allPayments.filter(p => p.status === 'active');
    const today = now.getDate();
    const upcomingPayments = activePayments.filter(p => p.dueDate >= today).sort((a, b) => a.dueDate - b.dueDate);
    const nextScheduledPayment = upcomingPayments[0] || null;

    // Get last 5 transactions
    const lastTransactions = await this.getAllTransactions({ userId, limit: 5 });

    // Get upcoming bills (next 7 days)
    const upcomingBills = activePayments.filter(p => {
      const dueDay = p.dueDate;
      return dueDay >= today && dueDay <= today + 7;
    });

    // Get credit card spending for this month (based on billing cycle)
    const creditCardAccounts = await this.getAllAccounts(userId);
    const creditCards = creditCardAccounts.filter(a => a.type === 'credit_card' && a.isActive);
    
    const creditCardSpending = [];
    for (const card of creditCards) {
      // Calculate billing cycle dates
      let cycleStartDate: Date;
      let cycleEndDate: Date;
      
      if (card.billingDate) {
        // If billing date is set, calculate cycle from billingDate to billingDate-1 of next month
        const billingDay = card.billingDate;
        const currentDay = now.getDate();
        
        if (currentDay >= billingDay) {
          // Current cycle: billingDate of this month to billingDate-1 of next month
          cycleStartDate = new Date(now.getFullYear(), now.getMonth(), billingDay);
          cycleEndDate = new Date(now.getFullYear(), now.getMonth() + 1, billingDay - 1, 23, 59, 59);
        } else {
          // Previous cycle: billingDate of last month to billingDate-1 of this month
          cycleStartDate = new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
          cycleEndDate = new Date(now.getFullYear(), now.getMonth(), billingDay - 1, 23, 59, 59);
        }
      } else {
        // No billing date set, use calendar month
        cycleStartDate = startOfMonth;
        cycleEndDate = endOfMonth;
      }
      
      // Get spending for this billing cycle
      const cycleTransactions = await this.getAllTransactions({
        userId,
        accountId: card.id,
        startDate: cycleStartDate,
        endDate: cycleEndDate,
      });
      
      const spent = cycleTransactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      
      const limit = card.monthlySpendingLimit ? parseFloat(card.monthlySpendingLimit) : null;
      const percentage = limit && limit > 0 ? Math.round((spent / limit) * 100) : 0;
      
      // Determine color based on percentage
      let color = '#22c55e'; // green - default
      if (limit) {
        if (percentage >= 100) {
          color = '#ef4444'; // red - over limit
        } else if (percentage >= 80) {
          color = '#eab308'; // yellow - near limit
        }
      }
      
      creditCardSpending.push({
        accountId: card.id,
        accountName: card.name,
        bankName: card.bankName || '',
        spent,
        limit,
        percentage,
        color,
      });
    }

    return {
      totalSpentToday,
      totalSpentMonth,
      monthlyExpensesByCategory,
      budgetUsage,
      creditCardSpending,
      nextScheduledPayment,
      lastTransactions,
      upcomingBills,
    };
  }

  // Payment Occurrences
  async getPaymentOccurrences(filters?: { userId?: number; month?: number; year?: number; scheduledPaymentId?: number }): Promise<(PaymentOccurrence & { scheduledPayment?: ScheduledPayment })[]> {
    const conditions = [];
    
    if (filters?.userId) {
      conditions.push(eq(scheduledPayments.userId, filters.userId));
    }
    if (filters?.month) {
      conditions.push(eq(paymentOccurrences.month, filters.month));
    }
    if (filters?.year) {
      conditions.push(eq(paymentOccurrences.year, filters.year));
    }
    if (filters?.scheduledPaymentId) {
      conditions.push(eq(paymentOccurrences.scheduledPaymentId, filters.scheduledPaymentId));
    }

    const results = await db.select({
      id: paymentOccurrences.id,
      scheduledPaymentId: paymentOccurrences.scheduledPaymentId,
      month: paymentOccurrences.month,
      year: paymentOccurrences.year,
      dueDate: paymentOccurrences.dueDate,
      status: paymentOccurrences.status,
      paidAt: paymentOccurrences.paidAt,
      paidAmount: paymentOccurrences.paidAmount,
      notes: paymentOccurrences.notes,
      createdAt: paymentOccurrences.createdAt,
      scheduledPayment: scheduledPayments,
    })
    .from(paymentOccurrences)
    .leftJoin(scheduledPayments, eq(paymentOccurrences.scheduledPaymentId, scheduledPayments.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(paymentOccurrences.dueDate);

    return results as (PaymentOccurrence & { scheduledPayment?: ScheduledPayment })[];
  }

  async getPaymentOccurrence(id: number): Promise<PaymentOccurrence | undefined> {
    const [occurrence] = await db.select().from(paymentOccurrences).where(eq(paymentOccurrences.id, id));
    return occurrence || undefined;
  }

  async createPaymentOccurrence(occurrence: InsertPaymentOccurrence): Promise<PaymentOccurrence> {
    const [newOccurrence] = await db.insert(paymentOccurrences).values({
      ...occurrence,
      dueDate: occurrence.dueDate ? new Date(occurrence.dueDate) : new Date(),
    }).returning();
    return newOccurrence;
  }

  async updatePaymentOccurrence(id: number, data: Partial<InsertPaymentOccurrence>): Promise<PaymentOccurrence | undefined> {
    const updateData: any = { ...data };
    if (data.status === 'paid' && !data.paidAt) {
      updateData.paidAt = new Date();
    }
    const [updated] = await db.update(paymentOccurrences)
      .set(updateData)
      .where(eq(paymentOccurrences.id, id))
      .returning();
    return updated || undefined;
  }

  async confirmPaymentOccurrenceSms(id: number): Promise<PaymentOccurrence | undefined> {
    const [updated] = await db.update(paymentOccurrences)
      .set({ confirmedBySms: new Date() })
      .where(eq(paymentOccurrences.id, id))
      .returning();
    return updated || undefined;
  }

  async generatePaymentOccurrencesForMonth(month: number, year: number, userId?: number): Promise<PaymentOccurrence[]> {
    const allPayments = await this.getAllScheduledPayments(userId);
    const activePayments = allPayments.filter(p => p.status === 'active');
    const generatedOccurrences: PaymentOccurrence[] = [];

    for (const payment of activePayments) {
      const frequency = payment.frequency || 'monthly';
      const startMonth = payment.startMonth;

      let shouldCreate = false;
      switch (frequency) {
        case 'monthly':
          shouldCreate = true;
          break;
        case 'quarterly':
          if (startMonth) {
            const quarterMonths = [startMonth];
            for (let i = 1; i < 4; i++) {
              quarterMonths.push(((startMonth - 1 + i * 3) % 12) + 1);
            }
            shouldCreate = quarterMonths.includes(month);
          } else {
            shouldCreate = [1, 4, 7, 10].includes(month);
          }
          break;
        case 'half_yearly':
          if (startMonth) {
            shouldCreate = month === startMonth || month === ((startMonth + 5) % 12) + 1;
          } else {
            shouldCreate = month === 1 || month === 7;
          }
          break;
        case 'yearly':
          shouldCreate = startMonth ? month === startMonth : month === 1;
          break;
        case 'custom':
          if (payment.customIntervalMonths && payment.customIntervalMonths > 0) {
            const interval = payment.customIntervalMonths;
            const refMonth = startMonth || ((payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getMonth() + 1);
            // Check if the current month falls on the custom interval cycle
            const monthDiff = ((month - refMonth) % 12 + 12) % 12;
            const yearDiff = year - (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
            const totalMonthsDiff = yearDiff * 12 + (month - refMonth);
            shouldCreate = totalMonthsDiff >= 0 && totalMonthsDiff % interval === 0;
          } else {
            shouldCreate = true; // fallback to monthly if no interval set
          }
          break;
        case 'one_time':
          shouldCreate = false;
          break;
        case 'day_interval':
          // Day-interval occurrences are event-driven (created at scheduled-payment creation
          // and again each time the current one is marked paid — see routes.ts), never by
          // this month-batch generator.
          shouldCreate = false;
          break;
        default:
          shouldCreate = true;
      }

      if (shouldCreate) {
        const existing = await db.select().from(paymentOccurrences)
          .where(and(
            eq(paymentOccurrences.scheduledPaymentId, payment.id),
            eq(paymentOccurrences.month, month),
            eq(paymentOccurrences.year, year)
          ));

        if (existing.length === 0) {
          let dueDateObj: Date;
          
          // Calculate due date based on due date type
          if (payment.dueDateType === 'salary_day') {
            // Get user's salary profile to use monthly cycle start date
            const [salaryProfile] = await db.select()
              .from(salaryProfiles)
              .where(eq(salaryProfiles.userId, payment.userId));
            
            if (salaryProfile && salaryProfile.monthCycleStartDay) {
              // Use the monthly cycle start date (when financial month begins)
              const cycleDay = Math.min(salaryProfile.monthCycleStartDay, new Date(year, month, 0).getDate());
              dueDateObj = new Date(year, month - 1, cycleDay);
            } else {
              // Fallback to 1st of month if no salary profile or no cycle start date
              dueDateObj = new Date(year, month - 1, 1);
            }
          } else {
            // Fixed day - use the dueDate from payment
            const dueDay = Math.min(payment.dueDate || 1, new Date(year, month, 0).getDate());
            dueDateObj = new Date(year, month - 1, dueDay);
          }
          
          // Auto-calculate amount for credit card bills
          let occurrenceAmount: string | undefined;
          if (payment.paymentType === 'credit_card_bill' && !payment.amount && payment.creditCardAccountId) {
            // Get the credit card account to find billing date
            const [creditCardAccount] = await db.select()
              .from(accounts)
              .where(eq(accounts.id, payment.creditCardAccountId));
            
            if (creditCardAccount && creditCardAccount.billingDate) {
              const billingDate = creditCardAccount.billingDate;
              
              // Calculate previous billing cycle dates
              // Cycle is from billingDate of previous month to (billingDate - 1) of current month
              const cycleStartDate = new Date(year, month - 2, billingDate);
              const cycleEndDate = new Date(year, month - 1, billingDate - 1);
              
              // Get all debit transactions on this credit card during the billing cycle
              const cycleTransactions = await db.select()
                .from(transactions)
                .where(
                  and(
                    eq(transactions.accountId, payment.creditCardAccountId),
                    eq(transactions.type, 'debit'),
                    gte(transactions.transactionDate, cycleStartDate),
                    lte(transactions.transactionDate, cycleEndDate)
                  )
                );
              
              // Sum up the amounts
              const totalSpending = cycleTransactions.reduce((sum, t) => {
                return sum + parseFloat(t.amount);
              }, 0);
              
              occurrenceAmount = totalSpending.toFixed(2);
            }
          }
          
          const [newOccurrence] = await db.insert(paymentOccurrences).values({
            scheduledPaymentId: payment.id,
            month,
            year,
            dueDate: dueDateObj,
            status: 'pending',
            ...(occurrenceAmount && { paidAmount: occurrenceAmount }),
          }).returning();
          generatedOccurrences.push(newOccurrence);
        }
      }
    }

    return generatedOccurrences;
  }

  // Savings Goals
  async getAllSavingsGoals(userId?: number): Promise<SavingsGoal[]> {
    if (userId) {
      return db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)).orderBy(desc(savingsGoals.createdAt));
    }
    return db.select().from(savingsGoals).orderBy(desc(savingsGoals.createdAt));
  }

  async getSavingsGoal(id: number): Promise<SavingsGoal | undefined> {
    const [goal] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, id));
    return goal || undefined;
  }

  async createSavingsGoal(goal: InsertSavingsGoal): Promise<SavingsGoal> {
    const [newGoal] = await db.insert(savingsGoals).values(goal).returning();
    return newGoal;
  }

  async updateSavingsGoal(id: number, goal: Partial<InsertSavingsGoal>): Promise<SavingsGoal | undefined> {
    const [updated] = await db.update(savingsGoals)
      .set({ ...goal, updatedAt: new Date() })
      .where(eq(savingsGoals.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteSavingsGoal(id: number): Promise<boolean> {
    console.log(`[deleteSavingsGoal] Starting deletion of goal ${id}`);
    
    // Get the goal to access account configuration
    const [goal] = await db.select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, id));
    
    if (!goal) {
      console.log(`[deleteSavingsGoal] Goal ${id} not found`);
      return false;
    }
    
    console.log(`[deleteSavingsGoal] Goal found: ${goal.name}, accountId: ${goal.accountId}, toAccountId: ${goal.toAccountId}`);
    
    // Get all contributions before deleting
    const contributions = await db.select()
      .from(savingsContributions)
      .where(eq(savingsContributions.savingsGoalId, id));

    console.log(`[deleteSavingsGoal] Found ${contributions.length} contributions to delete`);

    // Delete all transactions associated with this goal's contributions
    for (const contribution of contributions) {
      console.log(`[deleteSavingsGoal] Processing contribution ${contribution.id}, amount: ${contribution.amount}`);
      
      // Delete transaction from accountId (debit)
      if (contribution.accountId) {
        const fromTransactions = await db.select()
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, contribution.accountId),
              eq(transactions.savingsContributionId, contribution.id)
            )
          );
        
        console.log(`[deleteSavingsGoal] Found ${fromTransactions.length} debit transactions for contribution ${contribution.id}`);
        
        for (const transaction of fromTransactions) {
          console.log(`[deleteSavingsGoal] Deleting debit transaction ${transaction.id}`);
          // Delete transaction (this will automatically update account balance)
          await this.deleteTransaction(transaction.id);
        }
      }
      
      // Delete transaction to toAccountId (credit)
      if (goal.toAccountId) {
        const toTransactions = await db.select()
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, goal.toAccountId),
              eq(transactions.savingsContributionId, contribution.id)
            )
          );
        
        console.log(`[deleteSavingsGoal] Found ${toTransactions.length} credit transactions for contribution ${contribution.id}`);
        
        for (const transaction of toTransactions) {
          console.log(`[deleteSavingsGoal] Deleting credit transaction ${transaction.id}`);
          // Delete transaction (this will automatically update account balance)
          await this.deleteTransaction(transaction.id);
        }
      }
    }

    console.log(`[deleteSavingsGoal] Deleting ${contributions.length} contributions`);
    // Delete all contributions
    await db.delete(savingsContributions).where(eq(savingsContributions.savingsGoalId, id));
    
    console.log(`[deleteSavingsGoal] Deleting goal ${id}`);
    // Delete the savings goal
    const result = await db.delete(savingsGoals).where(eq(savingsGoals.id, id)).returning();
    
    console.log(`[deleteSavingsGoal] Goal deletion complete, success: ${result.length > 0}`);
    return result.length > 0;
  }

  // Savings Contributions
  async getSavingsContributions(goalId: number): Promise<SavingsContribution[]> {
    const contributions = await db.select({
      contribution: savingsContributions,
      account: accounts,
    })
      .from(savingsContributions)
      .leftJoin(accounts, eq(savingsContributions.accountId, accounts.id))
      .where(eq(savingsContributions.savingsGoalId, goalId))
      .orderBy(desc(savingsContributions.contributedAt));
    
    return contributions.map(c => ({
      ...c.contribution,
      account: c.account || undefined,
    })) as any;
  }

  async getSavingsContribution(id: number): Promise<SavingsContribution | undefined> {
    const [contribution] = await db.select()
      .from(savingsContributions)
      .where(eq(savingsContributions.id, id));
    return contribution;
  }

  async createSavingsContribution(contribution: InsertSavingsContribution): Promise<SavingsContribution> {
    const [newContribution] = await db.insert(savingsContributions).values({
      ...contribution,
      contributedAt: contribution.contributedAt ? new Date(contribution.contributedAt) : new Date(),
    }).returning();

    const goal = await this.getSavingsGoal(contribution.savingsGoalId);
    if (goal) {
      const currentAmount = parseFloat(goal.currentAmount || '0');
      const addAmount = parseFloat(contribution.amount);
      await this.updateSavingsGoal(goal.id, {
        currentAmount: (currentAmount + addAmount).toFixed(2),
      });
    }

    return newContribution;
  }

  async deleteSavingsContribution(id: number): Promise<boolean> {
    const contribution = await db.select().from(savingsContributions).where(eq(savingsContributions.id, id));
    if (contribution.length > 0) {
      const goal = await this.getSavingsGoal(contribution[0].savingsGoalId);
      if (goal) {
        const currentAmount = parseFloat(goal.currentAmount || '0');
        const subtractAmount = parseFloat(contribution[0].amount);
        await this.updateSavingsGoal(goal.id, {
          currentAmount: Math.max(0, currentAmount - subtractAmount).toFixed(2),
        });
      }
    }
    const result = await db.delete(savingsContributions).where(eq(savingsContributions.id, id)).returning();
    return result.length > 0;
  }

  // Salary Profiles
  async getSalaryProfile(userId?: number): Promise<SalaryProfile | undefined> {
    if (userId) {
      const [profile] = await db.select().from(salaryProfiles).where(eq(salaryProfiles.userId, userId));
      return profile || undefined;
    }
    const [profile] = await db.select().from(salaryProfiles).limit(1);
    return profile || undefined;
  }

  async createSalaryProfile(profile: InsertSalaryProfile): Promise<SalaryProfile> {
    const [newProfile] = await db.insert(salaryProfiles).values(profile).returning();
    return newProfile;
  }

  async updateSalaryProfile(id: number, profile: Partial<InsertSalaryProfile>): Promise<SalaryProfile | undefined> {
    const [updated] = await db.update(salaryProfiles)
      .set({ ...profile, updatedAt: new Date() })
      .where(eq(salaryProfiles.id, id))
      .returning();
    return updated || undefined;
  }

  // Salary Cycles
  async getSalaryCycles(profileId: number, limit?: number): Promise<SalaryCycle[]> {
    let query = db.select().from(salaryCycles)
      .where(eq(salaryCycles.salaryProfileId, profileId))
      .orderBy(desc(salaryCycles.year), desc(salaryCycles.month))
      .$dynamic();
    
    if (limit) {
      query = query.limit(limit);
    }
    
    return query;
  }

  async getSalaryCycle(id: number): Promise<SalaryCycle | undefined> {
    const [cycle] = await db.select().from(salaryCycles).where(eq(salaryCycles.id, id));
    return cycle || undefined;
  }

  async createSalaryCycle(cycle: InsertSalaryCycle): Promise<SalaryCycle> {
    const [newCycle] = await db.insert(salaryCycles).values({
      ...cycle,
      expectedPayDate: cycle.expectedPayDate ? new Date(cycle.expectedPayDate) : new Date(),
      actualPayDate: cycle.actualPayDate ? new Date(cycle.actualPayDate) : undefined,
    }).returning();
    return newCycle;
  }

  async updateSalaryCycle(id: number, cycle: Partial<InsertSalaryCycle>): Promise<SalaryCycle | undefined> {
    const updateData: any = { ...cycle };
    if (cycle.actualPayDate) {
      updateData.actualPayDate = new Date(cycle.actualPayDate);
    }
    const [updated] = await db.update(salaryCycles)
      .set(updateData)
      .where(eq(salaryCycles.id, id))
      .returning();
    return updated || undefined;
  }

  // Loans
  async getAllLoans(userId?: number): Promise<LoanWithRelations[]> {
    const conditions = [];
    if (userId) {
      conditions.push(eq(loans.userId, userId));
    }
    
    const results = await db.select({
      id: loans.id,
      userId: loans.userId,
      accountId: loans.accountId,
      name: loans.name,
      type: loans.type,
      lenderName: loans.lenderName,
      loanAccountNumber: loans.loanAccountNumber,
      principalAmount: loans.principalAmount,
      outstandingAmount: loans.outstandingAmount,
      receivedAmount: loans.receivedAmount,
      interestRate: loans.interestRate,
      tenure: loans.tenure,
      emiAmount: loans.emiAmount,
      emiDay: loans.emiDay,
      startDate: loans.startDate,
      endDate: loans.endDate,
      status: loans.status,
      isExistingLoan: loans.isExistingLoan,
      nextEmiDate: loans.nextEmiDate,
      closureDate: loans.closureDate,
      closureAmount: loans.closureAmount,
      createTransaction: loans.createTransaction,
      affectBalance: loans.affectBalance,
      includesBtClosure: loans.includesBtClosure,
      closedViaBtFromLoanId: loans.closedViaBtFromLoanId,
      notes: loans.notes,
      createdAt: loans.createdAt,
      updatedAt: loans.updatedAt,
      account: accounts,
    })
    .from(loans)
    .leftJoin(accounts, eq(loans.accountId, accounts.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(loans.createdAt));

    return results as LoanWithRelations[];
  }

  async getLoan(id: number): Promise<LoanWithRelations | undefined> {
    const [result] = await db.select({
      id: loans.id,
      userId: loans.userId,
      accountId: loans.accountId,
      name: loans.name,
      type: loans.type,
      lenderName: loans.lenderName,
      loanAccountNumber: loans.loanAccountNumber,
      principalAmount: loans.principalAmount,
      outstandingAmount: loans.outstandingAmount,
      receivedAmount: loans.receivedAmount,
      interestRate: loans.interestRate,
      tenure: loans.tenure,
      emiAmount: loans.emiAmount,
      emiDay: loans.emiDay,
      startDate: loans.startDate,
      endDate: loans.endDate,
      status: loans.status,
      isExistingLoan: loans.isExistingLoan,
      nextEmiDate: loans.nextEmiDate,
      closureDate: loans.closureDate,
      closureAmount: loans.closureAmount,
      createTransaction: loans.createTransaction,
      affectBalance: loans.affectBalance,
      includesBtClosure: loans.includesBtClosure,
      closedViaBtFromLoanId: loans.closedViaBtFromLoanId,
      notes: loans.notes,
      createdAt: loans.createdAt,
      updatedAt: loans.updatedAt,
      account: accounts,
    })
    .from(loans)
    .leftJoin(accounts, eq(loans.accountId, accounts.id))
    .where(eq(loans.id, id));

    if (!result) return undefined;

    const installments = await this.getLoanInstallments(id);
    const components = await this.getLoanComponents(id);

    return { ...result, installments, components } as LoanWithRelations;
  }

  async createLoan(loan: InsertLoan): Promise<Loan> {
    const [newLoan] = await db.insert(loans).values({
      ...loan,
      startDate: loan.startDate ? new Date(loan.startDate) : new Date(),
      endDate: loan.endDate ? new Date(loan.endDate) : undefined,
      nextEmiDate: loan.nextEmiDate ? new Date(loan.nextEmiDate) : undefined,
      closureDate: loan.closureDate ? new Date(loan.closureDate) : undefined,
    }).returning();
    return newLoan;
  }

  async updateLoan(id: number, loan: Partial<InsertLoan>): Promise<Loan | undefined> {
    const updateData: any = { ...loan, updatedAt: new Date() };
    if (loan.startDate) {
      updateData.startDate = new Date(loan.startDate);
    }
    if (loan.endDate) {
      updateData.endDate = new Date(loan.endDate);
    }
    if (loan.nextEmiDate) {
      updateData.nextEmiDate = new Date(loan.nextEmiDate);
    }
    if (loan.closureDate) {
      updateData.closureDate = new Date(loan.closureDate);
    }
    const [updated] = await db.update(loans)
      .set(updateData)
      .where(eq(loans.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteLoan(id: number): Promise<boolean> {
    // Delete related records first (due to foreign key constraints)
    await db.delete(loanPayments).where(eq(loanPayments.loanId, id));
    await db.delete(loanInstallments).where(eq(loanInstallments.loanId, id));
    await db.delete(loanSpendingEntries).where(eq(loanSpendingEntries.loanId, id));
    await db.delete(loanTerms).where(eq(loanTerms.loanId, id));
    await db.delete(loanComponents).where(eq(loanComponents.loanId, id));
    // Delete BT allocations where this loan is either source or target
    await db.delete(loanBtAllocations).where(eq(loanBtAllocations.sourceLoanId, id));
    await db.delete(loanBtAllocations).where(eq(loanBtAllocations.targetLoanId, id));
    const result = await db.delete(loans).where(eq(loans.id, id)).returning();
    return result.length > 0;
  }

  // Loan Components
  async getLoanComponents(loanId: number): Promise<LoanComponent[]> {
    return db.select().from(loanComponents)
      .where(eq(loanComponents.loanId, loanId))
      .orderBy(desc(loanComponents.createdAt));
  }

  async createLoanComponent(component: InsertLoanComponent): Promise<LoanComponent> {
    const [newComponent] = await db.insert(loanComponents).values({
      ...component,
      startDate: component.startDate ? new Date(component.startDate) : new Date(),
      endDate: component.endDate ? new Date(component.endDate) : undefined,
    }).returning();
    return newComponent;
  }

  async updateLoanComponent(id: number, component: Partial<InsertLoanComponent>): Promise<LoanComponent | undefined> {
    const updateData: any = { ...component };
    if (component.startDate) {
      updateData.startDate = new Date(component.startDate);
    }
    if (component.endDate) {
      updateData.endDate = new Date(component.endDate);
    }
    const [updated] = await db.update(loanComponents)
      .set(updateData)
      .where(eq(loanComponents.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteLoanComponent(id: number): Promise<boolean> {
    await db.delete(loanInstallments).where(eq(loanInstallments.loanComponentId, id));
    const result = await db.delete(loanComponents).where(eq(loanComponents.id, id)).returning();
    return result.length > 0;
  }

  // Loan Installments
  async regenerateLoanInstallments(loanId: number): Promise<LoanInstallment[]> {
    // console.log('Storage: Regenerating installments for loan:', loanId);
    // Delete all pending installments
    const deleteResult = await db.delete(loanInstallments)
      .where(and(
        eq(loanInstallments.loanId, loanId),
        eq(loanInstallments.status, 'pending')
      ));
    // console.log('Storage: Deleted pending installments');
    
    // Generate new installments using current date as base
    // console.log('Storage: Generating new installments from current date...');
    const newInstallments = await this.generateLoanInstallments(loanId, true);
    // console.log('Storage: Generated', newInstallments.length, 'new installments');
    
    // Update loan's nextEmiDate with the first pending installment's due date
    if (newInstallments.length > 0) {
      const firstInstallmentDate = newInstallments[0].dueDate;
      await db.update(loans)
        .set({
          nextEmiDate: firstInstallmentDate,
          updatedAt: new Date(),
        })
        .where(eq(loans.id, loanId));
      // console.log('Storage: Updated loan nextEmiDate to:', firstInstallmentDate);
    }
    
    return newInstallments;
  }

  async getLoanInstallments(loanId: number): Promise<LoanInstallment[]> {
    return db.select().from(loanInstallments)
      .where(eq(loanInstallments.loanId, loanId))
      .orderBy(loanInstallments.installmentNumber);
  }

  async getLoanInstallment(id: number): Promise<LoanInstallment | undefined> {
    const [installment] = await db.select().from(loanInstallments).where(eq(loanInstallments.id, id));
    return installment || undefined;
  }

  async createLoanInstallment(installment: InsertLoanInstallment): Promise<LoanInstallment> {
    const [newInstallment] = await db.insert(loanInstallments).values({
      ...installment,
      dueDate: installment.dueDate ? new Date(installment.dueDate) : new Date(),
      paidDate: installment.paidDate ? new Date(installment.paidDate) : undefined,
    }).returning();
    return newInstallment;
  }

  async updateLoanInstallment(id: number, installment: Partial<InsertLoanInstallment>): Promise<LoanInstallment | undefined> {
    const updateData: any = { ...installment };
    if (installment.dueDate) {
      updateData.dueDate = installment.dueDate instanceof Date ? installment.dueDate : new Date(installment.dueDate);
    }
    if (installment.paidDate) {
      updateData.paidDate = installment.paidDate instanceof Date ? installment.paidDate : new Date(installment.paidDate);
    }
    const [updated] = await db.update(loanInstallments)
      .set(updateData)
      .where(eq(loanInstallments.id, id))
      .returning();
    return updated || undefined;
  }

  async generateLoanInstallments(loanId: number, useCurrentDate = false): Promise<LoanInstallment[]> {
    const loan = await this.getLoan(loanId);
    if (!loan || !loan.emiAmount || !loan.tenure) return [];

    // Delete existing installments for this loan
    await db.delete(loanInstallments).where(eq(loanInstallments.loanId, loanId));

    const generatedInstallments: LoanInstallment[] = [];
    const emiAmount = parseFloat(loan.emiAmount);
    const interestRate = parseFloat(loan.interestRate) / 100 / 12; // Monthly rate
    
    // Determine the base date for calculation
    let baseDate: Date;
    if (useCurrentDate) {
      // For regeneration, always start from current month
      baseDate = new Date();
      // console.log('Using current date as base:', baseDate.toISOString());
    } else {
      // For initial generation, use existing logic
      const isExistingLoan = loan.isExistingLoan ?? false;
      baseDate = isExistingLoan && loan.nextEmiDate 
        ? new Date(loan.nextEmiDate) 
        : new Date(loan.startDate);
      // console.log('Using stored date as base:', baseDate.toISOString());
    }
    
    const emiDay = loan.emiDay || baseDate.getDate();
    // console.log('EMI day:', emiDay, 'Base date:', baseDate.toISOString());
    
    // For existing loans, use outstanding amount as the starting principal
    const isExistingLoan = loan.isExistingLoan ?? false;
    const principal = isExistingLoan 
      ? parseFloat(loan.outstandingAmount) 
      : parseFloat(loan.principalAmount);
    
    let remainingPrincipal = principal;

    // Determine the starting index based on whether current month should be included
    // If today's date < EMI date in current month, include current month (start from i=0)
    // Otherwise, start from next month (i=1)
    // This logic applies to both initial generation and regeneration
    const today = new Date();
    const currentDayOfMonth = today.getDate();
    const shouldIncludeCurrentMonth = currentDayOfMonth < emiDay;
    const startIndex = shouldIncludeCurrentMonth ? 0 : 1;
    
    // console.log('Current day:', currentDayOfMonth, 'EMI day:', emiDay, 
    //             'Should include current month:', shouldIncludeCurrentMonth, 
    //             'Start index:', startIndex, 'Use current date:', useCurrentDate);

    for (let i = startIndex; i <= loan.tenure + startIndex - 1; i++) {
      // Calculate interest for this installment
      const interestAmount = remainingPrincipal * interestRate;
      // Principal is the remaining amount after interest
      // This ensures principalAmount + interestAmount = emiAmount exactly
      const principalAmount = emiAmount - interestAmount;
      remainingPrincipal = Math.max(0, remainingPrincipal - principalAmount);

      // Calculate due date - start from baseDate and add months
      const baseYear = baseDate.getFullYear();
      const baseMonth = baseDate.getMonth();
      const targetMonth = baseMonth + i;
      const targetYear = baseYear + Math.floor(targetMonth / 12);
      const adjustedMonth = targetMonth % 12;
      let dueDate = new Date(targetYear, adjustedMonth, 1);
      // Set the day, ensuring it doesn't exceed the month's last day
      const lastDayOfMonth = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate();
      dueDate.setDate(Math.min(emiDay, lastDayOfMonth));

      // Installment number should always start from 1
      const installmentNumber = i - startIndex + 1;

      const [newInstallment] = await db.insert(loanInstallments).values({
        loanId,
        installmentNumber,
        dueDate,
        emiAmount: emiAmount.toFixed(2),
        principalAmount: principalAmount.toFixed(2),
        interestAmount: interestAmount.toFixed(2),
        status: 'pending',
      }).returning();

      generatedInstallments.push(newInstallment);
    }

    return generatedInstallments;
  }

  async markInstallmentPaid(id: number, paidAmount: string, transactionId?: number): Promise<LoanInstallment | undefined> {
    const installment = await this.getLoanInstallment(id);
    if (!installment) return undefined;

    const [updated] = await db.update(loanInstallments)
      .set({
        status: 'paid',
        paidAmount,
        paidDate: new Date(),
        transactionId,
      })
      .where(eq(loanInstallments.id, id))
      .returning();

    // Update loan outstanding amount
    if (updated && installment.principalAmount) {
      const loan = await db.select().from(loans).where(eq(loans.id, installment.loanId));
      if (loan.length > 0) {
        const currentOutstanding = parseFloat(loan[0].outstandingAmount);
        const principalPaid = parseFloat(installment.principalAmount);
        await db.update(loans)
          .set({
            outstandingAmount: Math.max(0, currentOutstanding - principalPaid).toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(loans.id, installment.loanId));
      }
    }

    return updated || undefined;
  }

  // Loan Spending Entries
  async getLoanSpendingEntries(loanId: number): Promise<LoanSpendingEntry[]> {
    return db.select().from(loanSpendingEntries)
      .where(eq(loanSpendingEntries.loanId, loanId))
      .orderBy(desc(loanSpendingEntries.createdAt));
  }

  async createLoanSpendingEntry(entry: InsertLoanSpendingEntry): Promise<LoanSpendingEntry> {
    const [newEntry] = await db.insert(loanSpendingEntries).values(entry).returning();
    return newEntry;
  }

  async deleteLoanSpendingEntry(id: number): Promise<boolean> {
    const result = await db.delete(loanSpendingEntries).where(eq(loanSpendingEntries.id, id)).returning();
    return result.length > 0;
  }

  // Card Details
  async getCardDetails(accountId: number): Promise<CardDetails | undefined> {
    const [card] = await db.select().from(cardDetails).where(eq(cardDetails.accountId, accountId));
    return card || undefined;
  }

  async getCardDetailsByLastFourDigits(lastFourDigits: string, userId?: number): Promise<CardDetails | undefined> {
    const conditions = [eq(cardDetails.lastFourDigits, lastFourDigits), eq(cardDetails.isActive, true)];
    if (userId) {
      conditions.push(eq(accounts.userId, userId));
    }
    const [card] = await db.select({ cardDetails })
      .from(cardDetails)
      .innerJoin(accounts, eq(cardDetails.accountId, accounts.id))
      .where(and(...conditions))
      .limit(1);
    return card?.cardDetails;
  }

  async createCardDetails(card: InsertCardDetails): Promise<CardDetails> {
    const [newCard] = await db.insert(cardDetails).values(card).returning();
    return newCard;
  }

  async updateCardDetails(id: number, card: Partial<InsertCardDetails>): Promise<CardDetails | undefined> {
    const [updated] = await db.update(cardDetails)
      .set({ ...card, updatedAt: new Date() })
      .where(eq(cardDetails.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteCardDetails(id: number): Promise<boolean> {
    const result = await db.delete(cardDetails).where(eq(cardDetails.id, id)).returning();
    return result.length > 0;
  }

  // Loan Terms
  async getLoanTerms(loanId: number): Promise<LoanTerm[]> {
    return db.select().from(loanTerms)
      .where(eq(loanTerms.loanId, loanId))
      .orderBy(desc(loanTerms.effectiveFrom));
  }

  async getLoanTerm(id: number): Promise<LoanTerm | undefined> {
    const [term] = await db.select().from(loanTerms).where(eq(loanTerms.id, id));
    return term || undefined;
  }

  async createLoanTerm(term: InsertLoanTerm): Promise<LoanTerm> {
    // Close any existing open term (set effectiveTo)
    const openTerms = await db.select().from(loanTerms)
      .where(and(eq(loanTerms.loanId, term.loanId), sql`${loanTerms.effectiveTo} IS NULL`));
    
    for (const openTerm of openTerms) {
      await db.update(loanTerms)
        .set({ effectiveTo: term.effectiveFrom })
        .where(eq(loanTerms.id, openTerm.id));
    }

    const [newTerm] = await db.insert(loanTerms).values(term).returning();
    
    // Update the loan with new interest rate, tenure, and EMI
    await db.update(loans).set({
      interestRate: term.interestRate,
      tenure: term.tenureMonths,
      emiAmount: term.emiAmount,
      updatedAt: new Date()
    }).where(eq(loans.id, term.loanId));

    return newTerm;
  }

  async updateLoanTerm(id: number, term: Partial<InsertLoanTerm>): Promise<LoanTerm | undefined> {
    const [updated] = await db.update(loanTerms).set(term).where(eq(loanTerms.id, id)).returning();
    return updated || undefined;
  }

  // Loan Payments
  async getLoanPayments(loanId: number): Promise<LoanPayment[]> {
    return db.select().from(loanPayments)
      .where(eq(loanPayments.loanId, loanId))
      .orderBy(desc(loanPayments.paymentDate));
  }

  async getLoanPayment(id: number): Promise<LoanPayment | undefined> {
    const [payment] = await db.select().from(loanPayments).where(eq(loanPayments.id, id));
    return payment || undefined;
  }

  async createLoanPayment(payment: InsertLoanPayment): Promise<LoanPayment> {
    let principalPaid = payment.principalPaid ? parseFloat(payment.principalPaid) : 0;
    
    // If payment is linked to an installment and principalPaid not specified, get from installment
    if (payment.installmentId && !payment.principalPaid) {
      const installment = await this.getLoanInstallment(payment.installmentId);
      if (installment) {
        principalPaid = parseFloat(installment.principalAmount || '0');
      }
    }
    
    // For prepayments, assume full amount reduces principal
    if (payment.paymentType === 'prepayment' && !payment.principalPaid) {
      principalPaid = parseFloat(payment.amount);
    }

    const [newPayment] = await db.insert(loanPayments).values({
      ...payment,
      principalPaid: principalPaid.toFixed(2)
    }).returning();

    // Get loan details for transaction and balance operations
    const loan = await this.getLoan(payment.loanId);
    
    if (loan) {
      // Update outstanding amount - only subtract principal component
      if (principalPaid > 0) {
        const currentOutstanding = parseFloat(loan.outstandingAmount) || 0;
        const newOutstanding = Math.max(0, currentOutstanding - principalPaid);
        
        await db.update(loans).set({
          outstandingAmount: newOutstanding.toFixed(2),
          updatedAt: new Date()
        }).where(eq(loans.id, payment.loanId));
      }

      // Create transaction if enabled
      if (loan.createTransaction && loan.accountId) {
        const paymentAmount = parseFloat(payment.amount);
        const paymentDateStr = typeof payment.paymentDate === 'string' 
          ? payment.paymentDate 
          : (payment.paymentDate instanceof Date ? payment.paymentDate.toISOString() : new Date().toISOString());
        await this.createTransaction({
          userId: loan.userId,
          accountId: loan.accountId,
          categoryId: 15,
          type: 'debit',
          amount: paymentAmount.toFixed(2),
          merchant: '[AUTO] Loan Payment',
          description: `Loan EMI - ${loan.name}`,
          transactionDate: paymentDateStr,
        });
      }

      // Affect account balance if enabled
      if (loan.affectBalance && loan.accountId) {
        const account = await this.getAccount(loan.accountId);
        if (account) {
          const paymentAmount = parseFloat(payment.amount);
          const currentBalance = parseFloat(account.balance || '0');
          const newBalance = currentBalance - paymentAmount;
          
          await db.update(accounts).set({
            balance: newBalance.toFixed(2),
            updatedAt: new Date()
          }).where(eq(accounts.id, loan.accountId));
        }
      }
    }

    // If linked to an installment, mark it as paid
    if (payment.installmentId) {
      await this.updateLoanInstallment(payment.installmentId, {
        status: 'paid',
        paidAmount: payment.amount,
        paidDate: payment.paymentDate
      });
    }

    return newPayment;
  }

  async updateLoanPayment(id: number, payment: Partial<InsertLoanPayment>): Promise<LoanPayment | undefined> {
    const existingPayment = await this.getLoanPayment(id);
    if (!existingPayment) return undefined;

    // If principal amount changes, adjust outstanding balance
    if (payment.principalPaid !== undefined) {
      const oldPrincipal = parseFloat(existingPayment.principalPaid || '0');
      const newPrincipal = parseFloat(payment.principalPaid || '0');
      const difference = newPrincipal - oldPrincipal;

      if (difference !== 0) {
        const loan = await this.getLoan(existingPayment.loanId);
        if (loan) {
          const currentOutstanding = parseFloat(loan.outstandingAmount) || 0;
          const newOutstanding = Math.max(0, currentOutstanding - difference);
          await db.update(loans).set({
            outstandingAmount: newOutstanding.toFixed(2),
            updatedAt: new Date()
          }).where(eq(loans.id, existingPayment.loanId));
        }
      }
    }

    const [updated] = await db.update(loanPayments)
      .set(payment)
      .where(eq(loanPayments.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteLoanPayment(id: number): Promise<boolean> {
    const existingPayment = await this.getLoanPayment(id);
    if (!existingPayment) return false;

    // Reverse the principal reduction on outstanding balance
    const principalPaid = parseFloat(existingPayment.principalPaid || '0');
    if (principalPaid > 0) {
      const loan = await this.getLoan(existingPayment.loanId);
      if (loan) {
        const currentOutstanding = parseFloat(loan.outstandingAmount) || 0;
        const newOutstanding = currentOutstanding + principalPaid;
        await db.update(loans).set({
          outstandingAmount: newOutstanding.toFixed(2),
          updatedAt: new Date()
        }).where(eq(loans.id, existingPayment.loanId));
      }
    }

    // If linked to installment, revert to pending
    if (existingPayment.installmentId) {
      await this.updateLoanInstallment(existingPayment.installmentId, {
        status: 'pending',
        paidAmount: undefined,
        paidDate: undefined
      });
    }

    const result = await db.delete(loanPayments).where(eq(loanPayments.id, id)).returning();
    return result.length > 0;
  }

  // Auto-funded policies (e.g. a market/sub policy funded by a main policy's benefit) never get
  // a manual "mark as paid" action — any premium whose due date has already passed is settled
  // automatically so it reads as a historical investment record, not an outstanding bill.
  private async reconcileAutoFundedPremiums(insurance: Insurance, premiums: InsurancePremium[]): Promise<InsurancePremium[]> {
    if (!insurance.autoFunded) return premiums;

    const now = new Date();
    for (const premium of premiums) {
      if (premium.status !== 'paid' && new Date(premium.dueDate) <= now) {
        premium.status = 'paid';
        premium.paidAmount = premium.amount;
        premium.paidDate = premium.dueDate;
        await db.update(insurancePremiums)
          .set({ status: 'paid', paidAmount: premium.amount, paidDate: premium.dueDate })
          .where(eq(insurancePremiums.id, premium.id));
      }
    }
    return premiums;
  }

  // Insurance
  async getAllInsurances(userId?: number): Promise<InsuranceWithRelations[]> {
    const allInsurances = userId
      ? await db.select().from(insurances).where(eq(insurances.userId, userId)).orderBy(desc(insurances.createdAt))
      : await db.select().from(insurances).orderBy(desc(insurances.createdAt));

    // Each insurance's account/premiums/linked-policy lookups are independent of the other
    // insurances — was previously 3+ sequential queries repeated per insurance in a for-loop.
    return Promise.all(allInsurances.map(async (insurance) => {
      const [accountRows, rawPremiums, linkedRows] = await Promise.all([
        insurance.accountId
          ? db.select().from(accounts).where(eq(accounts.id, insurance.accountId))
          : Promise.resolve([] as Account[]),
        db.select().from(insurancePremiums).where(eq(insurancePremiums.insuranceId, insurance.id)).orderBy(insurancePremiums.dueDate),
        insurance.linkedInsuranceId
          ? db.select().from(insurances).where(eq(insurances.id, insurance.linkedInsuranceId))
          : Promise.resolve([] as Insurance[]),
      ]);
      const premiums = await this.reconcileAutoFundedPremiums(insurance, rawPremiums);
      return { ...insurance, account: accountRows[0], premiums, linkedInsurance: linkedRows[0] };
    }));
  }

  async getInsurance(id: number): Promise<InsuranceWithRelations | undefined> {
    const [insurance] = await db.select().from(insurances).where(eq(insurances.id, id));
    if (!insurance) return undefined;

    const [account] = insurance.accountId
      ? await db.select().from(accounts).where(eq(accounts.id, insurance.accountId))
      : [null];
    let premiums = await db.select().from(insurancePremiums)
      .where(eq(insurancePremiums.insuranceId, id))
      .orderBy(insurancePremiums.dueDate);
    premiums = await this.reconcileAutoFundedPremiums(insurance, premiums);
    const [linkedInsurance] = insurance.linkedInsuranceId
      ? await db.select().from(insurances).where(eq(insurances.id, insurance.linkedInsuranceId))
      : [null];

    return { ...insurance, account, premiums, linkedInsurance };
  }

  async createInsurance(insurance: InsertInsurance): Promise<Insurance> {
    const [newInsurance] = await db.insert(insurances).values(insurance).returning();
    return newInsurance;
  }

  async updateInsurance(id: number, insurance: Partial<InsertInsurance>): Promise<Insurance | undefined> {
    const [updated] = await db.update(insurances)
      .set({ ...insurance, updatedAt: new Date() })
      .where(eq(insurances.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteInsurance(id: number): Promise<boolean> {
    // Delete all premiums first
    await db.delete(insurancePremiums).where(eq(insurancePremiums.insuranceId, id));
    const result = await db.delete(insurances).where(eq(insurances.id, id)).returning();
    return result.length > 0;
  }

  // Insurance Premiums
  async getInsurancePremiums(insuranceId: number): Promise<InsurancePremium[]> {
    return db.select().from(insurancePremiums)
      .where(eq(insurancePremiums.insuranceId, insuranceId))
      .orderBy(insurancePremiums.dueDate);
  }

  async getInsurancePremium(id: number): Promise<InsurancePremium | undefined> {
    const [premium] = await db.select().from(insurancePremiums).where(eq(insurancePremiums.id, id));
    return premium || undefined;
  }

  async createInsurancePremium(premium: InsertInsurancePremium): Promise<InsurancePremium> {
    const [newPremium] = await db.insert(insurancePremiums).values(premium).returning();
    return newPremium;
  }

  async updateInsurancePremium(id: number, premium: Partial<InsertInsurancePremium>): Promise<InsurancePremium | undefined> {
    const [updated] = await db.update(insurancePremiums)
      .set(premium)
      .where(eq(insurancePremiums.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteInsurancePremium(id: number): Promise<boolean> {
    const result = await db.delete(insurancePremiums).where(eq(insurancePremiums.id, id)).returning();
    return result.length > 0;
  }

  async generateInsurancePremiums(insuranceId: number): Promise<InsurancePremium[]> {
    const insurance = await this.getInsurance(insuranceId);
    if (!insurance) return [];

    // Delete existing pending premiums
    await db.delete(insurancePremiums).where(
      and(
        eq(insurancePremiums.insuranceId, insuranceId),
        eq(insurancePremiums.status, 'pending')
      )
    );

    const premiumAmount = parseFloat(insurance.premiumAmount);
    const termsPerPeriod = insurance.termsPerPeriod || 1;
    const amountPerTerm = premiumAmount / termsPerPeriod;
    const startDate = new Date(insurance.startDate);
    const endDate = insurance.endDate ? new Date(insurance.endDate) : new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate());

    // Determine period length in months based on frequency
    let periodMonths = 12; // annual
    switch (insurance.premiumFrequency) {
      case 'semi_annual': periodMonths = 6; break;
      case 'quarterly': periodMonths = 3; break;
      case 'monthly': periodMonths = 1; break;
    }

    const createdPremiums: InsurancePremium[] = [];
    let currentDate = new Date(startDate);
    let periodNumber = 1;
    
    while (currentDate < endDate) {
      // Generate terms for this period
      for (let term = 1; term <= termsPerPeriod; term++) {
        const termOffset = ((term - 1) * periodMonths) / termsPerPeriod;
        const dueDate = new Date(currentDate);
        dueDate.setMonth(dueDate.getMonth() + Math.floor(termOffset));

        if (dueDate >= endDate) break;

        const premium = await this.createInsurancePremium({
          insuranceId,
          termNumber: term,
          periodYear: dueDate.getFullYear(),
          periodNumber,
          amount: amountPerTerm.toFixed(2),
          dueDate,
          status: 'pending'
        });
        createdPremiums.push(premium);
      }

      // Move to next period
      currentDate.setMonth(currentDate.getMonth() + periodMonths);
      periodNumber++;
    }

    return createdPremiums;
  }

  async markPremiumPaid(id: number, paidAmount: string, accountId?: number, transactionId?: number): Promise<InsurancePremium | undefined> {
    const premium = await this.getInsurancePremium(id);
    if (!premium) return undefined;

    const paidAmountNum = parseFloat(paidAmount);
    const dueAmount = parseFloat(premium.amount);
    const status = paidAmountNum >= dueAmount ? 'paid' : 'partially_paid';

    const [updated] = await db.update(insurancePremiums)
      .set({
        status,
        paidDate: new Date(),
        paidAmount,
        accountId,
        transactionId
      })
      .where(eq(insurancePremiums.id, id))
      .returning();

    // Update account balance if needed
    if (updated && accountId) {
      const insurance = await this.getInsurance(premium.insuranceId);
      if (insurance?.affectBalance) {
        await this.updateAccountBalance(accountId, paidAmount, 'subtract');
      }
    }

    return updated || undefined;
  }

  // Loan BT Allocations
  async getLoanBtAllocations(sourceLoanId: number): Promise<LoanBtAllocation[]> {
    return await db.select().from(loanBtAllocations)
      .where(eq(loanBtAllocations.sourceLoanId, sourceLoanId))
      .orderBy(loanBtAllocations.createdAt);
  }

  async getLoanBtAllocation(id: number): Promise<LoanBtAllocation | undefined> {
    const [allocation] = await db.select().from(loanBtAllocations).where(eq(loanBtAllocations.id, id));
    return allocation || undefined;
  }

  async getLoanBtAllocationsByTarget(targetLoanId: number): Promise<LoanBtAllocation[]> {
    return await db.select().from(loanBtAllocations)
      .where(eq(loanBtAllocations.targetLoanId, targetLoanId))
      .orderBy(loanBtAllocations.createdAt);
  }

  async createLoanBtAllocation(allocation: InsertLoanBtAllocation): Promise<LoanBtAllocation> {
    const [newAllocation] = await db.insert(loanBtAllocations).values({
      ...allocation,
      originalOutstandingAmount: allocation.originalOutstandingAmount,
      allocatedAmount: allocation.allocatedAmount,
      actualBtAmount: allocation.actualBtAmount,
      processingFee: allocation.processingFee,
      status: allocation.status || 'pending',
    }).returning();
    return newAllocation;
  }

  async updateLoanBtAllocation(id: number, allocation: Partial<InsertLoanBtAllocation>): Promise<LoanBtAllocation | undefined> {
    const [updated] = await db.update(loanBtAllocations)
      .set({ ...allocation, updatedAt: new Date() })
      .where(eq(loanBtAllocations.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteLoanBtAllocation(id: number): Promise<boolean> {
    const result = await db.delete(loanBtAllocations).where(eq(loanBtAllocations.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async processLoanBtPayment(id: number, actualBtAmount: string, processedDate: Date, processingFee?: string): Promise<{ allocation: LoanBtAllocation; targetLoan: Loan }> {
    const allocation = await this.getLoanBtAllocation(id);
    if (!allocation) {
      throw new Error('BT allocation not found');
    }

    const targetLoan = await this.getLoan(allocation.targetLoanId);
    if (!targetLoan) {
      throw new Error('Target loan not found');
    }

    const btAmount = parseFloat(actualBtAmount);
    const outstandingAmount = parseFloat(targetLoan.outstandingAmount);
    const sourceLoanId = allocation.sourceLoanId;

    // Validate BT amount
    if (btAmount > outstandingAmount) {
      throw new Error('BT amount cannot exceed outstanding amount');
    }

    // Determine if this is full closure or partial payment
    const isFullClosure = Math.abs(btAmount - outstandingAmount) < 0.01; // Allow for floating point precision
    const newOutstanding = isFullClosure ? 0 : outstandingAmount - btAmount;
    const newStatus = isFullClosure ? 'processed' : 'partial';

    // Update the BT allocation
    const [updatedAllocation] = await db.update(loanBtAllocations)
      .set({
        actualBtAmount,
        processedDate,
        processingFee: processingFee || null,
        status: newStatus,
        updatedAt: new Date()
      })
      .where(eq(loanBtAllocations.id, id))
      .returning();

    // Update the target loan
    const loanUpdateData: any = {
      outstandingAmount: newOutstanding.toFixed(2),
      updatedAt: new Date()
    };

    if (isFullClosure) {
      loanUpdateData.status = 'closed_bt';
      loanUpdateData.closureDate = processedDate;
      loanUpdateData.closureAmount = actualBtAmount;
      loanUpdateData.closedViaBtFromLoanId = sourceLoanId;
    }

    const [updatedLoan] = await db.update(loans)
      .set(loanUpdateData)
      .where(eq(loans.id, allocation.targetLoanId))
      .returning();

    return { allocation: updatedAllocation, targetLoan: updatedLoan };
  }
}

export const storage = new DatabaseStorage();
