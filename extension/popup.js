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
