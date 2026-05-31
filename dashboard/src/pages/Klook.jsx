import { useState, useEffect, useCallback, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const today  = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtTime = (dt) => dt ? String(dt).slice(11, 16) : '—';
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('vi-VN', {
  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
});

const PRESETS = [
  { label: 'Hôm nay',  from: () => today(),   to: () => today()   },
  { label: 'Ngày mai', from: () => inDays(1), to: () => inDays(1) },
  { label: '3 ngày',   from: () => today(),   to: () => inDays(2) },
  { label: '7 ngày',   from: () => today(),   to: () => inDays(6) },
  { label: 'Tùy chọn', from: null,            to: null            },
];

export default function Klook() {
  // ── Main view ───────────────────────────────────────────────────────────────
  const [slots,     setSlots]    = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [tab,       setTab]      = useState(0);
  const [customFrom, setCFrom]   = useState(today());
  const [customTo,   setCTo]     = useState(inDays(6));
  const [filter,    setFilter]   = useState('all'); // 'all' | 'active' | 'inactive'
  const [msgs,      setMsgs]     = useState({});    // slot.id → message string
  const [inlineRename, setInlineRename] = useState(null);
  const [inlineVal,    setInlineVal]    = useState('');
  const [filterActivity, setFilterActivity] = useState(null); // null = all

  // ── Settings panel ──────────────────────────────────────────────────────────
  const [open,       setOpen]     = useState(false);
  const [tuyen,      setTuyen]    = useState([]);
  const [newId,      setNewId]    = useState('');
  const [newName,    setNewName]  = useState('');
  const [goiVe,      setGoiVe]    = useState([]);
  const [renaming,   setRenaming] = useState(null);
  const [renameVal,  setRenameVal]= useState('');
  const [syncStart,  setSStart]   = useState(today());
  const [syncEnd,    setSEnd]     = useState(inDays(30));
  const [syncing,    setSyncing]  = useState(false);
  const [syncJobs,   setSyncJobs] = useState([]);
  const batchRef = useRef(null);

  const preset   = PRESETS[tab];
  const dateFrom = preset.from ? preset.from() : customFrom;
  const dateTo   = preset.to   ? preset.to()   : customTo;

  // ── Loaders ─────────────────────────────────────────────────────────────────

  const loadSlots = useCallback(async (from, to) => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/klook/calendar?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`);
      if (r.ok) setSlots(await r.json());
    } finally { setLoading(false); }
  }, []);

  const loadTuyen = useCallback(async () => {
    const r = await fetch(`${API}/api/klook/activities`);
    if (r.ok) setTuyen(await r.json());
  }, []);

  const loadGoiVe = useCallback(async () => {
    const r = await fetch(`${API}/api/klook/skus`);
    if (r.ok) setGoiVe(await r.json());
  }, []);

  const loadSyncJobs = useCallback(async () => {
    if (!batchRef.current) return;
    const r = await fetch(`${API}/api/jobs/recent?type=klook_sync_activity&after=${batchRef.current}`);
    if (!r.ok) return;
    const jobs = await r.json();
    setSyncJobs(jobs);
    const active = jobs.filter(j => j.status === 'pending' || j.status === 'running');
    if (active.length === 0 && jobs.length > 0) {
      loadGoiVe();
      loadSlots(dateFrom, dateTo);
    }
  }, [loadGoiVe, loadSlots, dateFrom, dateTo]);

  useEffect(() => { loadSlots(dateFrom, dateTo); }, [loadSlots, dateFrom, dateTo]);
  useEffect(() => { loadTuyen(); loadGoiVe(); }, [loadTuyen, loadGoiVe]);

  useEffect(() => {
    const active = syncJobs.filter(j => j.status === 'pending' || j.status === 'running');
    if (!active.length) return;
    const t = setInterval(loadSyncJobs, 3000);
    return () => clearInterval(t);
  }, [syncJobs, loadSyncJobs]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function toggle(slot, publish) {
    const meta = slot.platform_data || {};
    setMsgs(m => ({ ...m, [slot.id]: publish ? '…bật' : '…tắt' }));
    try {
      const r = await fetch(`${API}/api/klook/update-schedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_id:       meta.sku_id,          // extension will Number() this
          start_time:   meta.start_time,
          published:    publish,
          inv_quantity: meta.inv_quantity,     // keep exact value; -1 = inherit
          price:        meta.price ?? undefined,
          cut_off_time: meta.cut_off_time ?? 147600,
        }),
      });
      const job = await r.json();
      if (!r.ok) throw new Error(job.error);
      setMsgs(m => ({ ...m, [slot.id]: 'ok' }));
      // DB already updated optimistically — reload quickly to reflect new status
      setTimeout(() => {
        setMsgs(m => { const n = { ...m }; delete n[slot.id]; return n; });
        loadSlots(dateFrom, dateTo);
      }, 600);
    } catch {
      setMsgs(m => ({ ...m, [slot.id]: 'lỗi' }));
    }
  }

  async function saveInlineName(sku_id) {
    const name = inlineVal.trim();
    if (!name) { setInlineRename(null); return; }
    await fetch(`${API}/api/klook/set-product-name`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku_id, product_name: name }),
    });
    setInlineRename(null); setInlineVal('');
    loadGoiVe(); loadSlots(dateFrom, dateTo);
  }

  async function addRoute(e) {
    e.preventDefault();
    if (!newId.trim()) return;
    await fetch(`${API}/api/klook/activities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activity_id: newId.trim(), name: newName.trim() || null }),
    });
    setNewId(''); setNewName(''); loadTuyen();
  }

  async function syncAll(e) {
    e.preventDefault();
    if (!tuyen.length) return;
    setSyncing(true); setSyncJobs([]); batchRef.current = Date.now();
    try {
      const r = await fetch(`${API}/api/klook/sync-all`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: syncStart, end_date: syncEnd }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setTimeout(loadSyncJobs, 1000);
    } catch (err) { alert(err.message); }
    finally { setSyncing(false); }
  }

  async function saveGoiName(sku_id) {
    const name = renameVal.trim();
    if (!name) { setRenaming(null); return; }
    await fetch(`${API}/api/klook/set-product-name`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku_id, product_name: name }),
    });
    setRenaming(null); setRenameVal('');
    loadGoiVe(); loadSlots(dateFrom, dateTo);
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  const isPublished = (s) => s.platform_data?.published ?? s.platform_data?.publish_status === 'published';

  // Unique activity names extracted from loaded slots (for the route filter)
  const activityOptions = [...new Set(
    slots.map(s => s.activity_name).filter(Boolean)
  )].sort();

  const filtered = slots.filter(s => {
    if (filter === 'active'   && !isPublished(s)) return false;
    if (filter === 'inactive' &&  isPublished(s)) return false;
    if (filterActivity && s.activity_name !== filterActivity) return false;
    return true;
  });

  const byDate = {};
  for (const s of filtered) {
    const date = (s.platform_data?.start_time || '').slice(0, 10);
    if (date) { if (!byDate[date]) byDate[date] = []; byDate[date].push(s); }
  }
  const dates = Object.keys(byDate).sort();

  const totalOpen   = filtered.filter(isPublished).length;
  const totalClosed = filtered.length - totalOpen;

  const jobsDone    = syncJobs.filter(j => j.status === 'done').length;
  const jobsFailed  = syncJobs.filter(j => j.status === 'failed').length;
  const jobsRunning = syncJobs.filter(j => j.status === 'pending' || j.status === 'running').length;
  const isSyncing   = jobsRunning > 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900 }}>

      {/* ══ HEADER ════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          {/* Title + stats */}
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111' }}>Klook — Lịch chạy</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280', display: 'flex', gap: 10 }}>
              {slots.length > 0 ? (
                <>
                  <span style={{ color: '#16a34a', fontWeight: 700 }}>{totalOpen} đang mở</span>
                  <span style={{ color: '#d1d5db' }}>·</span>
                  <span>{totalClosed} đã tắt</span>
                  <span style={{ color: '#d1d5db' }}>·</span>
                  <span>{slots.length} tổng</span>
                </>
              ) : (
                <span>Chưa có dữ liệu trong khoảng này</span>
              )}
            </div>
          </div>

          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all', 'Tất cả'], ['active', '● Đang mở'], ['inactive', '○ Đã tắt']].map(([v, lbl]) => (
              <button key={v} onClick={() => setFilter(v)}
                style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid', transition: 'all .15s',
                  borderColor: filter === v ? '#374151' : '#e5e7eb',
                  background:  filter === v ? '#374151' : '#fff',
                  color:       filter === v ? '#fff'    : '#6b7280',
                }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Date tab bar */}
        <div style={{ display: 'flex', gap: 4, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {PRESETS.map((p, i) => (
            <button key={i} onClick={() => setTab(i)}
              style={{
                padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: tab === i ? 700 : 400,
                cursor: 'pointer', border: '1px solid', transition: 'all .15s',
                borderColor: tab === i ? '#2563eb' : '#e5e7eb',
                background:  tab === i ? '#2563eb' : '#fff',
                color:       tab === i ? '#fff'    : '#374151',
              }}>
              {p.label}
            </button>
          ))}

          {tab === PRESETS.length - 1 && (
            <>
              <input type="date" value={customFrom} onChange={e => setCFrom(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
              <span style={{ color: '#9ca3af' }}>→</span>
              <input type="date" value={customTo} onChange={e => setCTo(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
            </>
          )}

          <button onClick={() => loadSlots(dateFrom, dateTo)}
            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #e5e7eb',
                     background: '#f9fafb', color: '#6b7280', fontSize: 13, cursor: 'pointer' }}>
            ↻
          </button>
        </div>
      </div>

      {/* ══ ROUTE FILTER ══════════════════════════════════════════════════════ */}
      {activityOptions.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
            Tuyến:
          </span>
          <button onClick={() => setFilterActivity(null)}
            style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
              borderColor: !filterActivity ? '#2563eb' : '#e5e7eb',
              background:  !filterActivity ? '#2563eb' : '#fff',
              color:       !filterActivity ? '#fff'    : '#6b7280' }}>
            Tất cả
          </button>
          {activityOptions.map(act => (
            <button key={act} onClick={() => setFilterActivity(act === filterActivity ? null : act)}
              style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                borderColor: filterActivity === act ? '#1e40af' : '#e5e7eb',
                background:  filterActivity === act ? '#1e40af' : '#fff',
                color:       filterActivity === act ? '#fff'    : '#374151',
                maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {act}
            </button>
          ))}
        </div>
      )}

      {/* ══ MAIN SCHEDULE ═════════════════════════════════════════════════════ */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
            Đang tải…
          </div>
        ) : dates.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Không có dữ liệu trong khoảng này
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              Mở Klook Merchant để extension tự đồng bộ, hoặc dùng nút <strong>Đồng bộ</strong> trong Cài đặt bên dưới.
            </div>
          </div>
        ) : (
          dates.map((date, di) => {
            const daySlots = byDate[date].slice().sort((a, b) =>
              (a.platform_data?.start_time || '').localeCompare(b.platform_data?.start_time || ''));
            const dayOpen = daySlots.filter(isPublished).length;

            return (
              <div key={date}>
                {/* ── Date header ── */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 16px',
                  background: di === 0 ? '#eff6ff' : '#f8fafc',
                  borderTop: di === 0 ? 'none' : '2px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{fmtDate(date)}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>{dayOpen}</span>
                    {' mở / '}{daySlots.length} tổng
                  </span>
                </div>

                {/* ── Group: Tuyến → Sản phẩm → Giờ ── */}
                {(() => {
                  // Tầng 1: nhóm theo activity
                  const byAct = {};
                  for (const s of daySlots) {
                    const actKey = s.activity_name || '(Chưa xác định tuyến)';
                    if (!byAct[actKey]) byAct[actKey] = [];
                    byAct[actKey].push(s);
                  }
                  const actKeys = Object.keys(byAct).sort();

                  return actKeys.map((actName, ai) => {
                    const actSlots  = byAct[actName];
                    const actOpen   = actSlots.filter(isPublished).length;

                    // Tầng 2: nhóm theo product_name trong activity
                    const byProd = {};
                    for (const s of actSlots) {
                      const key = s.platform_data?.product_name || `SKU ${s.platform_data?.sku_id}`;
                      if (!byProd[key]) byProd[key] = [];
                      byProd[key].push(s);
                    }
                    const prodKeys = Object.keys(byProd).sort();

                    return (
                      <div key={actName}>
                        {/* ── Activity / Tuyến header ── */}
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '6px 16px',
                          background: '#eef2ff',
                          borderTop: ai === 0 ? 'none' : '2px solid #c7d2fe',
                          borderBottom: '1px solid #c7d2fe',
                        }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#3730a3' }}>
                            {actName}
                          </span>
                          <span style={{ fontSize: 11, color: '#6366f1' }}>
                            <span style={{ fontWeight: 700 }}>{actOpen}</span>
                            {' mở / '}{actSlots.length}
                          </span>
                        </div>

                        {/* ── Product groups within activity ── */}
                        {prodKeys.map((productName, pi) => {
                          const prodSlots  = byProd[productName].slice().sort((a, b) =>
                            (a.platform_data?.start_time || '').localeCompare(b.platform_data?.start_time || ''));
                          const prodOpen   = prodSlots.filter(isPublished).length;
                          const firstMeta  = prodSlots[0]?.platform_data || {};
                          const retail     = firstMeta.price?.retail_price ?? firstMeta.price?.retailPrice;

                          return (
                            <div key={productName}>
                              {/* Product sub-header */}
                              <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '5px 16px 5px 28px',
                                background: '#f9fafb',
                                borderBottom: '1px solid #e5e7eb',
                                borderTop: pi > 0 ? '1px solid #e5e7eb' : 'none',
                              }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e3a5f' }}>
                                  {productName}
                                </span>
                                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                                  {retail != null && (
                                    <span style={{ fontSize: 11, color: '#9ca3af' }}>
                                      {Math.round(retail / 1000)}k
                                    </span>
                                  )}
                                  <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
                                    <span style={{ fontWeight: 700, color: prodOpen > 0 ? '#16a34a' : '#9ca3af' }}>
                                      {prodOpen}
                                    </span>
                                    {' / '}{prodSlots.length}
                                  </span>
                                </div>
                              </div>

                              {/* Tầng 3: time slot rows */}
                              {prodSlots.map(slot => {
                                const meta      = slot.platform_data || {};
                                const published = isPublished(slot);
                                const sales     = meta.sales ?? 0;
                                const inv       = meta.inv_quantity ?? '—';
                                const msg       = msgs[slot.id];

                                return (
                                  <div key={slot.id} style={{
                                    display: 'grid',
                                    gridTemplateColumns: '60px 1fr 84px',
                                    alignItems: 'center',
                                    padding: '6px 16px 6px 40px',
                                    borderBottom: '1px solid #f3f4f6',
                                    background: published ? '#fff' : '#fafafa',
                                    opacity: published ? 1 : 0.5,
                                  }}>
                                    <div style={{ fontSize: 15, fontWeight: 800, color: '#111', fontVariantNumeric: 'tabular-nums' }}>
                                      {fmtTime(meta.start_time)}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                                      <span style={{ fontWeight: sales > 0 ? 700 : 400, color: sales > 0 ? '#374151' : '#d1d5db' }}>
                                        {sales}
                                      </span>
                                      <span style={{ margin: '0 3px', color: '#e5e7eb' }}>/</span>
                                      {inv}
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                      {msg === 'ok' ? (
                                        <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓</span>
                                      ) : msg === 'lỗi' ? (
                                        <span style={{ fontSize: 11, color: '#dc2626' }}>Lỗi</span>
                                      ) : msg ? (
                                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{msg}</span>
                                      ) : published ? (
                                        <button onClick={() => toggle(slot, false)}
                                          style={{ padding: '3px 12px', fontSize: 12, fontWeight: 600, background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                                          Tắt
                                        </button>
                                      ) : (
                                        <button onClick={() => toggle(slot, true)}
                                          style={{ padding: '3px 12px', fontSize: 12, fontWeight: 600, background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                                          Bật
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            );
          })
        )}
      </div>

      {/* ══ SETTINGS (collapsible) ════════════════════════════════════════════ */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>

        {/* Toggle bar */}
        <button onClick={() => setOpen(v => !v)}
          style={{
            width: '100%', padding: '11px 16px', background: '#f9fafb',
            border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>
            Cài đặt & Đồng bộ
            {isSyncing && (
              <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 700, background: '#dbeafe', padding: '2px 8px', borderRadius: 10 }}>
                ⟳ Đang đồng bộ {jobsDone}/{syncJobs.length}
              </span>
            )}
            {!isSyncing && jobsDone > 0 && jobsDone === syncJobs.length && (
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>
                ✓ Hoàn tất
              </span>
            )}
          </span>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>{open ? '▲ Thu gọn' : '▼ Mở rộng'}</span>
        </button>

        {open && (
          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

            {/* ── Left: Routes + Cabin names ── */}
            <div>
              {/* Routes */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                Tuyến xe ({tuyen.length})
              </div>

              <form onSubmit={addRoute} style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                <input required placeholder="Activity ID" value={newId} onChange={e => setNewId(e.target.value)}
                  style={{ width: 100, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12 }} />
                <input placeholder="Tên tuyến" value={newName} onChange={e => setNewName(e.target.value)}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12 }} />
                <button type="submit"
                  style={{ padding: '5px 10px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>
                  +
                </button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 16 }}>
                {tuyen.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>
                    Mở Klook Merchant để tự phát hiện tuyến.
                  </p>
                ) : tuyen.map(t => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: '#f9fafb', borderRadius: 5 }}>
                    <span style={{ fontSize: 12, color: '#374151' }}>
                      {t.name
                        ? <><strong>{t.name}</strong><span style={{ color: '#9ca3af', marginLeft: 5 }}>#{t.activity_id}</span></>
                        : <span style={{ color: '#9ca3af' }}>#{t.activity_id}</span>
                      }
                    </span>
                    <button onClick={() => fetch(`${API}/api/klook/activities/${t.id}`, { method: 'DELETE' }).then(loadTuyen)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 16, lineHeight: 1 }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Cabin / SKU names */}
              {goiVe.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                    Loại cabin ({goiVe.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {goiVe.map(g => (
                      <div key={g.sku_id} style={{ background: '#f9fafb', borderRadius: 5, overflow: 'hidden' }}>
                        {renaming === g.sku_id ? (
                          <form onSubmit={e => { e.preventDefault(); saveGoiName(g.sku_id); }}
                            style={{ display: 'flex', gap: 4, padding: '5px 8px' }}>
                            <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                              placeholder="vd: Upper Cabin"
                              style={{ flex: 1, padding: '3px 6px', border: '1px solid #93c5fd', borderRadius: 4, fontSize: 12, outline: 'none' }} />
                            <button type="submit"
                              style={{ padding: '3px 8px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                              ✓
                            </button>
                            <button type="button" onClick={() => setRenaming(null)}
                              style={{ padding: '3px 6px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                              ✕
                            </button>
                          </form>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', gap: 6 }}>
                            <span style={{ flex: 1, fontSize: 12, color: '#374151' }}>
                              {g.product_name
                                ? <><strong>{g.product_name}</strong><span style={{ color: '#9ca3af', marginLeft: 5, fontWeight: 400 }}>{g.sku_id}</span></>
                                : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Chưa đặt tên · {g.sku_id}</span>
                              }
                            </span>
                            <span style={{ fontSize: 11, color: '#d1d5db' }}>{g.slot_count} slot</span>
                            <button onClick={() => { setRenaming(g.sku_id); setRenameVal(g.product_name || ''); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                              title="Đổi tên">
                              ✎
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* ── Right: Manual sync ── */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                Đồng bộ thủ công
              </div>

              <form onSubmit={syncAll}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  <input type="date" value={syncStart} onChange={e => setSStart(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12 }} />
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>→</span>
                  <input type="date" value={syncEnd} onChange={e => setSEnd(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12 }} />
                </div>
                <button type="submit" disabled={syncing || !tuyen.length || isSyncing}
                  style={{
                    width: '100%', padding: '8px 0', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 6,
                    cursor: (!syncing && tuyen.length && !isSyncing) ? 'pointer' : 'not-allowed',
                    background: (!syncing && tuyen.length && !isSyncing) ? '#2563eb' : '#e5e7eb',
                    color:      (!syncing && tuyen.length && !isSyncing) ? '#fff'    : '#9ca3af',
                  }}>
                  {isSyncing
                    ? `Đang đồng bộ… (${jobsDone}/${syncJobs.length})`
                    : `Đồng bộ ${tuyen.length} tuyến`
                  }
                </button>
              </form>

              {/* Progress */}
              {syncJobs.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                    <div style={{
                      height: '100%', borderRadius: 2, transition: 'width .4s',
                      width: `${Math.round((jobsDone + jobsFailed) / syncJobs.length * 100)}%`,
                      background: jobsFailed > 0 ? '#f59e0b' : '#2563eb',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, display: 'flex', gap: 10 }}>
                    {jobsDone    > 0 && <span style={{ color: '#16a34a' }}>✓ {jobsDone} xong</span>}
                    {jobsRunning > 0 && <span style={{ color: '#2563eb' }}>⟳ {jobsRunning} đang chạy</span>}
                    {jobsFailed  > 0 && <span style={{ color: '#dc2626' }}>✗ {jobsFailed} lỗi</span>}
                  </div>
                  {!jobsRunning && jobsDone + jobsFailed === syncJobs.length && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ Đồng bộ hoàn tất</div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 14, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 11, color: '#6b7280', lineHeight: 1.7 }}>
                <strong style={{ color: '#374151' }}>Tự động:</strong> Extension đồng bộ ngay khi bạn mở Klook Merchant.<br />
                <strong style={{ color: '#374151' }}>Thủ công:</strong> Dùng khi cần làm mới dữ liệu ngay lập tức.
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
