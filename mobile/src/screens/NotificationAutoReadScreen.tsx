import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Linking, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import {
  isNotificationAutoReadEnabled,
  setNotificationAutoReadEnabled,
} from '../lib/notificationAutoReader';
import { isNotificationListenerEnabled } from '../../modules/notification-listener-bridge';

export default function NotificationAutoReadScreen() {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const [enabled, setEnabled] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const [autoReadOn, listenerGranted] = await Promise.all([
      isNotificationAutoReadEnabled(),
      isNotificationListenerEnabled(),
    ]);
    setEnabled(autoReadOn && listenerGranted);
    setPermissionGranted(listenerGranted);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useFocusEffect(
    useCallback(() => {
      refreshStatus();
    }, [refreshStatus])
  );

  const handleToggle = async (value: boolean) => {
    if (!value) {
      await setNotificationAutoReadEnabled(false);
      setEnabled(false);
      return;
    }

    const granted = await isNotificationListenerEnabled();
    if (!granted) {
      Linking.sendIntent
        ? Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS')
        : Linking.openSettings();
      return;
    }

    await setNotificationAutoReadEnabled(true);
    setEnabled(true);
  };

  if (Platform.OS !== 'android') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: colors.textMuted, textAlign: 'center' }}>Notification-based bill detection is only available on Android.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={[styles.infoCard, { backgroundColor: `${colors.primary}15` }]}>
        <Ionicons name="notifications-outline" size={24} color={colors.primary} />
        <Text style={[styles.infoText, { color: colors.text }]}>
          My Tracker can read notification text from other apps to catch bill/due reminders that never arrive as SMS.
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>What this permission is used for</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            Only notifications matching bill/due-reminder keywords are ever sent to the server — everything else is discarded on your device.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            This is a broader permission than SMS access — once granted, Android technically allows this app to see notification text from any app, not just bill-related ones. The on-device filter above is what keeps everything else from ever leaving your device.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            Matching notifications are sent only to your own My Tracker backend, and route into your existing Bills Inbox for review — nothing is added automatically without you seeing it there.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            You can turn this off anytime below. The app cannot revoke the underlying Android permission on its own — turning it off here only stops processing; to fully revoke access, use the button below to open Android Settings.
          </Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Notification Access</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Auto-Detect Bill Notifications</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>
                {!permissionGranted
                  ? 'Not enabled in Android Settings'
                  : enabled
                    ? 'Enabled — matching notifications are added to Bills Inbox automatically'
                    : 'Disabled'}
              </Text>
            </View>
          </View>
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: `${colors.primary}80` }}
            thumbColor={enabled ? colors.primary : colors.textMuted}
          />
        </View>
        <TouchableOpacity
          style={[styles.settingsLinkRow, { borderTopColor: colors.border }]}
          onPress={() =>
            Linking.sendIntent
              ? Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS')
              : Linking.openSettings()
          }
        >
          <Text style={[styles.settingsLinkText, { color: colors.primary }]}>Open Android Notification Access Settings</Text>
          <Ionicons name="open-outline" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    margin: 16,
    borderRadius: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  settingSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  settingsLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 14,
  },
  settingsLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
