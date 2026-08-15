import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { getThemedColors } from '../lib/utils';
import { MoreStackParamList } from '../../App';
import { useTheme } from '../contexts/ThemeContext';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

interface HubItem {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  route: keyof MoreStackParamList;
  color: string;
}

const items: HubItem[] = [
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Auto-Read SMS',
    subtitle: 'Automatically log bank SMS as transactions',
    route: 'SmsAutoRead',
    color: '#16a34a',
  },
  {
    icon: 'notifications-outline',
    title: 'Notification Bill Detection',
    subtitle: 'Catch bill reminders that only arrive as app notifications',
    route: 'NotificationAutoRead',
    color: '#16a34a',
  },
  {
    icon: 'scan-outline',
    title: 'Scan SMS',
    subtitle: 'Paste a bank SMS to add manually',
    route: 'ScanSMS',
    color: '#0ea5e9',
  },
  {
    icon: 'document-text-outline',
    title: 'Import Statement',
    subtitle: 'Import PDF bank statements',
    route: 'ImportStatement',
    color: '#0ea5e9',
  },
];

export default function SmsStatementsHubScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.menuList}>
          {items.map((item) => (
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
});
