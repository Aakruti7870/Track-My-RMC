import axios from 'axios';

// The Admin bearer stays in memory. Rust validates the HttpOnly session cookie after reload.
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export function setAccessToken(token: string | null) { accessToken = token; }

// Remove any token persisted by an older dashboard version.
try {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem('trackmyrmc_admin_token');
} catch {
  // Storage may be blocked by browser policy. Current tokens stay memory-only.
}

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
    const status = error.response?.status;
    const body = error.response?.data;
    // Non-JSON proxy pages and Blob errors must never become user-facing text.
    const message = status >= 500
      ? 'The service is temporarily unavailable. Please try again.'
      : body && typeof body === 'object' && typeof body.message === 'string' && body.message.trim()
        ? body.message
        : status ? `Request failed (${status}). Please try again.`
          : 'Unable to reach the server. Check your connection and try again.';
    const errorData = { success: false, message, status, error_code: body?.error_code };
    return Promise.reject(errorData);
  }
);

const SIGNED_OUT = 'tmrmc-admin-signed-out';

export function markCentralSignedOut() {
  try { localStorage.setItem(SIGNED_OUT, 'true'); } catch { /* Server revocation still applies. */ }
}

let restoring: Promise<CentralSession | null> | undefined;
type CentralSession = {
  token: string;
  user: { id: string; email?: string; role: 'central_admin' };
  permissions: string[];
};

export function restoreCentralSession(): Promise<CentralSession | null> {
  try { if (localStorage.getItem(SIGNED_OUT)) return Promise.resolve(null); } catch { /* Check the server. */ }
  restoring ??= apiClient.post<CentralSession>('/api/admin/auth/session', {}, {withCredentials:true})
    .then(({data}) => {
      if (data?.user?.role !== 'central_admin' || !data.token) return null;
      return data;
    })
    .catch(error => {
      if (error.status === 401 || error.status === 403 || error.status === 404) return null;
      throw error;
    })
    .finally(() => { restoring = undefined; });
  return restoring;
}

export function rememberCentralSession() {
  return apiClient.post('/api/admin/auth/session/remember', {}, {withCredentials:true}).then(() => {
    try { localStorage.removeItem(SIGNED_OUT); } catch { /* The cookie remains usable. */ }
  });
}

export async function fetchAdminPromotions() {
  const { data } = await apiClient.get('/api/control-center/promotions');
  return data;
}

export async function activateAdminPromotion(payload: {
  plant_id: string;
  enquiry_id?: string;
  radius_km: number;
  duration_days: number;
  audit_reason: string;
}) {
  const { data } = await apiClient.post('/api/control-center/promotions/activate', payload);
  return data;
}

export async function updateAdminPromotionRadius(
  plantId: string,
  radius_km: number,
  audit_reason: string,
) {
  const { data } = await apiClient.patch(
    `/api/control-center/promotions/${encodeURIComponent(plantId)}/radius`,
    { radius_km, audit_reason },
  );
  return data;
}

export async function setAdminPromotionStatus(
  plantId: string,
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED',
  audit_reason: string,
) {
  const { data } = await apiClient.post(
    `/api/control-center/promotions/${encodeURIComponent(plantId)}/status`,
    { status, audit_reason },
  );
  return data;
}

export default apiClient;
