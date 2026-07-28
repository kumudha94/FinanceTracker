import type { 
  Account, Category, Transaction, Budget, ScheduledPayment, 
  User, DashboardData, DashboardSummary, NextMonthForecast, InsertAccount, InsertTransaction, 
  InsertBudget, InsertScheduledPayment, PaymentOccurrence,
  SavingsGoal, SavingsContribution, InsertSavingsGoal, InsertSavingsContribution,
  SalaryProfile, SalaryCycle, InsertSalaryProfile,
  Loan, LoanInstallment, InsertLoan, LoanBtAllocation,
  CardDetails, InsertCardDetails,
  LoanTerm, LoanPayment, InsertLoanTerm, InsertLoanPayment, LoanWithDetails,
  Insurance, InsurancePremium, InsertInsurance, InsertInsurancePremium,
  SenderInstitutionMapping, PendingBillMapping
} from './types';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';
console.log('API_BASE_URL', API_BASE_URL);

const STORAGE_KEYS = {
  ACCESS_TOKEN: '@finance_tracker_access_token',
  REFRESH_TOKEN: '@finance_tracker_refresh_token',
};

// Callback for when authentication fails and user needs to login again
let onAuthenticationFailed: (() => void) | null = null;

export function setAuthenticationFailedCallback(callback: () => void) {
  onAuthenticationFailed = callback;
}

/**
 * Get stored access token
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  } catch (error) {
    console.error('Failed to get access token:', error);
    return null;
  }
}

/**
 * Get stored refresh token
 */
async function getRefreshToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  } catch (error) {
    console.error('Failed to get refresh token:', error);
    return null;
  }
}

/**
 * Store JWT tokens
 */
export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.ACCESS_TOKEN, accessToken],
      [STORAGE_KEYS.REFRESH_TOKEN, refreshToken],
    ]);
  } catch (error) {
    console.error('Failed to store tokens:', error);
  }
}

/**
 * Legacy function for backward compatibility
 */
export async function storeToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
  } catch (error) {
    console.error('Failed to store token:', error);
  }
}

/**
 * Clear stored tokens
 */
export async function clearTokens(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.REFRESH_TOKEN]);
  } catch (error) {
    console.error('Failed to clear tokens:', error);
  }
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      // No refresh token available, clear tokens and return null
      await clearTokens();
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/api/auth/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Refresh failed, clear tokens
      await clearTokens();
      return null;
    }

    const data = await response.json();
    if (data.accessToken) {
      await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.accessToken);
      return data.accessToken;
    }

    // No access token in response, clear tokens
    await clearTokens();
    return null;
  } catch (error) {
    console.error('Failed to refresh token:', error);
    await clearTokens();
    return null;
  }
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  // Check network connectivity before making request
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    throw new Error('No internet connection. Please check your network settings.');
  }

  // Public endpoints that don't require authentication
  const publicEndpoints = [
    '/api/auth/login',
    '/api/auth/login-password',
    '/api/auth/signup',
    '/api/auth/verify-otp',
    '/api/auth/refresh-token',
    '/api/auth/send-otp',
    '/api/auth/request-otp'
  ];

  const isPublicEndpoint = publicEndpoints.some(path => endpoint.startsWith(path));

  // Get token and add to headers
  let token = await getAccessToken();
  console.log(`[API] ${endpoint} - Token exists:`, !!token, token ? `(${token.substring(0, 20)}...)` : '(none)', `Public: ${isPublicEndpoint}`);
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (!isPublicEndpoint) {
    // Only require token for protected endpoints
    console.warn(`[API] ${endpoint} - No access token available for protected endpoint, clearing auth`);
    // No token available for protected endpoint, trigger authentication failure
    await clearTokens();
    if (onAuthenticationFailed) {
      onAuthenticationFailed();
    }
    throw new Error('Not authenticated. Please login again.');
  }

  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers,
      ...options,
    });

    // If 401 or 403, try refreshing the token and retry once
    if ((response.status === 401 || response.status === 403) && token) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        // Retry request with new token
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(url, {
          headers,
          ...options,
        });
        
        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          
          const error: any = new Error(errorData.message || errorData.error || `API error ${retryResponse.status}`);
          if (errorData.isSavingsContribution) {
            error.isSavingsContribution = true;
            error.savingsGoalName = errorData.savingsGoalName;
            error.savingsContributionId = errorData.savingsContributionId;
          }
          throw error;
        }

        // Handle 204 No Content
        if (retryResponse.status === 204) {
          return undefined as T;
        }

        return retryResponse.json();
      } else {
        // Refresh failed, clear tokens and trigger logout
        await clearTokens();
        if (onAuthenticationFailed) {
          onAuthenticationFailed();
        }
        throw new Error('Session expired. Please login again.');
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      // Create an error object with additional properties
      const error: any = new Error(errorData.message || errorData.error || `API error ${response.status}`);
      // Attach additional error data
      if (errorData.isSavingsContribution) {
        error.isSavingsContribution = true;
        error.savingsGoalName = errorData.savingsGoalName;
        error.savingsContributionId = errorData.savingsContributionId;
      }
      throw error;
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Network request failed');
  }
}

