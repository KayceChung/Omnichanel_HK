import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f3f4f6' };
const td = { padding: '10px 12px', verticalAlign: 'top', fontSize: 14 };

const today = () => new Date().toISOString().slice(0, 10);

export default function SeatOS() {
  const [trips,      setTrips]      = useState([]);
  const [syncDates,  setSyncDates]  = useState({ start: today(), end: today() });
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const reload = useCallback(async () => {
    const res = await fetch(`${API}/api/seatos/trips`);
    if (res.ok) setTrips(await res.json());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleSync(e) {
    e.preventDefault();
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API}/api/seatos/sync`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ start_date: syncDates.start, end_date: syncDates.end }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setSyncResult({ type: 'ok', message: `Sync job #${job.id} queued — extension will process it shortly.` });
      setTimeout(reload, 4000);
    } catch (err) {
      setSyncResult({ type: 'error', message: err.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>SeatOS (12Go) Trips</h2>

      {/* Sync form */}
      <form
        onSubmit={handleSync}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap',
                 marginBottom: 24, background: '#eff6ff', padding: 16, borderRadius: 8,
                 border: '1px solid #bfdbfe' }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', marginBottom: 6 }}>SYNC FROM SEATOS</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="date" value={syncDates.start}
              onChange={e => setSyncDates(d => ({ ...d, start: e.target.value }))}
              style={{ padding: '7px 10px', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 13 }}
            />
            <span style={{ color: '#6b7280' }}>→</span>
            <input
              type="date" value={syncDates.end}
              onChange={e => setSyncDates(d => ({ ...d, end: e.target.value }))}
              style={{ padding: '7px 10px', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 13 }}
            />
            <button
              type="submit" disabled={syncing}
              style={{ padding: '7px 18px', background: '#1d4ed8', color: '#fff',
                       border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {syncing ? 'Queuing…' : 'Sync Trips'}
            </button>
          </div>
        </div>
        {syncResult && (
          <p style={{ width: '100%', margin: 0, fontSize: 13,
                      color: syncResult.type === 'ok' ? '#1d4ed8' : '#dc2626' }}>
            {syncResult.message}
          </p>
        )}
      </form>

      {/* Trips table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Route</th>
            <th style={th}>Class</th>
            <th style={th}>Departure</th>
            <th style={th}>Seats (Total / Booked)</th>
            <th style={th}>Status</th>
            <th style={th}>Last Sync</th>
          </tr>
        </thead>
        <tbody>
          {trips.map(trip => {
            const meta = trip.platform_data || {};
            const total  = meta.total_quota ?? meta.original_seats ?? '—';
            const booked = meta.booked ?? '—';
            const dep    = meta.departure ? new Date(meta.departure).toLocaleString() : '—';
            return (
              <tr key={trip.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>
                  <strong>{trip.title}</strong>
                  {trip.external_id && (
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>ID #{trip.external_id}</div>
                  )}
                </td>
                <td style={td}>{trip.description || meta.class_code || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{dep}</td>
                <td style={td}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {total} / {booked}
                  </span>
                  {typeof total === 'number' && typeof booked === 'number' && total > 0 && (
                    <div style={{ marginTop: 4, height: 4, background: '#e5e7eb', borderRadius: 2 }}>
                      <div
                        style={{
                          height: '100%', borderRadius: 2,
                          width: `${Math.min(100, Math.round(booked / total * 100))}%`,
                          background: booked / total > 0.8 ? '#dc2626' : '#2563eb',
                        }}
                      />
                    </div>
                  )}
                </td>
                <td style={td}>
                  <span style={{ fontWeight: 600, color: trip.status === 'active' ? '#16a34a' : '#6b7280' }}>
                    {trip.status}
                  </span>
                </td>
                <td style={{ ...td, color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {trip.last_synced_at ? new Date(trip.last_synced_at).toLocaleString() : '—'}
                </td>
              </tr>
            );
          })}
          {trips.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No trips yet — use Sync Trips above or the extension auto-sync.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
