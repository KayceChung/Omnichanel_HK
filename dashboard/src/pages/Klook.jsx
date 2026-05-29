import { useState, useEffect, useCallback, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const th = { padding: '10px 14px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f9fafb', whiteSpace: 'nowrap', borderBottom: '2px solid #e5e7eb' };
const td = { padding: '10px 14px', verticalAlign: 'middle', fontSize: 13, borderBottom: '1px solid #f3f4f6' };

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function StatusBadge({ status }) {
  const cfg = {
    done:    { bg: '#dcfce7', color: '#16a34a', label: 'Xong' },
    running: { bg: '#dbeafe', color: '#2563eb', label: 'Đang chạy…' },
    pending: { bg: '#fef9c3', color: '#ca8a04', label: 'Chờ…' },
    failed:  { bg: '#fee2e2', color: '#dc2626', label: 'Lỗi' },
  }[status] || { bg: '#f3f4f6', color: '#6b7280', label: status };
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                   fontSize: 12, fontWeight: 600, background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

export default function Klook() {
  const [tuyen,       setTuyen]      = useState([]);   // activities/routes
  const [newId,       setNewId]      = useState('');
  const [newName,     setNewName]    = useState('');

  const [goiVe,       setGoiVe]      = useState([]);   // SKUs / packages
  const [activeGoi,   setActiveGoi]  = useState(null);
  const [khoangGio,   setKhoangGio]  = useState([]);   // timeslots
  const [actionMsg,   setActionMsg]  = useState({});

  const [syncStart,   setSyncStart]  = useState(today());
  const [syncEnd,     setSyncEnd]    = useState(inDays(30));
  const [syncing,     setSyncing]    = useState(false);
  const [syncJobs,    setSyncJobs]   = useState([]);   // recent sync_activity jobs
  const syncBatchRef  = useRef(null); // timestamp when last sync-all was triggered

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadTuyen = useCallback(async () => {
    const r = await fetch(`${API}/api/klook/activities`);
    if (r.ok) setTuyen(await r.json());
  }, []);

  const loadGoiVe = useCallback(async () => {
    const r = await fetch(`${API}/api/klook/skus`);
    if (r.ok) setGoiVe(await r.json());
  }, []);

  const loadKhoangGio = useCallback(async (skuId) => {
    if (!skuId) { setKhoangGio([]); return; }
    const r = await fetch(`${API}/api/klook/calendar?sku_id=${encodeURIComponent(skuId)}`);
    if (r.ok) setKhoangGio(await r.json());
  }, []);

  const loadSyncJobs = useCallback(async () => {
    if (!syncBatchRef.current) return;
    const r = await fetch(`${API}/api/jobs/recent?type=klook_sync_activity&after=${syncBatchRef.current}`);
    if (r.ok) {
      const jobs = await r.json();
      setSyncJobs(jobs);
      // When all done/failed, reload packages
      const active = jobs.filter(j => j.status === 'pending' || j.status === 'running');
      if (active.length === 0 && jobs.length > 0) {
        loadGoiVe();
        if (activeGoi) loadKhoangGio(activeGoi.sku_id);
      }
    }
  }, [activeGoi, loadGoiVe, loadKhoangGio]);

  useEffect(() => { loadTuyen(); loadGoiVe(); }, [loadTuyen, loadGoiVe]);
  useEffect(() => { const t = setInterval(loadTuyen, 5000); return () => clearInterval(t); }, [loadTuyen]);

  // Poll jobs while any are running
  useEffect(() => {
    const active = syncJobs.filter(j => j.status === 'pending' || j.status === 'running');
    if (active.length === 0) return;
    const t = setInterval(loadSyncJobs, 3000);
    return () => clearInterval(t);
  }, [syncJobs, loadSyncJobs]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function themTuyen(e) {
    e.preventDefault();
    if (!newId.trim()) return;
    const r = await fetch(`${API}/api/klook/activities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_id: newId.trim(), name: newName.trim() || null }),
    });
    if (r.ok) { setNewId(''); setNewName(''); loadTuyen(); }
  }

  async function xoaTuyen(id) {
    await fetch(`${API}/api/klook/activities/${id}`, { method: 'DELETE' });
    loadTuyen();
  }

  async function dongBoTatCa(e) {
    e.preventDefault();
    if (!tuyen.length) return;
    setSyncing(true);
    setSyncJobs([]);
    syncBatchRef.current = Date.now();
    try {
      const r = await fetch(`${API}/api/klook/sync-all`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: syncStart, end_date: syncEnd }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // Start polling immediately
      setTimeout(loadSyncJobs, 1000);
    } catch (err) {
      alert(err.message);
    } finally {
      setSyncing(false);
    }
  }

  function chonGoiVe(goi) {
    setActiveGoi(goi);
    loadKhoangGio(goi.sku_id);
  }

  async function batTat(slot, publish) {
    const meta = slot.platform_data || {};
    setActionMsg(m => ({ ...m, [slot.id]: publish ? 'Đang bật…' : 'Đang tắt…' }));
    try {
      const r = await fetch(`${API}/api/klook/update-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id:       meta.sku_id,
          start_time:   meta.start_time,
          published:    publish,
          inv_quantity: meta.inv_quantity ?? 0,
          price:        meta.price ?? undefined,
          cut_off_time: meta.cut_off_time ?? 147600,
        }),
      });
      const job = await r.json();
      if (!r.ok) throw new Error(job.error);
      setActionMsg(m => ({ ...m, [slot.id]: `✓ Job #${job.id}` }));
      setTimeout(() => {
        setActionMsg(m => { const n = { ...m }; delete n[slot.id]; return n; });
        loadKhoangGio(activeGoi?.sku_id);
      }, 3000);
    } catch (err) {
      setActionMsg(m => ({ ...m, [slot.id]: `Lỗi: ${err.message}` }));
    }
  }

  // ── Computed values ───────────────────────────────────────────────────────

  const jobsDone    = syncJobs.filter(j => j.status === 'done').length;
  const jobsFailed  = syncJobs.filter(j => j.status === 'failed').length;
  const jobsRunning = syncJobs.filter(j => j.status === 'pending' || j.status === 'running').length;
  const totalJobs   = syncJobs.length;
  const isSyncing   = jobsRunning > 0;

  const soActive   = khoangGio.filter(s => s.platform_data?.published ?? s.platform_data?.publish_status === 'published').length;
  const soInactive = khoangGio.length - soActive;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Klook — Quản lý lịch chạy</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Đồng bộ và bật/tắt khung giờ từ tài khoản Klook Merchant của bạn.
          </p>
        </div>
      </div>

      {/* ── BƯỚC 1: Danh sách tuyến ──────────────────────────────────────── */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>

          {/* Left: tuyến list */}
          <div style={{ flex: '1 1 380px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#374151' }}>
              Tuyến xe đã thêm
              <span style={{ marginLeft: 8, fontWeight: 400, color: '#9ca3af', fontSize: 12 }}>
                (tự phát hiện khi mở trang Klook Merchant)
              </span>
            </h3>

            <form onSubmit={themTuyen} style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <input required placeholder="Activity ID (vd: 214640)"
                value={newId} onChange={e => setNewId(e.target.value)}
                style={{ width: 155, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              <input placeholder="Tên tuyến"
                value={newName} onChange={e => setNewName(e.target.value)}
                style={{ flex: '1 1 160px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              <button type="submit"
                style={{ padding: '6px 14px', background: '#f3f4f6', color: '#374151',
                         border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                + Thêm
              </button>
            </form>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {tuyen.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <span style={{ fontSize: 13 }}>
                    {t.name
                      ? <><strong style={{ color: '#374151' }}>{t.name}</strong><span style={{ color: '#9ca3af', fontSize: 11 }}> #{t.activity_id}</span></>
                      : <strong style={{ color: '#374151' }}>#{t.activity_id}</strong>}
                  </span>
                  <button onClick={() => xoaTuyen(t.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db',
                             fontSize: 15, padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
              ))}
              {tuyen.length === 0 && (
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
                  Chưa có tuyến nào. Mở trang <strong>merchant.klook.com → Activity Management</strong> để tự phát hiện.
                </p>
              )}
            </div>
          </div>

          {/* Right: sync all + status */}
          <div style={{ flex: '0 0 auto', minWidth: 260 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#374151' }}>Đồng bộ tất cả</h3>
            <form onSubmit={dongBoTatCa}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                <input type="date" value={syncStart} onChange={e => setSyncStart(e.target.value)}
                  style={{ flex: 1, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                <span style={{ color: '#9ca3af' }}>→</span>
                <input type="date" value={syncEnd} onChange={e => setSyncEnd(e.target.value)}
                  style={{ flex: 1, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              </div>
              <button type="submit" disabled={syncing || tuyen.length === 0 || isSyncing}
                style={{ width: '100%', padding: '9px 0', fontWeight: 700, fontSize: 14,
                         background: (tuyen.length > 0 && !isSyncing) ? '#2563eb' : '#d1d5db',
                         color: '#fff', border: 'none', borderRadius: 7,
                         cursor: (tuyen.length > 0 && !isSyncing) ? 'pointer' : 'not-allowed' }}>
                {isSyncing ? `Đang đồng bộ… (${jobsDone}/${totalJobs})` :
                 syncing   ? 'Đang tạo job…' :
                             `Đồng bộ tất cả ${tuyen.length} tuyến`}
              </button>
            </form>

            {/* Job progress */}
            {totalJobs > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: '#f9fafb',
                            border: '1px solid #e5e7eb', borderRadius: 8 }}>
                {/* Progress bar */}
                <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, marginBottom: 8 }}>
                  <div style={{ height: '100%', borderRadius: 3, transition: 'width .4s',
                    width: `${Math.round((jobsDone + jobsFailed) / totalJobs * 100)}%`,
                    background: jobsFailed > 0 ? '#f59e0b' : '#2563eb' }} />
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  {jobsDone > 0    && <span style={{ color: '#16a34a' }}>✓ {jobsDone} xong</span>}
                  {jobsRunning > 0 && <span style={{ color: '#2563eb' }}>⟳ {jobsRunning} đang chạy</span>}
                  {jobsFailed > 0  && <span style={{ color: '#dc2626' }}>✗ {jobsFailed} lỗi</span>}
                </div>
                {jobsRunning === 0 && jobsDone + jobsFailed === totalJobs && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                    ✓ Đồng bộ hoàn tất — dữ liệu đã được cập nhật.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BƯỚC 2: Chọn gói/loại vé ─────────────────────────────────────── */}
      {goiVe.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, color: '#374151' }}>
            Chọn loại vé để xem lịch
            <span style={{ marginLeft: 8, fontWeight: 400, color: '#9ca3af', fontSize: 12 }}>
              {goiVe.length} loại vé đã đồng bộ
            </span>
          </h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {goiVe.map(g => {
              const isActive = activeGoi?.sku_id === g.sku_id;
              const tenHienThi = g.product_name || `Mã ${g.sku_id}`;
              return (
                <button key={g.sku_id} onClick={() => chonGoiVe(g)}
                  style={{ padding: '8px 14px', textAlign: 'left', borderRadius: 8, cursor: 'pointer',
                    border: isActive ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    background: isActive ? '#eff6ff' : '#fff',
                    transition: 'all .15s' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#1d4ed8' : '#374151' }}>
                    {tenHienThi}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    {g.slot_count} khung giờ
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BƯỚC 3: Bảng lịch ────────────────────────────────────────────── */}
      {activeGoi && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>
                {activeGoi.product_name || `Mã ${activeGoi.sku_id}`}
              </h3>
              <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280', display: 'flex', gap: 14 }}>
                <span>{khoangGio.length} khung giờ tổng</span>
                <span style={{ color: '#16a34a' }}>● {soActive} đang mở</span>
                <span style={{ color: '#6b7280' }}>● {soInactive} đã tắt</span>
              </div>
            </div>
            <button
              onClick={async () => {
                const r = await fetch(`${API}/api/klook/sync-calendar`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sku_id: activeGoi.sku_id, activity_id: activeGoi.activity_id || '',
                                         product_name: activeGoi.product_name, start_date: syncStart, end_date: syncEnd }),
                });
                if (r.ok) setTimeout(() => loadKhoangGio(activeGoi.sku_id), 5000);
              }}
              style={{ padding: '7px 16px', background: '#f3f4f6', border: '1px solid #d1d5db',
                       borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
              ↻ Làm mới
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Tuyến xe</th>
                <th style={th}>Giờ khởi hành</th>
                <th style={th}>Trạng thái</th>
                <th style={th}>Chỗ trống</th>
                <th style={th}>Đã đặt</th>
                <th style={th}>Giá (VND)</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {khoangGio.map(slot => {
                const meta      = slot.platform_data || {};
                const published = meta.published ?? meta.publish_status === 'published';
                const retail    = meta.price?.retail_price ?? meta.price?.retailPrice;
                const tenTuyen  = meta.product_name || activeGoi?.product_name || `Mã ${meta.sku_id || ''}`;
                return (
                  <tr key={slot.id} style={{ opacity: published ? 1 : 0.6 }}>
                    <td style={{ ...td, maxWidth: 220 }}>
                      <span style={{ fontWeight: 600, color: '#374151' }}>{tenTuyen}</span>
                    </td>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.start_time || '—'}</td>
                    <td style={td}><StatusBadge status={published ? 'done' : 'failed'} /></td>
                    <td style={{ ...td, textAlign: 'center' }}>{meta.inv_quantity ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: (meta.sales ?? 0) > 0 ? 700 : 400, color: (meta.sales ?? 0) > 0 ? '#374151' : '#9ca3af' }}>
                      {meta.sales ?? 0}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {retail ? retail.toLocaleString('vi-VN') : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {actionMsg[slot.id] ? (
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{actionMsg[slot.id]}</span>
                      ) : published ? (
                        <button onClick={() => batTat(slot, false)}
                          style={{ padding: '4px 14px', fontSize: 12, background: '#fef2f2',
                                   color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer' }}>
                          Tắt
                        </button>
                      ) : (
                        <button onClick={() => batTat(slot, true)}
                          style={{ padding: '4px 14px', fontSize: 12, background: '#f0fdf4',
                                   color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 5, cursor: 'pointer' }}>
                          Bật
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {khoangGio.length === 0 && (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                  Chưa có dữ liệu — bấm Làm mới để tải.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!activeGoi && goiVe.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚌</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Chưa có dữ liệu lịch chạy</div>
          <div style={{ fontSize: 13 }}>Thêm tuyến xe rồi bấm <strong>Đồng bộ tất cả</strong> để bắt đầu.</div>
        </div>
      )}
    </div>
  );
}
