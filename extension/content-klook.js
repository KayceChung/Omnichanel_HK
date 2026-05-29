// Inject the fetch interceptor into the page's own JS context
const s = document.createElement('script');
s.src = chrome.runtime.getURL('page-interceptor.js');
(document.head || document.documentElement).appendChild(s);
s.onload = () => s.remove();

// ── DOM scan: extract activity IDs from the current page ─────────────────────
function scanDomForActivities() {
  const found = new Map(); // activity_id -> name

  // 1. Scan all <a> hrefs for patterns like /214640 or ?activity_id=214640
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    let id = null;

    // URL path ending in /digits
    const pathM = href.match(/\/(\d{5,8})(?:[/?#]|$)/);
    if (pathM) id = pathM[1];

    // Query param activity_id=digits
    const qpM = href.match(/[?&]activity_id=(\d+)/);
    if (qpM) id = qpM[1];

    if (!id) return;

    // Try to get a human-readable name from nearby text
    const cell = a.closest('td, li, .ant-table-cell, [class*="row"], [class*="item"]');
    const raw  = (cell || a).textContent.trim().replace(/\s+/g, ' ').slice(0, 120);
    // Strip the leading ID from text if present ("214640 - Name" → "Name")
    const name = raw.replace(new RegExp(`^${id}\\s*[-–—]\\s*`), '').slice(0, 80) || null;

    found.set(id, name);
  });

  // 2. Scan visible text for "214640 - Some Name" patterns (table cells, spans)
  document.querySelectorAll('td, span, div, p').forEach(el => {
    if (el.children.length > 5) return; // skip containers
    const text = el.textContent.trim();
    const m = text.match(/^(\d{5,8})\s*[-–—]\s*(.{3,100})$/);
    if (m && !found.has(m[1])) found.set(m[1], m[2].trim().slice(0, 80));
  });

  return Array.from(found.entries()).map(([activity_id, name]) => ({ activity_id, name }));
}

function safeSend(msg) {
  try {
    if (chrome.runtime?.id) {
      chrome.runtime.sendMessage(msg);
    } else {
      observer.disconnect(); // extension reloaded, stop observing
    }
  } catch (_) {
    observer.disconnect();
  }
}

function reportActivities() {
  const activities = scanDomForActivities();
  if (activities.length > 0) safeSend({ type: 'klookActivitiesFound', activities });
}

// Run on load, then watch for dynamically rendered content
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(reportActivities, 1500));
} else {
  setTimeout(reportActivities, 1500);
}

// MutationObserver catches content loaded after initial render (pagination, search results)
let scanTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(reportActivities, 800);
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

// ── Forward page-interceptor messages to background ──────────────────────────
window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (event.data?.type === 'KLOOK_SKU_DETECTED') {
    safeSend({ type: 'klookSkuDetected', sku_id: event.data.sku_id, activity_id: event.data.activity_id });
  }
  if (event.data?.type === 'KLOOK_SKU_NAMED') {
    safeSend({ type: 'klookSkuNamed', sku_id: event.data.sku_id, title: event.data.title });
  }
  if (event.data?.type === 'KLOOK_ACTIVITIES_FOUND') {
    safeSend({ type: 'klookActivitiesFound', activities: event.data.activities });
  }
});
