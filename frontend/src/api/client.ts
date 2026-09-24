// API client for TrackMyRMC. Base URL from env; all routes under /api.
const RAW_BACKEND = (process.env.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_API_URL)?.trim();
const REQUEST_TIMEOUT_MS = 30_000;

export type ApiError = { status: number; detail: string };

export function isApiError(error: unknown): error is ApiError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number" &&
      "detail" in error &&
      typeof error.detail === "string",
  );
}

export function apiErrorDetail(error: unknown, fallback: string): string {
  return isApiError(error) && error.detail.trim() ? error.detail : fallback;
}

function apiBase(): string {
  if (!RAW_BACKEND) {
    throw {
      status: 0,
      detail: "TrackMyRMC backend is not configured for this build",
    } as ApiError;
  }

  let parsed: URL;
  try {
    parsed = new URL(RAW_BACKEND);
  } catch {
    throw { status: 0, detail: "TrackMyRMC backend URL is invalid" } as ApiError;
  }

  const localHost = ["localhost", "127.0.0.1", "10.0.2.2"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localHost)) {
    throw {
      status: 0,
      detail: "TrackMyRMC backend must use HTTPS in production",
    } as ApiError;
  }

  return `${RAW_BACKEND.replace(/\/$/, "")}/api`;
}

function validatedApiPath(path: string): string {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("#") ||
    path.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(path)
  ) {
    throw { status: 0, detail: "Invalid TrackMyRMC API path" } as ApiError;
  }

  const pathname = path.split("?", 1)[0];
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    throw { status: 0, detail: "Invalid TrackMyRMC API path encoding" } as ApiError;
  }

  if (decodedPathname.split("/").some((segment) => segment === "." || segment === "..")) {
    throw { status: 0, detail: "Invalid TrackMyRMC API path" } as ApiError;
  }

  return path;
}

export type AuthSessionResponse = {
  access_token?: string;
  token: string;
  token_type: string;
  expires_at: string;
  role: string;
  name: string;
};

export type OtpRequestResponse = {
  status: string;
  channel: string;
  expires_in?: number;
  email?: string;
  message?: string;
  dev_otp?: string;
  mfa_setup_required?: boolean;
  passkey_available?: boolean;
  delivery?: { adapter: string; configured: boolean };
};

export type StaffAuthMethodResponse = {
  status: "AUTHENTICATOR_REQUIRED" | "EMAIL_OTP_REQUIRED";
  email: string;
  method: "totp" | "email_otp";
  recovery_available?: boolean;
  message?: string;
};

export type MfaEnrollmentStartResponse = {
  status: "MFA_ENROLLMENT_STARTED";
  issuer: string;
  account: string;
  manual_key: string;
  otpauth_uri: string;
  qr_data_uri?: string | null;
  expires_in: number;
};

export type MfaEnrollmentConfirmResponse = {
  status: "MFA_ENABLED";
  recovery_codes: string[];
  message: string;
};

export type PasskeyReturnMode = "app" | "web";
export type PasskeyStartResponse = {
  request_id: string;
  authorization_url: string;
  expires_in: number;
  email?: string;
};
export type WebAuthnOptionsResponse = Record<string, unknown> & { ceremony_id: string };
export type PasskeyVerifyResponse = {
  status: "PASSKEY_VERIFIED";
  handoff_code: string;
  return_mode: PasskeyReturnMode;
  expires_in: number;
};
export type PasskeyRegisterResponse = {
  status: "PASSKEY_REGISTERED";
  return_mode: PasskeyReturnMode;
  passkey_count: number;
};

export type PlayReviewRole = "customer" | "plant_owner" | "driver";

type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

function validationDetail(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const messages = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const msg = "msg" in item && typeof item.msg === "string" ? item.msg : null;
      const loc = "loc" in item && Array.isArray(item.loc) ? item.loc.map(String).join(".") : null;
      return msg ? (loc ? `${loc}: ${msg}` : msg) : null;
    })
    .filter((item): item is string => Boolean(item));
  return messages.length ? messages.join("; ") : null;
}

function normalizeErrorDetail(body: unknown, status: number): string {
  // Never expose raw proxy/server HTML or infrastructure details to users.
  // A 5xx response is an availability failure and must be presented as a
  // controlled login/application message rather than a coding paragraph.
  if (status >= 500 && status <= 599) return "Server down";

  if (body && typeof body === "object") {
    if ("detail" in body) {
      if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
      const detail = validationDetail(body.detail);
      if (detail) return detail;
    }
    if ("message" in body && typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Request failed (${status})`;
}

async function readResponseBody(res: Response): Promise<unknown> {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JsonBody;
  } catch {
    return raw;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await readResponseBody(res);
  if (!res.ok) {
    throw { status: res.status, detail: normalizeErrorDetail(body, res.status) } as ApiError;
  }
  return body as T;
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const safePath = validatedApiPath(path);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();

  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(`${apiBase()}${safePath}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    return await handle<T>(res);
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (options.signal?.aborted && !timedOut) {
        throw { status: 0, detail: "Request cancelled" } as ApiError;
      }
      throw {
        status: 0,
        detail: "Request timed out. Check your connection and try again.",
      } as ApiError;
    }
    throw {
      status: 0,
      detail: "Unable to reach the TrackMyRMC server. Check your connection and try again.",
    } as ApiError;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function apiPublicGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export async function apiPublicPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body });
}

