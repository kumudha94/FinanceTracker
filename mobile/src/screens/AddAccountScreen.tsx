import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { api } from '../lib/api';
import { getThemedColors } from '../lib/utils';
import { RootStackParamList } from '../../App';
import { useTheme } from '../contexts/ThemeContext';

type AddAccountRouteProp = RouteProp<RootStackParamList, 'AddAccount'>;
type AddAccountNavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddAccount'>;

export default function AddAccountScreen() {
  const navigation = useNavigation<AddAccountNavigationProp>();
  const route = useRoute<AddAccountRouteProp>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const accountId = route.params?.accountId;
  const isEditMode = !!accountId;
  
  const [type, setType] = useState<'bank' | 'credit_card' | 'debit_card' | 'wallet' | 'pf'>('bank');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [monthlySpendingLimit, setMonthlySpendingLimit] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [billingDate, setBillingDate] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  
  // Bank account details (for bank type)
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  
  // Card details (for credit_card and debit_card)
  const [cardNumber, setCardNumber] = useState('');
  const [fullCardNumber, setFullCardNumber] = useState(''); // Store full card number for edit mode
  const [showCardNumber, setShowCardNumber] = useState(false); // Toggle to show/hide card number
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [cardType, setCardType] = useState<'visa' | 'mastercard' | 'rupay' | 'amex' | 'other'>('visa');
  const [linkedAccountId, setLinkedAccountId] = useState<number | undefined>();
  const [showLinkedAccountPicker, setShowLinkedAccountPicker] = useState(false);
  
  // Scheduled payment for credit card
  const [createScheduledPayment, setCreateScheduledPayment] = useState(false);

  // Always fetch accounts - needed for editing and for linking debit cards to bank accounts
  const { data: accounts } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  // Fetch categories to find bills category
  const { data: categories = [] } = useQuery({
    queryKey: ['/api/categories'],
    queryFn: api.getCategories,
  });

  // Find bills category ID
  const billsCategoryId = useMemo(() => {
    const billsCategory = categories.find((c: any) => c.name?.toLowerCase() === 'bills');
    return billsCategory?.id || null;
  }, [categories]);

  // Get bank accounts for linking debit cards
  const bankAccounts = useMemo(() => {
    return accounts?.filter(a => a.type === 'bank') || [];
  }, [accounts]);

  // Get linked account balance for debit cards
  const linkedAccountBalance = useMemo(() => {
    if (type === 'debit_card' && linkedAccountId) {
      const linkedAccount = bankAccounts.find(a => a.id === linkedAccountId);
      return linkedAccount?.balance || '0';
    }
    return null;
  }, [type, linkedAccountId, bankAccounts]);

  useEffect(() => {
    if (isEditMode && accounts) {
      const account = accounts.find(a => a.id === accountId);
      if (account) {
        setType(account.type as 'bank' | 'credit_card' | 'debit_card' | 'wallet' | 'pf');
        setName(account.name);
        setBalance(account.balance);
        setIsDefault(account.isDefault || false);
        if (account.creditLimit) {
          setCreditLimit(account.creditLimit);
        }
        if (account.monthlySpendingLimit) {
          setMonthlySpendingLimit(account.monthlySpendingLimit);
        }
        if (account.accountNumber) {
          setAccountNumber(account.accountNumber);
        }
        if (account.billingDate) {
          setBillingDate(account.billingDate.toString());
        }
        if (account.linkedAccountId) {
          setLinkedAccountId(account.linkedAccountId);
        }
        // Load bank account details if bank type
        if (account.type === 'bank') {
          if (account.bankAccountNumber) {
            setBankAccountNumber(account.bankAccountNumber);
          }
          if (account.ifscCode) {
            setIfscCode(account.ifscCode);
          }
        }
        // Load card details if available
        if (account.cardDetails) {
          // Store full card number if available
          if (account.cardDetails.cardNumber) {
            setFullCardNumber(account.cardDetails.cardNumber);
          }
          setCardNumber(account.cardDetails.lastFourDigits ? `**** **** **** ${account.cardDetails.lastFourDigits}` : '');
          setExpiryMonth(account.cardDetails.expiryMonth?.toString() || '');
          setExpiryYear(account.cardDetails.expiryYear?.toString() || '');
          setCardholderName(account.cardDetails.cardholderName || '');
          setCardType(account.cardDetails.cardType || 'visa');
        }
      }
    }
  }, [isEditMode, accounts, accountId]);

  const createScheduledPaymentMutation = useMutation({
    mutationFn: api.createScheduledPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
    },
    onError: (error) => {
      console.error('Failed to create scheduled payment:', error);
      Toast.show({
        type: 'error',
        text1: 'Warning',
        text2: 'Account created but scheduled payment setup failed',
        position: 'bottom',
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createAccount,
    onSuccess: async (newAccount) => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      
      // Create scheduled payment if enabled
      if (type === 'credit_card' && createScheduledPayment && billingDate && newAccount.id && billsCategoryId) {
        const paymentData = {
          name: `${name} Bill Pay`,
          amount: '0',
          dueDateType: 'fixed_day' as const,
          dueDate: parseInt(billingDate),
          frequency: 'monthly' as const,
          paymentType: 'credit_card_bill' as const,
          creditCardAccountId: newAccount.id,
          accountId: linkedAccountId || undefined,
          categoryId: billsCategoryId,
          affectTransaction: true,
          affectAccountBalance: true,
        };
        
        await createScheduledPaymentMutation.mutateAsync(paymentData);
      }
      
      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Account Created',
        text2: createScheduledPayment ? 'Account and bill payment reminder created' : 'Account has been added successfully',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Create Failed',
        text2: 'Could not create account. Please try again.',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Account Updated',
        text2: 'Account has been updated successfully',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update account. Please try again.',
        position: 'bottom',
      });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter account name',
        position: 'bottom',
      });
      return;
    }
    if (type === 'debit_card' && !linkedAccountId) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please select a linked bank account',
        position: 'bottom',
      });
      return;
    }
    if (type !== 'debit_card' && (!balance || parseFloat(balance) < 0)) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter a valid balance',
        position: 'bottom',
      });
      return;
    }
    if (type === 'credit_card' && (!creditLimit || parseFloat(creditLimit) <= 0)) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter credit limit',
        position: 'bottom',
      });
      return;
    }

    const accountData: any = {
      type,
      name: name.trim(),
      balance: type === 'debit_card' ? (linkedAccountBalance || '0') : balance,
      isDefault,
    };

    if (type === 'credit_card' && creditLimit) {
      accountData.creditLimit = creditLimit;
    }

    if (type === 'credit_card' && monthlySpendingLimit) {
      accountData.monthlySpendingLimit = monthlySpendingLimit;
    }

    if (type === 'credit_card' && billingDate && parseInt(billingDate) >= 1 && parseInt(billingDate) <= 31) {
      accountData.billingDate = parseInt(billingDate);
    }

    if (accountNumber.trim()) {
      accountData.accountNumber = accountNumber.trim();
    }

    // Bank account details
    if (type === 'bank') {
      if (bankAccountNumber.trim()) {
        accountData.bankAccountNumber = bankAccountNumber.trim();
      }
      if (ifscCode.trim()) {
        accountData.ifscCode = ifscCode.trim().toUpperCase();
      }
    }

    if ((type === 'debit_card' || type === 'credit_card') && linkedAccountId) {
      accountData.linkedAccountId = linkedAccountId;
    }

    // Add card details for credit/debit cards (without CVV)
    if ((type === 'credit_card' || type === 'debit_card') && cardNumber && !cardNumber.includes('*')) {
      accountData.cardDetails = {
        cardNumber: cardNumber.replace(/\s/g, ''),
        expiryMonth,
        expiryYear,
        cardholderName: cardholderName.trim() || undefined,
        cardType,
      };
    }

    if (isEditMode && accountId) {
      updateMutation.mutate({ id: accountId, data: accountData });
    } else {
      createMutation.mutate(accountData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending || createScheduledPaymentMutation.isPending || !billsCategoryId;

  // Display card number based on visibility toggle
  const displayCardNumber = useMemo(() => {
    if (isEditMode && fullCardNumber && showCardNumber) {
      // Format full card number with spaces
      const cleaned = fullCardNumber.replace(/\s/g, '');
      return cleaned.replace(/(\d{4})/g, '$1 ').trim();
    }
    return cardNumber;
  }, [isEditMode, fullCardNumber, showCardNumber, cardNumber]);

  return (
    <KeyboardAwareScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      enableOnAndroid
      enableAutomaticScroll
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.typeSelector}>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'bank' && { backgroundColor: colors.primary }]}
          onPress={() => !isEditMode && setType('bank')}
          disabled={isEditMode}
          data-testid="button-type-bank"
        >
          <Ionicons 
            name="business-outline" 
            size={22} 
            color={type === 'bank' ? '#fff' : colors.primary} 
          />
          <Text style={[styles.typeText, { color: colors.text }, type === 'bank' && { color: '#fff' }]}>
            Bank
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'credit_card' && { backgroundColor: colors.primary }]}
          onPress={() => !isEditMode && setType('credit_card')}
          disabled={isEditMode}
          data-testid="button-type-credit"
        >
          <Ionicons 
            name="card-outline" 
            size={22} 
            color={type === 'credit_card' ? '#fff' : colors.primary} 
          />
          <Text style={[styles.typeText, { color: colors.text }, type === 'credit_card' && { color: '#fff' }]}>
            Credit
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'debit_card' && { backgroundColor: colors.primary }]}
          onPress={() => !isEditMode && setType('debit_card')}
          disabled={isEditMode}
          data-testid="button-type-debit"
        >
          <Ionicons 
            name="wallet-outline" 
            size={22} 
            color={type === 'debit_card' ? '#fff' : colors.primary} 
          />
          <Text style={[styles.typeText, { color: colors.text }, type === 'debit_card' && { color: '#fff' }]}>
            Debit
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'wallet' && { backgroundColor: colors.primary }]}
          onPress={() => !isEditMode && setType('wallet')}
          disabled={isEditMode}
          data-testid="button-type-wallet"
        >
          <Ionicons
            name="cash-outline"
            size={22}
            color={type === 'wallet' ? '#fff' : colors.primary}
          />
          <Text style={[styles.typeText, { color: colors.text }, type === 'wallet' && { color: '#fff' }]}>
            Wallet
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'pf' && { backgroundColor: colors.primary }]}
          onPress={() => !isEditMode && setType('pf')}
          disabled={isEditMode}
          data-testid="button-type-pf"
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={22}
            color={type === 'pf' ? '#fff' : colors.primary}
          />
          <Text style={[styles.typeText, { color: colors.text }, type === 'pf' && { color: '#fff' }]}>
            PF
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Account Name</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }, isEditMode && { opacity: 0.6 }]}
          placeholder={type === 'bank' ? 'e.g., HDFC Savings' : 'e.g., ICICI Card'}
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          editable={!isEditMode}
        />
      </View>

      {type === 'credit_card' && isEditMode && (
        <TouchableOpacity 
          style={[styles.linkButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => navigation.navigate('CreditCardDetails')}
        >
          <View style={styles.linkContent}>
            <Ionicons name="card-outline" size={20} color={colors.primary} />
            <Text style={[styles.linkText, { color: colors.primary }]}>View All Credit Card Details</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      {type !== 'debit_card' && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {type === 'credit_card' ? 'Available Credit' : 'Current Balance'}
          </Text>
          <View style={[styles.amountInputContainer, { backgroundColor: colors.card }]}>
            <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={balance}
              onChangeText={setBalance}
            />
          </View>
        </View>
      )}

      {type === 'credit_card' && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Credit Limit</Text>
          <View style={[styles.amountInputContainer, { backgroundColor: colors.card }]}>
            <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={creditLimit}
              onChangeText={setCreditLimit}
            />
          </View>
        </View>
      )}

      {type === 'credit_card' && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Monthly Spending Limit (Optional)</Text>
          <View style={[styles.amountInputContainer, { backgroundColor: colors.card }]}>
            <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              placeholder="e.g., 5000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={monthlySpendingLimit}
              onChangeText={setMonthlySpendingLimit}
            />
          </View>
          <Text style={[styles.hint, { color: colors.textMuted }]}>Set a monthly budget for this card</Text>
        </View>
      )}

      {type === 'credit_card' && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Billing Date (Day of Month)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
            placeholder="e.g., 15 (for 15th of every month)"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            maxLength={2}
            value={billingDate}
            onChangeText={setBillingDate}
          />
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            Enter the day (1-31) when your billing cycle starts
          </Text>
        </View>
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Last 4 Digits (optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="e.g., 1234"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          maxLength={4}
          value={accountNumber}
          onChangeText={setAccountNumber}
        />
      </View>

      {type === 'bank' && (
        <>
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Account Number (optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="e.g., 1234567890"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={bankAccountNumber}
              onChangeText={setBankAccountNumber}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>Full bank account number</Text>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>IFSC Code (optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="e.g., HDFC0001234"
              placeholderTextColor={colors.textMuted}
              value={ifscCode}
              onChangeText={setIfscCode}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>Indian Financial System Code</Text>
          </View>
        </>
      )}

      {(type === 'debit_card' || type === 'credit_card') && bankAccounts.length > 0 && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            Linked Bank Account{type === 'debit_card' ? ' *' : ''}
          </Text>
          <TouchableOpacity
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}
            onPress={() => setShowLinkedAccountPicker(!showLinkedAccountPicker)}
          >
            <Text style={[styles.pickerText, { color: linkedAccountId ? colors.text : colors.textMuted }]}>
              {linkedAccountId 
                ? bankAccounts.find(a => a.id === linkedAccountId)?.name || 'Select Account'
                : type === 'debit_card' ? 'Select Bank Account' : 'Select Bank Account (Optional)'}
            </Text>
          </TouchableOpacity>
          {showLinkedAccountPicker && (
            <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity
                style={styles.pickerOption}
                onPress={() => { setLinkedAccountId(undefined); setShowLinkedAccountPicker(false); }}
              >
                <Text style={[styles.pickerOptionText, { color: colors.textMuted }]}>None</Text>
              </TouchableOpacity>
              {bankAccounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={styles.pickerOption}
                  onPress={() => { setLinkedAccountId(account.id); setShowLinkedAccountPicker(false); }}
                >
                  <Text style={[styles.pickerOptionText, { color: colors.text }]}>{account.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {type === 'debit_card' 
              ? 'Debit card uses the linked bank account balance'
              : 'Link to the bank account this card belongs to'}
          </Text>
          {type === 'debit_card' && linkedAccountBalance && (
            <View style={[styles.balanceDisplay, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.balanceLabel, { color: colors.textMuted }]}>Current Balance:</Text>
              <Text style={[styles.balanceAmount, { color: colors.primary }]}>₹{linkedAccountBalance}</Text>
            </View>
          )}
        </View>
      )}

      {(type === 'credit_card' || type === 'debit_card') && (
        <>
          <View style={[styles.sectionHeader, { borderTopColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Card Details (Optional)</Text>
            <Text style={[styles.sectionHint, { color: colors.textMuted }]}>Save card info securely (CVV not stored)</Text>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Card Number</Text>
            <View style={styles.cardNumberContainer}>
              <TextInput
                style={[styles.input, styles.cardNumberInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="1234 5678 9012 3456"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                maxLength={19}
                value={displayCardNumber}
                onChangeText={(text) => {
                  if (!isEditMode) {
                    const cleaned = text.replace(/\s/g, '');
                    const formatted = cleaned.replace(/(\d{4})/g, '$1 ').trim();
                    setCardNumber(formatted);
                  }
                }}
                editable={!isEditMode}
                data-testid="input-card-number"
              />
              {isEditMode && fullCardNumber && (
                <TouchableOpacity
                  style={styles.eyeIconButton}
                  onPress={() => setShowCardNumber(!showCardNumber)}
                >
                  <Ionicons
                    name={showCardNumber ? "eye-off-outline" : "eye-outline"}
                    size={22}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.rowFields}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Expiry Month</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="MM"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                maxLength={2}
                value={expiryMonth}
                onChangeText={setExpiryMonth}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Expiry Year</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                placeholder="YY"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                maxLength={2}
                value={expiryYear}
                onChangeText={setExpiryYear}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Cardholder Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="Name as on card"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              value={cardholderName}
              onChangeText={setCardholderName}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Card Network</Text>
            <View style={styles.cardTypeGrid}>
              {(['visa', 'mastercard', 'rupay', 'amex', 'other'] as const).map((ct) => (
                <TouchableOpacity
                  key={ct}
                  style={[
                    styles.cardTypeButton,
                    { backgroundColor: colors.card, borderColor: cardType === ct ? colors.primary : colors.border }
                  ]}
                  onPress={() => setCardType(ct)}
                >
                  <Text style={[
                    styles.cardTypeText,
                    { color: cardType === ct ? colors.primary : colors.textMuted }
                  ]}>
                    {ct === 'amex' ? 'Amex' : ct.charAt(0).toUpperCase() + ct.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </>
      )}

      {type === 'bank' && (
        <TouchableOpacity 
          style={[styles.defaultToggle, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setIsDefault(!isDefault)}
        >
          <View style={styles.defaultToggleContent}>
            <View>
              <Text style={[styles.defaultToggleTitle, { color: colors.text }]}>Set as Default Account</Text>
              <Text style={[styles.defaultToggleDesc, { color: colors.textMuted }]}>
                Auto-select this account for new transactions
              </Text>
            </View>
            <View style={[styles.switch, { backgroundColor: isDefault ? colors.primary : colors.border }]}>
              <View style={[styles.switchThumb, { transform: [{ translateX: isDefault ? 20 : 2 }] }]} />
            </View>
          </View>
        </TouchableOpacity>
      )}

      {type === 'credit_card' && !isEditMode && (
        <>
          <View style={[styles.sectionHeader, { borderTopColor: colors.border }]}>
          </View>

          <TouchableOpacity 
            style={[styles.defaultToggle, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setCreateScheduledPayment(!createScheduledPayment)}
          >
            <View style={styles.defaultToggleContent}>
              <View>
                <Text style={[styles.defaultToggleTitle, { color: colors.text }]}>Bill Payment Tracking</Text>
                <Text style={[styles.defaultToggleDesc, { color: colors.textMuted }]}>
                  Track monthly credit card bill payments
                </Text>
              </View>
              <View style={[styles.switch, { backgroundColor: createScheduledPayment ? colors.primary : colors.border }]}>
                <View style={[styles.switchThumb, { transform: [{ translateX: createScheduledPayment ? 20 : 2 }] }]} />
              </View>
            </View>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity 
        style={[styles.submitButton, { backgroundColor: colors.primary }, isPending && styles.submitButtonDisabled]} 
        onPress={handleSubmit}
        disabled={isPending}
      >
        {isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>
            {isEditMode ? 'Update Account' : 'Add Account'}
          </Text>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  typeButton: {
    minWidth: '28%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  typeButtonActive: {
  },
  typeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  typeTextActive: {
    color: '#ffffff',
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
  defaultToggle: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  defaultToggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  defaultToggleTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  defaultToggleDesc: {
    fontSize: 12,
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
  },
  switch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
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
  pickerText: {
    fontSize: 16,
  },
  pickerList: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pickerOption: {
    padding: 12,
    borderBottomWidth: 0.5,
  },
  pickerOptionText: {
    fontSize: 14,
  },
  sectionHeader: {
    marginTop: 16,
    marginBottom: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 12,
  },
  cardTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardTypeButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  cardTypeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  linkContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
  },
  cardNumberContainer: {
    position: 'relative',
  },
  cardNumberInput: {
    paddingRight: 50,
  },
  eyeIconButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  balanceDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
  },
  balanceLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 18,
    fontWeight: '600',
  },
});
