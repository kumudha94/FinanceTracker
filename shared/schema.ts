import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, integer, boolean, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table (for PIN/biometric authentication)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().default("User"),
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  pinHash: varchar("pin_hash", { length: 255 }),
  biometricEnabled: boolean("biometric_enabled").default(false),
  theme: varchar("theme", { length: 10 }).default("light"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  email: z.string().email().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Accounts (bank accounts, credit cards, debit cards)
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'bank', 'credit_card', 'debit_card', 'wallet', 'pf'
  bankName: varchar("bank_name", { length: 100 }),
  accountNumber: varchar("account_number", { length: 50 }),
  bankAccountNumber: varchar("bank_account_number", { length: 50 }), // full account number for bank accounts
  ifscCode: varchar("ifsc_code", { length: 50 }), // IFSC code for bank accounts
  balance: decimal("balance", { precision: 12, scale: 2 }).default("0"),
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }), // only for credit cards
  monthlySpendingLimit: decimal("monthly_spending_limit", { precision: 12, scale: 2 }), // monthly spending limit for credit cards
  billingDate: integer("billing_date"), // day of month (1-31) for credit card billing cycle
  linkedAccountId: integer("linked_account_id"), // for debit cards - links to bank account
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 20 }),
  isActive: boolean("is_active").default(true),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  transactions: many(transactions),
}));

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Account name is required"),
  type: z.enum(["bank", "credit_card", "debit_card", "wallet", "pf"]),
  balance: z.string().optional(),
  creditLimit: z.string().optional(),
  monthlySpendingLimit: z.string().optional(),
  billingDate: z.number().min(1).max(31).optional(),
  linkedAccountId: z.number().optional(),
  userId: z.number().optional(),
  isDefault: z.boolean().optional(),
  bankAccountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
});

export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

// Categories for transactions
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 20 }),
  type: varchar("type", { length: 20 }).default("expense"), // 'expense', 'income', 'transfer'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
});

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

// Default categories list
export const DEFAULT_CATEGORIES = [
  { name: "Groceries", icon: "cart", color: "#4CAF50", type: "expense" },
  { name: "Transport", icon: "car", color: "#2196F3", type: "expense" },
  { name: "Dining", icon: "restaurant", color: "#FF9800", type: "expense" },
  { name: "Shopping", icon: "bag-handle", color: "#E91E63", type: "expense" },
  { name: "Entertainment", icon: "videocam", color: "#9C27B0", type: "expense" },
  { name: "Bills", icon: "receipt", color: "#607D8B", type: "expense" },
  { name: "Health", icon: "heart", color: "#F44336", type: "expense" },
  { name: "Education", icon: "school", color: "#3F51B5", type: "expense" },
  { name: "Travel", icon: "airplane", color: "#00BCD4", type: "expense" },
  { name: "Salary", icon: "briefcase", color: "#4CAF50", type: "income" },
  { name: "Investment", icon: "trending-up", color: "#8BC34A", type: "income" },
  { name: "Transfer", icon: "repeat", color: "#795548", type: "transfer" },
  { name: "Other", icon: "ellipsis-horizontal", color: "#9E9E9E", type: "expense" },
] as const;

// Transactions (from SMS parsing or manual entry)
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").references(() => accounts.id),
  toAccountId: integer("to_account_id").references(() => accounts.id), // For transfer transactions
  categoryId: integer("category_id").references(() => categories.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'debit', 'credit', 'transfer'
  description: text("description"),
  merchant: varchar("merchant", { length: 200 }),
  referenceNumber: varchar("reference_number", { length: 100 }),
  transactionDate: timestamp("transaction_date").notNull(),
  smsId: integer("sms_id"),
  availableBalance: decimal("available_balance", { precision: 14, scale: 2 }), // bank-reported balance after this transaction, when the SMS included one
  isRecurring: boolean("is_recurring").default(false),
  savingsContributionId: integer("savings_contribution_id"), // Link to savings contribution if this is a contribution transaction
  paymentOccurrenceId: integer("payment_occurrence_id"), // Link to scheduled payment occurrence if this is a scheduled payment transaction
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  toAccount: one(accounts, { fields: [transactions.toAccountId], references: [accounts.id] }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
}));

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.string().min(1, "Amount is required")
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: "Amount must be a valid positive number"
    }),
  type: z.enum(["debit", "credit", "transfer"]),
  transactionDate: z.string().optional(),
  toAccountId: z.union([z.number(), z.null()]).optional(),
  categoryId: z.union([z.number(), z.null()]).optional(),
  accountId: z.union([z.number(), z.null()]).optional(),
  description: z.union([z.string(), z.null()]).optional(),
  merchant: z.union([z.string(), z.null()]).optional(),
  referenceNumber: z.union([z.string(), z.null()]).optional(),
  savingsContributionId: z.union([z.number(), z.null()]).optional(),
  paymentOccurrenceId: z.union([z.number(), z.null()]).optional(),
  smsId: z.union([z.number(), z.null()]).optional(),
  availableBalance: z.union([z.string(), z.null()]).optional(),
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Budgets (monthly category budgets)
export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const budgetsRelations = relations(budgets, ({ one }) => ({
  user: one(users, { fields: [budgets.userId], references: [users.id] }),
  category: one(categories, { fields: [budgets.categoryId], references: [categories.id] }),
}));

export const insertBudgetSchema = createInsertSchema(budgets).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.string().min(1, "Budget amount is required")
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: "Budget amount must be a valid positive number"
    }),
  month: z.number().min(1).max(12),
  year: z.number().min(2020),
  categoryId: z.number().min(1, "Category is required"),
});

export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

