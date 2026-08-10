import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Switch, ActivityIndicator, Alert } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { api } from '../lib/api';
import type { Account, Insurance, InsertInsurance } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';

const INSURANCE_TYPES = [
  { value: 'health', label: 'Health', icon: 'medkit' },
  { value: 'life', label: 'Life', icon: 'heart' },
  { value: 'vehicle', label: 'Vehicle', icon: 'car' },
  { value: 'home', label: 'Home', icon: 'home' },
  { value: 'term', label: 'Term', icon: 'shield-checkmark' },
  { value: 'travel', label: 'Travel', icon: 'airplane' },
] as const;

const FREQUENCY_OPTIONS = [
  { value: 'annual', label: 'Annual' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', icon: 'checkmark-circle', color: '#22c55e' },
  { value: 'paid_up', label: 'Paid Up', icon: 'ribbon', color: '#16a34a' },
  { value: 'expired', label: 'Expired', icon: 'time', color: '#ef4444' },
  { value: 'lapsed', label: 'Lapsed', icon: 'alert-circle', color: '#f97316' },
  { value: 'cancelled', label: 'Cancelled', icon: 'close-circle', color: '#6b7280' },
] as const;

export default function AddInsuranceScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const navigation = useNavigation();
  const route = useRoute();
  const queryClient = useQueryClient();
  const insuranceId = (route.params as any)?.insuranceId;
  const isEditing = !!insuranceId;

  const [name, setName] = useState('');
  const [type, setType] = useState<typeof INSURANCE_TYPES[number]['value']>('health');
  const [providerName, setProviderName] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [premiumAmount, setPremiumAmount] = useState('');
  const [coverageAmount, setCoverageAmount] = useState('');
  const [premiumFrequency, setPremiumFrequency] = useState<typeof FREQUENCY_OPTIONS[number]['value']>('annual');
  const [termsPerPeriod, setTermsPerPeriod] = useState('1');
  const [policyTermYears, setPolicyTermYears] = useState('');
  const [premiumPaymentTermYears, setPremiumPaymentTermYears] = useState('');
  const [maturityAmount, setMaturityAmount] = useState('');
  const [status, setStatus] = useState<typeof STATUS_OPTIONS[number]['value']>('active');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date(new Date().setFullYear(new Date().getFullYear() + 1)));
  const [accountId, setAccountId] = useState<number | undefined>();
  const [createTransaction, setCreateTransaction] = useState(false);
  const [affectBalance, setAffectBalance] = useState(false);
  const [autoFunded, setAutoFunded] = useState(false);
  const [linkedInsuranceId, setLinkedInsuranceId] = useState<number | undefined>();
  const [autoMarkPaidEnabled, setAutoMarkPaidEnabled] = useState(false);
  const [autoMarkKeyword, setAutoMarkKeyword] = useState('');
  const [notes, setNotes] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showLinkedPicker, setShowLinkedPicker] = useState(false);

  const { data: insurances } = useQuery<Insurance[]>({
    queryKey: ['/api/insurances'],
    queryFn: () => api.getInsurances(),
  });
  const linkableInsurances = (insurances || []).filter(i => i.id !== insuranceId);
  const selectedLinkedInsurance = linkableInsurances.find(i => i.id === linkedInsuranceId);

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ['/api/accounts'],
    queryFn: () => api.getAccounts(),
  });

  const { data: existingInsurance, isLoading: isLoadingInsurance } = useQuery<Insurance>({
    queryKey: ['/api/insurances', insuranceId],
    queryFn: () => api.getInsurance(insuranceId),
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingInsurance) {
      setName(existingInsurance.name);
      setType(existingInsurance.type);
      setProviderName(existingInsurance.providerName || '');
      setPolicyNumber(existingInsurance.policyNumber || '');
      setPremiumAmount(existingInsurance.premiumAmount);
      setCoverageAmount(existingInsurance.coverageAmount || '');
      setPremiumFrequency(existingInsurance.premiumFrequency);
      setTermsPerPeriod(String(existingInsurance.termsPerPeriod));
      setPolicyTermYears(existingInsurance.policyTermYears ? String(existingInsurance.policyTermYears) : '');
      setPremiumPaymentTermYears(existingInsurance.premiumPaymentTermYears ? String(existingInsurance.premiumPaymentTermYears) : '');
      setMaturityAmount(existingInsurance.maturityAmount || '');
      setStatus((existingInsurance.status as typeof STATUS_OPTIONS[number]['value']) || 'active');
      setStartDate(new Date(existingInsurance.startDate));
      if (existingInsurance.endDate) {
        setEndDate(new Date(existingInsurance.endDate));
      }
      setAccountId(existingInsurance.accountId || undefined);
      setCreateTransaction(existingInsurance.createTransaction);
      setAffectBalance(existingInsurance.affectBalance);
      setAutoFunded(existingInsurance.autoFunded);
      setLinkedInsuranceId(existingInsurance.linkedInsuranceId || undefined);
      setAutoMarkPaidEnabled((existingInsurance as any).autoMarkPaidEnabled ?? false);
      setAutoMarkKeyword((existingInsurance as any).autoMarkKeyword ?? '');
      setNotes(existingInsurance.notes || '');
    }
  }, [existingInsurance]);

  // Life/term policies distinguish Policy Term (total coverage) from Premium Term (years
  // paying) — End Date is derived from Start Date + Policy Term instead of being a separate
  // manual entry, so there's only ever one date to reconcile instead of two.
  const isTermBasedType = type === 'life' || type === 'term';

  useEffect(() => {
    if (!isTermBasedType || !policyTermYears) return;
    const years = parseInt(policyTermYears);
    if (isNaN(years) || years <= 0) return;
    const computed = new Date(startDate);
    computed.setFullYear(computed.getFullYear() + years);
    setEndDate(computed);
  }, [isTermBasedType, startDate, policyTermYears]);

  const createMutation = useMutation({
    mutationFn: (data: InsertInsurance) => api.createInsurance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurances'] });
      Toast.show({
        type: 'success',
        text1: 'Insurance Added',
        text2: 'Your insurance policy has been added',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: error.message || 'Failed to add insurance',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<InsertInsurance> & { confirmRegenerate?: boolean }) => api.updateInsurance(insuranceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurances'] });
      Toast.show({
        type: 'success',
        text1: 'Insurance Updated',
        text2: 'Your insurance policy has been updated',
        position: 'bottom',
      });
      navigation.goBack();
    },
    onError: (error: any, variables) => {
      if (error.confirmationRequired) {
        Alert.alert(
          'Regenerate Premium Schedule?',
          error.message || `${error.paidPremiumCount} paid premium(s) will be removed and the schedule regenerated from the new details.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', style: 'destructive', onPress: () => updateMutation.mutate({ ...variables, confirmRegenerate: true }) },
          ]
        );
        return;
      }
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: error.message || 'Failed to update insurance',
        position: 'bottom',
      });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Please enter insurance name', position: 'bottom' });
      return;
    }
    if (!premiumAmount || parseFloat(premiumAmount) <= 0) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Please enter premium amount', position: 'bottom' });
      return;
    }
    if (autoMarkPaidEnabled && !autoMarkKeyword.trim()) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Enter an SMS keyword to enable auto-mark-as-paid', position: 'bottom' });
      return;
    }

    const data: InsertInsurance = {
      name: name.trim(),
      type,
      providerName: providerName.trim() || undefined,
      policyNumber: policyNumber.trim() || undefined,
      premiumAmount,
      coverageAmount: coverageAmount || undefined,
      premiumFrequency,
      termsPerPeriod: parseInt(termsPerPeriod) || 1,
      policyTermYears: policyTermYears ? parseInt(policyTermYears) : undefined,
      premiumPaymentTermYears: premiumPaymentTermYears ? parseInt(premiumPaymentTermYears) : undefined,
      maturityAmount: maturityAmount || undefined,
      status,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      accountId,
      createTransaction,
      affectBalance,
      autoFunded,
      linkedInsuranceId: autoFunded ? (linkedInsuranceId ?? null) : null,
      autoMarkPaidEnabled,
      autoMarkKeyword: autoMarkPaidEnabled ? autoMarkKeyword.trim() : null,
      notes: notes.trim() || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const formatDateDisplay = (date: Date) => {
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const selectedAccount = accounts?.find(a => a.id === accountId);

  if (isEditing && isLoadingInsurance) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      enableOnAndroid
      enableAutomaticScroll
      extraScrollHeight={20}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.form}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Basic Info</Text>
          
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Insurance Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g., Health Insurance - Family"
              placeholderTextColor={colors.textMuted}
              data-testid="input-insurance-name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Insurance Type</Text>
            <View style={styles.typeGrid}>
              {INSURANCE_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[
                    styles.typeButton,
                    { backgroundColor: colors.card, borderColor: type === t.value ? colors.primary : colors.border }
                  ]}
                  onPress={() => setType(t.value)}
                  data-testid={`button-type-${t.value}`}
                >
                  <Ionicons 
                    name={t.icon as any} 
                    size={20} 
                    color={type === t.value ? colors.primary : colors.textMuted} 
                  />
                  <Text style={[
                    styles.typeLabel, 
                    { color: type === t.value ? colors.primary : colors.textMuted }
                  ]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Provider Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={providerName}
              onChangeText={setProviderName}
              placeholder="e.g., ICICI Lombard"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Policy Number</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={policyNumber}
              onChangeText={setPolicyNumber}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Premium Details</Text>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Total Premium Amount</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={premiumAmount}
              onChangeText={setPremiumAmount}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              data-testid="input-premium-amount"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Premium Frequency</Text>
            <View style={styles.frequencyGrid}>
              {FREQUENCY_OPTIONS.map((f) => (
                <TouchableOpacity
                  key={f.value}
                  style={[
                    styles.frequencyButton,
                    { backgroundColor: colors.card, borderColor: premiumFrequency === f.value ? colors.primary : colors.border }
                  ]}
                  onPress={() => setPremiumFrequency(f.value)}
                >
                  <Text style={[
                    styles.frequencyLabel, 
                    { color: premiumFrequency === f.value ? colors.primary : colors.textMuted }
                  ]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Payment Terms per Period</Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              How many installments to pay the premium? (e.g., 2 for paying annual premium in 2 parts)
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={termsPerPeriod}
              onChangeText={setTermsPerPeriod}
              placeholder="1"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              data-testid="input-terms-per-period"
            />
            {parseInt(termsPerPeriod) > 1 && premiumAmount && (
              <Text style={[styles.calculatedAmount, { color: colors.primary }]}>
                Each term: {formatCurrency(parseFloat(premiumAmount) / parseInt(termsPerPeriod))}
              </Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Coverage Amount (Sum Insured)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={coverageAmount}
              onChangeText={setCoverageAmount}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
          </View>
        </View>

        {(type === 'life' || type === 'term') && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Policy & Payment Terms</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
              For life/term insurance with different policy and payment durations
            </Text>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Policy Term (Years)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                  value={policyTermYears}
                  onChangeText={setPolicyTermYears}
                  placeholder="e.g. 16"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  data-testid="input-policy-term-years"
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1, marginLeft: 12 }]}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Premium Term (Years)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                  value={premiumPaymentTermYears}
                  onChangeText={setPremiumPaymentTermYears}
                  placeholder="e.g. 10"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  data-testid="input-premium-payment-term-years"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Maturity Amount</Text>
              <View style={styles.inputWithPrefix}>
                <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                <TextInput
                  style={[styles.inputWithPrefixField, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                  value={maturityAmount}
                  onChangeText={setMaturityAmount}
                  placeholder="Amount at maturity"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  data-testid="input-maturity-amount"
                />
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Policy Period</Text>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Start Date</Text>
            <TouchableOpacity
              style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowStartPicker(true)}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
              <Text style={[styles.dateText, { color: colors.text }]}>{formatDateDisplay(startDate)}</Text>
            </TouchableOpacity>
            {showStartPicker && (
              <DateTimePicker
                value={startDate}
                mode="date"
                onChange={(_, date) => {
                  setShowStartPicker(false);
                  if (date) setStartDate(date);
                }}
                themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
                textColor={colors.text}
              />
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>End Date</Text>
            {isTermBasedType ? (
              <View style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.7 }]}>
                <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.dateText, { color: colors.text }]}>
                  {policyTermYears ? formatDateDisplay(endDate) : 'Enter Policy Term above'}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setShowEndPicker(true)}
              >
                <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.dateText, { color: colors.text }]}>{formatDateDisplay(endDate)}</Text>
              </TouchableOpacity>
            )}
            {!isTermBasedType && showEndPicker && (
              <DateTimePicker
                value={endDate}
                mode="date"
                onChange={(_, date) => {
                  setShowEndPicker(false);
                  if (date) setEndDate(date);
                }}
                themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
                textColor={colors.text}
              />
            )}
            {isTermBasedType && (
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted, marginTop: 6 }]}>
                Auto-calculated from Start Date + Policy Term
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Settings</Text>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Payment Account</Text>
            <TouchableOpacity
              style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setShowAccountPicker(!showAccountPicker)}
            >
              <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
              <Text style={[styles.dateText, { color: selectedAccount ? colors.text : colors.textMuted }]}>
                {selectedAccount ? selectedAccount.name : 'Select Account (Optional)'}
              </Text>
            </TouchableOpacity>
            {showAccountPicker && accounts && (
              <View style={[styles.accountList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={styles.accountOption}
                  onPress={() => { setAccountId(undefined); setShowAccountPicker(false); }}
                >
                  <Text style={[styles.accountName, { color: colors.textMuted }]}>None</Text>
                </TouchableOpacity>
                {accounts.map((account) => (
                  <TouchableOpacity
                    key={account.id}
                    style={styles.accountOption}
                    onPress={() => { setAccountId(account.id); setShowAccountPicker(false); }}
                  >
                    <Text style={[styles.accountName, { color: colors.text }]}>{account.name}</Text>
                    <Text style={[styles.accountBalance, { color: colors.textMuted }]}>
                      {formatCurrency(parseFloat(account.balance))}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
              <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                Record payment as a transaction
              </Text>
            </View>
            <Switch
              value={createTransaction}
              onValueChange={setCreateTransaction}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
              <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                Deduct from account when marked paid
              </Text>
            </View>
            <Switch
              value={affectBalance}
              onValueChange={setAffectBalance}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Auto-Funded Policy</Text>
              <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                Funded automatically by another policy — no separate payment needed
              </Text>
            </View>
            <Switch
              value={autoFunded}
              onValueChange={(value) => {
                setAutoFunded(value);
                if (!value) setLinkedInsuranceId(undefined);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {autoFunded && (
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Funded By</Text>
              <TouchableOpacity
                style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => setShowLinkedPicker(!showLinkedPicker)}
              >
                <Ionicons name="link-outline" size={20} color={colors.textMuted} />
                <Text style={[styles.dateText, { color: selectedLinkedInsurance ? colors.text : colors.textMuted }]}>
                  {selectedLinkedInsurance ? selectedLinkedInsurance.name : 'Select Policy'}
                </Text>
              </TouchableOpacity>
              {showLinkedPicker && (
                <View style={[styles.accountList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {linkableInsurances.length === 0 ? (
                    <Text style={[styles.accountName, { color: colors.textMuted, padding: 12 }]}>
                      No other policies yet
                    </Text>
                  ) : (
                    linkableInsurances.map((ins) => (
                      <TouchableOpacity
                        key={ins.id}
                        style={styles.accountOption}
                        onPress={() => { setLinkedInsuranceId(ins.id); setShowLinkedPicker(false); }}
                      >
                        <Text style={[styles.accountName, { color: colors.text }]}>{ins.name}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}
            </View>
          )}

          {!autoFunded && (
            <>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Auto-Mark as Paid</Text>
                  <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                    Mark the next premium paid automatically when a matching debited SMS arrives
                  </Text>
                </View>
                <Switch
                  value={autoMarkPaidEnabled}
                  onValueChange={setAutoMarkPaidEnabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {autoMarkPaidEnabled && (
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>SMS Keyword *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    placeholder="e.g., LIC, HDFC LIFE"
                    placeholderTextColor={colors.textMuted}
                    value={autoMarkKeyword}
                    onChangeText={setAutoMarkKeyword}
                    autoCapitalize="characters"
                  />
                  <Text style={[styles.toggleHint, { color: colors.textMuted, marginTop: 4 }]}>
                    Only SMS containing this text (case-insensitive) and the exact premium amount, near the due date, will auto-match
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Policy Status</Text>
          <View style={styles.statusGrid}>
            {STATUS_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.statusOption,
                  { 
                    backgroundColor: status === option.value ? `${option.color}20` : colors.card,
                    borderColor: status === option.value ? option.color : colors.border,
                  }
                ]}
                onPress={() => setStatus(option.value)}
                data-testid={`status-${option.value}`}
              >
                <Ionicons 
                  name={option.icon as any} 
                  size={18} 
                  color={status === option.value ? option.color : colors.textMuted} 
                />
                <Text style={[
                  styles.statusOptionText,
                  { color: status === option.value ? option.color : colors.text }
                ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.statusHint, { color: colors.textMuted }]}>
            {status === 'paid_up' && 'Premium payments completed, policy remains active until maturity'}
            {status === 'active' && 'Policy is active with ongoing premium payments'}
            {status === 'expired' && 'Policy term has ended'}
            {status === 'lapsed' && 'Policy lapsed due to non-payment of premiums'}
            {status === 'cancelled' && 'Policy was cancelled before maturity'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Notes</Text>
          <TextInput
            style={[styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional notes..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: colors.primary }]}
          onPress={handleSubmit}
          disabled={createMutation.isPending || updateMutation.isPending}
          data-testid="button-submit-insurance"
        >
          {(createMutation.isPending || updateMutation.isPending) ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>
              {isEditing ? 'Update Insurance' : 'Add Insurance'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  form: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 12,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  hint: {
    fontSize: 11,
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  textArea: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputWithPrefix: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '500',
    marginRight: 8,
  },
  inputWithPrefixField: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  frequencyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  frequencyButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  frequencyLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  calculatedAmount: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
  },
  dateButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dateText: {
    fontSize: 15,
  },
  accountList: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accountOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
  },
  accountName: {
    fontSize: 14,
  },
  accountBalance: {
    fontSize: 13,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  toggleHint: {
    fontSize: 12,
    marginTop: 2,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  statusOptionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusHint: {
    fontSize: 11,
    marginTop: 10,
    fontStyle: 'italic',
  },
  submitButton: {
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
