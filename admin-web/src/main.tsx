import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import apiClient from './api';

type Stage = 'email' | 'otp' | 'mfa-enroll' | 'mfa-login' | 'authenticated';

type StaffUser = {
  id?: string;
  email?: string | null;
  phone?: string;
  full_name?: string;
  role: string;
};

type Health = {
  status?: string;
  database?: string;
  environment?: string;
  timestamp?: string;
};

type PortalKpi = { label: string; value: string | number };

type Enrollment = {
  account: string;
  manual_key: string;
  otpauth_uri: string;
  recovery_codes: string[];
};

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; error?: unknown; detail?: unknown };
    for (const candidate of [value.message, value.error, value.detail]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
  }
  return 'The request could not be completed. Please try again.';
}

function CommandCenter() {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [adminKpis, setAdminKpis] = useState<PortalKpi[]>([]);
  const [adminOverviewError, setAdminOverviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const token = window.sessionStorage.getItem('trackmyrmc_admin_token');
    if (!token) return;

    let active = true;
    apiClient.get('/api/me')
      .then((response) => {
        const currentUser = response.data?.user as StaffUser | undefined;
        if (!active || !currentUser?.role) return;
        setUser(currentUser);
        setStage('authenticated');
      })
      .catch(() => {
        window.sessionStorage.removeItem('trackmyrmc_admin_token');
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (stage !== 'authenticated') return;
    let active = true;
    apiClient.get('/health')
      .then((response) => { if (active) setHealth(response.data as Health); })
      .catch(() => { if (active) setHealth(null); });
    return () => { active = false; };
  }, [stage]);

  useEffect(() => {
    if (stage !== 'authenticated' || user?.role !== 'admin') {
      setAdminKpis([]);
      setAdminOverviewError('');
      return;
    }
    let active = true;
    apiClient.get('/api/control-center/summary')
      .then((response) => {
        if (!active) return;
        const kpis: unknown = response.data?.kpis;
        setAdminKpis(Array.isArray(kpis) ? kpis.filter((item): item is PortalKpi =>
          typeof item?.label === 'string' &&
          (typeof item?.value === 'number' || typeof item?.value === 'string')
        ) : []);
        setAdminOverviewError('');
      })
      .catch((requestError) => {
        if (!active) return;
        setAdminKpis([]);
        setAdminOverviewError(errorMessage(requestError));
      });
    return () => { active = false; };
  }, [stage, user?.role]);

  async function sendEmailOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post('/api/auth/otp/email/send', { email: email.trim().toLowerCase() });
      setStage('otp');
      setNotice('If this address belongs to an active staff account, a verification code has been sent.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/auth/otp/email/verify', {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      });
      const result = response.data;
      if (!result?.challenge_token) throw new Error('The server did not return a valid MFA challenge.');
      setChallengeToken(result.challenge_token);

      if (result.mfa_setup_required || result.status === 'MFA_ENROLLMENT_REQUIRED') {
        const setupResponse = await apiClient.post('/api/auth/staff/mfa/enroll/start', {
          challenge_token: result.challenge_token,
        });
        setEnrollment(setupResponse.data as Enrollment);
        setRecoveryCodesSaved(false);
        setStage('mfa-enroll');
        setNotice('First-time setup required. Add this account to your authenticator and store the recovery codes before continuing.');
      } else {
        setStage('mfa-login');
        setNotice('Email verified. Enter the current authenticator code or an unused recovery code.');
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryCodesSaved) {
      setError('Confirm that you have saved the recovery codes before enabling the authenticator.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/auth/staff/mfa/enroll/confirm', {
        challenge_token: challengeToken,
        code: mfaCode.trim(),
      });
      if (!response.data?.challenge_token) throw new Error('The server did not return the next MFA challenge.');
      setChallengeToken(response.data.challenge_token);
      setEnrollment(null);
      setMfaCode('');
      setStage('mfa-login');
      setNotice('Authenticator enabled. Enter a fresh authenticator code to finish signing in.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/auth/staff/mfa/verify-totp', {
        challenge_token: challengeToken,
        code: mfaCode.trim(),
      });
      const auth = response.data;
      const signedInUser = auth?.user as StaffUser | undefined;
      if (!auth?.token || !signedInUser?.role) {
        throw new Error('The server response did not contain a valid authenticated session.');
      }
      const allowedRoles = ['dispatcher', 'operator', 'supervisor', 'quality_engineer', 'store_manager', 'accountant', 'fleet_manager', 'owner', 'admin'];
      if (!allowedRoles.includes(signedInUser.role)) {
        throw new Error('This account is not authorized for staff portal access.');
      }
      window.sessionStorage.setItem('trackmyrmc_admin_token', auth.token);
      setUser(signedInUser);
      setMfaCode('');
      setChallengeToken('');
      setStage('authenticated');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await apiClient.post('/api/auth/logout');
    } catch {
      // Always clear this browser session, even if the server is temporarily unreachable.
    } finally {
      window.sessionStorage.removeItem('trackmyrmc_admin_token');
      setUser(null);
      setHealth(null);
      setAdminKpis([]);
      setAdminOverviewError('');
      setEnrollment(null);
      setChallengeToken('');
      setOtp('');
      setMfaCode('');
      setStage('email');
      setNotice('Signed out of this browser session.');
      setError('');
      setBusy(false);
    }
  }

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh', padding: '32px 18px', boxSizing: 'border-box',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background: 'radial-gradient(ellipse at top, #1e3a5f 0%, #0f172a 52%, #020617 100%)',
    color: '#f8fafc', display: 'flex', justifyContent: 'center', alignItems: 'center',
  };
  const panelStyle: React.CSSProperties = {
    width: '100%', maxWidth: 560, boxSizing: 'border-box', padding: 28,
    borderRadius: 18, border: '1px solid #334155', background: 'rgba(15, 23, 42, 0.94)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginTop: 7,
    borderRadius: 9, border: '1px solid #475569', background: '#020617', color: '#f8fafc',
    fontSize: 16, outlineOffset: 2,
  };
  const buttonStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', border: 0, borderRadius: 9, marginTop: 16,
    background: busy ? '#475569' : '#7c3aed', color: '#fff', fontWeight: 700,
    fontSize: 15, cursor: busy ? 'wait' : 'pointer',
  };

  return (
    <main style={pageStyle}>
      <section style={panelStyle} aria-labelledby="portal-title">
        <div style={{ color: '#c4b5fd', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' }}>
          TrackMyRMC · Secure Access
        </div>
        <h1 id="portal-title" style={{ margin: '10px 0 6px', fontSize: 30, lineHeight: 1.2 }}>
          {stage === 'authenticated' ? 'Command Center' : 'Staff sign in'}
        </h1>
        <p style={{ color: '#cbd5e1', lineHeight: 1.6, marginTop: 0 }}>
          {stage === 'authenticated'
            ? 'Your staff session is authenticated using email verification and multi-factor authentication.'
            : 'Staff, plant owners, and administrators sign in with registered email OTP followed by an authenticator factor.'}
        </p>

        {error && <div role="alert" style={{ padding: 12, borderRadius: 8, background: '#451a1a', border: '1px solid #b91c1c', color: '#fecaca', margin: '16px 0' }}>{error}</div>}
        {notice && <div role="status" style={{ padding: 12, borderRadius: 8, background: '#172554', border: '1px solid #3730a3', color: '#dbeafe', margin: '16px 0' }}>{notice}</div>}

        {stage === 'email' && (
          <form onSubmit={sendEmailOtp}>
            <label htmlFor="email" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>Registered work email</label>
            <input id="email" name="email" type="email" autoComplete="username" required value={email}
              onChange={(event) => setEmail(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>{busy ? 'Sending…' : 'Send email verification code'}</button>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyEmailOtp}>
            <p style={{ color: '#cbd5e1' }}>Verification for <strong>{email}</strong></p>
            <label htmlFor="email-otp" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>Email verification code</label>
            <input id="email-otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" required
              maxLength={12} value={otp} onChange={(event) => setOtp(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>{busy ? 'Verifying…' : 'Verify email code'}</button>
            <button type="button" disabled={busy} onClick={() => { setStage('email'); setOtp(''); setError(''); setNotice(''); }}
              style={{ ...buttonStyle, background: 'transparent', border: '1px solid #475569' }}>Use another email</button>
          </form>
        )}

        {stage === 'mfa-enroll' && enrollment && (
          <form onSubmit={confirmEnrollment}>
            <h2 style={{ fontSize: 19 }}>Set up your authenticator</h2>
            <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>Add <strong>{enrollment.account}</strong> to your authenticator app using the setup key below.</p>
            <label htmlFor="manual-key" style={{ display: 'block', fontWeight: 650 }}>Authenticator setup key</label>
            <textarea id="manual-key" readOnly value={enrollment.manual_key} rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#c4b5fd' }}>Show otpauth URI</summary>
              <textarea readOnly value={enrollment.otpauth_uri} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
            </details>
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: '1px solid #92400e', background: '#451a03' }}>
              <strong style={{ color: '#fde68a' }}>Save these recovery codes now</strong>
              <p style={{ margin: '6px 0 10px', color: '#fde68a', fontSize: 13 }}>Each code is single-use. This screen will not show them again after setup.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {enrollment.recovery_codes.map((recoveryCode) => (
                  <code key={recoveryCode} style={{ padding: 8, background: '#1c1917', borderRadius: 6, textAlign: 'center' }}>{recoveryCode}</code>
                ))}
              </div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, lineHeight: 1.4 }}>
                <input type="checkbox" checked={recoveryCodesSaved} onChange={(event) => setRecoveryCodesSaved(event.target.checked)} />
                I have saved these recovery codes in a secure place.
              </label>
            </div>
            <label htmlFor="enroll-code" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>6-digit authenticator code</label>
            <input id="enroll-code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={8}
              value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy || !recoveryCodesSaved} style={buttonStyle}>{busy ? 'Enabling…' : 'Confirm authenticator setup'}</button>
          </form>
        )}

        {stage === 'mfa-login' && (
          <form onSubmit={verifyMfa}>
            <label htmlFor="mfa-code" style={{ display: 'block', marginTop: 18, fontWeight: 650 }}>Authenticator or recovery code</label>
            <input id="mfa-code" type="text" autoComplete="one-time-code" required maxLength={16}
              value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} style={inputStyle} disabled={busy} />
            <button type="submit" disabled={busy} style={buttonStyle}>{busy ? 'Verifying…' : 'Verify MFA and sign in'}</button>
          </form>
        )}

        {stage === 'authenticated' && user && (
          <div>
            <div style={{ marginTop: 20, padding: 16, border: '1px solid #334155', borderRadius: 10, background: '#111827' }}>
              <p style={{ margin: '0 0 8px' }}><strong>Signed in as</strong> {user.full_name || user.email || user.phone || 'Staff user'}</p>
              <p style={{ margin: '0 0 8px' }}><strong>Role</strong> {user.role}</p>
              <p style={{ margin: 0 }}><strong>Session</strong> Email OTP + MFA verified</p>
            </div>
            <div style={{ marginTop: 14, padding: 16, border: '1px solid #334155', borderRadius: 10 }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Service health</h2>
              <p><strong>API:</strong> {health?.status || 'Unavailable'}</p>
              <p><strong>Database:</strong> {health?.database || 'Not confirmed'}</p>
              <p><strong>Environment:</strong> {health?.environment || 'Unknown'}</p>
              <p style={{ color: '#94a3b8', fontSize: 12 }}>This portal is being connected incrementally to secured Rust APIs. Privileged actions require recent authenticator verification.</p>
            </div>
            {user.role === 'admin' && (
              <section aria-label="Platform overview" style={{ marginTop: 14, padding: 16, border: '1px solid #334155', borderRadius: 10 }}>
                <h2 style={{ marginTop: 0, fontSize: 18 }}>Live platform overview</h2>
                {adminOverviewError && <p role="alert" style={{ color: '#fecaca' }}>Unable to load overview: {adminOverviewError}</p>}
                {!adminOverviewError && adminKpis.length === 0 && <p style={{ color: '#94a3b8' }}>No overview data available.</p>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
                  {adminKpis.map((item) => (
                    <div key={item.label} style={{ padding: 12, border: '1px solid #475569', borderRadius: 8, background: '#111827' }}>
                      <div style={{ color: '#cbd5e1', fontSize: 12 }}>{item.label}</div>
                      <strong style={{ fontSize: 22 }}>{String(item.value)}</strong>
                    </div>
                  ))}
                </div>
                <p style={{ color: '#94a3b8', fontSize: 12 }}>Read-only statistics from the Rust API. This is not the complete reference Control Center.</p>
              </section>
            )}
            <button type="button" onClick={logout} disabled={busy} style={buttonStyle}>{busy ? 'Signing out…' : 'Sign out and revoke session'}</button>
          </div>
        )}

        <p style={{ margin: '24px 0 0', borderTop: '1px solid #334155', paddingTop: 16, color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
          Never share verification codes or recovery codes. Admin and staff password-only login is disabled.
        </p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CommandCenter />
  </React.StrictMode>
);
