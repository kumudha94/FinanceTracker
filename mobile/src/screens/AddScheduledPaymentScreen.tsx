import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Switch, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Toast from 'react-native-toast-message';
import { api } from '../lib/api';
import { getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { MoreStackParamList } from '../../App';
import React from 'react';

type AddScheduledPaymentRouteProp = RouteProp<MoreStackParamList, 'AddScheduledPayment'>;

export default function AddScheduledPaymentScreen() {
  const navigation = useNavigation();
  const route = useRoute<AddScheduledPaymentRouteProp>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  
  const paymentId = route.params?.paymentId;
  const isEditMode = !!paymentId;
  const linkBillMappingId = route.params?.linkBillMappingId;
  const prefill = route.params?.prefill;

  const [name, setName] = useState(prefill?.name || '');
  const [amount, setAmount] = useState(prefill?.amount || '');
  const [variableAmount, setVariableAmount] = useState(false);
  const [dueDateType, setDueDateType] = useState<'fixed_day' | 'salary_day'>('fixed_day');
  const [dueDate, setDueDate] = useState(prefill?.dueDate?.toString() || '');
  const [notes, setNotes] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [affectTransaction, setAffectTransaction] = useState(true);
  const [affectAccountBalance, setAffectAccountBalance] = useState(true);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [paymentType, setPaymentType] = useState<'regular' | 'credit_card_bill'>('regular');
  const [creditCardAccountId, setCreditCardAccountId] = useState<number | null>(null);
  const [showCreditCardPicker, setShowCreditCardPicker] = useState(false);
  const [frequency, setFrequency] = useState<string>('monthly');
  const [customIntervalMonths, setCustomIntervalMonths] = useState('');
  const [customIntervalDays, setCustomIntervalDays] = useState('');
  const [lastPaidDate, setLastPaidDate] = useState(new Date());
  const [showLastPaidDatePicker, setShowLastPaidDatePicker] = useState(false);
  const [showFrequencyPicker, setShowFrequencyPicker] = useState(false);
  const [startMonth, setStartMonth] = useState<number | null>(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ['/api/categories'],
    queryFn: api.getCategories,
  });

  const { data: accounts } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const selectedCategory = categories?.find((c: any) => c.id === selectedCategoryId);
  const selectedAccount = accounts?.find((a: any) => a.id === selectedAccountId);
  const creditCardAccounts = accounts?.filter((a: any) => a.type === 'credit_card') || [];
  const selectedCreditCard = creditCardAccounts.find((a: any) => a.id === creditCardAccountId);

  const { data: payments } = useQuery({
    queryKey: ['/api/scheduled-payments'],
    queryFn: api.getScheduledPayments,
    enabled: isEditMode,
  });

  // Auto-select default account for new payments
  React.useEffect(() => {
    if (!isEditMode && accounts && !selectedAccountId) {
      const defaultAccount = accounts.find(acc => acc.isDefault);
      if (defaultAccount) {
        setSelectedAccountId(defaultAccount.id);
      }
    }
  }, [accounts, isEditMode, selectedAccountId]);

  // Load payment data for edit mode
  React.useEffect(() => {
    if (isEditMode && payments) {
      const payment = payments.find((p: any) => p.id === paymentId);
      if (payment) {
        setName(payment.name);
        setAmount(payment.amount);
        setVariableAmount(payment.variableAmount ?? false);
        setDueDateType(payment.dueDateType || 'fixed_day');
        setDueDate(payment.dueDate?.toString() || '');
        setNotes(payment.notes || '');
        setSelectedCategoryId(payment.categoryId || null);
        setSelectedAccountId(payment.accountId || null);
        setAffectTransaction(payment.affectTransaction ?? true);
        setAffectAccountBalance(payment.affectAccountBalance ?? true);
        setPaymentType((payment.paymentType as 'regular' | 'credit_card_bill') || 'regular');
        setCreditCardAccountId(payment.creditCardAccountId || null);
        setFrequency(payment.frequency || 'monthly');
        if (payment.customIntervalMonths) {
          setCustomIntervalMonths(payment.customIntervalMonths.toString());
        }
        if (payment.customIntervalDays) {
          setCustomIntervalDays(payment.customIntervalDays.toString());
        }
        if (payment.startMonth) {
          setStartMonth(payment.startMonth);
        }
        
        // If it's a credit card bill, auto-populate billing date and name
        if (payment.paymentType === 'credit_card_bill' && payment.creditCardAccountId) {
          const card = accounts?.find((a: any) => a.id === payment.creditCardAccountId);
          if (card && card.billingDate) {
            setDueDate(card.billingDate.toString());
          }
        }
      }
    }
  }, [isEditMode, payments, paymentId, accounts]);

  const createMutation = useMutation({
    // If this came from Bills Inbox, route through the endpoint that creates AND links the
    // mapping in one step, so resolving the Bills Inbox entry doesn't need a separate call.
    mutationFn: async (data: any): Promise<any> => {
      if (linkBillMappingId) {
        return api.createScheduledPaymentForBillMapping(linkBillMappingId, data);
      }
      return api.createScheduledPayment(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
      Toast.show({
        type: 'success',
        text1: 'Payment Added',
        text2: linkBillMappingId ? 'Scheduled payment created and linked' : 'Scheduled payment has been created',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to add scheduled payment',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!paymentId) throw new Error('Payment ID is required');
      return api.updateScheduledPayment(paymentId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      Toast.show({
        type: 'success',
        text1: 'Payment Updated',
        text2: 'Scheduled payment has been updated',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to update scheduled payment',
        position: 'bottom',
      });
    },
  });

  const mutation = isEditMode ? updateMutation : createMutation;

  const handleSubmit = () => {
    if (!name.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter payment name',
        position: 'bottom',
        visibilityTime: 3000,
      });
      return;
    }
    
    // Amount is required only for regular, fixed-amount payments — variable-amount bills
    // (e.g. electricity) are entered per-cycle instead, and credit card bills auto-calculate.
    if (paymentType === 'regular' && !variableAmount && (!amount || parseFloat(amount) <= 0)) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter a valid amount',
        position: 'bottom',
        visibilityTime: 3000,
      });
      return;
    }
    
    // For credit card bills with amount, validate it
    if (paymentType === 'credit_card_bill' && amount && parseFloat(amount) <= 0) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter a valid amount',
        position: 'bottom',
        visibilityTime: 3000,
      });
      return;
    }
    
    // Day-interval payments are anchored by an actual date, not a day-of-month — dueDate
    // doesn't apply to them.
    if (dueDateType === 'fixed_day' && frequency !== 'day_interval') {
      const dueDateNum = parseInt(dueDate);
      if (!dueDate || isNaN(dueDateNum) || dueDateNum < 1 || dueDateNum > 31) {
        Toast.show({
          type: 'error',
          text1: 'Invalid Due Date',
          text2: 'Due date must be between 1 and 31',
          position: 'bottom',
          visibilityTime: 3000,
        });
        return;
      }
    }

    if (frequency === 'day_interval') {
      const interval = parseInt(customIntervalDays);
      if (!customIntervalDays || isNaN(interval) || interval < 1 || interval > 365) {
        Toast.show({
          type: 'error',
          text1: 'Validation Error',
          text2: 'Interval must be between 1 and 365 days',
          position: 'bottom',
          visibilityTime: 3000,
        });
        return;
      }
    }

    if (frequency === 'custom') {
      const interval = parseInt(customIntervalMonths);
      if (!customIntervalMonths || isNaN(interval) || interval < 1 || interval > 60) {
        Toast.show({
          type: 'error',
          text1: 'Validation Error',
          text2: 'Custom interval must be between 1 and 60 months',
          position: 'bottom',
          visibilityTime: 3000,
        });
        return;
      }
    }

    const needsStartMonth = frequency === 'yearly' || frequency === 'quarterly' || frequency === 'half_yearly' || frequency === 'custom';
    if (needsStartMonth && !startMonth) {
      Toast.show({
        type: 'error',
        text1: 'Missing Month',
        text2: frequency === 'yearly' ? 'Please select which month this payment is due' : 'Please select the starting month for this payment cycle',
        position: 'bottom',
        visibilityTime: 3000,
      });
      return;
    }

    mutation.mutate({
      name: name.trim(),
      amount: variableAmount ? undefined : (amount || undefined),
      variableAmount,
      dueDateType,
      dueDate: dueDateType === 'fixed_day' && frequency !== 'day_interval' ? parseInt(dueDate) : null,
      notes: notes.trim() || null,
      categoryId: selectedCategoryId,
      accountId: selectedAccountId,
      status: 'active',
      affectTransaction,
      affectAccountBalance,
      paymentType,
      creditCardAccountId: paymentType === 'credit_card_bill' ? creditCardAccountId : null,
      frequency,
      customIntervalMonths: frequency === 'custom' ? parseInt(customIntervalMonths) : null,
      customIntervalDays: frequency === 'day_interval' ? parseInt(customIntervalDays) : null,
      // Only meaningful on create — the server anchors the first occurrence off this date.
      // Editing an existing day-interval payment doesn't recompute occurrences.
      ...(frequency === 'day_interval' && !isEditMode ? { lastPaidDate: lastPaidDate.toISOString() } : {}),
      startMonth: needsStartMonth ? startMonth : null,
    });
  };

  const expenseCategories = categories?.filter(c => c.type === 'expense') || [];

  // Auto-populate credit card bill details when credit card is selected
  React.useEffect(() => {
    if (paymentType === 'credit_card_bill' && creditCardAccountId && !isEditMode) {
      const card = creditCardAccounts.find((a: any) => a.id === creditCardAccountId);
      if (card) {
        // Auto-fill name if empty
        if (!name) {
          setName(`${card.name} Bill Payment`);
        }
        // Auto-fill billing date
        if (card.billingDate) {
          setDueDate(card.billingDate.toString());
        }
      }
    }
  }, [paymentType, creditCardAccountId, creditCardAccounts, isEditMode]);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Payment Type</Text>
        <View style={styles.paymentTypeRow}>
          <TouchableOpacity
            style={[
              styles.paymentTypeButton,
              { backgroundColor: paymentType === 'regular' ? colors.primary : colors.card, borderColor: colors.border }
            ]}
            onPress={() => setPaymentType('regular')}
          >
            <Ionicons 
              name="calendar-outline" 
              size={20} 
              color={paymentType === 'regular' ? '#fff' : colors.text} 
            />
            <Text style={[
              styles.paymentTypeText,
              { color: paymentType === 'regular' ? '#fff' : colors.text }
            ]}>
              Regular Payment
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.paymentTypeButton,
              { backgroundColor: paymentType === 'credit_card_bill' ? colors.primary : colors.card, borderColor: colors.border }
            ]}
            onPress={() => setPaymentType('credit_card_bill')}
          >
            <Ionicons 
              name="card-outline" 
              size={20} 
              color={paymentType === 'credit_card_bill' ? '#fff' : colors.text} 
            />
            <Text style={[
              styles.paymentTypeText,
              { color: paymentType === 'credit_card_bill' ? '#fff' : colors.text }
            ]}>
              Credit Card Bill
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {paymentType === 'credit_card_bill' && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Credit Card</Text>
          <TouchableOpacity
            style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowCreditCardPicker(!showCreditCardPicker)}
          >
            <Ionicons name="card-outline" size={20} color={colors.textMuted} />
            <Text style={[styles.dropdownText, { color: selectedCreditCard ? colors.text : colors.textMuted }]}>
              {selectedCreditCard ? selectedCreditCard.name : 'Select Credit Card'}
            </Text>
          </TouchableOpacity>
          {showCreditCardPicker && creditCardAccounts && creditCardAccounts.length > 0 ? (
            <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {creditCardAccounts.map((card: any) => (
                <TouchableOpacity
                  key={card.id}
                  style={styles.dropdownItem}
                  onPress={() => { 
                    setCreditCardAccountId(card.id); 
                    setShowCreditCardPicker(false); 
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dropdownItemText, { color: colors.text }]}>{card.name}</Text>
                    {card.bankName && (
                      <Text style={[styles.dropdownItemSubtext, { color: colors.textMuted }]}>
                        {card.bankName} • Due: {card.billingDate || 'Not set'}th
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : showCreditCardPicker && (
            <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
              <Text style={[styles.infoText, { color: colors.textMuted }]}>
                No credit card accounts found. Add a credit card account first.
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Payment Name</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text }]}
          placeholder="e.g., Rent, Netflix, Maid Salary"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />
      </View>

      {paymentType === 'regular' && (
        <View style={[styles.toggleContainer, { backgroundColor: colors.card, marginBottom: 20 }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>This bill's amount varies each time</Text>
              <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>e.g. electricity — you'll enter the actual amount each cycle</Text>
            </View>
            <Switch
              value={variableAmount}
              onValueChange={(v) => { setVariableAmount(v); if (v) setAmount(''); }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      )}

      {!variableAmount && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            Amount {paymentType === 'credit_card_bill' && '(optional)'}
          </Text>
          {paymentType === 'credit_card_bill' && (
            <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 8 }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
              <Text style={[styles.infoText, { color: colors.textMuted }]}>
                Leave blank to auto-calculate from your actual spending each billing cycle. Or enter a fixed amount to pay monthly.
              </Text>
            </View>
          )}
          <View style={[styles.amountInputContainer, { backgroundColor: colors.card }]}>
            <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              placeholder={paymentType === 'credit_card_bill' ? "Auto-calculated" : "0"}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
            />
          </View>
        </View>
      )}

      {frequency !== 'day_interval' ? (
        <>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Due Date Type</Text>
            <View style={styles.paymentTypeRow}>
              <TouchableOpacity
                style={[
                  styles.paymentTypeButton,
                  { backgroundColor: dueDateType === 'fixed_day' ? colors.primary : colors.card, borderColor: colors.border }
                ]}
                onPress={() => setDueDateType('fixed_day')}
              >
                <Ionicons
                  name="calendar-number-outline"
                  size={20}
                  color={dueDateType === 'fixed_day' ? '#fff' : colors.text}
                />
                <Text style={[
                  styles.paymentTypeText,
                  { color: dueDateType === 'fixed_day' ? '#fff' : colors.text }
                ]}>
                  Fixed Day
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentTypeButton,
                  { backgroundColor: dueDateType === 'salary_day' ? colors.primary : colors.card, borderColor: colors.border }
                ]}
                onPress={() => setDueDateType('salary_day')}
              >
                <Ionicons
                  name="cash-outline"
                  size={20}
                  color={dueDateType === 'salary_day' ? '#fff' : colors.text}
                />
                <Text style={[
                  styles.paymentTypeText,
                  { color: dueDateType === 'salary_day' ? '#fff' : colors.text }
                ]}>
                  Salary Day
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {dueDateType === 'fixed_day' ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Due Date (Day of Month)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="e.g., 1, 15, 28"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                maxLength={2}
                value={dueDate}
                onChangeText={setDueDate}
              />
            </View>
          ) : (
            <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
              <Text style={[styles.infoText, { color: colors.textMuted }]}>
                Payment will be scheduled on the same day as your salary (as per your salary profile settings).
                This will affect only from next month's payment onwards.
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Interval (days)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="e.g., 84"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              maxLength={3}
              value={customIntervalDays}
              onChangeText={setCustomIntervalDays}
            />
          </View>
          {!isEditMode && (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Last recharged/paid on</Text>
              <TouchableOpacity
                style={[styles.datePickerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setShowLastPaidDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.text} />
                <Text style={[styles.datePickerText, { color: colors.text }]}>
                  {lastPaidDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </TouchableOpacity>
              {showLastPaidDatePicker && (
                <DateTimePicker
                  value={lastPaidDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
                  textColor={colors.text}
                  onChange={(event, selectedDate) => {
                    setShowLastPaidDatePicker(Platform.OS === 'ios');
                    if (selectedDate) setLastPaidDate(selectedDate);
                  }}
                />
              )}
              <Text style={[styles.monthHint, { color: colors.textMuted }]}>
                Next due date will be {customIntervalDays || 'N'} days after this
              </Text>
            </View>
          )}
        </>
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Payment Frequency</Text>
        <TouchableOpacity
          style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowFrequencyPicker(!showFrequencyPicker)}
        >
          <Ionicons name="repeat-outline" size={20} color={colors.textMuted} />
          <Text style={[styles.dropdownText, { color: colors.text }]}>
            {frequency === 'monthly' ? 'Every Month' :
             frequency === 'quarterly' ? 'Every 3 Months' :
             frequency === 'half_yearly' ? 'Every 6 Months' :
             frequency === 'yearly' ? 'Every Year' :
             frequency === 'one_time' ? 'One Time' :
             frequency === 'day_interval' && customIntervalDays ? `Every ${customIntervalDays} Days` :
             frequency === 'day_interval' ? 'Every N Days' :
             frequency === 'custom' && customIntervalMonths ? `Every ${customIntervalMonths} Months` :
             'Custom Interval'}
          </Text>
          <Ionicons name={showFrequencyPicker ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
        </TouchableOpacity>
        {showFrequencyPicker && (
          <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { value: 'monthly', label: 'Every Month', desc: 'Rent, subscriptions, etc.' },
              { value: 'quarterly', label: 'Every 3 Months', desc: 'Quarterly bills' },
              { value: 'half_yearly', label: 'Every 6 Months', desc: 'Semi-annual payments' },
              { value: 'yearly', label: 'Every Year', desc: 'Annual renewals' },
              { value: 'custom', label: 'Custom Interval', desc: 'Set your own interval in months' },
              { value: 'day_interval', label: 'Every N Days', desc: 'Phone recharge, prepaid plans, etc.' },
              { value: 'one_time', label: 'One Time', desc: 'Single payment only' },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.dropdownItem,
                  frequency === opt.value && { backgroundColor: `${colors.primary}15` }
                ]}
                onPress={() => {
                  setFrequency(opt.value);
                  if (opt.value !== 'custom') setCustomIntervalMonths('');
                  if (opt.value !== 'day_interval') setCustomIntervalDays('');
                  if (opt.value === 'monthly' || opt.value === 'one_time' || opt.value === 'day_interval') {
                    setStartMonth(null);
                    setShowMonthPicker(false);
                  }
                  setShowFrequencyPicker(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dropdownItemText, { color: frequency === opt.value ? colors.primary : colors.text }]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.dropdownItemSubtext, { color: colors.textMuted }]}>
                    {opt.desc}
                  </Text>
                </View>
                {frequency === opt.value && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {frequency === 'custom' && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Repeat Every (Months)</Text>
          <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 8 }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
            <Text style={[styles.infoText, { color: colors.textMuted }]}>
              E.g., enter 5 for Netflix 5-month plan, 3 for ACT quarterly, 8 for an 8-month subscription.
            </Text>
          </View>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
            placeholder="e.g., 3, 5, 8"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            maxLength={2}
            value={customIntervalMonths}
            onChangeText={setCustomIntervalMonths}
          />
        </View>
      )}

      {(frequency === 'yearly' || frequency === 'quarterly' || frequency === 'half_yearly' || frequency === 'custom') && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {frequency === 'yearly' ? 'Payment Month' :
             frequency === 'quarterly' ? 'Starting Month (repeats every 3 months)' :
             frequency === 'half_yearly' ? 'Starting Month (repeats every 6 months)' :
             'Starting Month'}
          </Text>
          <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 8 }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
            <Text style={[styles.infoText, { color: colors.textMuted }]}>
              {frequency === 'yearly'
                ? 'Select the month when this payment is due each year. E.g., October for Prime membership.'
                : frequency === 'quarterly'
                ? 'Select the first month of your cycle. Payments will repeat every 3 months from this month.'
                : frequency === 'half_yearly'
                ? 'Select the first month of your cycle. Payments will repeat every 6 months from this month.'
                : 'Select the first month when this payment starts. It will repeat based on your custom interval.'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowMonthPicker(!showMonthPicker)}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
            <Text style={[styles.dropdownText, { color: startMonth ? colors.text : colors.textMuted, flex: 1 }]}>
              {startMonth
                ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][startMonth - 1]
                : 'Select Month'}
            </Text>
            <Ionicons name={showMonthPicker ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </TouchableOpacity>
          {showMonthPicker && (
            <View style={[styles.monthGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, idx) => (
                <TouchableOpacity
                  key={month}
                  style={[
                    styles.monthChip,
                    { borderColor: startMonth === idx + 1 ? colors.primary : colors.border },
                    startMonth === idx + 1 && { backgroundColor: colors.primary + '18' },
                  ]}
                  onPress={() => {
                    setStartMonth(idx + 1);
                    setShowMonthPicker(false);
                  }}
                >
                  <Text style={[
                    styles.monthChipText,
                    { color: startMonth === idx + 1 ? colors.primary : colors.text },
                    startMonth === idx + 1 && { fontWeight: '700' },
                  ]}>
                    {month}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {startMonth && frequency !== 'yearly' && (
            <Text style={[styles.monthHint, { color: colors.textMuted }]}>
              {frequency === 'quarterly'
                ? `Payments in: ${[startMonth, ((startMonth - 1 + 3) % 12) + 1, ((startMonth - 1 + 6) % 12) + 1, ((startMonth - 1 + 9) % 12) + 1].map(m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]).join(', ')}`
                : frequency === 'half_yearly'
                ? `Payments in: ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][startMonth - 1]} & ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][((startMonth - 1 + 6) % 12)]}`
                : frequency === 'custom' && customIntervalMonths
                ? `Starting from ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][startMonth - 1]}, every ${customIntervalMonths} months`
                : ''}
            </Text>
          )}
        </View>
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Category (optional)</Text>
        <TouchableOpacity
          style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowCategoryPicker(!showCategoryPicker)}
        >
          <Ionicons name="pricetag-outline" size={20} color={colors.textMuted} />
          <Text style={[styles.dropdownText, { color: selectedCategory ? colors.text : colors.textMuted }]}>
            {selectedCategory ? selectedCategory.name : 'Select Category'}
          </Text>
        </TouchableOpacity>
        {showCategoryPicker && expenseCategories && (
          <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => { setSelectedCategoryId(null); setShowCategoryPicker(false); }}
            >
              <Text style={[styles.dropdownItemText, { color: colors.textMuted }]}>None</Text>
            </TouchableOpacity>
            {expenseCategories.map((category) => (
              <TouchableOpacity
                key={category.id}
                style={styles.dropdownItem}
                onPress={() => { setSelectedCategoryId(category.id); setShowCategoryPicker(false); }}
              >
                <Text style={[styles.dropdownItemText, { color: colors.text }]}>{category.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Account (optional)</Text>
        <TouchableOpacity
          style={[styles.dropdownButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowAccountPicker(!showAccountPicker)}
        >
          <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
          <Text style={[styles.dropdownText, { color: selectedAccount ? colors.text : colors.textMuted }]}>
            {selectedAccount ? selectedAccount.name : 'Select Account'}
          </Text>
        </TouchableOpacity>
        {showAccountPicker && accounts && (
          <View style={[styles.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => { setSelectedAccountId(null); setShowAccountPicker(false); }}
            >
              <Text style={[styles.dropdownItemText, { color: colors.textMuted }]}>None</Text>
            </TouchableOpacity>
            {accounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={styles.dropdownItem}
                onPress={() => { setSelectedAccountId(account.id); setShowAccountPicker(false); }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dropdownItemText, { color: colors.text }]}>{account.name}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="Add any notes..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          value={notes}
          onChangeText={setNotes}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Transaction Options</Text>
        {isEditMode && (
          <View style={[styles.infoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} style={styles.infoIcon} />
            <Text style={[styles.infoText, { color: colors.textMuted }]}>
              Changing these settings will only apply to future payments. Past transactions remain unchanged.
            </Text>
          </View>
        )}
        <View style={[styles.toggleContainer, { backgroundColor: colors.card }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
              <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>Add to transaction history when paid</Text>
            </View>
            <Switch
              value={affectTransaction}
              onValueChange={setAffectTransaction}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
              <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>Update account balance when paid</Text>
            </View>
            <Switch
              value={affectAccountBalance}
              onValueChange={setAffectAccountBalance}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      <TouchableOpacity 
        style={[styles.submitButton, { backgroundColor: colors.primary }, mutation.isPending && styles.submitButtonDisabled]} 
        onPress={handleSubmit}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>{isEditMode ? 'Update Payment' : 'Add Payment'}</Text>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  currencyPrefix: {
    fontSize: 18,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
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
    fontSize: 15,
  },
  dropdownList: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
  },
  dropdownItemText: {
    fontSize: 14,
  },
  dropdownItemSubtext: {
    fontSize: 12,
    marginTop: 2,
  },
  paymentTypeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  paymentTypeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  toggleContainer: {
    borderRadius: 12,
    padding: 16,
    gap: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 12,
  },
  infoBox: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  infoIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  submitButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  monthChip: {
    width: '22%',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  monthChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  monthHint: {
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
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
});
