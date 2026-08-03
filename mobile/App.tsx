import 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, ActivityIndicator } from 'react-native';
import Toast from 'react-native-toast-message';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import DashboardScreen from './src/screens/DashboardScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import TransactionsScreen from './src/screens/TransactionsScreen';
import MoreScreen from './src/screens/MoreScreen';
import AddTransactionScreen from './src/screens/AddTransactionScreen';
import BudgetsScreen from './src/screens/BudgetsScreen';
import CategoryTransactionsScreen from './src/screens/CategoryTransactionsScreen';
import ScheduledPaymentsScreen from './src/screens/ScheduledPaymentsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AddAccountScreen from './src/screens/AddAccountScreen';
import AddBudgetScreen from './src/screens/AddBudgetScreen';
import AddScheduledPaymentScreen from './src/screens/AddScheduledPaymentScreen';
import ScanSMSScreen from './src/screens/ScanSMSScreen';
import SmsAutoReadScreen from './src/screens/SmsAutoReadScreen';
import RescanPreviewScreen from './src/screens/RescanPreviewScreen';
import SavingsGoalsScreen from './src/screens/SavingsGoalsScreen';
import SalaryScreen from './src/screens/SalaryScreen';
import LoansScreen from './src/screens/LoansScreen';
import AddLoanScreen from './src/screens/AddLoanScreen';
import LoanDetailsScreen from './src/screens/LoanDetailsScreen';
import InsuranceScreen from './src/screens/InsuranceScreen';
import AddInsuranceScreen from './src/screens/AddInsuranceScreen';
import InsuranceDetailsScreen from './src/screens/InsuranceDetailsScreen';
import PinLockScreen from './src/screens/PinLockScreen';
import PinSetupScreen from './src/screens/PinSetupScreen';
import LoginScreen from './src/screens/LoginScreen';
import OTPVerificationScreen from './src/screens/OTPVerificationScreen';
import SetPasswordScreen from './src/screens/SetPasswordScreen';
import ExpenseDetailsScreen from './src/screens/ExpenseDetailsScreen';
import CreditCardDetailsScreen from './src/screens/CreditCardDetailsScreen';
import CategoriesScreen from './src/screens/CategoriesScreen';
import AddCategoryScreen from './src/screens/AddCategoryScreen';
import ImportStatementScreen from './src/screens/ImportStatementScreen';
import InstitutionMappingsScreen from './src/screens/InstitutionMappingsScreen';
import BillsInboxScreen from './src/screens/BillsInboxScreen';
import SmsStatementsHubScreen from './src/screens/SmsStatementsHubScreen';
import NeedsReviewHubScreen from './src/screens/NeedsReviewHubScreen';

import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { NetworkProvider } from './src/contexts/NetworkContext';
import { getThemedColors, COLORS } from './src/lib/utils';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: (failureCount, error) => {
        // Don't retry on network errors
        if (error instanceof Error && error.message.includes('No internet connection')) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry mutations on network errors
        if (error instanceof Error && error.message.includes('No internet connection')) {
          return false;
        }
        return false; // Generally don't retry mutations
      },
    },
  },
});

