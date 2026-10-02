import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { getThemedColors } from '../lib/utils';
import type { RootStackParamList } from '../../App';
import type { AllowanceCommitment, AllowanceTxnRow } from '../lib/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const GROUP_LABELS: Record<AllowanceCommitment['itemType'], string> = {
  scheduled_payment: 'Scheduled payments',
  loan: 'Loan EMIs',
  insurance: 'Insurance',
  credit_card_bill: 'Credit card bills',
  savings_goal: 'Savings goals',
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function SpendingAllowanceScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const [showHeld, setShowHeld] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['/api/spending-allowance'],
    queryFn: api.getSpendingAllowance,
  });
  const { data: categories = [] } = useQuery({ queryKey: ['/api/categories'], queryFn: api.getCategories });

  const settingsMutation = useMutation({
    mutationFn: api.updateSpendingAllowanceSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/spending-allowance'] }),
  });

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!data || !data.configured) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textMuted, marginBottom: 12 }}>Set up salary to see your daily limit</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Salary')}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Open Salary</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const over = data.today.left < 0;
  const moneyColor = (n: number) => (n < 0 ? colors.danger ?? '#dc2626' : colors.text);
  const openTxn = (row: AllowanceTxnRow) => navigation.navigate('AddTransaction', { transactionId: row.id });
  const grouped = Object.entries(
    data.heldBack.items.reduce<Record<string, AllowanceCommitment[]>>((acc, i) => {
      (acc[i.itemType] ??= []).push(i);
      return acc;
    }, {})
  );
  const neverCount = new Set(data.settings.neverCountCategoryIds);
  const toggleCategory = (id: number) => {
    const next = new Set(neverCount);
    next.has(id) ? next.delete(id) : next.add(id);
    settingsMutation.mutate({ neverCountCategoryIds: [...next] });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.label, { color: colors.textMuted }]}>Safe to spend today</Text>
        <Text style={[styles.big, { color: over ? colors.danger ?? '#dc2626' : colors.primary }]}>
          {over ? `${formatCurrency(-data.today.left)} over today` : formatCurrency(data.today.left)}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          {formatCurrency(data.today.spent)} spent of {formatCurrency(data.today.limit)}
        </Text>
        <View style={styles.row}>
          <Stat label="This week" value={data.week.left} color={moneyColor(data.week.left)} muted={colors.textMuted} />
          <Stat label="Until payday" value={data.cycleLeft} color={moneyColor(data.cycleLeft)} muted={colors.textMuted} />
        </View>
        <Text style={{ color: colors.textMuted, marginTop: 6 }}>
          {data.cycle.daysLeft} {data.cycle.daysLeft === 1 ? 'day' : 'days'} to payday
        </Text>
      </View>

      <Text style={[styles.section, { color: colors.text }]}>How it's worked out</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Line label={`Salary${data.income.salaryIsActual ? '' : ' (expected)'}`} value={data.income.salary} colors={colors} />
        {data.income.wallet > 0 && <Line label="Meal Card top-ups" value={data.income.wallet} colors={colors} />}
        <TouchableOpacity onPress={() => setShowHeld(v => !v)}>
          <Line label={`Held back ${showHeld ? '▾' : '▸'}`} value={-data.heldBack.total} colors={colors} />
        </TouchableOpacity>
        {showHeld && grouped.map(([type, items]) => (
          <View key={type} style={{ paddingLeft: 12 }}>
            <Text style={{ color: colors.textMuted, marginTop: 6 }}>{GROUP_LABELS[type as AllowanceCommitment['itemType']]}</Text>
            {items.map(i => <Line key={`${type}-${i.id}`} label={i.name} value={-i.amount} colors={colors} small />)}
          </View>
        ))}
        <Line label="Spent so far" value={-data.spent.total} colors={colors} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Line label="Left until payday" value={data.cycleLeft} colors={colors} bold />
      </View>

      <Text style={[styles.section, { color: colors.text }]}>Spent this cycle</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {data.spent.counted.length === 0 && <Text style={{ color: colors.textMuted }}>Nothing yet</Text>}
        {data.spent.counted.map(row => (
          <TxnRow key={row.id} row={row} subtitle={`${shortDate(row.date)} · ${row.accountName ?? ''}`} onPress={() => openTxn(row)} colors={colors} />
        ))}
      </View>

      <TouchableOpacity onPress={() => setShowExcluded(v => !v)}>
        <Text style={[styles.section, { color: colors.text }]}>Not counted ({data.excluded.length}) {showExcluded ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {showExcluded && (
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {data.excluded.map(row => (
            <TxnRow key={row.id} row={row} subtitle={`${shortDate(row.date)} · ${row.reason}`} onPress={() => openTxn(row)} colors={colors} />
          ))}
        </View>
      )}

      <Text style={[styles.section, { color: colors.text }]}>Settings</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.settingRow}>
          <Text style={{ color: colors.text, flex: 1 }}>Hold back savings goals</Text>
          <Switch
            value={settingsMutation.isPending && settingsMutation.variables?.holdBackSavings !== undefined
              ? !!settingsMutation.variables.holdBackSavings
              : data.settings.holdBackSavings}
            onValueChange={(v) => settingsMutation.mutate({ holdBackSavings: v })}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <TouchableOpacity style={styles.settingRow} onPress={() => setShowCategories(v => !v)}>
          <Text style={{ color: colors.text, flex: 1 }}>Categories that never count</Text>
          <Text style={{ color: colors.textMuted }}>{neverCount.size} {showCategories ? '▾' : '▸'}</Text>
        </TouchableOpacity>
        {showCategories && categories.map(c => (
          <TouchableOpacity key={c.id} style={styles.settingRow} onPress={() => toggleCategory(c.id)} disabled={settingsMutation.isPending}>
            <Ionicons name={neverCount.has(c.id) ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
            <Text style={{ color: colors.text, marginLeft: 10 }}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, color, muted }: { label: string; value: number; color: string; muted: string }) {
  return (
    <View style={{ flex: 1, marginTop: 12 }}>
      <Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{formatCurrency(value)}</Text>
    </View>
  );
}

function Line({ label, value, colors, bold, small }: { label: string; value: number; colors: any; bold?: boolean; small?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={{ color: small ? colors.textMuted : colors.text, flex: 1, fontWeight: bold ? '700' : '400', fontSize: small ? 13 : 15 }}>{label}</Text>
      <Text style={{ color: value < 0 && bold ? colors.danger ?? '#dc2626' : colors.text, fontWeight: bold ? '700' : '500', fontSize: small ? 13 : 15 }}>
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

function TxnRow({ row, subtitle, onPress, colors }: { row: AllowanceTxnRow; subtitle: string; onPress: () => void; colors: any }) {
  return (
    <TouchableOpacity style={styles.line} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text }} numberOfLines={1}>{row.merchant ?? 'Transaction'}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{formatCurrency(row.amount)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  big: { fontSize: 32, fontWeight: '800', marginVertical: 4 },
  row: { flexDirection: 'row' },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  divider: { height: 1, marginVertical: 6 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
