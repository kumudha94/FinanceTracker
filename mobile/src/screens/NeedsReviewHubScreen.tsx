import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import { getThemedColors } from '../lib/utils';
import { MoreStackParamList } from '../../App';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../lib/api';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

export default function NeedsReviewHubScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);

  const { data: pendingMappings = [], refetch: refetchMappings } = useQuery({
    queryKey: ['/api/institution-mappings/pending'],
    queryFn: api.getPendingInstitutionMappings,
  });

  const { data: pendingBillMappings = [], refetch: refetchBillMappings } = useQuery({
    queryKey: ['/api/bill-mappings/pending'],
    queryFn: api.getPendingBillMappings,
  });

  const { data: pendingPaymentMatches = [], refetch: refetchPaymentMatches } = useQuery({
    queryKey: ['/api/sms-payment-match-reviews/pending'],
    queryFn: api.getPendingPaymentMatchReviews,
  });

  useFocusEffect(
    useCallback(() => {
      refetchMappings();
      refetchBillMappings();
      refetchPaymentMatches();
    }, [refetchMappings, refetchBillMappings, refetchPaymentMatches])
  );

  const items = [
    {
      icon: 'help-buoy-outline' as const,
      title: 'New Accounts Detected',
      subtitle: "SMS from banks/cards you haven't added yet",
      route: 'InstitutionMappings' as const,
      color: '#f59e0b',
      count: pendingMappings.length,
    },
    {
      icon: 'file-tray-full-outline' as const,
      title: 'Bills Inbox',
      subtitle: 'Due-reminder SMS that need triage',
      route: 'BillsInbox' as const,
      color: '#14b8a6',
      count: pendingBillMappings.length,
    },
    {
      icon: 'flash-outline' as const,
      title: 'Payment Matches',
      subtitle: 'Debited SMS that matched more than one auto-mark item',
      route: 'PaymentMatchReviews' as const,
      color: '#f97316',
      count: pendingPaymentMatches.length,
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.menuList}>
          {items.map((item) => (
            <TouchableOpacity
              key={item.route}
              style={[styles.menuItem, { backgroundColor: colors.card }]}
              onPress={() => navigation.navigate(item.route)}
            >
              <View style={[styles.menuIcon, { backgroundColor: `${item.color}15` }]}>
                <Ionicons name={item.icon} size={24} color={item.color} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>{item.subtitle}</Text>
              </View>
              {item.count > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.count}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  menuList: {
    gap: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuInfo: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  menuSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
