import { useState, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Modal, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { api } from '../lib/api';
import type { Insurance } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';
import { useSwipeSettings } from '../hooks/useSwipeSettings';

type RootStackParamList = {
  Insurance: undefined;
  InsuranceDetails: { insuranceId: number };
  AddInsurance: { insuranceId?: number };
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function InsuranceScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const swipeSettings = useSwipeSettings();
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());
  const currentOpenSwipeable = useRef<number | null>(null);

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [insuranceToDelete, setInsuranceToDelete] = useState<Insurance | null>(null);

  useFocusEffect(
    useCallback(() => {
      return () => {
        swipeableRefs.current.forEach(ref => ref?.close());
        currentOpenSwipeable.current = null;
      };
    }, [])
  );

  const { data: insurances, isLoading } = useQuery<Insurance[]>({
    queryKey: ['/api/insurances'],
    queryFn: () => api.getInsurances(),
  });

  const deleteMutation = useMutation({
    mutationFn: (insuranceId: number) => api.deleteInsurance(insuranceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurances'] });
      setDeleteModalVisible(false);
      setInsuranceToDelete(null);
      Toast.show({
        type: 'success',
        text1: 'Insurance Deleted',
        text2: 'The insurance policy has been deleted',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      setDeleteModalVisible(false);
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: error.message || 'Could not delete insurance',
        position: 'bottom',
      });
    },
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  };

  const getInsuranceTypeLabel = (type: string) => {
    switch (type) {
      case 'health': return 'Health';
      case 'life': return 'Life';
      case 'vehicle': return 'Vehicle';
      case 'home': return 'Home';
      case 'term': return 'Term';
      case 'travel': return 'Travel';
      default: return type;
    }
  };

  const getInsuranceIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'health': return 'medkit';
      case 'life': return 'heart';
      case 'vehicle': return 'car';
      case 'home': return 'home';
      case 'term': return 'shield-checkmark';
      case 'travel': return 'airplane';
      default: return 'shield';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return colors.primary;
      case 'expired': return colors.textMuted;
      case 'cancelled': return colors.danger;
      case 'lapsed': return '#f97316';
      default: return colors.textMuted;
    }
  };

  const getFrequencyLabel = (frequency: string) => {
    switch (frequency) {
      case 'annual': return 'Annual';
      case 'semi_annual': return 'Semi-Annual';
      case 'quarterly': return 'Quarterly';
      case 'monthly': return 'Monthly';
      default: return frequency;
    }
  };

  const getNextPremiumDue = (insurance: Insurance) => {
    if (!insurance.premiums || insurance.premiums.length === 0) return null;
    const pending = insurance.premiums.filter(p => p.status === 'pending' || p.status === 'overdue');
    if (pending.length === 0) return null;
    return pending.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  };

  const handleSwipeableOpen = (id: number) => {
    if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== id) {
      const prevRef = swipeableRefs.current.get(currentOpenSwipeable.current);
      prevRef?.close();
    }
    currentOpenSwipeable.current = id;
  };

  const handleEdit = (insurance: Insurance) => {
    swipeableRefs.current.get(insurance.id)?.close();
    navigation.navigate('AddInsurance', { insuranceId: insurance.id });
  };

  const handleDelete = (insurance: Insurance) => {
    swipeableRefs.current.get(insurance.id)?.close();
    setInsuranceToDelete(insurance);
    setDeleteModalVisible(true);
  };

  const renderRightActions = (insurance: Insurance) => {
    const action = swipeSettings.rightAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : colors.danger }]}
        onPress={() => action === 'edit' ? handleEdit(insurance) : handleDelete(insurance)}
        data-testid={`button-${action}-insurance-${insurance.id}`}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderLeftActions = (insurance: Insurance) => {
    const action = swipeSettings.leftAction;
    return (
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: action === 'edit' ? colors.primary : colors.danger }]}
        onPress={() => action === 'edit' ? handleEdit(insurance) : handleDelete(insurance)}
        data-testid={`button-${action}-insurance-left-${insurance.id}`}
      >
        <Ionicons name={action === 'edit' ? 'pencil' : 'trash-outline'} size={24} color="#fff" />
        <Text style={styles.swipeActionText}>{action === 'edit' ? 'Edit' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  };

  const renderInsuranceItem = ({ item }: { item: Insurance }) => {
    const nextPremium = getNextPremiumDue(item);
    const paidCount = item.premiums?.filter(p => p.status === 'paid').length || 0;
    const totalCount = item.premiums?.length || 0;
    const isWeb = Platform.OS === 'web';
    const showActionButtons = isWeb || !swipeSettings.enabled;

    const content = (
      <View style={[styles.insuranceCard, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          onPress={() => navigation.navigate('InsuranceDetails', { insuranceId: item.id })}
          data-testid={`card-insurance-${item.id}`}
          style={{ flex: 1 }}
        >
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
            <Ionicons name={getInsuranceIcon(item.type)} size={24} color={getStatusColor(item.status)} />
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.insuranceName, { color: colors.text }]}>{item.name}</Text>
            <View style={styles.typeRow}>
              <Text style={[styles.insuranceType, { color: colors.textMuted }]}>
                {getInsuranceTypeLabel(item.type)}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                  {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </Text>
              </View>
              {item.autoFunded && (
                <View style={[styles.statusBadge, { backgroundColor: `${colors.primary}20` }]}>
                  <Text style={[styles.statusText, { color: colors.primary }]}>Auto-funded</Text>
                </View>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Premium</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {formatCurrency(parseFloat(item.premiumAmount))} / {getFrequencyLabel(item.premiumFrequency)}
            </Text>
          </View>
          {item.termsPerPeriod > 1 && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Payment Terms</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {item.termsPerPeriod} installments
              </Text>
            </View>
          )}
          {item.providerName && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Provider</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{item.providerName}</Text>
            </View>
          )}
          {nextPremium && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Next Due</Text>
              <Text style={[
                styles.detailValue, 
                { color: nextPremium.status === 'overdue' ? colors.danger : colors.text }
              ]}>
                {formatDate(nextPremium.dueDate)} - {formatCurrency(parseFloat(nextPremium.amount))}
              </Text>
            </View>
          )}
          {totalCount > 0 && (
            <View style={styles.progressContainer}>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressLabel, { color: colors.textMuted }]}>
                  Payments: {paidCount}/{totalCount}
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                <View 
                  style={[
                    styles.progressFill, 
                    { 
                      width: `${(paidCount / totalCount) * 100}%`,
                      backgroundColor: colors.primary 
                    }
                  ]} 
                />
              </View>
            </View>
          )}
        </View>
        </TouchableOpacity>
        {showActionButtons && (
          <View style={styles.webActions}>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: colors.primary }]}
              onPress={() => handleEdit(item)}
            >
              <Ionicons name="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.webActionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => handleDelete(item)}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );

    if (swipeSettings.enabled) {
      return (
        <Swipeable
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(item.id, ref);
            } else {
              swipeableRefs.current.delete(item.id);
            }
          }}
          renderRightActions={() => renderRightActions(item)}
          renderLeftActions={() => renderLeftActions(item)}
          onSwipeableOpen={() => {
            if (currentOpenSwipeable.current !== null && currentOpenSwipeable.current !== item.id) {
              swipeableRefs.current.get(currentOpenSwipeable.current)?.close();
            }
            currentOpenSwipeable.current = item.id;
          }}
        >
          {content}
        </Swipeable>
      );
    }

    return content;
  };

  const totalPremiums = useMemo(() => {
    if (!insurances) return 0;
    return insurances
      .filter(i => i.status === 'active')
      .reduce((sum, i) => sum + parseFloat(i.premiumAmount), 0);
  }, [insurances]);

  const activeCount = useMemo(() => {
    return insurances?.filter(i => i.status === 'active').length || 0;
  }, [insurances]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Active Policies</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{activeCount}</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Total Premium</Text>
            <Text style={[styles.summaryValue, { color: colors.primary }]}>
              {formatCurrency(totalPremiums)}
            </Text>
          </View>
        </View>
      </View>

      {insurances && insurances.length > 0 ? (
        <FlatList
          data={insurances}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderInsuranceItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="shield-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Insurance Policies</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Add your insurance policies to track premiums and renewals
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('AddInsurance', {})}
        data-testid="button-add-insurance"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Insurance?</Text>
            <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
              Are you sure you want to delete "{insuranceToDelete?.name}"? This will also remove all premium records.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.border }]}
                onPress={() => setDeleteModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.danger }]}
                onPress={() => insuranceToDelete && deleteMutation.mutate(insuranceToDelete.id)}
              >
                <Text style={[styles.modalButtonText, { color: '#fff' }]}>Delete</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 40,
  },
  summaryLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  insuranceCard: {
    borderRadius: 12,
    marginBottom: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  insuranceName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  insuranceType: {
    fontSize: 13,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  cardDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  progressContainer: {
    marginTop: 8,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
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
  swipeActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  swipeAction: {
    width: 70,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginLeft: 4,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '500',
  },
  webActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    paddingTop: 0,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
