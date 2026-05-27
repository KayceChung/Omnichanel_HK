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

chrome.storage.local.get(['lastPoll', 'jobsProcessed', 'seatosJwt'], data => {
  document.getElementById('lastPoll').textContent =
    data.lastPoll ? new Date(data.lastPoll).toLocaleTimeString() : '—';
  document.getElementById('jobCount').textContent = data.jobsProcessed || 0;
  if (data.seatosJwt) {
    document.getElementById('jwtInput').value = data.seatosJwt;
  }
  detectCookie();
});

document.getElementById('pollBtn').addEventListener('click', () => {
  const btn = document.getElementById('pollBtn');
  btn.textContent = 'Polling…';
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'poll' }, () => {
    btn.textContent = 'Poll Jobs Now';
    btn.disabled = false;
    chrome.storage.local.get(['lastPoll', 'jobsProcessed'], data => {
      document.getElementById('lastPoll').textContent =
        data.lastPoll ? new Date(data.lastPoll).toLocaleTimeString() : '—';
      document.getElementById('jobCount').textContent = data.jobsProcessed || 0;
    });
  });
});

document.getElementById('saveJwt').addEventListener('click', () => {
  const token = document.getElementById('jwtInput').value.trim();
  if (!token) { showToast('Token is empty', true); return; }
  chrome.storage.local.set({ seatosJwt: token, seatosJwtSource: 'manual' }, () => {
    showToast('Token saved.');
  });
});

document.getElementById('clearJwt').addEventListener('click', () => {
  document.getElementById('jwtInput').value = '';
  chrome.storage.local.remove(['seatosJwt', 'seatosJwtSource'], () => showToast('Token cleared.'));
});

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => { t.textContent = ''; }, 3000);
}
