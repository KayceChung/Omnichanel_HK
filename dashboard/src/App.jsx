import { useState } from 'react';
import Products from './pages/Products.jsx';
import SeatOS from './pages/SeatOS.jsx';
import Klook from './pages/Klook.jsx';
import Jobs from './pages/Jobs.jsx';

const NAV = [
  { key: 'products', label: 'Products' },
  { key: 'seatos',   label: 'SeatOS' },
  { key: 'klook',    label: 'Klook' },
  { key: 'jobs',     label: 'Jobs' },
];

export default function App() {
  const [tab, setTab] = useState('seatos');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>OmniChannel</h1>
        <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 14 }}>OTA Inventory Management</p>
        <nav style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e5e7eb', paddingBottom: 0 }}>
          {NAV.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '8px 18px',
                border: 'none',
                borderBottom: tab === key ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: -2,
                background: 'none',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: tab === key ? 600 : 400,
                color: tab === key ? '#2563eb' : '#374151',
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'products' && <Products />}
      {tab === 'seatos'   && <SeatOS />}
      {tab === 'klook'    && <Klook />}
      {tab === 'jobs'     && <Jobs />}
    </div>
  );
}