export type MoreStackParamList = {
  MoreMenu: undefined;
  Budgets: undefined;
  AddBudget: { budgetId?: number; month?: number; year?: number } | undefined;
  CategoryTransactions: { categoryId: number; categoryName: string; month: number; year: number } | undefined;
  ScheduledPayments: undefined;
  AddScheduledPayment: {
    paymentId?: number;
    linkBillMappingId?: number;
    prefill?: { name?: string; amount?: string; dueDate?: number };
  } | undefined;
  SavingsGoals: undefined;
  Salary: undefined;
  Loans: undefined;
  AddLoan: { loanId?: number } | undefined;
  LoanDetails: { loanId: number };
  Insurance: undefined;
  AddInsurance: { insuranceId?: number } | undefined;
  InsuranceDetails: { insuranceId: number };
  Categories: undefined;
  AddCategory: { categoryId?: number } | undefined;
  Settings: undefined;
  ScanSMS: undefined;
  SmsAutoRead: undefined;
  RescanPreview: { messages: { sender: string; message: string; receivedAt: string }[] };
  ImportStatement: undefined;
  InstitutionMappings: undefined;
  BillsInbox: undefined;
  SmsStatementsHub: undefined;
  NeedsReviewHub: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  OTPVerification: { email: string; username: string };
  SetPassword: undefined;
  PinSetup: undefined;
  Main: undefined;
  AddTransaction: { accountId?: number; transactionId?: number } | undefined;
  AddAccount: { accountId?: number } | undefined;
  ExpenseDetails: undefined;
  CreditCardDetails: undefined;
  Settings: undefined;
  // Also reachable via the More tab's own menu (MoreStackParamList) — registered here too,
  // same pattern as Settings, so a direct link from Dashboard pushes onto the root stack
  // (proper back/tab-switch behavior) instead of leaving stale state inside the More tab's
  // nested navigator (which persists across tab switches by default in React Navigation).
  InstitutionMappings: undefined;
  BillsInbox: undefined;
  Salary: undefined;
  SmsAutoRead: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Accounts: undefined;
  Transactions: undefined;
  More: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function MoreStackNavigator() {
  const { resolvedTheme } = useTheme();
  const colors = getThemedColors(resolvedTheme);
  
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 20,
        },
      }}
    >
      <MoreStack.Screen 
        name="MoreMenu" 
        component={MoreScreen}
        options={{ headerShown: false }}
      />
      <MoreStack.Screen 
        name="Budgets" 
        component={BudgetsScreen}
        options={{ title: 'Plan Budget' }}
      />
      <MoreStack.Screen 
        name="AddBudget" 
        component={AddBudgetScreen}
        options={({ route }) => ({ 
          title: route.params?.budgetId ? 'Edit Budget' : 'Add Budget' 
        })}
      />
      <MoreStack.Screen 
        name="CategoryTransactions" 
        component={CategoryTransactionsScreen}
        options={({ route }) => ({ 
          title: route.params?.categoryName || 'Transactions',
          headerBackTitle: 'Back'
        })}
      />
      <MoreStack.Screen 
        name="ScheduledPayments" 
        component={ScheduledPaymentsScreen}
        options={{ title: 'Scheduled Payments' }}
      />
      <MoreStack.Screen 
        name="AddScheduledPayment" 
        component={AddScheduledPaymentScreen}
        options={{ title: 'Add Payment' }}
      />
      <MoreStack.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <MoreStack.Screen
        name="ScanSMS"
        component={ScanSMSScreen}
        options={{ title: 'Scan SMS' }}
      />
      <MoreStack.Screen
        name="SmsAutoRead"
        component={SmsAutoReadScreen}
        options={{ title: 'Auto-Read SMS' }}
      />
      <MoreStack.Screen
        name="RescanPreview"
        component={RescanPreviewScreen}
        options={{ title: 'Review Found Messages' }}
      />
      <MoreStack.Screen 
        name="SavingsGoals" 
        component={SavingsGoalsScreen}
        options={{ title: 'Savings Goals' }}
      />
      <MoreStack.Screen 
        name="Salary" 
        component={SalaryScreen}
        options={{ title: 'Salary Income' }}
      />
      <MoreStack.Screen 
        name="Loans" 
        component={LoansScreen}
        options={{ title: 'Loans & EMI' }}
      />
      <MoreStack.Screen 
        name="AddLoan" 
        component={AddLoanScreen}
        options={({ route }) => ({ 
          title: route.params?.loanId ? 'Edit Loan' : 'Add Loan' 
        })}
      />
      <MoreStack.Screen 
        name="LoanDetails" 
        component={LoanDetailsScreen}
        options={{ title: 'Loan Details' }}
      />
      <MoreStack.Screen 
        name="Insurance" 
        component={InsuranceScreen}
        options={{ title: 'Insurance' }}
      />
      <MoreStack.Screen 
        name="AddInsurance" 
        component={AddInsuranceScreen}
        options={({ route }) => ({ 
          title: route.params?.insuranceId ? 'Edit Insurance' : 'Add Insurance' 
        })}
      />
      <MoreStack.Screen 
        name="InsuranceDetails" 
        component={InsuranceDetailsScreen}
        options={{ title: 'Insurance Details' }}
      />
      <MoreStack.Screen 
        name="Categories" 
        component={CategoriesScreen}
        options={{ headerShown: false }}
      />
      <MoreStack.Screen 
        name="AddCategory" 
        component={AddCategoryScreen}
        options={{ headerShown: false }}
      />
      <MoreStack.Screen
        name="ImportStatement"
        component={ImportStatementScreen}
        options={{ headerShown: false }}
      />
      <MoreStack.Screen
        name="InstitutionMappings"
        component={InstitutionMappingsScreen}
        options={{ title: 'New Accounts Detected' }}
      />
      <MoreStack.Screen
        name="BillsInbox"
        component={BillsInboxScreen}
        options={{ title: 'Bills Inbox' }}
      />
      <MoreStack.Screen
        name="SmsStatementsHub"
        component={SmsStatementsHubScreen}
        options={{ title: 'SMS & Statements' }}
      />
      <MoreStack.Screen
        name="NeedsReviewHub"
        component={NeedsReviewHubScreen}
        options={{ title: 'Needs Review' }}
      />
    </MoreStack.Navigator>
  );
}

