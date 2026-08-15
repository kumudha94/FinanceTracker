import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { getThemedColors } from '../lib/utils';
import { MoreStackParamList } from '../../App';
import { useTheme } from '../contexts/ThemeContext';
import { useMemo, useCallback } from 'react';
import { api } from '../lib/api';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

interface MenuItem {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  route: keyof MoreStackParamList;
  color: string;
}

const menuItems: MenuItem[] = [
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'SMS & Statements',
    subtitle: 'Auto-read, scan, or import from a PDF',
    route: 'SmsStatementsHub',
    color: '#16a34a',
  },
  {
    icon: 'alert-circle-outline',
    title: 'Needs Review',
    subtitle: 'New accounts and bills waiting for you',
    route: 'NeedsReviewHub',
    color: '#f59e0b',
  },
  {
    icon: 'pie-chart-outline',
    title: 'Budget Planner',
    subtitle: 'Track spending by category',
    route: 'Budgets',
    color: '#3b82f6',
  },
  {
    icon: 'calendar-outline',
    title: 'Scheduled Payments',
    subtitle: 'Monthly payment checklist',
    route: 'ScheduledPayments',
    color: '#f97316',
  },
  {
    icon: 'flag-outline',
    title: 'Savings Goals',
    subtitle: 'Track goals & travels',
    route: 'SavingsGoals',
    color: '#22c55e',
  },
  {
    icon: 'cash-outline',
    title: 'Salary & Income',
    subtitle: 'Configure your payday',
    route: 'Salary',
    color: '#a855f7',
  },
  {
    icon: 'business-outline',
    title: 'Loans & EMIs',
    subtitle: 'Track loans and repayments',
    route: 'Loans',
    color: '#ef4444',
  },
  {
    icon: 'shield-outline',
    title: 'Insurance',
    subtitle: 'Track policies & premiums',
    route: 'Insurance',
    color: '#6366f1',
  },
  {
    icon: 'pricetags-outline',
    title: 'Categories',
    subtitle: 'Manage expense categories',
    route: 'Categories',
    color: '#ec4899',
  },
  {
    icon: 'settings-outline',
    title: 'Settings',
    subtitle: 'Theme, export, security',
    route: 'Settings',
    color: '#6b7280',
  },
];

export default function MoreScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);

  const { data: pendingMappings = [], refetch: refetchPending } = useQuery({
    queryKey: ['/api/institution-mappings/pending'],
    queryFn: api.getPendingInstitutionMappings,
  });

  const { data: pendingBillMappings = [], refetch: refetchPendingBills } = useQuery({
    queryKey: ['/api/bill-mappings/pending'],
    queryFn: api.getPendingBillMappings,
  });

  useFocusEffect(
    useCallback(() => {
      refetchPending();
      refetchPendingBills();
    }, [refetchPending, refetchPendingBills])
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.header, { color: colors.text }]}>More</Text>
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.menuList}>
          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.route}
              style={[styles.menuItem, { backgroundColor: colors.card }]}
              onPress={() => navigation.navigate(item.route as any)}
            >
              <View style={[styles.menuIcon, { backgroundColor: `${item.color}15` }]}>
                <Ionicons name={item.icon} size={24} color={item.color} />
              </View>
              <View style={styles.menuInfo}>
                <Text style={[styles.menuTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.menuSubtitle, { color: colors.textMuted }]}>{item.subtitle}</Text>
              </View>
              {item.route === 'NeedsReviewHub' && (pendingMappings.length + pendingBillMappings.length) > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pendingMappings.length + pendingBillMappings.length}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>My Tracker v1.0.32</Text>
          <Text style={[styles.footerSubtext, { color: colors.textMuted }]}>Personal Finance Manager</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
    marginTop: 50,
  },
  scrollView: {
    flex: 1,
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
  footer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '500',
  },
  footerSubtext: {
    fontSize: 12,
    marginTop: 2,
  },
});