// Scheduled Payments (recurring payments with reminders)
export const scheduledPayments = pgTable("scheduled_payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  paymentType: varchar("payment_type", { length: 20 }).default("regular"), // 'regular', 'credit_card_bill'
  amount: decimal("amount", { precision: 12, scale: 2 }), // nullable for auto-calculated credit card bills and variable-amount bills
  variableAmount: boolean("variable_amount").default(false), // true when this bill's amount is never fixed (e.g. electricity) — entered per-cycle on the occurrence instead
  dueDateType: varchar("due_date_type", { length: 20 }).default("fixed_day"), // 'fixed_day' or 'salary_day'
  dueDate: integer("due_date"), // day of month (1-31) when dueDateType is 'fixed_day', null when 'salary_day'
  categoryId: integer("category_id").references(() => categories.id),
  accountId: integer("account_id").references(() => accounts.id),
  creditCardAccountId: integer("credit_card_account_id").references(() => accounts.id), // for credit card bills
  frequency: varchar("frequency", { length: 20 }).default("monthly"), // 'monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time', 'custom', 'day_interval'
  customIntervalMonths: integer("custom_interval_months"), // number of months between payments (e.g., 2, 3, 5, 8)
  customIntervalDays: integer("custom_interval_days"), // number of days between payments when frequency is 'day_interval' (e.g. phone recharge every 84 days) — rolling from the actual paid date, not a fixed day-of-month
  startMonth: integer("start_month"), // 1-12, for quarterly/yearly/custom payments
  status: varchar("status", { length: 20 }).default("active"), // 'active', 'inactive'
  notes: text("notes"),
  affectTransaction: boolean("affect_transaction").default(true),
  affectAccountBalance: boolean("affect_account_balance").default(true),
  lastNotifiedAt: timestamp("last_notified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const scheduledPaymentsRelations = relations(scheduledPayments, ({ one }) => ({
  user: one(users, { fields: [scheduledPayments.userId], references: [users.id] }),
  category: one(categories, { fields: [scheduledPayments.categoryId], references: [categories.id] }),
  account: one(accounts, { fields: [scheduledPayments.accountId], references: [accounts.id] }),
}));

