import { useEffect, useMemo, useState } from "react";
import apiClient from "./api";

export type PromotionEnquiry = {
  id: string;
  plant_id: string;
  plant_name: string;
  owner_email?: string | null;
  city?: string | null;
  pincode?: string | null;
  requested_radius_km: number;
  preferred_duration_days: number;
  notes?: string | null;
  status: "PENDING" | "CONTACTED" | "ACTIVATED" | "REJECTED";
  created_at: string;
};

export type ActivePlantPromotion = {
  id: string;
  plant_id: string;
  plant_name: string;
  city?: string | null;
  pincode?: string | null;
  radius_km: number;
  status: "ACTIVE" | "PAUSED" | "EXPIRED" | "REVOKED";
  starts_at: string;
  ends_at?: string | null;
  activated_at: string;
  audit_reason: string;
};

export type PlantPromotionsPanelProps = {
  enquiries: PromotionEnquiry[];
  promotions: ActivePlantPromotion[];
  loading: boolean;
  onRefresh: () => void;
  onActivate: (payload: {
    plant_id: string;
    enquiry_id?: string;
    radius_km: number;
    duration_days: number;
    audit_reason: string;
  }) => Promise<void>;
  onUpdateRadius: (plantId: string, radiusKm: number, auditReason: string) => Promise<void>;
  onSetStatus: (
    plantId: string,
    status: "ACTIVE" | "PAUSED" | "REVOKED",
    auditReason: string,
  ) => Promise<void>;
};

const ROTATION_WINDOW_SECONDS = 120;

function computeRotatedOrder<T>(items: T[], nowSeconds: number): T[] {
  if (items.length <= 1) return items;
  const bucket = Math.floor(nowSeconds / ROTATION_WINDOW_SECONDS);
  const shift = ((bucket % items.length) + items.length) % items.length;
  if (shift === 0) return items;
  return [...items.slice(items.length - shift), ...items.slice(0, items.length - shift)];
}

