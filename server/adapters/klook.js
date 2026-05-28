const BASE = 'https://merchant.klook.com';

// Headers required by every Klook merchant API call
const KLOOK_HEADERS = {
  'Accept':             'application/json, text/plain, */*',
  'Content-Type':       'application/json;charset=UTF-8',
  'x-klook-admin-host': 'global',
  'x-platform':         'desktop',
  'x-req-client':       'experiencesmerchant',
  'version':            '3',
};

// ── READ ──────────────────────────────────────────────────────────────────────

function buildGetCalendarRequest(skuId, startDate, endDate) {
  const start = `${startDate} 00:00:00`;
  const end   = `${endDate} 23:59:59`;
  return {
    method:  'GET',
    url:     `${BASE}/v1/productadminbffsrv/merchant/calendar_service/get_calendar_by_sku_id?sku_id=${skuId}&start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    headers: KLOOK_HEADERS,
  };
}

function buildGetPackagesRequest(activityId) {
  return {
    method:  'GET',
    url:     `${BASE}/v1/productadminbffsrv/merchant/package_service/get_activity_packages_info_v2?activity_id=${activityId}&language=en_US&page_from=merchant`,
    headers: KLOOK_HEADERS,
  };
}

// ── WRITE ─────────────────────────────────────────────────────────────────────

// Activate or deactivate a single timeslot
// published: true = active, false = deactivated
function buildUpdateScheduleRequest(skuId, startTime, { published, invQuantity, price, cutOffTime }) {
  const body = {
    sku_id:       skuId,
    start_time:   startTime,           // "YYYY-MM-DD HH:mm:ss"
    published:    published ?? true,
    inv_quantity: invQuantity ?? 0,
    cut_off_time: cutOffTime ?? 147600,
  };
  if (price) {
    body.price = {
      cost_currency: price.cost_currency || 'VND',
      cost_price:    price.cost_price,
      retail_price:  price.retail_price,
    };
  }
  return {
    method:  'POST',
    url:     `${BASE}/v1/productadminbffsrv/merchant/calendar_service/creates_or_update_single_schedule`,
    headers: KLOOK_HEADERS,
    body,
  };
}

// Activate a timeslot (set published=true, keep existing qty/price if provided)
function buildActivateRequest(skuId, startTime, opts = {}) {
  return buildUpdateScheduleRequest(skuId, startTime, { ...opts, published: true });
}

// Deactivate a timeslot (set published=false)
function buildDeactivateRequest(skuId, startTime, opts = {}) {
  return buildUpdateScheduleRequest(skuId, startTime, { ...opts, published: false });
}

// ── RESPONSE PARSERS ──────────────────────────────────────────────────────────

function parseCalendarResponse(response) {
  const cal = response?.result?.calendar ?? [];
  return cal.map(slot => ({
    start_time:     slot.start_time,
    published:      slot.published,
    inv_quantity:   slot.inv_quantity,
    sales:          slot.sales,
    publish_status: slot.publish_status,
    price:          slot.price,
    cut_off_time:   slot.cut_off_time,
    is_empty:       slot.is_empty,
  }));
}

function parseUpdateResponse(response) {
  return {
    success:     response?.success === true,
    error:       response?.error?.message || null,
  };
}

module.exports = {
  KLOOK_HEADERS,
  buildGetCalendarRequest,
  buildGetPackagesRequest,
  buildUpdateScheduleRequest,
  buildActivateRequest,
  buildDeactivateRequest,
  parseCalendarResponse,
  parseUpdateResponse,
};
