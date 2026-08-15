export interface Account {
  id: number;
  userId: number | null;
  name: string;
  type: 'bank' | 'credit_card' | 'debit_card' | 'wallet' | 'pf';
  bankName: string | null;
  accountNumber: string | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  balance: string;
  creditLimit: string | null;
  monthlySpendingLimit: string | null;
  billingDate: number | null;
  linkedAccountId: number | null;
  icon: string | null;
  color: string | null;
  isActive: boolean;
  isDefault: boolean;
  cardDetails?: CardDetails | null;
  createdAt: string;
  updatedAt: string;
}

export interface SenderInstitutionMapping {
  id: number;
  userId: number;
  institutionKey: string;
  status: 'pending' | 'mapped' | 'ignored';
  accountId: number | null;
  suggestedName: string | null;
  lastSeenAt: string;
  createdAt: string;
  queuedCount: number;
  latestAmount: number | null;
  latestAvailableBalance: number | null;
  latestReceivedAt: string | null;
}

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

export interface SmsPaymentMatchCandidate {
  id: number;
  reviewId: number;
  itemType: 'loan' | 'insurance' | 'scheduled_payment';
  itemId: number;
  itemName: string;
  dueDate: string;
  createdAt: string;
}

export interface PendingPaymentMatchReview {
  id: number;
  userId: number;
  transactionId: number;
  amount: string;
  matchedKeyword: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  resolvedItemType: string | null;
  resolvedItemId: number | null;
  createdAt: string;
  resolvedAt: string | null;
  candidates: SmsPaymentMatchCandidate[];
}

export interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  type: 'income' | 'expense' | 'transfer';
  createdAt: string;
}

export interface Transaction {
  id: number;
  userId: number | null;
  accountId: number | null;
  toAccountId?: number | null;
  categoryId: number | null;
  amount: string;
  type: 'credit' | 'debit' | 'transfer';
  description: string | null;
  merchant: string | null;
  referenceNumber: string | null;
  transactionDate: string;
  smsId: number | null;
  isRecurring: boolean;
  savingsContributionId?: number | null;
  paymentOccurrenceId?: number | null;
  createdAt: string;
  account?: Account | null;
  category?: Category | null;
}

export interface Budget {
  id: number;
  userId: number | null;
  categoryId: number | null;
  amount: string;
  month: number;
  year: number;
  createdAt: string;
  category?: Category | null;
}

export interface ScheduledPayment {
  id: number;
  userId: number | null;
  name: string;
  paymentType?: string;
  amount: string;
  variableAmount?: boolean | null;
  dueDateType?: 'fixed_day' | 'salary_day';
  dueDate: number | null;
  categoryId: number | null;
  accountId: number | null;
  creditCardAccountId?: number | null;
  frequency?: string | null;
  customIntervalMonths?: number | null;
  customIntervalDays?: number | null;
  startMonth?: number | null;
  status: 'active' | 'inactive';
  notes: string | null;
  affectTransaction: boolean;
  affectAccountBalance: boolean;
  autoMarkPaidEnabled?: boolean | null;
  autoMarkKeyword?: string | null;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category?: Category | null;
  account?: Account | null;
}

export interface User {
  id: number;
  name: string;
  email?: string;
  passwordHash?: string | null;
  pinHash: string | null;
  hasPassword?: boolean;
  hasPin?: boolean;
  biometricEnabled: boolean;
  theme: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  totalSpentToday: number;
  totalSpentMonth: number;
  monthlyExpensesByCategory: Array<{ categoryId: number; categoryName: string; total: number; color: string }>;
  budgetUsage: Array<{ categoryId: number; categoryName: string; spent: number; budget: number; percentage: number }>;
  creditCardSpending: Array<{
    accountId: number;
    accountName: string;
    bankName?: string;
    spent: number;
    limit: number | null;
    percentage: number;
    color: string;
  }>;
  nextScheduledPayment: ScheduledPayment | null;
  lastTransactions: Transaction[];
  upcomingBills: ScheduledPayment[];
}

export interface AccountBreakdown {
  accountId: number;
  accountName: string;
  bankName: string;
  amount: number;
}

export interface BillItem {
  id: number | string;
  name: string;
  amount: number;
  dueDate: number | null;
  dueDateType?: string;
  frequency?: string;
  isPaid: boolean;
  paidAmount: number;
  status: string;
  loanType?: string;
  lenderName?: string;
  insuranceType?: string;
  providerName?: string;
  creditLimit?: number | null;
  bankName?: string;
  isAutoCalculated?: boolean;
  occurrenceId?: number | null;
  categoryId?: number | null;
  installmentId?: number | null;
  premiumId?: number | null;
}

