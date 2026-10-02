import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { format } from 'date-fns';
import { getThemedColors, formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';
import { refreshWidgets } from '../../modules/widget-bridge';
import type { BalanceGapItem } from '../lib/types';

type GapAction =
  | { action: 'transfer'; debitTransactionId: number }
  | { action: 'income' | 'expense' }
  | { action: 'dismiss' };

// Gaps between the app's balance and the bank's own figure from an SMS. The balance is already
// synced; each card lets the user say what the money was (usually a transfer whose credit alert
// came only by email).
export default function BalanceGapsScreen() {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);

  const { data: gaps = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['/api/balance-gaps'],
    queryFn: api.getBalanceGaps,
  });

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: GapAction }) =>
      body.action === 'dismiss' ? api.dismissBalanceGap(id) : api.resolveBalanceGap(id, body),
    onSuccess: (_data, { body }) => {
      for (const key of ['/api/balance-gaps', '/api/transactions', '/api/accounts', '/api/spending-allowance', '/api/dashboard-summary']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      refreshWidgets().catch(() => {});
      const text1 = body.action === 'dismiss' ? 'Dismissed'
        : body.action === 'transfer' ? 'Recorded as a transfer'
        : body.action === 'income' ? 'Added as income' : 'Added as expense';
      Toast.show({ type: 'success', text1, position: 'bottom' });
    },
    onError: (error: any) => {
      Toast.show({ type: 'error', text1: 'Could not update', text2: error?.message || 'Please try again', position: 'bottom' });
    },
  });

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      {gaps.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={48} color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>No balance gaps to review</Text>
        </View>
      ) : (
        gaps.map(gap => (
          <GapCard
            key={gap.id}
            gap={gap}
            colors={colors}
            busy={mutation.isPending && mutation.variables?.id === gap.id}
            onAction={body => mutation.mutate({ id: gap.id, body })}
          />
        ))
      )}
    </ScrollView>
  );
}

function GapCard({ gap, colors, busy, onAction }: {
  gap: BalanceGapItem;
  colors: any;
  busy: boolean;
  onAction: (body: GapAction) => void;
}) {
  const [selected, setSelected] = useState<number | null>(gap.candidates[0]?.id ?? null);
  const higher = gap.gapAmount > 0;
  const amount = formatCurrency(Math.abs(gap.gapAmount));
  const first = gap.candidates[0];
  const day = (iso: string) => format(new Date(iso), 'd MMM');

  const headline = !higher
    ? `${amount} left ${gap.accountName} without an SMS.`
    : first
      ? `${gap.accountName} was ${amount} higher than expected. Was it the ${formatCurrency(first.amount)} from ${first.accountName} on ${day(first.date)}?`
      : `${gap.accountName} received ${amount} that wasn't recorded.`;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.headline, { color: colors.text }]}>{headline}</Text>
      <Text style={[styles.meta, { color: colors.textMuted }]}>
        Found {day(gap.detectedAt)} · bank balance {formatCurrency(gap.bankBalance)} (app updated to match)
      </Text>

      {higher && gap.candidates.length > 1 && gap.candidates.map(c => (
        <TouchableOpacity key={c.id} style={styles.candidate} onPress={() => setSelected(c.id)} disabled={busy}>
          <Ionicons name={selected === c.id ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.primary} />
          <Text style={[styles.candidateText, { color: colors.text }]} numberOfLines={1}>
            {day(c.date)} · {c.accountName}{c.merchant ? ` · ${c.merchant}` : ''}
          </Text>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{formatCurrency(c.amount)}</Text>
        </TouchableOpacity>
      ))}

      <View style={styles.actions}>
        {higher && selected !== null && (
          <ActionButton
            label="Yes, it's a transfer" primary colors={colors} disabled={busy}
            onPress={() => onAction({ action: 'transfer', debitTransactionId: selected })}
          />
        )}
        <ActionButton
          label={higher ? 'Add as income' : 'Add as expense'} primary={!(higher && selected !== null)} colors={colors} disabled={busy}
          onPress={() => onAction({ action: higher ? 'income' : 'expense' })}
        />
        <ActionButton label="Dismiss" colors={colors} disabled={busy} onPress={() => onAction({ action: 'dismiss' })} />
      </View>
      {busy && <ActivityIndicator style={{ marginTop: 8 }} color={colors.primary} />}
    </View>
  );
}

function ActionButton({ label, primary, colors, disabled, onPress }: {
  label: string; primary?: boolean; colors: any; disabled: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, primary
        ? { backgroundColor: colors.primary, borderColor: colors.primary }
        : { borderColor: colors.border }, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={{ color: primary ? '#fff' : colors.text, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { marginTop: 12, fontSize: 15 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  headline: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  meta: { fontSize: 12, marginTop: 6 },
  candidate: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  candidateText: { flex: 1, marginHorizontal: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 8 },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
});