export const insertScheduledPaymentSchema = createInsertSchema(scheduledPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastNotifiedAt: true,
}).extend({
  name: z.string().min(1, "Payment name is required"),
  paymentType: z.enum(["regular", "credit_card_bill"]).optional(),
  amount: z.string().optional(), // optional for auto-calculated credit card bills and variable-amount bills
  variableAmount: z.boolean().optional(),
  dueDateType: z.enum(["fixed_day", "salary_day"]).optional(),
  dueDate: z.union([z.number().min(1).max(31), z.null()]).optional(), // optional/null when dueDateType is 'salary_day'
  creditCardAccountId: z.union([z.number(), z.null()]).optional(),
  categoryId: z.union([z.number(), z.null()]).optional(),
  accountId: z.union([z.number(), z.null()]).optional(),
  frequency: z.enum(["monthly", "quarterly", "half_yearly", "yearly", "one_time", "custom", "day_interval"]).optional(),
  customIntervalMonths: z.union([z.number().min(1).max(60), z.null()]).optional(),
  customIntervalDays: z.union([z.number().min(1).max(365), z.null()]).optional(),
  startMonth: z.union([z.number().min(1).max(12), z.null()]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
}).refine(
  (data) => {
    // Amount is required for regular, fixed-amount payments — optional for credit card
    // bills (auto-calculated) and variable-amount bills (entered per-cycle instead)
    if (data.paymentType !== 'credit_card_bill' && !data.variableAmount && !data.amount) {
      return false;
    }
    // If amount is provided, it must be a valid number
    if (data.amount && isNaN(Number(data.amount))) {
      return false;
    }
    // For fixed-amount regular payments, amount must be positive (> 0)
    if (data.paymentType !== 'credit_card_bill' && !data.variableAmount && data.amount && Number(data.amount) <= 0) {
      return false;
    }
    // For credit card bills, amount can be 0 (auto-calculated) or positive
    if (data.paymentType === 'credit_card_bill' && data.amount && Number(data.amount) < 0) {
      return false;
    }
    return true;
  },
  {
    message: "Amount is required unless this is a variable-amount or auto-calculated credit card bill",
    path: ["amount"],
  }
).refine(
  (data) => {
    // dueDate (day-of-month) doesn't apply to day-interval payments — they're anchored by
    // an actual date instead, handled separately at the route level.
    if (data.dueDateType === 'fixed_day' && data.frequency !== 'day_interval' && !data.dueDate) {
      return false;
    }
    return true;
  },
  {
    message: "Due date is required when due date type is fixed day",
    path: ["dueDate"],
  }
);

export type InsertScheduledPayment = z.infer<typeof insertScheduledPaymentSchema>;
export type ScheduledPayment = typeof scheduledPayments.$inferSelect;

// Payment Occurrences (monthly checklist for scheduled payments)
export const paymentOccurrences = pgTable("payment_occurrences", {
  id: serial("id").primaryKey(),
  scheduledPaymentId: integer("scheduled_payment_id").references(() => scheduledPayments.id).notNull(),
  month: integer("month").notNull(), // 1-12
  year: integer("year").notNull(),
  dueDate: timestamp("due_date").notNull(),
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'paid', 'skipped'
  amount: decimal("amount", { precision: 12, scale: 2 }), // this cycle's actual bill amount, for variable-amount payments — distinct from paidAmount
  paidAt: timestamp("paid_at"),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
  affectTransaction: boolean("affect_transaction").default(true),
  affectAccountBalance: boolean("affect_account_balance").default(true),
  cycleStartDate: timestamp("cycle_start_date"),
  cycleEndDate: timestamp("cycle_end_date"),
  salaryCycleId: integer("salary_cycle_id"),
  confirmedBySms: timestamp("confirmed_by_sms"), // set when a due-reminder SMS matched this occurrence's cycle; evidence only, does not imply paid
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paymentOccurrencesRelations = relations(paymentOccurrences, ({ one }) => ({
  scheduledPayment: one(scheduledPayments, { fields: [paymentOccurrences.scheduledPaymentId], references: [scheduledPayments.id] }),
}));

export const insertPaymentOccurrenceSchema = createInsertSchema(paymentOccurrences).omit({
  id: true,
  createdAt: true,
  confirmedBySms: true,
}).extend({
  month: z.number().min(1).max(12),
  year: z.number().min(2020),
  status: z.enum(["pending", "paid", "skipped"]).optional(),
});

export type InsertPaymentOccurrence = z.infer<typeof insertPaymentOccurrenceSchema>;
export type PaymentOccurrence = typeof paymentOccurrences.$inferSelect;

// Credit Card Statements (monthly billing statements)
export const creditCardStatements = pgTable("credit_card_statements", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  statementMonth: integer("statement_month").notNull(), // 1-12
  statementYear: integer("statement_year").notNull(),
  billingCycleStart: timestamp("billing_cycle_start").notNull(),
  billingCycleEnd: timestamp("billing_cycle_end").notNull(),
  statementDate: timestamp("statement_date").notNull(), // date statement was generated
  dueDate: timestamp("due_date").notNull(),
  openingBalance: decimal("opening_balance", { precision: 12, scale: 2 }).default("0"), // carried over from previous statement
  newCharges: decimal("new_charges", { precision: 12, scale: 2 }).default("0"), // spending during this cycle
  payments: decimal("payments", { precision: 12, scale: 2 }).default("0"), // payments received during this cycle
  credits: decimal("credits", { precision: 12, scale: 2 }).default("0"), // refunds, cashback, etc.
  statementBalance: decimal("statement_balance", { precision: 12, scale: 2 }).default("0"), // total amount due
  minimumDue: decimal("minimum_due", { precision: 12, scale: 2 }).default("0"),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }).default("0"), // amount paid after statement
  paidDate: timestamp("paid_date"),
  status: varchar("status", { length: 20 }).default("unpaid"), // 'unpaid', 'partial', 'paid', 'overdue'
  smsConfirmedAt: timestamp("sms_confirmed_at"), // set when a due-reminder SMS's amount matched statementBalance
  smsReportedBalance: decimal("sms_reported_balance", { precision: 12, scale: 2 }), // set only when a due SMS's amount disagreed with statementBalance, for discrepancy review
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const creditCardStatementsRelations = relations(creditCardStatements, ({ one }) => ({
  account: one(accounts, { fields: [creditCardStatements.accountId], references: [accounts.id] }),
}));

export const insertCreditCardStatementSchema = createInsertSchema(creditCardStatements).omit({
  id: true,
  createdAt: true,
  smsConfirmedAt: true,
  smsReportedBalance: true,
}).extend({
  statementMonth: z.number().min(1).max(12),
  statementYear: z.number().min(2020),
  status: z.enum(["unpaid", "partial", "paid", "overdue"]).optional(),
});

export type InsertCreditCardStatement = z.infer<typeof insertCreditCardStatementSchema>;
export type CreditCardStatement = typeof creditCardStatements.$inferSelect;

// Savings Goals
export const savingsGoals = pgTable("savings_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  targetAmount: decimal("target_amount", { precision: 12, scale: 2 }).notNull(),
  currentAmount: decimal("current_amount", { precision: 12, scale: 2 }).default("0"),
  monthlyExpectedAmount: decimal("monthly_expected_amount", { precision: 12, scale: 2 }),
  startDate: timestamp("start_date").notNull(),
  targetDate: timestamp("target_date").notNull(),
  accountId: integer("account_id").references(() => accounts.id), // from account
  toAccountId: integer("to_account_id").references(() => accounts.id), // to account (optional)
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 20 }),
  status: varchar("status", { length: 20 }).default("active"), // 'active', 'completed', 'paused', 'inactive'
  affectTransaction: boolean("affect_transaction").default(true), // whether to create transaction history
  affectAccountBalance: boolean("affect_account_balance").default(true), // whether to affect account balance
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const savingsGoalsRelations = relations(savingsGoals, ({ one, many }) => ({
  user: one(users, { fields: [savingsGoals.userId], references: [users.id] }),
  account: one(accounts, { fields: [savingsGoals.accountId], references: [accounts.id] }),
  toAccount: one(accounts, { fields: [savingsGoals.toAccountId], references: [accounts.id] }),
  contributions: many(savingsContributions),
}));

export const insertSavingsGoalSchema = createInsertSchema(savingsGoals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Goal name is required"),
  targetAmount: z.string().min(1, "Target amount is required")
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: "Target amount must be a valid positive number"
    }),
  currentAmount: z.union([z.string(), z.null()]).optional(),
  monthlyExpectedAmount: z.union([z.string(), z.null()]).optional(),
  accountId: z.union([z.number(), z.null()]).optional(),
  toAccountId: z.union([z.number(), z.null()]).optional(),
  status: z.enum(["active", "completed", "paused", "inactive", "cancelled"]).optional(),
  affectTransaction: z.union([z.boolean(), z.null()]).optional(),
  affectAccountBalance: z.union([z.boolean(), z.null()]).optional(),
  description: z.union([z.string(), z.null()]).optional(),
  startDate: z.string().min(1, "Start date is required"),
  targetDate: z.string().min(1, "Target date is required")
    .refine((val) => {
      const date = new Date(val);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return date >= today;
    }, {
      message: "Target date cannot be in the past"
    }),
}).refine((data) => {
  if (data.startDate && data.targetDate) {
    return new Date(data.startDate) < new Date(data.targetDate);
  }
  return true;
}, {
  message: "Start date must be before target date",
  path: ["targetDate"],
});

export type InsertSavingsGoal = z.infer<typeof insertSavingsGoalSchema>;
export type SavingsGoal = typeof savingsGoals.$inferSelect;

// Savings Contributions
export const savingsContributions = pgTable("savings_contributions", {
  id: serial("id").primaryKey(),
  savingsGoalId: integer("savings_goal_id").references(() => savingsGoals.id).notNull(),
  accountId: integer("account_id").references(() => accounts.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  contributedAt: timestamp("contributed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const savingsContributionsRelations = relations(savingsContributions, ({ one }) => ({
  savingsGoal: one(savingsGoals, { fields: [savingsContributions.savingsGoalId], references: [savingsGoals.id] }),
  account: one(accounts, { fields: [savingsContributions.accountId], references: [accounts.id] }),
}));

export const insertSavingsContributionSchema = createInsertSchema(savingsContributions).omit({
  id: true,
  createdAt: true,
  contributedAt: true,
}).extend({
  amount: z.string().min(1, "Amount is required")
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: "Amount must be a valid positive number"
    }),
  accountId: z.number().optional(),
  contributedAt: z.string().optional(),
});

