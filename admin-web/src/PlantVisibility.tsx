import React, { useState } from 'react';
import apiClient from './api';

type Plant = {
  id: string; name: string; code: string; city: string; state: string;
  active: boolean; onboarding_approved: boolean; discovery_visible: boolean; google_place_blocked: boolean;
};
type Governance = { plant_id: string; plant_name: string; discovery_visible: boolean; google_place_blocked: boolean };
type HeldPlace = { place_id: string; reason: string; updated_at: string };
const field: React.CSSProperties = { display: 'block', width: '100%', marginTop: 5, padding: 9, borderRadius: 7, border: '1px solid #64748b', background: '#0f172a', color: '#f8fafc', boxSizing: 'border-box' };
const button: React.CSSProperties = { borderRadius: 8, border: '1px solid #64748b', padding: '9px 12px', cursor: 'pointer', color: '#f8fafc', background: '#1e293b', fontWeight: 600 };
function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Unable to complete the visibility request.';
}

/** Web-only Central Admin publication control. The API enforces all permissions and fresh TOTP. */
export function PlantVisibility() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [opened, setOpened] = useState(false);
  const [rows, setRows] = useState<Plant[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Governance | null>(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [externalId, setExternalId] = useState('');
  const [externalReason, setExternalReason] = useState('');
  const [externalCode, setExternalCode] = useState('');
  const [externalBusy, setExternalBusy] = useState(false);
  const [heldPlaces, setHeldPlaces] = useState<HeldPlace[]>([]);
  const [externalOpened, setExternalOpened] = useState(false);
  const [externalError, setExternalError] = useState('');
  const [externalNotice, setExternalNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load(page = 0) {
    setOpened(true); setLoading(true); setError(''); setRows([]);
    try {
      const response = await apiClient.get('/api/control-center/plants/master', {
        params: { q: search.trim(), status, limit: 20, offset: page }
      });
      setRows(response.data?.items || []);
      setTotal(Number(response.data?.total || 0));
      setOffset(page);
    } catch (err) { setError(message(err)); }
    finally { setLoading(false); }
  }

  async function select(id: string) {
    setError(''); setNotice(''); setSelected(null); setReason(''); setCode('');
    try {
      const response = await apiClient.get('/api/control-center/plants/' + encodeURIComponent(id) + '/governance');
      setSelected(response.data as Governance);
    } catch (err) { setError(message(err)); }
  }

  async function changeVisibility(visible: boolean) {
    if (!selected || busy || selected.discovery_visible === visible) return;
    if (reason.trim().length < 10 || reason.trim().length > 500 || !/^[0-9]{6}$/.test(code.trim())) {
      setError('A 10–500 character audit reason and fresh six-digit authenticator code are required.');
      return;
    }
    const label = visible ? 'RESTORE' : 'HOLD';
    if (!window.confirm(label + ' customer app visibility for ' + selected.plant_name + '? Existing operations are unaffected.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiClient.post('/api/control-center/step-up', { code: code.trim() });
      await apiClient.post('/api/control-center/plants/' + encodeURIComponent(selected.plant_id) + '/governance', {
        kind: 'visibility', value: visible ? 'VISIBLE' : 'HOLD',
        valid_until: null, reason: reason.trim()
      });
      const id = selected.plant_id;
      setCode(''); setReason('');
      await load(offset);
      const updated = await apiClient.get('/api/control-center/plants/' + encodeURIComponent(id) + '/governance');
      setSelected(updated.data as Governance);
      setNotice('Visibility ' + (visible ? 'restored' : 'held') + '. Decision saved to the audit log.');
    } catch (err) { setCode(''); setError(message(err)); }
    finally { setBusy(false); }
  }

  async function loadExternalHolds() {
    setExternalOpened(true); setExternalError('');
    try {
      const response = await apiClient.get('/api/control-center/plants/google-visibility');
      setHeldPlaces(response.data?.items || []);
    } catch (err) { setExternalError(message(err)); }
  }

  async function changeExternalVisibility(value: 'HOLD' | 'VISIBLE') {
    const id = externalId.trim();
    if (!id || id.length > 256 || !/^[!-~]+$/.test(id)) {
      setExternalError('Enter a valid exact Google Place ID. Search Google-listed plants in Plant Master to find the ID.');
      return;
    }
    if (externalReason.trim().length < 10 || externalReason.trim().length > 500 || !/^[0-9]{6}$/.test(externalCode.trim())) {
      setExternalError('A 10–500 character audit reason and fresh six-digit authenticator code are required.');
      return;
    }
    const verb = value === 'HOLD' ? 'HOLD' : 'RESTORE';
    if (!window.confirm(verb + ' this Google Places listing inside TrackMyRMC: ' + id + '?')) return;
    setExternalBusy(true); setExternalError(''); setExternalNotice('');
    try {
      await apiClient.post('/api/control-center/step-up', { code: externalCode.trim() });
      await apiClient.post('/api/control-center/plants/google-visibility', {
        place_id: id, value, reason: externalReason.trim()
      });
      setExternalCode(''); setExternalReason('');
      setExternalNotice('Google Places listing ' + (value === 'HOLD' ? 'held' : 'restored') + ' in TrackMyRMC. Decision audited.');
      await loadExternalHolds();
      await load(offset);
    } catch (err) { setExternalCode(''); setExternalError(message(err)); }
    finally { setExternalBusy(false); }
  }

  return (
    <section id="plant-visibility" aria-label="Plant Visibility" style={{ marginTop: 18, padding: 14, border: '1px solid #334155', borderRadius: 12 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 19 }}>Plant Visibility — Customer App & Map</h2>
      <p style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.55 }}>
        Hold a registered plant from customer lists, nearby maps, comparisons, linked Google Places listings and new customer orders/RFQs.
        Staff login, open orders, dispatch, challans and historical data are unaffected. This cannot hide an unlinked external Google business.
      </p>
      <form onSubmit={event => { event.preventDefault(); void load(0); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        <label style={{ flex: '2 1 200px', fontSize: 12 }}>Plant name, code or Google Place ID
          <input aria-label="Visibility plant search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} style={field} />
        </label>
        <label style={{ flex: '1 1 140px', fontSize: 12 }}>Visibility status
          <select aria-label="Visibility status" value={status} onChange={event => setStatus(event.target.value)} style={field}>
            <option value="all">All registered plants</option>
            <option value="held">Visibility on hold</option>
            <option value="visible">No visibility hold</option>
          </select>
        </label>
        <button type="submit" disabled={busy || loading} style={button}>Search / Refresh</button>
      </form>
      {loading && <p role="status">Loading registered plants…</p>}
      {error && <p role="alert" style={{ color: '#fecaca' }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#86efac' }}>{notice}</p>}
      {opened && !loading && !error && <>
        <p style={{ fontSize: 12, color: '#cbd5e1' }}>{total} matching registered plants · {rows.length} shown</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 9 }}>
          {rows.map(plant => <article key={plant.id} style={{ padding: 12, border: '1px solid #475569', background: '#111827', borderRadius: 9 }}>
            <strong>{plant.name}</strong>
            <p style={{ fontSize: 12, color: '#cbd5e1' }}>{plant.code} · {plant.city}, {plant.state}</p>
            <p style={{ fontSize: 12 }}><strong>Visibility:</strong> {plant.google_place_blocked ? 'ON HOLD — linked Google Place ID' : plant.discovery_visible ? 'No hold' : 'ON HOLD — hidden'}</p>
            <p style={{ fontSize: 12, color: '#cbd5e1' }}>{plant.active ? 'Operationally active' : 'Operationally inactive'} · {plant.onboarding_approved ? 'Approved' : 'Not approved'}</p>
            <button type="button" disabled={busy} style={button} onClick={() => void select(plant.id)}>Select plant</button>
          </article>)}
        </div>
        {!rows.length && <p>No plants match the selected filters.</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" disabled={offset === 0 || busy} onClick={() => void load(Math.max(0, offset - 20))}>Previous</button>
          <button type="button" disabled={offset + 20 >= total || busy} onClick={() => void load(offset + 20)}>Next</button>
        </div>
      </>}
      {selected && <div style={{ padding: 12, marginTop: 14, borderRadius: 9, border: '1px solid #64748b', background: '#172334' }}>
        <h3 style={{ fontSize: 16, marginTop: 0 }}>{selected.plant_name} — Visibility decision</h3>
        <p style={{ fontSize: 12 }}>Current: <strong>{selected.discovery_visible ? 'No registered-plant hold' : 'Registered-plant ON HOLD'}</strong>{selected.google_place_blocked ? ' · Linked Google Place ID is separately on hold' : ''}</p>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 9 }}>Required audit reason (10–500 characters)
          <input style={field} maxLength={500} minLength={10} value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason and evidence for this decision" disabled={busy} />
        </label>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>Fresh Central Admin authenticator code
          <input style={field} type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || !selected.discovery_visible} style={{ ...button, background: '#7f1d1d' }} onClick={() => void changeVisibility(false)}>Hold Visibility</button>
          <button type="button" disabled={busy || selected.discovery_visible} style={{ ...button, background: '#166534' }} onClick={() => void changeVisibility(true)}>Restore Visibility</button>
        </div>
        <p style={{ fontSize: 11, color: '#94a3b8' }}>The API applies the hold on new searches. Customer devices with cached results may need a refresh.</p>
      </div>}
      <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid #475569' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Google-listed plants — Exact Place ID hold</h3>
        <p style={{ fontSize: 12, color: '#cbd5e1' }}>
          Use this for Google Places results, including plants not registered with TrackMyRMC.
          Find the exact Google Place ID using Plant Master → Discover Google-listed RMC plants.
          This removes the result from TrackMyRMC customer map discovery only, not Google Maps.
        </p>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>Google Place ID
          <input aria-label="Google Place ID to hide" maxLength={256} value={externalId} onChange={event => setExternalId(event.target.value)}
            style={field} placeholder="Exact Google Place ID (not a business name)" disabled={externalBusy}/>
        </label>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>Audit reason (10–500 characters)
          <input maxLength={500} minLength={10} value={externalReason} onChange={event => setExternalReason(event.target.value)}
            style={field} disabled={externalBusy}/>
        </label>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>Fresh Central Admin authenticator code
          <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
            value={externalCode} onChange={event => setExternalCode(event.target.value)} style={field} disabled={externalBusy}/>
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={externalBusy} style={{ ...button, background: '#7f1d1d' }}
            onClick={() => void changeExternalVisibility('HOLD')}>Hold Google Listing</button>
          <button type="button" disabled={externalBusy} style={{ ...button, background: '#166534' }}
            onClick={() => void changeExternalVisibility('VISIBLE')}>Restore Google Listing</button>
          <button type="button" disabled={externalBusy} style={button} onClick={() => void loadExternalHolds()}>View / Refresh Held Place IDs</button>
        </div>
        {externalError && <p role="alert" style={{ color: '#fecaca' }}>{externalError}</p>}
        {externalNotice && <p role="status" style={{ color: '#86efac' }}>{externalNotice}</p>}
        {externalOpened && <>
          <h4 style={{ fontSize: 13 }}>Currently held Google Place IDs ({heldPlaces.length} shown, maximum 100)</h4>
          {heldPlaces.map(item => <div key={item.place_id} style={{ padding: 10, marginBottom: 8, border: '1px solid #475569', borderRadius: 7 }}>
            <code style={{ overflowWrap: 'anywhere' }}>{item.place_id}</code>
            <p style={{ margin: '5px 0', color: '#cbd5e1', fontSize: 12 }}>{item.reason}</p>
            <button type="button" disabled={externalBusy} style={button} onClick={() => setExternalId(item.place_id)}>Select for restore</button>
          </div>)}
          {!heldPlaces.length && <p style={{ fontSize: 12 }}>No Google Place IDs currently on hold.</p>}
        </>}
      </div>
    </section>
  );
}
