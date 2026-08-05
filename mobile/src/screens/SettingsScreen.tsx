import { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert, TextInput, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../lib/api';
import { getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { checkBiometricAvailability, getBiometricName } from '../lib/biometric';

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isCleaningUpSmsLogs, setIsCleaningUpSmsLogs] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { checkPinRequired, user: authUser, setUser, logout } = useAuth();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);

  // Swipe gesture settings
  const [swipeEnabled, setSwipeEnabled] = useState(false);
  const [leftSwipeAction, setLeftSwipeAction] = useState<'edit' | 'delete'>('delete');
  const [rightSwipeAction, setRightSwipeAction] = useState<'edit' | 'delete'>('edit');

  const { data: user } = useQuery({
    queryKey: ['/api/user'],
    queryFn: api.getUser,
  });

  // Load swipe settings from AsyncStorage
  useEffect(() => {
    const loadSwipeSettings = async () => {
      try {
        const enabled = await AsyncStorage.getItem('swipeEnabled');
        const leftAction = await AsyncStorage.getItem('leftSwipeAction');
        const rightAction = await AsyncStorage.getItem('rightSwipeAction');
        
        if (enabled !== null) setSwipeEnabled(enabled === 'true');
        if (leftAction) setLeftSwipeAction(leftAction as 'edit' | 'delete');
        if (rightAction) setRightSwipeAction(rightAction as 'edit' | 'delete');
      } catch (error) {
        console.error('Error loading swipe settings:', error);
      }
    };
    loadSwipeSettings();
  }, []);

  // Save swipe settings to AsyncStorage
  const saveSwipeSettings = async (key: string, value: string) => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('Error saving swipe settings:', error);
    }
  };

  const toggleSwipeEnabled = () => {
    const newValue = !swipeEnabled;
    setSwipeEnabled(newValue);
    saveSwipeSettings('swipeEnabled', newValue.toString());
  };

  const handleLeftSwipeChange = (action: 'edit' | 'delete') => {
    // Ensure both swipes don't have the same action
    if (action === rightSwipeAction) {
      // Swap actions
      setRightSwipeAction(leftSwipeAction);
      saveSwipeSettings('rightSwipeAction', leftSwipeAction);
    }
    setLeftSwipeAction(action);
    saveSwipeSettings('leftSwipeAction', action);
  };

  const handleRightSwipeChange = (action: 'edit' | 'delete') => {
    // Ensure both swipes don't have the same action
    if (action === leftSwipeAction) {
      // Swap actions
      setLeftSwipeAction(rightSwipeAction);
      saveSwipeSettings('leftSwipeAction', rightSwipeAction);
    }
    setRightSwipeAction(action);
    saveSwipeSettings('rightSwipeAction', action);
  };

  const updateUserMutation = useMutation({
    mutationFn: api.updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    },
  });

  const setPinMutation = useMutation({
    mutationFn: api.setPin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      checkPinRequired();
      // checkPinRequired() only updates the in-memory hasPin flag used for same-session
      // locking — it doesn't touch the cached/persisted user object, so a cold restart
      // (or any later setUser call that spreads the stale object) would still read
      // hasPin: false and skip the lock screen. Keep the object itself in sync too.
      if (authUser) setUser({ ...authUser, hasPin: true });
      setShowPinModal(false);
      setPin('');
      Alert.alert('Success', 'PIN has been set. Next time you open the app, you will be asked to enter your PIN.');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to set PIN');
    },
  });

  const resetPinMutation = useMutation({
    mutationFn: api.resetPin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      checkPinRequired();
      // Same fix as setPinMutation above, in the other direction — without this, the
      // stale hasPin: true in the cached user object can get re-persisted by an unrelated
      // later setUser call (e.g. toggling biometric), locking the user out with no valid
      // PIN behind it and no way back in from the lock screen.
      if (authUser) setUser({ ...authUser, hasPin: false });
      Alert.alert('Success', 'PIN has been removed');
    },
  });

  const handleSetPin = () => {
    if (pin.length !== 4) {
      Alert.alert('Error', 'PIN must be 4 digits');
      return;
    }
    setPinMutation.mutate(pin);
  };

  const handleRemovePin = () => {
    Alert.alert(
      'Remove PIN',
      'Are you sure you want to remove PIN protection?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => resetPinMutation.mutate() },
      ]
    );
  };

  const toggleDarkMode = () => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  };

  const handleSystemTheme = () => {
    if (theme !== 'system') {
      setTheme('system');
    }
  };

  const getThemeLabel = () => {
    if (theme === 'dark') return 'Dark theme';
    if (theme === 'light') return 'Light theme';
    return `Auto (${resolvedTheme})`;
  };

  const toggleBiometric = async () => {
    if (!authUser) {
      Alert.alert('Error', 'User not found');
      return;
    }
    
    const newValue = !authUser.biometricEnabled;
    
    // If enabling, check device capability first
    if (newValue) {
      const biometricInfo = await checkBiometricAvailability();
      
      if (!biometricInfo.isAvailable) {
        Alert.alert('Not Available', 'Your device does not support biometric authentication.');
        return;
      }
      
      if (!biometricInfo.isEnrolled) {
        Alert.alert(
          'No Biometrics Enrolled', 
          `Please enroll your ${getBiometricName(biometricInfo.biometricType).toLowerCase()} in your device settings first.`
        );
        return;
      }
    }
    
    try {
      await api.toggleBiometric(authUser.id, newValue);
      setUser({ ...authUser, biometricEnabled: newValue });
      Alert.alert('Success', newValue ? 'Biometric authentication enabled' : 'Biometric authentication disabled');
      // Update query cache
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update biometric setting');
    }
  };

  const handleSmsLogCleanup = async () => {
    // Guards the preview round-trip too, so a rapid double-tap can't stack two alerts.
    setIsCleaningUpSmsLogs(true);
    try {
      const preview = await api.getSmsLogsCleanupPreview();
      if (preview.count === 0) {
        setIsCleaningUpSmsLogs(false);
        Alert.alert('Nothing to Clean Up', 'No SMS logs older than 12 months found.');
        return;
      }
      // Re-enable while the confirm dialog is up — only the network wait should block.
      setIsCleaningUpSmsLogs(false);
      Alert.alert(
        'Clean Up Old SMS Logs',
        `${preview.count} SMS log${preview.count === 1 ? '' : 's'} older than 12 months will be permanently deleted. This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setIsCleaningUpSmsLogs(true);
              try {
                const result = await api.cleanupSmsLogs();
                setIsCleaningUpSmsLogs(false);
                Alert.alert('Done', `${result.deletedCount} SMS log${result.deletedCount === 1 ? '' : 's'} deleted.`);
              } catch (error: any) {
                setIsCleaningUpSmsLogs(false);
                Alert.alert('Error', error.message || 'Failed to clean up SMS logs. Please try again.');
              }
            },
          },
        ]
      );
    } catch (error: any) {
      setIsCleaningUpSmsLogs(false);
      Alert.alert('Error', error.message || 'Failed to check SMS logs. Please try again.');
    }
  };

  const handleExportData = () => {
    Alert.alert(
      'Export Data',
      'Choose a format to export your transactions.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'CSV', onPress: () => exportData('csv') },
        { text: 'JSON', onPress: () => exportData('json') },
      ]
    );
  };

  const exportData = async (format: 'csv' | 'json') => {
    setIsExportingData(true);
    try {
      const result = await api.exportData(format);
      const fileUri = `${FileSystem.cacheDirectory}${result.filename}`;
      await FileSystem.writeAsStringAsync(fileUri, result.content, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      setIsExportingData(false);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: format === 'csv' ? 'text/csv' : 'application/json',
          dialogTitle: 'Export Data',
        });
      } else {
        Alert.alert('Saved', `File saved to ${fileUri}`);
      }
    } catch (error: any) {
      setIsExportingData(false);
      Alert.alert('Error', error.message || 'Failed to export data. Please try again.');
    }
  };

  const hasPin = !!user?.pinHash;
  const isSystemTheme = theme === 'system';

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Appearance</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Ionicons name="moon-outline" size={22} color={colors.text} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Dark Mode</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>{getThemeLabel()}</Text>
            </View>
          </View>
          <Switch
            value={resolvedTheme === 'dark'}
            onValueChange={toggleDarkMode}
            trackColor={{ false: colors.border, true: `${colors.primary}80` }}
            thumbColor={resolvedTheme === 'dark' ? colors.primary : colors.textMuted}
          />
        </View>
        <TouchableOpacity 
          style={[styles.settingRowButton, isSystemTheme && { opacity: 0.6 }]}
          onPress={handleSystemTheme}
          activeOpacity={isSystemTheme ? 1 : 0.7}
        >
          <View style={styles.settingInfo}>
            <Ionicons name="phone-portrait-outline" size={22} color={colors.text} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Auto (System)</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Follow device settings</Text>
            </View>
          </View>
          {isSystemTheme ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
          ) : (
            <Ionicons name="ellipse-outline" size={22} color={colors.textMuted} />
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Swipe Gestures</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Ionicons name="swap-horizontal-outline" size={22} color={colors.text} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Enable Swipe Actions</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Swipe items for quick actions</Text>
            </View>
          </View>
          <Switch
            value={swipeEnabled}
            onValueChange={toggleSwipeEnabled}
            trackColor={{ false: colors.border, true: `${colors.primary}80` }}
            thumbColor={swipeEnabled ? colors.primary : colors.textMuted}
          />
        </View>

        {swipeEnabled && (
          <>
            <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
              <View style={styles.settingInfo}>
                <Ionicons name="arrow-forward-outline" size={22} color={colors.text} />
                <View>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Right Swipe</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Swipe from left to right</Text>
                </View>
              </View>
              <View style={styles.actionSelector}>
                <TouchableOpacity
                  style={[
                    styles.actionOption,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    rightSwipeAction === 'edit' && { backgroundColor: colors.primary, borderColor: colors.primary }
                  ]}
                  onPress={() => handleRightSwipeChange('edit')}
                >
                  <Ionicons 
                    name="pencil" 
                    size={16} 
                    color={rightSwipeAction === 'edit' ? '#fff' : colors.text} 
                  />
                  <Text style={[
                    styles.actionOptionText,
                    { color: colors.text },
                    rightSwipeAction === 'edit' && { color: '#fff' }
                  ]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionOption,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    rightSwipeAction === 'delete' && { backgroundColor: '#ef4444', borderColor: '#ef4444' }
                  ]}
                  onPress={() => handleRightSwipeChange('delete')}
                >
                  <Ionicons 
                    name="trash-outline" 
                    size={16} 
                    color={rightSwipeAction === 'delete' ? '#fff' : colors.text} 
                  />
                  <Text style={[
                    styles.actionOptionText,
                    { color: colors.text },
                    rightSwipeAction === 'delete' && { color: '#fff' }
                  ]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.settingRowLast}>
              <View style={styles.settingInfo}>
                <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
                <View>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Left Swipe</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Swipe from right to left</Text>
                </View>
              </View>
              <View style={styles.actionSelector}>
                <TouchableOpacity
                  style={[
                    styles.actionOption,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    leftSwipeAction === 'edit' && { backgroundColor: colors.primary, borderColor: colors.primary }
                  ]}
                  onPress={() => handleLeftSwipeChange('edit')}
                >
                  <Ionicons 
                    name="pencil" 
                    size={16} 
                    color={leftSwipeAction === 'edit' ? '#fff' : colors.text} 
                  />
                  <Text style={[
                    styles.actionOptionText,
                    { color: colors.text },
                    leftSwipeAction === 'edit' && { color: '#fff' }
                  ]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionOption,
                    { backgroundColor: colors.background, borderColor: colors.border },
                    leftSwipeAction === 'delete' && { backgroundColor: '#ef4444', borderColor: '#ef4444' }
                  ]}
                  onPress={() => handleLeftSwipeChange('delete')}
                >
                  <Ionicons 
                    name="trash-outline" 
                    size={16} 
                    color={leftSwipeAction === 'delete' ? '#fff' : colors.text} 
                  />
                  <Text style={[
                    styles.actionOptionText,
                    { color: colors.text },
                    leftSwipeAction === 'delete' && { color: '#fff' }
                  ]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Security</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <View style={styles.settingInfo}>
            <Ionicons name="key-outline" size={22} color={colors.text} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>PIN Lock</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Protect app with 4-digit PIN</Text>
            </View>
          </View>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: colors.background, borderColor: colors.border }]}
            onPress={hasPin ? handleRemovePin : () => setShowPinModal(true)}
          >
            <Text style={[styles.actionButtonText, { color: colors.text }]}>
              {hasPin ? 'Remove' : 'Set PIN'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.settingRowLast}>
          <View style={styles.settingInfo}>
            <Ionicons name="finger-print-outline" size={22} color={colors.text} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Biometric Login</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Use fingerprint to unlock</Text>
            </View>
          </View>
          <Switch
            value={authUser?.biometricEnabled || false}
            onValueChange={toggleBiometric}
            trackColor={{ false: colors.border, true: `${colors.primary}80` }}
            thumbColor={authUser?.biometricEnabled ? colors.primary : colors.textMuted}
          />
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Data</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={styles.settingRowButton}
          onPress={handleExportData}
          disabled={isExportingData}
        >
          <View style={styles.settingInfo}>
            {isExportingData ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="download-outline" size={22} color={colors.text} />
            )}
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Export Data</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Download your transactions</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Account</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={styles.settingRowButton}
          onPress={() => {
            Alert.alert(
              'Logout',
              'Are you sure you want to logout? You will need to verify via OTP next time.',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Logout', 
                  style: 'destructive', 
                  onPress: logout
                },
              ]
            );
          }}
        >
          <View style={styles.settingInfo}>
            <Ionicons name="log-out-outline" size={22} color="#EF4444" />
            <View>
              <Text style={[styles.settingTitle, { color: '#EF4444' }]}>Logout</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Sign out of your account</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Danger Zone</Text>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <TouchableOpacity
          style={[styles.settingRow, { borderBottomColor: colors.border }]}
          onPress={handleSmsLogCleanup}
          disabled={isCleaningUpSmsLogs}
        >
          <View style={styles.settingInfo}>
            <Ionicons name="trash-outline" size={22} color={colors.warning} />
            <View>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Clean Up SMS Logs</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Delete SMS logs older than 12 months</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.settingRowButton}
          onPress={() => {
            Alert.alert(
              'Delete Account',
              'This will permanently delete your account and ALL your data including accounts, transactions, budgets, loans, insurance, savings goals, and scheduled payments. This action cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Delete Everything', 
                  style: 'destructive', 
                  onPress: () => {
                    Alert.alert(
                      'Are you absolutely sure?',
                      'Type "DELETE" mentally and confirm. All your financial data will be permanently erased.',
                      [
                        { text: 'No, keep my data', style: 'cancel' },
                        { 
                          text: 'Yes, delete permanently', 
                          style: 'destructive', 
                          onPress: async () => {
                            setIsDeletingAccount(true);
                            try {
                              await api.deleteUserAccount();
                              await AsyncStorage.clear();
                              queryClient.clear();
                              setIsDeletingAccount(false);
                              await logout();
                              Alert.alert('Done', 'Your account and all data have been deleted.');
                            } catch (error: any) {
                              setIsDeletingAccount(false);
                              Alert.alert('Error', error.message || 'Failed to delete account. Please try again.');
                            }
                          }
                        },
                      ]
                    );
                  }
                },
              ]
            );
          }}
        >
          <View style={styles.settingInfo}>
            <Ionicons name="trash-outline" size={22} color="#EF4444" />
            <View>
              <Text style={[styles.settingTitle, { color: '#EF4444' }]}>Delete Account</Text>
              <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Permanently delete all your data</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={showPinModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPinModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Set PIN</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>Enter a 4-digit PIN</Text>
            <TextInput
              style={[styles.pinInput, { backgroundColor: colors.card, color: colors.text }]}
              keyboardType="numeric"
              maxLength={4}
              secureTextEntry
              value={pin}
              onChangeText={setPin}
              placeholder="****"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButtonCancel, { backgroundColor: colors.card }]}
                onPress={() => { setShowPinModal(false); setPin(''); }}
              >
                <Text style={[styles.modalButtonCancelText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButtonConfirm, { backgroundColor: colors.primary }]}
                onPress={handleSetPin}
              >
                <Text style={styles.modalButtonConfirmText}>Set PIN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ height: 40 }} />

      <Modal visible={isDeletingAccount} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContent, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>Deleting account...</Text>
            <Text style={[styles.loadingSubtext, { color: colors.textMuted }]}>Please wait while we remove all your data</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={isCleaningUpSmsLogs} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={[styles.loadingContent, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>Cleaning up SMS logs...</Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
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
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  settingRowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
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
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  actionSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  actionOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  actionOptionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: '80%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  pinInput: {
    fontSize: 32,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 16,
    width: '100%',
    padding: 16,
    borderRadius: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalButtonCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
  modalButtonConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonConfirmText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#ffffff',
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '75%',
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  loadingSubtext: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
});
