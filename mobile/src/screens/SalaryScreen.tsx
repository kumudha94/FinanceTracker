import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Modal, Switch } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Swipeable } from 'react-native-gesture-handler';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { api, API_BASE_URL } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';
import { useSwipeSettings } from '../hooks/useSwipeSettings';

interface SalaryProfile {
  id: number;
  paydayRule: string;
  fixedDay: number | null;
  monthCycleStartRule?: string;
  monthCycleStartDay?: number | null;
  monthlyAmount: string | null;
  accountId: number | null;
  autoMarkPaidEnabled?: boolean;
  autoMarkKeyword?: string | null;
}

interface Account {
  id: number;
  name: string;
  type: string;
  balance: string;
  isDefault?: boolean;
}

interface Payday {
  month: number;
  year: number;
  date: string;
}

interface SalaryCycle {
  id: number;
  month: number;
  year: number;
  expectedPayDate: string;
  actualPayDate: string | null;
  expectedAmount: string | null;
  actualAmount: string | null;
  transactionId: number | null;
  affectAccountBalance?: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function SalaryScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const queryClient = useQueryClient();
  const swipeSettings = useSwipeSettings();
  const swipeableRef = useRef<Swipeable>(null);

  const [paydayRule, setPaydayRule] = useState('last_working_day');
  const [fixedDay, setFixedDay] = useState('25');
  const [monthCycleStartRule, setMonthCycleStartRule] = useState('salary_day');
  const [monthCycleStartDay, setMonthCycleStartDay] = useState('1');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [showSalary, setShowSalary] = useState(false);
  const [showPastSalary, setShowPastSalary] = useState(false);
  const [editingCycle, setEditingCycle] = useState<SalaryCycle | null>(null);
  const [editingNextPayday, setEditingNextPayday] = useState<Payday | null>(null);
  const [editNextPaydayDate, setEditNextPaydayDate] = useState('');
  const [editNextPaydayAmount, setEditNextPaydayAmount] = useState('');
  const [editActualDate, setEditActualDate] = useState('');
  const [editActualAmount, setEditActualAmount] = useState('');
  const [markAsCredited, setMarkAsCredited] = useState(false);
  const [affectAccountBalance, setAffectAccountBalance] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showNextPaydayDatePicker, setShowNextPaydayDatePicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [autoMarkPaidEnabled, setAutoMarkPaidEnabled] = useState(false);
  const [autoMarkKeyword, setAutoMarkKeyword] = useState('');

  const { data: profile, isLoading } = useQuery<SalaryProfile | null>({
    queryKey: ['/api/salary-profile'],
    queryFn: () => api.getSalaryProfile(),
  });

  const { data: nextPaydays = [] } = useQuery<Payday[]>({
    queryKey: ['/api/salary-profile/next-paydays'],
    queryFn: () => api.getNextPaydays(3),
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['/api/accounts'],
    queryFn: async () => {
      const allAccounts = await api.getAccounts();
      return allAccounts.filter((acc: Account) => acc.type === 'bank');
    },
  });

  const selectedAccount = accounts?.find(a => a.id === accountId);

  // Auto-select default account
  useMemo(() => {
    if (!accountId && accounts.length > 0) {
      const defaultAccount = accounts.find(acc => acc.isDefault);
      if (defaultAccount) {
        setAccountId(defaultAccount.id);
      }
    }
  }, [accounts]);

  const { data: salaryCycles = [] } = useQuery<SalaryCycle[]>({
    queryKey: ['/api/salary-cycles'],
    queryFn: () => api.getSalaryCycles(),
  });

  const updateCycleMutation = useMutation({
    mutationFn: async ({ id, actualPayDate, actualAmount, markAsCredited, affectAccountBalance }: { id: number; actualPayDate: string; actualAmount: string; markAsCredited: boolean; affectAccountBalance: boolean }) => {
      return api.updateSalaryCycle(id, { actualPayDate, actualAmount, markAsCredited, affectAccountBalance });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/salary-cycles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      setEditingCycle(null);
      Toast.show({
        type: 'success',
        text1: 'Updated',
        text2: 'Salary information updated successfully',
        position: 'bottom',
      });
    },
  });

