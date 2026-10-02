import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Modal, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Swipeable } from 'react-native-gesture-handler';
import DateTimePicker from '@react-native-community/datetimepicker';
import { api } from '../lib/api';
import { formatCurrency, formatDate, getThemedColors } from '../lib/utils';
import { RootStackParamList } from '../../App';
import { FABButton } from '../components/FABButton';
import type { Transaction, Category, Account } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';
import { useSwipeSettings } from '../hooks/useSwipeSettings';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function TransactionsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit' | 'transfer'>('all');
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedFromAccount, setSelectedFromAccount] = useState<number | null>(null);
  const [selectedToAccount, setSelectedToAccount] = useState<number | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showTransactionTypePicker, setShowTransactionTypePicker] = useState(false);
  const [showFromAccountPicker, setShowFromAccountPicker] = useState(false);
  const [showToAccountPicker, setShowToAccountPicker] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const swipeSettings = useSwipeSettings();
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());
  const currentOpenSwipeable = useRef<number | null>(null);

  const typeConfig = {
    credit: {
      icon: 'arrow-down' as const,
      color: '#22c55e',
      bgColor: '#22c55e20',
    },
    debit: { 
      icon: 'arrow-up' as const,
      color: colors.danger, 
      bgColor: colors.danger + '20', 
    },
    transfer: {
      icon: 'swap-horizontal' as const,
      color: '#007AFF',
      bgColor: '#007AFF20', 
    },
  };
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

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['/api/transactions'],
    queryFn: api.getTransactions,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['/api/categories'],
    queryFn: api.getCategories,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });
  
  const deleteMutation = useMutation({
    mutationFn: api.deleteTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      setIsDeleteModalOpen(false);
      setSelectedTransaction(null);
      Toast.show({
        type: 'success',
        text1: 'Transaction Deleted',
        text2: 'Transaction has been removed',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      setIsDeleteModalOpen(false);
      setSelectedTransaction(null);
      
      // Check if this is a savings contribution transaction
      if (error.isSavingsContribution || error.message?.includes('savings contribution')) {
        Toast.show({
          type: 'error',
          text1: 'Cannot Delete',
          text2: error.message || `This is a savings contribution transaction. Delete it from Savings Goals screen.`,
          position: 'bottom',
          visibilityTime: 5000,
        });
      } else {
        Toast.show({
          type: 'error',
          text1: 'Delete Failed',
          text2: 'Could not delete transaction. Please try again.',
          position: 'bottom',
        });
      }
    },
  });

  const handleDelete = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDeleteModalOpen(true);
    // Close the swipeable after showing modal
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
  };

  const confirmDelete = () => {
    if (selectedTransaction && !deleteMutation.isPending) {
      deleteMutation.mutate(selectedTransaction.id);
    }
  };

  const handleCancelDelete = () => {
    setIsDeleteModalOpen(false);
    setSelectedTransaction(null);
  };

  const filteredTransactions = (transactions?.filter(t => {
    const matchesSearch = search === '' || 
      t.merchant?.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase()) ||
      t.category?.name.toLowerCase().includes(search.toLowerCase());
    
    const matchesFilter = filter === 'all' || t.type === filter;
    
    const matchesCategory = selectedCategory === null || t.categoryId === selectedCategory;
    
    const matchesFromAccount = selectedFromAccount === null || t.accountId === selectedFromAccount;
    
    const matchesToAccount = selectedToAccount === null || t.toAccountId === selectedToAccount;
    
    const transactionDate = new Date(t.transactionDate);
    const matchesStartDate = !startDate || transactionDate >= startDate;
    const matchesEndDate = !endDate || transactionDate <= endDate;
    const matchesTracked = !trackedOnly || !!t.spendingTrackerEnabled;

    return matchesSearch && matchesFilter && matchesCategory && matchesFromAccount && matchesToAccount && matchesStartDate && matchesEndDate && matchesTracked;
  }) || []).sort((a, b) =>
    new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime() || b.id - a.id
  );

  const handleEdit = (transaction: Transaction) => {
    // Close the swipeable before navigation
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
    navigation.navigate('AddTransaction', { transactionId: transaction.id });
  };

  const renderRightActions = (transaction: Transaction) => {
    const action = swipeSettings.rightAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(transaction) : handleDelete(transaction)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderLeftActions = (transaction: Transaction) => {
    const action = swipeSettings.leftAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(transaction) : handleDelete(transaction)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderTransaction = (transaction: Transaction) => {
    const isWeb = Platform.OS === 'web';
    // Show action buttons when swipe is disabled on mobile or on web
    const showActionButtons = isWeb || !swipeSettings.enabled;
    
    const content = (
      <View style={[styles.transactionCard, { backgroundColor: colors.card }]}>
        <View style={[
          styles.transactionIcon,
          { backgroundColor: typeConfig[transaction.type as keyof typeof typeConfig]?.bgColor || typeConfig.debit.bgColor }
        ]}>
          <Ionicons 
            name={typeConfig[transaction.type as keyof typeof typeConfig]?.icon || typeConfig.debit.icon} 
            size={20} 
            color={typeConfig[transaction.type as keyof typeof typeConfig]?.color || typeConfig.debit.color}
          />
        </View>
        <View style={styles.transactionInfo}>
          <Text style={[styles.transactionMerchant, { color: colors.text }]}>
            {transaction.merchant || transaction.category?.name || 'Transaction'}
          </Text>
          <Text style={[styles.transactionCategory, { color: colors.textMuted }]}>
            {transaction.category?.name} {transaction.account && `• ${transaction.account.name}`}
          </Text>
          <Text style={[styles.transactionDate, { color: colors.textMuted }]}>{formatDate(transaction.transactionDate)}</Text>
        </View>
        <View style={styles.amountColumn}>
          <Text style={[
            styles.transactionAmount,
            { color: transaction.type === 'credit' ? colors.primary : colors.danger }
          ]}>
            {transaction.type === 'credit' ? '+' : '-'}{formatCurrency(transaction.amount)}
          </Text>
          {transaction.spendingTrackerEnabled && (() => {
            const left = parseFloat(transaction.amount) - parseFloat(transaction.spendingAllocated ?? '0');
            return (
              <View style={styles.trackedBadge}>
                <Ionicons name="pie-chart-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.trackedBadgeText, { color: colors.textMuted }]}>{formatCurrency(left)} left</Text>
              </View>
            );
          })()}
        </View>
        {showActionButtons && (
          <View style={styles.webActions}>
            <TouchableOpacity 
              style={[styles.webActionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleEdit(transaction)}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => handleDelete(transaction)}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );

    // Enable swipe only on mobile (not web) when swipe settings are enabled
    const isSwipeEnabled = swipeSettings.enabled && Platform.OS !== 'web';
    
    if (isSwipeEnabled) {
      return (
        <Swipeable
          key={transaction.id}
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(transaction.id, ref);
            } else {
              swipeableRefs.current.delete(transaction.id);
            }
          }}
          renderRightActions={() => renderRightActions(transaction)}
          renderLeftActions={() => renderLeftActions(transaction)}
          onSwipeableOpen={() => {
            // Close previously opened swipeable
            if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== transaction.id) {
              swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
            }
            currentOpenSwipeable.current = transaction.id;
          }}
        >
          {content}
        </Swipeable>
      );
    }

    return <View key={transaction.id}>{content}</View>;
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.searchContainer}>
        <View style={[styles.searchBox, { backgroundColor: colors.card }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search transactions..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          <TouchableOpacity 
            onPress={() => setShowFilters(!showFilters)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons 
              name={showFilters ? "chevron-up" : "chevron-down"} 
              size={20} 
              color={colors.textMuted} 
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Collapsible Filter Section */}
      {showFilters && (
        <View style={styles.filtersSection}>
          {/* Transaction Type and Category Dropdowns */}
          <View style={styles.dateFilterContainer}>
            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: colors.card, borderColor: filter !== 'all' ? colors.primary : colors.border }]}
              onPress={() => setShowTransactionTypePicker(true)}
            >
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: filter !== 'all' ? colors.text : colors.textMuted }]}>
                {filter === 'all' ? 'All Types' : filter === 'credit' ? 'Income' : filter === 'debit' ? 'Expense' : 'Transfer'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: colors.card, borderColor: selectedCategory ? colors.primary : colors.border }]}
              onPress={() => setShowCategoryPicker(true)}
            >
              <Ionicons name="pricetag-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: selectedCategory ? colors.text : colors.textMuted }]}>
                {selectedCategory ? categories.find(c => c.id === selectedCategory)?.name : 'All Categories'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Date Range Filter */}
          <View style={styles.dateFilterContainer}>
            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: colors.card, borderColor: startDate ? colors.primary : colors.border }]}
              onPress={() => setShowStartDatePicker(true)}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: startDate ? colors.text : colors.textMuted }]}>
                {startDate ? formatDate(startDate.toISOString()) : 'From Date'}
              </Text>
              {startDate && (
                <TouchableOpacity onPress={() => setStartDate(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: colors.card, borderColor: endDate ? colors.primary : colors.border }]}
              onPress={() => setShowEndDatePicker(true)}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: endDate ? colors.text : colors.textMuted }]}>
                {endDate ? formatDate(endDate.toISOString()) : 'To Date'}
              </Text>
              {endDate && (
                <TouchableOpacity onPress={() => setEndDate(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Account Filters */}
          <View style={styles.dateFilterContainer}>
            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: colors.card, borderColor: selectedFromAccount ? colors.primary : colors.border }]}
              onPress={() => setShowFromAccountPicker(true)}
            >
              <Ionicons name="wallet-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: selectedFromAccount ? colors.text : colors.textMuted }]}>
                {selectedFromAccount ? accounts.find(a => a.id === selectedFromAccount)?.name : 'From Account'}
              </Text>
              {selectedFromAccount && (
                <TouchableOpacity onPress={() => setSelectedFromAccount(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: colors.card, borderColor: selectedToAccount ? colors.primary : colors.border }]}
              onPress={() => setShowToAccountPicker(true)}
            >
              <Ionicons name="wallet-outline" size={18} color={colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: selectedToAccount ? colors.text : colors.textMuted }]}>
                {selectedToAccount ? accounts.find(a => a.id === selectedToAccount)?.name : 'To Account'}
              </Text>
              {selectedToAccount && (
                <TouchableOpacity onPress={() => setSelectedToAccount(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Spending Tracked filter */}
          <View style={styles.dateFilterContainer}>
            <TouchableOpacity
              style={[styles.dateFilterButton, { backgroundColor: trackedOnly ? colors.primary + '20' : colors.card, borderColor: trackedOnly ? colors.primary : colors.border }]}
              onPress={() => setTrackedOnly(v => !v)}
            >
              <Ionicons name="pie-chart-outline" size={18} color={trackedOnly ? colors.primary : colors.textMuted} />
              <Text style={[styles.dateFilterText, { color: trackedOnly ? colors.text : colors.textMuted }]}>Spending Tracked only</Text>
              {trackedOnly && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {filteredTransactions.length > 0 ? (
          filteredTransactions.map((transaction) => renderTransaction(transaction))
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
            <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.text }]}>No transactions found</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>Tap + to add your first transaction</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Transaction Type Picker Modal */}
      <Modal
        visible={showTransactionTypePicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowTransactionTypePicker(false)}
      >
        <View style={styles.pickerModalOverlay}>
          <View style={[styles.pickerModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>Select Transaction Type</Text>
              <TouchableOpacity onPress={() => setShowTransactionTypePicker(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView}>
              {(['all', 'credit', 'debit', 'transfer'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.pickerOption, filter === type && { backgroundColor: colors.primary + '20' }]}
                  onPress={() => {
                    setFilter(type);
                    setShowTransactionTypePicker(false);
                  }}
                >
                  <Text style={[styles.pickerOptionText, { color: filter === type ? colors.primary : colors.text }]}>
                    {type === 'all' ? 'All Types' : type === 'credit' ? 'Income' : type === 'debit' ? 'Expense' : 'Transfer'}
                  </Text>
                  {filter === type && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Category Picker Modal */}
      <Modal
        visible={showCategoryPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCategoryPicker(false)}
      >
        <View style={styles.pickerModalOverlay}>
          <View style={[styles.pickerModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>Select Category</Text>
              <TouchableOpacity onPress={() => setShowCategoryPicker(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView}>
              <TouchableOpacity
                style={[styles.pickerOption, selectedCategory === null && { backgroundColor: colors.primary + '20' }]}
                onPress={() => {
                  setSelectedCategory(null);
                  setShowCategoryPicker(false);
                }}
              >
                <Text style={[styles.pickerOptionText, { color: selectedCategory === null ? colors.primary : colors.text }]}>
                  All Categories
                </Text>
                {selectedCategory === null && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              {categories.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.pickerOption, selectedCategory === category.id && { backgroundColor: colors.primary + '20' }]}
                  onPress={() => {
                    setSelectedCategory(category.id);
                    setShowCategoryPicker(false);
                  }}
                >
                  <Text style={[styles.pickerOptionText, { color: selectedCategory === category.id ? colors.primary : colors.text }]}>
                    {category.name}
                  </Text>
                  {selectedCategory === category.id && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* From Account Picker Modal */}
      <Modal
        visible={showFromAccountPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowFromAccountPicker(false)}
      >
        <View style={styles.pickerModalOverlay}>
          <View style={[styles.pickerModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>Select From Account</Text>
              <TouchableOpacity onPress={() => setShowFromAccountPicker(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView}>
              <TouchableOpacity
                style={[styles.pickerOption, selectedFromAccount === null && { backgroundColor: colors.primary + '20' }]}
                onPress={() => {
                  setSelectedFromAccount(null);
                  setShowFromAccountPicker(false);
                }}
              >
                <Text style={[styles.pickerOptionText, { color: selectedFromAccount === null ? colors.primary : colors.text }]}>
                  All Accounts
                </Text>
                {selectedFromAccount === null && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              {accounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={[styles.pickerOption, selectedFromAccount === account.id && { backgroundColor: colors.primary + '20' }]}
                  onPress={() => {
                    setSelectedFromAccount(account.id);
                    setShowFromAccountPicker(false);
                  }}
                >
                  <Text style={[styles.pickerOptionText, { color: selectedFromAccount === account.id ? colors.primary : colors.text }]}>
                    {account.name}
                  </Text>
                  {selectedFromAccount === account.id && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* To Account Picker Modal */}
      <Modal
        visible={showToAccountPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowToAccountPicker(false)}
      >
        <View style={styles.pickerModalOverlay}>
          <View style={[styles.pickerModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>Select To Account</Text>
              <TouchableOpacity onPress={() => setShowToAccountPicker(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScrollView}>
              <TouchableOpacity
                style={[styles.pickerOption, selectedToAccount === null && { backgroundColor: colors.primary + '20' }]}
                onPress={() => {
                  setSelectedToAccount(null);
                  setShowToAccountPicker(false);
                }}
              >
                <Text style={[styles.pickerOptionText, { color: selectedToAccount === null ? colors.primary : colors.text }]}>
                  All Accounts
                </Text>
                {selectedToAccount === null && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              {accounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={[styles.pickerOption, selectedToAccount === account.id && { backgroundColor: colors.primary + '20' }]}
                  onPress={() => {
                    setSelectedToAccount(account.id);
                    setShowToAccountPicker(false);
                  }}
                >
                  <Text style={[styles.pickerOptionText, { color: selectedToAccount === account.id ? colors.primary : colors.text }]}>
                    {account.name}
                  </Text>
                  {selectedToAccount === account.id && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Date Pickers */}
      {showStartDatePicker && (
        <DateTimePicker
          value={startDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
          textColor={colors.text}
          onChange={(event, selectedDate) => {
            setShowStartDatePicker(Platform.OS === 'ios');
            if (selectedDate) {
              setStartDate(selectedDate);
            }
          }}
        />
      )}

      {showEndDatePicker && (
        <DateTimePicker
          value={endDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
          textColor={colors.text}
          onChange={(event, selectedDate) => {
            setShowEndDatePicker(Platform.OS === 'ios');
            if (selectedDate) {
              setEndDate(selectedDate);
            }
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={isDeleteModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsDeleteModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalIconContainer}>
              <View style={[styles.modalIcon, { backgroundColor: '#fee2e2' }]}>
                <Ionicons name="warning-outline" size={32} color="#ef4444" />
              </View>
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Transaction?</Text>
            <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
              Are you sure you want to delete this transaction? This action cannot be undone.
            </Text>

            {selectedTransaction && (
              <View style={[styles.transactionPreview, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.previewAmount, { color: selectedTransaction.type === 'credit' ? colors.primary : colors.danger }]}>
                  {selectedTransaction.type === 'credit' ? '+' : '-'}{formatCurrency(selectedTransaction.amount)}
                </Text>
                <Text style={[styles.previewDescription, { color: colors.text }]}>
                  {selectedTransaction.merchant || selectedTransaction.category?.name || 'Transaction'}
                </Text>
                <Text style={[styles.previewDate, { color: colors.textMuted }]}>
                  {formatDate(selectedTransaction.transactionDate)}
                </Text>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={handleCancelDelete}
                disabled={deleteMutation.isPending}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.deleteButton, { backgroundColor: '#ef4444' }]}
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.deleteButtonText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FABButton onPress={() => navigation.navigate('AddTransaction')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
  },
  filtersSection: {
    backgroundColor: 'transparent',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dateFilterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  dateFilterButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  dateFilterText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  dropdownContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  dropdownText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  pickerScrollView: {
    maxHeight: 400,
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  pickerOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  categoryFilterContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionMerchant: {
    fontSize: 15,
    fontWeight: '600',
  },
  transactionCategory: {
    fontSize: 13,
    marginTop: 2,
  },
  transactionDate: {
    fontSize: 12,
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  amountColumn: {
    alignItems: 'flex-end',
  },
  trackedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  trackedBadgeText: {
    fontSize: 11,
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
  transactionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIconButton: {
    padding: 8,
    borderRadius: 8,
  },
  deleteIconButton: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 8,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
  },
  modalIconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  transactionPreview: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
    alignItems: 'center',
  },
  previewAmount: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  previewDescription: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  previewDate: {
    fontSize: 13,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    // backgroundColor set inline
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyCard: {
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '500',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
  },
});
