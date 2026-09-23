import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { User, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  sendWhatsAppOtp: (phone: string) => Promise<void>;
  verifyWhatsAppOtp: (phone: string, otp: string) => Promise<User>;
  sendEmailOtp: (email: string, plantCode?: string) => Promise<void>;
  verifyEmailOtp: (email: string, otp: string, plantCode?: string) => Promise<User>;
  verifyTotpLogin: (usernameOrPhone: string, codeOrRecovery: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'trackmyrmc_jwt_token';
const USER_KEY = 'trackmyrmc_user_data';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
        const storedUser = await AsyncStorage.getItem(USER_KEY);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        }
      } catch (e) {
        console.warn('Failed to restore session:', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadSession();
  }, []);

  const persistAuth = async (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
  };

  const sendWhatsAppOtp = async (phone: string) => {
    await apiClient.post('/api/auth/otp/whatsapp/send', { phone, purpose: 'login' });
  };

  const verifyWhatsAppOtp = async (phone: string, otp: string): Promise<User> => {
    const res = await apiClient.post('/api/auth/otp/whatsapp/verify', { phone, otp, purpose: 'login' });
    const { token: jwtToken, user: userData } = res.data;
    await persistAuth(jwtToken, userData);
    return userData;
  };

  const sendEmailOtp = async (email: string, plantCode?: string) => {
    await apiClient.post('/api/auth/otp/email/send', { email, plant_code: plantCode });
  };

  const verifyEmailOtp = async (email: string, otp: string, plantCode?: string): Promise<User> => {
    const res = await apiClient.post('/api/auth/otp/email/verify', { email, otp, plant_code: plantCode });
    const { token: jwtToken, user: userData } = res.data;
    await persistAuth(jwtToken, userData);
    return userData;
  };

  const verifyTotpLogin = async (usernameOrPhone: string, codeOrRecovery: string): Promise<User> => {
    const res = await apiClient.post('/api/auth/totp/login', {
      username_or_phone: usernameOrPhone,
      code_or_recovery: codeOrRecovery,
    });
    const { token: jwtToken, user: userData } = res.data;
    await persistAuth(jwtToken, userData);
    return userData;
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    delete apiClient.defaults.headers.common['Authorization'];
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        sendWhatsAppOtp,
        verifyWhatsAppOtp,
        sendEmailOtp,
        verifyEmailOtp,
        verifyTotpLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
