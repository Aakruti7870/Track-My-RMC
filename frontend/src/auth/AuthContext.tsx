import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { sessionLossMessage, sessionLossReason } from "@/src/auth/sessionPolicy";
import { supportsSessionLock, withSessionLock } from "@/src/auth/sessionLock";
import { onSessionLoss } from "@/src/auth/sessionEvents";

import { storage } from "@/src/utils/storage";
import {
  apiGet,
  apiPost,
  refreshSession,
  AuthSessionResponse,
  demoLogin as apiDemoLogin,
  exchangeGoogleStaffCode,
  isApiError,
  playReviewLogin,
  PlayReviewRole,
  requestOtp,
  requestStaffOtp,
  staffAuthMethod,
  verifyOtp,
  verifyStaffOtp,
  verifyStaffRecovery,
  verifyStaffTotp,
  startStaffMfaEnrollment as apiStartStaffMfaEnrollment,
  confirmStaffMfaEnrollment as apiConfirmStaffMfaEnrollment,
} from "@/src/api/client";
import { stopTripLocationTracking } from "@/src/location/tripTracking";
import { unregisterPushDevice } from "@/src/notifications/pushClient";

const TOKEN_KEY = "tmrmc_token";
const REFRESH_KEY = "tmrmc_refresh";
const SIGNED_OUT_KEY = "tmrmc_explicit_signout";

export type Me = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobile?: string | null;
  role: string;
  role_label: string;
  roles: string[];
  plant_id: string | null;
  status: string;
  kyc_status: string;
  mfa_enabled?: boolean;
  mfa_configured?: boolean;
  passkey_enabled?: boolean;
  passkey_count?: number;
};

