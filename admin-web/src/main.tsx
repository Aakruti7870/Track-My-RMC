import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import apiClient from './api';

function CommandCenter() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get('/health')
      .then((res) => {
        setStats(res.data);
      })
      .catch((err) => {
        console.error('Health check error:', err);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '32px', fontFamily: 'sans-serif', background: '#0F172A', minHeight: '100vh', color: '#F8FAFC' }}>
      <h1 style={{ color: '#38BDF8' }}>TrackMyRMC Admin Portal</h1>
      <p style={{ color: '#94A3B8' }}>Central Batching & Dispatch Command Center</p>
      {loading ? (
        <p>Connecting to backend API...</p>
      ) : (
        <div style={{ background: '#1E293B', padding: '24px', borderRadius: '8px', maxWidth: '600px', border: '1px solid #334155' }}>
          <h3>Backend System Status</h3>
          <p><strong>Service Status:</strong> {stats?.status || 'Unknown'}</p>
          <p><strong>Database:</strong> {stats?.database || 'Disconnected'}</p>
          <p><strong>Environment:</strong> {stats?.environment || 'Production'}</p>
          <p><strong>Timestamp:</strong> {stats?.timestamp || '-'}</p>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CommandCenter />
  </React.StrictMode>
);