export async function requestOtp(identifier: string) {
  return apiPublicPost<OtpRequestResponse>("/auth/otp/whatsapp/send", { phone: identifier });
}

export async function verifyOtp(identifier: string, code: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/otp/whatsapp/verify", { phone: identifier, otp: code });
}

export async function requestStaffOtp(identifier: string) {
  return apiPublicPost<OtpRequestResponse>("/auth/otp/email/send", { email: identifier });
}

export async function verifyStaffOtp(identifier: string, code: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/otp/email/verify", { email: identifier, otp: code });
}

export async function staffAuthMethod(identifier: string) {
  return apiPublicPost<StaffAuthMethodResponse>("/auth/staff/mfa/method", { identifier });
}

export async function verifyStaffTotp(identifier: string, code: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/staff/mfa/verify-totp", { identifier, code });
}

export async function verifyStaffRecovery(identifier: string, recoveryCode: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/staff/mfa/verify-recovery", {
    identifier,
    recovery_code: recoveryCode,
  });
}

export async function startStaffMfaEnrollment(token: string) {
  return apiPost<MfaEnrollmentStartResponse>("/auth/staff/mfa/enroll/start", token);
}

export async function confirmStaffMfaEnrollment(token: string, code: string) {
  return apiPost<MfaEnrollmentConfirmResponse>("/auth/staff/mfa/enroll/confirm", token, { code });
}

export async function startStaffPasskeyAuthentication(
  identifier: string,
  returnMode: PasskeyReturnMode,
) {
  return apiPublicPost<PasskeyStartResponse>("/auth/staff/passkey/authenticate/start", {
    identifier,
    return_mode: returnMode,
  });
}

export async function staffPasskeyAuthenticationOptions(requestId: string) {
  return apiPublicPost<WebAuthnOptionsResponse>("/auth/staff/passkey/authenticate/options", {
    request_id: requestId,
  });
}

export async function verifyStaffPasskeyAuthentication(
  requestId: string,
  ceremonyId: string,
  credential: Record<string, unknown>,
) {
  return apiPublicPost<PasskeyVerifyResponse>("/auth/staff/passkey/authenticate/verify", {
    request_id: requestId,
    ceremony_id: ceremonyId,
    credential,
  });
}

export async function exchangeStaffPasskeyHandoff(code: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/staff/passkey/exchange", { code });
}

export async function startStaffPasskeyRegistration(
  token: string,
  actorCode: string,
  returnMode: PasskeyReturnMode,
) {
  return apiPost<PasskeyStartResponse>("/auth/staff/passkey/register/start", token, {
    actor_code: actorCode,
    return_mode: returnMode,
  });
}

export async function staffPasskeyRegistrationOptions(requestId: string) {
  return apiPublicPost<WebAuthnOptionsResponse>("/auth/staff/passkey/register/options", {
    request_id: requestId,
  });
}

export async function verifyStaffPasskeyRegistration(
  requestId: string,
  ceremonyId: string,
  credential: Record<string, unknown>,
) {
  return apiPublicPost<PasskeyRegisterResponse>("/auth/staff/passkey/register/verify", {
    request_id: requestId,
    ceremony_id: ceremonyId,
    credential,
  });
}

export async function removeStaffPasskey(
  token: string,
  credentialId: string,
  actorCode: string,
) {
  return apiPost<{ status: "PASSKEY_REMOVED" }>("/auth/staff/passkey/remove", token, {
    credential_id: credentialId,
    actor_code: actorCode,
  });
}

export async function playReviewLogin(role: PlayReviewRole, accessCode: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/play-review", {
    role,
    access_code: accessCode,
  });
}

export async function startGoogleStaffLogin() {
  return apiPublicGet<{ authorization_url: string }>("/auth/google/start");
}

export async function exchangeGoogleStaffCode(code: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/google/exchange", { code });
}

export async function demoLogin(role: string) {
  return apiPublicPost<AuthSessionResponse>("/auth/demo-login", { role });
}

export async function apiGet<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { token, signal });
}

export async function apiPost<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", token, body });
}

export async function apiPut<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", token, body });
}

export async function apiPatch<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", token, body });
}

export async function apiDelete<T>(path: string, token: string): Promise<T> {
  return request<T>(path, { method: "DELETE", token });
}
