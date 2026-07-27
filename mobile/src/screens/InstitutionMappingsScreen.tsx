import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { getThemedColors, formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';
import type { Account, SenderInstitutionMapping } from '../lib/types';

const ACCOUNT_TYPES: { value: Account['type']; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'bank', label: 'Bank', icon: 'business-outline' },
  { value: 'credit_card', label: 'Credit Card', icon: 'card-outline' },
  { value: 'debit_card', label: 'Debit Card', icon: 'wallet-outline' },
  { value: 'wallet', label: 'Wallet', icon: 'cash-outline' },
  { value: 'pf', label: 'PF', icon: 'shield-checkmark-outline' },
];

export default function InstitutionMappingsScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const queryClient = useQueryClient();

  const [mapModalMapping, setMapModalMapping] = useState<SenderInstitutionMapping | null>(null);
  const [createModalMapping, setCreateModalMapping] = useState<SenderInstitutionMapping | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Account['type']>('bank');
  const [newBalance, setNewBalance] = useState('');

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['/api/institution-mappings/pending'],
    queryFn: api.getPendingInstitutionMappings,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['/api/accounts'],
    queryFn: api.getAccounts,
  });

  const invalidateAfterResolve = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/institution-mappings/pending'] });
    queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
    queryClient.invalidateQueries({ queryKey: ['/api/transactions'] });
    queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
  };

  const mapMutation = useMutation({
    mutationFn: ({ mappingId, accountId }: { mappingId: number; accountId: number }) =>
      api.mapInstitutionToExistingAccount(mappingId, accountId),
    onSuccess: (result) => {
      invalidateAfterResolve();
      setMapModalMapping(null);
      Toast.show({
        type: 'success',
        text1: 'Account Linked',
        text2: `${result.backfilled} transaction${result.backfilled === 1 ? '' : 's'} added to ${result.account.name}`,
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Link Account', position: 'bottom' });
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ mappingId, data }: { mappingId: number; data: any }) =>
      api.createAccountForInstitution(mappingId, data),
    onSuccess: (result) => {
      invalidateAfterResolve();
      setCreateModalMapping(null);
      Toast.show({
        type: 'success',
        text1: 'Account Created',
        text2: `${result.backfilled} transaction${result.backfilled === 1 ? '' : 's'} added to ${result.account.name}`,
        position: 'bottom',
      });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Create Account', position: 'bottom' });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (mappingId: number) => api.ignoreInstitutionMapping(mappingId),
    onSuccess: () => {
      invalidateAfterResolve();
      Toast.show({ type: 'success', text1: 'Institution Ignored', text2: "You won't be asked about this again", position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Ignore', position: 'bottom' });
    },
  });

  const openCreateModal = (mapping: SenderInstitutionMapping) => {
    setNewName(mapping.suggestedName || mapping.institutionKey);
    setNewType('bank');
    setNewBalance(mapping.latestAvailableBalance != null ? mapping.latestAvailableBalance.toString() : '');
    setCreateModalMapping(mapping);
  };

  const handleIgnore = (mapping: SenderInstitutionMapping) => {
    Alert.alert(
      'Ignore this institution?',
      `Future messages from "${mapping.suggestedName || mapping.institutionKey}" will be logged but never turned into transactions. You can't undo this from here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Ignore', style: 'destructive', onPress: () => ignoreMutation.mutate(mapping.id) },
      ]
    );
  };

  const handleCreateSubmit = () => {
    if (!createModalMapping) return;
    if (!newName.trim()) {
      Toast.show({ type: 'error', text1: 'Enter an account name', position: 'bottom' });
      return;
    }
    createMutation.mutate({
      mappingId: createModalMapping.id,
      data: {
        name: newName.trim(),
        type: newType,
        balance: newBalance.trim() || '0',
      },
    });
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.infoCard, { backgroundColor: `${colors.primary}15` }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.text }]}>
            These messages came from senders that don't match any of your accounts. Map each one to an
            existing account, create a new one, or ignore it — nothing affects your balances until you decide.
          </Text>
        </View>

        {mappings.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.text }]}>Nothing to review</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              Every SMS sender so far matches one of your accounts.
            </Text>
          </View>
        ) : (
          mappings.map((mapping) => (
            <View key={mapping.id} style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {mapping.suggestedName || mapping.institutionKey}
                </Text>
                <Text style={[styles.cardKey, { color: colors.textMuted }]}>{mapping.institutionKey}</Text>
              </View>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {mapping.queuedCount} message{mapping.queuedCount === 1 ? '' : 's'} queued
                {mapping.latestAmount != null ? ` · latest ${formatCurrency(mapping.latestAmount)}` : ''}
              </Text>
              {mapping.latestAvailableBalance != null && (
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                  Balance reported: {formatCurrency(mapping.latestAvailableBalance)}
                </Text>
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border }]}
                  onPress={() => setMapModalMapping(mapping)}
                >
                  <Ionicons name="link-outline" size={16} color={colors.primary} />
                  <Text style={[styles.actionButtonText, { color: colors.primary }]}>Map to existing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border }]}
                  onPress={() => openCreateModal(mapping)}
                >
                  <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                  <Text style={[styles.actionButtonText, { color: colors.primary }]}>Create new</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border }]}
                  onPress={() => handleIgnore(mapping)}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                  <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>Ignore</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Map to existing account modal */}
      <Modal visible={!!mapModalMapping} animationType="slide" transparent onRequestClose={() => setMapModalMapping(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Map {mapModalMapping?.suggestedName || mapModalMapping?.institutionKey} to
              </Text>
              <TouchableOpacity onPress={() => setMapModalMapping(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {accounts.length === 0 ? (
                <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>You have no accounts yet — create one instead.</Text>
              ) : (
                accounts.map((account) => (
                  <TouchableOpacity
                    key={account.id}
                    style={[styles.accountRow, { borderBottomColor: colors.border }]}
                    disabled={mapMutation.isPending}
                    onPress={() => mapModalMapping && mapMutation.mutate({ mappingId: mapModalMapping.id, accountId: account.id })}
                  >
                    <View>
                      <Text style={[styles.accountRowName, { color: colors.text }]}>{account.name}</Text>
                      <Text style={[styles.accountRowMeta, { color: colors.textMuted }]}>{formatCurrency(parseFloat(account.balance))}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))
              )}
              {mapMutation.isPending && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Create new account modal */}
      <Modal visible={!!createModalMapping} animationType="slide" transparent onRequestClose={() => setCreateModalMapping(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>New Account</Text>
              <TouchableOpacity onPress={() => setCreateModalMapping(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Account Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. EPFO"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Account Type</Text>
              <View style={styles.typeGrid}>
                {ACCOUNT_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[
                      styles.typeChip,
                      { backgroundColor: colors.card, borderColor: newType === t.value ? colors.primary : colors.border },
                    ]}
                    onPress={() => setNewType(t.value)}
                  >
                    <Ionicons name={t.icon} size={16} color={newType === t.value ? colors.primary : colors.textMuted} />
                    <Text style={[styles.typeChipText, { color: newType === t.value ? colors.primary : colors.textMuted }]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Current Balance</Text>
              <View style={[styles.amountInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                <TextInput
                  style={[styles.amountInput, { color: colors.text }]}
                  value={newBalance}
                  onChangeText={setNewBalance}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
              </View>
              {createModalMapping?.latestAvailableBalance != null && (
                <Text style={[styles.hint, { color: colors.textMuted }]}>
                  Pre-filled from the balance your bank reported in the latest message — edit if it's not right.
                </Text>
              )}

              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: colors.primary }, createMutation.isPending && styles.submitButtonDisabled]}
                onPress={handleCreateSubmit}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Create & Link</Text>
                )}
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardKey: {
    fontSize: 11,
    fontWeight: '500',
  },
  cardMeta: {
    fontSize: 13,
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  modalBody: {
    padding: 20,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  accountRowName: {
    fontSize: 15,
    fontWeight: '500',
  },
  accountRowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  currencyPrefix: {
    fontSize: 16,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
  },
  hint: {
    fontSize: 11,
    marginTop: 6,
  },
  submitButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
