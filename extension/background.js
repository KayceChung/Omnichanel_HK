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
  if (msg.type === 'klookSkuDetected') {
    chrome.storage.local.get('klookSkus', data => {
      const skus = data.klookSkus || [];
      if (!skus.some(s => s.sku_id === msg.sku_id)) {
        skus.unshift({ sku_id: msg.sku_id, activity_id: msg.activity_id, detected_at: Date.now() });
        if (skus.length > 20) skus.length = 20;
        chrome.storage.local.set({ klookSkus: skus });
      }
    });
    return false;
  }
  if (msg.type === 'syncKlookSku') {
    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);
    fetch(`${API_URL}/api/klook/sync-calendar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sku_id: msg.sku_id, activity_id: msg.activity_id || '', start_date: today, end_date: end }),
    })
      .then(r => r.ok ? sendResponse({ ok: true }) : r.json().then(j => sendResponse({ ok: false, error: j.error })))
      .catch(err => sendResponse({ ok: false, error: err.message }));
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
    } else if (job.type === 'klook_sync_calendar') {
      result = await executeKlookSyncCalendar(job.payload);
    } else if (job.type === 'klook_update_schedule') {
      result = await executeKlookUpdateSchedule(job.payload);
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

// ── Klook jobs ────────────────────────────────────────────────────────────────

const KLOOK_BASE = 'https://merchant.klook.com';
const KLOOK_HEADERS = {
  'Accept':             'application/json, text/plain, */*',
  'Content-Type':       'application/json;charset=UTF-8',
  'x-klook-admin-host': 'global',
  'x-platform':         'desktop',
  'x-req-client':       'experiencesmerchant',
  'version':            '3',
};

async function klookFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers:     { ...KLOOK_HEADERS, ...(options.headers || {}) },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Klook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(`Klook API error: ${json.error?.message || 'unknown'}`);
  return json;
}

async function executeKlookSyncCalendar({ sku_id, activity_id, start_date, end_date }) {
  const start = `${start_date} 00:00:00`;
  const end   = `${end_date} 23:59:59`;
  const url   = `${KLOOK_BASE}/v1/productadminbffsrv/merchant/calendar_service/get_calendar_by_sku_id?sku_id=${sku_id}&start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`;

  const json     = await klookFetch(url);
  const calendar = (json.result?.calendar ?? []).map(slot => ({
    start_time:     slot.start_time,
    published:      slot.published,
    inv_quantity:   slot.inv_quantity,
    sales:          slot.sales,
    publish_status: slot.publish_status,
    price:          slot.price,
    cut_off_time:   slot.cut_off_time,
    is_empty:       slot.is_empty,
  }));

  const importRes = await fetch(`${API_URL}/api/klook/import-calendar`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sku_id, activity_id, calendar }),
  });
  if (!importRes.ok) throw new Error(`Import failed: ${importRes.status}`);
  return await importRes.json();
}

async function executeKlookUpdateSchedule({ sku_id, start_time, published, inv_quantity, price, cut_off_time }) {
  const body = {
    sku_id,
    start_time,
    published:    published ?? true,
    inv_quantity: inv_quantity ?? 0,
    cut_off_time: cut_off_time ?? 147600,
  };
  if (price) body.price = price;

  const json = await klookFetch(
    `${KLOOK_BASE}/v1/productadminbffsrv/merchant/calendar_service/creates_or_update_single_schedule`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  return { success: json.success };
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