export type InsertSavingsContribution = z.infer<typeof insertSavingsContributionSchema>;
export type SavingsContribution = typeof savingsContributions.$inferSelect;

// Salary Profile (configuration for payday)
export const salaryProfiles = pgTable("salary_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").references(() => accounts.id),
  paydayRule: varchar("payday_rule", { length: 30 }).default("last_working_day"), // 'fixed_day', 'last_working_day', 'nth_weekday'
  fixedDay: integer("fixed_day"), // day of month if payday_rule is 'fixed_day'
  weekdayPreference: integer("weekday_preference"), // 0=Sun, 1=Mon... for nth_weekday rule
  monthCycleStartRule: varchar("month_cycle_start_rule", { length: 30 }).default("salary_day"), // 'salary_day' or 'fixed_day'
  monthCycleStartDay: integer("month_cycle_start_day"), // day of month (1-31) if monthCycleStartRule is 'fixed_day'
  monthlyAmount: decimal("monthly_amount", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const salaryProfilesRelations = relations(salaryProfiles, ({ one, many }) => ({
  user: one(users, { fields: [salaryProfiles.userId], references: [users.id] }),
  account: one(accounts, { fields: [salaryProfiles.accountId], references: [accounts.id] }),
  cycles: many(salaryCycles),
}));

export const insertSalaryProfileSchema = createInsertSchema(salaryProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  paydayRule: z.enum(["fixed_day", "last_working_day", "nth_weekday"]).optional(),
  fixedDay: z.number().min(1).max(31).nullish(),
  monthCycleStartRule: z.enum(["salary_day", "fixed_day"]).optional(),
  monthCycleStartDay: z.number().min(1).max(31).nullish(),
  monthlyAmount: z.string().nullish(),
  accountId: z.number().nullish(),
});

export type InsertSalaryProfile = z.infer<typeof insertSalaryProfileSchema>;
export type SalaryProfile = typeof salaryProfiles.$inferSelect;

// Salary Cycles (actual salary records per month)
export const salaryCycles = pgTable("salary_cycles", {
  id: serial("id").primaryKey(),
  salaryProfileId: integer("salary_profile_id").references(() => salaryProfiles.id).notNull(),
  month: integer("month").notNull(), // 1-12
  year: integer("year").notNull(),
  expectedPayDate: timestamp("expected_pay_date").notNull(),
  actualPayDate: timestamp("actual_pay_date"),
  expectedAmount: decimal("expected_amount", { precision: 12, scale: 2 }),
  actualAmount: decimal("actual_amount", { precision: 12, scale: 2 }),
  transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: 'set null' }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salaryCyclesRelations = relations(salaryCycles, ({ one }) => ({
  salaryProfile: one(salaryProfiles, { fields: [salaryCycles.salaryProfileId], references: [salaryProfiles.id] }),
  transaction: one(transactions, { fields: [salaryCycles.transactionId], references: [transactions.id] }),
}));

export const insertSalaryCycleSchema = createInsertSchema(salaryCycles).omit({
  id: true,
  createdAt: true,
}).extend({
  month: z.number().min(1).max(12),
  year: z.number().min(2020),
  expectedAmount: z.string().optional(),
  actualAmount: z.string().optional(),
});

export type InsertSalaryCycle = z.infer<typeof insertSalaryCycleSchema>;
export type SalaryCycle = typeof salaryCycles.$inferSelect;

// Loans (home loan, personal loan, credit card loan, item EMI)
export const loans = pgTable("loans", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").references(() => accounts.id), // linked account for auto-tracking
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 30 }).notNull(), // 'home_loan', 'personal_loan', 'credit_card_loan', 'item_emi'
  lenderName: varchar("lender_name", { length: 100 }),
  loanAccountNumber: varchar("loan_account_number", { length: 100 }), // stored encrypted
  principalAmount: decimal("principal_amount", { precision: 14, scale: 2 }).notNull(),
  outstandingAmount: decimal("outstanding_amount", { precision: 14, scale: 2 }).notNull(),
  receivedAmount: decimal("received_amount", { precision: 14, scale: 2 }), // actual amount credited after deductions (processing fees etc.) — null until the user sets it via Spending Breakdown
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }).notNull(), // ROI in percentage
  tenure: integer("tenure").notNull(), // in months (original for new loans, remaining for existing)
  emiAmount: decimal("emi_amount", { precision: 12, scale: 2 }),
  emiDay: integer("emi_day"), // day of month when EMI is due (1-31)
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  status: varchar("status", { length: 20 }).default("active"), // 'active', 'closed', 'defaulted', 'preclosed', 'closed_bt'
  isExistingLoan: boolean("is_existing_loan").default(false), // true if tracking an existing loan
  nextEmiDate: timestamp("next_emi_date"), // for existing loans: when next EMI is due
  closureDate: timestamp("closure_date"), // pre-closure or completion date
  closureAmount: decimal("closure_amount", { precision: 14, scale: 2 }), // settlement amount for pre-closure
  createTransaction: boolean("create_transaction").default(false), // create transaction on payment
  affectBalance: boolean("affect_balance").default(false), // affect account balance on payment
  includesBtClosure: boolean("includes_bt_closure").default(false), // true if this loan includes BT to close other loans
  closedViaBtFromLoanId: integer("closed_via_bt_from_loan_id"), // if closed via BT, reference to the source loan
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const loansRelations = relations(loans, ({ one, many }) => ({
  user: one(users, { fields: [loans.userId], references: [users.id] }),
  account: one(accounts, { fields: [loans.accountId], references: [accounts.id] }),
  installments: many(loanInstallments),
  components: many(loanComponents),
  btAllocations: many(loanBtAllocations),
  closedViaBtFromLoan: one(loans, { fields: [loans.closedViaBtFromLoanId], references: [loans.id] }),
}));

