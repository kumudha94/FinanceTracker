import { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Switch, Platform, Modal, Keyboard } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Toast from 'react-native-toast-message';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { getThemedColors } from '../lib/utils';
import { api } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';
import type { Account, InsertLoan, Loan } from '../lib/types';
import SpendingBreakdownModal from '../components/SpendingBreakdownModal';

const LOAN_TYPES = [
  { value: 'home_loan', label: 'Home Loan' },
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'credit_card_loan', label: 'Credit Card Loan' },
  { value: 'item_emi', label: 'Product/Item EMI' },
];

type RootStackParamList = {
  Loans: undefined;
  AddLoan: { loanId?: number };
};

export default function AddLoanScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<NativeStackScreenProps<RootStackParamList, 'AddLoan'>['route']>();
  const queryClient = useQueryClient();
  
  const loanId = route.params?.loanId;
  const isEditMode = !!loanId;

  const [formData, setFormData] = useState({
    name: '',
    type: 'personal_loan',
    lenderName: '',
    loanAccountNumber: '',
    principalAmount: '',
    outstandingAmount: '',
    interestRate: '',
    tenure: '',
    emiAmount: '',
    emiDay: '1',
    accountId: '',
  });
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [nextEmiDate, setNextEmiDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showNextEmiDatePicker, setShowNextEmiDatePicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [spendingBreakdownVisible, setSpendingBreakdownVisible] = useState(false);
  const [isExistingLoan, setIsExistingLoan] = useState(false);
  const [createTransaction, setCreateTransaction] = useState(false);
  const [affectBalance, setAffectBalance] = useState(false);
  const [autoMarkPaidEnabled, setAutoMarkPaidEnabled] = useState(false);
  const [autoMarkKeyword, setAutoMarkKeyword] = useState('');
  const [includesBtClosure, setIncludesBtClosure] = useState(false);
  const [btAllocations, setBtAllocations] = useState<Array<{
    targetLoanId: string;
    allocatedAmount: string;
  }>>([]);
  const [showBtLoanPicker, setShowBtLoanPicker] = useState<number | null>(null);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['/api/accounts'],
    queryFn: () => api.getAccounts(),
  });

  // Fetch all active loans for BT dropdown
  const { data: allLoans = [] } = useQuery<Loan[]>({
    queryKey: ['/api/loans'],
    queryFn: () => api.getLoans(),
  });

  // All active loans (excluding current loan in edit mode)
  const allActiveLoans = useMemo(() => {
    return allLoans.filter(loan => 
      loan.status === 'active' && 
      loan.id !== loanId // Exclude current loan in edit mode
    );
  }, [allLoans, loanId]);

  // Filter to only active loans that can be selected for BT (excludes already selected)
  const activeLoansForBt = useMemo(() => {
    return allActiveLoans.filter(loan => 
      !btAllocations.some(bt => bt.targetLoanId === loan.id.toString()) // Exclude already selected loans
    );
  }, [allActiveLoans, btAllocations]);

  // Fetch existing loan data if in edit mode
  const { data: existingLoan, isLoading: isLoadingLoan } = useQuery<Loan>({
    queryKey: ['/api/loans', loanId],
    queryFn: () => api.getLoan(loanId!),
    enabled: isEditMode,
  });

  // Populate form with existing loan data
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (existingLoan && isEditMode && !hasHydratedRef.current) {
      hasHydratedRef.current = true;
      setFormData({
        name: existingLoan.name,
        type: existingLoan.loanType || existingLoan.type || 'personal_loan',
        lenderName: existingLoan.lenderName || '',
        loanAccountNumber: existingLoan.loanAccountNumber || '',
        principalAmount: existingLoan.principalAmount,
        outstandingAmount: existingLoan.outstandingAmount || existingLoan.principalAmount,
        interestRate: existingLoan.interestRate,
        tenure: existingLoan.tenure?.toString() || '',
        emiAmount: existingLoan.emiAmount || '',
        emiDay: existingLoan.emiDay?.toString() || '1',
        accountId: existingLoan.accountId?.toString() || '',
      });
      
      if (existingLoan.startDate) {
        setStartDate(new Date(existingLoan.startDate));
      }
      
      if (existingLoan.nextEmiDate) {
        setNextEmiDate(new Date(existingLoan.nextEmiDate));
      }
      
      if (existingLoan.endDate) {
        setEndDate(new Date(existingLoan.endDate));
      }
      
      setIsExistingLoan(existingLoan.isExistingLoan ?? false);
      
      // Set toggle values - check both snake_case and camelCase
      const createTxn = (existingLoan as any).createTransaction ?? (existingLoan as any).create_transaction ?? false;
      const affectBal = (existingLoan as any).affectBalance ?? (existingLoan as any).affect_balance ?? false;
      
      setCreateTransaction(createTxn);
      setAffectBalance(affectBal);
      setAutoMarkPaidEnabled((existingLoan as any).autoMarkPaidEnabled ?? (existingLoan as any).auto_mark_paid_enabled ?? false);
      setAutoMarkKeyword((existingLoan as any).autoMarkKeyword ?? (existingLoan as any).auto_mark_keyword ?? '');
    }
  }, [existingLoan, isEditMode]);

  // Auto-select default account
  useEffect(() => {
    if (!formData.accountId && accounts.length > 0 && !isEditMode) {
      const defaultAccount = accounts.find(acc => acc.isDefault);
      if (defaultAccount) {
        setFormData(prev => ({ ...prev, accountId: defaultAccount.id.toString() }));
      }
    }
  }, [accounts, isEditMode]);

  // Calculate end date based on start date and tenure
  useEffect(() => {
    if (formData.tenure && startDate) {
      const tenureMonths = parseInt(formData.tenure);
      if (!isNaN(tenureMonths) && tenureMonths > 0) {
        const calculatedEndDate = new Date(startDate);
        calculatedEndDate.setMonth(calculatedEndDate.getMonth() + tenureMonths);
        setEndDate(calculatedEndDate);
      } else {
        setEndDate(null);
      }
    } else {
      setEndDate(null);
    }
  }, [formData.tenure, startDate]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload: any = {
        name: data.name,
        type: data.type,
        lenderName: data.lenderName || undefined,
        loanAccountNumber: data.loanAccountNumber || undefined,
        principalAmount: data.principalAmount,
        outstandingAmount: isExistingLoan ? data.outstandingAmount : data.principalAmount,
        interestRate: data.interestRate,
        tenure: parseInt(data.tenure),
        emiAmount: data.emiAmount || undefined,
        emiDay: parseInt(data.emiDay) || undefined,
        startDate: startDate.toISOString(),
        endDate: endDate ? endDate.toISOString() : undefined,
        accountId: data.accountId ? parseInt(data.accountId) : undefined,
        status: 'active' as const,
        userId: null,
        isExistingLoan,
        nextEmiDate: isExistingLoan ? nextEmiDate.toISOString() : undefined,
        createTransaction,
        affectBalance,
        includesBtClosure,
        autoMarkPaidEnabled,
        autoMarkKeyword: autoMarkPaidEnabled ? autoMarkKeyword.trim() : undefined,
      };
      const newLoan = await api.createLoan(payload);
      
      // If BT closure is enabled, create BT allocations
      if (includesBtClosure && btAllocations.length > 0) {
        for (const bt of btAllocations) {
          if (bt.targetLoanId && bt.allocatedAmount) {
            const targetLoan = allLoans.find(l => l.id.toString() === bt.targetLoanId);
            if (targetLoan) {
              await api.createLoanBtAllocation(newLoan.id, {
                targetLoanId: parseInt(bt.targetLoanId),
                originalOutstandingAmount: targetLoan.outstandingAmount,
                allocatedAmount: bt.allocatedAmount,
              });
            }
          }
        }
      }
      
      return newLoan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      Toast.show({
        type: 'success',
        text1: 'Loan Added',
        text2: 'Your loan has been added successfully',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Failed to Add Loan',
        text2: error.message || 'Could not add loan',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // For non-existing loans, keep the current outstanding amount from DB
      // For existing loans, use the form's outstanding amount
      const outstandingToSend = isExistingLoan 
        ? data.outstandingAmount 
        : (existingLoan?.outstandingAmount || data.principalAmount);
      
      const payload: any = {
        name: data.name,
        type: data.type,
        lenderName: data.lenderName || undefined,
        loanAccountNumber: data.loanAccountNumber || undefined,
        principalAmount: data.principalAmount,
        outstandingAmount: outstandingToSend,
        interestRate: data.interestRate,
        tenure: parseInt(data.tenure),
        emiAmount: data.emiAmount || undefined,
        emiDay: parseInt(data.emiDay) || undefined,
        startDate: startDate.toISOString(),
        endDate: endDate ? endDate.toISOString() : undefined,
        accountId: data.accountId ? parseInt(data.accountId) : undefined,
        createTransaction,
        affectBalance,
        nextEmiDate: isExistingLoan ? nextEmiDate.toISOString() : undefined,
        autoMarkPaidEnabled,
        autoMarkKeyword: autoMarkPaidEnabled ? autoMarkKeyword.trim() : undefined,
      };
      return api.updateLoan(loanId!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loan-summary'] });
      Toast.show({
        type: 'success',
        text1: 'Loan Updated',
        text2: 'Your loan has been updated successfully',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Failed to Update Loan',
        text2: error.message || 'Could not update loan',
        position: 'bottom',
      });
    },
  });

  const handleSubmit = () => {
    // Validate required fields
    const missingFields: string[] = [];
    
    if (!formData.name) missingFields.push('Loan Name');
    if (!formData.principalAmount) missingFields.push(isExistingLoan ? 'Original Loan Amount' : 'Principal Amount');
    if (isExistingLoan && !formData.outstandingAmount) missingFields.push('Current Outstanding');
    if (!formData.interestRate) missingFields.push('Interest Rate');
    if (!formData.tenure) missingFields.push('Tenure');
    if (!formData.emiAmount) missingFields.push('EMI Amount');
    if (autoMarkPaidEnabled && !autoMarkKeyword.trim()) missingFields.push('SMS Keyword');

    if (missingFields.length > 0) {
      Toast.show({
        type: 'error',
        text1: 'Missing Fields',
        text2: missingFields.join(', '),
        position: 'bottom',
      });
      return;
    }
    
    // Validate that outstanding is not greater than principal for existing loans
    if (isExistingLoan) {
      const principal = parseFloat(formData.principalAmount);
      const outstanding = parseFloat(formData.outstandingAmount);
      if (outstanding > principal) {
        Toast.show({
          type: 'error',
          text1: 'Invalid Amount',
          text2: 'Outstanding amount cannot be greater than original loan amount',
          position: 'bottom',
        });
        return;
      }
    }
    
    if (isEditMode) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isLoadingLoan ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          enableOnAndroid
          enableAutomaticScroll
          extraScrollHeight={20}
          keyboardShouldPersistTaps="handled"
        >
      <View style={styles.form}>
        {/* Edit Mode Information Banner */}
        {isEditMode && (
          <View style={[styles.infoBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
            <Ionicons name="information-circle" size={20} color={colors.primary} />
            <Text style={[styles.infoBannerText, { color: colors.text }]}>
              Changing these settings will only apply to future payments. Past transactions remain unchanged.
            </Text>
          </View>
        )}

        {isEditMode && loanId && (
          <TouchableOpacity
            style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}
            onPress={() => setSpendingBreakdownVisible(true)}
          >
            <Ionicons name="pie-chart-outline" size={20} color="#8b5cf6" />
            <Text style={[styles.dropdownText, { color: colors.text, flex: 1 }]}>Spending Breakdown</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Loan Name *</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }, isEditMode && { opacity: 0.5 }]}
            placeholder="e.g., Home Loan - SBI"
            placeholderTextColor={colors.textMuted}
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
            editable={!isEditMode}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Loan Type *</Text>
          <View style={styles.loanTypeGrid}>
            {LOAN_TYPES.map(type => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.loanTypeButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  formData.type === type.value && { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
                  isEditMode && { opacity: 0.5 }
                ]}
                onPress={() => setFormData({ ...formData, type: type.value })}
                disabled={isEditMode}
              >
                <Text style={[
                  styles.loanTypeText,
                  { color: colors.text },
                  formData.type === type.value && { color: colors.primary, fontWeight: '600' }
                ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* New vs Existing Loan Toggle - only show when adding new loan */}
        {!isEditMode && (
          <View style={[styles.field, styles.toggleField, { marginBottom: 20 }]}>
            <View style={styles.toggleLeft}>
              <Ionicons name="time-outline" size={20} color={colors.text} />
              <View style={styles.toggleTextContainer}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 2 }]}>Existing Loan</Text>
                <Text style={[styles.helperText, { color: colors.textMuted }]}>
                  {isExistingLoan 
                    ? 'Track a loan you already have (simplified tracking)'
                    : 'Start tracking a new loan from the beginning'}
                </Text>
              </View>
            </View>
            <Switch
              value={isExistingLoan}
              onValueChange={setIsExistingLoan}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={isExistingLoan ? colors.primary : '#f4f3f4'}
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Lender/Bank Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }, isEditMode && { opacity: 0.5 }]}
            placeholder="e.g., State Bank of India"
            placeholderTextColor={colors.textMuted}
            value={formData.lenderName}
            onChangeText={(text) => setFormData({ ...formData, lenderName: text })}
            editable={!isEditMode}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Loan Account Number</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }, isEditMode && { opacity: 0.5 }]}
            placeholder="Optional"
            placeholderTextColor={colors.textMuted}
            value={formData.loanAccountNumber}
            onChangeText={(text) => setFormData({ ...formData, loanAccountNumber: text })}
            editable={!isEditMode}
          />
        </View>

        {/* For new loans: show Principal Amount */}
        {!isExistingLoan && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Principal Amount (₹) *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }, isEditMode && { opacity: 0.5 }]}
              placeholder="e.g., 1000000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={formData.principalAmount}
              onChangeText={(text) => setFormData({ ...formData, principalAmount: text })}
              editable={!isEditMode}
            />
          </View>
        )}

        {/* For existing loans: show Original Loan Amount and Current Outstanding */}
        {isExistingLoan && (
          <>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Original Loan Amount (₹) *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 1000000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={formData.principalAmount}
                onChangeText={(text) => setFormData({ ...formData, principalAmount: text })}
              />
              <Text style={[styles.helperText, { color: colors.textMuted, marginTop: 4 }]}>
                Total loan amount when you took the loan
              </Text>
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Current Outstanding (₹) *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 750000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={formData.outstandingAmount}
                onChangeText={(text) => setFormData({ ...formData, outstandingAmount: text })}
              />
              <Text style={[styles.helperText, { color: colors.textMuted, marginTop: 4 }]}>
                Remaining amount to be paid as of today
              </Text>
            </View>
          </>
        )}

        <View style={styles.row}>
          <View style={[styles.field, styles.halfField]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Interest Rate (%) *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="e.g., 8.5"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={formData.interestRate}
              onChangeText={(text) => setFormData({ ...formData, interestRate: text })}
            />
          </View>
          <View style={[styles.field, styles.halfField]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>
              {isExistingLoan ? 'Remaining Tenure *' : 'Tenure (months) *'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder={isExistingLoan ? 'e.g., 36' : 'e.g., 60'}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={formData.tenure}
              onChangeText={(text) => setFormData({ ...formData, tenure: text })}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.halfField]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Monthly EMI (₹) *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="e.g., 20000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={formData.emiAmount}
              onChangeText={(text) => setFormData({ ...formData, emiAmount: text })}
            />
          </View>
          <View style={[styles.field, styles.halfField]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>EMI Due Day *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="1-28"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={formData.emiDay}
              onChangeText={(text) => setFormData({ ...formData, emiDay: text })}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Start Date</Text>
          <TouchableOpacity
            style={[styles.datePickerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowDatePicker(true)}
            disabled={isEditMode}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.text} />
            <Text style={[styles.datePickerText, { color: colors.text }]}>
              {startDate.toLocaleDateString('en-US', { 
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              })}
            </Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
            textColor={colors.text}
            onChange={(event, selectedDate) => {
              setShowDatePicker(Platform.OS === 'ios');
              if (selectedDate) {
                setStartDate(selectedDate);
              }
            }}
          />
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Expected End Date</Text>
          <TouchableOpacity
            style={[styles.datePickerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowEndDatePicker(true)}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.text} />
            <Text style={[styles.datePickerText, { color: endDate ? colors.text : colors.textMuted }]}>
              {endDate ? endDate.toLocaleDateString('en-US', { 
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              }) : 'Auto-calculated from tenure'}
            </Text>
          </TouchableOpacity>
          {endDate && (
            <Text style={[styles.helperText, { color: colors.textMuted, marginTop: 4 }]}>
              Calculated based on {formData.tenure} months tenure
            </Text>
          )}
        </View>

        {showEndDatePicker && (
          <DateTimePicker
            value={endDate || new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
            textColor={colors.text}
            minimumDate={startDate}
            onChange={(event, selectedDate) => {
              setShowEndDatePicker(Platform.OS === 'ios');
              if (selectedDate) {
                setEndDate(selectedDate);
              }
            }}
          />
        )}

        {/* Next EMI Date - only for existing loans */}
        {isExistingLoan && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Next EMI Due Date *</Text>
            <TouchableOpacity
              style={[styles.datePickerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowNextEmiDatePicker(true)}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.text} />
              <Text style={[styles.datePickerText, { color: colors.text }]}>
                {nextEmiDate.toLocaleDateString('en-US', { 
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {showNextEmiDatePicker && (
          <DateTimePicker
            value={nextEmiDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={resolvedTheme}
            minimumDate={new Date()}
            onChange={(event, selectedDate) => {
              setShowNextEmiDatePicker(Platform.OS === 'ios');
              if (selectedDate) {
                setNextEmiDate(selectedDate);
              }
            }}
          />
        )}

        {accounts.length > 0 && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Link to Account (optional)</Text>
            <TouchableOpacity
              style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }, isEditMode && { opacity: 0.5 }]}
              onPress={() => !isEditMode && setShowAccountPicker(!showAccountPicker)}
              disabled={isEditMode}
            >
              <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
              <Text style={[styles.dropdownText, { color: formData.accountId ? colors.text : colors.textMuted }]}>
                {formData.accountId ? accounts.find(a => a.id.toString() === formData.accountId)?.name : 'Select Account (Optional)'}
              </Text>
              {!isEditMode && (
                <Ionicons name={showAccountPicker ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
              )}
            </TouchableOpacity>
            {showAccountPicker && !isEditMode && (
              <View style={[styles.accountDropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.accountDropdownItem, { borderBottomColor: colors.border }]}
                  onPress={() => { 
                    setFormData({ ...formData, accountId: '' }); 
                    setShowAccountPicker(false); 
                  }}
                >
                  <Text style={[styles.accountDropdownText, { color: colors.textMuted }]}>
                    None
                  </Text>
                  {!formData.accountId && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
                {accounts.map(account => (
                  <TouchableOpacity
                    key={account.id}
                    style={[styles.accountDropdownItem, { borderBottomColor: colors.border }]}
                    onPress={() => { 
                      setFormData({ ...formData, accountId: account.id.toString() }); 
                      setShowAccountPicker(false); 
                    }}
                  >
                    <Text style={[
                      styles.accountDropdownText,
                      { color: colors.text },
                      formData.accountId === account.id.toString() && { fontWeight: '600', color: colors.primary }
                    ]}>
                      {account.name}
                    </Text>
                    {formData.accountId === account.id.toString() && (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Payment Settings */}
        {formData.accountId && (
          <>
            <View style={styles.sectionDivider} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Settings</Text>
            
            {/* Create Transaction Toggle */}
            <View style={[styles.field, styles.toggleField]}>
              <View style={styles.toggleLeft}>
                <Ionicons name="receipt-outline" size={20} color={colors.text} />
                <View style={styles.toggleTextContainer}>
                  <Text style={[styles.label, { color: colors.text, marginBottom: 2 }]}>Create Transaction</Text>
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>
                    Record each EMI payment as a transaction
                  </Text>
                </View>
              </View>
              <Switch
                value={createTransaction}
                onValueChange={setCreateTransaction}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={createTransaction ? colors.primary : '#f4f3f4'}
              />
            </View>

            {/* Affect Balance Toggle */}
            <View style={[styles.field, styles.toggleField]}>
              <View style={styles.toggleLeft}>
                <Ionicons name="wallet-outline" size={20} color={colors.text} />
                <View style={styles.toggleTextContainer}>
                  <Text style={[styles.label, { color: colors.text, marginBottom: 2 }]}>Affect Account Balance</Text>
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>
                    Deduct EMI amount from linked account
                  </Text>
                </View>
              </View>
              <Switch
                value={affectBalance}
                onValueChange={setAffectBalance}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={affectBalance ? colors.primary : '#f4f3f4'}
              />
            </View>

            {/* Auto-Mark-as-Paid Toggle */}
            <View style={[styles.field, styles.toggleField]}>
              <View style={styles.toggleLeft}>
                <Ionicons name="flash-outline" size={20} color={colors.text} />
                <View style={styles.toggleTextContainer}>
                  <Text style={[styles.label, { color: colors.text, marginBottom: 2 }]}>Auto-Mark as Paid</Text>
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>
                    Mark the next EMI paid automatically when a matching debited SMS arrives
                  </Text>
                </View>
              </View>
              <Switch
                value={autoMarkPaidEnabled}
                onValueChange={setAutoMarkPaidEnabled}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={autoMarkPaidEnabled ? colors.primary : '#f4f3f4'}
              />
            </View>

            {autoMarkPaidEnabled && (
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textMuted }]}>SMS Keyword *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                  placeholder="e.g., HDFC EMI, LOAN12345"
                  placeholderTextColor={colors.textMuted}
                  value={autoMarkKeyword}
                  onChangeText={setAutoMarkKeyword}
                  autoCapitalize="characters"
                />
                <Text style={[styles.helperText, { color: colors.textMuted, marginTop: 4 }]}>
                  Only SMS containing this text (case-insensitive) and the exact EMI amount, near the due date, will auto-match
                </Text>
              </View>
            )}
          </>
        )}

        {/* BT Closure Section - only show when adding new loan */}
        {!isEditMode && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>Balance Transfer</Text>
            
            {/* Includes BT Closure Toggle */}
            <View style={[styles.field, styles.toggleField]}>
              <View style={styles.toggleLeft}>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.text} />
                <View style={styles.toggleTextContainer}>
                  <Text style={[styles.label, { color: colors.text, marginBottom: 2 }]}>Includes BT Closure</Text>
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>
                    Use this loan to close other existing loans
                  </Text>
                </View>
              </View>
              <Switch
                value={includesBtClosure}
                onValueChange={(value) => {
                  setIncludesBtClosure(value);
                  if (value && allActiveLoans.length > 0) {
                    // Auto-add first BT allocation when toggle is enabled and there are active loans
                    setBtAllocations([{ targetLoanId: '', allocatedAmount: '' }]);
                  } else if (!value) {
                    setBtAllocations([]);
                  }
                }}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={includesBtClosure ? colors.primary : '#f4f3f4'}
              />
            </View>

            {/* BT Allocation Rows */}
            {includesBtClosure && (
              <View style={styles.btAllocationsContainer}>
                {allActiveLoans.length === 0 ? (
                  <Text style={[styles.noBtText, { color: colors.textMuted }]}>
                    No active loans available for balance transfer. Add some loans first, then come back to create a BT loan.
                  </Text>
                ) : (
                  <>
                {btAllocations.map((bt, index) => {
                  const selectedLoan = allLoans.find(l => l.id.toString() === bt.targetLoanId);
                  const maxAmount = selectedLoan ? parseFloat(selectedLoan.outstandingAmount) : 0;
                  
                  return (
                    <View key={index} style={[styles.btRow, { borderColor: colors.border }]}>
                      <View style={styles.btRowHeader}>
                        <Text style={[styles.btLabel, { color: colors.primary }]}>BT {index + 1}</Text>
                        <TouchableOpacity 
                          onPress={() => {
                            const newAllocations = btAllocations.filter((_, i) => i !== index);
                            setBtAllocations(newAllocations);
                          }}
                        >
                          <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                      
                      {/* Loan Selector */}
                      <TouchableOpacity
                        style={[styles.btSelector, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => setShowBtLoanPicker(index)}
                      >
                        <Text style={[styles.btSelectorText, { color: selectedLoan ? colors.text : colors.textMuted }]}>
                          {selectedLoan ? `${selectedLoan.name} (${selectedLoan.lenderName || 'No lender'})` : 'Select a loan...'}
                        </Text>
                        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                      
                      {selectedLoan && (
                        <>
                          <Text style={[styles.btOutstandingLabel, { color: colors.textMuted }]}>
                            Outstanding: ₹{parseFloat(selectedLoan.outstandingAmount).toLocaleString('en-IN')}
                          </Text>
                          
                          {/* Amount Input */}
                          <View style={[styles.btAmountContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Text style={[styles.currencySymbol, { color: colors.text }]}>₹</Text>
                            <TextInput
                              style={[styles.btAmountInput, { color: colors.text }]}
                              value={bt.allocatedAmount}
                              onChangeText={(text) => {
                                const numValue = parseFloat(text) || 0;
                                const validValue = Math.min(numValue, maxAmount);
                                const newAllocations = [...btAllocations];
                                newAllocations[index] = { 
                                  ...bt, 
                                  allocatedAmount: numValue > maxAmount ? maxAmount.toString() : text 
                                };
                                setBtAllocations(newAllocations);
                              }}
                              placeholder="BT Amount"
                              placeholderTextColor={colors.textMuted}
                              keyboardType="numeric"
                              autoFocus={false}
                              blurOnSubmit={true}
                            />
                          </View>
                        </>
                      )}
                    </View>
                  );
                })}
                
                {/* Add BT Button - only show when there are unselected loans available */}
                {activeLoansForBt.length > 0 && (
                  <TouchableOpacity
                    style={[styles.addBtButton, { borderColor: colors.primary }]}
                    onPress={() => {
                      setBtAllocations([...btAllocations, { targetLoanId: '', allocatedAmount: '' }]);
                    }}
                  >
                    <Ionicons name="add" size={20} color={colors.primary} />
                    <Text style={[styles.addBtButtonText, { color: colors.primary }]}>Add BT Allocation</Text>
                  </TouchableOpacity>
                )}
                </>
                )}
              </View>
            )}
          </>
        )}

        {/* BT Loan Picker Modal */}
        <Modal
          visible={showBtLoanPicker !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setShowBtLoanPicker(null)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay} 
            activeOpacity={1} 
            onPress={() => setShowBtLoanPicker(null)}
          >
            <TouchableOpacity 
              style={[styles.btPickerModalContent, { backgroundColor: colors.card }]}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.pickerHeader}>
                <Text style={[styles.pickerTitle, { color: colors.text }]}>Select Loan for BT</Text>
                <TouchableOpacity onPress={() => setShowBtLoanPicker(null)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>
              <ScrollView 
                style={styles.pickerList}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={{ paddingBottom: 20 }}
              >
                {activeLoansForBt.length === 0 ? (
                  <View style={styles.emptyPickerState}>
                    <Text style={[styles.emptyPickerText, { color: colors.textMuted }]}>
                      No active loans available for balance transfer
                    </Text>
                  </View>
                ) : (
                  activeLoansForBt.map((loan) => (
                    <TouchableOpacity
                      key={loan.id}
                      style={[styles.pickerItem, { borderBottomColor: colors.border }]}
                      onPress={() => {
                        if (showBtLoanPicker !== null) {
                          const newAllocations = [...btAllocations];
                          newAllocations[showBtLoanPicker] = { 
                            targetLoanId: loan.id.toString(), 
                            allocatedAmount: loan.outstandingAmount 
                          };
                          setBtAllocations(newAllocations);
                          setShowBtLoanPicker(null);
                          // Dismiss keyboard to prevent auto-focus
                          setTimeout(() => Keyboard.dismiss(), 100);
                        }
                      }}
                    >
                      <View>
                        <Text style={[styles.pickerItemTitle, { color: colors.text }]}>{loan.name}</Text>
                        <Text style={[styles.pickerItemSubtitle, { color: colors.textMuted }]}>
                          {loan.lenderName || 'No lender'} • Outstanding: ₹{parseFloat(loan.outstandingAmount).toLocaleString('en-IN')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: colors.primary }]}
          onPress={handleSubmit}
          disabled={createMutation.isPending || updateMutation.isPending}
        >
          {(createMutation.isPending || updateMutation.isPending) ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>{isEditMode ? 'Update Loan' : 'Add Loan'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
        </KeyboardAwareScrollView>
      )}
      {loanId && (
        <SpendingBreakdownModal
          loanId={loanId}
          visible={spendingBreakdownVisible}
          onClose={() => setSpendingBreakdownVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  form: {
    padding: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  field: {
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  loanTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  loanTypeButton: {
    flex: 1,
    minWidth: '47%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
  },
  loanTypeText: {
    fontSize: 14,
  },
  accountList: {
    gap: 8,
  },
  accountOption: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
  },
  accountOptionText: {
    fontSize: 14,
  },
  dropdownButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownText: {
    flex: 1,
    fontSize: 15,
  },
  accountDropdownList: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    maxHeight: 300,
  },
  accountDropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 0.5,
  },
  accountDropdownText: {
    fontSize: 15,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    marginTop: 8,
    gap: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  datePickerText: {
    fontSize: 16,
    flex: 1,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#e5e5e5',
    marginVertical: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  toggleField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    marginRight: 12,
  },
  toggleTextContainer: {
    flex: 1,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
  btAllocationsContainer: {
    marginTop: 8,
  },
  btRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  btRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  btLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  btSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  btSelectorText: {
    fontSize: 14,
    flex: 1,
  },
  btOutstandingLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  btAmountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  currencySymbol: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  btAmountInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  addBtButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  addBtButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  noBtText: {
    fontSize: 13,
    textAlign: 'center',
    padding: 16,
  },
  pickerModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  pickerList: {
    flex: 1,
    maxHeight: '100%',
  },
  pickerItem: {
    padding: 16,
    borderBottomWidth: 1,
  },
  pickerItemTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  pickerItemSubtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  btPickerModalContent: {
    height: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 30,
    overflow: 'hidden',
  },
  emptyPickerState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyPickerText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
