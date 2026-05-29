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
  const [slots,      setSlots]      = useState([]);
  const [knownSkus,  setKnownSkus]  = useState([]);
  const [activeSku,  setActiveSku]  = useState(null); // currently selected sku object
  const [skuId,      setSkuId]      = useState('');
  const [startDate,  setStartDate]  = useState(today());
  const [endDate,    setEndDate]    = useState(nextMonth());
  const [syncing,    setSyncing]    = useState(false);
  const [syncMsg,    setSyncMsg]    = useState(null);
  const [actionMsg,  setActionMsg]  = useState({});

  const reloadSkus = useCallback(async () => {
    const res = await fetch(`${API}/api/klook/skus`);
    if (res.ok) setKnownSkus(await res.json());
  }, []);

  const reloadSlots = useCallback(async (sid) => {
    if (!sid) { setSlots([]); return; }
    const res = await fetch(`${API}/api/klook/calendar?sku_id=${encodeURIComponent(sid)}`);
    if (res.ok) setSlots(await res.json());
  }, []);

  useEffect(() => { reloadSkus(); }, [reloadSkus]);

  function selectSku(sku) {
    setActiveSku(sku);
    setSkuId(sku.sku_id);
    setSyncMsg(null);
    reloadSlots(sku.sku_id);
  }

  async function handleSync(e) {
    e.preventDefault();
    if (!skuId) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const productName = activeSku?.product_name || null;
      const res = await fetch(`${API}/api/klook/sync-calendar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sku_id:       skuId,
          activity_id:  activeSku?.activity_id || '',
          product_name: productName,
          start_date:   startDate,
          end_date:     endDate,
        }),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setSyncMsg({ ok: true, text: `Job #${job.id} queued — extension will process shortly.` });
      setTimeout(() => { reloadSlots(skuId); reloadSkus(); }, 5000);
    } catch (err) {
      setSyncMsg({ ok: false, text: err.message });
    } finally {
      setSyncing(false);
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
        reloadSlots(skuId);
      }, 4000);
    } catch (err) {
      setActionMsg(m => ({ ...m, [slot.id]: `Error: ${err.message}` }));
    }
  }

  const activeCount  = slots.filter(s => (s.platform_data?.published ?? s.platform_data?.publish_status === 'published')).length;
  const inactiveCount = slots.length - activeCount;

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Klook Calendar</h2>
        {activeSku && (
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            SKU <strong>{activeSku.sku_id}</strong>
            {activeSku.product_name && <> · {activeSku.product_name}</>}
            {' · '}{slots.length} slots ({activeCount} active, {inactiveCount} inactive)
          </span>
        )}
      </div>

      {/* SKU selector */}
      <div style={{ marginBottom: 20, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 10 }}>
          {knownSkus.length > 0 ? 'SELECT SKU' : 'NO SKUs SYNCED YET'}
        </div>

        {knownSkus.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {knownSkus.map(sku => {
              const isActive = activeSku?.sku_id === sku.sku_id;
              return (
                <button
                  key={sku.sku_id}
                  onClick={() => selectSku(sku)}
                  style={{
                    padding: '6px 14px',
                    border: isActive ? '2px solid #d97706' : '1px solid #fde68a',
                    borderRadius: 6,
                    background: isActive ? '#fef3c7' : '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                    {sku.product_name || `SKU ${sku.sku_id}`}
                  </div>
                  <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                    {sku.sku_id} · {sku.slot_count} slots
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Sync form — only show when a SKU is selected or being entered */}
        <form onSubmit={handleSync} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            required
            placeholder="SKU ID"
            value={skuId}
            onChange={e => { setSkuId(e.target.value); setActiveSku(null); setSlots([]); }}
            style={{ width: 150, padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
          />
          <input
            type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
          />
          <span style={{ color: '#6b7280' }}>→</span>
          <input
            type="date" value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
          />
          <button
            type="submit" disabled={syncing || !skuId}
            style={{ padding: '7px 18px', background: skuId ? '#d97706' : '#d1d5db',
                     color: '#fff', border: 'none', borderRadius: 4,
                     cursor: skuId ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
          >
            {syncing ? 'Queuing…' : 'Sync Calendar'}
          </button>
          {syncMsg && (
            <span style={{ fontSize: 12, color: syncMsg.ok ? '#16a34a' : '#dc2626' }}>
              {syncMsg.text}
            </span>
          )}
        </form>
      </div>

      {/* Calendar table */}
      {!activeSku && knownSkus.length > 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 }}>
          Select a SKU above to view its calendar.
        </div>
      )}

      {(activeSku || slots.length > 0) && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 650 }}>
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
                  <tr key={slot.id} style={{
                    borderBottom: '1px solid #e5e7eb',
                    background: published ? '#fff' : '#fafafa',
                    opacity: published ? 1 : 0.7,
                  }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {meta.start_time || '—'}
                    </td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                        fontSize: 12, fontWeight: 600,
                        background: published ? '#dcfce7' : '#f3f4f6',
                        color:      published ? '#16a34a' : '#6b7280',
                      }}>
                        {published ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{meta.inv_quantity ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: (meta.sales ?? 0) > 0 ? 600 : 400 }}>
                      {meta.sales ?? '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {retail ? retail.toLocaleString('vi-VN') : '—'}
                    </td>
                    <td style={td}>
                      {actionMsg[slot.id] ? (
                        <span style={{ fontSize: 12, color: '#6b7280' }}>{actionMsg[slot.id]}</span>
                      ) : published ? (
                        <button
                          onClick={() => handleToggle(slot, false)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#fef2f2',
                                   color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggle(slot, true)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#dcfce7',
                                   color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {slots.length === 0 && activeSku && (
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                    No slots loaded — click Sync Calendar to fetch from Klook.
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
