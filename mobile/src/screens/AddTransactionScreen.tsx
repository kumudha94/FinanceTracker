import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Platform, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Toast from 'react-native-toast-message';
import { api } from '../lib/api';
import { getThemedColors, formatDate, formatCurrency } from '../lib/utils';
import type { Category, Account, Transaction } from '../lib/types';
import { RootStackParamList } from '../../App';
import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

type AddTransactionRouteProp = RouteProp<RootStackParamList, 'AddTransaction'>;

export default function AddTransactionScreen() {
  const navigation = useNavigation();
  const route = useRoute<AddTransactionRouteProp>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const transactionId = route.params?.transactionId;
  const isEditMode = !!transactionId;
  
  const [type, setType] = useState<'debit' | 'credit' | 'transfer'>('debit');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [originalCategoryId, setOriginalCategoryId] = useState<number | null>(null);
  const [merchantMatches, setMerchantMatches] = useState<Transaction[]>([]);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());
  const [showMerchantMatchModal, setShowMerchantMatchModal] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedToAccountId, setSelectedToAccountId] = useState<number | null>(null);
  const [transactionDate, setTransactionDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showToAccountPicker, setShowToAccountPicker] = useState(false);
  
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [smsText, setSmsText] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ['/api/categories'],
    queryFn: api.getCategories,
  });

  const { data: accounts } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  // Auto-select default account for new transactions
  React.useEffect(() => {
    if (!isEditMode && accounts && !selectedAccountId) {
      const defaultAccount = accounts.find(acc => acc.isDefault);
      if (defaultAccount) {
        setSelectedAccountId(defaultAccount.id);
      }
    }
  }, [accounts, isEditMode, selectedAccountId]);

  const { data: transactions } = useQuery({
    queryKey: ['/api/transactions'],
    queryFn: api.getTransactions,
    enabled: isEditMode,
  });

  // Load transaction data for edit mode
  React.useEffect(() => {
    if (isEditMode && transactions) {
      const transaction = transactions.find((t: any) => t.id === transactionId);
      if (transaction) {
        setType(transaction.type as 'debit' | 'credit' | 'transfer');
        setAmount(transaction.amount);
        setMerchant(transaction.merchant || '');
        setDescription(transaction.description || '');
        setSelectedCategoryId(transaction.categoryId || null);
        setOriginalCategoryId(transaction.categoryId || null);
        setSelectedAccountId(transaction.accountId || null);
        setSelectedToAccountId(transaction.toAccountId || null);
        setTransactionDate(new Date(transaction.transactionDate));
      }
    }
  }, [isEditMode, transactions, transactionId]);

  const createMutation = useMutation({
    mutationFn: api.createTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Transaction Created',
        text2: 'Transaction has been added successfully',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Create Failed',
        text2: 'Could not create transaction. Please try again.',
        position: 'bottom',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.updateTransaction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });

      const merchantChanged = merchant.trim().length > 0;
      const categoryChanged = selectedCategoryId !== originalCategoryId;

      if (merchantChanged && categoryChanged && selectedCategoryId && transactions) {
        const normalizedMerchant = merchant.trim().toLowerCase();
        const matches = transactions
          .filter((t: Transaction) =>
            t.id !== transactionId &&
            t.type === type &&
            t.categoryId !== selectedCategoryId &&
            (t.merchant || '').trim().toLowerCase() === normalizedMerchant
          )
          .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

        if (matches.length > 0) {
          setMerchantMatches(matches);
          setSelectedMatchIds(new Set(matches.map(m => m.id)));
          setShowMerchantMatchModal(true);
          return;
        }
      }

      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Transaction Updated',
        text2: 'Transaction has been updated successfully',
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update transaction. Please try again.',
        position: 'bottom',
      });
    },
  });

  const bulkCategoryMutation = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: number[]; categoryId: number }) =>
      api.bulkUpdateTransactionCategory(ids, categoryId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
      setShowMerchantMatchModal(false);
      navigation.goBack();
      Toast.show({
        type: 'success',
        text1: 'Transaction Updated',
        text2: 'Transaction has been updated successfully',
        position: 'bottom',
      });
    },
  });

  const handleParseSms = async () => {
    if (!smsText.trim()) {
      Alert.alert('Error', 'Please paste your bank SMS');
      return;
    }

    setIsParsing(true);
    try {
      // Check if multiple SMS (separated by blank lines or "---")
      const messages = smsText
        .split(/\n\n+|---+/)
        .map(msg => msg.trim())
        .filter(msg => msg.length > 0);
      
      if (messages.length > 1) {
        // Bulk parse
        const result = await api.parseSmsBatch(messages);
        
        queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
        queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
        
        setShowSmsModal(false);
        setSmsText('');
        
        Alert.alert(
          'Bulk Parse Complete',
          `Successfully parsed: ${result.successful} of ${result.total}\nFailed: ${result.failed}`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else {
        // Single SMS parse
        const result = await api.parseSms(smsText);
        
        if (result.success && result.transaction) {
          queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
          queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['/api/monthlyExpenses'] });
          queryClient.invalidateQueries({ queryKey: ['categoryBreakdown'] });
          setShowSmsModal(false);
          setSmsText('');
          Alert.alert('Success', 'Transaction added from SMS!', [
            { text: 'OK', onPress: () => navigation.goBack() }
          ]);
        } else if (result.parsed) {
          setAmount(result.parsed.amount.toString());
          setType(result.parsed.type);
          if (result.parsed.merchant) setMerchant(result.parsed.merchant);
          if (result.parsed.description) setDescription(result.parsed.description);
          setShowSmsModal(false);
          setSmsText('');
          Alert.alert('Parsed!', 'SMS data extracted. Please review and save.');
        } else {
          Alert.alert('Could Not Parse', result.message || 'Unable to extract transaction from this SMS. Please enter manually.');
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse SMS';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsParsing(false);
    }
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please enter a valid amount',
        position: 'bottom',
      });
      return;
    }

    if (type === 'transfer' && (!selectedAccountId || !selectedToAccountId)) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'Please select both From and To accounts',
        position: 'bottom',
      });
      return;
    }

    if (type === 'transfer' && selectedAccountId === selectedToAccountId) {
      Toast.show({
        type: 'error',
        text1: 'Validation Error',
        text2: 'From and To accounts must be different',
        position: 'bottom',
      });
      return;
    }

    const transactionData: any = {
      type,
      amount,
      merchant: merchant || null,
      description: description || null,
      categoryId: selectedCategoryId,
      accountId: selectedAccountId,
      transactionDate: transactionDate.toISOString(),
    };

    if (type === 'transfer') {
      transactionData.toAccountId = selectedToAccountId;
    }

    if (isEditMode && transactionId) {
      updateMutation.mutate({ id: transactionId, data: transactionData });
    } else {
      createMutation.mutate(transactionData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const filteredCategories = categories?.filter(c => {
    if (type === 'debit') return c.type === 'expense';
    if (type === 'credit') return c.type === 'income';
    if (type === 'transfer') return c.type === 'transfer';
    return false;
  }) || [];

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={[styles.smsButton, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setShowSmsModal(true)}>
        <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.primary} />
        <Text style={[styles.smsButtonText, { color: colors.text }]}>Paste Bank SMS</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.typeSelector}>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'debit' && { backgroundColor: '#EF4444' }]}
          onPress={() => setType('debit')}
        >
          <Ionicons name="arrow-up" size={20} color={type === 'debit' ? '#fff' : '#EF4444'} />
          <Text style={[styles.typeText, { color: colors.text }, type === 'debit' && { color: '#fff' }]}>Expense</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'credit' && { backgroundColor: colors.primary }]}
          onPress={() => setType('credit')}
        >
          <Ionicons name="arrow-down" size={20} color={type === 'credit' ? '#fff' : colors.primary} />
          <Text style={[styles.typeText, { color: colors.text }, type === 'credit' && { color: '#fff' }]}>Income</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, { backgroundColor: colors.card, borderColor: colors.border }, type === 'transfer' && { backgroundColor: '#007AFF' }]}
          onPress={() => setType('transfer')}
        >
          <Ionicons name="swap-horizontal" size={24} color={type === 'transfer' ? '#fff' : '#007AFF'} />
          <Text style={[styles.typeText, { color: colors.text }, type === 'transfer' && { color: '#fff' }]}>Transfer</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.amountContainer, { backgroundColor: colors.card }]}>
        <Text style={[styles.currencySymbol, { color: colors.textMuted }]}>₹</Text>
        <TextInput
          style={[styles.amountInput, { color: colors.text }]}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Merchant / Payee</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="e.g., Amazon, Grocery Store"
          placeholderTextColor={colors.textMuted}
          value={merchant}
          onChangeText={setMerchant}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Date</Text>
        <TouchableOpacity 
          style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowDatePicker(true)}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
          <Text style={[styles.dateText, { color: colors.text }]}>
            {transactionDate.toLocaleDateString('en-US', { 
              day: 'numeric', 
              month: 'short', 
              year: 'numeric' 
            })}
          </Text>
        </TouchableOpacity>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={transactionDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, selectedDate) => {
            setShowDatePicker(Platform.OS === 'ios');
            if (selectedDate) {
              setTransactionDate(selectedDate);
            }
          }}
          maximumDate={new Date()}
          themeVariant={resolvedTheme === 'dark' ? 'dark' : 'light'}
          textColor={colors.text}
        />
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Description (optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="Add a note..."
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Category</Text>
        <TouchableOpacity
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}
          onPress={() => setShowCategoryPicker(!showCategoryPicker)}
        >
          <Text style={[styles.pickerText, { color: selectedCategoryId ? colors.text : colors.textMuted }]}>
            {selectedCategoryId 
              ? filteredCategories.find(c => c.id === selectedCategoryId)?.name || 'Select Category'
              : 'Select Category'}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.textMuted} style={styles.dropdownIcon} />
        </TouchableOpacity>
        {showCategoryPicker && (
          <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true}>
              {filteredCategories.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={styles.pickerOption}
                  onPress={() => { setSelectedCategoryId(category.id); setShowCategoryPicker(false); }}
                >
                  <Text style={[styles.pickerOptionText, { color: colors.text }]}>{category.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {accounts && accounts.length > 0 && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>
            {type === 'transfer' ? 'From Account' : 'Account'}
          </Text>
          <TouchableOpacity
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}
            onPress={() => setShowAccountPicker(!showAccountPicker)}
          >
            <Text style={[styles.pickerText, { color: selectedAccountId ? colors.text : colors.textMuted }]}>
              {selectedAccountId 
                ? accounts.find(a => a.id === selectedAccountId)?.name || 'Select Account'
                : 'Select Account'}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} style={styles.dropdownIcon} />
          </TouchableOpacity>
          {showAccountPicker && (
            <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true}>
                {accounts.map((account) => (
                  <TouchableOpacity
                    key={account.id}
                    style={styles.pickerOption}
                    onPress={() => { setSelectedAccountId(account.id); setShowAccountPicker(false); }}
                  >
                    <Ionicons 
                      name={account.type === 'bank' ? 'business-outline' : 'card-outline'} 
                      size={16} 
                      color={colors.textMuted}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={[styles.pickerOptionText, { color: colors.text }]}>{account.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {type === 'transfer' && accounts && accounts.length > 0 && (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textMuted }]}>To Account</Text>
          <TouchableOpacity
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, justifyContent: 'center' }]}
            onPress={() => setShowToAccountPicker(!showToAccountPicker)}
          >
            <Text style={[styles.pickerText, { color: selectedToAccountId ? colors.text : colors.textMuted }]}>
              {selectedToAccountId 
                ? accounts.find(a => a.id === selectedToAccountId)?.name || 'Select Account'
                : 'Select Destination Account'}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} style={styles.dropdownIcon} />
          </TouchableOpacity>
          {showToAccountPicker && (
            <View style={[styles.pickerList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true}>
                {accounts.filter(acc => acc.id !== selectedAccountId).map((account) => (
                  <TouchableOpacity
                    key={account.id}
                    style={styles.pickerOption}
                    onPress={() => { setSelectedToAccountId(account.id); setShowToAccountPicker(false); }}
                  >
                    <Ionicons 
                      name={account.type === 'bank' ? 'business-outline' : 'card-outline'} 
                      size={16} 
                      color={colors.textMuted}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={[styles.pickerOptionText, { color: colors.text }]}>{account.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
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
            {isEditMode ? 'Update Transaction' : 'Add Transaction'}
          </Text>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />

      <Modal
        visible={showSmsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSmsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Paste Bank SMS</Text>
              <TouchableOpacity onPress={() => setShowSmsModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.modalDescription, { color: colors.textMuted }]}>
              Copy transaction SMS from your bank and paste below. We'll automatically extract the details.{'\n\n'}
              💡 Tip: Paste multiple SMS separated by blank lines or "---" for bulk parsing!
            </Text>

            <TextInput
              style={[styles.smsInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              placeholder="Paste your bank SMS here...&#10;&#10;Example:&#10;Rs.500.00 debited from A/c XX1234 on 06-Dec-24.&#10;&#10;---&#10;&#10;Rs.200.00 credited to A/c XX1234..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={6}
              value={smsText}
              onChangeText={setSmsText}
              textAlignVertical="top"
            />

            <TouchableOpacity 
              style={[styles.parseButton, { backgroundColor: colors.primary }, isParsing && styles.parseButtonDisabled]} 
              onPress={handleParseSms}
              disabled={isParsing}
            >
              {isParsing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="scan-outline" size={20} color="#fff" />
                  <Text style={styles.parseButtonText}>Parse SMS</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showMerchantMatchModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <Text style={[styles.matchModalSuccessTitle, { color: colors.success }]}>
              Transaction is updated successfully!
            </Text>
            <Text style={[styles.modalDescription, { color: colors.text }]}>
              Select other transactions from "{merchant}" you'd like to update to{' '}
              {categories?.find(c => c.id === selectedCategoryId)?.name || 'this category'}
            </Text>

            <TouchableOpacity
              onPress={() => setSelectedMatchIds(
                selectedMatchIds.size === merchantMatches.length ? new Set() : new Set(merchantMatches.map(m => m.id))
              )}
            >
              <Text style={[styles.matchDeselectAll, { color: colors.primary }]}>
                {selectedMatchIds.size === merchantMatches.length ? 'DE-SELECT ALL' : 'SELECT ALL'}
              </Text>
            </TouchableOpacity>

            <ScrollView style={styles.matchList}>
              {merchantMatches.map((m) => {
                const isSelected = selectedMatchIds.has(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.matchRow}
                    onPress={() => {
                      setSelectedMatchIds(prev => {
                        const next = new Set(prev);
                        if (next.has(m.id)) {
                          next.delete(m.id);
                        } else {
                          next.add(m.id);
                        }
                        return next;
                      });
                    }}
                  >
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.primary : colors.textMuted}
                      style={{ marginRight: 12 }}
                    />
                    <View style={styles.matchRowInfo}>
                      <Text style={[styles.matchRowName, { color: colors.text }]} numberOfLines={1}>
                        {m.merchant}
                      </Text>
                      <Text style={[styles.matchRowMeta, { color: colors.textMuted }]}>
                        {formatDate(m.transactionDate)}
                        {m.account?.name ? ` · ${m.account.name}` : m.account?.accountNumber ? ` · ****${m.account.accountNumber}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.matchRowAmt, { color: colors.text }]}>
                      {formatCurrency(m.amount)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.matchModalFooter}>
              <TouchableOpacity
                style={[styles.matchModalButton, styles.matchModalButtonOutline, { borderColor: colors.border }]}
                onPress={() => {
                  setShowMerchantMatchModal(false);
                  navigation.goBack();
                  Toast.show({
                    type: 'success',
                    text1: 'Transaction Updated',
                    text2: 'Transaction has been updated successfully',
                    position: 'bottom',
                  });
                }}
              >
                <Text style={[styles.matchModalButtonText, { color: colors.text }]}>NO</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.matchModalButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (selectedMatchIds.size === 0 || !selectedCategoryId) {
                    setShowMerchantMatchModal(false);
                    navigation.goBack();
                    Toast.show({
                      type: 'success',
                      text1: 'Transaction Updated',
                      text2: 'Transaction has been updated successfully',
                      position: 'bottom',
                    });
                    return;
                  }
                  bulkCategoryMutation.mutate({ ids: Array.from(selectedMatchIds), categoryId: selectedCategoryId });
                }}
              >
                {bulkCategoryMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.matchModalButtonText, { color: '#fff' }]}>YES</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  smsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    gap: 8,
  },
  smsButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  typeButtonActive: {
  },
  typeButtonIncome: {
  },
  typeButtonIncomeActive: {
  },
  typeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  typeTextActive: {
    color: '#ffffff',
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  currencySymbol: {
    fontSize: 40,
    fontWeight: '300',
    marginRight: 8,
  },
  amountInput: {
    fontSize: 48,
    fontWeight: '700',
    minWidth: 100,
    textAlign: 'center',
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
    borderWidth: 1,
  },
  pickerText: {
    fontSize: 16,
    flex: 1,
  },
  dropdownIcon: {
    position: 'absolute',
    right: 16,
  },
  pickerList: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 200,
    overflow: 'hidden',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  pickerOptionText: {
    fontSize: 16,
    flex: 1,
  },
  dateInput: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '500',
  },
  categoryScroll: {
    flexDirection: 'row',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
  },
  categoryChipActive: {
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: '#ffffff',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalDescription: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  smsInput: {
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    minHeight: 150,
    marginBottom: 16,
  },
  parseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  parseButtonDisabled: {
    opacity: 0.7,
  },
  parseButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  matchModalSuccessTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  matchDeselectAll: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  matchList: {
    maxHeight: 320,
    marginBottom: 16,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  matchRowInfo: {
    flex: 1,
  },
  matchRowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  matchRowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  matchRowAmt: {
    fontSize: 15,
    fontWeight: '600',
  },
  matchModalFooter: {
    flexDirection: 'row',
    gap: 12,
  },
  matchModalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchModalButtonOutline: {
    borderWidth: 1,
  },
  matchModalButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
