import { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { api } from '../lib/api';
import { formatCurrency, getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

interface SpendingBreakdownModalProps {
  loanId: number;
  visible: boolean;
  onClose: () => void;
}

export default function SpendingBreakdownModal({ loanId, visible, onClose }: SpendingBreakdownModalProps) {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const queryClient = useQueryClient();

  const [receivedAmountInput, setReceivedAmountInput] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntryAmount, setNewEntryAmount] = useState('');
  const [newEntryReason, setNewEntryReason] = useState('');

  const { data: loan } = useQuery({
    queryKey: ['/api/loans', loanId],
    queryFn: () => api.getLoan(loanId),
    enabled: visible,
  });

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ['loan-spending-entries', loanId],
    queryFn: () => api.getLoanSpendingEntries(loanId),
    enabled: visible,
  });

  // Pre-fill the input with the loan's principal the first time it's opened for a loan that
  // has no receivedAmount saved yet — the stored value stays null until the user hits Save.
  // Re-syncs from the server value whenever the modal opens, discarding any unsaved typed
  // text left over from a prior open/close cycle (this component stays mounted across
  // visibility toggles so it can be reused across screens).
  useEffect(() => {
    if (visible && loan) {
      setReceivedAmountInput(loan.receivedAmount ?? loan.principalAmount);
    }
  }, [visible, loan?.id, loan?.receivedAmount]);

  // Reset the Add Entry mini-form whenever the modal opens, so a half-filled, unsubmitted
  // form doesn't persist across close/reopen.
  useEffect(() => {
    if (visible) {
      setShowAddForm(false);
      setNewEntryAmount('');
      setNewEntryReason('');
    }
  }, [visible]);

  const saveReceivedAmountMutation = useMutation({
    mutationFn: (amount: string) => api.updateLoan(loanId, { receivedAmount: amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/loans', loanId] });
      queryClient.invalidateQueries({ queryKey: ['/api/loans'] });
      Toast.show({ type: 'success', text1: 'Received amount saved', position: 'bottom' });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to save received amount', position: 'bottom' });
    },
  });

  const addEntryMutation = useMutation({
    mutationFn: () => api.createLoanSpendingEntry(loanId, { amount: newEntryAmount, reason: newEntryReason.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-spending-entries', loanId] });
      setNewEntryAmount('');
      setNewEntryReason('');
      setShowAddForm(false);
      Toast.show({ type: 'success', text1: 'Entry added', position: 'bottom' });
    },
    onError: (error: any) => {
      Toast.show({ type: 'error', text1: 'Could not add entry', text2: error?.message || 'Try a smaller amount', position: 'bottom' });
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => api.deleteLoanSpendingEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-spending-entries', loanId] });
    },
    onError: () => {
      Toast.show({ type: 'error', text1: 'Failed to delete entry', position: 'bottom' });
    },
  });

  const allocated = (entries || []).reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const received = loan?.receivedAmount ? parseFloat(loan.receivedAmount) : null;
  const remaining = received !== null ? received - allocated : null;

  const handleAddEntry = () => {
    const amountNum = parseFloat(newEntryAmount);
    if (!newEntryAmount || isNaN(amountNum) || amountNum <= 0) {
      Toast.show({ type: 'error', text1: 'Enter a valid amount', position: 'bottom' });
      return;
    }
    addEntryMutation.mutate();
  };

  if (!loan) {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={[styles.content, { backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Spending Breakdown</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Loan Amount</Text>
              <Text style={[styles.readOnlyValue, { color: colors.text }]}>{formatCurrency(parseFloat(loan.principalAmount))}</Text>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Received Amount</Text>
              <View style={styles.receivedRow}>
                <View style={[styles.amountInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.text }]}
                    keyboardType="decimal-pad"
                    value={receivedAmountInput}
                    onChangeText={setReceivedAmountInput}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    const newReceived = parseFloat(receivedAmountInput);
                    if (!isNaN(newReceived) && newReceived < allocated) {
                      Toast.show({ type: 'error', text1: 'Cannot lower below allocated amount', text2: `You've already allocated ${formatCurrency(allocated)}`, position: 'bottom' });
                      return;
                    }
                    saveReceivedAmountMutation.mutate(receivedAmountInput);
                  }}
                  disabled={saveReceivedAmountMutation.isPending}
                >
                  {saveReceivedAmountMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {received !== null && (
              <Text style={[styles.allocatedText, { color: remaining! < 0 ? '#ef4444' : colors.textMuted }]}>
                {formatCurrency(allocated)} of {formatCurrency(received)} allocated
                {remaining! >= 0
                  ? `, ${formatCurrency(remaining!)} unaccounted`
                  : `, ${formatCurrency(Math.abs(remaining!))} over-allocated — lower this by adjusting entries or raising the received amount`}
              </Text>
            )}

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {entriesLoading ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
            ) : entries && entries.length > 0 ? (
              entries.map((entry) => (
                <View key={entry.id} style={[styles.entryRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.entryAmount, { color: colors.text }]}>{formatCurrency(parseFloat(entry.amount))}</Text>
                    {entry.reason && <Text style={[styles.entryReason, { color: colors.textMuted }]}>{entry.reason}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => deleteEntryMutation.mutate(entry.id)} disabled={deleteEntryMutation.isPending}>
                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No spending entries yet</Text>
            )}

            {showAddForm ? (
              <View style={[styles.addForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.amountInputContainer, { backgroundColor: colors.background, borderColor: colors.border, marginBottom: 8 }]}>
                  <Text style={[styles.currencyPrefix, { color: colors.textMuted }]}>₹</Text>
                  <TextInput
                    style={[styles.amountInput, { color: colors.text }]}
                    keyboardType="decimal-pad"
                    value={newEntryAmount}
                    onChangeText={setNewEntryAmount}
                    placeholder="Amount"
                    placeholderTextColor={colors.textMuted}
                    autoFocus
                  />
                </View>
                <TextInput
                  style={[styles.reasonInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                  value={newEntryReason}
                  onChangeText={setNewEntryReason}
                  placeholder="Reason (optional)"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.addFormButtons}>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowAddForm(false); setNewEntryAmount(''); setNewEntryReason(''); }}>
                    <Text style={{ color: colors.textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: colors.primary }]}
                    onPress={handleAddEntry}
                    disabled={addEntryMutation.isPending}
                  >
                    {addEntryMutation.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>Add</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addEntryRow, { borderColor: colors.border }]}
                onPress={() => setShowAddForm(true)}
                disabled={received === null}
              >
                <Ionicons name="add-circle-outline" size={20} color={received === null ? colors.textMuted : colors.primary} />
                <Text style={[styles.addEntryText, { color: received === null ? colors.textMuted : colors.primary }]}>
                  {received === null ? 'Save received amount first' : 'Add Entry'}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  content: {
    maxHeight: '85%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    flexGrow: 0,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  readOnlyValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  receivedRow: {
    flexDirection: 'row',
    gap: 10,
  },
  amountInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  currencyPrefix: {
    fontSize: 16,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
  },
  saveButton: {
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  allocatedText: {
    fontSize: 12,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    marginBottom: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  entryAmount: {
    fontSize: 15,
    fontWeight: '600',
  },
  entryReason: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
  addForm: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  reasonInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  addFormButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    alignItems: 'center',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  addButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  addEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    justifyContent: 'center',
  },
  addEntryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
