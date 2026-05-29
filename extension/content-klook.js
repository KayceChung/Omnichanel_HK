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
    _alive = false; // stop all future sends silently
  }
}

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

// Run on load, then watch for dynamically rendered content
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
  if (event.data?.type === 'KLOOK_SKU_DETECTED')
    safeSend({ type: 'klookSkuDetected', sku_id: event.data.sku_id, activity_id: event.data.activity_id });
  if (event.data?.type === 'KLOOK_SKU_NAMED')
    safeSend({ type: 'klookSkuNamed', sku_id: event.data.sku_id, title: event.data.title });
  if (event.data?.type === 'KLOOK_ACTIVITIES_FOUND')
    safeSend({ type: 'klookActivitiesFound', activities: event.data.activities });
});
