import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f3f4f6', whiteSpace: 'nowrap' };
const td = { padding: '10px 12px', verticalAlign: 'middle', fontSize: 13 };

const today = () => new Date().toISOString().slice(0, 10);
const nextMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

export default function Klook() {
  const [activities,  setActivities]  = useState([]);
  const [newActId,    setNewActId]    = useState('');
  const [newActName,  setNewActName]  = useState('');
  const [addMsg,      setAddMsg]      = useState('');

  const [slots,       setSlots]       = useState([]);
  const [knownSkus,   setKnownSkus]   = useState([]);
  const [activeSku,   setActiveSku]   = useState(null);

  const [syncStart,   setSyncStart]   = useState(today());
  const [syncEnd,     setSyncEnd]     = useState(nextMonth());
  const [syncing,     setSyncing]     = useState(false);
  const [syncAllMsg,  setSyncAllMsg]  = useState(null);
  const [syncSkuMsg,  setSyncSkuMsg]  = useState(null);

  const [actionMsg,   setActionMsg]   = useState({});

  const reloadActivities = useCallback(async () => {
    const res = await fetch(`${API}/api/klook/activities`);
    if (res.ok) setActivities(await res.json());
  }, []);

  const reloadSkus = useCallback(async () => {
    const res = await fetch(`${API}/api/klook/skus`);
    if (res.ok) setKnownSkus(await res.json());
  }, []);

  const reloadSlots = useCallback(async (skuId) => {
    if (!skuId) { setSlots([]); return; }
    const res = await fetch(`${API}/api/klook/calendar?sku_id=${encodeURIComponent(skuId)}`);
    if (res.ok) setSlots(await res.json());
  }, []);

  useEffect(() => { reloadActivities(); reloadSkus(); }, [reloadActivities, reloadSkus]);

  async function handleAddActivity(e) {
    e.preventDefault();
    if (!newActId.trim()) return;
    const res = await fetch(`${API}/api/klook/activities`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ activity_id: newActId.trim(), name: newActName.trim() || null }),
    });
    if (res.ok) {
      setNewActId(''); setNewActName(''); setAddMsg('');
      reloadActivities();
    } else {
      const d = await res.json();
      setAddMsg(d.error);
    }
  }

  async function handleDeleteActivity(id) {
    await fetch(`${API}/api/klook/activities/${id}`, { method: 'DELETE' });
    reloadActivities();
  }

  async function handleSyncAll(e) {
    e.preventDefault();
    if (!activities.length) { setSyncAllMsg({ ok: false, text: 'Add activity IDs first.' }); return; }
    setSyncing(true);
    setSyncAllMsg(null);
    try {
      const res = await fetch(`${API}/api/klook/sync-all`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ start_date: syncStart, end_date: syncEnd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSyncAllMsg({ ok: true, text: `${data.queued} jobs queued — extension will process all activities.` });
      setTimeout(() => { reloadSkus(); }, 8000);
    } catch (err) {
      setSyncAllMsg({ ok: false, text: err.message });
    } finally {
      setSyncing(false);
    }
  }

  function selectSku(sku) {
    setActiveSku(sku);
    setSyncSkuMsg(null);
    reloadSlots(sku.sku_id);
  }

  async function handleSyncSku(e) {
    e.preventDefault();
    if (!activeSku) return;
    setSyncSkuMsg({ ok: true, text: 'Queueing…' });
    try {
      const res = await fetch(`${API}/api/klook/sync-calendar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sku_id:       activeSku.sku_id,
          activity_id:  activeSku.activity_id || '',
          product_name: activeSku.product_name || null,
          start_date:   syncStart,
          end_date:     syncEnd,
        }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setSyncSkuMsg({ ok: true, text: `Job #${job.id} queued.` });
      setTimeout(() => reloadSlots(activeSku.sku_id), 5000);
    } catch (err) {
      setSyncSkuMsg({ ok: false, text: err.message });
    }
  }

  async function handleToggle(slot, publish) {
    const meta = slot.platform_data || {};
    setActionMsg(m => ({ ...m, [slot.id]: publish ? 'Activating…' : 'Deactivating…' }));
    try {
      const res = await fetch(`${API}/api/klook/update-schedule`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sku_id:       meta.sku_id,
          start_time:   meta.start_time,
          published:    publish,
          inv_quantity: meta.inv_quantity ?? 0,
          price:        meta.price ?? undefined,
          cut_off_time: meta.cut_off_time ?? 147600,
        }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setActionMsg(m => ({ ...m, [slot.id]: `Job #${job.id} queued` }));
      setTimeout(() => {
        setActionMsg(m => { const n = { ...m }; delete n[slot.id]; return n; });
        reloadSlots(activeSku?.sku_id);
      }, 4000);
    } catch (err) {
      setActionMsg(m => ({ ...m, [slot.id]: `Error: ${err.message}` }));
    }
  }

  const activeCount   = slots.filter(s => s.platform_data?.published ?? s.platform_data?.publish_status === 'published').length;
  const inactiveCount = slots.length - activeCount;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: 18 }}>Klook Calendar</h2>

      {/* ── SECTION 1: Activity IDs + Sync All ─────────────────────────── */}
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>

          {/* Left: activity list */}
          <div style={{ flex: '1 1 400px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 10 }}>KLOOK ACTIVITIES</div>

            {/* Add form */}
            <form onSubmit={handleAddActivity} style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                required placeholder="Activity ID (vd: 214640)"
                value={newActId}
                onChange={e => setNewActId(e.target.value)}
                style={{ width: 160, padding: '6px 8px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
              />
              <input
                placeholder="Tên (vd: Hà Nội - Sapa)"
                value={newActName}
                onChange={e => setNewActName(e.target.value)}
                style={{ flex: '1 1 180px', padding: '6px 8px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
              />
              <button type="submit"
                style={{ padding: '6px 14px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + Add
              </button>
              {addMsg && <span style={{ fontSize: 12, color: '#dc2626', alignSelf: 'center' }}>{addMsg}</span>}
            </form>

            {/* Activity chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activities.map(act => (
                <div key={act.id} style={{ display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', background: '#fff', border: '1px solid #fde68a', borderRadius: 6 }}>
                  <span style={{ fontSize: 13, color: '#374151' }}>
                    <strong>{act.activity_id}</strong>
                    {act.name && <span style={{ color: '#6b7280' }}> · {act.name}</span>}
                  </span>
                  <button onClick={() => handleDeleteActivity(act.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>
                    ×
                  </button>
                </div>
              ))}
              {activities.length === 0 && (
                <span style={{ fontSize: 13, color: '#9ca3af' }}>
                  Thêm activity ID từ URL Klook để dùng Sync All
                </span>
              )}
            </div>
          </div>

          {/* Right: Sync All */}
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 10 }}>SYNC ALL ACTIVITIES</div>
            <form onSubmit={handleSyncAll} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={syncStart} onChange={e => setSyncStart(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }} />
              <span style={{ color: '#6b7280' }}>→</span>
              <input type="date" value={syncEnd} onChange={e => setSyncEnd(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }} />
              <button type="submit" disabled={syncing || activities.length === 0}
                style={{ padding: '7px 18px', background: activities.length > 0 ? '#d97706' : '#d1d5db',
                         color: '#fff', border: 'none', borderRadius: 4, cursor: activities.length > 0 ? 'pointer' : 'not-allowed',
                         fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {syncing ? 'Queuing…' : `⟳ Sync All (${activities.length})`}
              </button>
            </form>
            {syncAllMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: syncAllMsg.ok ? '#16a34a' : '#dc2626' }}>
                {syncAllMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 2: SKU Calendar viewer ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
            SELECT SKU {knownSkus.length > 0 && `(${knownSkus.length} synced)`}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {knownSkus.map(sku => {
              const isActive = activeSku?.sku_id === sku.sku_id;
              return (
                <button key={sku.sku_id} onClick={() => selectSku(sku)}
                  style={{ padding: '6px 12px', textAlign: 'left',
                    border: isActive ? '2px solid #d97706' : '1px solid #e5e7eb',
                    borderRadius: 6, background: isActive ? '#fef3c7' : '#fff', cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                    {sku.product_name || sku.sku_id}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {sku.product_name ? sku.sku_id + ' · ' : ''}{sku.slot_count} slots
                  </div>
                </button>
              );
            })}
            {knownSkus.length === 0 && (
              <span style={{ fontSize: 13, color: '#9ca3af' }}>
                Chưa có SKU nào — dùng Sync All ở trên để fetch.
              </span>
            )}
          </div>
        </div>

        {activeSku && (
          <form onSubmit={handleSyncSku} style={{ flex: '0 0 auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Re-sync this SKU:</span>
            <button type="submit"
              style={{ padding: '6px 14px', background: '#2563eb', color: '#fff',
                       border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Sync
            </button>
            {syncSkuMsg && (
              <span style={{ fontSize: 12, color: syncSkuMsg.ok ? '#16a34a' : '#dc2626' }}>{syncSkuMsg.text}</span>
            )}
          </form>
        )}
      </div>

      {/* Summary bar */}
      {activeSku && (
        <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6,
                      fontSize: 13, color: '#374151', marginBottom: 12,
                      display: 'flex', gap: 16, alignItems: 'center' }}>
          <strong>{activeSku.product_name || `SKU ${activeSku.sku_id}`}</strong>
          <span style={{ color: '#6b7280' }}>{activeSku.sku_id}</span>
          <span>{slots.length} slots</span>
          <span style={{ color: '#16a34a' }}>{activeCount} active</span>
          <span style={{ color: '#6b7280' }}>{inactiveCount} inactive</span>
        </div>
      )}

      {/* Calendar table */}
      {!activeSku && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
          {knownSkus.length > 0
            ? 'Select a SKU above to view its calendar.'
            : 'Use "Sync All" to fetch all routes from Klook.'}
        </div>
      )}

      {activeSku && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>Start Time</th>
                <th style={th}>Status</th>
                <th style={th}>Inventory</th>
                <th style={th}>Booked</th>
                <th style={th}>Price (VND)</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map(slot => {
                const meta      = slot.platform_data || {};
                const published = meta.published ?? meta.publish_status === 'published';
                const price     = meta.price;
                const retail    = price?.retail_price ?? price?.retailPrice;
                return (
                  <tr key={slot.id} style={{ borderBottom: '1px solid #e5e7eb', background: published ? '#fff' : '#fafafa', opacity: published ? 1 : 0.75 }}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.start_time || '—'}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                        fontSize: 12, fontWeight: 600,
                        background: published ? '#dcfce7' : '#f3f4f6',
                        color:      published ? '#16a34a' : '#6b7280' }}>
                        {published ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{meta.inv_quantity ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: (meta.sales ?? 0) > 0 ? 600 : 400 }}>{meta.sales ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{retail ? retail.toLocaleString('vi-VN') : '—'}</td>
                    <td style={td}>
                      {actionMsg[slot.id] ? (
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{actionMsg[slot.id]}</span>
                      ) : published ? (
                        <button onClick={() => handleToggle(slot, false)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#fef2f2',
                                   color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}>
                          Deactivate
                        </button>
                      ) : (
                        <button onClick={() => handleToggle(slot, true)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#dcfce7',
                                   color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer' }}>
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {slots.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                    No slots yet — click Sync above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
