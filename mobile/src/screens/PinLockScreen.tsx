import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { getThemedColors, COLORS } from '../lib/utils';
import { api, storeTokens } from '../lib/api';
import { checkBiometricAvailability, authenticateWithBiometrics, getBiometricName, BiometricInfo } from '../lib/biometric';

export default function PinLockScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [biometricInfo, setBiometricInfo] = useState<BiometricInfo | null>(null);
  const [showBiometric, setShowBiometric] = useState(true);
  const { user, hasPin, unlock, logout } = useAuth();
  const { resolvedTheme } = useTheme();
  const colors = getThemedColors(resolvedTheme);

  // Last-resort escape hatch: if the locally cached PIN/biometric state ever drifts from
  // what the server actually has (e.g. a lock-state sync bug), there'd otherwise be no way
  // back into the app from here. Logging out and back in re-fetches the real state fresh.
  const handleForgotPin = () => {
    Alert.alert(
      'Log Out?',
      hasPin
        ? "If your PIN isn't working, you can log out and sign back in with your username and password."
        : "If biometric unlock isn't working, you can log out and sign back in with your username and password.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: () => logout() },
      ]
    );
  };

  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    const info = await checkBiometricAvailability();
    setBiometricInfo(info);
    
    // Auto-prompt biometric if available and enrolled
    if (info.isAvailable && info.isEnrolled && user?.biometricEnabled) {
      handleBiometricAuth();
    }
  };

  const handleBiometricAuth = async () => {
    if (!biometricInfo?.isAvailable || !biometricInfo?.isEnrolled || !user) return;

    setIsVerifying(true);
    const result = await authenticateWithBiometrics('Unlock Finance Tracker');
    
    if (result.success) {
      // Biometric success - verify with server
      try {
        const verifyResult = await api.verifyBiometric(user.id);
        if (verifyResult.success && verifyResult.accessToken && verifyResult.refreshToken) {
          await storeTokens(verifyResult.accessToken, verifyResult.refreshToken);
          unlock();
        } else {
          setError('Authentication failed');
          setShowBiometric(false);
        }
      } catch (error) {
        setError('Authentication failed');
        setShowBiometric(false);
      }
    } else if (result.error !== 'Cancelled') {
      setError(result.error || 'Biometric authentication failed');
      setShowBiometric(false);
    }
    
    setIsVerifying(false);
  };

  const handleNumberPress = async (num: string) => {
    if (pin.length >= 4) return;
    
    const newPin = pin + num;
    setPin(newPin);
    setError('');

    if (newPin.length === 4 && user) {
      setIsVerifying(true);
      try {
        const result = await api.verifyPinAuth(user.id, newPin);
        if (result.success && result.accessToken && result.refreshToken) {
          // Store new tokens
          await storeTokens(result.accessToken, result.refreshToken);
          unlock();
        } else {
          Vibration.vibrate(200);
          setError('Incorrect PIN');
          setPin('');
        }
      } catch (error) {
        Vibration.vibrate(200);
        setError('Incorrect PIN');
        setPin('');
      } finally {
        setIsVerifying(false);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
  };

  const renderDots = () => {
    return (
      <View style={styles.dotsContainer}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { 
                backgroundColor: i < pin.length ? colors.primary : 'transparent',
                borderColor: error ? colors.danger : colors.border,
              },
            ]}
          />
        ))}
      </View>
    );
  };

  const renderNumberPad = () => {
    const numbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'];
    
    return (
      <View style={styles.numberPad}>
        {numbers.map((num, index) => {
          if (num === '') {
            return <View key={index} style={styles.numberButton} />;
          }
          
          if (num === 'delete') {
            return (
              <TouchableOpacity
                key={index}
                style={styles.numberButton}
                onPress={handleDelete}
                disabled={pin.length === 0}
              >
                <Ionicons name="backspace-outline" size={28} color={pin.length === 0 ? colors.textMuted : colors.text} />
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={index}
              style={[styles.numberButton, { backgroundColor: colors.card }]}
              onPress={() => handleNumberPress(num)}
              disabled={isVerifying}
            >
              <Text style={[styles.numberText, { color: colors.text }]}>{num}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="lock-closed" size={40} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>
          {hasPin ? 'Enter PIN' : 'Unlock'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {hasPin
            ? 'Enter your 4-digit PIN to unlock'
            : `Use ${getBiometricName(biometricInfo?.biometricType ?? 'none')} to unlock`}
        </Text>
      </View>

      {isVerifying ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          {hasPin && renderDots()}
          {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}

          {/* Biometric Button. Biometric-only accounts (no PIN) have no fallback input, so the
              retry button must stay available even after a failed attempt — otherwise "Log Out"
              would be the only way back in. PIN accounts still hide it after a failure since the
              PIN pad below is a real fallback. */}
          {biometricInfo?.isAvailable && biometricInfo?.isEnrolled && user?.biometricEnabled && (showBiometric || !hasPin) && (
            <TouchableOpacity
              style={[styles.biometricButton, { backgroundColor: colors.card }]}
              onPress={handleBiometricAuth}
            >
              <Ionicons
                name={biometricInfo.biometricType === 'facial' ? 'scan' : 'finger-print'}
                size={32}
                color={colors.primary}
              />
              <Text style={[styles.biometricText, { color: colors.text }]}>
                Use {getBiometricName(biometricInfo.biometricType)}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {hasPin && renderNumberPad()}

      <TouchableOpacity onPress={handleForgotPin} style={styles.forgotPinButton}>
        <Text style={[styles.forgotPinText, { color: colors.textMuted }]}>
          {hasPin ? 'Forgot PIN? Log Out' : 'Log Out'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginVertical: 40,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  loadingContainer: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: -20,
    marginBottom: 20,
  },
  numberPad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    maxWidth: 300,
    alignSelf: 'center',
  },
  numberButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberText: {
    fontSize: 28,
    fontWeight: '500',
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 20,
    alignSelf: 'center',
  },
  biometricText: {
    fontSize: 16,
    fontWeight: '600',
  },
  forgotPinButton: {
    alignSelf: 'center',
    marginTop: 16,
    padding: 8,
  },
  forgotPinText: {
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
