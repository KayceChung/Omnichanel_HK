// Inject the fetch interceptor into the page's own JS context
const s = document.createElement('script');
s.src = chrome.runtime.getURL('page-interceptor.js');
(document.head || document.documentElement).appendChild(s);
s.onload = () => s.remove();

// Forward detected SKU IDs and names to the background service worker
window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (event.data?.type === 'KLOOK_SKU_DETECTED') {
    chrome.runtime.sendMessage({
      type:        'klookSkuDetected',
      sku_id:      event.data.sku_id,
      activity_id: event.data.activity_id,
    });
  }
  if (event.data?.type === 'KLOOK_SKU_NAMED') {
    chrome.runtime.sendMessage({
      type:   'klookSkuNamed',
      sku_id: event.data.sku_id,
      title:  event.data.title,
    });
  }
  if (event.data?.type === 'KLOOK_ACTIVITIES_FOUND') {
    chrome.runtime.sendMessage({
      type:       'klookActivitiesFound',
      activities: event.data.activities,
    });
  }
});