export const insertLoanSchema = createInsertSchema(loans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Loan name is required"),
  type: z.enum(["home_loan", "personal_loan", "credit_card_loan", "item_emi"]),
  principalAmount: z.string().min(1, "Principal amount is required"),
  outstandingAmount: z.string().min(1, "Outstanding amount is required"),
  receivedAmount: z.string().optional(),
  interestRate: z.string().min(1, "Interest rate is required"),
  tenure: z.number().min(1, "Tenure is required"),
  emiAmount: z.string().optional(),
  emiDay: z.number().min(1).max(31).optional(),
  startDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
  endDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional(),
  status: z.enum(["active", "closed", "defaulted", "preclosed", "closed_bt"]).optional(),
  isExistingLoan: z.boolean().optional(),
  nextEmiDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional(),
  closureDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional(),
  closureAmount: z.string().optional(),
  createTransaction: z.boolean().optional(),
  affectBalance: z.boolean().optional(),
  includesBtClosure: z.boolean().optional(),
  closedViaBtFromLoanId: z.number().optional(),
});

export type InsertLoan = z.infer<typeof insertLoanSchema>;
export type Loan = typeof loans.$inferSelect;

// Loan Balance Transfer Allocations (tracks which loans are being closed via BT from this loan)
export const loanBtAllocations = pgTable("loan_bt_allocations", {
  id: serial("id").primaryKey(),
  sourceLoanId: integer("source_loan_id").references(() => loans.id).notNull(), // the new BT loan
  targetLoanId: integer("target_loan_id").references(() => loans.id).notNull(), // the loan being closed/paid
  originalOutstandingAmount: decimal("original_outstanding_amount", { precision: 14, scale: 2 }).notNull(), // outstanding at time of BT setup
  allocatedAmount: decimal("allocated_amount", { precision: 14, scale: 2 }).notNull(), // amount allocated for BT
  actualBtAmount: decimal("actual_bt_amount", { precision: 14, scale: 2 }), // actual amount paid during BT (may differ)
  processingFee: decimal("processing_fee", { precision: 10, scale: 2 }), // optional processing fee
  processedDate: timestamp("processed_date"), // when BT was actually processed
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'processed', 'partial'
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const loanBtAllocationsRelations = relations(loanBtAllocations, ({ one }) => ({
  sourceLoan: one(loans, { fields: [loanBtAllocations.sourceLoanId], references: [loans.id] }),
  targetLoan: one(loans, { fields: [loanBtAllocations.targetLoanId], references: [loans.id] }),
}));

export const insertLoanBtAllocationSchema = createInsertSchema(loanBtAllocations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  originalOutstandingAmount: z.string().min(1, "Outstanding amount is required"),
  allocatedAmount: z.string().min(1, "Allocated amount is required"),
  actualBtAmount: z.string().optional(),
  processingFee: z.string().optional(),
  processedDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional(),
  status: z.enum(["pending", "processed", "partial"]).optional(),
});

export type InsertLoanBtAllocation = z.infer<typeof insertLoanBtAllocationSchema>;
export type LoanBtAllocation = typeof loanBtAllocations.$inferSelect;

// Loan Components (for credit card EMI conversions and purchase-specific EMIs)
export const loanComponents = pgTable("loan_components", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").references(() => loans.id).notNull(),
  name: varchar("name", { length: 200 }).notNull(), // e.g., "iPhone 15 Pro - 6 month EMI"
  originalAmount: decimal("original_amount", { precision: 12, scale: 2 }).notNull(),
  remainingAmount: decimal("remaining_amount", { precision: 12, scale: 2 }).notNull(),
  emiAmount: decimal("emi_amount", { precision: 12, scale: 2 }).notNull(),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }), // may differ for CC EMIs
  processingFee: decimal("processing_fee", { precision: 10, scale: 2 }),
  tenure: integer("tenure").notNull(), // in months
  remainingTenure: integer("remaining_tenure").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  transactionId: integer("transaction_id").references(() => transactions.id), // linked transaction
  status: varchar("status", { length: 20 }).default("active"), // 'active', 'completed'
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanComponentsRelations = relations(loanComponents, ({ one }) => ({
  loan: one(loans, { fields: [loanComponents.loanId], references: [loans.id] }),
  transaction: one(transactions, { fields: [loanComponents.transactionId], references: [transactions.id] }),
}));

export const insertLoanComponentSchema = createInsertSchema(loanComponents).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().min(1, "Component name is required"),
  originalAmount: z.string().min(1, "Original amount is required"),
  remainingAmount: z.string().min(1, "Remaining amount is required"),
  emiAmount: z.string().min(1, "EMI amount is required"),
  interestRate: z.string().optional(),
  processingFee: z.string().optional(),
  tenure: z.number().min(1, "Tenure is required"),
  remainingTenure: z.number().min(0),
  status: z.enum(["active", "completed"]).optional(),
});

export type InsertLoanComponent = z.infer<typeof insertLoanComponentSchema>;
export type LoanComponent = typeof loanComponents.$inferSelect;

// Loan Installments (EMI schedule with principal/interest breakdown)
export const loanInstallments = pgTable("loan_installments", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").references(() => loans.id).notNull(),
  loanComponentId: integer("loan_component_id").references(() => loanComponents.id), // optional - for CC EMIs
  installmentNumber: integer("installment_number").notNull(),
  dueDate: timestamp("due_date").notNull(),
  emiAmount: decimal("emi_amount", { precision: 12, scale: 2 }).notNull(),
  principalAmount: decimal("principal_amount", { precision: 12, scale: 2 }),
  interestAmount: decimal("interest_amount", { precision: 12, scale: 2 }),
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'paid', 'overdue', 'skipped'
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }),
  paidDate: timestamp("paid_date"),
  transactionId: integer("transaction_id").references(() => transactions.id), // linked payment transaction
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanInstallmentsRelations = relations(loanInstallments, ({ one }) => ({
  loan: one(loans, { fields: [loanInstallments.loanId], references: [loans.id] }),
  loanComponent: one(loanComponents, { fields: [loanInstallments.loanComponentId], references: [loanComponents.id] }),
  transaction: one(transactions, { fields: [loanInstallments.transactionId], references: [transactions.id] }),
}));

