import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Switch, Modal, Platform, TextInput } from 'react-native';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Toast from 'react-native-toast-message';
import { Swipeable } from 'react-native-gesture-handler';
import { api } from '../lib/api';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { MoreStackParamList } from '../../App';
import type { ScheduledPayment, PaymentOccurrence, Category, Account, PaymentOccurrencesCycleResponse } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';
import { useSwipeSettings } from '../hooks/useSwipeSettings';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

// Stable reference so the "occurrences" useEffect dependency doesn't change on every
// render while the query is still loading (a fresh [] literal would re-trigger the effect
// every render, causing an infinite render loop before the query ever resolves).
const EMPTY_OCCURRENCES: PaymentOccurrence[] = [];

const FREQUENCY_OPTIONS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Every 3 Months',
  half_yearly: 'Every 6 Months',
  yearly: 'Yearly',
  one_time: 'One Time',
  custom: 'Custom',
};

function getFrequencyLabel(payment: any): string {
  if (payment.frequency === 'custom' && payment.customIntervalMonths) {
    const months = payment.customIntervalMonths;
    if (months === 1) return 'Monthly';
    if (months === 12) return 'Yearly';
    return `Every ${months} Months`;
  }
  if (payment.frequency === 'day_interval') {
    return `Every ${payment.customIntervalDays ?? '?'} Days`;
  }
  return FREQUENCY_OPTIONS[payment.frequency || 'monthly'] || 'Monthly';
}