function TabNavigator() {
  const { resolvedTheme } = useTheme();
  const colors = getThemedColors(resolvedTheme);
  
  return (
    <Tab.Navigator
      screenOptions={({ route }: { route: { name: keyof TabParamList } }) => ({
        tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Dashboard') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Accounts') {
            iconName = focused ? 'wallet' : 'wallet-outline';
          } else if (route.name === 'Transactions') {
            iconName = focused ? 'list' : 'list-outline';
          } else {
            iconName = focused ? 'menu' : 'menu-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: 5,
          height: 60,
        },
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 20,
        },
      })}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{ title: 'My Tracker' }}
      />
      <Tab.Screen 
        name="Accounts" 
        component={AccountsScreen}
        options={{ title: 'Accounts' }}
      />
      <Tab.Screen 
        name="Transactions" 
        component={TransactionsScreen}
        options={{ title: 'Transactions' }}
      />
      <Tab.Screen 
        name="More" 
        component={MoreStackNavigator}
        options={{ title: 'More', headerShown: false }}
      />
    </Tab.Navigator>
  );
}

function MainApp() {
  const { resolvedTheme } = useTheme();
  const { isLocked, isLoading, isAuthenticated, hasPassword } = useAuth();
  const colors = getThemedColors(resolvedTheme);
  
  const navigationTheme = resolvedTheme === 'dark' ? {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  } : {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return (
      <NavigationContainer theme={navigationTheme}>
        <RootStack.Navigator
          screenOptions={{
            headerShown: false,
          }}
        >
          <RootStack.Screen name="Login" component={LoginScreen} />
          <RootStack.Screen name="OTPVerification" component={OTPVerificationScreen} />
          <RootStack.Screen name="SetPassword" component={SetPasswordScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    );
  }

  // Show password setup if authenticated but no password set
  if (isAuthenticated && !hasPassword) {
    return (
      <NavigationContainer theme={navigationTheme}>
        <RootStack.Navigator
          screenOptions={{
            headerShown: false,
          }}
        >
          <RootStack.Screen name="SetPassword" component={SetPasswordScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    );
  }

  // Show PIN lock if authenticated and locked
  if (isLocked) {
    return <PinLockScreen />;
  }

  // Show main app if authenticated and unlocked
  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.primary,
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: '600',
          },
        }}
      >
        <RootStack.Screen 
          name="Main" 
          component={TabNavigator} 
          options={{ headerShown: false }}
        />
        <RootStack.Screen 
          name="PinSetup" 
          component={PinSetupScreen}
          options={{ 
            title: 'Setup PIN',
            headerShown: false
          }}
        />
        <RootStack.Screen 
          name="AddTransaction" 
          component={AddTransactionScreen}
          options={({ route }) => ({ 
            title: route.params?.transactionId ? 'Edit Transaction' : 'Add Transaction', 
            presentation: 'modal' 
          })}
        />
        <RootStack.Screen 
          name="AddAccount" 
          component={AddAccountScreen}
          options={({ route }) => ({ 
            title: route.params?.accountId ? 'Edit Account' : 'Add Account', 
            presentation: 'modal' 
          })}
        />
        <RootStack.Screen 
          name="ExpenseDetails" 
          component={ExpenseDetailsScreen}
          options={{ headerShown: false }}
        />
        <RootStack.Screen 
          name="CreditCardDetails" 
          component={CreditCardDetailsScreen}
          options={{ headerShown: false }}
        />
        <RootStack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Settings',
            headerStyle: {
              backgroundColor: colors.primary,
            },
            headerTintColor: '#fff',
          }}
        />
        <RootStack.Screen
          name="InstitutionMappings"
          component={InstitutionMappingsScreen}
          options={{
            title: 'New Accounts Detected',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
          }}
        />
        <RootStack.Screen
          name="BillsInbox"
          component={BillsInboxScreen}
          options={{
            title: 'Bills Inbox',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
          }}
        />
        <RootStack.Screen
          name="Salary"
          component={SalaryScreen}
          options={{
            title: 'Salary & Income',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
          }}
        />
        <RootStack.Screen
          name="SmsAutoRead"
          component={SmsAutoReadScreen}
          options={{
            title: 'Auto-Read SMS',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: '#fff',
          }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <NetworkProvider>
                <MainApp />
                <StatusBar style="auto" />
                <Toast />
              </NetworkProvider>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