export const insertLoanInstallmentSchema = createInsertSchema(loanInstallments).omit({
  id: true,
  createdAt: true,
}).extend({
  installmentNumber: z.number().min(1),
  emiAmount: z.string().min(1, "EMI amount is required"),
  principalAmount: z.string().optional(),
  interestAmount: z.string().optional(),
  paidAmount: z.string().optional(),
  status: z.enum(["pending", "paid", "overdue", "skipped"]).optional(),
});

export type InsertLoanInstallment = z.infer<typeof insertLoanInstallmentSchema>;
export type LoanInstallment = typeof loanInstallments.$inferSelect;

// Loan Spending Entries (how a loan's received amount was actually spent — pure record-keeping,
// no transaction or account-balance link)
export const loanSpendingEntries = pgTable("loan_spending_entries", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").references(() => loans.id).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanSpendingEntriesRelations = relations(loanSpendingEntries, ({ one }) => ({
  loan: one(loans, { fields: [loanSpendingEntries.loanId], references: [loans.id] }),
}));

export const insertLoanSpendingEntrySchema = createInsertSchema(loanSpendingEntries).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.string().min(1, "Amount is required"),
  reason: z.string().optional(),
});

export type InsertLoanSpendingEntry = z.infer<typeof insertLoanSpendingEntrySchema>;
export type LoanSpendingEntry = typeof loanSpendingEntries.$inferSelect;

// Card Details (encrypted storage for debit/credit cards)
export const cardDetails = pgTable("card_details", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accounts.id).notNull(),
  cardNumber: text("card_number").notNull(), // encrypted, last 4 digits stored separately
  lastFourDigits: varchar("last_four_digits", { length: 4 }).notNull(),
  cardholderName: varchar("cardholder_name", { length: 100 }),
  expiryMonth: integer("expiry_month").notNull(),
  expiryYear: integer("expiry_year").notNull(),
  cardType: varchar("card_type", { length: 20 }), // 'visa', 'mastercard', 'rupay', 'amex'
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
// NOTE: CVV is NOT stored for security reasons

export const cardDetailsRelations = relations(cardDetails, ({ one }) => ({
  account: one(accounts, { fields: [cardDetails.accountId], references: [accounts.id] }),
}));

export const insertCardDetailsSchema = createInsertSchema(cardDetails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  cardNumber: z.string().min(13).max(19, "Valid card number required"),
  lastFourDigits: z.string().length(4, "Last 4 digits required"),
  cardholderName: z.string().optional(),
  expiryMonth: z.number().min(1).max(12),
  expiryYear: z.number().min(2024),
  cardType: z.enum(["visa", "mastercard", "rupay", "amex", "other"]).optional(),
});

export type InsertCardDetails = z.infer<typeof insertCardDetailsSchema>;
export type CardDetails = typeof cardDetails.$inferSelect;

// Sender Institution Mappings — remembers which real-world institution (bank/PF/wallet/etc.)
// a DLT sender-ID header belongs to, once it's been reviewed and mapped to an account or dismissed.
export const senderInstitutionMappings = pgTable("sender_institution_mappings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  institutionKey: varchar("institution_key", { length: 50 }).notNull(), // e.g. "EPFOHO", "ICICIT" — derived from the sender's DLT header
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending', 'mapped', 'ignored'
  accountId: integer("account_id").references(() => accounts.id), // set once mapped
  suggestedName: varchar("suggested_name", { length: 200 }),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userInstitutionUnique: uniqueIndex("sender_institution_mappings_user_institution_unique").on(table.userId, table.institutionKey),
}));

export const senderInstitutionMappingsRelations = relations(senderInstitutionMappings, ({ one }) => ({
  user: one(users, { fields: [senderInstitutionMappings.userId], references: [users.id] }),
  account: one(accounts, { fields: [senderInstitutionMappings.accountId], references: [accounts.id] }),
}));

export const insertSenderInstitutionMappingSchema = createInsertSchema(senderInstitutionMappings).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
}).extend({
  status: z.enum(["pending", "mapped", "ignored"]).optional(),
  accountId: z.union([z.number(), z.null()]).optional(),
  suggestedName: z.union([z.string(), z.null()]).optional(),
});

export type InsertSenderInstitutionMapping = z.infer<typeof insertSenderInstitutionMappingSchema>;
export type SenderInstitutionMapping = typeof senderInstitutionMappings.$inferSelect;

// Bill Sender Mappings — remembers which scheduled payment a due-reminder SMS sender belongs
// to, once the user has triaged it once in the Bills Inbox. Parallel to senderInstitutionMappings,
// but for due/bill SMS (credit card dues are matched directly via cardDetails.lastFourDigits and
// never need this table — this is for everything without a reliable in-message identifier).
export const billSenderMappings = pgTable("bill_sender_mappings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  institutionKey: varchar("institution_key", { length: 50 }).notNull(), // derived from the sender's DLT header, same scheme as senderInstitutionMappings
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending', 'mapped', 'ignored'
  scheduledPaymentId: integer("scheduled_payment_id").references(() => scheduledPayments.id), // set once mapped
  suggestedName: varchar("suggested_name", { length: 200 }),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userInstitutionUnique: uniqueIndex("bill_sender_mappings_user_institution_unique").on(table.userId, table.institutionKey),
}));

export const billSenderMappingsRelations = relations(billSenderMappings, ({ one }) => ({
  user: one(users, { fields: [billSenderMappings.userId], references: [users.id] }),
  scheduledPayment: one(scheduledPayments, { fields: [billSenderMappings.scheduledPaymentId], references: [scheduledPayments.id] }),
}));

export const insertBillSenderMappingSchema = createInsertSchema(billSenderMappings).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
}).extend({
  status: z.enum(["pending", "mapped", "ignored"]).optional(),
  scheduledPaymentId: z.union([z.number(), z.null()]).optional(),
  suggestedName: z.union([z.string(), z.null()]).optional(),
});

export type InsertBillSenderMapping = z.infer<typeof insertBillSenderMappingSchema>;
export type BillSenderMapping = typeof billSenderMappings.$inferSelect;

// SMS Logs (for tracking parsed messages)
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

