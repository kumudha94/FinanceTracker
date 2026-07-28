import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { format } from 'date-fns';
import { getThemedColors, formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';
import type { PendingBillMapping } from '../lib/types';

export default function BillsInboxScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const queryClient = useQueryClient();

  const [linkModalMapping, setLinkModalMapping] = useState<PendingBillMapping | null>(null);
  const [createModalMapping, setCreateModalMapping] = useState<PendingBillMapping | null>(null);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDueDate, setNewDueDate] = useState('1');

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['/api/bill-mappings/pending'],
    queryFn: api.getPendingBillMappings,
  });

  const { data: scheduledPayments = [] } = useQuery({
    queryKey: ['/api/scheduled-payments'],
    queryFn: api.getScheduledPayments,
  });

  const invalidateAfterResolve = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/bill-mappings/pending'] });
    queryClient.invalidateQueries({ queryKey: ['/api/scheduled-payments'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payment-occurrences'] });
  };

  const linkMutation = useMutation({
    mutationFn: ({ mappingId, scheduledPaymentId }: { mappingId: number; scheduledPaymentId: number }) =>
      api.linkBillMapping(mappingId, scheduledPaymentId),
    onSuccess: () => {
      invalidateAfterResolve();
      setLinkModalMapping(null);
      Toast.show({ type: 'success', text1: 'Linked', text2: "Future SMS from this sender will auto-confirm", position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Link', position: 'bottom' });
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ mappingId, data }: { mappingId: number; data: any }) =>
      api.createScheduledPaymentForBillMapping(mappingId, data),
    onSuccess: () => {
      invalidateAfterResolve();
      setCreateModalMapping(null);
      Toast.show({ type: 'success', text1: 'Scheduled Payment Created', text2: 'Linked to this sender', position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Create Payment', position: 'bottom' });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (mappingId: number) => api.ignoreBillMapping(mappingId),
    onSuccess: () => {
      invalidateAfterResolve();
      Toast.show({ type: 'success', text1: 'Dismissed', text2: "You won't be asked about this sender again", position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to Dismiss', position: 'bottom' });
    },
  });

  const openCreateModal = (mapping: PendingBillMapping) => {
    setNewName(mapping.suggestedName || mapping.institutionKey);
    setNewAmount(mapping.latestAmount != null ? mapping.latestAmount.toString() : '');
    setNewDueDate(mapping.latestDueDate ? String(new Date(mapping.latestDueDate).getDate()) : '1');
    setCreateModalMapping(mapping);
  };

  const handleIgnore = (mapping: PendingBillMapping) => {
    Alert.alert(
      'Dismiss this sender?',
      `Future due-reminder SMS from "${mapping.suggestedName || mapping.institutionKey}" will be logged but never surfaced again. You can't undo this from here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', style: 'destructive', onPress: () => ignoreMutation.mutate(mapping.id) },
      ]
    );
  };

  const handleCreateSubmit = () => {
    if (!createModalMapping) return;
    if (!newName.trim()) {
      Toast.show({ type: 'error', text1: 'Enter a bill name', position: 'bottom' });
      return;
    }
    if (!newAmount || parseFloat(newAmount) <= 0) {
      Toast.show({ type: 'error', text1: 'Enter a valid amount', position: 'bottom' });
      return;
    }
    createMutation.mutate({
      mappingId: createModalMapping.id,
      data: {
        name: newName.trim(),
        amount: newAmount,
        dueDate: parseInt(newDueDate) || 1,
        frequency: 'monthly',
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
            Due-reminder SMS (phone recharge, subscriptions, bills) that couldn't be matched to a credit card land
            here. Link each one to a scheduled payment, create a new one, or dismiss it — future SMS from the same
            sender will then auto-route.
          </Text>
        </View>

        {mappings.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.text }]}>Nothing to review</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              No unmatched due-reminder SMS right now.
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
              {mapping.latestMessage && (
                <Text style={[styles.cardMessage, { color: colors.textMuted }]} numberOfLines={2}>
                  {mapping.latestMessage}
                </Text>
              )}
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {mapping.latestAmount != null ? formatCurrency(mapping.latestAmount) : 'Amount unknown'}
                {mapping.latestDueDate ? ` · Due ${format(new Date(mapping.latestDueDate), 'd MMM')}` : ''}
              </Text>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border }]}
                  onPress={() => setLinkModalMapping(mapping)}
                >
                  <Ionicons name="link-outline" size={16} color={colors.primary} />
                  <Text style={[styles.actionButtonText, { color: colors.primary }]}>Link existing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border }]}
                  onPress={() => openCreateModal(mapping)}
                >
                  <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                  <Text style={[styles.actionButtonText, { color: colors.primary }]}>New payment</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.border }]}
                  onPress={() => handleIgnore(mapping)}
                >
                  <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                  <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Link to existing scheduled payment modal */}
      <Modal visible={!!linkModalMapping} animationType="slide" transparent onRequestClose={() => setLinkModalMapping(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Link {linkModalMapping?.suggestedName || linkModalMapping?.institutionKey} to
              </Text>
              <TouchableOpacity onPress={() => setLinkModalMapping(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {scheduledPayments.length === 0 ? (
                <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>You have no scheduled payments yet — create one instead.</Text>
              ) : (
                scheduledPayments.map((sp) => (
                  <TouchableOpacity
                    key={sp.id}
                    style={[styles.accountRow, { borderBottomColor: colors.border }]}
                    disabled={linkMutation.isPending}
                    onPress={() => linkModalMapping && linkMutation.mutate({ mappingId: linkModalMapping.id, scheduledPaymentId: sp.id })}
                  >
                    <View>
                      <Text style={[styles.accountRowName, { color: colors.text }]}>{sp.name}</Text>
                      <Text style={[styles.accountRowMeta, { color: colors.textMuted }]}>{formatCurrency(parseFloat(sp.amount || '0'))}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))
              )}
              {linkMutation.isPending && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Create new scheduled payment modal */}
      <Modal visible={!!createModalMapping} animationType="slide" transparent onRequestClose={() => setCreateModalMapping(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>New Scheduled Payment</Text>
              <TouchableOpacity onPress={() => setCreateModalMapping(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Payment Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Jio Recharge"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Amount</Text>
              <View style={[styles.amountInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                <TextInput
                  style={[styles.amountInput, { color: colors.text }]}
                  value={newAmount}
                  onChangeText={setNewAmount}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
              </View>

              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Due Day of Month</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                value={newDueDate}
                onChangeText={setNewDueDate}
                placeholder="1-28"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />
              {createModalMapping?.latestAmount != null && (
                <Text style={[styles.hint, { color: colors.textMuted }]}>
                  Pre-filled from the latest SMS — edit if it's not right.
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
  cardMessage: {
    fontSize: 12,
    marginTop: 6,
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
