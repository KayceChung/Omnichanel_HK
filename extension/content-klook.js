// Inject the fetch interceptor into the page's own JS context
const s = document.createElement('script');
s.src = chrome.runtime.getURL('page-interceptor.js');
(document.head || document.documentElement).appendChild(s);
s.onload = () => s.remove();

// Flag: set to false once extension context is invalidated
let _alive = true;

function safeSend(msg) {
  if (!_alive) return;
  try {
    chrome.runtime.sendMessage(msg);
  } catch (_) {
    _alive = false;
  }
}

// ── Notify background that user opened merchant.klook.com ────────────────────
// Fires once per page load; background debounces to avoid excessive syncing
safeSend({ type: 'klookPageOpened', url: window.location.href });

// ── DOM scan: extract activity IDs from the current page ─────────────────────
function scanDomForActivities() {
  const found = new Map();

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    let id = null;
    const pathM = href.match(/\/(\d{5,8})(?:[/?#]|$)/);
    if (pathM) id = pathM[1];
    const qpM = href.match(/[?&]activity_id=(\d+)/);
    if (qpM) id = qpM[1];
    if (!id) return;
    const cell = a.closest('td, li, .ant-table-cell, [class*="row"], [class*="item"]');
    const raw  = (cell || a).textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
    const name = raw.replace(new RegExp(`^${id}\\s*[-–—]\\s*`), '').slice(0, 80) || null;
    found.set(id, name);
  });

  document.querySelectorAll('td, span, div, p').forEach(el => {
    if (el.children.length > 5) return;
    const text = el.textContent.trim();
    const m = text.match(/^(\d{5,8})\s*[-–—]\s*(.{3,100})$/);
    if (m && !found.has(m[1])) found.set(m[1], m[2].trim().slice(0, 80));
  });

  return Array.from(found.entries()).map(([activity_id, name]) => ({ activity_id, name }));
}

function reportActivities() {
  if (!_alive) return;
  const activities = scanDomForActivities();
  if (activities.length > 0) safeSend({ type: 'klookActivitiesFound', activities });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(reportActivities, 1500));
} else {
  setTimeout(reportActivities, 1500);
}

let scanTimer = null;
const observer = new MutationObserver(() => {
  if (!_alive) { observer.disconnect(); return; }
  clearTimeout(scanTimer);
  scanTimer = setTimeout(reportActivities, 800);
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

// ── Forward page-interceptor messages to background ──────────────────────────
window.addEventListener('message', event => {
  if (event.source !== window) return;
  const { type } = event.data || {};

  if (type === 'KLOOK_SKU_DETECTED')
    safeSend({ type: 'klookSkuDetected', sku_id: event.data.sku_id, activity_id: event.data.activity_id });

  if (type === 'KLOOK_SKU_NAMED')
    safeSend({ type: 'klookSkuNamed', sku_id: event.data.sku_id, title: event.data.title });

  if (type === 'KLOOK_ACTIVITIES_FOUND')
    safeSend({ type: 'klookActivitiesFound', activities: event.data.activities });

  // New: captured device_uuid from live request header
  if (type === 'KLOOK_DEVICE_UUID')
    safeSend({ type: 'klookDeviceUuid', uuid: event.data.uuid });

  // New: full package list intercepted from get_activity_packages_info_v2 response
  if (type === 'KLOOK_PACKAGES_FULL')
    safeSend({ type: 'klookPackagesFull', activity_id: event.data.activity_id, packages: event.data.packages });

  // New: full calendar intercepted from get_calendar_by_sku_id response
  if (type === 'KLOOK_CALENDAR_FULL')
    safeSend({ type: 'klookCalendarFull', sku_id: event.data.sku_id, activity_id: event.data.activity_id, calendar: event.data.calendar });
});