export const smsLogsRelations = relations(smsLogs, ({ one }) => ({
  user: one(users, { fields: [smsLogs.userId], references: [users.id] }),
  transaction: one(transactions, { fields: [smsLogs.transactionId], references: [transactions.id] }),
  institutionMapping: one(senderInstitutionMappings, { fields: [smsLogs.institutionMappingId], references: [senderInstitutionMappings.id] }),
  billMapping: one(billSenderMappings, { fields: [smsLogs.billMappingId], references: [billSenderMappings.id] }),
  creditCardStatement: one(creditCardStatements, { fields: [smsLogs.creditCardStatementId], references: [creditCardStatements.id] }),
  paymentOccurrence: one(paymentOccurrences, { fields: [smsLogs.paymentOccurrenceId], references: [paymentOccurrences.id] }),
}));

export const insertSmsLogSchema = createInsertSchema(smsLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertSmsLog = z.infer<typeof insertSmsLogSchema>;
export type SmsLog = typeof smsLogs.$inferSelect;

// Loan Terms (track interest rate and tenure changes over time)
export const loanTerms = pgTable("loan_terms", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").references(() => loans.id).notNull(),
  effectiveFrom: timestamp("effective_from").notNull(),
  effectiveTo: timestamp("effective_to"), // null means current term
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }).notNull(),
  tenureMonths: integer("tenure_months").notNull(),
  emiAmount: decimal("emi_amount", { precision: 12, scale: 2 }).notNull(),
  outstandingAtChange: decimal("outstanding_at_change", { precision: 14, scale: 2 }), // outstanding when this term started
  reason: varchar("reason", { length: 200 }), // e.g., "Rate revision", "Tenure extension"
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanTermsRelations = relations(loanTerms, ({ one }) => ({
  loan: one(loans, { fields: [loanTerms.loanId], references: [loans.id] }),
}));

export const insertLoanTermSchema = createInsertSchema(loanTerms).omit({
  id: true,
  createdAt: true,
}).extend({
  interestRate: z.string().min(1, "Interest rate is required"),
  tenureMonths: z.number().min(1, "Tenure is required"),
  emiAmount: z.string().min(1, "EMI amount is required"),
  outstandingAtChange: z.string().optional(),
  effectiveFrom: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
  effectiveTo: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional().nullable(),
});

export type InsertLoanTerm = z.infer<typeof insertLoanTermSchema>;
export type LoanTerm = typeof loanTerms.$inferSelect;

// Loan Payments (track actual EMI payments with extra/partial support)
export const loanPayments = pgTable("loan_payments", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").references(() => loans.id).notNull(),
  installmentId: integer("installment_id").references(() => loanInstallments.id),
  paymentDate: timestamp("payment_date").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  principalPaid: decimal("principal_paid", { precision: 12, scale: 2 }),
  interestPaid: decimal("interest_paid", { precision: 12, scale: 2 }),
  paymentType: varchar("payment_type", { length: 20 }).default("emi"), // 'emi', 'prepayment', 'partial'
  accountId: integer("account_id").references(() => accounts.id),
  transactionId: integer("transaction_id").references(() => transactions.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanPaymentsRelations = relations(loanPayments, ({ one }) => ({
  loan: one(loans, { fields: [loanPayments.loanId], references: [loans.id] }),
  installment: one(loanInstallments, { fields: [loanPayments.installmentId], references: [loanInstallments.id] }),
  account: one(accounts, { fields: [loanPayments.accountId], references: [accounts.id] }),
  transaction: one(transactions, { fields: [loanPayments.transactionId], references: [transactions.id] }),
}));

export const insertLoanPaymentSchema = createInsertSchema(loanPayments).omit({
  id: true,
  createdAt: true,
}).extend({
  amount: z.string().min(1, "Payment amount is required"),
  principalPaid: z.string().optional(),
  interestPaid: z.string().optional(),
  paymentType: z.enum(["emi", "prepayment", "partial"]).optional(),
  paymentDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
});

export type InsertLoanPayment = z.infer<typeof insertLoanPaymentSchema>;
export type LoanPayment = typeof loanPayments.$inferSelect;

// Insurance Policies
export const insurances = pgTable("insurances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  accountId: integer("account_id").references(() => accounts.id), // linked account for payments
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 30 }).notNull(), // 'health', 'life', 'vehicle', 'home', 'term', 'travel'
  providerName: varchar("provider_name", { length: 100 }),
  policyNumber: varchar("policy_number", { length: 100 }),
  premiumAmount: decimal("premium_amount", { precision: 12, scale: 2 }).notNull(), // total premium for the period
  coverageAmount: decimal("coverage_amount", { precision: 14, scale: 2 }), // sum insured
  premiumFrequency: varchar("premium_frequency", { length: 20 }).default("annual"), // 'annual', 'semi_annual', 'quarterly', 'monthly'
  termsPerPeriod: integer("terms_per_period").default(1), // number of payment terms per period (e.g., 2 for paying annual in 2 installments)
  policyTermYears: integer("policy_term_years"), // total policy duration in years (e.g., 16 years)
  premiumPaymentTermYears: integer("premium_payment_term_years"), // years to pay premium (e.g., 10 years, then policy continues)
  maturityAmount: decimal("maturity_amount", { precision: 14, scale: 2 }), // amount received at maturity
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  renewalDate: timestamp("renewal_date"),
  status: varchar("status", { length: 20 }).default("active"), // 'active', 'expired', 'cancelled', 'lapsed', 'paid_up'
  createTransaction: boolean("create_transaction").default(false), // create transaction on payment
  affectBalance: boolean("affect_balance").default(false), // affect account balance on payment
  autoFunded: boolean("auto_funded").default(false), // true when premiums are funded automatically by another policy (e.g. a market/sub policy funded from a main policy's benefit) — no manual payment needed, past-due premiums auto-settle
  linkedInsuranceId: integer("linked_insurance_id").references((): any => insurances.id), // the policy that funds this one, when autoFunded is true
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insurancesRelations = relations(insurances, ({ one, many }) => ({
  user: one(users, { fields: [insurances.userId], references: [users.id] }),
  account: one(accounts, { fields: [insurances.accountId], references: [accounts.id] }),
  premiums: many(insurancePremiums),
  linkedInsurance: one(insurances, { fields: [insurances.linkedInsuranceId], references: [insurances.id], relationName: "linkedInsurance" }),
}));

export const insertInsuranceSchema = createInsertSchema(insurances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Insurance name is required"),
  type: z.enum(["health", "life", "vehicle", "home", "term", "travel"]),
  premiumAmount: z.string().min(1, "Premium amount is required"),
  coverageAmount: z.string().optional(),
  premiumFrequency: z.enum(["annual", "semi_annual", "quarterly", "monthly"]).optional(),
  termsPerPeriod: z.number().min(1).max(12).optional(),
  policyTermYears: z.number().min(1).max(100).optional(),
  premiumPaymentTermYears: z.number().min(1).max(100).optional(),
  maturityAmount: z.string().optional(),
  startDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
  endDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional(),
  renewalDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional(),
  status: z.enum(["active", "expired", "cancelled", "lapsed", "paid_up"]).optional(),
  createTransaction: z.boolean().optional(),
  affectBalance: z.boolean().optional(),
  autoFunded: z.boolean().optional(),
  linkedInsuranceId: z.union([z.number(), z.null()]).optional(),
});