type AuthContextValue = {
  hydrating: boolean;
  sessionMessage: string | null;
  token: string | null;
  user: Me | null;
  requestOtp: typeof requestOtp;
  requestStaffOtp: typeof requestStaffOtp;
  staffAuthMethod: typeof staffAuthMethod;
  verify: (identifier: string, code: string) => Promise<Me>;
  verifyStaff: (identifier: string, code: string) => Promise<import("@/src/api/client").StaffMfaChallengeResponse>;
  verifyStaffAuthenticator: (identifier: string, code: string) => Promise<Me>;
  verifyStaffRecovery: (identifier: string, code: string) => Promise<Me>;
  startStaffMfaEnrollment: (challengeToken?: string) => Promise<import("@/src/api/client").MfaEnrollmentStartResponse>;
  confirmStaffMfaEnrollment: (code: string) => Promise<import("@/src/api/client").MfaEnrollmentConfirmResponse>;
  verifyGoogle: (code: string) => Promise<Me>;
  demoLogin: (role: string) => Promise<Me>;
  verifyPlayReview: (role: PlayReviewRole, accessCode: string) => Promise<Me>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [hydrating, setHydrating] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<Me | null>(null);
  const [staffMfaChallenge, setStaffMfaChallenge] = useState<string | null>(null);
  // A generation change invalidates every in-flight refresh before it can
  // restore tokens after local logout or server-confirmed session replacement.
  const sessionGeneration = useRef(0);
  const signedOutLocally = useRef(false);
  const refreshFlight = useRef<Promise<string> | null>(null);
  const rotateSession = useCallback(async (currentAccess?: string): Promise<string> => {
    const expired = () => ({
      status: 401,
      detail: "Your session has expired. Sign in again.",
      error_code: "SESSION_EXPIRED",
    });
    if (signedOutLocally.current || !supportsSessionLock()) throw expired();
    if (refreshFlight.current) return refreshFlight.current;
    const generation = sessionGeneration.current;
    const stale = () => signedOutLocally.current || sessionGeneration.current !== generation;
    const assertCurrent = async (access?: string): Promise<void> => {
      const signedOutInBrowser = Platform.OS === "web"
        && await storage.getItem(SIGNED_OUT_KEY, false);
      if (!stale() && !signedOutInBrowser) return;
      if (signedOutInBrowser) signedOutLocally.current = true;
      // Rotation can have invalidated the old access token server-side while
      // logout was in flight. Revoke its newly issued access token as well.
      if (signedOutLocally.current && access) {
        try { await apiPost("/auth/logout", access, {}); } catch { /* best effort */ }
      }
      if (signedOutLocally.current) {
        await storage.secureRemove(TOKEN_KEY);
        await storage.secureRemove(REFRESH_KEY);
      }
      throw expired();
    };
    const flight = withSessionLock(async () => {
      await assertCurrent();
      // The tab ahead of us may already have consumed the shared cookie.
      // Adopt its access token before issuing another single-use rotation.
      if (Platform.OS === "web" && currentAccess) {
        const shared = await storage.secureGet<string>(TOKEN_KEY, "");
        await assertCurrent();
        if (shared && shared !== currentAccess) {
          setToken(shared);
          return shared;
        }
      }
      const refreshToken = Platform.OS === "web" ? undefined : await storage.secureGet<string>(REFRESH_KEY, "");
      await assertCurrent();
      if (Platform.OS !== "web" && !refreshToken) throw expired();
      const next = await refreshSession(refreshToken || undefined);
      const nextAccess = next.access_token ?? next.token;
      if (!nextAccess) throw new Error("Refresh response missing access token");
      await assertCurrent(nextAccess);
      if (Platform.OS !== "web") {
        if (!next.refresh_token || !(await storage.secureSet(REFRESH_KEY, next.refresh_token))) {
          throw new Error("Cannot securely persist rotated refresh credential");
        }
        await assertCurrent(nextAccess);
      }
      if (!(await storage.secureSet(TOKEN_KEY, nextAccess))) {
        throw new Error("Cannot securely persist renewed access token");
      }
      await assertCurrent(nextAccess);
      setToken(nextAccess);
      return nextAccess;
    });
    refreshFlight.current = flight;
    try { return await flight; } finally {
      if (refreshFlight.current === flight) refreshFlight.current = null;
    }
  }, []);

  const verifiedSession = useCallback(async (current: string): Promise<{ access: string; me: Me }> => {
    try {
      return { access: current, me: await apiGet<Me>("/me", current) };
    } catch (error) {
      if (!isApiError(error) || error.status !== 401) throw error;
      if (Platform.OS === "web") {
        // Wait for any rotation in another tab to publish its access token
        // before interpreting its obsolete JTI as another-device replacement.
        const shared = await withSessionLock(() => storage.secureGet<string>(TOKEN_KEY, ""));
        if (shared && shared !== current) {
          return { access: shared, me: await apiGet<Me>("/me", shared) };
        }
      }
      if (sessionLossReason(error) === "replaced") throw error;
      const access = await rotateSession(current);
      return { access, me: await apiGet<Me>("/me", access) };
    }
  }, [rotateSession]);

  useEffect(() => {
    let active = true;
    const generation = sessionGeneration.current;
    (async () => {
      try {
        const signedOut = await storage.getItem(SIGNED_OUT_KEY, false);
        if (signedOut) return;
        const saved = await storage.secureGet<string>(TOKEN_KEY, "");
        if (!saved && Platform.OS !== "web" && !(await storage.secureGet<string>(REFRESH_KEY, ""))) return;
        const access = saved || await rotateSession();
        const result = await verifiedSession(access);
        if (active && sessionGeneration.current === generation && !signedOutLocally.current) {
          setToken(result.access); setUser(result.me); setSessionMessage(null);
        }
      } catch (error) {
        if (active && sessionGeneration.current === generation
            && isApiError(error) && (error.status === 401 || error.status === 403)) {
          const reason = sessionLossReason(error);
          if (active && sessionGeneration.current === generation && reason) setSessionMessage(sessionLossMessage(reason));
          await stopTripLocationTracking();
          await storage.secureRemove(TOKEN_KEY);
          await storage.secureRemove(REFRESH_KEY);
          if (active && sessionGeneration.current === generation) { setToken(null); setUser(null); }
        }
        // Transient offline failures must not destroy recoverable credentials.
      } finally {
        if (active) setHydrating(false);
      }
    })();
    return () => { active = false; };
  }, [rotateSession, verifiedSession]);

  const acceptSession = useCallback(async (res: AuthSessionResponse): Promise<Me> => {
    sessionGeneration.current += 1;
    signedOutLocally.current = false;
    const accessToken = res.access_token ?? res.token;
    if (!accessToken) throw new Error("Authentication response missing access token");
    if (Platform.OS !== "web") {
      if (!res.refresh_token || !(await storage.secureSet(REFRESH_KEY, res.refresh_token))) {
        throw new Error("Unable to securely store refresh credential");
      }
    }
    const stored = await storage.secureSet(TOKEN_KEY, accessToken);
    if (!stored) throw new Error("Unable to securely store login session");
    try {
      const me = await apiGet<Me>("/me", accessToken);
      await storage.removeItem(SIGNED_OUT_KEY);
      setSessionMessage(null);
      setToken(accessToken);
      setUser(me);
      return me;
    } catch (error) {
      await storage.secureRemove(TOKEN_KEY);
      await storage.secureRemove(REFRESH_KEY);
      setToken(null);
      setUser(null);
      throw error;
    }
  }, []);

  const verify = async (identifier: string, code: string): Promise<Me> => {
    const res = await verifyOtp(identifier, code);
    return acceptSession(res);
  };

  const verifyStaff = async (identifier: string, code: string): Promise<import("@/src/api/client").StaffMfaChallengeResponse> => {
    const challenge = await verifyStaffOtp(identifier, code);
    setStaffMfaChallenge(challenge.challenge_token);
    return challenge;
  };

  const startStaffMfaEnrollment = async (challengeToken?: string): Promise<import("@/src/api/client").MfaEnrollmentStartResponse> => {
    const activeChallenge = challengeToken || staffMfaChallenge;
    if (!activeChallenge) throw new Error("Staff login challenge expired. Start login again.");
    return apiStartStaffMfaEnrollment(activeChallenge);
  };

  const confirmStaffMfaEnrollment = async (code: string): Promise<import("@/src/api/client").MfaEnrollmentConfirmResponse> => {
    if (!staffMfaChallenge) throw new Error("Staff login challenge expired. Start login again.");
    const result = await apiConfirmStaffMfaEnrollment(staffMfaChallenge, code);
    setStaffMfaChallenge(result.challenge_token);
    return result;
  };

  const verifyStaffAuthenticator = async (_identifier: string, code: string): Promise<Me> => {
    if (!staffMfaChallenge) throw new Error("Staff login challenge expired. Start login again.");
    const res = await verifyStaffTotp(staffMfaChallenge, code);
    setStaffMfaChallenge(null);
    return acceptSession(res);
  };

  const verifyStaffRecoveryCode = async (_identifier: string, code: string): Promise<Me> => {
    if (!staffMfaChallenge) throw new Error("Staff login challenge expired. Start login again.");
    const res = await verifyStaffRecovery(staffMfaChallenge, code);
    setStaffMfaChallenge(null);
    return acceptSession(res);
  };

  // Kept for backward compatibility and rollback safety. The normal Plant Staff
  // login UI no longer exposes Google OAuth.
  const verifyGoogle = async (code: string): Promise<Me> => {
    const res = await exchangeGoogleStaffCode(code);
    return acceptSession(res);
  };

  const demoLogin = async (role: string): Promise<Me> => {
    const res = await apiDemoLogin(role);
    return acceptSession(res);
  };

  const verifyPlayReview = async (role: PlayReviewRole, accessCode: string): Promise<Me> => {
    const res = await playReviewLogin(role, accessCode);
    return acceptSession(res);
  };

  const clearSession = useCallback(async (error: unknown) => {
    sessionGeneration.current += 1;
    signedOutLocally.current = true;
    const reason = sessionLossReason(error);
    await storage.setItem(SIGNED_OUT_KEY, true);
    setStaffMfaChallenge(null);
    setSessionMessage(reason ? sessionLossMessage(reason) : "Your secure session ended. Please sign in again.");
    await stopTripLocationTracking();
    await storage.secureRemove(TOKEN_KEY);
    await storage.secureRemove(REFRESH_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = async () => {
    if (!token || signedOutLocally.current) return;
    const generation = sessionGeneration.current;
    try {
      const result = await verifiedSession(token);
      if (sessionGeneration.current === generation && !signedOutLocally.current) {
        setToken(result.access);
        setUser(result.me);
      }
    } catch (error) {
      if (sessionGeneration.current === generation && isApiError(error)
          && (error.status === 401 || error.status === 403)) await clearSession(error);
    }
  };

  useEffect(() => onSessionLoss((loss) => {
    if (!token || loss.token !== token || signedOutLocally.current) return;
    const generation = sessionGeneration.current;
    void verifiedSession(token).then((result) => {
      if (generation === sessionGeneration.current && !signedOutLocally.current) {
        setToken(result.access); setUser(result.me);
      }
    }).catch(async (error) => {
      if (generation === sessionGeneration.current && isApiError(error)
          && (error.status === 401 || error.status === 403)) await clearSession(error);
    });
  }), [token, verifiedSession, clearSession]);

  const signOut = async () => {
    signedOutLocally.current = true;
    sessionGeneration.current += 1;
    setSessionMessage(null);
    setStaffMfaChallenge(null);
    // Keep explicit local sign-out sticky across browser restarts even if the
    // network fails before the server can clear its HttpOnly refresh cookie.
    await storage.setItem(SIGNED_OUT_KEY, true);
    await stopTripLocationTracking();
    setToken(null);
    setUser(null);
    await withSessionLock(async () => {
      const sessionToken = await storage.secureGet<string>(TOKEN_KEY, "") || token;
      await storage.secureRemove(TOKEN_KEY);
      await storage.secureRemove(REFRESH_KEY);
      if (!sessionToken) return;
      try { await unregisterPushDevice(sessionToken); } catch { /* best effort */ }
      try { await apiPost("/auth/logout", sessionToken); } catch { /* locally signed out */ }
    });
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    const check = async () => {
      const generation = sessionGeneration.current;
      if (signedOutLocally.current) return;
      try {
        const result = await verifiedSession(token);
        if (active && sessionGeneration.current === generation && !signedOutLocally.current) {
          setToken(result.access); setUser(result.me);
        }
      } catch (error) {
        if (!active || signedOutLocally.current || generation !== sessionGeneration.current
            || !isApiError(error) || (error.status !== 401 && error.status !== 403)) return;
        active = false;
        await clearSession(error);
      }
    };
    void check();
    const listener = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void check();
    }, 120_000);
    return () => { active = false; listener.remove(); clearInterval(interval); };
  }, [token, verifiedSession, clearSession]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const sync = async () => {
      const generation = sessionGeneration.current;
      const saved = await withSessionLock(async () => ({
        access: await storage.secureGet<string>(TOKEN_KEY, ""),
        signedOut: await storage.getItem(SIGNED_OUT_KEY, false),
      }));
      if (sessionGeneration.current !== generation) return;
      if (saved.signedOut || !saved.access) {
        sessionGeneration.current += 1;
        signedOutLocally.current = true;
        setStaffMfaChallenge(null);
        setToken(null);
        setUser(null);
        await stopTripLocationTracking();
      } else if (saved.access !== token) {
        signedOutLocally.current = false;
        setToken(saved.access);
      }
    };
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === TOKEN_KEY || event.key === SIGNED_OUT_KEY) {
        void sync().catch(() => { /* retain state during transient storage failures */ });
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        hydrating,
        sessionMessage,
        token,
        user,
        requestOtp,
        requestStaffOtp,
        staffAuthMethod,
        verify,
        verifyStaff,
        verifyStaffAuthenticator,
        verifyStaffRecovery: verifyStaffRecoveryCode,
        startStaffMfaEnrollment,
        confirmStaffMfaEnrollment,
          verifyGoogle,
        demoLogin,
        verifyPlayReview,
        refreshMe,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