export default function ScheduledPaymentsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const swipeSettings = useSwipeSettings();
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());
  const currentOpenSwipeable = useRef<number | null>(null);
  
  const [activeTab, setActiveTab] = useState<'checklist' | 'manage'>('checklist');
  const [cycleAnchor, setCycleAnchor] = useState(new Date());

  // Close all swipeables when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      return () => {
        // Close all swipeables when leaving screen
        swipeableRefs.current.forEach(ref => ref?.close());
        currentOpenSwipeable.current = null;
      };
    }, [])
  );
  
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOccurrence, setSelectedOccurrence] = useState<PaymentOccurrence | null>(null);
  const [paymentDate, setPaymentDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<ScheduledPayment | null>(null);
  const [paymentCreateTransaction, setPaymentCreateTransaction] = useState(true);
  const [paymentAffectBalance, setPaymentAffectBalance] = useState(true);
  const [paymentAmount, setPaymentAmount] = useState('');
  
  // Store calculated billing amounts for credit card bills
  const [billingAmounts, setBillingAmounts] = useState<Record<number, { amount: string; cycleLabel: string }>>({});

  const { data: payments, isLoading, refetch: refetchPayments } = useQuery({
    queryKey: ['/api/scheduled-payments'],
    queryFn: api.getScheduledPayments,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: api.getCategories,
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const { data: cycleData, isPending: isCyclePending, refetch: refetchOccurrences } = useQuery<PaymentOccurrencesCycleResponse>({
    queryKey: ['payment-occurrences-cycle', cycleAnchor.toISOString()],
    queryFn: () => api.getPaymentOccurrencesCycle(cycleAnchor.toISOString()),
    // Keep showing the previous cycle's data (header, tab label, occurrences list)
    // while the newly-requested cycle loads, instead of flashing to blank/wrong/false-empty.
    // Every chevron press mints a brand-new query key (cycleAnchor changes), so without this
    // the screen would flash on every single cycle navigation once payments (the other query
    // gating `isLoading` below) is already cached.
    placeholderData: keepPreviousData,
  });
  const occurrences = cycleData?.occurrences ?? EMPTY_OCCURRENCES;

  // Refetch data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refetchPayments();
      refetchOccurrences();
    }, [refetchPayments, refetchOccurrences])
  );

  // Fetch billing amounts for credit card bills IN THIS MONTH ONLY (checklist tab)
  useEffect(() => {
    // Clear old billing amounts immediately when occurrences change
    setBillingAmounts({});
    
    if (!occurrences || occurrences.length === 0) return;
    
    const fetchBillingAmounts = async () => {
      // Filter credit card bill occurrences
      const creditCardOccurrences = occurrences.filter(
        occurrence => occurrence.scheduledPayment?.paymentType === 'credit_card_bill'
      );
      
      if (creditCardOccurrences.length === 0) return;
      
      // Fetch all billing amounts in parallel
      const results = await Promise.allSettled(
        creditCardOccurrences.map(async (occurrence) => {
          const payment = occurrence.scheduledPayment;
          if (!payment) return null;
          
          try {
            const data = await api.getScheduledPaymentBillingAmount(payment.id);
            return {
              paymentId: payment.id,
              amount: data.calculatedAmount,
              cycleLabel: data.cycleLabel
            };
          } catch (error) {
            console.error(`Error fetching billing amount for payment ${payment.id}:`, error);
            return null;
          }
        })
      );
      
      // Build amounts object from successful results
      const amounts: Record<number, { amount: string; cycleLabel: string }> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          const { paymentId, amount, cycleLabel } = result.value;
          amounts[paymentId] = { amount, cycleLabel };
        }
      });
      
      setBillingAmounts(amounts);
    };
    
    fetchBillingAmounts();
  }, [occurrences, cycleAnchor]);

  const updateOccurrenceMutation = useMutation({
    mutationFn: async ({ id, status, occurrence, affectTransaction, affectAccountBalance }: { 
      id: number; 
      status: string; 
      occurrence?: PaymentOccurrence;
      affectTransaction?: boolean;
      affectAccountBalance?: boolean;
    }) => {
      // If unchecking (changing from paid to pending), delete transaction and restore account balance
      if (status === 'pending' && occurrence) {
        const payment = occurrence.scheduledPayment;
        if (payment) {
          // Find the transaction by description and amount
          const transactionDescription = `Scheduled payment: ${payment.name}`;
          const allTransactions = await api.getTransactions();
          
          // Find the exact transaction (matching description and amount)
          const matchingTransaction = allTransactions.find((t: any) => 
            t.description === transactionDescription && 
            parseFloat(t.amount) === parseFloat(payment.amount) &&
            t.type === 'debit'
          );
          
          if (matchingTransaction) {
            // Delete the transaction
            await api.deleteTransaction(matchingTransaction.id);
            
            // Restore account balance (add back the payment amount)
            if (matchingTransaction.accountId) {
              const account = accounts.find(a => a.id === matchingTransaction.accountId);
              if (account) {
                const newBalance = (parseFloat(account.balance) + parseFloat(payment.amount)).toString();
                await api.updateAccount(matchingTransaction.accountId, { balance: newBalance });
              }
            }
          }
        }
      }
      
      // Update occurrence status and toggles
      const updateData: any = { status };
      if (affectTransaction !== undefined) {
        updateData.affectTransaction = affectTransaction;
      }
      if (affectAccountBalance !== undefined) {
        updateData.affectAccountBalance = affectAccountBalance;
      }
      return await api.updatePaymentOccurrence(id, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      refetchOccurrences();
      Toast.show({
        type: 'success',
        text1: 'Payment Updated',
        text2: 'Payment status has been updated',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update payment. Please try again.',
        position: 'bottom',
      });
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async ({ occurrenceId, accountId, date, createTransaction, affectBalance, customAmount }: { 
      occurrenceId: number; 
      accountId: number; 
      date: string;
      createTransaction: boolean;
      affectBalance: boolean;
      customAmount?: string;
    }) => {
      const occurrence = occurrences.find(o => o.id === occurrenceId);
      if (!occurrence || !occurrence.scheduledPayment) {
        throw new Error('Payment not found');
      }

      const payment = occurrence.scheduledPayment;
      const affectTransaction = createTransaction;
      const affectAccountBalance = affectBalance;
      const finalAmount = customAmount || payment.amount;

      // Create transaction if affectTransaction is enabled
      if (affectTransaction) {
        await api.createTransaction({
          type: 'debit',
          amount: finalAmount,
          merchant: payment.name,
          description: `Scheduled payment: ${payment.name}`,
          categoryId: payment.categoryId || null,
          accountId,
          transactionDate: date,
          paymentOccurrenceId: occurrenceId,
        });

        // If transaction is created but should not affect balance, reverse the balance change
        if (!affectAccountBalance) {
          const account = accounts.find(a => a.id === accountId);
          if (account) {
            const newBalance = (parseFloat(account.balance) + parseFloat(finalAmount)).toString();
            await api.updateAccount(accountId, { balance: newBalance });
          }
        }
      } else if (!affectTransaction && affectAccountBalance) {
        // If no transaction but balance should be affected, update balance directly
        const account = accounts.find(a => a.id === accountId);
        if (account) {
          const newBalance = (parseFloat(account.balance) - parseFloat(finalAmount)).toString();
          await api.updateAccount(accountId, { balance: newBalance });
        }
      }

      // Update occurrence status and toggle settings
      await api.updatePaymentOccurrence(occurrenceId, {
        status: 'paid',
        affectTransaction,
        affectAccountBalance,
        ...(finalAmount && { paidAmount: finalAmount }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      refetchOccurrences();
      setShowPaymentModal(false);
      setSelectedOccurrence(null);
      setPaymentCreateTransaction(true);
      setPaymentAffectBalance(true);
      setPaymentAmount('');
      Toast.show({
        type: 'success',
        text1: 'Payment Recorded',
        text2: 'Transaction created and account updated',
        position: 'bottom',
      });
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Failed to Record Payment',
        text2: error instanceof Error ? error.message : 'Please try again',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'inactive' }) =>
      api.updateScheduledPayment(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-payments'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteScheduledPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      refetchPayments();
      refetchOccurrences();
      Toast.show({
        type: 'success',
        text1: 'Payment Deleted',
        text2: 'Scheduled payment has been removed',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: 'Could not delete payment. Please try again.',
        position: 'bottom',
      });
    },
  });

  const handleDelete = (payment: ScheduledPayment) => {
    setPaymentToDelete(payment);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (paymentToDelete) {
      // Close the swipeable before deleting
      if (currentOpenSwipeable.current !== null) {
        swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
        currentOpenSwipeable.current = null;
      }
      deleteMutation.mutate(paymentToDelete.id);
      setShowDeleteModal(false);
      setPaymentToDelete(null);
    }
  };

  const cancelDelete = () => {
    // Close the swipeable when canceling
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
    setShowDeleteModal(false);
    setPaymentToDelete(null);
  };

  const handleEdit = (payment: ScheduledPayment) => {
    // Close the swipeable before navigation
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
    navigation.navigate('AddScheduledPayment', { paymentId: payment.id });
  };

  const renderRightActionsManage = (payment: ScheduledPayment) => {
    const action = swipeSettings.rightAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(payment) : handleDelete(payment)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderLeftActionsManage = (payment: ScheduledPayment) => {
    const action = swipeSettings.leftAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(payment) : handleDelete(payment)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderPaymentCard = (payment: ScheduledPayment) => {
    const category = categories.find(c => c.id === payment.categoryId);
    const isActive = payment.status === 'active';
    const isWeb = Platform.OS === 'web';
    const showActionButtons = isWeb || !swipeSettings.enabled;

    const content = (
      <View
        style={[
          styles.paymentCard,
          { backgroundColor: colors.card },
          !isActive && styles.paymentCardInactive
        ]}
      >
        <View style={styles.paymentInfo}>
          <View style={styles.paymentHeader}>
            <Text style={[styles.paymentName, { color: colors.text }, !isActive && { color: colors.textMuted }]}>
              {payment.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {payment.paymentType === 'credit_card_bill' && (
                <View style={[styles.creditCardBadge, { backgroundColor: `${colors.primary}30` }]}>
                  <Ionicons name="card-outline" size={12} color={colors.primary} />
                  <Text style={[styles.creditCardBadgeText, { color: colors.primary }]}>Card Bill</Text>
                </View>
              )}
              <View style={[styles.frequencyBadge, { backgroundColor: `${colors.primary}20` }]}>
                <Text style={[styles.frequencyText, { color: colors.primary }]}>
                  {getFrequencyLabel(payment)}
                </Text>
              </View>
            </View>
          </View>
          <Text style={[styles.paymentDue, { color: colors.textMuted }]}>
            Due on {payment.dueDate}th
            {category && ` • ${category.name}`}
          </Text>
          {payment.notes && (
            <Text style={[styles.paymentNotes, { color: colors.textMuted }]}>{payment.notes}</Text>
          )}
        </View>
        <View style={styles.paymentRight}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.paymentAmount, { color: colors.text }, !isActive && { color: colors.textMuted }]}>
              {payment.paymentType === 'credit_card_bill' ? formatCurrency(0) : (payment.amount ? formatCurrency(parseFloat(payment.amount)) : '—')}
            </Text>
            {payment.paymentType === 'credit_card_bill' && !payment.amount && (
              <View style={[styles.autoCalcBadge, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="calculator-outline" size={10} color={colors.primary} />
                <Text style={[styles.autoCalcBadgeText, { color: colors.primary }]}>Auto-calc</Text>
              </View>
            )}
          </View>
          <Switch
            value={isActive}
            onValueChange={() => toggleStatus(payment)}
            trackColor={{ false: colors.border, true: `${colors.primary}80` }}
            thumbColor={isActive ? colors.primary : colors.textMuted}
          />
        </View>
        {showActionButtons && (
          <View style={styles.webActions}>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleEdit(payment)}
            >
              <Ionicons name="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => handleDelete(payment)}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );

    // Disable swipe on web as react-native-gesture-handler doesn't support it
    const isSwipeEnabled = swipeSettings.enabled && Platform.OS !== 'web';
    
    if (isSwipeEnabled) {
      return (
        <Swipeable
          key={payment.id}
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(payment.id, ref);
            } else {
              swipeableRefs.current.delete(payment.id);
            }
          }}
          renderRightActions={() => renderRightActionsManage(payment)}
          renderLeftActions={() => renderLeftActionsManage(payment)}
          onSwipeableOpen={() => {
            // Close previously opened swipeable
            if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== payment.id) {
              swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
            }
            currentOpenSwipeable.current = payment.id;
          }}
        >
          {content}
        </Swipeable>
      );
    }

    return <View key={payment.id}>{content}</View>;
  };

  const toggleStatus = (payment: ScheduledPayment) => {
    updateMutation.mutate({
      id: payment.id,
      status: payment.status === 'active' ? 'inactive' : 'active',
    });
  };

  const goToPreviousCycle = () => {
    if (cycleData?.prevAnchor) {
      setCycleAnchor(new Date(cycleData.prevAnchor));
    }
  };

  const goToNextCycle = () => {
    if (cycleData?.nextAnchor) {
      setCycleAnchor(new Date(cycleData.nextAnchor));
    }
  };

  const handleMarkAsPaid = (occurrence: PaymentOccurrence) => {
    setSelectedOccurrence(occurrence);
    setPaymentDate(new Date());
    
    // Initialize amount for credit card bills (editable)
    setPaymentAmount(occurrence.scheduledPayment?.amount || '');
    
    // If the scheduled payment has an account assigned, use that account
    // Otherwise, use the first available account or default account
    if (occurrence.scheduledPayment?.accountId) {
      setSelectedAccountId(occurrence.scheduledPayment.accountId);
    } else {
      const defaultAccount = accounts.find(acc => acc.isDefault);
      setSelectedAccountId(defaultAccount?.id || (accounts.length > 0 ? accounts[0].id : null));
    }
    
    // Initialize toggle states from the scheduled payment settings
    setPaymentCreateTransaction(occurrence.scheduledPayment?.affectTransaction ?? true);
    setPaymentAffectBalance(occurrence.scheduledPayment?.affectAccountBalance ?? true);
    
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = () => {
    if (!selectedOccurrence || !selectedAccountId) {
      Toast.show({
        type: 'error',
        text1: 'Missing Information',
        text2: 'Please select an account',
        position: 'bottom',
      });
      return;
    }

    const isCreditCardBill = selectedOccurrence.scheduledPayment?.paymentType === 'credit_card_bill';
    const isVariableAmount = !!selectedOccurrence.scheduledPayment?.variableAmount;

    if (isVariableAmount && (!paymentAmount || parseFloat(paymentAmount) <= 0)) {
      Toast.show({
        type: 'error',
        text1: 'Amount Required',
        text2: 'Enter this cycle\'s bill amount before marking it paid',
        position: 'bottom',
      });
      return;
    }

    markAsPaidMutation.mutate({
      occurrenceId: selectedOccurrence.id,
      accountId: selectedAccountId,
      date: paymentDate.toISOString(),
      createTransaction: paymentCreateTransaction,
      affectBalance: paymentAffectBalance,
      customAmount: (isCreditCardBill || isVariableAmount) && paymentAmount ? paymentAmount : undefined,
    });
  };

  const activePayments = payments?.filter(p => p.status === 'active') || [];
  const totalMonthly = activePayments.reduce((sum, p) => sum + (p.amount ? parseFloat(p.amount) : 0), 0);
  
  const paidOccurrences = occurrences.filter(o => o.status === 'paid');
  const pendingOccurrences = occurrences.filter(o => o.status === 'pending');
  const totalPaid = paidOccurrences.reduce((sum, o) => {
    if (o.scheduledPayment?.paymentType === 'credit_card_bill' && billingAmounts[o.scheduledPayment?.id]) {
      return sum + parseFloat(billingAmounts[o.scheduledPayment.id].amount);
    }
    return sum + parseFloat(o.scheduledPayment?.amount || '0');
  }, 0);
  const totalPending = pendingOccurrences.reduce((sum, o) => {
    if (o.scheduledPayment?.paymentType === 'credit_card_bill' && billingAmounts[o.scheduledPayment?.id]) {
      return sum + parseFloat(billingAmounts[o.scheduledPayment.id].amount);
    }
    return sum + parseFloat(o.scheduledPayment?.amount || '0');
  }, 0);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      
      {/* Tabs */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'checklist' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('checklist')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'checklist' ? colors.primary : colors.textMuted }]}>
            {cycleData?.isSalaryCycle ? 'This Cycle' : 'This Month'} ({activePayments.length}) active
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'manage' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('manage')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'manage' ? colors.primary : colors.textMuted }]}>
            All Payments
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {activeTab === 'checklist' ? (
          <View style={styles.tabContent}>
            {/* Month Navigation */}
            <View style={styles.monthNav}>
              <TouchableOpacity onPress={goToPreviousCycle} style={styles.monthNavButton}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.monthText, { color: colors.text }]}>
                {cycleData?.cycleLabel ?? ''}
              </Text>
              <TouchableOpacity onPress={goToNextCycle} style={styles.monthNavButton}>
                <Ionicons name="chevron-forward" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Summary Cards */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: '#dcfce7', borderColor: '#86efac' }]}>
                <Text style={styles.summaryLabel}>Paid</Text>
                <Text style={[styles.summaryValue, { color: '#16a34a' }]}>
                  {formatCurrency(totalPaid)}
                </Text>
                <Text style={styles.summaryCount}>{paidOccurrences.length} items</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#fed7aa', borderColor: '#fdba74' }]}>
                <Text style={styles.summaryLabel}>Pending</Text>
                <Text style={[styles.summaryValue, { color: '#ea580c' }]}>
                  {formatCurrency(totalPending)}
                </Text>
                <Text style={styles.summaryCount}>{pendingOccurrences.length} items</Text>
              </View>
            </View>

            {/* Checklist */}
            {occurrences.length === 0 ? (
              isCyclePending ? (
                // A genuinely fresh (never-yet-loaded) cycle is still in flight — there's no
                // previous cycle's data to fall back on via placeholderData, so show a loading
                // state instead of a false "No payments due" empty state. This does NOT fire
                // during ordinary in-place refetches (e.g. after marking something paid) since
                // those reuse the same query key and already have data, so isPending is false.
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                  <Ionicons name="time-outline" size={48} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { color: colors.text }]}>
                    No payments due {cycleData?.isSalaryCycle ? 'this cycle' : 'this month'}
                  </Text>
                  <TouchableOpacity
                    style={[styles.generateButton, { borderColor: colors.border }]}
                    onPress={() => refetchOccurrences()}
                  >
                    <Text style={[styles.generateButtonText, { color: colors.text }]}>Refresh</Text>
                  </TouchableOpacity>
                </View>
              )
            ) : (
              occurrences.map((occurrence) => {
                const payment = occurrence.scheduledPayment;
                const isPaid = occurrence.status === 'paid';
                const category = categories.find(c => c.id === payment?.categoryId);
                const dueDate = new Date(occurrence.dueDate);
                const isPastDue = !isPaid && dueDate < new Date();

                return (
                  <View 
                    key={occurrence.id} 
                    style={[
                      styles.checklistItem, 
                      { backgroundColor: colors.card },
                      isPaid && styles.checklistItemPaid,
                      isPastDue && { borderColor: '#ef4444', borderWidth: 1 }
                    ]}
                  >
                    <TouchableOpacity
                      onPress={() => {
                        if (isPaid) {
                          updateOccurrenceMutation.mutate({
                            id: occurrence.id,
                            status: 'pending',
                            occurrence: occurrence,
                          });
                        } else {
                          handleMarkAsPaid(occurrence);
                        }
                      }}
                      style={styles.checkbox}
                      disabled={updateOccurrenceMutation.isPending}
                    >
                      <View style={[
                        styles.checkboxInner,
                        { borderColor: colors.border },
                        isPaid && { backgroundColor: colors.primary, borderColor: colors.primary }
                      ]}>
                        {isPaid && <Ionicons name="checkmark" size={18} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                    <View style={styles.checklistInfo}>
                      <View style={styles.checklistHeader}>
                        <Text style={[
                          styles.checklistName, 
                          { color: colors.text },
                          isPaid && { textDecorationLine: 'line-through', color: colors.textMuted }
                        ]}>
                          {payment?.name}
                        </Text>
                        {isPastDue && (
                          <View style={styles.overdueBadge}>
                            <Text style={styles.overdueText}>Overdue</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.checklistDue, { color: colors.textMuted }]}>
                        Due {dueDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                        {category && ` • ${category.name}`}
                        {payment?.frequency && payment.frequency !== 'monthly' && (
                          <Text style={{ color: colors.primary }}>
                            {' '}• {getFrequencyLabel(payment)}
                          </Text>
                        )}
                      </Text>
                      {/* New Impact Indicators */}
                      <View style={styles.impactContainer}>
                        {payment?.affectAccountBalance && (
                          <View style={[styles.impactBadge, { backgroundColor: colors.primary + '15' }]}>
                            <Ionicons name="wallet-outline" size={12} color={colors.primary} />
                            <Text style={[styles.impactText, { color: colors.primary }]}>Updates Balance</Text>
                          </View>
                        )}
                        
                        {payment?.affectTransaction && (
                          <View style={[styles.impactBadge, { backgroundColor: colors.textMuted + '15' }]}>
                            <Ionicons name="receipt-outline" size={12} color={colors.textMuted} />
                            <Text style={[styles.impactText, { color: colors.textMuted }]}>Creates Txn</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.amountContainer}>
                      <Text style={[
                        styles.checklistAmount, 
                        { color: isPaid ? colors.textMuted : '#ef4444' }
                      ]}>
                        {formatCurrency(parseFloat(
                          (occurrence.paidAmount && parseFloat(occurrence.paidAmount) > 0) 
                            ? occurrence.paidAmount 
                            : (payment?.paymentType === 'credit_card_bill' && billingAmounts[payment?.id]?.amount 
                              ? billingAmounts[payment?.id].amount 
                              : payment?.amount || '0')
                        ))}
                      </Text>
                      {payment?.paymentType === 'credit_card_bill' && billingAmounts[payment?.id]?.cycleLabel && (
                        <View style={[styles.cycleBadge, { backgroundColor: colors.primary + '15' }]}>
                          <Text style={[styles.cycleBadgeText, { color: colors.primary }]}>
                            {billingAmounts[payment.id].cycleLabel}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <View style={styles.tabContent}>
            {/* Total Card */}
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total Monthly Commitment</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalMonthly)}</Text>
            </View>

            {/* Payments List */}
            {payments && payments.length > 0 ? (
              payments.map((payment) => renderPaymentCard(payment))
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
                <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.text }]}>No scheduled payments yet</Text>
                <TouchableOpacity
                  style={[styles.addFirstButton, { backgroundColor: colors.primary }]}
                  onPress={() => navigation.navigate('AddScheduledPayment')}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                  <Text style={styles.addFirstButtonText}>Add Your First Payment</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Payment Confirmation Modal */}
      <Modal
        visible={showPaymentModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowPaymentModal(false);
          setPaymentCreateTransaction(true);
          setPaymentAffectBalance(true);
          setPaymentAmount('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Record Payment</Text>
              <TouchableOpacity onPress={() => {
                setShowPaymentModal(false);
                setPaymentCreateTransaction(true);
                setPaymentAffectBalance(true);
                setPaymentAmount('');
              }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={[styles.paymentModalLabel, { color: colors.textMuted }]}>Payment Details</Text>
              <Text style={[styles.paymentModalName, { color: colors.text }]}>
                {selectedOccurrence?.scheduledPayment?.name}
              </Text>
              
              {selectedOccurrence?.scheduledPayment?.paymentType === 'credit_card_bill' || selectedOccurrence?.scheduledPayment?.variableAmount ? (
                <View style={styles.modalField}>
                  <Text style={[styles.modalFieldLabel, { color: colors.textMuted }]}>
                    {selectedOccurrence?.scheduledPayment?.variableAmount ? "This cycle's amount" : 'Amount (Editable)'}
                  </Text>
                  <View style={[styles.amountInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.currencySymbol, { color: colors.primary }]}>₹</Text>
                    <TextInput
                      style={[styles.amountInput, { color: colors.text }]}
                      value={paymentAmount}
                      onChangeText={setPaymentAmount}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                </View>
              ) : (
                <Text style={[styles.paymentModalAmount, { color: colors.primary }]}>
                  {formatCurrency(parseFloat(selectedOccurrence?.scheduledPayment?.amount || '0'))}
                </Text>
              )}

              <View style={styles.modalField}>
                <Text style={[styles.modalFieldLabel, { color: colors.textMuted }]}>Payment Date</Text>
                <TouchableOpacity 
                  style={[styles.dateButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
                  <Text style={[styles.dateButtonText, { color: colors.text }]}>
                    {paymentDate.toLocaleDateString('en-US', { 
                      day: 'numeric', 
                      month: 'short', 
                      year: 'numeric' 
                    })}
                  </Text>
                </TouchableOpacity>
              </View>

              {showDatePicker && (
                <DateTimePicker
                  value={paymentDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(Platform.OS === 'ios');
                    if (selectedDate) {
                      setPaymentDate(selectedDate);
                    }
                  }}
                  maximumDate={new Date()}
                  themeVariant={resolvedTheme}
                />
              )}

              <View style={styles.modalField}>
                <Text style={[styles.modalFieldLabel, { color: colors.textMuted }]}>
                  Pay From Account
                  {selectedOccurrence?.scheduledPayment?.accountId && (
                    <Text style={{ fontSize: 12, fontStyle: 'italic' }}> (Pre-assigned)</Text>
                  )}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.accountRow}>
                    {accounts.map((account) => {
                      const isPreAssigned = selectedOccurrence?.scheduledPayment?.accountId === account.id;
                      const isDisabled = selectedOccurrence?.scheduledPayment?.accountId && !isPreAssigned;
                      
                      return (
                        <TouchableOpacity
                          key={account.id}
                          style={[
                            styles.accountChip,
                            { backgroundColor: colors.card, borderColor: colors.border },
                            selectedAccountId === account.id && { backgroundColor: colors.primary, borderColor: colors.primary },
                            isDisabled ? { opacity: 0.4 } : undefined
                          ]}
                          onPress={() => {
                            // Only allow selection if not pre-assigned or if it's the pre-assigned account
                            if (!isDisabled) {
                              setSelectedAccountId(account.id);
                            }
                          }}
                          disabled={!!isDisabled}
                        >
                          <Ionicons 
                            name={account.type === 'bank' ? 'business-outline' : 'card-outline'} 
                            size={16} 
                            color={selectedAccountId === account.id ? '#fff' : colors.textMuted}
                            style={{ marginRight: 6 }}
                          />
                          <Text style={[
                            styles.accountChipText,
                            { color: colors.text },
                            selectedAccountId === account.id && { color: '#fff' }
                          ]}>
                            {account.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
                  <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                    Record this payment as a transaction
                  </Text>
                </View>
                <Switch
                  value={paymentCreateTransaction}
                  onValueChange={setPaymentCreateTransaction}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={[styles.toggleLabel, { color: colors.text }]}>Affect Account Balance</Text>
                  <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                    Deduct from selected account balance
                  </Text>
                </View>
                <Switch
                  value={paymentAffectBalance}
                  onValueChange={setPaymentAffectBalance}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  disabled={!selectedAccountId}
                />
              </View>

              <Text style={[styles.toggleNote, { color: colors.textMuted }]}>
                These settings apply to this payment only
              </Text>

              <TouchableOpacity 
                style={[styles.confirmButton, { backgroundColor: colors.primary }, markAsPaidMutation.isPending && styles.confirmButtonDisabled]} 
                onPress={handleConfirmPayment}
                disabled={markAsPaidMutation.isPending}
              >
                {markAsPaidMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirm Payment</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('AddScheduledPayment')}
        activeOpacity={0.8}
        accessibilityLabel="Add new scheduled payment"
        accessibilityRole="button"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.deleteModalOverlay}>
          <View style={[styles.deleteModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.deleteModalHeader}>
              <Ionicons name="warning-outline" size={48} color="#ef4444" />
            </View>
            <Text style={[styles.deleteModalTitle, { color: colors.text }]}>Delete Payment?</Text>
            <Text style={[styles.deleteModalMessage, { color: colors.textMuted }]}>
              Are you sure you want to delete "{paymentToDelete?.name}"? This action cannot be undone.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { borderColor: colors.border }]}
                onPress={cancelDelete}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.deleteButton]}
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  tabContent: {
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthNavButton: {
    padding: 8,
  },
  monthText: {
    fontSize: 16,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  summaryCount: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  checklistItem: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    alignItems: 'center',
    gap: 12,
  },
  checklistItemPaid: {
    opacity: 0.6,
  },
  checkbox: {
    padding: 4,
  },
  checkboxInner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checklistInfo: {
    flex: 1,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  checklistName: {
    fontSize: 15,
    fontWeight: '500',
  },
  overdueBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  overdueText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  checklistDue: {
    fontSize: 12,
    marginTop: 2,
  },
  checklistAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  amountContainer: {
    alignItems: 'flex-end',
    gap: 4,
  },
  cycleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cycleBadgeText: {
    fontSize: 9,
    fontWeight: '600',
  },
  totalCard: {
    backgroundColor: '#f97316',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 13,
    color: '#fff',
    opacity: 0.9,
  },
  totalValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 4,
  },
  paymentCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  paymentCardInactive: {
    opacity: 0.6,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  paymentName: {
    fontSize: 15,
    fontWeight: '500',
  },
  frequencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  frequencyText: {
    fontSize: 11,
    fontWeight: '500',
  },
  creditCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  creditCardBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  autoCalcBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  autoCalcBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  paymentDue: {
    fontSize: 12,
    marginTop: 4,
  },
  paymentNotes: {
    fontSize: 12,
    marginTop: 4,
  },
  paymentRight: {
    alignItems: 'flex-end',
    gap: 8,
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  paymentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editButton: {
    padding: 8,
    marginLeft: 4,
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  webActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 8,
  },
  webActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 16,
  },
  generateButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  generateButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  addFirstButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  addFirstButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalBody: {
    padding: 20,
  },
  paymentModalLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  paymentModalName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  paymentModalAmount: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 24,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  currencySymbol: {
    fontSize: 20,
    fontWeight: '600',
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    padding: 0,
  },
  modalField: {
    marginBottom: 20,
  },
  modalFieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  dateButtonText: {
    fontSize: 15,
  },
  accountRow: {
    flexDirection: 'row',
    gap: 8,
  },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  accountChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  confirmButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  confirmButtonDisabled: {
    opacity: 0.7,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  toggleHint: {
    fontSize: 12,
  },
  toggleNote: {
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  deleteModalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  deleteModalHeader: {
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  impactContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4, // Space below the due date line
    flexWrap: 'wrap',
  },
  impactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  impactText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  checklistInfoRow: {
    // Container for your text block
  },
});
