import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f9fafb', whiteSpace: 'nowrap', borderBottom: '2px solid #e5e7eb' };
const td = { padding: '10px 12px', verticalAlign: 'middle', fontSize: 13, borderBottom: '1px solid #f3f4f6' };

const today   = () => new Date().toISOString().slice(0, 10);
const inDays  = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

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
  const [dateFrom,   setDateFrom]   = useState(today());
  const [dateTo,     setDateTo]     = useState(inDays(6));
  const [syncDates,  setSyncDates]  = useState({ start: today(), end: inDays(6) });
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [toggling,   setToggling]   = useState({}); // id → true

  const reload = useCallback(async () => {
    const res = await fetch(`${API}/api/seatos/trips`);
    if (res.ok) setTrips(await res.json());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleSync(e) {
    e.preventDefault();
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch(`${API}/api/seatos/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: syncDates.start, end_date: syncDates.end }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setSyncResult({ type: 'ok', message: `Job #${job.id} đã tạo — extension xử lý ngay.` });
      setTimeout(reload, 4000);
    } catch (err) {
      setSyncResult({ type: 'error', message: err.message });
    } finally { setSyncing(false); }
  }

  async function toggleStatus(trip) {
    const newStatus = trip.status === 'active' ? 'inactive' : 'active';
    setToggling(t => ({ ...t, [trip.id]: true }));
    try {
      await fetch(`${API}/api/seatos/trips/${trip.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setTrips(ts => ts.map(t => t.id === trip.id ? { ...t, status: newStatus } : t));
    } finally {
      setToggling(t => { const n = { ...t }; delete n[trip.id]; return n; });
    }
  }

  // Filter by date range + search
  const filtered = trips.filter(t => {
    const dep = parseDep(t.platform_data?.departure);
    if (dep) {
      const dateStr = dep.toISOString().slice(0, 10);
      if (dateStr < dateFrom || dateStr > dateTo) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount   = filtered.filter(t => t.status === 'active').length;
  const inactiveCount = filtered.length - activeCount;

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:'0 0 4px', fontSize:18, fontWeight:700 }}>SeatOS — Lịch chạy</h2>
          <div style={{ fontSize:12, color:'#6b7280' }}>
            <span style={{ color:'#16a34a', fontWeight:700 }}>{activeCount} active</span>
            <span style={{ margin:'0 6px', color:'#d1d5db' }}>·</span>
            <span>{inactiveCount} inactive</span>
            <span style={{ margin:'0 6px', color:'#d1d5db' }}>·</span>
            <span>{trips.length} tổng</span>
          </div>
        </div>

        {/* Sync form */}
        <form onSubmit={handleSync}
          style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap',
                   background:'#eff6ff', padding:'10px 14px', borderRadius:8, border:'1px solid #bfdbfe' }}>
          <span style={{ fontSize:12, fontWeight:700, color:'#1d4ed8', whiteSpace:'nowrap' }}>SYNC:</span>
          <input type="date" value={syncDates.start}
            onChange={e => setSyncDates(d => ({ ...d, start: e.target.value }))}
            style={{ padding:'5px 8px', border:'1px solid #93c5fd', borderRadius:4, fontSize:13 }} />
          <span style={{ color:'#6b7280' }}>→</span>
          <input type="date" value={syncDates.end}
            onChange={e => setSyncDates(d => ({ ...d, end: e.target.value }))}
            style={{ padding:'5px 8px', border:'1px solid #93c5fd', borderRadius:4, fontSize:13 }} />
          <button type="submit" disabled={syncing}
            style={{ padding:'6px 16px', background:'#1d4ed8', color:'#fff',
                     border:'none', borderRadius:4, cursor:'pointer', fontSize:13, fontWeight:600 }}>
            {syncing ? 'Đang tạo…' : 'Sync'}
          </button>
          {syncResult && (
            <span style={{ fontSize:12, color: syncResult.type==='ok' ? '#1d4ed8' : '#dc2626' }}>
              {syncResult.message}
            </span>
          )}
        </form>
      </div>

      {/* ── Filters ── */}
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        {/* Date range */}
        <div style={{ display:'flex', gap:6, alignItems:'center', padding:'6px 10px',
                      background:'#fff', border:'1px solid #e5e7eb', borderRadius:7 }}>
          <span style={{ fontSize:12, color:'#6b7280', fontWeight:600 }}>Xem từ</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ padding:'4px 6px', border:'1px solid #d1d5db', borderRadius:5, fontSize:12 }} />
          <span style={{ color:'#9ca3af', fontSize:12 }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ padding:'4px 6px', border:'1px solid #d1d5db', borderRadius:5, fontSize:12 }} />
        </div>

        {/* Quick date buttons */}
        {[['Hôm nay', today(), today()], ['Ngày mai', inDays(1), inDays(1)], ['7 ngày', today(), inDays(6)]].map(([lbl, f, t]) => (
          <button key={lbl} onClick={() => { setDateFrom(f); setDateTo(t); }}
            style={{ padding:'5px 12px', borderRadius:6, border:'1px solid #e5e7eb',
                     background: dateFrom===f && dateTo===t ? '#2563eb' : '#fff',
                     color: dateFrom===f && dateTo===t ? '#fff' : '#374151',
                     fontSize:12, fontWeight:600, cursor:'pointer' }}>
            {lbl}
          </button>
        ))}

        {/* Search */}
        <input placeholder="Tìm tuyến, loại xe…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, width:200 }} />

        <span style={{ fontSize:12, color:'#9ca3af' }}>{filtered.length} chuyến</span>
      </div>

      {/* ── Table ── */}
      <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Tuyến xe</th>
              <th style={th}>Loại xe</th>
              <th style={th}>Khởi hành</th>
              <th style={th}>Ghế (Đặt/Tổng)</th>
              <th style={th}>Lấp đầy</th>
              <th style={th}>Trạng thái</th>
              <th style={{ ...th, textAlign:'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(trip => {
              const meta   = trip.platform_data || {};
              const total  = meta.total_quota ?? meta.original_seats ?? 0;
              const booked = meta.booked ?? 0;
              const pct    = total > 0 ? Math.round(booked / total * 100) : 0;
              const dep    = parseDep(meta.departure);
              const depStr = dep
                ? dep.toLocaleString('vi-VN', { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                : (meta.departure || '—');
              const isActive  = trip.status === 'active';
              const isBusy    = toggling[trip.id];

              return (
                <tr key={trip.id} style={{ opacity: isActive ? 1 : 0.55 }}>
                  <td style={{ ...td, fontWeight:600, color:'#1f2937' }}>
                    {trip.title}
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:1 }}>#{trip.external_id}</div>
                  </td>
                  <td style={{ ...td, color:'#374151' }}>{trip.description || meta.class_code || '—'}</td>
                  <td style={{ ...td, whiteSpace:'nowrap', fontWeight:600, color:'#111' }}>{depStr}</td>
                  <td style={{ ...td, textAlign:'center' }}>
                    <span style={{ fontWeight: booked > 0 ? 700 : 400, color: booked > 0 ? '#111' : '#9ca3af' }}>
                      {booked}
                    </span>
                    <span style={{ color:'#d1d5db', margin:'0 3px' }}>/</span>
                    <span style={{ color:'#9ca3af' }}>{total || '—'}</span>
                  </td>
                  <td style={{ ...td, minWidth:90 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ flex:1, height:5, background:'#e5e7eb', borderRadius:3, overflow:'hidden' }}>
                        <div style={{
                          height:'100%', borderRadius:3,
                          width:`${pct}%`,
                          background: pct>=80 ? '#dc2626' : pct>=50 ? '#f59e0b' : '#2563eb',
                        }} />
                      </div>
                      <span style={{ fontSize:11, color:'#6b7280', minWidth:28 }}>{pct}%</span>
                    </div>
                  </td>
                  <td style={td}>
                    {isActive
                      ? <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:12, fontWeight:600, background:'#dcfce7', color:'#16a34a' }}>Active</span>
                      : <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:12, fontWeight:600, background:'#f3f4f6', color:'#9ca3af' }}>Inactive</span>
                    }
                  </td>
                  <td style={{ ...td, textAlign:'right' }}>
                    <button onClick={() => toggleStatus(trip)} disabled={isBusy}
                      style={{
                        padding:'4px 14px', fontSize:12, fontWeight:600, borderRadius:6,
                        border:'none', cursor: isBusy ? 'not-allowed' : 'pointer',
                        background: isActive ? '#fee2e2' : '#dcfce7',
                        color:      isActive ? '#dc2626' : '#16a34a',
                        opacity:    isBusy ? 0.5 : 1,
                      }}>
                      {isBusy ? '…' : isActive ? 'Tắt' : 'Bật'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign:'center', color:'#9ca3af', padding:50 }}>
                  {trips.length === 0
                    ? 'Chưa có dữ liệu — bấm Sync để tải từ SeatOS.'
                    : 'Không có chuyến nào trong khoảng thời gian này.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
