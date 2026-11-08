import axios from 'axios';

// Privileged bearer tokens live only in this page's memory. Reloading requires
// authentication again; neither browser storage nor another tab receives them.
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null) { accessToken = token; }

// Remove any token persisted by an older dashboard version.
if (typeof window !== 'undefined') window.sessionStorage.removeItem('trackmyrmc_admin_token');

// Never send development credentials to the production host by default.
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : 'https://trackmyrmc.com');

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorData = error.response?.data || {
      success: false,
      message: 'Server temporarily unavailable',
    };
    return Promise.reject(errorData);
  }
);

export default apiClient;
