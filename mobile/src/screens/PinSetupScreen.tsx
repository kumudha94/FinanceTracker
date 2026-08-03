import { useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getThemedColors } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { RootStackParamList } from '../../App';

type PinSetupNavigationProp = NativeStackNavigationProp<RootStackParamList, 'PinSetup'>;

export default function PinSetupScreen() {
  const navigation = useNavigation<PinSetupNavigationProp>();
  const { resolvedTheme } = useTheme();
  const colors = useMemo(() => getThemedColors(resolvedTheme), [resolvedTheme]);
  const { user, setUser } = useAuth();
  
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState(['', '', '', '']);
  const [confirmPin, setConfirmPin] = useState(['', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const currentPin = step === 'enter' ? pin : confirmPin;
  const setCurrentPin = step === 'enter' ? setPin : setConfirmPin;

  const handlePinChange = (value: string, index: number) => {
    const newPin = [...currentPin];
    newPin[index] = value;
    setCurrentPin(newPin);
    
    // Auto-focus next input
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    
    // Auto-submit when all 4 digits entered
    if (index === 3 && value) {
      handleNext(newPin);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !currentPin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleNext = async (pinArray = currentPin) => {
    const pinString = pinArray.join('');
    
    if (pinString.length !== 4) {
      Alert.alert('Error', 'Please enter a 4-digit PIN');
      return;
    }

    if (step === 'enter') {
      // Move to confirmation step
      setStep('confirm');
      inputRefs.current[0]?.focus();
    } else {
      // Verify both PINs match and save
      const originalPin = pin.join('');
      if (pinString !== originalPin) {
        Alert.alert('Error', 'PINs do not match. Please try again.');
        setConfirmPin(['', '', '', '']);
        setStep('enter');
        setPin(['', '', '', '']);
        inputRefs.current[0]?.focus();
        return;
      }

      if (!user) {
        Alert.alert('Error', 'User not found');
        return;
      }

      setIsLoading(true);
      try {
        await api.setupPin(user.id, pinString);
        setUser({ ...user, hasPin: true });
        Alert.alert('Success', 'PIN has been set successfully!', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to set PIN');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSkip = () => {
    Alert.alert(
      'Skip PIN Setup',
      'Are you sure you want to skip PIN setup? You can set it up later from Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', onPress: () => navigation.goBack() }
      ]
    );
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
          <Text style={[styles.skipText, { color: colors.primary }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="lock-closed" size={48} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {step === 'enter' ? 'Create Your PIN' : 'Confirm Your PIN'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {step === 'enter' 
            ? 'Enter a 4-digit PIN to secure your account' 
            : 'Enter your PIN again to confirm'}
        </Text>

        <View style={styles.pinContainer}>
          {currentPin.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => (inputRefs.current[index] = ref)}
              style={[
                styles.pinInput,
                { 
                  backgroundColor: colors.card, 
                  borderColor: digit ? colors.primary : colors.border,
                  color: colors.text 
                }
              ]}
              value={digit}
              onChangeText={(value) => handlePinChange(value, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={1}
              secureTextEntry
              selectTextOnFocus
              editable={!isLoading}
              autoFocus={index === 0}
            />
          ))}
        </View>

        {step === 'confirm' && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              setStep('enter');
              setPin(['', '', '', '']);
              setConfirmPin(['', '', '', '']);
              inputRefs.current[0]?.focus();
            }}
          >
            <Text style={[styles.backText, { color: colors.primary }]}>
              Change PIN
            </Text>
          </TouchableOpacity>
        )}

        {isLoading && (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    paddingTop: 48,
    alignItems: 'flex-end',
  },
  skipButton: {
    padding: 8,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  pinContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 32,
  },
  pinInput: {
    width: 56,
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  backButton: {
    padding: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loader: {
    marginTop: 24,
  },
});
