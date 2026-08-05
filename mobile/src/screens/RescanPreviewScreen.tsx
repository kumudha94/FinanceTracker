import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { format } from 'date-fns';
import { getThemedColors, formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { previewRescan, commitRescan, RawSms, PreviewSmsResult } from '../lib/smsRescan';
import { MoreStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

export default function RescanPreviewScreen() {
  const route = useRoute();
  const navigation = useNavigation<NavigationProp>();
  const { resolvedTheme } = useTheme();
  const colors = getThemedColors(resolvedTheme);
  const messages = (route.params as any)?.messages as RawSms[];

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<PreviewSmsResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const previewResults = await previewRescan(messages);
        setResults(previewResults);
        setSelected(new Set(previewResults.map((r, i) => (r.status === 'new' ? i : -1)).filter((i) => i >= 0)));
      } catch (error: any) {
        Alert.alert('Preview Failed', error.message || 'Could not preview messages.');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const newItems: number[] = [];
    const duplicateItems: number[] = [];
    const unmatchedItems: number[] = [];
    results.forEach((r, i) => {
      if (r.status === 'new') newItems.push(i);
      else if (r.status === 'duplicate') duplicateItems.push(i);
      else if (r.status === 'unmatched') unmatchedItems.push(i);
    });
    return { newItems, duplicateItems, unmatchedItems };
  }, [results]);

  const toggleSelected = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAddSelected = () => {
    if (selected.size === 0) return;
    // Auto-mark-as-paid runs on these transactions the same as it would on a live SMS, but
    // older loan/insurance/payment records may not exist in the DB yet for periods before
    // tracking started — those just won't auto-match (nothing links falsely), so warn once
    // rather than let it look like silent under-matching.
    Alert.alert(
      'Adding older messages',
      "Some older payments may not auto-match if their loan, insurance, or scheduled payment records weren't created for that period yet. Check Needs Review or the item list afterward.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => commitSelected() },
      ]
    );
  };

  const commitSelected = async () => {
    setCommitting(true);
    try {
      const toCommit = messages.filter((_, i) => selected.has(i));
      const { successful, failed } = await commitRescan(toCommit);
      Toast.show({
        type: 'success',
        text1: 'Rescan Complete',
        text2: `Added ${successful} transaction${successful === 1 ? '' : 's'}${failed > 0 ? `, ${failed} failed` : ''}`,
        position: 'bottom',
      });
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Failed to Add', error.message || 'Could not add the selected transactions.');
    } finally {
      setCommitting(false);
    }
  };

  const renderRow = (index: number, selectable: boolean) => {
    const r = results[index];
    const isSelected = selected.has(index);
    return (
      <TouchableOpacity
        key={index}
        style={[styles.row, { borderBottomColor: colors.border }]}
        onPress={() => selectable && toggleSelected(index)}
        disabled={!selectable}
        activeOpacity={selectable ? 0.6 : 1}
      >
        {selectable && (
          <Ionicons
            name={isSelected ? 'checkbox' : 'square-outline'}
            size={22}
            color={isSelected ? colors.primary : colors.textMuted}
          />
        )}
        <View style={styles.rowInfo}>
          <Text style={[styles.rowMerchant, { color: colors.text }]} numberOfLines={1}>
            {r.merchant || r.matchedAccountName || 'Unknown'}
          </Text>
          <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
            {r.date ? format(new Date(r.date), 'd MMM yyyy') : ''}
            {r.matchedAccountName ? ` · ${r.matchedAccountName}` : ''}
          </Text>
        </View>
        {r.amount != null && (
          <Text style={[styles.rowAmount, { color: r.type === 'credit' ? '#10b981' : colors.text }]}>
            {r.type === 'credit' ? '+' : '-'}{formatCurrency(r.amount)}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.rowMeta, { color: colors.textMuted, marginTop: 12 }]}>Checking for duplicates…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {grouped.newItems.length === 0 && grouped.duplicateItems.length === 0 && grouped.unmatchedItems.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.rowMerchant, { color: colors.text }]}>Nothing found</Text>
          </View>
        )}

        {grouped.newItems.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>New ({grouped.newItems.length})</Text>
            <View style={[styles.section, { backgroundColor: colors.card }]}>
              {grouped.newItems.map((i) => renderRow(i, true))}
            </View>
          </>
        )}

        {grouped.unmatchedItems.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              Unmatched sender ({grouped.unmatchedItems.length})
            </Text>
            <View style={[styles.section, { backgroundColor: colors.card, opacity: 0.6 }]}>
              {grouped.unmatchedItems.map((i) => renderRow(i, false))}
            </View>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              These don't match any of your accounts — check "New Accounts Detected" after adding.
            </Text>
          </>
        )}

        {grouped.duplicateItems.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              Already added ({grouped.duplicateItems.length})
            </Text>
            <View style={[styles.section, { backgroundColor: colors.card, opacity: 0.6 }]}>
              {grouped.duplicateItems.map((i) => renderRow(i, false))}
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {grouped.newItems.length > 0 && (
        <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.primary }, committing && { opacity: 0.7 }]}
            onPress={handleAddSelected}
            disabled={committing || selected.size === 0}
          >
            {committing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.addButtonText}>Add Selected ({selected.size})</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
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
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  rowInfo: {
    flex: 1,
  },
  rowMerchant: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  rowAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    fontSize: 12,
    marginLeft: 4,
    marginBottom: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  },
  addButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
