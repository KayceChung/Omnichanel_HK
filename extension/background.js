// Replace with your Railway URL before loading the extension.
const API_URL = 'https://omnichanelhk-production.up.railway.app';
const SEATOS_BASE = 'https://hkbuslineandopentour.seatos.com';

chrome.alarms.create('poll', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'poll') pollJobs(); });
chrome.runtime.onInstalled.addListener(pollJobs);
chrome.runtime.onStartup.addListener(pollJobs);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'poll') { pollJobs().then(() => sendResponse({ ok: true })); return true; }
});

async function pollJobs() {
  try {
    const res  = await fetch(`${API_URL}/api/jobs/pending`);
    const jobs = await res.json();
    await chrome.storage.local.set({ lastPoll: Date.now() });
    for (const job of jobs) await executeJob(job);
  } catch (err) {
    console.error('[OmniChannel] Poll error:', err);
  }
}

async function executeJob(job) {
  const claimRes = await fetch(`${API_URL}/api/jobs/${job.id}/claim`, { method: 'POST' });
  if (!claimRes.ok) return;

  try {
    let result, external_id;

    if (job.type === 'sync_trips') {
      ({ result, external_id } = await executeSeatosSync(job));
    } else {
      ({ result, external_id } = await executePlatformPush(job));
    }

    await reportComplete(job.id, { result, external_id });

    const { jobsProcessed = 0 } = await chrome.storage.local.get('jobsProcessed');
    await chrome.storage.local.set({ jobsProcessed: jobsProcessed + 1 });
  } catch (err) {
    await reportComplete(job.id, { error: err.message });
  }
}

// ── SeatOS trip sync ──────────────────────────────────────────────────────────

async function executeSeatosSync(job) {
  const { start_date, end_date } = job.payload;
  const jwt = await getSeatosJwt();

  const url = `${SEATOS_BASE}/v3/trips?start_date=${start_date}&end_date=${end_date}&page=1&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Accept:        'application/json',
      Authorization: `Bearer ${jwt}`,
      Cookie:        `jwt_token=${jwt}`,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SeatOS HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const { data: trips } = await res.json();

  // POST trips back to Railway for import
  const importRes = await fetch(`${API_URL}/api/seatos/import`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ trips }),
  });

  if (!importRes.ok) {
    const text = await importRes.text();
    throw new Error(`Import failed: ${text.slice(0, 200)}`);
  }

  const importResult = await importRes.json();
  return { result: importResult, external_id: null };
}

// ── OTA platform push ─────────────────────────────────────────────────────────

async function executePlatformPush(job) {
  const request = buildRequest(job.platform_name, job.payload);

  const fetchOpts = {
    method:  request.method,
    headers: request.headers,
    body:    JSON.stringify(request.body),
  };

  // SeatOS uses stored JWT; other platforms use browser session
  if (job.platform_name === 'seatos') {
    const jwt = await getSeatosJwt();
    fetchOpts.headers = {
      ...fetchOpts.headers,
      Authorization: `Bearer ${jwt}`,
      Cookie: `jwt_token=${jwt}`,
    };
    fetchOpts.credentials = 'include';
  } else {
    fetchOpts.credentials = 'include';
  }

  const response = await fetch(request.url, fetchOpts);

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
  const data = await chrome.storage.local.get('seatosJwt');
  if (!data.seatosJwt) throw new Error('SeatOS JWT not configured. Open the extension popup and paste your token.');
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
        body: {
          title:       product.title,
          description: product.description,
          base_price:  product.base_price,
          currency:    product.currency,
        },
      };
    case '12go':
      return {
        method: 'POST',
        url:    'https://api.12go.asia/partner/v1/products',
        headers: { 'Content-Type': 'application/json' },
        body: {
          name:        product.title,
          description: product.description,
          price:       product.base_price,
          currency:    product.currency,
        },
      };
    case 'tripcom':
      return {
        method: 'POST',
        url:    'https://supply.trip.com/restapi/soa2/18437/createProduct',
        headers: { 'Content-Type': 'application/json' },
        body: {
          productName:        product.title,
          productDescription: product.description,
          salePrice:          product.base_price,
          currency:           product.currency,
        },
      };
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

function extractExternalId(platform, response) {
  switch (platform) {
    case 'klook':   return response?.data?.activity_id ?? response?.activity_id   ?? null;
    case '12go':    return response?.product_id        ?? response?.id             ?? null;
    case 'tripcom': return response?.data?.productId   ?? response?.productId      ?? null;
    default:        return null;
  }
}
