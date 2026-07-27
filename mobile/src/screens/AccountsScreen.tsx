import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { api } from '../lib/api';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { RootStackParamList } from '../../App';
import { FABButton } from '../components/FABButton';
import type { Account } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';
import { useSwipeSettings } from '../hooks/useSwipeSettings';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function AccountsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const swipeSettings = useSwipeSettings();
  
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());
  const currentOpenSwipeable = useRef<number | null>(null);

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

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['/api/dashboard'],
    queryFn: api.getDashboard,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      setIsDeleteModalOpen(false);
      setSelectedAccount(null);
      Toast.show({
        type: 'success',
        text1: 'Account Deleted',
        text2: 'Account has been removed successfully',
        position: 'bottom',
      });
    },
    onError: () => {
      setIsDeleteModalOpen(false);
      setSelectedAccount(null);
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: 'Could not delete account. Please try again.',
        position: 'bottom',
      });
    },
  });

  const handleDelete = (account: Account) => {
    setSelectedAccount(account);
    setIsDeleteModalOpen(true);
    // Close the swipeable after showing modal
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
  };

  const confirmDelete = () => {
    if (selectedAccount && !deleteMutation.isPending) {
      deleteMutation.mutate(selectedAccount.id);
    }
  };

  const handleEdit = (account: Account) => {
    // Close the swipeable before navigation
    if (currentOpenSwipeable.current !== null) {
      swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
      currentOpenSwipeable.current = null;
    }
    navigation.navigate('AddAccount', { accountId: account.id });
  };

  const handleCancelDelete = () => {
    setIsDeleteModalOpen(false);
    setSelectedAccount(null);
  };

  const bankAccounts = accounts?.filter(a => a.type === 'bank') || [];
  const creditCards = accounts?.filter(a => a.type === 'credit_card') || [];
  const debitCards = accounts?.filter(a => a.type === 'debit_card') || [];
  const otherAccounts = accounts?.filter(a => a.type === 'wallet' || a.type === 'pf') || [];

  const accountTypeIcon = (type: Account['type']): keyof typeof Ionicons.glyphMap => {
    if (type === 'wallet') return 'cash-outline';
    if (type === 'pf') return 'shield-checkmark-outline';
    return 'business-outline';
  };

  // Helper to get linked bank account name
  const getLinkedAccountName = (linkedAccountId: number | null | undefined) => {
    if (!linkedAccountId) return null;
    const linkedAccount = bankAccounts.find(a => a.id === linkedAccountId);
    return linkedAccount?.name || null;
  };

  const renderRightActions = (account: Account) => {
    const action = swipeSettings.rightAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(account) : handleDelete(account)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderLeftActions = (account: Account) => {
    const action = swipeSettings.leftAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : '#ef4444' }]}
        onPress={() => action === 'edit' ? handleEdit(account) : handleDelete(account)}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderAccountCard = (account: Account) => {
    const isWeb = Platform.OS === 'web';
    const showActionButtons = isWeb || !swipeSettings.enabled;
    const content = (
      <View style={[styles.accountCard, { backgroundColor: colors.card }]}>
        <View style={[styles.accountIcon, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name={accountTypeIcon(account.type)} size={24} color={colors.primary} />
        </View>
        <View style={styles.accountInfo}>
          <View style={styles.accountNameRow}>
            <Text style={[styles.accountName, { color: colors.text }]}>{account.name}</Text>
            {account.isDefault && (
              <View style={[styles.defaultBadge, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                <Text style={[styles.defaultBadgeText, { color: colors.primary }]}>Default</Text>
              </View>
            )}
          </View>
          {account.accountNumber && (
            <Text style={[styles.accountNumber, { color: colors.textMuted }]}>****{account.accountNumber}</Text>
          )}
          <Text style={[styles.accountBalance, { color: colors.primary }]}>{formatCurrency(account.balance)}</Text>
        </View>
        {showActionButtons && (
          <View style={styles.webActions}>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleEdit(account)}
            >
              <Ionicons name="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => handleDelete(account)}
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
          key={account.id}
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(account.id, ref);
            } else {
              swipeableRefs.current.delete(account.id);
            }
          }}
          renderRightActions={() => renderRightActions(account)}
          renderLeftActions={() => renderLeftActions(account)}
          onSwipeableOpen={() => {
            // Close previously opened swipeable
            if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== account.id) {
              swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
            }
            currentOpenSwipeable.current = account.id;
          }}
        >
          {content}
        </Swipeable>
      );
    }

    return <View key={account.id}>{content}</View>;
  };

  const renderCreditCard = (account: Account) => {
    const limit = parseFloat(account.creditLimit || '0');

    // Get spending data from dashboard for this card
    const cardSpending = dashboardData?.creditCardSpending?.find(
      (c: any) => c.accountId === account.id
    );
    
    const spent = cardSpending?.spent || 0;
    const monthlyLimit = account.monthlySpendingLimit ? parseFloat(account.monthlySpendingLimit) : null;
    const hasMonthlyLimit = monthlyLimit !== null && monthlyLimit > 0;

    // Calculate percentages based on total credit limit
    const spentPercent = limit > 0 ? (spent / limit) * 100 : 0;
    const monthlyLimitPercent = hasMonthlyLimit && limit > 0 ? ((monthlyLimit || 0) / limit) * 100 : 0;

    // Color logic: red if spent exceeds monthly limit, otherwise primary
    const spentColor = hasMonthlyLimit && spent > (monthlyLimit || 0) ? '#ef4444' : colors.primary;

    const isWeb = Platform.OS === 'web';
    const showActionButtons = isWeb || !swipeSettings.enabled;
    const content = (
      <View style={[styles.accountCard, { backgroundColor: colors.card }]}>
        <View style={[styles.accountIcon, { backgroundColor: colors.danger + '20' }]}>
          <Ionicons name="card-outline" size={24} color={colors.danger} />
        </View>
        <View style={styles.accountInfo}>
          <Text style={[styles.accountName, { color: colors.text }]}>{account.name}</Text>
          {account.accountNumber && (
            <Text style={[styles.accountNumber, { color: colors.textMuted }]}>****{account.accountNumber}</Text>
          )}
          
          {/* Consolidated Progress Bar */}
          <View style={styles.consolidatedBarSection}>
            <View style={styles.consolidatedBarContainer}>
              <View style={[styles.consolidatedBarBg, { backgroundColor: colors.border }]}>
                {/* Spent fill */}
                <View 
                  style={[
                    styles.consolidatedBarFill, 
                    { 
                      width: `${Math.min(spentPercent, 100)}%`,
                      backgroundColor: spentColor
                    }
                  ]} 
                />
                {/* Monthly limit marker */}
                {hasMonthlyLimit && (
                  <View 
                    style={[
                      styles.limitMarker,
                      { 
                        left: `${Math.min(monthlyLimitPercent, 100)}%`,
                        backgroundColor: '#374151'
                      }
                    ]}
                  />
                )}
              </View>
            </View>
            
            {/* Labels below the bar */}
            <View style={styles.consolidatedLabels}>
              <Text style={[styles.consolidatedLabel, { color: colors.textMuted }]}>
                Spent: <Text style={{ fontWeight: '600', color: spentColor }}>{formatCurrency(spent)}</Text>
              </Text>
              {hasMonthlyLimit && (
                <Text style={[styles.consolidatedLabel, { color: colors.textMuted }]}>
                  Limit: <Text style={{ fontWeight: '600', color: colors.text }}>{formatCurrency(monthlyLimit)}</Text>
                </Text>
              )}
              <Text style={[styles.consolidatedLabel, { color: colors.textMuted }]}>
                Total: <Text style={{ fontWeight: '600', color: colors.text }}>{formatCurrency(limit)}</Text>
              </Text>
            </View>
          </View>

          {account.billingDate && (
            <Text style={[styles.billingDateText, { color: colors.textMuted }]}>
              Billing: {account.billingDate}th of every month
            </Text>
          )}
        </View>
        {showActionButtons && (
          <View style={styles.webActions}>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleEdit(account)}
            >
              <Ionicons name="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => handleDelete(account)}
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
          key={account.id}
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(account.id, ref);
            } else {
              swipeableRefs.current.delete(account.id);
            }
          }}
          renderRightActions={() => renderRightActions(account)}
          renderLeftActions={() => renderLeftActions(account)}
          onSwipeableOpen={() => {
            // Close previously opened swipeable
            if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== account.id) {
              swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
            }
            currentOpenSwipeable.current = account.id;
          }}
        >
          {content}
        </Swipeable>
      );
    }

    return <View key={account.id}>{content}</View>;
  };

  const renderDebitCard = (account: Account) => {
    const linkedAccountName = getLinkedAccountName(account.linkedAccountId);
    const isWeb = Platform.OS === 'web';
    const showActionButtons = isWeb || !swipeSettings.enabled;
    const content = (
      <View style={[styles.accountCard, { backgroundColor: colors.card }]}>
        <View style={[styles.accountIcon, { backgroundColor: colors.success + '20' }]}>
          <Ionicons name="wallet-outline" size={24} color={colors.success} />
        </View>
        <View style={styles.accountInfo}>
          <View style={styles.accountNameRow}>
            <Text style={[styles.accountName, { color: colors.text }]}>{account.name}</Text>
          </View>
          {account.accountNumber && (
            <Text style={[styles.accountNumber, { color: colors.textMuted }]}>****{account.accountNumber}</Text>
          )}
          {linkedAccountName && (
            <View style={styles.linkedAccountRow}>
              <Ionicons name="link-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.linkedAccountText, { color: colors.textMuted }]}>
                Linked to {linkedAccountName}
              </Text>
            </View>
          )}
        </View>
        {showActionButtons && (
          <View style={styles.webActions}>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleEdit(account)}
            >
              <Ionicons name="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => handleDelete(account)}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );

    const isSwipeEnabled = swipeSettings.enabled && Platform.OS !== 'web';
    
    if (isSwipeEnabled) {
      return (
        <Swipeable
          key={account.id}
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(account.id, ref);
            } else {
              swipeableRefs.current.delete(account.id);
            }
          }}
          renderRightActions={() => renderRightActions(account)}
          renderLeftActions={() => renderLeftActions(account)}
          onSwipeableOpen={() => {
            if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== account.id) {
              swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
            }
            currentOpenSwipeable.current = account.id;
          }}
        >
          {content}
        </Swipeable>
      );
    }

    return <View key={account.id}>{content}</View>;
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
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Bank Accounts</Text>
          {bankAccounts.length > 0 ? (
            bankAccounts.map((account) => renderAccountCard(account))
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <Ionicons name="business-outline" size={32} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No bank accounts</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Credit Cards</Text>
          {creditCards.length > 0 ? (
            creditCards.map((account) => renderCreditCard(account))
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <Ionicons name="card-outline" size={32} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No credit cards</Text>
            </View>
          )}
        </View>

        {debitCards.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Debit Cards</Text>
            {debitCards.map((account) => renderDebitCard(account))}
          </View>
        )}

        {otherAccounts.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Other Accounts</Text>
            {otherAccounts.map((account) => renderAccountCard(account))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <FABButton onPress={() => navigation.navigate('AddAccount')} icon="add" />
      
      {/* Delete Confirmation Modal */}
      <Modal
        visible={isDeleteModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsDeleteModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalIcon, { backgroundColor: '#fee2e2' }]}>
              <Ionicons name="trash-outline" size={32} color="#ef4444" />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Account</Text>
            <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
              Are you sure you want to delete "{selectedAccount?.name}"? This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel, { backgroundColor: colors.border }]}
                onPress={handleCancelDelete}
                disabled={deleteMutation.isPending}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonDelete]}
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Delete</Text>
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
  scrollView: {
    flex: 1,
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  accountIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  accountInfo: {
    flex: 1,
  },
  accountNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '600',
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  defaultBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  accountNumber: {
    fontSize: 13,
    marginTop: 2,
  },
  accountBalance: {
    fontSize: 18,
    fontWeight: '700',
  },
  consolidatedBarSection: {
    marginTop: 12,
  },
  consolidatedBarContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  consolidatedBarBg: {
    height: 10,
    borderRadius: 5,
    overflow: 'visible',
    position: 'relative',
  },
  consolidatedBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  limitMarker: {
    position: 'absolute',
    width: 3,
    height: 20,
    top: -4,
    marginLeft: -1.5,
    borderRadius: 1.5,
  },
  consolidatedLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  consolidatedLabel: {
    fontSize: 11,
  },
  billingDateText: {
    fontSize: 11,
    marginTop: 4,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    marginTop: 8,
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
    alignItems: 'center',
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f3f4f6',
  },
  modalButtonDelete: {
    backgroundColor: '#ef4444',
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  linkedAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  linkedAccountText: {
    fontSize: 12,
  },
});
