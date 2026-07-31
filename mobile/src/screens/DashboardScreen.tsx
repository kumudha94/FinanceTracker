import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, LayoutAnimation, Platform, UIManager, Modal, Alert } from 'react-native';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigation, CompositeNavigationProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { RootStackParamList, TabParamList } from '../../App';
import { FABButton } from '../components/FABButton';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { BillItem, NextMonthForecast, NextMonthForecastItem, ForecastItemType } from '../lib/types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type ActiveTab = 'income' | 'expense' | 'bills';
type BillsAccordion = 'scheduled' | 'creditCard' | 'loans' | 'insurance' | 'billsInbox' | null;
type ForecastAccordion = 'scheduled' | 'insurance' | 'loans' | 'creditCard' | 'savings' | null;

const LOADING_MESSAGES = [
  'Setting up your current month finances…',
  'Thinking about next cycle plans…',
  'Fetching your last 5 transactions…',
  'Adding up scheduled payments, EMIs, and premiums…',
  'Almost there…',
];
const LOADING_MESSAGE_INTERVAL_MS = 2000;

export default function DashboardScreen() {
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const { username } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('income');
  const [billsAccordion, setBillsAccordion] = useState<BillsAccordion>(null);
  const [forecastAccordion, setForecastAccordion] = useState<ForecastAccordion>(null);
  const [hideBalance, setHideBalance] = useState(true);
  const [showCycleInfoModal, setShowCycleInfoModal] = useState(false);

  const { data: summary, isLoading } = useQuery({
    queryKey: ['/api/dashboard-summary'],
    queryFn: api.getDashboardSummary,
  });

  const { data: savingsGoals } = useQuery({
    queryKey: ['/api/savings-goals'],
    queryFn: api.getSavingsGoals,
  });

  const { data: forecast } = useQuery({
    queryKey: ['/api/next-month-forecast'],
    queryFn: api.getNextMonthForecast,
  });

  const { data: salaryProfile } = useQuery({
    queryKey: ['/api/salary-profile'],
    queryFn: api.getSalaryProfile,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const { data: pendingInstitutionMappings = [] } = useQuery({
    queryKey: ['/api/institution-mappings/pending'],
    queryFn: api.getPendingInstitutionMappings,
  });

  const { data: pendingBillMappings = [] } = useQuery({
    queryKey: ['/api/bill-mappings/pending'],
    queryFn: api.getPendingBillMappings,
  });

  const dismissBillMappingMutation = useMutation({
    mutationFn: (mappingId: number) => api.ignoreBillMapping(mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
    },
  });

  const toggleExclusionMutation = useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: ForecastItemType; itemId: number | string }) =>
      api.toggleForecastExclusion(itemType, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
    },
  });

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/next-month-forecast'] });
      queryClient.invalidateQueries({ queryKey: ['/api/salary-profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/savings-goals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    }, [queryClient])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['/api/dashboard-summary'] }),
      queryClient.refetchQueries({ queryKey: ['/api/next-month-forecast'] }),
      queryClient.refetchQueries({ queryKey: ['/api/savings-goals'] }),
      queryClient.refetchQueries({ queryKey: ['/api/institution-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/bill-mappings/pending'] }),
      queryClient.refetchQueries({ queryKey: ['/api/accounts'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const switchTab = useCallback((tab: ActiveTab) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(tab);
    if (tab !== 'bills') setBillsAccordion(null);
  }, []);

  const toggleBillsAccordion = useCallback((section: BillsAccordion) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBillsAccordion(prev => prev === section ? null : section);
  }, []);

  const toggleForecastAccordion = useCallback((section: ForecastAccordion) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setForecastAccordion(prev => prev === section ? null : section);
  }, []);

  const activeGoals = useMemo(() => savingsGoals?.filter(g => g.status === 'active') || [], [savingsGoals]);
  const monthlyExpectedSavings = useMemo(() => activeGoals.reduce((acc, goal) => acc + parseFloat(goal.monthlyExpectedAmount || "0"), 0), [activeGoals]);
  const savedThisCycle = summary?.savedThisCycle ?? 0;

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, LOADING_MESSAGE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isLoading]);

  if (isLoading || !summary) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            {LOADING_MESSAGES[loadingMessageIndex]}
          </Text>
          <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>
            My Tracker is putting your cycle together
          </Text>
        </View>
      </View>
    );
  }

  const netBalance = summary.totalIncome - summary.totalSpent;
  const spendRatio = summary.totalIncome > 0 ? summary.totalSpent / summary.totalIncome : 0;

  const getOrdinalSuffix = (day: number) => {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  const getLoanTypeLabel = (type?: string) => {
    switch (type) {
      case 'home_loan': return 'Home Loan';
      case 'personal_loan': return 'Personal Loan';
      case 'credit_card_loan': return 'CC Loan';
      case 'item_emi': return 'Item EMI';
      default: return 'Loan';
    }
  };

  const getInsuranceTypeLabel = (type?: string) => {
    switch (type) {
      case 'health': return 'Health';
      case 'life': return 'Life';
      case 'vehicle': return 'Vehicle';
      case 'home': return 'Home';
      case 'term': return 'Term';
      case 'travel': return 'Travel';
      default: return 'Insurance';
    }
  };

  const maskValue = (val: string) => hideBalance ? '\u2022\u2022\u2022\u2022\u2022\u2022' : val;

  const renderBillItem = (bill: BillItem, showSubLabel?: string) => {
    const statusColor = bill.isPaid ? '#10b981' : bill.status === 'overdue' ? '#ef4444' : bill.status === 'due_today' ? '#3b82f6' : '#f59e0b';
    const statusIcon: keyof typeof Ionicons.glyphMap = bill.isPaid ? 'checkmark-circle' : bill.status === 'overdue' ? 'alert-circle' : bill.status === 'due_today' ? 'today' : 'time';
    const statusText = bill.isPaid ? 'Paid' : bill.status === 'overdue' ? 'Overdue' : bill.status === 'due_today' ? 'Due Today' : 'Pending';

    return (
      <View key={`bill-${bill.id}-${showSubLabel}`} style={[styles.billDetailRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.billStatusDot, { backgroundColor: statusColor }]} />
        <View style={styles.billDetailInfo}>
          <Text style={[styles.billDetailName, { color: colors.text }]} numberOfLines={1}>{bill.name}</Text>
          <View style={styles.billMetaRow}>
            {showSubLabel ? (
              <Text style={[styles.billSubLabel, { color: colors.textMuted }]}>{showSubLabel}</Text>
            ) : null}
            {bill.dueDate ? (
              <Text style={[styles.billDueText, { color: colors.textMuted }]}>
                Due: {bill.dueDate}{getOrdinalSuffix(bill.dueDate)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.billDetailRight}>
          <Text style={[styles.billDetailAmt, { color: colors.text }]}>
            {formatCurrency(bill.amount)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <Ionicons name={statusIcon} size={10} color={statusColor} />
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {statusText}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderAccordionSection = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    iconColor: string,
    sectionKey: BillsAccordion,
    items: BillItem[],
    subLabelFn?: (item: BillItem) => string,
  ) => {
    const isOpen = billsAccordion === sectionKey;
    const paidCount = items.filter(b => b.isPaid).length;
    const totalAmount = items.reduce((s, b) => s + b.amount, 0);
    const pendingAmount = items.filter(b => !b.isPaid).reduce((s, b) => s + b.amount, 0);

    if (items.length === 0) return null;

    return (
      <View key={sectionKey}>
        <TouchableOpacity
          style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
          onPress={() => toggleBillsAccordion(sectionKey)}
          activeOpacity={0.7}
        >
          <View style={[styles.accordionIconWrap, { backgroundColor: iconColor + '15' }]}>
            <Ionicons name={icon} size={16} color={iconColor} />
          </View>
          <View style={styles.accordionTitleArea}>
            <Text style={[styles.accordionTitle, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>
              {paidCount}/{items.length} paid{pendingAmount > 0 ? ` \u00B7 ${formatCurrency(pendingAmount)} pending` : ''}
            </Text>
          </View>
          <View style={styles.accordionRight}>
            <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(totalAmount)}</Text>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        {isOpen && (
          <View style={styles.accordionContent}>
            {items.map(item => renderBillItem(item, subLabelFn ? subLabelFn(item) : undefined))}
          </View>
        )}
      </View>
    );
  };

  const handleDismissBillMapping = (mapping: { id: number; suggestedName: string | null; institutionKey: string }) => {
    Alert.alert(
      'Dismiss this sender?',
      `Future due-reminder SMS from "${mapping.suggestedName || mapping.institutionKey}" will be logged but never surfaced again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', style: 'destructive', onPress: () => dismissBillMappingMutation.mutate(mapping.id) },
      ]
    );
  };

  const renderForecastRow = (item: NextMonthForecastItem, itemType: ForecastItemType, dotColor: string, keyPrefix: string, metaText?: string) => (
    <View key={`${keyPrefix}-${item.id}`} style={[styles.forecastRow, { borderBottomColor: colors.border }, item.excluded && { opacity: 0.5 }]}>
      <View style={[styles.forecastDot, { backgroundColor: dotColor }]} />
      <View style={styles.forecastRowInfo}>
        <Text style={[styles.forecastRowName, { color: colors.text }, item.excluded && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.forecastRowMeta, { color: colors.textMuted }]}>
          {metaText ?? `${item.subLabel || ''}${item.dueDate ? ` · Due: ${item.dueDate}${getOrdinalSuffix(item.dueDate)}` : ''}`}
        </Text>
      </View>
      <Text style={[styles.forecastRowAmt, { color: item.excluded ? colors.textMuted : '#ef4444' }]}>
        -{formatCurrency(item.amount)}
      </Text>
      <TouchableOpacity
        onPress={() => toggleExclusionMutation.mutate({ itemType, itemId: item.id })}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.forecastToggleBtn}
      >
        <Ionicons
          name={item.excluded ? 'add-circle' : 'remove-circle'}
          size={20}
          color={item.excluded ? '#10b981' : colors.textMuted}
        />
      </TouchableOpacity>
    </View>
  );

  const renderBillsInboxSection = () => {
    if (pendingBillMappings.length === 0) return null;
    const isOpen = billsAccordion === 'billsInbox';

    return (
      <View>
        <TouchableOpacity
          style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
          onPress={() => toggleBillsAccordion('billsInbox')}
          activeOpacity={0.7}
        >
          <View style={[styles.accordionIconWrap, { backgroundColor: '#14b8a615' }]}>
            <Ionicons name="file-tray-full-outline" size={16} color="#14b8a6" />
          </View>
          <View style={styles.accordionTitleArea}>
            <Text style={[styles.accordionTitle, { color: colors.text }]}>Bills Inbox</Text>
            <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>
              {pendingBillMappings.length} need{pendingBillMappings.length === 1 ? 's' : ''} review
            </Text>
          </View>
          <View style={styles.accordionRight}>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        {isOpen && (
          <View style={styles.accordionContent}>
            {pendingBillMappings.map((mapping) => (
              <TouchableOpacity
                key={`bill-mapping-${mapping.id}`}
                style={[styles.billDetailRow, { borderBottomColor: colors.border }]}
                onPress={() => navigation.navigate('BillsInbox')}
                activeOpacity={0.7}
              >
                <View style={[styles.billStatusDot, { backgroundColor: '#14b8a6' }]} />
                <View style={styles.billDetailInfo}>
                  <Text style={[styles.billDetailName, { color: colors.text }]} numberOfLines={1}>
                    {mapping.suggestedName || mapping.institutionKey}
                  </Text>
                  <View style={styles.billMetaRow}>
                    <Text style={[styles.billSubLabel, { color: colors.textMuted }]}>
                      {mapping.latestAmount != null ? formatCurrency(mapping.latestAmount) : 'Amount unknown'}
                      {mapping.latestDueDate ? ` · Due ${format(new Date(mapping.latestDueDate), 'd MMM')}` : ''}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.dismissBtn}
                  onPress={() => handleDismissBillMapping(mapping)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle-outline" size={20} color="#ef4444" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  const { billsDueDetails } = summary;
  const totalBillsCount =
    (billsDueDetails?.scheduledPayments?.length || 0) +
    (billsDueDetails?.creditCardBills?.length || 0) +
    (billsDueDetails?.loans?.length || 0) +
    (billsDueDetails?.insurance?.length || 0);
  const totalPaidCount =
    (billsDueDetails?.scheduledPayments?.filter((b: BillItem) => b.isPaid).length || 0) +
    (billsDueDetails?.creditCardBills?.filter((b: BillItem) => b.isPaid).length || 0) +
    (billsDueDetails?.loans?.filter((b: BillItem) => b.isPaid).length || 0) +
    (billsDueDetails?.insurance?.filter((b: BillItem) => b.isPaid).length || 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== MAIN CARD ===== */}
        <View style={[styles.mainCard, { backgroundColor: colors.card }]}>
          {/* Main Card Header: Welcome + cycle badge + settings */}
          <View style={styles.mainCardHeader}>
            <View style={styles.mainCardHeaderLeft}>
              <Text style={[styles.greeting, { color: colors.textMuted }]}>Welcome back,</Text>
              <Text style={[styles.username, { color: colors.text }]}>{username || 'User'}</Text>
            </View>
            <View style={styles.mainCardHeaderRight}>
              <TouchableOpacity
                onPress={() => setShowCycleInfoModal(true)}
                style={[styles.cycleBadge, { backgroundColor: colors.primary + '18' }]}
                activeOpacity={0.7}
                data-testid="button-cycle-info"
              >
                <Text style={[styles.cycleBadgeText, { color: colors.primary }]}>{summary.monthLabel}</Text>
                <Ionicons name="information-circle-outline" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.settingsBtn} data-testid="button-settings">
                <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {accounts.length > 0 ? (
          <>
          {!salaryProfile && (
            <TouchableOpacity
              style={[styles.salaryBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b40' }]}
              onPress={() => navigation.navigate('Salary')}
              activeOpacity={0.7}
              data-testid="button-setup-salary"
            >
              <View style={styles.salaryBannerLeft}>
                <View style={[styles.salaryBannerIcon, { backgroundColor: '#f59e0b25' }]}>
                  <Ionicons name="wallet-outline" size={20} color="#f59e0b" />
                </View>
                <View style={styles.salaryBannerText}>
                  <Text style={[styles.salaryBannerTitle, { color: colors.text }]}>Set up Salary Profile</Text>
                  <Text style={[styles.salaryBannerSub, { color: colors.textMuted }]}>Track your income and plan finances better</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#f59e0b" />
            </TouchableOpacity>
          )}

          {pendingInstitutionMappings.length > 0 && (
            <TouchableOpacity
              style={[styles.salaryBanner, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b40' }]}
              onPress={() => navigation.navigate('InstitutionMappings')}
              activeOpacity={0.7}
              data-testid="button-new-accounts-detected"
            >
              <View style={styles.salaryBannerLeft}>
                <View style={[styles.salaryBannerIcon, { backgroundColor: '#f59e0b25' }]}>
                  <Ionicons name="help-buoy-outline" size={20} color="#f59e0b" />
                </View>
                <View style={styles.salaryBannerText}>
                  <Text style={[styles.salaryBannerTitle, { color: colors.text }]}>New Accounts Detected</Text>
                  <Text style={[styles.salaryBannerSub, { color: colors.textMuted }]}>
                    {pendingInstitutionMappings.length} sender{pendingInstitutionMappings.length === 1 ? '' : 's'} need{pendingInstitutionMappings.length === 1 ? 's' : ''} to be mapped
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#f59e0b" />
            </TouchableOpacity>
          )}

          {/* Net Balance with eye toggle */}
          <View style={styles.netBalanceSection}>
            <View style={styles.netBalanceLabelRow}>
              <Text style={[styles.netBalanceLabel, { color: colors.textMuted }]}>Net Balance</Text>
              <TouchableOpacity onPress={() => setHideBalance(!hideBalance)} style={styles.eyeBtn} data-testid="button-toggle-balance">
                <Ionicons name={hideBalance ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.netBalanceValue, { color: netBalance >= 0 ? '#10b981' : '#ef4444' }]} data-testid="text-net-balance">
              {hideBalance ? '\u2022\u2022\u2022\u2022\u2022\u2022' : `${netBalance >= 0 ? '+' : ''}${formatCurrency(netBalance)}`}
            </Text>
            {!hideBalance && summary.totalIncome > 0 && (
              <View style={styles.spendBarWrap}>
                <View style={[styles.spendBarBg, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.spendBarFill,
                      {
                        width: `${Math.min(spendRatio * 100, 100)}%`,
                        backgroundColor: spendRatio > 0.8 ? '#ef4444' : spendRatio > 0.6 ? '#f59e0b' : '#10b981',
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.spendBarLabel, { color: colors.textMuted }]}>
                  {Math.round(spendRatio * 100)}% spent - Today: {formatCurrency(summary.totalSpentToday)}
                </Text>
              </View>
            )}
          </View>

          {/* ===== SUB CARD with TABS ===== */}
          <View style={[styles.subCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {/* Tab Bar */}
            <View style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'income' && styles.activeTab]}
                onPress={() => switchTab('income')}
                data-testid="button-tab-income"
              >
                <Text style={[styles.tabText, { color: activeTab === 'income' ? colors.text : colors.textMuted }, activeTab === 'income' && styles.activeTabText]}>
                  Income
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'expense' && styles.activeTab]}
                onPress={() => switchTab('expense')}
                data-testid="button-tab-expense"
              >
                <Text style={[styles.tabText, { color: activeTab === 'expense' ? colors.text : colors.textMuted }, activeTab === 'expense' && styles.activeTabText]}>
                  Expense
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'bills' && styles.activeTab]}
                onPress={() => switchTab('bills')}
                data-testid="button-tab-bills"
              >
                <Text style={[styles.tabText, { color: activeTab === 'bills' ? colors.text : colors.textMuted }, activeTab === 'bills' && styles.activeTabText]}>
                  Bills
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'savings' && styles.activeTab]}
                onPress={() => switchTab('savings' as any)}
                data-testid="button-tab-savings"
              >
                <Text style={[styles.tabText, { color: activeTab === 'savings' ? colors.text : colors.textMuted }, activeTab === 'savings' && styles.activeTabText]}>
                  Savings
                </Text>
              </TouchableOpacity>
            </View>

            {/* Tab Content */}
            <View style={styles.tabContent}>
              {activeTab === 'income' && (
                <View style={styles.tabInner}>
                  <View style={styles.tabSummaryRow}>
                    <Text style={[styles.tabSummaryLabel, { color: colors.textMuted }]}>Total Income</Text>
                    <Text style={[styles.tabSummaryValue, { color: '#10b981' }]} data-testid="text-income">
                      {maskValue(`+${formatCurrency(summary.totalIncome)}`)}
                    </Text>
                  </View>
                  {summary.incomeByAccount && summary.incomeByAccount.length > 0 ? (
                    summary.incomeByAccount.map((acc) => (
                      <View key={acc.accountId} style={[styles.accountRow, { borderBottomColor: colors.border }]}>
                        <View style={[styles.accountDot, { backgroundColor: '#10b981' }]} />
                        <View style={styles.accountInfo}>
                          <Text style={[styles.accountName, { color: colors.text }]}>{acc.accountName}</Text>
                          {acc.bankName ? <Text style={[styles.accountBank, { color: colors.textMuted }]}>{acc.bankName}</Text> : null}
                        </View>
                        <Text style={[styles.accountAmt, { color: '#10b981' }]}>
                          {maskValue(`+${formatCurrency(acc.amount)}`)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>No income this month</Text>
                    </View>
                  )}
                </View>
              )}

              {activeTab === 'expense' && (
                <View style={styles.tabInner}>
                  <View style={styles.tabSummaryRow}>
                    <Text style={[styles.tabSummaryLabel, { color: colors.textMuted }]}>Total Spent</Text>
                    <Text style={[styles.tabSummaryValue, { color: '#ef4444' }]} data-testid="text-spent">
                      {maskValue(`-${formatCurrency(summary.totalSpent)}`)}
                    </Text>
                  </View>
                  {summary.expenseByAccount && summary.expenseByAccount.length > 0 ? (
                    summary.expenseByAccount.map((acc) => (
                      <View key={acc.accountId} style={[styles.accountRow, { borderBottomColor: colors.border }]}>
                        <View style={[styles.accountDot, { backgroundColor: '#ef4444' }]} />
                        <View style={styles.accountInfo}>
                          <Text style={[styles.accountName, { color: colors.text }]}>{acc.accountName}</Text>
                          {acc.bankName ? <Text style={[styles.accountBank, { color: colors.textMuted }]}>{acc.bankName}</Text> : null}
                        </View>
                        <Text style={[styles.accountAmt, { color: '#ef4444' }]}>
                          {maskValue(`-${formatCurrency(acc.amount)}`)}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>No expenses this month</Text>
                    </View>
                  )}
                </View>
              )}

              {activeTab === 'bills' && (
                <View style={styles.tabInner}>
                  <View style={styles.tabSummaryRow}>
                    <Text style={[styles.tabSummaryLabel, { color: colors.textMuted }]}>Bills Due</Text>
                    <Text style={[styles.tabSummaryValue, { color: '#f59e0b' }]} data-testid="text-bills-due">
                      {maskValue(formatCurrency(summary.billsDue))}
                    </Text>
                  </View>
                  {totalBillsCount > 0 && (
                    <Text style={[styles.billsSummaryMeta, { color: colors.textMuted }]}>
                      {totalPaidCount}/{totalBillsCount} paid
                    </Text>
                  )}
                  {totalBillsCount === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="checkmark-circle-outline" size={24} color="#10b981" />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>No bills due this month</Text>
                    </View>
                  ) : (
                    <>
                      {renderAccordionSection(
                        'Scheduled Payments', 'repeat-outline', '#6366f1', 'scheduled',
                        billsDueDetails?.scheduledPayments || [],
                        (item) => item.frequency === 'monthly' ? 'Monthly' : item.frequency === 'quarterly' ? 'Quarterly' : item.frequency === 'half_yearly' ? 'Half Yearly' : item.frequency === 'yearly' ? 'Yearly' : item.frequency === 'custom' ? 'Custom' : '',
                      )}
                      {renderAccordionSection(
                        'Credit Card Bills', 'card-outline', '#ec4899', 'creditCard',
                        billsDueDetails?.creditCardBills || [],
                        (item) => `${item.bankName || ''}${item.creditLimit ? ` · Limit: ${formatCurrency(item.creditLimit)}` : ''}`.replace(/^[\s·]+/, ''),
                      )}
                      {renderAccordionSection(
                        'Loan EMIs', 'cash-outline', '#f59e0b', 'loans',
                        billsDueDetails?.loans || [],
                        (item) => `${getLoanTypeLabel(item.loanType)}${item.lenderName ? ` \u00B7 ${item.lenderName}` : ''}`,
                      )}
                      {renderAccordionSection(
                        'Insurance Premiums', 'shield-checkmark-outline', '#8b5cf6', 'insurance',
                        billsDueDetails?.insurance || [],
                        (item) => `${getInsuranceTypeLabel(item.insuranceType)}${item.providerName ? ` \u00B7 ${item.providerName}` : ''}`,
                      )}
                    </>
                  )}
                  {renderBillsInboxSection()}
                </View>
              )}

              {activeTab as any === 'savings' && (
                <View style={styles.tabInner}>
                  <View style={styles.savingsSummaryRow}>
                    <View style={styles.savingsStat}>
                      <Text style={[styles.savingsStatLabel, { color: colors.textMuted }]}>Saved This Cycle</Text>
                      <Text style={[styles.savingsStatValue, { color: colors.primary }]}>{formatCurrency(savedThisCycle)}</Text>
                    </View>
                    <View style={[styles.savingsDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.savingsStat}>
                      <Text style={[styles.savingsStatLabel, { color: colors.textMuted }]}>Target This Cycle</Text>
                      <Text style={[styles.savingsStatValue, { color: colors.text }]}>{formatCurrency(monthlyExpectedSavings)}</Text>
                    </View>
                  </View>

                  <Text style={[styles.savingsListTitle, { color: colors.textMuted }]}>ACTIVE GOALS</Text>
                  {activeGoals.length > 0 ? (
                    activeGoals.map((goal) => {
                      const progress = parseFloat(goal.targetAmount) > 0 ? parseFloat(goal.currentAmount || "0") / parseFloat(goal.targetAmount) : 0;
                      return (
                        <View key={goal.id} style={[styles.goalRow, { borderBottomColor: colors.border }]}>
                          <View style={[styles.goalIconWrap, { backgroundColor: colors.primary + '15' }]}>
                            <Ionicons name="flag-outline" size={16} color={colors.primary} />
                          </View>
                          <View style={styles.goalInfo}>
                            <View style={styles.goalNameRow}>
                              <Text style={[styles.goalName, { color: colors.text }]} numberOfLines={1}>{goal.name}</Text>
                              <Text style={[styles.goalAmt, { color: colors.text }]}>{formatCurrency(parseFloat(goal.currentAmount || "0"))}</Text>
                            </View>
                            <View style={styles.goalProgressBg}>
                              <View style={[styles.goalProgressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: colors.primary }]} />
                            </View>
                            <View style={styles.goalTargetRow}>
                              <Text style={[styles.goalTargetText, { color: colors.textMuted }]}>Target: {formatCurrency(parseFloat(goal.targetAmount))}</Text>
                              <Text style={[styles.goalTargetText, { color: colors.textMuted }]}>{Math.round(progress * 100)}%</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="leaf-outline" size={20} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textMuted }]}>No active goals</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
          </>
          ) : (
            <View style={styles.getStartedContainer}>
              <View style={[styles.getStartedIconWrap, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name="wallet-outline" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.getStartedTitle, { color: colors.text }]}>Welcome to My Tracker!</Text>
              <Text style={[styles.getStartedSubtitle, { color: colors.textMuted }]}>
                Add your first account to start tracking your money.
              </Text>
              <TouchableOpacity
                style={[styles.getStartedButton, { backgroundColor: colors.primary }]}
                onPress={() => navigation.navigate('AddAccount')}
                activeOpacity={0.8}
                data-testid="button-get-started-add-account"
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.getStartedButtonText}>Add Account</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ===== Next Month Plan (Main Card → Sub Card → Tabs) ===== */}
        {accounts.length > 0 && forecast && (
          <View style={[styles.mainCard, { backgroundColor: colors.card }]}>
            <View style={styles.mainCardHeader}>
              <View style={styles.mainCardHeaderLeft}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <View style={[styles.forecastIconWrap, { backgroundColor: '#3b82f6' + '15' }]}>
                    <Ionicons name="calendar-outline" size={16} color="#3b82f6" />
                  </View>
                  <Text style={[styles.username, { color: colors.text }]}>Next Cycle Plan</Text>
                </View>
              </View>
              <View style={[styles.cycleBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.cycleBadgeText, { color: colors.primary }]}>{forecast.monthLabel}</Text>
              </View>
            </View>

            <View style={styles.forecastSummaryRow}>
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Income</Text>
                <Text style={[styles.forecastStatValue, { color: '#10b981' }]}>+{formatCurrency(forecast.totalIncome)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Outflow</Text>
                <Text style={[styles.forecastStatValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalOutflow)}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.forecastSummaryStat}>
                <Text style={[styles.forecastStatLabel, { color: colors.textMuted }]}>Balance</Text>
                <Text style={[styles.forecastStatValueSmall, { color: colors.text }]}>
                  {forecast.net >= 0 ? '+' : ''}{formatCurrency(forecast.net)}
                </Text>
              </View>
            </View>

            {forecast.salary.length > 0 && (
              <View style={styles.forecastMsgRow}>
                <Ionicons name="information-circle-outline" size={13} color={colors.textMuted} />
                <Text style={[styles.forecastMsgText, { color: colors.textMuted }]}>
                  Based on current month salary credited on {forecast.salary[0].creditDay}{getOrdinalSuffix(forecast.salary[0].creditDay)}
                  {forecast.salary[0].bankName ? ` via ${forecast.salary[0].bankName}` : ''}
                </Text>
              </View>
            )}

            {/* Sub Card with expandable sections */}
            <View style={[styles.subCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              {forecast.scheduledPayments.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForecastAccordion('scheduled')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.accordionIconWrap, { backgroundColor: '#6366f1' + '15' }]}>
                      <Ionicons name="repeat-outline" size={16} color="#6366f1" />
                    </View>
                    <View style={styles.accordionTitleArea}>
                      <Text style={[styles.accordionTitle, { color: colors.text }]}>Scheduled Payments</Text>
                      <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{forecast.scheduledPayments.length} payment{forecast.scheduledPayments.length > 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.accordionRight}>
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalScheduled)}</Text>
                      <Ionicons name={forecastAccordion === 'scheduled' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                  {forecastAccordion === 'scheduled' && (
                    <View style={styles.accordionContent}>
                      {forecast.scheduledPayments.map((item) => renderForecastRow(item, 'scheduled_payment', '#6366f1', 'fsp'))}
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalScheduled)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {forecast.insurance.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForecastAccordion('insurance')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.accordionIconWrap, { backgroundColor: '#8b5cf6' + '15' }]}>
                      <Ionicons name="shield-checkmark-outline" size={16} color="#8b5cf6" />
                    </View>
                    <View style={styles.accordionTitleArea}>
                      <Text style={[styles.accordionTitle, { color: colors.text }]}>Insurance</Text>
                      <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{forecast.insurance.length} premium{forecast.insurance.length > 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.accordionRight}>
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalInsurance)}</Text>
                      <Ionicons name={forecastAccordion === 'insurance' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                  {forecastAccordion === 'insurance' && (
                    <View style={styles.accordionContent}>
                      {forecast.insurance.map((item) => renderForecastRow(item, 'insurance', '#8b5cf6', 'fins'))}
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalInsurance)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {forecast.loans.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForecastAccordion('loans')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.accordionIconWrap, { backgroundColor: '#f59e0b' + '15' }]}>
                      <Ionicons name="cash-outline" size={16} color="#f59e0b" />
                    </View>
                    <View style={styles.accordionTitleArea}>
                      <Text style={[styles.accordionTitle, { color: colors.text }]}>Loan EMIs</Text>
                      <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{forecast.loans.length} EMI{forecast.loans.length > 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.accordionRight}>
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalLoans)}</Text>
                      <Ionicons name={forecastAccordion === 'loans' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                  {forecastAccordion === 'loans' && (
                    <View style={styles.accordionContent}>
                      {forecast.loans.map((item) => renderForecastRow(item, 'loan', '#f59e0b', 'floan'))}
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalLoans)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {forecast.creditCardBills.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForecastAccordion('creditCard')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.accordionIconWrap, { backgroundColor: '#ec4899' + '15' }]}>
                      <Ionicons name="card-outline" size={16} color="#ec4899" />
                    </View>
                    <View style={styles.accordionTitleArea}>
                      <Text style={[styles.accordionTitle, { color: colors.text }]}>Credit Card Bills</Text>
                      <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{forecast.creditCardBills.length} bill{forecast.creditCardBills.length > 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.accordionRight}>
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalCreditCardBills)}</Text>
                      <Ionicons name={forecastAccordion === 'creditCard' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                  {forecastAccordion === 'creditCard' && (
                    <View style={styles.accordionContent}>
                      {forecast.creditCardBills.map((item) => renderForecastRow(
                        item, 'credit_card_bill', '#ec4899', 'fcc',
                        `${item.dueDate ? `Due: ${item.dueDate}${getOrdinalSuffix(item.dueDate)}` : ''}${item.creditLimit ? ` · Limit: ${formatCurrency(item.creditLimit)}` : ''}`
                      ))}
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalCreditCardBills)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {forecast.savings.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={[styles.accordionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => toggleForecastAccordion('savings')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.accordionIconWrap, { backgroundColor: '#22c55e' + '15' }]}>
                      <Ionicons name="trending-up-outline" size={16} color="#22c55e" />
                    </View>
                    <View style={styles.accordionTitleArea}>
                      <Text style={[styles.accordionTitle, { color: colors.text }]}>Savings Plan</Text>
                      <Text style={[styles.accordionSubtitle, { color: colors.textMuted }]}>{forecast.savings.length} goal{forecast.savings.length > 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.accordionRight}>
                      <Text style={[styles.accordionTotal, { color: colors.text }]}>{formatCurrency(forecast.totalSavings)}</Text>
                      <Ionicons name={forecastAccordion === 'savings' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>
                  {forecastAccordion === 'savings' && (
                    <View style={styles.accordionContent}>
                      {forecast.savings.map((item) => renderForecastRow(item, 'savings_goal', '#22c55e', 'fsav'))}
                      <View style={styles.forecastTabTotal}>
                        <Text style={[styles.forecastTabTotalLabel, { color: colors.textMuted }]}>Total</Text>
                        <Text style={[styles.forecastTabTotalValue, { color: '#ef4444' }]}>-{formatCurrency(forecast.totalSavings)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {forecast.scheduledPayments.length === 0 && forecast.loans.length === 0 && forecast.insurance.length === 0 && forecast.creditCardBills.length === 0 && forecast.savings.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { color: colors.textMuted }]}>No outflow planned for {forecast.monthLabel}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ===== Remaining Cards below main card ===== */}

        {/* Top Spending Categories */}
        {summary.topCategories.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Top Spending</Text>
              <TouchableOpacity onPress={() => navigation.navigate('ExpenseDetails' as any)} data-testid="button-view-expenses">
                <Text style={[styles.viewAll, { color: colors.primary }]}>View All</Text>
              </TouchableOpacity>
            </View>
            {summary.topCategories.map((cat) => {
              const pct = summary.totalSpent > 0 ? Math.round((cat.total / summary.totalSpent) * 100) : 0;
              return (
                <View key={cat.categoryId} style={styles.categoryRow}>
                  <View style={[styles.categoryIcon, { backgroundColor: cat.color + '20' }]}>
                    <Ionicons name={(cat.icon as any) || 'ellipsis-horizontal'} size={16} color={cat.color} />
                  </View>
                  <View style={styles.categoryInfo}>
                    <View style={styles.categoryNameRow}>
                      <Text style={[styles.categoryName, { color: colors.text }]}>{cat.name}</Text>
                      <Text style={[styles.categoryAmt, { color: colors.text }]}>{formatCurrency(cat.total)}</Text>
                    </View>
                    <View style={[styles.categoryBar, { backgroundColor: colors.border }]}>
                      <View style={[styles.categoryBarFill, { width: `${pct}%`, backgroundColor: cat.color }]} />
                    </View>
                  </View>
                  <Text style={[styles.categoryPct, { color: colors.textMuted }]}>{pct}%</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Budget Tracking */}
        {summary.budgetUsage.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Budget Tracking</Text>
              <Ionicons name="pie-chart-outline" size={18} color={colors.primary} />
            </View>
            {summary.budgetUsage.map((budget) => (
              <View key={budget.categoryId} style={styles.budgetItem}>
                <View style={styles.budgetHeader}>
                  <Text style={[styles.budgetName, { color: colors.text }]}>{budget.categoryName}</Text>
                  <Text style={[styles.budgetAmount, { color: colors.textMuted }]}>
                    {formatCurrency(budget.spent)} / {formatCurrency(budget.budget)}
                  </Text>
                </View>
                <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(budget.percentage, 100)}%`,
                        backgroundColor: budget.percentage >= 100 ? '#ef4444' : budget.percentage >= 80 ? '#f59e0b' : colors.primary,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Credit Card Spending */}
        {summary.creditCardSpending.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Credit Cards</Text>
              <TouchableOpacity onPress={() => navigation.navigate('CreditCardDetails' as any)} data-testid="button-view-credit-cards">
                <Text style={[styles.viewAll, { color: colors.primary }]}>Details</Text>
              </TouchableOpacity>
            </View>
            {summary.creditCardSpending.map((card) => {
              const hasLimit = card.limit !== null && card.limit > 0;
              return (
                <View key={card.accountId} style={[styles.ccRow, { borderBottomColor: colors.border }]}>
                  <View style={styles.ccInfo}>
                    <Text style={[styles.ccName, { color: colors.text }]} numberOfLines={1}>{card.accountName}</Text>
                    {card.bankName ? <Text style={[styles.ccBank, { color: colors.textMuted }]}>{card.bankName}</Text> : null}
                  </View>
                  <View style={styles.ccRight}>
                    <Text style={[styles.ccSpent, { color: card.percentage >= 100 ? '#ef4444' : card.percentage >= 80 ? '#f59e0b' : colors.text }]}>
                      {formatCurrency(card.spent)}
                    </Text>
                    {hasLimit && <Text style={[styles.ccLimit, { color: colors.textMuted }]}>/ {formatCurrency(card.limit!)}</Text>}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Loans & EMI Summary */}
        {summary.activeLoansCount > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Loans & EMI</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Loans' as any)} data-testid="button-view-loans">
                <Text style={[styles.viewAll, { color: colors.primary }]}>Manage</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.loanRow}>
              <View style={styles.loanStat}>
                <Text style={[styles.loanStatLabel, { color: colors.textMuted }]}>Active Loans</Text>
                <Text style={[styles.loanStatValue, { color: colors.text }]}>{summary.activeLoansCount}</Text>
              </View>
              <View style={[styles.loanDivider, { backgroundColor: colors.border }]} />
              <View style={styles.loanStat}>
                <Text style={[styles.loanStatLabel, { color: colors.textMuted }]}>Monthly EMI</Text>
                <Text style={[styles.loanStatValue, { color: '#f59e0b' }]}>{formatCurrency(summary.totalEMI)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Recent Transactions */}
        {summary.lastTransactions.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Recent Transactions</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Transactions' as any)} data-testid="button-view-transactions">
                <Text style={[styles.viewAll, { color: colors.primary }]}>View All</Text>
              </TouchableOpacity>
            </View>
            {summary.lastTransactions.map((txn: any) => (
              <View key={txn.id} style={styles.txnRow}>
                <View style={[styles.txnIcon, { backgroundColor: txn.type === 'credit' ? '#10b981' + '18' : '#ef4444' + '18' }]}>
                  <Ionicons
                    name={txn.type === 'credit' ? 'arrow-down-outline' : 'arrow-up-outline'}
                    size={16}
                    color={txn.type === 'credit' ? '#10b981' : '#ef4444'}
                  />
                </View>
                <View style={styles.txnInfo}>
                  <Text style={[styles.txnDesc, { color: colors.text }]} numberOfLines={1}>
                    {txn.description || txn.merchant || (txn.category?.name) || 'Transaction'}
                  </Text>
                  <Text style={[styles.txnDate, { color: colors.textMuted }]}>
                    {new Date(txn.transactionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {txn.account ? ` - ${txn.account.name}` : ''}
                  </Text>
                </View>
                <Text style={[styles.txnAmt, { color: txn.type === 'credit' ? '#10b981' : '#ef4444' }]}>
                  {txn.type === 'credit' ? '+' : '-'}{formatCurrency(parseFloat(txn.amount))}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 12 }]}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary + '12' }]}
              onPress={() => navigation.navigate('ScheduledPayments' as any)}
              data-testid="button-quick-payments"
            >
              <Ionicons name="repeat-outline" size={22} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Payments</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#f59e0b' + '12' }]}
              onPress={() => navigation.navigate('Loans' as any)}
              data-testid="button-quick-loans"
            >
              <Ionicons name="card-outline" size={22} color="#f59e0b" />
              <Text style={[styles.actionText, { color: '#f59e0b' }]}>Loans</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#8b5cf6' + '12' }]}
              onPress={() => navigation.navigate('Insurances' as any)}
              data-testid="button-quick-insurance"
            >
              <Ionicons name="shield-checkmark-outline" size={22} color="#8b5cf6" />
              <Text style={[styles.actionText, { color: '#8b5cf6' }]}>Insurance</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#10b981' + '12' }]}
              onPress={() => navigation.navigate('SavingsGoals' as any)}
              data-testid="button-quick-savings"
            >
              <Ionicons name="trophy-outline" size={22} color="#10b981" />
              <Text style={[styles.actionText, { color: '#10b981' }]}>Savings</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>

      <FABButton onPress={() => navigation.navigate('AddTransaction')} />

      <Modal
        visible={showCycleInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCycleInfoModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCycleInfoModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>How We Calculate Your Month</Text>
              <TouchableOpacity onPress={() => setShowCycleInfoModal(false)} data-testid="button-close-cycle-info">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {summary?.cycleInfo?.isSalaryCycle ? (
              <View style={styles.modalBody}>
                <View style={[styles.infoRow, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
                  <Ionicons name="calendar" size={18} color={colors.primary} />
                  <View style={styles.infoRowText}>
                    <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Current Cycle</Text>
                    <Text style={[styles.infoValue, { color: colors.text }]}>
                      {summary.cycleInfo.cycleStartFormatted} {'\u2192'} {summary.cycleInfo.cycleEndFormatted}
                    </Text>
                  </View>
                </View>

                {forecast?.cycleInfo && (
                  <View style={[styles.infoRow, { backgroundColor: '#8b5cf610', borderColor: '#8b5cf630' }]}>
                    <Ionicons name="calendar-outline" size={18} color="#8b5cf6" />
                    <View style={styles.infoRowText}>
                      <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Next Cycle</Text>
                      <Text style={[styles.infoValue, { color: colors.text }]}>
                        {forecast.cycleInfo.cycleStartFormatted} {'\u2192'} {forecast.cycleInfo.cycleEndFormatted}
                      </Text>
                    </View>
                  </View>
                )}

                <Text style={[styles.modalExplain, { color: colors.textMuted }]}>
                  Your financial month is based on your salary cycle, not the calendar month. It starts from your last salary credit date and ends just before the next expected salary date.
                </Text>
                <Text style={[styles.modalExplain, { color: colors.textMuted, marginTop: 6 }]}>
                  All income, expenses, and bill calculations on this dashboard use these cycle dates for accurate tracking.
                </Text>
              </View>
            ) : (
              <View style={styles.modalBody}>
                <View style={[styles.infoRow, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
                  <Ionicons name="calendar" size={18} color={colors.primary} />
                  <View style={styles.infoRowText}>
                    <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Current Period</Text>
                    <Text style={[styles.infoValue, { color: colors.text }]}>Calendar Month ({summary?.monthLabel})</Text>
                  </View>
                </View>
                <Text style={[styles.modalExplain, { color: colors.textMuted }]}>
                  Your dashboard currently uses the standard calendar month. Set up a salary profile to switch to salary cycle-based tracking for more accurate financial planning.
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingSubtext: {
    marginTop: 6,
    fontSize: 12,
    textAlign: 'center',
  },

  mainCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  salaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    gap: 8,
  },
  salaryBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  salaryBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  salaryBannerText: {
    flex: 1,
  },
  salaryBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  salaryBannerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  getStartedContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  getStartedIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  getStartedTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  getStartedSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  getStartedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 6,
  },
  getStartedButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  savingsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 4,
  },
  savingsStat: {
    flex: 1,
    alignItems: 'center',
  },
  savingsStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  savingsStatValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  savingsDivider: {
    width: 1,
    height: 24,
  },
  savingsListTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  goalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalInfo: {
    flex: 1,
  },
  goalNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  goalName: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  goalAmt: {
    fontSize: 13,
    fontWeight: '700',
  },
  goalProgressBg: {
    height: 4,
    backgroundColor: '#00000010',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  goalTargetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalTargetText: {
    fontSize: 10,
  },
  savingsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 4,
  },
  savingsStat: {
    flex: 1,
    alignItems: 'center',
  },
  savingsStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  savingsStatValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  savingsDivider: {
    width: 1,
    height: 24,
  },
  savingsListTitle: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  goalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalInfo: {
    flex: 1,
  },
  goalNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  goalName: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  goalAmt: {
    fontSize: 13,
    fontWeight: '700',
  },
  goalProgressBg: {
    height: 4,
    backgroundColor: '#00000010',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  goalTargetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalTargetText: {
    fontSize: 10,
  },
  mainCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  mainCardHeaderLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 12,
    marginBottom: 2,
  },
  username: {
    fontSize: 18,
    fontWeight: '700',
  },
  mainCardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cycleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cycleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  settingsBtn: {
    padding: 4,
  },

  netBalanceSection: {
    marginBottom: 16,
  },
  netBalanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  netBalanceLabel: {
    fontSize: 12,
  },
  eyeBtn: {
    padding: 4,
  },
  netBalanceValue: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  spendBarWrap: {
    marginTop: 10,
  },
  spendBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  spendBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  spendBarLabel: {
    fontSize: 11,
  },

  subCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginRight: 24,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#10b981',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  activeTabText: {
    fontWeight: '600',
  },
  tabContent: {
    minHeight: 60,
  },
  tabInner: {
    gap: 4,
  },
  tabSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tabSummaryLabel: {
    fontSize: 12,
  },
  tabSummaryValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  billsSummaryMeta: {
    fontSize: 11,
    marginBottom: 8,
  },

  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  accountDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    fontWeight: '500',
  },
  accountBank: {
    fontSize: 11,
    marginTop: 1,
  },
  accountAmt: {
    fontSize: 14,
    fontWeight: '700',
  },

  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
  },

  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  accordionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accordionTitleArea: {
    flex: 1,
  },
  accordionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  accordionSubtitle: {
    fontSize: 10,
    marginTop: 1,
  },
  accordionRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  accordionTotal: {
    fontSize: 13,
    fontWeight: '700',
  },
  accordionContent: {
    paddingLeft: 6,
    marginTop: 2,
    marginBottom: 4,
  },

  billDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  billStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  billDetailInfo: {
    flex: 1,
  },
  billDetailName: {
    fontSize: 13,
    fontWeight: '500',
  },
  billMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  billSubLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  billDueText: {
    fontSize: 10,
  },
  billDetailRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  dismissBtn: {
    padding: 4,
  },
  billDetailAmt: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 3,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '600',
  },

  card: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  viewAll: {
    fontSize: 13,
    fontWeight: '600',
  },

  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryInfo: {
    flex: 1,
    gap: 4,
  },
  categoryNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '500',
  },
  categoryAmt: {
    fontSize: 13,
    fontWeight: '600',
  },
  categoryBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  categoryBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  categoryPct: {
    fontSize: 12,
    fontWeight: '500',
    width: 35,
    textAlign: 'right',
  },
  budgetItem: {
    marginBottom: 12,
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  budgetName: {
    fontSize: 14,
    fontWeight: '500',
  },
  budgetAmount: {
    fontSize: 12,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  ccRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ccInfo: {
    flex: 1,
    marginRight: 8,
  },
  ccName: {
    fontSize: 14,
    fontWeight: '500',
  },
  ccBank: {
    fontSize: 11,
    marginTop: 2,
  },
  ccRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  ccSpent: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  ccLimit: {
    fontSize: 11,
  },
  loanRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loanStat: {
    flex: 1,
    alignItems: 'center',
  },
  loanStatLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  loanStatValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  loanDivider: {
    width: 1,
    height: 40,
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  txnIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txnInfo: {
    flex: 1,
  },
  txnDesc: {
    fontSize: 14,
    fontWeight: '500',
  },
  txnDate: {
    fontSize: 11,
    marginTop: 2,
  },
  txnAmt: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },

  forecastIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forecastSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  forecastSummaryStat: {
    flex: 1,
    alignItems: 'center',
  },
  forecastStatLabel: {
    fontSize: 11,
    marginBottom: 3,
  },
  forecastStatValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  forecastStatValueSmall: {
    fontSize: 13,
    fontWeight: '600',
  },
  forecastMsgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  forecastMsgText: {
    fontSize: 11,
    flex: 1,
  },
  forecastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingLeft: 4,
  },
  forecastDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  forecastRowInfo: {
    flex: 1,
  },
  forecastRowName: {
    fontSize: 13,
    fontWeight: '500',
  },
  forecastRowMeta: {
    fontSize: 10,
    marginTop: 1,
  },
  forecastRowAmt: {
    fontSize: 13,
    fontWeight: '700',
  },
  forecastToggleBtn: {
    marginLeft: 8,
    padding: 2,
  },
  forecastTabTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    marginTop: 4,
  },
  forecastTabTotalLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  forecastTabTotalValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  modalBody: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  infoRowText: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  modalExplain: {
    fontSize: 13,
    lineHeight: 19,
  },
});
