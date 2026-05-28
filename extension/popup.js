function detectCookie() {
  chrome.cookies.get(
    { url: 'https://hkbuslineandopentour.seatos.com', name: 'jwt_token' },
    cookie => {
      if (cookie?.value) {
        document.getElementById('jwtSource').textContent = 'Auto (SeatOS session active)';
        document.getElementById('jwtSource').style.color = '#16a34a';
      } else {
        document.getElementById('jwtSource').textContent = 'Manual (log in to SeatOS first)';
        document.getElementById('jwtSource').style.color = '#ca8a04';
      }
    }
  );
}

function loadKlookSkus() {
  chrome.storage.local.get('klookSkus', data => {
    const skus = data.klookSkus || [];
    const title     = document.getElementById('klookTitle');
    const container = document.getElementById('klookSkus');
    if (!skus.length) { title.style.display = 'none'; container.innerHTML = ''; return; }
    title.style.display = '';
    container.innerHTML = skus.map(sku => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="flex:1;font-size:12px;font-family:monospace;background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sku.sku_id}</span>
        <button class="btn btn-secondary sync-klook-btn" data-sku="${sku.sku_id}" data-activity="${sku.activity_id || ''}" style="flex:0 0 auto;padding:4px 10px;font-size:11px">Sync</button>
      </div>
    `).join('');
    container.querySelectorAll('.sync-klook-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.textContent = '…';
        btn.disabled = true;
        chrome.runtime.sendMessage({ type: 'syncKlookSku', sku_id: btn.dataset.sku, activity_id: btn.dataset.activity }, res => {
          btn.textContent = res?.ok ? 'Queued!' : 'Error';
          setTimeout(() => { btn.textContent = 'Sync'; btn.disabled = false; }, 3000);
        });
      });
    });
  });
}

function loadState() {
  chrome.storage.local.get(['lastPoll', 'jobsProcessed', 'seatosJwt', 'lastAutoSync', 'lastSyncResult'], data => {
    document.getElementById('lastPoll').textContent =
      data.lastPoll ? new Date(data.lastPoll).toLocaleTimeString() : '—';
    document.getElementById('jobCount').textContent = data.jobsProcessed || 0;
    document.getElementById('lastSync').textContent =
      data.lastAutoSync ? new Date(data.lastAutoSync).toLocaleTimeString() : '—';
    if (data.lastSyncResult) {
      const r = data.lastSyncResult;
      document.getElementById('syncSummary').textContent =
        `+${r.created} created, ${r.updated} updated${r.errors?.length ? `, ${r.errors.length} errors` : ''}`;
    }
    if (data.seatosJwt) {
      document.getElementById('jwtInput').value = data.seatosJwt;
    }
    detectCookie();
  });
}

loadState();
loadKlookSkus();

// Poll jobs now
document.getElementById('pollBtn').addEventListener('click', () => {
  const btn = document.getElementById('pollBtn');
  btn.textContent = 'Polling…';
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'poll' }, () => {
    btn.textContent = 'Poll Jobs Now';
    btn.disabled = false;
    loadState();
  });
});

// Sync today's SeatOS trips
document.getElementById('syncBtn').addEventListener('click', () => {
  const btn = document.getElementById('syncBtn');
  btn.textContent = 'Syncing…';
  btn.disabled = true;
  showToast('');
  chrome.runtime.sendMessage({ type: 'syncToday' }, res => {
    btn.textContent = 'Sync Today\'s Trips';
    btn.disabled = false;
    if (res?.ok) {
      showToast(`Done: +${res.result?.created ?? 0} created, ${res.result?.updated ?? 0} updated`);
    } else {
      showToast(res?.error || 'Sync failed', true);
    }
    loadState();
  });
});

// Save JWT manually
document.getElementById('saveJwt').addEventListener('click', () => {
  const token = document.getElementById('jwtInput').value.trim();
  if (!token) { showToast('Token is empty', true); return; }
  chrome.storage.local.set({ seatosJwt: token, seatosJwtSource: 'manual' }, () => {
    showToast('Token saved.');
  });
});

// Clear JWT
document.getElementById('clearJwt').addEventListener('click', () => {
  document.getElementById('jwtInput').value = '';
  chrome.storage.local.remove(['seatosJwt', 'seatosJwtSource'], () => showToast('Token cleared.'));
});

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  if (msg) setTimeout(() => { t.textContent = ''; }, 4000);
}