export const api = {
  getDashboard: () => apiRequest<DashboardData>('/api/dashboard'),
  getDashboardSummary: () => apiRequest<DashboardSummary>('/api/dashboard-summary'),
  getNextMonthForecast: () => apiRequest<NextMonthForecast>('/api/next-month-forecast'),
  
  getAccounts: () => apiRequest<Account[]>('/api/accounts'),
  createAccount: (data: InsertAccount) => 
    apiRequest<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateAccount: (id: number, data: Partial<InsertAccount>) => 
    apiRequest<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAccount: (id: number) =>
    apiRequest<void>(`/api/accounts/${id}`, { method: 'DELETE' }),

  getPendingInstitutionMappings: () =>
    apiRequest<SenderInstitutionMapping[]>('/api/institution-mappings/pending'),
  getQueuedSmsForMapping: (mappingId: number) =>
    apiRequest<{ mapping: SenderInstitutionMapping; queued: Array<{ smsLogId: number; message: string; sender: string | null; receivedAt: string; parsed: any }> }>(`/api/institution-mappings/${mappingId}/queued`),
  mapInstitutionToExistingAccount: (mappingId: number, accountId: number) =>
    apiRequest<{ success: boolean; account: Account; backfilled: number }>(`/api/institution-mappings/${mappingId}/map`, { method: 'POST', body: JSON.stringify({ accountId }) }),
  createAccountForInstitution: (mappingId: number, data: InsertAccount) =>
    apiRequest<{ success: boolean; account: Account; backfilled: number }>(`/api/institution-mappings/${mappingId}/create-account`, { method: 'POST', body: JSON.stringify(data) }),
  ignoreInstitutionMapping: (mappingId: number) =>
    apiRequest<{ success: boolean; mapping: SenderInstitutionMapping }>(`/api/institution-mappings/${mappingId}/ignore`, { method: 'POST' }),

  getPendingBillMappings: () =>
    apiRequest<PendingBillMapping[]>('/api/bill-mappings/pending'),
  linkBillMapping: (mappingId: number, scheduledPaymentId: number) =>
    apiRequest<{ success: boolean; mapping: PendingBillMapping }>(`/api/bill-mappings/${mappingId}/link`, { method: 'POST', body: JSON.stringify({ scheduledPaymentId }) }),
  createScheduledPaymentForBillMapping: (mappingId: number, data: InsertScheduledPayment) =>
    apiRequest<{ success: boolean; scheduledPayment: ScheduledPayment; mapping: PendingBillMapping }>(`/api/bill-mappings/${mappingId}/create-scheduled-payment`, { method: 'POST', body: JSON.stringify(data) }),
  ignoreBillMapping: (mappingId: number) =>
    apiRequest<{ success: boolean; mapping: PendingBillMapping }>(`/api/bill-mappings/${mappingId}/ignore`, { method: 'POST' }),

  getCategories: () => apiRequest<Category[]>('/api/categories'),
  createCategory: (data: { name: string; color: string; icon?: string; type?: string }) =>
    apiRequest<Category>('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id: number, data: { name: string; color: string; icon?: string; type?: string }) =>
    apiRequest<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCategory: (id: number) =>
    apiRequest<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  getCategoryUsage: () =>
    apiRequest<Array<{
      categoryId: number;
      transactionCount: number;
      scheduledPaymentCount: number;
      budgetCount: number;
      insuranceCount: number;
      loanCount: number;
    }>>('/api/categories/usage'),
  
  getTransactions: () => apiRequest<Transaction[]>('/api/transactions'),
  createTransaction: (data: InsertTransaction) => 
    apiRequest<Transaction>('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
  updateTransaction: (id: number, data: Partial<InsertTransaction>) => 
    apiRequest<Transaction>(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransaction: (id: number) => 
    apiRequest<void>(`/api/transactions/${id}`, { method: 'DELETE' }),
  
  getBudgets: (month: number, year: number) => 
    apiRequest<Budget[]>(`/api/budgets?month=${month}&year=${year}`),
  createBudget: (data: InsertBudget) => 
    apiRequest<Budget>('/api/budgets', { method: 'POST', body: JSON.stringify(data) }),
  updateBudget: (id: number, data: Partial<InsertBudget>) => 
    apiRequest<Budget>(`/api/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBudget: (id: number) => 
    apiRequest<void>(`/api/budgets/${id}`, { method: 'DELETE' }),
  
  getScheduledPayments: () => apiRequest<ScheduledPayment[]>('/api/scheduled-payments'),
  createScheduledPayment: (data: InsertScheduledPayment) => 
    apiRequest<ScheduledPayment>('/api/scheduled-payments', { method: 'POST', body: JSON.stringify(data) }),
  updateScheduledPayment: (id: number, data: Partial<InsertScheduledPayment>) => 
    apiRequest<ScheduledPayment>(`/api/scheduled-payments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteScheduledPayment: (id: number) => 
    apiRequest<void>(`/api/scheduled-payments/${id}`, { method: 'DELETE' }),
  getScheduledPaymentBillingAmount: (id: number) => 
    apiRequest<{ calculatedAmount: string; cycleStart: string; cycleEnd: string; cycleLabel: string; transactionCount: number }>(`/api/scheduled-payments/${id}/billing-amount`),
  
  getPaymentOccurrences: (month: number, year: number) => 
    apiRequest<any[]>(`/api/payment-occurrences?month=${month}&year=${year}`),
  generatePaymentOccurrences: (month: number, year: number) => 
    apiRequest<any>('/api/payment-occurrences/generate', { 
      method: 'POST', 
      body: JSON.stringify({ month, year }) 
    }),
  updatePaymentOccurrence: (id: number, data: { 
    status?: string; 
    affectTransaction?: boolean; 
    affectAccountBalance?: boolean;
  }) => 
    apiRequest<any>(`/api/payment-occurrences/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify(data) 
    }),
  
  getUser: () => apiRequest<User>('/api/user'),
  updateUser: (data: Partial<User>) => 
    apiRequest<User>('/api/user', { method: 'PATCH', body: JSON.stringify(data) }),
  setPin: (pin: string) => 
    apiRequest<{ success: boolean }>('/api/user/set-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  resetPin: () => 
    apiRequest<{ success: boolean }>('/api/user/reset-pin', { method: 'POST' }),
  
  suggestCategory: (description: string) => 
    apiRequest<{ categoryId: number | null }>('/api/transactions/suggest-category', { 
      method: 'POST', body: JSON.stringify({ description }) 
    }),

  parseSms: (message: string, sender?: string) => 
    apiRequest<{
      success: boolean;
      transaction?: Transaction;
      parsed?: {
        amount: number;
        type: 'debit' | 'credit';
        merchant?: string;
        description?: string;
        referenceNumber?: string;
        date?: string;
      };
      message?: string;
    }>('/api/parse-sms', { 
      method: 'POST', 
      body: JSON.stringify({ message, sender, receivedAt: new Date().toISOString() }) 
    }),

  parseSmsBatch: (messages: string[]) =>
    apiRequest<{
      total: number;
      successful: number;
      failed: number;
      results: Array<{
        success: boolean;
        transaction?: Transaction;
        message: string;
        error?: string;
      }>;
    }>('/api/parse-sms-batch', {
      method: 'POST',
      body: JSON.stringify({ messages })
    }),

  getSavingsGoals: () => apiRequest<SavingsGoal[]>('/api/savings-goals'),
  createSavingsGoal: (data: InsertSavingsGoal) => 
    apiRequest<SavingsGoal>('/api/savings-goals', { method: 'POST', body: JSON.stringify(data) }),
  updateSavingsGoal: (id: number, data: Partial<InsertSavingsGoal>) => 
    apiRequest<SavingsGoal>(`/api/savings-goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSavingsGoal: (id: number) => 
    apiRequest<void>(`/api/savings-goals/${id}`, { method: 'DELETE' }),
  getContributions: (goalId: number) => 
    apiRequest<SavingsContribution[]>(`/api/savings-goals/${goalId}/contributions`),
  addContribution: (goalId: number, data: Omit<InsertSavingsContribution, 'savingsGoalId'> & { createTransaction?: boolean; affectBalance?: boolean }) => 
    apiRequest<SavingsContribution>(`/api/savings-goals/${goalId}/contributions`, { 
      method: 'POST', body: JSON.stringify(data) 
    }),
  deleteContribution: (id: number) => 
    apiRequest<void>(`/api/savings-contributions/${id}`, { method: 'DELETE' }),

  getSalaryProfile: () => apiRequest<SalaryProfile | null>('/api/salary-profile'),
  createSalaryProfile: (data: InsertSalaryProfile) => 
    apiRequest<SalaryProfile>('/api/salary-profile', { method: 'POST', body: JSON.stringify(data) }),
  updateSalaryProfile: (id: number, data: Partial<InsertSalaryProfile>) => 
    apiRequest<SalaryProfile>(`/api/salary-profile/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getNextPaydays: (count?: number) => 
    apiRequest<string[]>(`/api/salary-profile/next-paydays${count ? `?count=${count}` : ''}`),
  getSalaryCycles: () => 
    apiRequest<SalaryCycle[]>('/api/salary-cycles'),
  createSalaryCycle: (data: any) => 
    apiRequest<SalaryCycle>('/api/salary-cycles', { method: 'POST', body: JSON.stringify(data) }),
  updateSalaryCycle: (id: number, data: any) => 
    apiRequest<SalaryCycle>(`/api/salary-cycles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getLoans: () => apiRequest<Loan[]>('/api/loans'),
  getLoan: (id: number) => apiRequest<Loan>(`/api/loans/${id}`),
  getLoanSummary: () => apiRequest<{
    totalLoans: number;
    totalOutstanding: number;
    totalEmiThisMonth: number;
    nextEmiDue: { loanName: string; amount: string; dueDate: string } | null;
  }>('/api/loan-summary'),
  createLoan: (data: InsertLoan) => 
    apiRequest<Loan>('/api/loans', { method: 'POST', body: JSON.stringify(data) }),
  updateLoan: (id: number, data: Partial<InsertLoan>) => 
    apiRequest<Loan>(`/api/loans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLoan: (id: number) => 
    apiRequest<void>(`/api/loans/${id}`, { method: 'DELETE' }),
  precloseLoan: (id: number, data: { closureAmount: string; closureDate: string; accountId?: number; createTransaction?: boolean }) =>
    apiRequest<Loan>(`/api/loans/${id}/preclose`, { method: 'POST', body: JSON.stringify(data) }),
  topupLoan: (id: number, data: { 
    topupAmount: string; 
    disbursementDate?: string; 
    newEmiAmount?: string; 
    additionalTenure?: number;
    interestRate?: string;
    accountId?: number; 
    createTransaction?: boolean;
    notes?: string;
  }) =>
    apiRequest<Loan>(`/api/loans/${id}/topup`, { method: 'POST', body: JSON.stringify(data) }),
  makePartPayment: (id: number, data: { 
    amount: string; 
    paymentDate: string;
    effect: 'reduce_emi' | 'reduce_tenure';
    accountId?: number; 
    createTransaction?: boolean;
  }) =>
    apiRequest<Loan>(`/api/loans/${id}/part-payment`, { method: 'POST', body: JSON.stringify(data) }),
  getLoanInstallments: (loanId: number) => 
    apiRequest<LoanInstallment[]>(`/api/loans/${loanId}/installments`),
  updateInstallment: (loanId: number, installmentId: number, data: Partial<LoanInstallment>) => 
    apiRequest<LoanInstallment>(`/api/loans/${loanId}/installments/${installmentId}`, { 
      method: 'PATCH', body: JSON.stringify(data) 
    }),
  generateInstallments: (loanId: number) => 
    apiRequest<LoanInstallment[]>(`/api/loans/${loanId}/generate-installments`, { method: 'POST' }),
  regenerateInstallments: (loanId: number) => {
    console.log('API: Calling regenerate installments for loan:', loanId);
    const endpoint = `/api/loans/${loanId}/regenerate-installments`;
    console.log('API: Full URL:', `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000'}${endpoint}`);
    return apiRequest<LoanInstallment[]>(endpoint, { method: 'POST' });
  },

  // Loan BT Allocations
  getLoanBtAllocations: (loanId: number) => 
    apiRequest<LoanBtAllocation[]>(`/api/loans/${loanId}/bt-allocations`),
  getLoanBtAllocationsAsTarget: (loanId: number) => 
    apiRequest<LoanBtAllocation[]>(`/api/loans/${loanId}/bt-allocations-as-target`),
  getBtAllocation: (id: number) => 
    apiRequest<LoanBtAllocation>(`/api/bt-allocations/${id}`),
  createLoanBtAllocation: (loanId: number, data: { targetLoanId: number; originalOutstandingAmount: string; allocatedAmount: string }) =>
    apiRequest<LoanBtAllocation>(`/api/loans/${loanId}/bt-allocations`, { method: 'POST', body: JSON.stringify(data) }),
  updateBtAllocation: (id: number, data: Partial<{ allocatedAmount: string; status: string }>) =>
    apiRequest<LoanBtAllocation>(`/api/bt-allocations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBtAllocation: (id: number) =>
    apiRequest<void>(`/api/bt-allocations/${id}`, { method: 'DELETE' }),
  processBtPayment: (id: number, data: { actualBtAmount: string; processedDate: string; processingFee?: string }) =>
    apiRequest<{ allocation: LoanBtAllocation; targetLoan: Loan }>(`/api/bt-allocations/${id}/process`, { method: 'POST', body: JSON.stringify(data) }),

  getCardDetails: (accountId: number) => 
    apiRequest<CardDetails | null>(`/api/accounts/${accountId}/card-details`),
  saveCardDetails: (accountId: number, data: Omit<InsertCardDetails, 'accountId'>) => 
    apiRequest<CardDetails>(`/api/accounts/${accountId}/card-details`, { 
      method: 'POST', body: JSON.stringify(data) 
    }),
  deleteCardDetails: (accountId: number) => 
    apiRequest<void>(`/api/accounts/${accountId}/card-details`, { method: 'DELETE' }),

  getLoanWithDetails: (id: number) => apiRequest<LoanWithDetails>(`/api/loans/${id}/details`),
  getLoanTerms: (loanId: number) => apiRequest<LoanTerm[]>(`/api/loans/${loanId}/terms`),
  createLoanTerm: (loanId: number, data: Omit<InsertLoanTerm, 'loanId'>) => 
    apiRequest<LoanTerm>(`/api/loans/${loanId}/terms`, { method: 'POST', body: JSON.stringify(data) }),
  getLoanPayments: (loanId: number) => apiRequest<LoanPayment[]>(`/api/loans/${loanId}/payments`),
  createLoanPayment: (loanId: number, data: Omit<InsertLoanPayment, 'loanId'>) => 
    apiRequest<LoanPayment>(`/api/loans/${loanId}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  updateLoanPayment: (id: number, data: Partial<InsertLoanPayment>) =>
    apiRequest<LoanPayment>(`/api/loan-payments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLoanPayment: (id: number) =>
    apiRequest<void>(`/api/loan-payments/${id}`, { method: 'DELETE' }),
  markInstallmentPaid: (loanId: number, installmentId: number, data: { 
    paidDate: string; 
    paidAmount: string; 
    accountId?: number;
    notes?: string;
    createTransaction?: boolean;
    affectBalance?: boolean;
  }) => 
    apiRequest<LoanInstallment>(`/api/loans/${loanId}/installments/${installmentId}/pay`, { 
      method: 'POST', body: JSON.stringify(data) 
    }),

  verifyPin: (pin: string) => 
    apiRequest<{ valid: boolean; message?: string }>('/api/user/verify-pin', { 
      method: 'POST', body: JSON.stringify({ pin }) 
    }),

  getMonthlyExpenses: () => 
    apiRequest<Array<{
      month: string;
      year: number;
      fullMonth: string;
      expenses: number;
      monthIndex: number;
    }>>('/api/expenses/monthly'),

  getCategoryBreakdown: (month: number, year: number) => 
    apiRequest<{
      month: number;
      year: number;
      totalExpenses: number;
      breakdown: Array<{
        categoryId: number;
        categoryName: string;
        total: number;
        color: string;
        transactionCount: number;
      }>;
    }>(`/api/expenses/category-breakdown?month=${month}&year=${year}`),

  getCreditCardSpending: (cycle: 'current' | 'previous' = 'current') =>
    apiRequest<Array<{
      accountId: number;
      accountName: string;
      color: string | null;
      billingDate: number;
      cycleStart: string;
      cycleEnd: string;
      totalSpent: number;
      creditLimit: number;
      availableCredit: number;
      usedCredit: number;
      utilizationPercent: number;
    }>>(`/api/credit-card-spending?cycle=${cycle}`),

  getMonthlyCreditCardSpending: () => 
    apiRequest<Array<{
      month: string;
      year: number;
      fullMonth: string;
      spending: number;
      monthIndex: number;
    }>>('/api/credit-card-spending/monthly'),

  // Credit Card Bills (enhanced with statement data)
  getCreditCardBills: () =>
    apiRequest<Array<{
      accountId: number;
      accountName: string;
      bankName: string | null;
      billingDate: number | null;
      statementId: number;
      openingBalance: string;
      newCharges: string;
      payments: string;
      credits: string;
      statementBalance: string;
      minimumDue: string;
      paidAmount: string;
      paidDate: string | null;
      cycleSpending: string;
      cycleStartDate: string;
      cycleEndDate: string;
      dueDate: string;
      daysUntilDue: number;
      paymentStatus: string;
      paymentOccurrenceId: number | null;
      scheduledPaymentId: number | null;
      limit: number | null;
      monthlyLimit: number | null;
    }>>('/api/credit-card-bills'),

  // Credit Card Statements
  getCreditCardStatements: (accountId: number) =>
    apiRequest<Array<{
      id: number;
      accountId: number;
      statementMonth: number;
      statementYear: number;
      billingCycleStart: string;
      billingCycleEnd: string;
      statementDate: string;
      dueDate: string;
      openingBalance: string;
      newCharges: string;
      payments: string;
      credits: string;
      statementBalance: string;
      minimumDue: string;
      paidAmount: string;
      paidDate: string | null;
      status: string;
    }>>(`/api/credit-card-statements/${accountId}`),

  recordCreditCardPayment: (statementId: number, amount: number, paidDate?: string) =>
    apiRequest<any>(`/api/credit-card-statements/${statementId}/payment`, {
      method: 'POST',
      body: JSON.stringify({ amount, paidDate }),
    }),

  // Insurance
  getInsurances: () => apiRequest<Insurance[]>('/api/insurances'),
  getInsurance: (id: number) => apiRequest<Insurance>(`/api/insurances/${id}`),
  createInsurance: (data: InsertInsurance) => 
    apiRequest<Insurance>('/api/insurances', { method: 'POST', body: JSON.stringify(data) }),
  updateInsurance: (id: number, data: Partial<InsertInsurance>) => 
    apiRequest<Insurance>(`/api/insurances/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteInsurance: (id: number) => 
    apiRequest<void>(`/api/insurances/${id}`, { method: 'DELETE' }),

  // Insurance Premiums
  getInsurancePremiums: (insuranceId: number) => 
    apiRequest<InsurancePremium[]>(`/api/insurances/${insuranceId}/premiums`),
  createInsurancePremium: (insuranceId: number, data: InsertInsurancePremium) => 
    apiRequest<InsurancePremium>(`/api/insurances/${insuranceId}/premiums`, { method: 'POST', body: JSON.stringify(data) }),
  updateInsurancePremium: (insuranceId: number, id: number, data: Partial<InsertInsurancePremium>) => 
    apiRequest<InsurancePremium>(`/api/insurances/${insuranceId}/premiums/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  markPremiumPaid: (insuranceId: number, premiumId: number, data: { amount: string; accountId?: number; createTransaction?: boolean }) => 
    apiRequest<InsurancePremium>(`/api/insurances/${insuranceId}/premiums/${premiumId}/pay`, { method: 'POST', body: JSON.stringify(data) }),
  deleteInsurancePremium: (insuranceId: number, id: number) => 
    apiRequest<void>(`/api/insurances/${insuranceId}/premiums/${id}`, { method: 'DELETE' }),
  regenerateInsurancePremiums: (insuranceId: number) => 
    apiRequest<InsurancePremium[]>(`/api/insurances/${insuranceId}/regenerate-premiums`, { method: 'POST' }),

  // Authentication
  requestOTP: (email: string, username: string) => 
    apiRequest<{ success: boolean }>('/api/auth/request-otp', { 
      method: 'POST', 
      body: JSON.stringify({ email, username }) 
    }),
  verifyOTP: (email: string, otp: string) => 
    apiRequest<{ success: boolean; accessToken: string; refreshToken: string; user: User & { hasPassword: boolean; hasPin: boolean; biometricEnabled: boolean } }>('/api/auth/verify-otp', { 
      method: 'POST', 
      body: JSON.stringify({ email, otp }) 
    }),
  loginWithPassword: async (email: string, password: string) => {
    const response = await apiRequest<{ success: boolean; accessToken: string; refreshToken: string; user: User & { hasPassword: boolean; hasPin: boolean; biometricEnabled: boolean } }>('/api/auth/login-password', { 
      method: 'POST', 
      body: JSON.stringify({ email, password }) 
    });
    
    if (response.accessToken && response.refreshToken) {
      await storeTokens(response.accessToken, response.refreshToken);
    }
    
    return response;
  },
  setPassword: (password: string) => 
    apiRequest<{ success: boolean; user: User & { hasPassword: boolean } }>('/api/auth/set-password', { 
      method: 'POST', 
      body: JSON.stringify({ password }) 
    }),
  setupPin: (userId: number, pin: string) => 
    apiRequest<{ success: boolean }>('/api/auth/setup-pin', { 
      method: 'POST', 
      body: JSON.stringify({ userId, pin }) 
    }),
  verifyPinAuth: (userId: number, pin: string) => 
    apiRequest<{ success: boolean; accessToken: string; refreshToken: string; user: User }>('/api/auth/verify-pin', { 
      method: 'POST', 
      body: JSON.stringify({ userId, pin }) 
    }),
  verifyBiometric: (userId: number) => 
    apiRequest<{ success: boolean; accessToken: string; refreshToken: string; user: User }>('/api/auth/verify-biometric', { 
      method: 'POST', 
      body: JSON.stringify({ userId }) 
    }),
  toggleBiometric: (userId: number, enabled: boolean) => 
    apiRequest<{ success: boolean }>('/api/auth/toggle-biometric', { 
      method: 'POST', 
      body: JSON.stringify({ userId, enabled }) 
    }),
  deleteUserAccount: () => 
    apiRequest<{ message: string }>('/api/users/delete-account', { method: 'DELETE' }),
};