export function PlantPromotions({
  enquiries,
  promotions,
  loading,
  onRefresh,
  onActivate,
  onUpdateRadius,
  onSetStatus,
}: PlantPromotionsPanelProps) {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [radiusDrafts, setRadiusDrafts] = useState<Record<string, string>>({});
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [reasonDraft, setReasonDraft] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(interval);
  }, []);

  const activePromotions = useMemo(
    () =>
      promotions
        .filter(p => p.status === "ACTIVE")
        .sort((a, b) => a.activated_at.localeCompare(b.activated_at) || a.plant_id.localeCompare(b.plant_id)),
    [promotions],
  );

  const rotatedActive = useMemo(
    () => computeRotatedOrder(activePromotions, nowSec),
    [activePromotions, nowSec],
  );

  const secondsUntilNextShift =
    ROTATION_WINDOW_SECONDS - (((nowSec % ROTATION_WINDOW_SECONDS) + ROTATION_WINDOW_SECONDS) % ROTATION_WINDOW_SECONDS);

  const pendingEnquiries = useMemo(
    () => enquiries.filter(e => e.status === "PENDING" || e.status === "CONTACTED"),
    [enquiries],
  );

  const requireReasonAndCode = (): { audit_reason: string; code: string } | null => {
    const trimmed = reasonDraft.trim();
    const code = totpCode.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      setError("Enter an audit reason between 10 and 500 characters before modifying promotions.");
      return null;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a fresh 6-digit Central Admin authenticator code before modifying promotions.");
      return null;
    }
    setError(null);
    return { audit_reason: trimmed, code };
  };

  const handleActivateEnquiry = async (enquiry: PromotionEnquiry) => {
    const auth = requireReasonAndCode();
    if (!auth) return;
    const radius_km = Number(radiusDrafts[enquiry.id] ?? enquiry.requested_radius_km ?? 30);
    const duration_days = Number(durationDrafts[enquiry.id] ?? enquiry.preferred_duration_days ?? 30);
    if (!Number.isInteger(radius_km) || radius_km < 1 || radius_km > 250) {
      setError("Custom radius must be a whole number between 1 and 250 km.");
      return;
    }
    if (!Number.isInteger(duration_days) || duration_days < 1 || duration_days > 365) {
      setError("Promotion duration must be a whole number between 1 and 365 days.");
      return;
    }
    setBusyId(enquiry.id);
    try {
      await apiClient.post("/api/control-center/step-up", { code: auth.code });
      await onActivate({
        plant_id: enquiry.plant_id,
        enquiry_id: enquiry.id,
        radius_km,
        duration_days,
        audit_reason: auth.audit_reason,
      });
      setReasonDraft("");
      setTotpCode("");
      onRefresh();
    } catch (e: unknown) {
      setTotpCode("");
      setError(e instanceof Error ? e.message : "Failed to activate promotion.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRadiusUpdate = async (promo: ActivePlantPromotion) => {
    const auth = requireReasonAndCode();
    if (!auth) return;
    const radius_km = Number(radiusDrafts[promo.plant_id] ?? promo.radius_km);
    if (!Number.isInteger(radius_km) || radius_km < 1 || radius_km > 250) {
      setError("Custom radius must be a whole number between 1 and 250 km.");
      return;
    }
    setBusyId(promo.plant_id);
    try {
      await apiClient.post("/api/control-center/step-up", { code: auth.code });
      await onUpdateRadius(promo.plant_id, radius_km, auth.audit_reason);
      setReasonDraft("");
      setTotpCode("");
      onRefresh();
    } catch (e: unknown) {
      setTotpCode("");
      setError(e instanceof Error ? e.message : "Failed to update promotion radius.");
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (
    promo: ActivePlantPromotion,
    status: "ACTIVE" | "PAUSED" | "REVOKED",
  ) => {
    const auth = requireReasonAndCode();
    if (!auth) return;
    setBusyId(promo.plant_id);
    try {
      await apiClient.post("/api/control-center/step-up", { code: auth.code });
      await onSetStatus(promo.plant_id, status, auth.audit_reason);
      setReasonDraft("");
      setTotpCode("");
      onRefresh();
    } catch (e: unknown) {
      setTotpCode("");
      setError(e instanceof Error ? e.message : "Failed to update promotion status.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-panel" aria-label="Super Admin Plant Promotions">
      <div className="admin-panel-header">
        <div>
          <h2>Plant Promotions &amp; Custom Visibility Radius</h2>
          <p className="muted">
            Super Admin only: activate enquiry-based top listings, customize radius per plant (default 30 km),
            and monitor the automatic 2-minute cyclic rotation.
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <span className="kpi-label">Pending Enquiries</span>
          <strong className="kpi-value">{pendingEnquiries.length}</strong>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-label">Active Promoted Plants</span>
          <strong className="kpi-value">{activePromotions.length}</strong>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-label">Next 2-Min Rotation Shift</span>
          <strong className="kpi-value">{secondsUntilNextShift}s</strong>
        </div>
      </div>

      <div className="admin-field-row" style={{ marginTop: 12, marginBottom: 12 }}>
        <label htmlFor="promo-audit-reason">
          <strong>Super Admin Audit Reason (10–500 chars, required for all actions)</strong>
        </label>
        <input
          id="promo-audit-reason"
          type="text"
          minLength={10}
          maxLength={500}
          value={reasonDraft}
          onChange={e => setReasonDraft(e.target.value)}
          placeholder="e.g. Verified offline commercial confirmation for 30 km top listing"
          style={{ width: "100%", padding: 8 }}
        />
      </div>

      <div className="admin-field-row" style={{ marginBottom: 12 }}>
        <label htmlFor="promo-stepup-code">
          <strong>Fresh Central Admin Authenticator Code (6-digit TOTP)</strong>
        </label>
        <input
          id="promo-stepup-code"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={totpCode}
          onChange={e => setTotpCode(e.target.value)}
          placeholder="6-digit code"
          style={{ width: 180, padding: 8 }}
        />
      </div>

      {error ? (
        <div role="alert" className="admin-error-banner" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <h3>1. Plant Owner Promotion Enquiries</h3>
      {pendingEnquiries.length === 0 ? (
        <p className="muted">No pending promotion enquiries.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Plant</th>
              <th>Location</th>
              <th>Custom Radius (km)</th>
              <th>Duration (days)</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pendingEnquiries.map(enquiry => (
              <tr key={enquiry.id}>
                <td>
                  <strong>{enquiry.plant_name}</strong>
                  {enquiry.owner_email ? <div className="muted">{enquiry.owner_email}</div> : null}
                </td>
                <td>{[enquiry.city, enquiry.pincode].filter(Boolean).join(" · ") || "—"}</td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={250}
                    value={radiusDrafts[enquiry.id] ?? String(enquiry.requested_radius_km || 30)}
                    onChange={e =>
                      setRadiusDrafts(prev => ({ ...prev, [enquiry.id]: e.target.value }))
                    }
                    style={{ width: 84 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={durationDrafts[enquiry.id] ?? String(enquiry.preferred_duration_days || 30)}
                    onChange={e =>
                      setDurationDrafts(prev => ({ ...prev, [enquiry.id]: e.target.value }))
                    }
                    style={{ width: 84 }}
                  />
                </td>
                <td>{enquiry.notes || "—"}</td>
                <td>
                  <button
                    type="button"
                    disabled={busyId === enquiry.id}
                    onClick={() => handleActivateEnquiry(enquiry)}
                  >
                    {busyId === enquiry.id ? "Activating..." : "Activate Promotion"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ marginTop: 20 }}>2. Active &amp; Managed Promotions (Live 2-Min Rotation Order)</h3>
      {rotatedActive.length > 1 ? (
        <p className="muted">
          Current top-listing sequence:{" "}
          <strong>{rotatedActive.map((p, idx) => `#${idx + 1} ${p.plant_name}`).join(" → ")}</strong>
        </p>
      ) : null}

      {promotions.length === 0 ? (
        <p className="muted">No plant promotions configured yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Plant</th>
              <th>Status</th>
              <th>Visibility Radius (km)</th>
              <th>Window</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map(promo => (
              <tr key={promo.id}>
                <td>
                  <strong>{promo.plant_name}</strong>
                  <div className="muted">
                    {[promo.city, promo.pincode].filter(Boolean).join(" · ") || promo.plant_id}
                  </div>
                </td>
                <td>{promo.status}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      max={250}
                      value={radiusDrafts[promo.plant_id] ?? String(promo.radius_km)}
                      onChange={e =>
                        setRadiusDrafts(prev => ({ ...prev, [promo.plant_id]: e.target.value }))
                      }
                      style={{ width: 84 }}
                    />
                    <button
                      type="button"
                      disabled={busyId === promo.plant_id}
                      onClick={() => handleRadiusUpdate(promo)}
                    >
                      Save Radius
                    </button>
                  </div>
                </td>
                <td>{promo.ends_at ? `Until ${promo.ends_at.slice(0, 10)}` : "Open-ended"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {promo.status === "ACTIVE" ? (
                    <button
                      type="button"
                      disabled={busyId === promo.plant_id}
                      onClick={() => handleStatusChange(promo, "PAUSED")}
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === promo.plant_id}
                      onClick={() => handleStatusChange(promo, "ACTIVE")}
                    >
                      Activate
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === promo.plant_id}
                    onClick={() => handleStatusChange(promo, "REVOKED")}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
