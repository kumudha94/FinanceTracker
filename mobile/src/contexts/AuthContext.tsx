import { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, storeTokens, clearTokens, setAuthenticationFailedCallback } from '../lib/api';
import type { User } from '../lib/types';

interface AuthContextType {
  isLocked: boolean;
  isLoading: boolean;
  hasPin: boolean;
  hasPassword: boolean;
  isAuthenticated: boolean;
  username: string | null;
  user: (User & { hasPin: boolean; hasPassword: boolean; biometricEnabled: boolean }) | null;
  unlock: () => void;
  login: (user: User & { hasPin: boolean; hasPassword: boolean; biometricEnabled: boolean }, accessToken?: string, refreshToken?: string) => void;
  logout: () => void;
  setUser: (user: User & { hasPin: boolean; hasPassword: boolean; biometricEnabled: boolean }) => void;
  checkPinRequired: () => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEYS = {
  USER: '@finance_tracker_user',
  AUTH_TOKEN: '@finance_tracker_token',
  USERNAME: '@finance_tracker_username',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [user, setUser] = useState<(User & { hasPin: boolean; hasPassword: boolean; biometricEnabled: boolean }) | null>(null);
  const appState = useRef(AppState.currentState);
  const hasPinRef = useRef(false);

  useEffect(() => {
    hasPinRef.current = hasPin;
  }, [hasPin]);

  const lockApp = useCallback(() => {
    if (hasPinRef.current) {
      setIsLocked(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.USER);
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      await AsyncStorage.removeItem(STORAGE_KEYS.USERNAME);
      await clearTokens();
      setUser(null);
      setUsername(null);
      setIsAuthenticated(false);
      setHasPin(false);
      setHasPassword(false);
      hasPinRef.current = false;
      setIsLocked(false);
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }, []);

  // Handle authentication failures from API calls
  const handleAuthenticationFailed = useCallback(() => {
    console.log('Authentication failed - logging out user');
    logout();
  }, [logout]);

  useEffect(() => {
    // Register callback for authentication failures
    setAuthenticationFailedCallback(handleAuthenticationFailed);
    
    checkAuthStatus();

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current === 'active' && (nextAppState === 'background' || nextAppState === 'inactive')) {
        lockApp();
      }
      appState.current = nextAppState;
    });
    
    return () => {
      subscription.remove();
      setAuthenticationFailedCallback(() => {}); // Clean up callback
    };
  }, [lockApp, handleAuthenticationFailed]);

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      const storedUser = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      const storedUsername = await AsyncStorage.getItem(STORAGE_KEYS.USERNAME);
      
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        setIsAuthenticated(true);
        const userHasPin = userData.hasPin;
        const userHasPassword = userData.hasPassword;
        setHasPin(userHasPin);
        setHasPassword(userHasPassword);
        hasPinRef.current = userHasPin;
        
        if (storedUsername) {
          setUsername(storedUsername);
        } else if (userData.name) {
          // Migrate username from user data if not already stored
          setUsername(userData.name);
          await AsyncStorage.setItem(STORAGE_KEYS.USERNAME, userData.name);
        }
        
        // Lock if PIN is set
        if (userHasPin) {
          setIsLocked(true);
        } else {
          setIsLocked(false);
        }
      } else {
        // No user stored, not authenticated
        setIsAuthenticated(false);
        setIsLocked(false);
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
      setIsAuthenticated(false);
      setIsLocked(false);
    } finally {
      setIsLoading(false);
    }
  };

  const checkPinRequired = async () => {
    try {
      setIsLoading(true);
      const apiUser = await api.getUser();
      const userHasPin = !!apiUser?.pinHash;
      setHasPin(userHasPin);
      hasPinRef.current = userHasPin;
      
      if (!userHasPin) {
        setIsLocked(false);
      } else {
        setIsLocked(true);
      }
    } catch (error) {
      console.error('Failed to check PIN status:', error);
      // Don't block the app if API fails - allow access without PIN
      setIsLocked(false);
      setHasPin(false);
      hasPinRef.current = false;
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (userData: User & { hasPin: boolean; hasPassword: boolean; biometricEnabled: boolean }, accessToken?: string, refreshToken?: string) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
      if (userData.name) {
        await AsyncStorage.setItem(STORAGE_KEYS.USERNAME, userData.name);
        setUsername(userData.name);
      }
      if (accessToken && refreshToken) {
        await storeTokens(accessToken, refreshToken);
      }
      setUser(userData);
      setIsAuthenticated(true);
      setHasPin(userData.hasPin);
      setHasPassword(userData.hasPassword);
      hasPinRef.current = userData.hasPin;
      
      // If no PIN, unlock immediately
      if (!userData.hasPin) {
        setIsLocked(false);
      }
    } catch (error) {
      console.error('Failed to save user:', error);
    }
  }, []);

  const setUserData = useCallback(async (userData: User & { hasPin: boolean; hasPassword: boolean; biometricEnabled: boolean }) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
      if (userData.name) {
        await AsyncStorage.setItem(STORAGE_KEYS.USERNAME, userData.name);
        setUsername(userData.name);
      }
      setUser(userData);
      setHasPassword(userData.hasPassword);
      setHasPin(userData.hasPin);
      hasPinRef.current = userData.hasPin;
    } catch (error) {
      console.error('Failed to update user:', error);
    }
  }, []);

  const unlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!user) return false;
    
    try {
      const result = await api.verifyPinAuth(user.id, pin);
      if (result.success) {
        unlock();
        return true;
      }
      return false;
    } catch (error) {
      console.error('PIN verification failed:', error);
      return false;
    }
  }, [user, unlock]);

  return (
    <AuthContext.Provider value={{ 
      isLocked, 
      isLoading, 
      hasPin, 
      hasPassword,
      isAuthenticated, 
      username,
      user, 
      unlock, 
      login, 
      logout, 
      setUser: setUserData,
      checkPinRequired, 
      verifyPin 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