export interface BillsDueDetails {
  scheduledPayments: BillItem[];
  creditCardBills: BillItem[];
  loans: BillItem[];
  insurance: BillItem[];
}

export interface CycleInfo {
  cycleStartFormatted: string;
  cycleEndFormatted: string;
  isSalaryCycle: boolean;
}

export interface PaymentOccurrencesCycleResponse {
  occurrences: PaymentOccurrence[];
  cycleStart: string;
  cycleEnd: string;
  cycleLabel: string;
  cycleStartFormatted: string;
  cycleEndFormatted: string;
  isSalaryCycle: boolean;
  prevAnchor: string;
  nextAnchor: string;
}

export interface DashboardSummary {
  monthLabel: string;
  currentMonth: number;
  currentYear: number;
  totalIncome: number;
  totalSpent: number;
  totalSpentToday: number;
  billsDue: number;
  incomeByAccount: AccountBreakdown[];
  expenseByAccount: AccountBreakdown[];
  billsDueDetails: BillsDueDetails;
  topCategories: Array<{ categoryId: number; name: string; total: number; color: string; icon: string }>;
  budgetUsage: Array<{ categoryId: number; categoryName: string; spent: number; budget: number; percentage: number }>;
  creditCardSpending: Array<{
    accountId: number;
    accountName: string;
    bankName?: string;
    spent: number;
    limit: number | null;
    percentage: number;
    color: string;
  }>;
  totalEMI: number;
  activeLoansCount: number;
  lastTransactions: Transaction[];
  savedThisCycle: number;
  cycleInfo?: CycleInfo;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  income: number;
  expense: number;
  spentFromAccount: number;
  spentFromCreditCard: number;
  incomeChangePercent: number | null;
  expenseChangePercent: number | null;
}

export interface NextMonthForecastItem {
  id: number | string; // auto-detected credit card bills use a synthetic string id ("cc-auto-<accountId>")
  name: string;
  amount: number;
  dueDate: number | null;
  subLabel?: string;
  creditLimit?: number | null;
  excluded: boolean;
}

export type ForecastItemType = 'scheduled_payment' | 'insurance' | 'loan' | 'credit_card_bill' | 'savings_goal' | 'planned_income';

export interface NextMonthForecast {
  monthLabel: string;
  nextMonth: number;
  nextYear: number;
  salary: Array<{
    profileId: number;
    accountName: string;
    bankName: string;
    amount: number;
    creditDate: string;
    creditDay: number;
  }>;
  plannedIncome: NextMonthForecastItem[];
  scheduledPayments: NextMonthForecastItem[];
  loans: NextMonthForecastItem[];
  insurance: NextMonthForecastItem[];
  creditCardBills: NextMonthForecastItem[];
  savings: NextMonthForecastItem[];
  totalIncome: number;
  totalOutflow: number;
  net: number;
  totalPlannedIncome: number;
  totalScheduled: number;
  totalLoans: number;
  totalInsurance: number;
  totalCreditCardBills: number;
  totalSavings: number;
  cycleInfo?: CycleInfo;
}

