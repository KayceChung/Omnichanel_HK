const API_URL    = 'https://omnichanelhk-production.up.railway.app';
const SEATOS_BASE = 'https://hkbuslineandopentour.seatos.com';

// Poll jobs every 1 min; auto-sync SeatOS trips every 60 min
chrome.alarms.create('poll',     { periodInMinutes: 1  });
chrome.alarms.create('autoSync', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll')     pollJobs();
  if (alarm.name === 'autoSync') autoSyncToday();
});

// Delay first run so service worker network stack is ready
chrome.runtime.onInstalled.addListener(() => setTimeout(() => { pollJobs(); autoSyncToday(); }, 3000));
chrome.runtime.onStartup.addListener(()   => setTimeout(() => { pollJobs(); autoSyncToday(); }, 3000));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'poll') {
    pollJobs().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'syncToday') {
    autoSyncToday()
      .then(result => sendResponse({ ok: true, result }))
      .catch(err   => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'syncRange') {
    syncSeatosTrips(msg.start_date, msg.end_date)
      .then(result => sendResponse({ ok: true, result }))
      .catch(err   => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── Job queue (dashboard-initiated) ──────────────────────────────────────────

async function pollJobs() {
  try {
    const res = await fetch(`${API_URL}/api/jobs/pending`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const jobs = await res.json();
    await chrome.storage.local.set({ lastPoll: Date.now() });
    for (const job of jobs) await executeJob(job);
  } catch (err) {
    // Silently ignore network errors (Railway wake-up delay, offline, etc.)
    console.warn('[OmniChannel] Poll skipped:', err.message);
  }
}

async function executeJob(job) {
  const claimRes = await fetch(`${API_URL}/api/jobs/${job.id}/claim`, { method: 'POST' });
  if (!claimRes.ok) return;

  try {
    let result, external_id;
    if (job.type === 'sync_trips') {
      const { start_date, end_date } = job.payload;
      result = await syncSeatosTrips(start_date, end_date);
    } else {
      ({ result, external_id } = await executePlatformPush(job));
    }
    await reportComplete(job.id, { result, external_id: external_id || null });
    const { jobsProcessed = 0 } = await chrome.storage.local.get('jobsProcessed');
    await chrome.storage.local.set({ jobsProcessed: jobsProcessed + 1 });
  } catch (err) {
    await reportComplete(job.id, { error: err.message });
  }
}

// ── SeatOS auto-sync ──────────────────────────────────────────────────────────

async function autoSyncToday() {
  const today = new Date().toISOString().slice(0, 10);
  return syncSeatosTrips(today, today);
}

async function syncSeatosTrips(startDate, endDate) {
  const jwt = await getSeatosJwt();

  const url = `${SEATOS_BASE}/v3/trips?start_date=${startDate}&end_date=${endDate}&page=1&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Accept:        'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SeatOS HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const trips = json.data ?? json;

  const importRes = await fetch(`${API_URL}/api/seatos/import`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ trips }),
  });

  if (!importRes.ok) {
    const text = await importRes.text();
    throw new Error(`Import failed: ${text.slice(0, 200)}`);
  }

  const result = await importRes.json();
  await chrome.storage.local.set({ lastAutoSync: Date.now(), lastSyncResult: result });
  return result;
}

// ── OTA platform push ─────────────────────────────────────────────────────────

async function executePlatformPush(job) {
  const request  = buildRequest(job.platform_name, job.payload);
  const response = await fetch(request.url, {
    method:      request.method,
    headers:     request.headers,
    body:        JSON.stringify(request.body),
    credentials: 'include',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const result      = await response.json();
  const external_id = extractExternalId(job.platform_name, result);
  return { result, external_id };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSeatosJwt() {
  try {
    const cookie = await chrome.cookies.get({
      url:  'https://hkbuslineandopentour.seatos.com',
      name: 'jwt_token',
    });
    if (cookie?.value) {
      await chrome.storage.local.set({ seatosJwt: cookie.value, seatosJwtSource: 'auto' });
      return cookie.value;
    }
  } catch (_) {}

  const data = await chrome.storage.local.get('seatosJwt');
  if (!data.seatosJwt) throw new Error('SeatOS JWT not found. Log in to SeatOS or paste token in the extension popup.');
  return data.seatosJwt;
}

async function reportComplete(jobId, body) {
  await fetch(`${API_URL}/api/jobs/${jobId}/complete`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

function buildRequest(platform, product) {
  switch (platform) {
    case 'klook':
      return {
        method: 'POST',
        url:    'https://supply.klook.com/api/v1/activities',
        headers: { 'Content-Type': 'application/json' },
        body: { title: product.title, description: product.description, base_price: product.base_price, currency: product.currency },
      };
    case '12go':
      return {
        method: 'POST',
        url:    'https://api.12go.asia/partner/v1/products',
        headers: { 'Content-Type': 'application/json' },
        body: { name: product.title, description: product.description, price: product.base_price, currency: product.currency },
      };
    case 'tripcom':
      return {
        method: 'POST',
        url:    'https://supply.trip.com/restapi/soa2/18437/createProduct',
        headers: { 'Content-Type': 'application/json' },
        body: { productName: product.title, productDescription: product.description, salePrice: product.base_price, currency: product.currency },
      };
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

function extractExternalId(platform, response) {
  switch (platform) {
    case 'klook':   return response?.data?.activity_id ?? response?.activity_id ?? null;
    case '12go':    return response?.product_id        ?? response?.id          ?? null;
    case 'tripcom': return response?.data?.productId   ?? response?.productId   ?? null;
    default:        return null;
  }
}
