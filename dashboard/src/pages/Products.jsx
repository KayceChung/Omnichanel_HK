import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const STATUS_COLOR = {
  live:    '#16a34a',
  pending: '#ca8a04',
  error:   '#dc2626',
  draft:   '#6b7280',
  active:  '#16a34a',
  inactive:'#6b7280',
};

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f3f4f6' };
const td = { padding: '10px 12px', verticalAlign: 'top', fontSize: 14 };

export default function Products() {
  const [products,  setProducts]  = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [form,      setForm]      = useState({ title: '', description: '', base_price: '', currency: 'USD' });
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');

  const reload = useCallback(async () => {
    const [pRes, plRes] = await Promise.all([
      fetch(`${API}/api/products`),
      fetch(`${API}/api/platforms`),
    ]);
    setProducts(await pRes.json());
    setPlatforms(await plRes.json());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(`${API}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, base_price: parseFloat(form.base_price) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setForm({ title: '', description: '', base_price: '', currency: 'USD' });
      await reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePush(productId, platformId) {
    const res = await fetch(`${API}/api/products/${productId}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform_id: platformId }),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    await reload();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this product and all its listings?')) return;
    await fetch(`${API}/api/products/${id}`, { method: 'DELETE' });
    await reload();
  }

  return (
    <div>
      {/* Add form */}
      <form
        onSubmit={handleAdd}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28,
                 background: '#f9fafb', padding: 16, borderRadius: 8, border: '1px solid #e5e7eb' }}
      >
        <input
          required placeholder="Product title"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          style={{ flex: '2 1 220px', padding: 8, border: '1px solid #d1d5db', borderRadius: 4 }}
        />
        <input
          placeholder="Description"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          style={{ flex: '3 1 280px', padding: 8, border: '1px solid #d1d5db', borderRadius: 4 }}
        />
        <input
          required type="number" min="0" step="0.01" placeholder="Price"
          value={form.base_price}
          onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))}
          style={{ flex: '1 1 100px', padding: 8, border: '1px solid #d1d5db', borderRadius: 4 }}
        />
        <select
          value={form.currency}
          onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
          style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 4 }}
        >
          <option>USD</option>
          <option>THB</option>
          <option>SGD</option>
          <option>EUR</option>
          <option>CNY</option>
        </select>
        <button
          type="submit" disabled={saving}
          style={{ padding: '8px 20px', background: '#2563eb', color: '#fff',
                   border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >
          {saving ? 'Adding…' : '+ Add Product'}
        </button>
        {formError && <p style={{ color: '#dc2626', width: '100%', margin: 0, fontSize: 13 }}>{formError}</p>}
      </form>

      {/* Product table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Product</th>
            <th style={th}>Price</th>
            {platforms.map(p => <th key={p.id} style={th}>{p.display_name}</th>)}
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {products.map(product => {
            const byPlatform = {};
            (product.listings || []).forEach(l => { byPlatform[l.platform_id] = l; });

            return (
              <tr key={product.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>
                  <strong>{product.title}</strong>
                  {product.description && (
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{product.description}</div>
                  )}
                </td>
                <td style={td} nowrap="true">{product.currency} {Number(product.base_price).toFixed(2)}</td>

                {platforms.map(p => {
                  const listing = byPlatform[p.id];
                  return (
                    <td key={p.id} style={td}>
                      {listing ? (
                        <div>
                          <span style={{ color: STATUS_COLOR[listing.status] || '#6b7280', fontSize: 12, fontWeight: 600 }}>
                            {listing.status}
                          </span>
                          {listing.external_id && (
                            <div style={{ fontSize: 11, color: '#9ca3af' }}>#{listing.external_id}</div>
                          )}
                          {listing.last_synced_at && (
                            <div style={{ fontSize: 11, color: '#9ca3af' }}>
                              {new Date(listing.last_synced_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => handlePush(product.id, p.id)}
                          style={{ padding: '4px 12px', fontSize: 12, background: '#2563eb',
                                   color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Push
                        </button>
                      )}
                    </td>
                  );
                })}

                <td style={td}>
                  <button
                    onClick={() => handleDelete(product.id)}
                    style={{ padding: '4px 10px', fontSize: 12, background: '#fef2f2',
                             color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
          {products.length === 0 && (
            <tr>
              <td colSpan={3 + platforms.length} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No products yet — add one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