export type InsertInsurance = z.infer<typeof insertInsuranceSchema>;
export type Insurance = typeof insurances.$inferSelect;

// Insurance Premiums (payment terms/installments)
export const insurancePremiums = pgTable("insurance_premiums", {
  id: serial("id").primaryKey(),
  insuranceId: integer("insurance_id").references(() => insurances.id).notNull(),
  termNumber: integer("term_number").notNull(), // 1, 2, etc. for each term in the period
  periodYear: integer("period_year").notNull(), // year this term belongs to
  periodNumber: integer("period_number").default(1), // for frequencies other than annual (e.g., quarter 1, 2, etc.)
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }),
  accountId: integer("account_id").references(() => accounts.id),
  transactionId: integer("transaction_id").references(() => transactions.id),
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'paid', 'overdue', 'partially_paid'
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insurancePremiumsRelations = relations(insurancePremiums, ({ one }) => ({
  insurance: one(insurances, { fields: [insurancePremiums.insuranceId], references: [insurances.id] }),
  account: one(accounts, { fields: [insurancePremiums.accountId], references: [accounts.id] }),
  transaction: one(transactions, { fields: [insurancePremiums.transactionId], references: [transactions.id] }),
}));

export const insertInsurancePremiumSchema = createInsertSchema(insurancePremiums).omit({
  id: true,
  createdAt: true,
}).extend({
  termNumber: z.number().min(1),
  periodYear: z.number().min(2020),
  periodNumber: z.number().min(1).optional(),
  amount: z.string().min(1, "Amount is required"),
  dueDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
  paidDate: z.union([z.string(), z.date()]).transform((val) => new Date(val)).optional().nullable(),
  paidAmount: z.string().optional(),
  status: z.enum(["pending", "paid", "overdue", "partially_paid"]).optional(),
});

export type InsertInsurancePremium = z.infer<typeof insertInsurancePremiumSchema>;
export type InsurancePremium = typeof insurancePremiums.$inferSelect;

// Insurance with relations type
export type InsuranceWithRelations = Insurance & {
  account?: Account | null;
  premiums?: InsurancePremium[];
  linkedInsurance?: Insurance | null;
};

// Forecast Exclusions — lets the user opt a specific item (scheduled payment, insurance premium,
// loan EMI, or credit card bill) out of the Next Cycle Plan's Income/Outflow/Balance totals for
// one specific upcoming cycle, without touching the underlying record. Scoped per-cycle (not a
// permanent flag on the source row) so a one-off skip doesn't silently mute a recurring bill from
// every future projection.
export const forecastExclusions = pgTable("forecast_exclusions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  itemType: varchar("item_type", { length: 20 }).notNull(), // 'scheduled_payment', 'insurance', 'loan', 'credit_card_bill'
  itemId: varchar("item_id", { length: 50 }).notNull(), // source record id, or 'cc-auto-<accountId>' for auto-detected credit card bills
  cycleStart: timestamp("cycle_start").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userItemCycleUnique: uniqueIndex("forecast_exclusions_user_item_cycle_unique").on(table.userId, table.itemType, table.itemId, table.cycleStart),
}));

export const insertForecastExclusionSchema = createInsertSchema(forecastExclusions).omit({
  id: true,
  createdAt: true,
}).extend({
  itemType: z.enum(["scheduled_payment", "insurance", "loan", "credit_card_bill", "savings_goal"]),
  cycleStart: z.union([z.string(), z.date()]).transform((val) => new Date(val)),
});

export type InsertForecastExclusion = z.infer<typeof insertForecastExclusionSchema>;
export type ForecastExclusion = typeof forecastExclusions.$inferSelect;

// Extended transaction type with relations
export type TransactionWithRelations = Transaction & {
  account?: Account | null;
  toAccount?: Account | null;
  category?: Category | null;
};

// Extended loan type with relations
export type LoanWithRelations = Loan & {
  account?: Account | null;
  installments?: LoanInstallment[];
  components?: LoanComponent[];
  terms?: LoanTerm[];
  payments?: LoanPayment[];
};

// Dashboard analytics types
export type DashboardStats = {
  totalSpentToday: number;
  totalSpentMonth: number;
  monthlyExpensesByCategory: { categoryId: number; categoryName: string; total: number; color: string }[];
  budgetUsage: { categoryId: number; categoryName: string; spent: number; budget: number; percentage: number }[];
  creditCardSpending: { accountId: number; accountName: string; bankName: string; spent: number; limit: number | null; percentage: number; color: string }[];
  nextScheduledPayment: ScheduledPayment | null;
  lastTransactions: TransactionWithRelations[];
  upcomingBills: ScheduledPayment[];
  totalLoans?: number;
  totalEmiThisMonth?: number;
  nextEmiDue?: { loanName: string; amount: string; dueDate: string } | null;
};
