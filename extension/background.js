const API_URL    = 'https://omnichanelhk-production.up.railway.app';
const SEATOS_BASE = 'https://hkbuslineandopentour.seatos.com';

// Poll jobs every 1 min; auto-sync SeatOS trips every 60 min
chrome.alarms.create('poll',     { periodInMinutes: 1  });
chrome.alarms.create('autoSync', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll')     pollJobs().catch(e => console.warn('[poll]', e.message));
  if (alarm.name === 'autoSync') autoSyncToday().catch(e => console.warn('[autoSync]', e.message));
});

// Delay first run so service worker network stack is ready
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => {
    pollJobs().catch(e => console.warn('[poll]', e.message));
    autoSyncToday().catch(e => console.warn('[autoSync]', e.message));
  }, 3000);
});
chrome.runtime.onStartup.addListener(() => {
  setTimeout(async () => {
    pollJobs().catch(e => console.warn('[poll]', e.message));
    autoSyncToday().catch(e => console.warn('[autoSync]', e.message));
    const { klookDeviceUuid } = await chrome.storage.local.get('klookDeviceUuid');
    if (klookDeviceUuid) KLOOK_HEADERS['device_uuid'] = klookDeviceUuid;
  }, 3000);
});

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

  // ── Klook auto-extract messages ───────────────────────────────────────────

  // User opened merchant.klook.com → trigger full auto-sync (debounced 5 min)
  if (msg.type === 'klookPageOpened') {
    autoSyncKlook().catch(() => {});
    return false;
  }

  // device_uuid captured from live request header → store + inject into klookFetch
  if (msg.type === 'klookDeviceUuid') {
    chrome.storage.local.set({ klookDeviceUuid: msg.uuid });
    KLOOK_HEADERS['device_uuid'] = msg.uuid;
    return false;
  }

  // Full package list intercepted from get_activity_packages_info_v2 response
  // → immediately fetch calendar for each package we don't yet have
  if (msg.type === 'klookPackagesFull') {
    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(); endDate.setMonth(endDate.getMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);
    for (const pkg of (msg.packages || [])) {
      if (!pkg.sku_id) continue;
      executeKlookSyncCalendar({
        sku_id:       pkg.sku_id,
        activity_id:  msg.activity_id || '',
        start_date:   today,
        end_date:     end,
        product_name: pkg.name || null,
      }).catch(() => {});
    }
    return false;
  }

  // Full calendar intercepted from get_calendar_by_sku_id response
  // → import directly, no extra API call needed
  if (msg.type === 'klookCalendarFull') {
    const { sku_id, activity_id, calendar } = msg;
    // Look up stored product_name for this SKU
    chrome.storage.local.get('klookSkus', data => {
      const entry = (data.klookSkus || []).find(s => String(s.sku_id) === String(sku_id));
      const product_name = entry?.title || null;
      fetch(`${API_URL}/api/klook/import-calendar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sku_id, activity_id, calendar, product_name }),
      }).catch(() => {});
    });
    return false;
  }

  // ── Existing handlers ─────────────────────────────────────────────────────

  if (msg.type === 'klookSkuDetected') {
    chrome.storage.local.get('klookSkus', data => {
      const skus = data.klookSkus || [];
      const existing = skus.find(s => s.sku_id === msg.sku_id);
      if (!existing) {
        skus.unshift({ sku_id: msg.sku_id, activity_id: msg.activity_id, detected_at: Date.now() });
        if (skus.length > 20) skus.length = 20;
      } else if (msg.activity_id && !existing.activity_id) {
        existing.activity_id = msg.activity_id;
      }
      chrome.storage.local.set({ klookSkus: skus });
    });
    return false;
  }
  if (msg.type === 'klookActivitiesFound') {
    fetch(`${API_URL}/api/klook/activities/bulk`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ activities: msg.activities }),
    }).catch(() => {});
    return false;
  }
  if (msg.type === 'klookSkuNamed') {
    chrome.storage.local.get('klookSkus', data => {
      const skus = data.klookSkus || [];
      const existing = skus.find(s => s.sku_id === msg.sku_id);
      if (existing) {
        existing.title = msg.title;
      } else {
        skus.unshift({ sku_id: msg.sku_id, title: msg.title, detected_at: Date.now() });
        if (skus.length > 20) skus.length = 20;
      }
      chrome.storage.local.set({ klookSkus: skus });
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
    } else if (job.type === 'klook_sync_activity') {
      result = await executeKlookSyncActivity(job.payload);
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

// ── Klook full auto-sync ──────────────────────────────────────────────────────
// Called whenever user opens merchant.klook.com (debounced 5 min) and on startup.
// Fetches all stored activities → packages → calendar without any manual trigger.

async function autoSyncKlook() {
  // Debounce: skip if last run was < 5 minutes ago
  const { lastKlookAutoSync } = await chrome.storage.local.get('lastKlookAutoSync');
  if (lastKlookAutoSync && Date.now() - lastKlookAutoSync < 5 * 60 * 1000) return;
  await chrome.storage.local.set({ lastKlookAutoSync: Date.now() });

  // Restore device_uuid into live headers if previously captured
  const { klookDeviceUuid } = await chrome.storage.local.get('klookDeviceUuid');
  if (klookDeviceUuid) KLOOK_HEADERS['device_uuid'] = klookDeviceUuid;

  try {
    // Step 1: proactively pull ALL activities from Klook API (doesn't require manual browsing)
    await tryFetchAllActivities();

    // Step 2: get stored activities (now includes auto-fetched ones above)
    const r = await fetch(`${API_URL}/api/klook/activities`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return;
    const activities = await r.json();
    if (!activities.length) return;

    const today   = new Date().toISOString().slice(0, 10);
    const endDate = new Date(); endDate.setMonth(endDate.getMonth() + 1);
    const end     = endDate.toISOString().slice(0, 10);

    for (const act of activities) {
      try {
        await executeKlookSyncActivity({
          activity_id:   act.activity_id,
          activity_name: act.name,
          start_date:    today,
          end_date:      end,
        });
      } catch (err) {
        console.warn('[Klook] auto-sync activity', act.activity_id, err.message);
      }
    }

    await chrome.storage.local.set({ lastKlookAutoSync: Date.now(), lastKlookSyncResult: { activities: activities.length, ts: Date.now() } });
    console.log('[Klook] Auto-sync complete:', activities.length, 'activities');
  } catch (err) {
    console.warn('[Klook] autoSyncKlook failed:', err.message);
  }
}

async function syncSeatosTrips(startDate, endDate) {
  const jwt = await getSeatosJwt();

  const url = `${SEATOS_BASE}/v3/trips?start_date=${startDate}&end_date=${endDate}&page=1&per_page=100`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept:        'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`SeatOS network error: ${err.message}`);
  }

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

// Recursively collect every object that carries a SKU/unit identifier.
// Klook uses different field names at different API levels:
//   - Calendar & URL level  : sku_id / skuId
//   - Package units level   : unit_id / unitId
// We target both so we capture cabin names regardless of which API was called.
function findAllSkus(obj, depth = 0) {
  const results = [];
  if (depth > 8 || !obj) return results;

  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...findAllSkus(item, depth + 1));
    return results;
  }

  if (typeof obj === 'object') {
    const rawId  = obj.sku_id  ?? obj.skuId  ?? obj.unit_id ?? obj.unitId;
    const rawStr = rawId !== undefined ? String(rawId) : null;
    if (rawStr && /^\d+$/.test(rawStr)) {
      const title =
        obj.title      ?? obj.name        ??
        obj.sku_name   ?? obj.skuName     ??
        obj.unit_name  ?? obj.unitName    ??
        obj.package_name ?? obj.packageName ?? null;
      results.push({ sku_id: rawStr, title: title ? String(title) : null });
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') results.push(...findAllSkus(v, depth + 1));
    }
  }

  return results;
}

// Recursively collect activity_id + name from any Klook API response
function findAllActivities(obj, depth = 0) {
  const results = [];
  if (depth > 6 || !obj) return results;
  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...findAllActivities(item, depth + 1));
    return results;
  }
  if (typeof obj === 'object') {
    const actId = obj.activity_id ?? obj.activityId ?? obj.act_id ?? obj.actId;
    if (actId && /^\d{4,8}$/.test(String(actId))) {
      const name = obj.title ?? obj.name ?? obj.activity_name ?? obj.activityTitle ?? null;
      results.push({ activity_id: String(actId), name: name ? String(name) : null });
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') results.push(...findAllActivities(v, depth + 1));
    }
  }
  return results;
}

// Try common Klook activity-list endpoints to fetch ALL activities in one call.
// Runs on page-open so the user doesn't need to manually browse each activity.
const ACTIVITY_LIST_PATHS = [
  '/v1/productadminbffsrv/merchant/activity_service/get_merchant_activity_list?language=en_US&page=1&page_size=500',
  '/v1/productadminbffsrv/merchant/activity_service/list_activity?language=en_US&page=1&page_size=500',
  '/v1/productadminbffsrv/merchant/activity_service/search_activity?language=en_US&page=1&page_size=500&status=published',
  '/v1/productadminbffsrv/merchant/activity_service/get_activity_list?language=en_US&page=1&page_size=500',
];

async function tryFetchAllActivities() {
  for (const path of ACTIVITY_LIST_PATHS) {
    try {
      const json      = await klookFetch(`${KLOOK_BASE}${path}`);
      const activities = findAllActivities(json);
      if (activities.length > 0) {
        await fetch(`${API_URL}/api/klook/activities/bulk`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activities }),
        });
        console.log('[Klook] Auto-fetched', activities.length, 'activities via', path);
        return activities.length;
      }
    } catch (e) {
      // endpoint not found — try next
    }
  }
  return 0;
}

async function executeKlookSyncActivity({ activity_id, activity_name, start_date, end_date }) {
  const url = `${KLOOK_BASE}/v1/productadminbffsrv/merchant/package_service/get_activity_packages_info_v2?activity_id=${activity_id}&language=en_US&page_from=merchant`;
  const json = await klookFetch(url);

  // Always save raw response for inspection
  fetch(`${API_URL}/api/klook/debug-packages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ activity_id, activity_name, response: json }),
  }).catch(() => {});

  // Recursively find all SKU-level entries (sku_id field present at any depth)
  const rawSkus = findAllSkus(json);

  // Deduplicate: keep first title found per sku_id
  const skuMap = {};
  for (const s of rawSkus) {
    if (!skuMap[s.sku_id]) skuMap[s.sku_id] = s;
    else if (!skuMap[s.sku_id].title && s.title) skuMap[s.sku_id].title = s.title;
  }
  const skus = Object.values(skuMap);

  if (skus.length === 0) {
    console.warn(`[Klook] No SKUs found for activity ${activity_id} — check /api/klook/debug-packages`);
    return { activity_id, skus_found: 0, synced: 0, error: 'No SKUs found' };
  }

  console.log(`[Klook] Activity ${activity_id}: found ${skus.length} SKUs →`, skus.map(s => `${s.sku_id}(${s.title || '?'})`).join(', '));

  const results = [];
  for (const { sku_id, title } of skus) {
    try {
      const r = await executeKlookSyncCalendar({
        sku_id,
        activity_id: String(activity_id || ''),
        start_date,
        end_date,
        product_name: title ?? activity_name ?? null,
      });
      results.push({ sku_id, title, ok: true, ...r });
    } catch (err) {
      results.push({ sku_id, title, ok: false, error: err.message });
    }
  }
  return { activity_id, skus_found: skus.length, synced: results.filter(r => r.ok).length, results };
}

async function executeKlookSyncCalendar({ sku_id, activity_id, start_date, end_date, product_name: providedName }) {
  // Auto-fill product name from locally stored SKU names if not provided
  const storedName = await new Promise(resolve => {
    chrome.storage.local.get('klookSkus', data => {
      const entry = (data.klookSkus || []).find(s => String(s.sku_id) === String(sku_id));
      resolve(entry?.title || null);
    });
  });
  const product_name = providedName || storedName || null;
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
    body:    JSON.stringify({ sku_id, activity_id, calendar, product_name: product_name || null }),
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
