import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const getBaseUrl = (): string => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  return Platform.select({
    android: 'http://10.0.2.2:8000',
    ios: 'http://localhost:8000',
    default: 'http://localhost:8000',
  });
};

export const API_URL = getBaseUrl();

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

const TOKEN_KEY = 'trackmyrmc_jwt_token';

apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error.response?.data;
    const message =
      data?.message ||
      data?.error ||
      (error.response ? `Request failed with status ${error.response.status}` : 'Server temporarily unavailable');

    return Promise.reject(new Error(message));
  }
);

export default apiClient;
