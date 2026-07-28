import { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, Switch } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { api } from '../lib/api';
import type { Insurance, InsurancePremium, Account } from '../lib/types';
import { useTheme } from '../contexts/ThemeContext';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function InsuranceDetailsScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const route = useRoute();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const insuranceId = (route.params as any)?.insuranceId;

  const [activeTab, setActiveTab] = useState<'upcoming' | 'paid'>('upcoming');
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [selectedPremium, setSelectedPremium] = useState<InsurancePremium | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>();
  const [createTransaction, setCreateTransaction] = useState(false);
  const [affectAccountBalance, setAffectAccountBalance] = useState(true);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const { data: insurance, isLoading } = useQuery<Insurance>({
    queryKey: ['/api/insurances', insuranceId],
    queryFn: () => api.getInsurance(insuranceId),
    enabled: !!insuranceId,
  });

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ['/api/accounts'],
    queryFn: () => api.getAccounts(),
  });

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurances', insuranceId] });
    }, [insuranceId])
  );

  const payMutation = useMutation({
    mutationFn: ({ premiumId, data }: { premiumId: number; data: { amount: string; accountId?: number; createTransaction?: boolean; affectAccountBalance?: boolean } }) => 
      api.markPremiumPaid(insuranceId, premiumId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insurances'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      setPayModalVisible(false);
      setSelectedPremium(null);
      Toast.show({
        type: 'success',
        text1: 'Premium Paid',
        text2: 'The premium has been marked as paid',
        position: 'bottom',
      });
    },
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: error.message || 'Failed to mark premium as paid',
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
      case 'health': return 'Health Insurance';
      case 'life': return 'Life Insurance';
      case 'vehicle': return 'Vehicle Insurance';
      case 'home': return 'Home Insurance';
      case 'term': return 'Term Insurance';
      case 'travel': return 'Travel Insurance';
      default: return type;
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return colors.textMuted;
      case 'paid': return colors.primary;
      case 'overdue': return colors.danger;
      case 'partially_paid': return '#f97316';
      default: return colors.textMuted;
    }
  };

  const handlePayPress = (premium: InsurancePremium) => {
    setSelectedPremium(premium);
    setPayAmount(premium.amount);
    setSelectedAccountId(insurance?.accountId || undefined);
    setCreateTransaction(insurance?.createTransaction || false);
    setAffectAccountBalance(true);
    setPayModalVisible(true);
  };

  const handleConfirmPay = () => {
    if (!selectedPremium || !payAmount) return;
    
    payMutation.mutate({
      premiumId: selectedPremium.id,
      data: {
        amount: payAmount,
        accountId: selectedAccountId,
        createTransaction,
        affectAccountBalance,
      },
    });
  };

  const upcomingPremiums = useMemo(() => {
    if (!insurance?.premiums) return [];
    return insurance.premiums
      .filter(p => p.status === 'pending' || p.status === 'overdue')
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [insurance]);

  const paidPremiums = useMemo(() => {
    if (!insurance?.premiums) return [];
    return insurance.premiums
      .filter(p => p.status === 'paid' || p.status === 'partially_paid')
      .sort((a, b) => new Date(b.paidDate || b.dueDate).getTime() - new Date(a.paidDate || a.dueDate).getTime());
  }, [insurance]);

  const selectedAccount = accounts?.find(a => a.id === selectedAccountId);

  if (isLoading || !insurance) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const totalPaid = paidPremiums.reduce((sum, p) => sum + parseFloat(p.paidAmount || p.amount), 0);
  const totalDue = upcomingPremiums.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, { backgroundColor: colors.card }]}>
          <View style={styles.headerTop}>
            <View style={[styles.iconContainer, { backgroundColor: `${colors.primary}20` }]}>
              <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
            </View>
            <TouchableOpacity
              onPress={() => (navigation as any).navigate('AddInsurance', { insuranceId: insurance.id })}
              data-testid="button-edit-insurance"
            >
              <Ionicons name="settings-outline" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.nameStatusRow}>
            <Text style={[styles.insuranceName, { color: colors.text }]}>{insurance.name}</Text>
            {insurance.status && (
              <View style={[
                styles.statusBadge, 
                { 
                  backgroundColor: insurance.status === 'active' ? `${colors.success}20` :
                    insurance.status === 'paid_up' ? `${colors.primary}20` :
                    insurance.status === 'expired' || insurance.status === 'lapsed' ? `${colors.danger}20` :
                    `${colors.textMuted}20`
                }
              ]}>
                <Ionicons 
                  name={
                    insurance.status === 'active' ? 'checkmark-circle' :
                    insurance.status === 'paid_up' ? 'ribbon' :
                    insurance.status === 'expired' ? 'time' :
                    insurance.status === 'lapsed' ? 'alert-circle' :
                    'close-circle'
                  } 
                  size={12} 
                  color={
                    insurance.status === 'active' ? colors.success :
                    insurance.status === 'paid_up' ? colors.primary :
                    insurance.status === 'expired' || insurance.status === 'lapsed' ? colors.danger :
                    colors.textMuted
                  } 
                />
                <Text style={[
                  styles.statusText, 
                  { 
                    color: insurance.status === 'active' ? colors.success :
                      insurance.status === 'paid_up' ? colors.primary :
                      insurance.status === 'expired' || insurance.status === 'lapsed' ? colors.danger :
                      colors.textMuted
                  }
                ]}>
                  {insurance.status === 'paid_up' ? 'Paid Up' : 
                   insurance.status.charAt(0).toUpperCase() + insurance.status.slice(1)}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.insuranceType, { color: colors.textMuted }]}>
            {getInsuranceTypeLabel(insurance.type)}
          </Text>

          {insurance.providerName && (
            <View style={styles.providerRow}>
              <Ionicons name="business-outline" size={16} color={colors.textMuted} />
              <Text style={[styles.providerText, { color: colors.textMuted }]}>{insurance.providerName}</Text>
            </View>
          )}

          {insurance.autoFunded && (
            <View style={[styles.autoFundedBanner, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="sync-outline" size={16} color={colors.primary} />
              <Text style={[styles.autoFundedText, { color: colors.primary }]}>
                {insurance.linkedInsurance
                  ? `Auto-funded by ${insurance.linkedInsurance.name} — no payment needed`
                  : 'Auto-funded — no payment needed'}
              </Text>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Premium</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {formatCurrency(parseFloat(insurance.premiumAmount))}
              </Text>
              <Text style={[styles.detailSub, { color: colors.textMuted }]}>
                {getFrequencyLabel(insurance.premiumFrequency)}
              </Text>
            </View>

            <View style={styles.detailItem}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Terms</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {insurance.termsPerPeriod}
              </Text>
              <Text style={[styles.detailSub, { color: colors.textMuted }]}>
                per period
              </Text>
            </View>

            {insurance.coverageAmount && (
              <View style={styles.detailItem}>
                <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Coverage</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {formatCurrency(parseFloat(insurance.coverageAmount))}
                </Text>
                <Text style={[styles.detailSub, { color: colors.textMuted }]}>
                  sum insured
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.periodRow}>
            <View style={styles.periodItem}>
              <Text style={[styles.periodLabel, { color: colors.textMuted }]}>Start</Text>
              <Text style={[styles.periodValue, { color: colors.text }]}>{formatDate(insurance.startDate)}</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
            <View style={styles.periodItem}>
              <Text style={[styles.periodLabel, { color: colors.textMuted }]}>End</Text>
              <Text style={[styles.periodValue, { color: colors.text }]}>
                {insurance.endDate ? formatDate(insurance.endDate) : 'Ongoing'}
              </Text>
            </View>
          </View>
        </View>

        {(insurance.policyTermYears || insurance.premiumPaymentTermYears || insurance.maturityAmount) && (
          <View style={[styles.termsCard, { backgroundColor: colors.card }]}>
            <View style={styles.termsHeader}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <Text style={[styles.termsTitle, { color: colors.text }]}>Policy & Payment Terms</Text>
            </View>
            
            {(insurance.policyTermYears || insurance.premiumPaymentTermYears) && (
              <>
                <View style={styles.termsTimeline}>
                  {insurance.premiumPaymentTermYears && (
                    <View style={styles.termBlock}>
                      <View style={[styles.termBar, { backgroundColor: colors.primary }]}>
                        <Ionicons name="wallet-outline" size={14} color="#fff" />
                      </View>
                      <Text style={[styles.termYears, { color: colors.text }]}>
                        {insurance.premiumPaymentTermYears} years
                      </Text>
                      <Text style={[styles.termLabel, { color: colors.textMuted }]}>Premium Payment</Text>
                    </View>
                  )}
                  
                  {insurance.policyTermYears && (
                    <View style={styles.termBlock}>
                      <View style={[styles.termBar, { backgroundColor: colors.success }]}>
                        <Ionicons name="shield-checkmark-outline" size={14} color="#fff" />
                      </View>
                      <Text style={[styles.termYears, { color: colors.text }]}>
                        {insurance.policyTermYears} years
                      </Text>
                      <Text style={[styles.termLabel, { color: colors.textMuted }]}>Policy Term</Text>
                    </View>
                  )}
                </View>

                {insurance.policyTermYears && insurance.premiumPaymentTermYears && 
                 insurance.policyTermYears > insurance.premiumPaymentTermYears && (
                  <View style={[styles.paidUpNote, { backgroundColor: `${colors.success}15` }]}>
                    <Ionicons name="information-circle" size={16} color={colors.success} />
                    <Text style={[styles.paidUpNoteText, { color: colors.success }]}>
                      After {insurance.premiumPaymentTermYears} years, policy continues for {insurance.policyTermYears - insurance.premiumPaymentTermYears} more years without premium payments
                    </Text>
                  </View>
                )}
              </>
            )}

            {insurance.maturityAmount && (
              <View style={[styles.maturitySection, { borderTopColor: colors.border }]}>
                <View style={styles.maturityRow}>
                  <View>
                    <Text style={[styles.maturityLabel, { color: colors.textMuted }]}>Maturity Amount</Text>
                    <Text style={[styles.maturityValue, { color: colors.primary }]}>
                      {formatCurrency(parseFloat(insurance.maturityAmount))}
                    </Text>
                  </View>
                  <Ionicons name="gift-outline" size={24} color={colors.primary} />
                </View>
              </View>
            )}
          </View>
        )}

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Total Paid</Text>
              <Text style={[styles.summaryValue, { color: colors.primary }]}>
                {formatCurrency(totalPaid)}
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Upcoming Due</Text>
              <Text style={[styles.summaryValue, { color: totalDue > 0 ? colors.danger : colors.text }]}>
                {formatCurrency(totalDue)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'upcoming' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
            ]}
            onPress={() => setActiveTab('upcoming')}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === 'upcoming' ? colors.primary : colors.textMuted }
            ]}>
              Upcoming ({upcomingPremiums.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'paid' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
            ]}
            onPress={() => setActiveTab('paid')}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === 'paid' ? colors.primary : colors.textMuted }
            ]}>
              Paid ({paidPremiums.length})
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.premiumsList}>
          {activeTab === 'upcoming' ? (
            upcomingPremiums.length > 0 ? (
              upcomingPremiums.map((premium) => (
                <View key={premium.id} style={[styles.premiumCard, { backgroundColor: colors.card }]}>
                  <View style={styles.premiumHeader}>
                    <View>
                      <Text style={[styles.premiumTerm, { color: colors.text }]}>
                        Term {premium.termNumber} - {premium.periodYear}
                      </Text>
                      <Text style={[styles.premiumDue, { color: premium.status === 'overdue' ? colors.danger : colors.textMuted }]}>
                        Due: {formatDate(premium.dueDate)}
                        {premium.status === 'overdue' && ' (Overdue)'}
                      </Text>
                    </View>
                    <Text style={[styles.premiumAmount, { color: colors.text }]}>
                      {formatCurrency(parseFloat(premium.amount))}
                    </Text>
                  </View>
                  {!insurance?.autoFunded && (
                    <TouchableOpacity
                      style={[styles.payButton, { backgroundColor: colors.primary }]}
                      onPress={() => handlePayPress(premium)}
                      data-testid={`button-pay-premium-${premium.id}`}
                    >
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={styles.payButtonText}>Mark as Paid</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>All Caught Up!</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  No upcoming premium payments
                </Text>
              </View>
            )
          ) : (
            paidPremiums.length > 0 ? (
              paidPremiums.map((premium) => (
                <View key={premium.id} style={[styles.premiumCard, { backgroundColor: colors.card }]}>
                  <View style={styles.premiumHeader}>
                    <View>
                      <Text style={[styles.premiumTerm, { color: colors.text }]}>
                        Term {premium.termNumber} - {premium.periodYear}
                      </Text>
                      <Text style={[styles.premiumDue, { color: colors.textMuted }]}>
                        Paid: {premium.paidDate ? formatDate(premium.paidDate) : 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.paidInfo}>
                      <Text style={[styles.premiumAmount, { color: colors.primary }]}>
                        {formatCurrency(parseFloat(premium.paidAmount || premium.amount))}
                      </Text>
                      <View style={[styles.paidBadge, { backgroundColor: `${colors.primary}20` }]}>
                        <Ionicons name="checkmark" size={12} color={colors.primary} />
                        <Text style={[styles.paidText, { color: colors.primary }]}>Paid</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No Payments Yet</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  Paid premiums will appear here
                </Text>
              </View>
            )
          )}
        </View>
      </ScrollView>

      <Modal
        visible={payModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPayModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Mark Premium as Paid</Text>
              <TouchableOpacity onPress={() => setPayModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalSubtitle, { color: colors.danger }]}>
              This action cannot be undone.
            </Text>

            {selectedPremium && (
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                Term {selectedPremium.termNumber} - Due {formatDate(selectedPremium.dueDate)}
              </Text>
            )}

            <View style={styles.modalField}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Amount Paid</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                value={payAmount}
                onChangeText={setPayAmount}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.modalField}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Payment Account</Text>
              <TouchableOpacity
                style={[styles.accountSelector, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setShowAccountPicker(!showAccountPicker)}
              >
                <Text style={[styles.accountText, { color: selectedAccount ? colors.text : colors.textMuted }]}>
                  {selectedAccount ? selectedAccount.name : 'Select Account'}
                </Text>
                <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              {showAccountPicker && accounts && (
                <View style={[styles.accountDropdown, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.accountOption}
                    onPress={() => { setSelectedAccountId(undefined); setShowAccountPicker(false); }}
                  >
                    <Text style={[styles.accountOptionText, { color: colors.textMuted }]}>None</Text>
                  </TouchableOpacity>
                  {accounts.map((account) => (
                    <TouchableOpacity
                      key={account.id}
                      style={styles.accountOption}
                      onPress={() => { setSelectedAccountId(account.id); setShowAccountPicker(false); }}
                    >
                      <Text style={[styles.accountOptionText, { color: colors.text }]}>{account.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, { color: colors.text }]}>Create Transaction</Text>
                <Text style={[styles.toggleHint, { color: colors.textMuted }]}>
                  Record this payment as a transaction
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
                  Deduct payment from account balance
                </Text>
              </View>
              <Switch
                value={affectAccountBalance}
                onValueChange={setAffectAccountBalance}
                trackColor={{ false: colors.border, true: colors.primary }}
                disabled={!selectedAccountId}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.border }]}
                onPress={() => setPayModalVisible(false)}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={handleConfirmPay}
                disabled={payMutation.isPending}
              >
                {payMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Confirm</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  insuranceName: {
    fontSize: 22,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  insuranceType: {
    fontSize: 14,
    marginBottom: 8,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  providerText: {
    fontSize: 13,
  },
  autoFundedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  autoFundedText: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  divider: {
    height: 1,
    marginVertical: 16,
  },
  detailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  detailItem: {
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  detailSub: {
    fontSize: 11,
    marginTop: 2,
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  periodItem: {
    flex: 1,
  },
  periodLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  periodValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  termsCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  termsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  termsTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  termsTimeline: {
    flexDirection: 'row',
    gap: 16,
  },
  termBlock: {
    flex: 1,
    alignItems: 'center',
  },
  termBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    width: '100%',
    marginBottom: 8,
  },
  termYears: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  termLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
  paidUpNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  paidUpNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  maturitySection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  maturityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  maturityLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  maturityValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  summaryCard: {
    marginHorizontal: 16,
    marginBottom: 16,
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
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  premiumsList: {
    padding: 16,
    paddingBottom: 32,
  },
  premiumCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  premiumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  premiumTerm: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  premiumDue: {
    fontSize: 13,
  },
  premiumAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  paidInfo: {
    alignItems: 'flex-end',
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
    gap: 4,
  },
  paidText: {
    fontSize: 11,
    fontWeight: '600',
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  payButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalSubtitle: {
    fontSize: 13,
    marginBottom: 20,
  },
  modalField: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    marginBottom: 8,
  },
  modalInput: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  accountSelector: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  accountText: {
    fontSize: 15,
  },
  accountDropdown: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accountOption: {
    padding: 12,
    borderBottomWidth: 0.5,
  },
  accountOptionText: {
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 16,
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
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