export interface InsertAccount {
  name: string;
  type: 'bank' | 'credit_card' | 'debit_card' | 'wallet' | 'pf';
  bankName?: string | null;
  accountNumber?: string | null;
  balance?: string;
  creditLimit?: string | null;
  monthlySpendingLimit?: string | null;
  billingDate?: number | null;
  linkedAccountId?: number | null;
  icon?: string | null;
  color?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface InsertTransaction {
  type: 'credit' | 'debit';
  amount: string;
  description?: string | null;
  merchant?: string | null;
  categoryId?: number | null;
  accountId?: number | null;
  transactionDate?: string;
  referenceNumber?: string | null;
  isRecurring?: boolean;
  savingsContributionId?: number;
  paymentOccurrenceId?: number;
}

export interface InsertBudget {
  categoryId: number;
  amount: string;
  month: number;
  year: number;
}

export interface InsertScheduledPayment {
  name: string;
  amount: string;
  dueDate?: number | null;
  categoryId?: number | null;
  frequency?: string;
  customIntervalMonths?: number | null;
  startMonth?: number | null;
  status?: 'active' | 'inactive';
  notes?: string | null;
}

export interface PlannedIncomeEntry {
  id: number;
  userId: number;
  name: string;
  amount: string;
  expectedMonth: number;
  expectedYear: number;
  status: 'planned' | 'received' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface InsertPlannedIncomeEntry {
  name: string;
  amount: string;
  expectedMonth: number;
  expectedYear: number;
  status?: 'planned' | 'received' | 'cancelled';
}

export interface PaymentOccurrence {
  id: number;
  scheduledPaymentId: number;
  month: number;
  year: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  paidAmount: string | null;
  notes: string | null;
  affectTransaction: boolean;
  affectAccountBalance: boolean;
  createdAt: string;
  scheduledPayment?: ScheduledPayment;
}

export interface SavingsGoal {
  id: number;
  userId: number | null;
  name: string;
  targetAmount: string;
  currentAmount: string;
  monthlyExpectedAmount: string | null;
  startDate: string;
  targetDate: string;
  accountId: number | null;
  toAccountId: number | null;
  icon: string | null;
  color: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'paused' | 'inactive';
  affectTransaction: boolean;
  affectAccountBalance: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavingsContribution {
  id: number;
  savingsGoalId: number;
  amount: string;
  contributionDate: string;
  notes: string | null;
  createdAt: string;
}

export interface SalaryProfile {
  id: number;
  userId: number;
  accountId: number | null;
  paydayRule: 'fixed_day' | 'last_working_day' | 'nth_weekday';
  fixedDay: number | null;
  weekdayPreference: number | null;
  monthCycleStartRule: 'salary_day' | 'fixed_day';
  monthCycleStartDay: number | null;
  monthlyAmount: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryCycle {
  id: number;
  salaryProfileId: number;
  expectedDate: string;
  actualDate: string | null;
  expectedAmount: string;
  actualAmount: string | null;
  status: 'pending' | 'received' | 'delayed' | 'missed';
  notes: string | null;
  transactionId: number | null;
  createdAt: string;
}

export interface Loan {
  id: number;
  userId: number | null;
  name: string;
  type: 'home_loan' | 'personal_loan' | 'credit_card_loan' | 'item_emi';
  loanType?: 'home_loan' | 'personal_loan' | 'credit_card_loan' | 'item_emi'; // alias for compatibility
  principalAmount: string;
  outstandingAmount: string;
  receivedAmount: string | null;
  interestRate: string;
  tenure?: number; // backend field name (remaining tenure for existing loans)
  tenureMonths?: number; // frontend alias
  emiAmount: string;
  emiDay: number | null;
  startDate: string;
  endDate: string | null;
  accountId: number | null;
  lenderName: string | null;
  loanAccountNumber: string | null;
  status: 'active' | 'closed' | 'defaulted' | 'preclosed' | 'closed_bt';
  isExistingLoan: boolean;
  nextEmiDate: string | null;
  closureDate: string | null;
  closureAmount: string | null;
  includesBtClosure?: boolean;
  closedViaBtFromLoanId?: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  affectBalance: boolean;
  createTransaction: boolean;
  autoMarkPaidEnabled?: boolean | null;
  autoMarkKeyword?: string | null;
}

export interface LoanBtAllocation {
  id: number;
  sourceLoanId: number;
  targetLoanId: number;
  originalOutstandingAmount: string;
  allocatedAmount: string;
  actualBtAmount: string | null;
  processingFee: string | null;
  processedDate: string | null;
  status: 'pending' | 'processed' | 'partial';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanInstallment {
  id: number;
  loanId: number;
  installmentNumber: number;
  dueDate: string;
  emiAmount: string;
  principalComponent: string;
  interestComponent: string;
  status: 'pending' | 'paid' | 'overdue' | 'partially_paid';
  paidDate: string | null;
  paidAmount: string | null;
  transactionId: number | null;
  notes: string | null;
  createdAt: string;
}

export interface LoanSpendingEntry {
  id: number;
  loanId: number;
  amount: string;
  reason: string | null;
  createdAt: string;
}

export interface InsertLoanSpendingEntry {
  amount: string;
  reason?: string | null;
}

export interface CardDetails {
  id: number;
  accountId: number;
  cardNumber: string;
  lastFourDigits: string;
  cardholderName: string | null;
  expiryMonth: number;
  expiryYear: number;
  cardType: 'visa' | 'mastercard' | 'rupay' | 'amex' | 'other' | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InsertSavingsGoal {
  name: string;
  targetAmount: string;
  currentAmount?: string;
  targetDate?: string | null;
  icon?: string | null;
  color?: string | null;
  status?: 'active' | 'completed' | 'cancelled';
}

export interface InsertSavingsContribution {
  savingsGoalId: number;
  amount: string;
  accountId?: number;
  contributedAt?: string;
  notes?: string | null;
}

export interface InsertSalaryProfile {
  employerName: string;
  monthlySalary: string;
  payDay: number;
  payDayRule?: 'exact' | 'before_weekend' | 'after_weekend' | 'last_working_day';
  accountId?: number | null;
  isActive?: boolean;
}

export interface InsertLoan {
  name: string;
  loanType: 'home_loan' | 'personal_loan' | 'credit_card_loan' | 'item_emi';
  principalAmount: string;
  receivedAmount?: string | null;
  interestRate: string;
  tenureMonths: number;
  emiAmount: string;
  startDate: string;
  endDate?: string | null;
  accountId?: number | null;
  lenderName?: string | null;
  loanAccountNumber?: string | null;
  status?: 'active' | 'closed' | 'defaulted';
  notes?: string | null;
}

export interface InsertCardDetails {
  accountId: number;
  cardNumber: string;
  cardHolderName: string;
  expiryMonth: number;
  expiryYear: number;
  cardType?: 'visa' | 'mastercard' | 'rupay' | 'amex' | 'other';
}

export interface LoanTerm {
  id: number;
  loanId: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  interestRate: string;
  tenureMonths: number;
  emiAmount: string;
  outstandingAtChange: string | null;
  reason: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LoanPayment {
  id: number;
  loanId: number;
  installmentId: number | null;
  paymentDate: string;
  amount: string;
  principalPaid: string | null;
  interestPaid: string | null;
  paymentType: 'emi' | 'prepayment' | 'partial';
  accountId: number | null;
  transactionId: number | null;
  notes: string | null;
  createdAt: string;
}

export interface InsertLoanTerm {
  loanId: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  interestRate: string;
  tenureMonths: number;
  emiAmount: string;
  outstandingAtChange?: string;
  reason?: string;
  notes?: string;
}

export interface InsertLoanPayment {
  loanId: number;
  installmentId?: number;
  paymentDate: string;
  amount: string;
  principalPaid?: string;
  interestPaid?: string;
  paymentType?: 'emi' | 'prepayment' | 'partial';
  accountId?: number;
  notes?: string;
}

export interface LoanWithDetails extends Loan {
  terms?: LoanTerm[];
  installments?: LoanInstallment[];
  payments?: LoanPayment[];
  account?: Account | null;
}

// Insurance types
export interface Insurance {
  id: number;
  userId: number | null;
  accountId: number | null;
  name: string;
  type: 'health' | 'life' | 'vehicle' | 'home' | 'term' | 'travel';
  providerName: string | null;
  policyNumber: string | null;
  premiumAmount: string;
  coverageAmount: string | null;
  premiumFrequency: 'annual' | 'semi_annual' | 'quarterly' | 'monthly';
  termsPerPeriod: number;
  policyTermYears: number | null;
  premiumPaymentTermYears: number | null;
  maturityAmount: string | null;
  startDate: string;
  endDate: string | null;
  renewalDate: string | null;
  status: 'active' | 'expired' | 'cancelled' | 'lapsed' | 'paid_up';
  createTransaction: boolean;
  affectBalance: boolean;
  autoFunded: boolean;
  linkedInsuranceId: number | null;
  autoMarkPaidEnabled?: boolean | null;
  autoMarkKeyword?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  account?: Account | null;
  premiums?: InsurancePremium[];
  linkedInsurance?: Insurance | null;
}

export interface InsurancePremium {
  id: number;
  insuranceId: number;
  termNumber: number;
  periodYear: number;
  periodNumber: number;
  amount: string;
  dueDate: string;
  paidDate: string | null;
  paidAmount: string | null;
  accountId: number | null;
  transactionId: number | null;
  status: 'pending' | 'paid' | 'overdue' | 'partially_paid';
  notes: string | null;
  createdAt: string;
}

export interface InsertInsurance {
  name: string;
  type: 'health' | 'life' | 'vehicle' | 'home' | 'term' | 'travel';
  providerName?: string;
  policyNumber?: string;
  premiumAmount: string;
  coverageAmount?: string;
  premiumFrequency?: 'annual' | 'semi_annual' | 'quarterly' | 'monthly';
  termsPerPeriod?: number;
  policyTermYears?: number;
  premiumPaymentTermYears?: number;
  maturityAmount?: string;
  startDate: string;
  endDate?: string;
  renewalDate?: string;
  status?: 'active' | 'expired' | 'cancelled' | 'lapsed' | 'paid_up';
  accountId?: number;
  createTransaction?: boolean;
  affectBalance?: boolean;
  autoFunded?: boolean;
  linkedInsuranceId?: number | null;
  autoMarkPaidEnabled?: boolean;
  autoMarkKeyword?: string | null;
  notes?: string;
}

export interface InsertInsurancePremium {
  insuranceId: number;
  termNumber: number;
  periodYear: number;
  periodNumber?: number;
  amount: string;
  dueDate: string;
  paidDate?: string;
  paidAmount?: string;
  accountId?: number;
  status?: 'pending' | 'paid' | 'overdue' | 'partially_paid';
  notes?: string;
}