  const handleEditCycle = (cycle: SalaryCycle) => {
    setEditingCycle(cycle);
    setEditActualDate(cycle.actualPayDate || cycle.expectedPayDate);
    setEditActualAmount(cycle.actualAmount || cycle.expectedAmount || '');
    setMarkAsCredited(!!cycle.transactionId);
    setAffectAccountBalance(cycle.affectAccountBalance ?? true);
    setShowDatePicker(false);
  };

  const handleSaveCycle = () => {
    if (editingCycle) {
      updateCycleMutation.mutate({
        id: editingCycle.id,
        actualPayDate: editActualDate,
        actualAmount: editActualAmount,
        markAsCredited: markAsCredited,
        affectAccountBalance: affectAccountBalance,
      });
    }
  };

  const handleEditNextPayday = useCallback((payday: Payday) => {
    swipeableRef.current?.close();
    setEditingNextPayday(payday);
    setEditNextPaydayDate(payday.date);
    setEditNextPaydayAmount(monthlyAmount || '');
  }, [monthlyAmount]);

  const handleSaveNextPayday = useCallback(() => {
    // Create or update a salary cycle for this month
    const mutation = async () => {
      return api.createSalaryCycle({
        salaryProfileId: profile?.id,
        month: editingNextPayday?.month,
        year: editingNextPayday?.year,
        expectedPayDate: editNextPaydayDate,
        expectedAmount: editNextPaydayAmount,
        actualPayDate: null,
        actualAmount: null,
      });
    };

    mutation()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/salary-profile/next-paydays'] });
        queryClient.invalidateQueries({ queryKey: ['/api/salary-cycles'] });
        setEditingNextPayday(null);
        Toast.show({
          type: 'success',
          text1: 'Updated',
          text2: 'Next payday updated successfully',
          position: 'bottom',
        });
      })
      .catch(() => {
        Toast.show({
          type: 'error',
          text1: 'Update Failed',
          text2: 'Could not update payday',
          position: 'bottom',
        });
      });
  }, [editingNextPayday, editNextPaydayDate, editNextPaydayAmount, profile, queryClient]);

  useEffect(() => {
    if (profile) {
      setPaydayRule(profile.paydayRule || 'last_working_day');
      setFixedDay(profile.fixedDay?.toString() || '25');
      setMonthCycleStartRule(profile.monthCycleStartRule || 'salary_day');
      setMonthCycleStartDay(profile.monthCycleStartDay?.toString() || '1');
      setMonthlyAmount(profile.monthlyAmount || '');
      setAccountId(profile.accountId || null);
      setAutoMarkPaidEnabled(profile.autoMarkPaidEnabled ?? false);
      setAutoMarkKeyword(profile.autoMarkKeyword || '');
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        paydayRule,
        fixedDay: paydayRule === 'fixed_day' ? parseInt(fixedDay) : null,
        weekdayPreference: null,
        monthCycleStartRule,
        monthCycleStartDay: monthCycleStartRule === 'fixed_day' ? parseInt(monthCycleStartDay) : null,
        monthlyAmount: monthlyAmount || null,
        accountId: accountId || null,
        isActive: true,
        autoMarkPaidEnabled,
        autoMarkKeyword: autoMarkPaidEnabled ? autoMarkKeyword.trim() : null,
      };

      if (profile) {
        return api.updateSalaryProfile(profile.id, data);
      } else {
        return api.createSalaryProfile(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile/next-paydays'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-cycles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      Toast.show({
        type: 'success',
        text1: 'Salary Settings Saved',
        text2: 'Your salary information has been updated',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Save Failed',
        text2: 'Could not save salary settings',
        position: 'bottom',
      });
    },
  });

  const formatPaydayDate = (dateString: string) => {
    const date = new Date(dateString);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      enableOnAndroid
      enableAutomaticScroll
      extraScrollHeight={80}
      keyboardShouldPersistTaps="handled"
    >
      {/* Salary Summary Card */}
      <View style={[styles.summaryCard, { backgroundColor: colors.primary }]}>
        <View style={styles.summaryContent}>
          <Ionicons name="wallet" size={40} color="#fff" />
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>Monthly Salary</Text>
            <Text style={styles.summaryAmount}>
              {monthlyAmount ? (showSalary ? formatCurrency(parseFloat(monthlyAmount)) : '₹ *********') : 'Not set'}
            </Text>
          </View>
          {monthlyAmount && (
            <TouchableOpacity
              onPress={() => setShowSalary(!showSalary)}
              style={styles.visibilityButton}
            >
              <Ionicons name={showSalary ? 'eye-off' : 'eye'} size={24} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Payday Settings Card */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Payday Settings</Text>
        
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Credit Account</Text>
          <TouchableOpacity
            style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowAccountPicker(!showAccountPicker)}
          >
            <Ionicons name="wallet-outline" size={20} color={colors.textMuted} />
            <Text style={[styles.dateText, { color: selectedAccount ? colors.text : colors.textMuted }]}>
              {selectedAccount ? selectedAccount.name : 'Select Account'}
            </Text>
          </TouchableOpacity>
          {showAccountPicker && accounts && (
            <View style={[styles.accountDropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
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

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Monthly Amount (₹)</Text>
          <View style={styles.inputWithIcon}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="50000"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={monthlyAmount}
              onChangeText={setMonthlyAmount}
              secureTextEntry={!showSalary}
            />
            {monthlyAmount && (
              <TouchableOpacity
                onPress={() => setShowSalary(!showSalary)}
                style={styles.inputIcon}
              >
                <Ionicons name={showSalary ? 'eye-off' : 'eye'} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>When do you get paid?</Text>
          <View style={styles.paydayRuleButtons}>
            <TouchableOpacity
              style={[
                styles.paydayRuleButton,
                { backgroundColor: colors.background, borderColor: colors.border },
                paydayRule === 'last_working_day' && { borderColor: colors.primary, backgroundColor: colors.primary + '20' }
              ]}
              onPress={() => setPaydayRule('last_working_day')}
            >
              <Text style={[
                styles.paydayRuleText,
                { color: colors.text },
                paydayRule === 'last_working_day' && { color: colors.primary, fontWeight: '600' }
              ]}>
                Last working day of month
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.paydayRuleButton,
                { backgroundColor: colors.background, borderColor: colors.border },
                paydayRule === 'fixed_day' && { borderColor: colors.primary, backgroundColor: colors.primary + '20' }
              ]}
              onPress={() => setPaydayRule('fixed_day')}
            >
              <Text style={[
                styles.paydayRuleText,
                { color: colors.text },
                paydayRule === 'fixed_day' && { color: colors.primary, fontWeight: '600' }
              ]}>
                Fixed day each month
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {paydayRule === 'fixed_day' && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Day of Month (1-28)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="25"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={fixedDay}
              onChangeText={setFixedDay}
              maxLength={2}
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Month Cycle Start Date</Text>
          <Text style={[styles.helperText, { color: colors.textMuted }]}>
            Choose when your monthly budget cycle should start
          </Text>
          <View style={styles.paydayRuleButtons}>
            <TouchableOpacity
              style={[
                styles.paydayRuleButton,
                { backgroundColor: colors.background, borderColor: colors.border },
                monthCycleStartRule === 'salary_day' && { borderColor: colors.primary, backgroundColor: colors.primary + '20' }
              ]}
              onPress={() => setMonthCycleStartRule('salary_day')}
            >
              <Text style={[
                styles.paydayRuleText,
                { color: colors.text },
                monthCycleStartRule === 'salary_day' && { color: colors.primary, fontWeight: '600' }
              ]}>
                Same as salary day
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.paydayRuleButton,
                { backgroundColor: colors.background, borderColor: colors.border },
                monthCycleStartRule === 'fixed_day' && { borderColor: colors.primary, backgroundColor: colors.primary + '20' }
              ]}
              onPress={() => setMonthCycleStartRule('fixed_day')}
            >
              <Text style={[
                styles.paydayRuleText,
                { color: colors.text },
                monthCycleStartRule === 'fixed_day' && { color: colors.primary, fontWeight: '600' }
              ]}>
                Fixed day each month
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {monthCycleStartRule === 'fixed_day' && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Day of Month (1-31)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="1"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              value={monthCycleStartDay}
              onChangeText={setMonthCycleStartDay}
              maxLength={2}
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>Auto-Mark as Paid</Text>
          <View style={[styles.toggleContainer, { backgroundColor: colors.card }]}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleLabel, { color: colors.text }]}>Auto-Mark as Paid</Text>
                <Text style={[styles.toggleDescription, { color: colors.textMuted }]}>
                  Mark this month's salary credited automatically when a matching credited SMS arrives
                </Text>
              </View>
              <Switch
                value={autoMarkPaidEnabled}
                onValueChange={setAutoMarkPaidEnabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
          {autoMarkPaidEnabled && (
            <>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, marginTop: 12 }]}
                placeholder="SMS Keyword, e.g., SALARY, NEFT"
                placeholderTextColor={colors.textMuted}
                value={autoMarkKeyword}
                onChangeText={setAutoMarkKeyword}
                autoCapitalize="none"
              />
              <Text style={[styles.toggleDescription, { color: colors.textMuted, marginTop: 4 }]}>
                Only a credited SMS containing this text (case-insensitive) into your salary account will auto-match — the amount can vary month to month
              </Text>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            if (autoMarkPaidEnabled && !autoMarkKeyword.trim()) {
              Toast.show({
                type: 'error',
                text1: 'Keyword Required',
                text2: 'Enter an SMS keyword to enable auto-mark-as-paid',
                position: 'bottom',
              });
              return;
            }
            saveMutation.mutate();
          }}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Settings</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Past Paydays Card */}
      {salaryCycles.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="checkmark-circle" size={20} color={colors.text} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Past Paydays</Text>
            <TouchableOpacity
              onPress={() => setShowPastSalary(!showPastSalary)}
              style={styles.headerButton}
            >
              <Ionicons name={showPastSalary ? 'eye-off' : 'eye'} size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.paydayList}>
            {salaryCycles.map((cycle: SalaryCycle) => {
              const amount = cycle.actualAmount || cycle.expectedAmount;
              return (
                <TouchableOpacity
                  key={cycle.id}
                  style={[
                    styles.paydayItem,
                    { 
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    }
                  ]}
                  onPress={() => handleEditCycle(cycle)}
                  activeOpacity={0.7}
                >
                  <View style={styles.paydayContent}>
                    <View style={[styles.monthBadge, { backgroundColor: colors.card }]}>
                      <Text style={[styles.monthText, { color: colors.text }]}>
                        {MONTH_NAMES[cycle.month - 1]}
                      </Text>
                    </View>
                    <View style={styles.paydayInfo}>
                      <Text style={[styles.paydayDate, { color: colors.text }]}>
                        {cycle.actualPayDate ? new Date(cycle.actualPayDate).toLocaleDateString('en-IN') : 'Not paid yet'}
                      </Text>
                      {amount && (
                        <Text style={[styles.paydayAmount, { color: colors.primary }]}>
                          {showPastSalary ? formatCurrency(parseFloat(amount)) : '₹ *****'}
                        </Text>
                      )}
                      <Text style={[styles.paydayLabel, { color: colors.textMuted }]}>
                        {MONTH_NAMES[cycle.month - 1]} {cycle.year}
                      </Text>
                    </View>
                  </View>
                  {cycle.transactionId && (
                    <View style={[styles.creditedBadge, { backgroundColor: colors.primary + '20' }]}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Upcoming Paydays Card */}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="calendar" size={20} color={colors.text} />
          <Text style={[styles.cardTitle, { color: colors.text }]}>Upcoming Paydays</Text>
        </View>
        
        {nextPaydays.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Configure your settings to see payday predictions
          </Text>
        ) : (
          <View style={styles.paydayList}>
            {nextPaydays.map((payday: Payday, index: number) => {
              const isThisMonth = index === 0;
              const content = (
                <View 
                  style={[
                    styles.paydayItem,
                    { 
                      backgroundColor: isThisMonth ? colors.primary + '20' : colors.background,
                      borderColor: isThisMonth ? colors.primary + '40' : colors.border,
                    }
                  ]}
                >
                  <View style={styles.paydayContent}>
                    <View style={[styles.monthBadge, { backgroundColor: colors.background }]}>
                      <Text style={[styles.monthText, { color: colors.text }]}>
                        {MONTH_NAMES[payday.month - 1]}
                      </Text>
                    </View>
                    <View style={styles.paydayInfo}>
                      <Text style={[styles.paydayDate, { color: colors.text }]}>
                        {formatPaydayDate(payday.date)}
                      </Text>
                      <Text style={[styles.paydayLabel, { color: colors.textMuted }]}>
                        {isThisMonth ? 'This month' : `${MONTH_NAMES[payday.month - 1]} ${payday.year}`}
                      </Text>
                    </View>
                  </View>
                  {isThisMonth && (
                    <>
                      <Text style={[styles.nextBadge, { color: colors.primary }]}>Next</Text>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </>
                  )}
                </View>
              );

              // Make first payday tappable and swipeable
              if (index === 0) {
                if (swipeSettings.enabled) {
                  return (
                    <Swipeable
                      key={`${payday.month}-${payday.year}`}
                      ref={swipeableRef}
                      renderRightActions={() => (
                        <TouchableOpacity
                          style={[styles.swipeAction, { backgroundColor: colors.primary }]}
                          onPress={() => handleEditNextPayday(payday)}
                        >
                          <Ionicons name="pencil" size={24} color="#fff" />
                          <Text style={styles.swipeActionText}>Edit</Text>
                        </TouchableOpacity>
                      )}
                      renderLeftActions={() => (
                        <TouchableOpacity
                          style={[styles.swipeAction, { backgroundColor: colors.primary }]}
                          onPress={() => handleEditNextPayday(payday)}
                        >
                          <Ionicons name="pencil" size={24} color="#fff" />
                          <Text style={styles.swipeActionText}>Edit</Text>
                        </TouchableOpacity>
                      )}
                      onSwipeableOpen={() => handleEditNextPayday(payday)}
                    >
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => handleEditNextPayday(payday)}
                      >
                        {content}
                      </TouchableOpacity>
                    </Swipeable>
                  );
                }
                // Tap-only when swipe is disabled
                return (
                  <TouchableOpacity
                    key={`${payday.month}-${payday.year}`}
                    activeOpacity={0.7}
                    onPress={() => handleEditNextPayday(payday)}
                  >
                    {content}
                  </TouchableOpacity>
                );
              }

              return (
                <View key={`${payday.month}-${payday.year}`}>
                  {content}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Edit Cycle Modal */}
      {editingCycle && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Edit Salary - {MONTH_NAMES[editingCycle.month - 1]} {editingCycle.year}
              </Text>
              <TouchableOpacity onPress={() => setEditingCycle(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Actual Pay Date</Text>
                <TouchableOpacity
                  style={[styles.datePickerButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.text} />
                  <Text style={[styles.datePickerText, { color: colors.text }]}>
                    {editActualDate ? new Date(editActualDate).toLocaleDateString('en-IN', { 
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    }) : 'Select Date'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textMuted }]}>Actual Amount (₹)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                  placeholder="Amount"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={editActualAmount}
                  onChangeText={setEditActualAmount}
                />
              </View>

              {/* Credit Account Info */}
              {profile && profile.accountId && (
                <View style={[styles.infoBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
                  <Text style={[styles.infoText, { color: colors.text }]}>
                    Will be credited to: {accounts.find(a => a.id === profile.accountId)?.name || 'Salary Account'}
                  </Text>
                </View>
              )}

              {/* Mark as Credited Checkbox */}
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => setMarkAsCredited(!markAsCredited)}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.checkbox,
                  { borderColor: colors.border },
                  markAsCredited && { backgroundColor: colors.primary, borderColor: colors.primary }
                ]}>
                  {markAsCredited && (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.checkboxLabel, { color: colors.text }]}>Mark as Credited</Text>
                  <Text style={[styles.checkboxHint, { color: colors.textMuted }]}>
                    {markAsCredited
                      ? `₹${editActualAmount} will be added to your account`
                      : 'Check this to automatically create a transaction and update your account balance'
                    }
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Affect Account Balance Checkbox */}
              {markAsCredited && (
                <TouchableOpacity
                  style={styles.checkboxContainer}
                  onPress={() => setAffectAccountBalance(!affectAccountBalance)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.checkbox,
                    { borderColor: colors.border },
                    affectAccountBalance && { backgroundColor: colors.primary, borderColor: colors.primary }
                  ]}>
                    {affectAccountBalance && (
                      <Ionicons name="checkmark" size={16} color="#fff" />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.checkboxLabel, { color: colors.text }]}>Affect Account Balance</Text>
                    <Text style={[styles.checkboxHint, { color: colors.textMuted }]}>
                      {affectAccountBalance
                        ? 'This will add the amount to your account balance'
                        : 'Off — use this if SMS auto-read already credited this salary, so the balance is not doubled'
                      }
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setEditingCycle(null)}
                >
                  <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: colors.primary }]}
                  onPress={handleSaveCycle}
                  disabled={updateCycleMutation.isPending}
                >
                  {updateCycleMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={[styles.modalButtonText, { color: '#fff' }]}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {/* Date Picker Modal for Past Payday */}
      <Modal
        visible={showDatePicker && !!editingCycle}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.datePickerModal, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Date</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.datePickerContent}>
              <ScrollView 
                style={styles.datePickerScroll}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
              >
                {editingCycle && (() => {
                  const year = editingCycle.year;
                  const month = editingCycle.month;
                  const daysInMonth = new Date(year, month, 0).getDate();
                  const dates = [];
                  
                  for (let day = 1; day <= daysInMonth; day++) {
                    const date = new Date(year, month - 1, day);
                    const isSelected = editActualDate && 
                      new Date(editActualDate).toDateString() === date.toDateString();
                    
                    dates.push(
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.dateOption,
                          { backgroundColor: colors.background, borderColor: colors.border },
                          isSelected ? { backgroundColor: colors.primary + '20', borderColor: colors.primary } : undefined
                        ]}
                        onPress={() => {
                          setEditActualDate(date.toISOString());
                          setShowDatePicker(false);
                        }}
                      >
                        <Text style={[
                          styles.dateOptionText,
                          { color: colors.text },
                          isSelected ? { color: colors.primary, fontWeight: '600' } : undefined
                        ]}>
                          {date.toLocaleDateString('en-IN', { 
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                  return dates;
                })()}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Next Payday Modal */}
      {editingNextPayday && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setEditingNextPayday(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modal, { backgroundColor: colors.card }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  Edit Next Payday - {MONTH_NAMES[editingNextPayday.month - 1]} {editingNextPayday.year}
                </Text>
                <TouchableOpacity onPress={() => setEditingNextPayday(null)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalContent}>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Expected Pay Date</Text>
                  <TouchableOpacity
                    style={[styles.datePickerButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => setShowNextPaydayDatePicker(true)}
                  >
                    <Ionicons name="calendar-outline" size={20} color={colors.text} />
                    <Text style={[styles.datePickerText, { color: colors.text }]}>
                      {editNextPaydayDate ? formatPaydayDate(editNextPaydayDate) : 'Select Date'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Expected Amount (₹)</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="Amount"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    value={editNextPaydayAmount}
                    onChangeText={setEditNextPaydayAmount}
                  />
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => setEditingNextPayday(null)}
                  >
                    <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: colors.primary }]}
                    onPress={handleSaveNextPayday}
                  >
                    <Text style={[styles.modalButtonText, { color: '#fff' }]}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Date Picker Modal for Next Payday */}
      <Modal
        visible={showNextPaydayDatePicker && !!editingNextPayday}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowNextPaydayDatePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.datePickerModal, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Date</Text>
              <TouchableOpacity onPress={() => setShowNextPaydayDatePicker(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.datePickerContent}>
              <ScrollView 
                style={styles.datePickerScroll}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
              >
                {editingNextPayday && (() => {
                  const year = editingNextPayday.year;
                  const month = editingNextPayday.month;
                  const daysInMonth = new Date(year, month, 0).getDate();
                  const dates = [];
                  
                  for (let day = 1; day <= daysInMonth; day++) {
                    const date = new Date(year, month - 1, day);
                    const isSelected = editNextPaydayDate && 
                      new Date(editNextPaydayDate).toDateString() === date.toDateString();
                    
                    dates.push(
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.dateOption,
                          { backgroundColor: colors.background, borderColor: colors.border },
                          isSelected ? { backgroundColor: colors.primary + '20', borderColor: colors.primary } : undefined
                        ]}
                        onPress={() => {
                          setEditNextPaydayDate(date.toISOString());
                          setShowNextPaydayDatePicker(false);
                        }}
                      >
                        <Text style={[
                          styles.dateOptionText,
                          { color: colors.text },
                          isSelected ? { color: colors.primary, fontWeight: '600' } : undefined
                        ]}>
                          {date.toLocaleDateString('en-IN', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                  return dates;
                })()}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ height: 40 }} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  summaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  summaryText: {
    flex: 1,
  },
  visibilityButton: {
    padding: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  field: {
    marginBottom: 16,
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
  inputWithIcon: {
    position: 'relative',
  },
  inputIcon: {
    position: 'absolute',
    right: 12,
    top: 12,
    padding: 4,
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
  accountDropdown: {
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
  paydayRuleButtons: {
    gap: 12,
  },
  paydayRuleButton: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
  },
  paydayRuleText: {
    fontSize: 15,
    textAlign: 'center',
  },
  saveButton: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    padding: 16,
  },
  paydayList: {
    gap: 8,
  },
  paydayItem: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paydayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  monthBadge: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthText: {
    fontSize: 14,
    fontWeight: '700',
  },
  paydayInfo: {
    flex: 1,
  },
  paydayDate: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  paydayAmount: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  paydayLabel: {
    fontSize: 12,
  },
  nextBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  editButton: {
    padding: 8,
  },
  headerButton: {
    marginLeft: 'auto',
    padding: 4,
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
  datePickerModal: {
    width: '90%',
    maxWidth: 400,
    maxHeight: '70%',
    borderRadius: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  datePickerContent: {
    maxHeight: 400,
  },
  datePickerScroll: {
    padding: 16,
  },
  dateOption: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  dateOptionText: {
    fontSize: 15,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  checkboxHint: {
    fontSize: 13,
    lineHeight: 18,
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
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 14,
    flex: 1,
  },
  creditedBadge: {
    padding: 4,
    borderRadius: 12,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  modalContent: {
    padding: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginVertical: 4,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
  },
});
