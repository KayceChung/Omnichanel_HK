import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const STATUS_COLOR = {
  done:    '#16a34a',
  running: '#2563eb',
  pending: '#ca8a04',
  failed:  '#dc2626',
};

const th = { padding: '10px 12px', fontWeight: 600, fontSize: 13, textAlign: 'left', background: '#f3f4f6' };
const td = { padding: '10px 12px', verticalAlign: 'top', fontSize: 14 };

export default function Jobs() {
  const [jobs, setJobs] = useState([]);

  const reload = useCallback(async () => {
    const res = await fetch(`${API}/api/jobs`);
    setJobs(await res.json());
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Job Queue</h2>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Auto-refreshes every 5 s</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Type</th>
            <th style={th}>Platform</th>
            <th style={th}>Product</th>
            <th style={th}>Status</th>
            <th style={th}>Error</th>
            <th style={th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ ...td, color: '#9ca3af' }}>{job.id}</td>
              <td style={td}><code style={{ fontSize: 12, background: '#f3f4f6', padding: '2px 6px', borderRadius: 3 }}>{job.type}</code></td>
              <td style={td}>{job.platform_display_name}</td>
              <td style={td}>{job.product_title}</td>
              <td style={td}>
                <span style={{ color: STATUS_COLOR[job.status] || '#6b7280', fontWeight: 600 }}>
                  {job.status}
                </span>
              </td>
              <td style={td}>
                {job.error && <span style={{ color: '#dc2626', fontSize: 12 }}>{job.error}</span>}
              </td>
              <td style={{ ...td, color: '#9ca3af', fontSize: 12, whiteSpace: 'nowrap' }}>
                {new Date(job.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
          {jobs.length === 0 && (
            <tr>
              <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No jobs yet. Push a product to a platform to create one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
