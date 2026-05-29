import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f3f4f6', whiteSpace: 'nowrap' };
const td = { padding: '10px 12px', verticalAlign: 'middle', fontSize: 13 };

const today = () => new Date().toISOString().slice(0, 10);

// SeatOS returns departure as "DD-MM-YYYY HH:mm" — JS Date() can't parse that
function parseDep(str) {
  if (!str) return null;
  const [datePart, timePart = '00:00'] = str.split(' ');
  const [dd, mm, yyyy] = datePart.split('-');
  if (!dd || !mm || !yyyy) return null;
  return new Date(`${yyyy}-${mm}-${dd}T${timePart}:00`);
}

export default function SeatOS() {
  const [trips,      setTrips]      = useState([]);
  const [search,     setSearch]     = useState('');
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
      setSyncResult({ type: 'ok', message: `Job #${job.id} queued — extension will process shortly.` });
      setTimeout(reload, 4000);
    } catch (err) {
      setSyncResult({ type: 'error', message: err.message });
    } finally {
      setSyncing(false);
    }
  }

  const filtered = search.trim()
    ? trips.filter(t => t.title?.toLowerCase().includes(search.toLowerCase()) ||
                        t.description?.toLowerCase().includes(search.toLowerCase()))
    : trips;

  return (
    <div>
      {/* Header row: title + sync form */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>SeatOS Trips</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{trips.length} trips synced</p>
        </div>

        <form
          onSubmit={handleSync}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                   background: '#eff6ff', padding: '10px 14px', borderRadius: 8,
                   border: '1px solid #bfdbfe' }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8', whiteSpace: 'nowrap' }}>SYNC:</span>
          <input
            type="date" value={syncDates.start}
            onChange={e => setSyncDates(d => ({ ...d, start: e.target.value }))}
            style={{ padding: '6px 8px', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 13 }}
          />
          <span style={{ color: '#6b7280' }}>→</span>
          <input
            type="date" value={syncDates.end}
            onChange={e => setSyncDates(d => ({ ...d, end: e.target.value }))}
            style={{ padding: '6px 8px', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 13 }}
          />
          <button
            type="submit" disabled={syncing}
            style={{ padding: '6px 16px', background: '#1d4ed8', color: '#fff',
                     border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {syncing ? 'Queuing…' : 'Sync'}
          </button>
          {syncResult && (
            <span style={{ fontSize: 12, color: syncResult.type === 'ok' ? '#1d4ed8' : '#dc2626' }}>
              {syncResult.message}
            </span>
          )}
        </form>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Search route or class…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 280, padding: '7px 10px', border: '1px solid #d1d5db',
                   borderRadius: 6, fontSize: 13 }}
        />
        {search && (
          <span style={{ marginLeft: 10, fontSize: 12, color: '#6b7280' }}>
            {filtered.length} / {trips.length} trips
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              <th style={th}>Route</th>
              <th style={th}>Class</th>
              <th style={th}>Departure</th>
              <th style={th}>Total</th>
              <th style={th}>Booked</th>
              <th style={th}>Fill %</th>
              <th style={th}>Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(trip => {
              const meta   = trip.platform_data || {};
              const total  = meta.total_quota ?? meta.original_seats ?? 0;
              const booked = meta.booked ?? 0;
              const pct    = total > 0 ? Math.round(booked / total * 100) : 0;
              const dep    = parseDep(meta.departure);
              const depStr = dep ? dep.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : (meta.departure || '—');

              return (
                <tr key={trip.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{trip.title}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>#{trip.external_id}</div>
                  </td>
                  <td style={{ ...td, color: '#374151' }}>{trip.description || meta.class_code || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#374151' }}>{depStr}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{total || '—'}</td>
                  <td style={{ ...td, textAlign: 'center', fontWeight: booked > 0 ? 600 : 400 }}>{booked}</td>
                  <td style={{ ...td, minWidth: 80 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3 }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${pct}%`,
                          background: pct >= 80 ? '#dc2626' : pct >= 50 ? '#f59e0b' : '#2563eb',
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#6b7280', minWidth: 28 }}>{pct}%</span>
                    </div>
                  </td>
                  <td style={{ ...td, color: '#9ca3af', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {trip.last_synced_at ? new Date(trip.last_synced_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                  {trips.length === 0 ? 'No trips yet — sync from SeatOS above.' : 'No trips match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
