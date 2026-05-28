import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f3f4f6' };
const td = { padding: '10px 12px', verticalAlign: 'middle', fontSize: 14 };

const today = () => new Date().toISOString().slice(0, 10);
const nextMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

export default function Klook() {
  const [slots,      setSlots]      = useState([]);
  const [knownSkus,  setKnownSkus]  = useState([]);
  const [syncForm,   setSyncForm]   = useState({ sku_id: '', activity_id: '', start_date: today(), end_date: nextMonth() });
  const [filterSku,  setFilterSku]  = useState('');
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [actionMsg,  setActionMsg]  = useState({});

  const reload = useCallback(async (skuId) => {
    const qs = skuId ? `?sku_id=${encodeURIComponent(skuId)}` : '';
    const res = await fetch(`${API}/api/klook/calendar${qs}`);
    if (res.ok) setSlots(await res.json());
  }, []);

  const loadSkus = useCallback(async () => {
    const res = await fetch(`${API}/api/klook/skus`);
    if (res.ok) setKnownSkus(await res.json());
  }, []);

  useEffect(() => {
    loadSkus();
    reload(filterSku);
  }, [loadSkus, reload, filterSku]);

  function selectSku(sku) {
    setSyncForm(f => ({ ...f, sku_id: sku.sku_id, activity_id: sku.activity_id || '' }));
    setFilterSku(sku.sku_id);
  }

  async function handleSync(e) {
    e.preventDefault();
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API}/api/klook/sync-calendar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(syncForm),
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error);
      setSyncResult({ type: 'ok', message: `Sync job #${job.id} queued — extension will process it shortly.` });
      setFilterSku(String(syncForm.sku_id));
      setTimeout(() => { reload(String(syncForm.sku_id)); loadSkus(); }, 5000);
    } catch (err) {
      setSyncResult({ type: 'error', message: err.message });
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
        reload(filterSku);
      }, 4000);
    } catch (err) {
      setActionMsg(m => ({ ...m, [slot.id]: `Error: ${err.message}` }));
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Klook Calendar</h2>

      {/* Known SKU chips */}
      {knownSkus.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>KNOWN SKUs</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {knownSkus.map(sku => (
              <button
                key={sku.sku_id}
                onClick={() => selectSku(sku)}
                style={{
                  padding: '5px 14px',
                  border: filterSku === sku.sku_id ? '2px solid #d97706' : '1px solid #fde68a',
                  borderRadius: 20,
                  background: filterSku === sku.sku_id ? '#fef3c7' : '#fffbeb',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: filterSku === sku.sku_id ? 600 : 400,
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{sku.sku_id}</span>
                <span style={{ fontSize: 11, color: '#b45309', background: '#fde68a', borderRadius: 10, padding: '1px 6px' }}>
                  {sku.slot_count} slots
                </span>
              </button>
            ))}
            {filterSku && (
              <button
                onClick={() => { setFilterSku(''); setSyncForm(f => ({ ...f, sku_id: '', activity_id: '' })); }}
                style={{ padding: '5px 12px', border: '1px solid #e5e7eb', borderRadius: 20,
                         background: '#fff', cursor: 'pointer', fontSize: 12, color: '#6b7280' }}
              >
                × Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sync form */}
      <form
        onSubmit={handleSync}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap',
                 marginBottom: 24, background: '#fefce8', padding: 16, borderRadius: 8,
                 border: '1px solid #fde68a' }}
      >
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>SYNC KLOOK CALENDAR</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              required placeholder="SKU ID"
              value={syncForm.sku_id}
              onChange={e => setSyncForm(f => ({ ...f, sku_id: e.target.value }))}
              style={{ width: 130, padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
            />
            <input
              placeholder="Activity ID (optional)"
              value={syncForm.activity_id}
              onChange={e => setSyncForm(f => ({ ...f, activity_id: e.target.value }))}
              style={{ width: 160, padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
            />
            <input
              type="date" value={syncForm.start_date}
              onChange={e => setSyncForm(f => ({ ...f, start_date: e.target.value }))}
              style={{ padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
            />
            <span style={{ color: '#6b7280' }}>→</span>
            <input
              type="date" value={syncForm.end_date}
              onChange={e => setSyncForm(f => ({ ...f, end_date: e.target.value }))}
              style={{ padding: '7px 10px', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 13 }}
            />
            <button
              type="submit" disabled={syncing}
              style={{ padding: '7px 18px', background: '#d97706', color: '#fff',
                       border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {syncing ? 'Queuing…' : 'Sync Calendar'}
            </button>
          </div>
        </div>
        {syncResult && (
          <p style={{ width: '100%', margin: 0, fontSize: 13,
                      color: syncResult.type === 'ok' ? '#92400e' : '#dc2626' }}>
            {syncResult.message}
          </p>
        )}
      </form>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Filter by SKU:</span>
        <input
          placeholder="SKU ID (blank = all)"
          value={filterSku}
          onChange={e => setFilterSku(e.target.value)}
          style={{ width: 160, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
        />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{slots.length} timeslot{slots.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Calendar table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Start Time</th>
            <th style={th}>SKU</th>
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
              <tr key={slot.id} style={{ borderBottom: '1px solid #e5e7eb', background: published ? '#fff' : '#f9fafb' }}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <strong>{meta.start_time || '—'}</strong>
                </td>
                <td style={{ ...td, color: '#6b7280', fontSize: 12 }}>{meta.sku_id || '—'}</td>
                <td style={td}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px', borderRadius: 12,
                    fontSize: 12, fontWeight: 600,
                    background: published ? '#dcfce7' : '#f3f4f6',
                    color: published ? '#16a34a' : '#6b7280',
                  }}>
                    {published ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={td}>{meta.inv_quantity ?? '—'}</td>
                <td style={td}>{meta.sales ?? '—'}</td>
                <td style={{ ...td, fontSize: 13 }}>
                  {retail ? retail.toLocaleString() : '—'}
                </td>
                <td style={td}>
                  {actionMsg[slot.id] ? (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{actionMsg[slot.id]}</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!published && (
                        <button
                          onClick={() => handleToggle(slot, true)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#dcfce7',
                                   color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Activate
                        </button>
                      )}
                      {published && (
                        <button
                          onClick={() => handleToggle(slot, false)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#fef2f2',
                                   color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {slots.length === 0 && (
            <tr>
              <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                {knownSkus.length > 0
                  ? 'Click a SKU chip above to load its calendar.'
                  : 'No calendar data yet — enter a SKU ID and click Sync Calendar.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
