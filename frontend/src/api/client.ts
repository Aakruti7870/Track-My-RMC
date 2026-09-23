import axios from 'axios';
import { Platform } from 'react-native';

// Resolve backend API URL dynamically based on environment and platform
const getBaseUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  // Android emulator loopback vs iOS simulator / web
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

// Request interceptor to attach JWT token if available
apiClient.interceptors.request.use(
  async (config) => {
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle standard API errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorResponse = error.response?.data || {
      success: false,
      message: 'Server temporarily unavailable',
    };
    return Promise.reject(errorResponse);
  }
);

export default apiClient;
