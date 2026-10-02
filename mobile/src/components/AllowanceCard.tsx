import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';

// Today's safe-to-spend figure on the Dashboard. Hidden until a salary profile exists.
export function AllowanceCard({ colors }: { colors: any }) {
  const navigation = useNavigation<any>();
  const { data } = useQuery({ queryKey: ['/api/spending-allowance'], queryFn: api.getSpendingAllowance });
  if (!data || !data.configured) return null;
  // A negative daily limit means the whole cycle is overspent, not just today (matches the widget).
  const overCycle = data.today.limit < 0;
  const over = data.today.left < 0;
  const danger = colors.danger ?? '#dc2626';
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => navigation.navigate('SpendingAllowance')}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '600' }}>Safe to spend today</Text>
        {overCycle ? (
          <Text style={{ color: danger, fontSize: 18, fontWeight: '800' }}>
            Over budget for this cycle by {formatCurrency(-data.cycleLeft)}
          </Text>
        ) : (
          <Text style={{ color: over ? danger : colors.primary, fontSize: 24, fontWeight: '800' }}>
            {over ? `${formatCurrency(-data.today.left)} over` : formatCurrency(data.today.left)}
          </Text>
        )}
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          Week {formatCurrency(data.week.left)} · {data.cycle.daysLeft} {data.cycle.daysLeft === 1 ? 'day' : 'days'} to payday
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
});
