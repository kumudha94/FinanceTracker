import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Linking, Platform, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import {
  isAutoReadEnabled,
  setAutoReadEnabled,
  hasSmsPermission,
  requestSmsAndNotificationPermissions,
} from '../lib/smsAutoReader';
import { scanInboxForRange, validateRescanRange } from '../lib/smsRescan';
import { API_BASE_URL } from '../lib/api';
import { MoreStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<MoreStackParamList>;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export default function SmsAutoReadScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { resolvedTheme } = useTheme();
  const colors = getThemedColors(resolvedTheme);
  const [enabled, setEnabled] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customFrom, setCustomFrom] = useState(new Date());
  const [customTo, setCustomTo] = useState(new Date());
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const refreshStatus = useCallback(async () => {
    const [autoReadOn, smsGranted] = await Promise.all([isAutoReadEnabled(), hasSmsPermission()]);
    setEnabled(autoReadOn && smsGranted);
    setPermissionGranted(smsGranted);
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
      await setAutoReadEnabled(false);
      setEnabled(false);
      return;
    }

    const { smsGranted, notificationsGranted } = await requestSmsAndNotificationPermissions();

    if (!smsGranted) {
      Alert.alert(
        'SMS Permission Required',
        'Auto-read needs SMS access to detect bank messages. You denied it, or denied it previously — open Settings to grant it manually.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    if (!notificationsGranted) {
      Alert.alert(
        'Notifications Recommended',
        'Without notification permission, you won\'t see confirmations when a transaction is auto-added. You can still enable auto-read without it.'
      );
    }

    await setAutoReadEnabled(true);
    setEnabled(true);
  };

  const runRescan = async (fromDate: Date, toDate: Date) => {
    if (Platform.OS !== 'android') {
      Alert.alert('Android Only', 'Rescanning past SMS is only available on Android.');
      return;
    }

    const rangeError = validateRescanRange(fromDate, toDate);
    if (rangeError) {
      Alert.alert('Invalid Range', rangeError);
      return;
    }

    const hasPermission = await hasSmsPermission();
    if (!hasPermission) {
      const { smsGranted } = await requestSmsAndNotificationPermissions();
      if (!smsGranted) {
        Alert.alert(
          'SMS Permission Required',
          'Rescanning needs SMS access to read past messages — open Settings to grant it manually.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
    }

    setScanning(true);
    try {
      const messages = await scanInboxForRange(fromDate, toDate);
      if (messages.length === 0) {
        Alert.alert('No Messages Found', 'No debited/credited SMS were found in that date range.');
        return;
      }
      navigation.navigate('RescanPreview', { messages });
    } catch (error: any) {
      Alert.alert('Scan Failed', error.message || 'Could not read SMS messages.');
    } finally {
      setScanning(false);
    }
  };

  const runPresetRescan = (days: number) => {
    const to = endOfDay(new Date());
    const from = startOfDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
    runRescan(from, to);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={[styles.infoCard, { backgroundColor: `${colors.primary}15` }]}>
        <Ionicons name="shield-checkmark-outline" size={24} color={colors.primary} />
        <Text style={[styles.infoText, { color: colors.text }]}>
          My Tracker can read incoming bank SMS to automatically log transactions and update your account balance — without you pasting anything in manually.
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>What this permission is used for</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            Only SMS containing words like "debited" or "credited" are processed — everything else is ignored on your device.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            Matching messages are sent only to your own My Tracker backend to extract the amount, merchant, and account — never to a third party.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            You'll get a notification every time a transaction is added this way, so you always know what happened.
          </Text>
        </View>
        <View style={styles.bulletRow}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.bulletText, { color: colors.text }]}>
            You can turn this off anytime below, or revoke SMS permission from Android Settings.
          </Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Auto-Read</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Auto-Read Bank SMS</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>
                {enabled ? 'Enabled — transactions are added automatically' : 'Disabled — use Scan SMS to add manually'}
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

        {!permissionGranted && (
          <TouchableOpacity style={styles.settingRowButton} onPress={() => Linking.openSettings()}>
            <View style={styles.settingInfo}>
              <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>
                SMS permission not granted — open Android Settings
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Rescan Past Messages</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.bulletText, { color: colors.textMuted }, { marginBottom: 4 }]}>
          Missed a transaction from before Auto-Read was on? Rescan your inbox for a date range — you'll
          review what's found before anything is added.
        </Text>

        {scanning ? (
          <View style={styles.scanningRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Scanning…</Text>
          </View>
        ) : (
          <>
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={[styles.presetButton, { borderColor: colors.border }]}
                onPress={() => runPresetRescan(1)}
                data-testid="button-rescan-today"
              >
                <Text style={[styles.presetButtonText, { color: colors.primary }]}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.presetButton, { borderColor: colors.border }]}
                onPress={() => runPresetRescan(3)}
                data-testid="button-rescan-3days"
              >
                <Text style={[styles.presetButtonText, { color: colors.primary }]}>Last 3 Days</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.presetButton, { borderColor: colors.border }]}
                onPress={() => setShowCustomRange(!showCustomRange)}
                data-testid="button-rescan-custom"
              >
                <Text style={[styles.presetButtonText, { color: colors.primary }]}>Custom Range</Text>
              </TouchableOpacity>
            </View>

            {showCustomRange && (
              <View style={styles.customRangeBox}>
                <TouchableOpacity style={styles.dateRow} onPress={() => setShowFromPicker(true)}>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>From</Text>
                  <Text style={[styles.settingTitle, { color: colors.text, fontSize: 14 }]}>
                    {customFrom.toDateString()}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateRow} onPress={() => setShowToPicker(true)}>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>To</Text>
                  <Text style={[styles.settingTitle, { color: colors.text, fontSize: 14 }]}>
                    {customTo.toDateString()}
                  </Text>
                </TouchableOpacity>
                {showFromPicker && (
                  <DateTimePicker
                    value={customFrom}
                    mode="date"
                    onChange={(_, date) => {
                      setShowFromPicker(false);
                      if (date) setCustomFrom(date);
                    }}
                  />
                )}
                {showToPicker && (
                  <DateTimePicker
                    value={customTo}
                    mode="date"
                    onChange={(_, date) => {
                      setShowToPicker(false);
                      if (date) setCustomTo(date);
                    }}
                  />
                )}
                <TouchableOpacity
                  style={[styles.scanButton, { backgroundColor: colors.primary }]}
                  onPress={() => runRescan(startOfDay(customFrom), endOfDay(customTo))}
                  data-testid="button-rescan-custom-scan"
                >
                  <Text style={styles.scanButtonText}>Scan</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>

      <TouchableOpacity
        style={styles.privacyLink}
        onPress={() => Linking.openURL(`${API_BASE_URL}/privacy-policy`)}
      >
        <Ionicons name="document-text-outline" size={16} color={colors.primary} />
        <Text style={[styles.privacyLinkText, { color: colors.primary }]}>Read the full Privacy Policy</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    borderRadius: 12,
    overflow: 'hidden',
    padding: 16,
    gap: 14,
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  presetButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  customRangeBox: {
    marginTop: 12,
    gap: 10,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scanButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  privacyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  privacyLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
