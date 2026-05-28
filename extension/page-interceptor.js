(function () {
  function notifySku(url) {
    try {
      const skuMatch = url.match(/[?&]sku_id=(\d+)/);
      if (!skuMatch) return;
      const actMatch = url.match(/[?&]activity_id=(\d+)/);
      window.postMessage({
        type:        'KLOOK_SKU_DETECTED',
        sku_id:      skuMatch[1],
        activity_id: actMatch ? actMatch[1] : null,
      }, '*');
    } catch (_) {}
  }

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      notifySku(url);
    } catch (_) {}
    return origFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest (Klook may use axios/XHR)
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { notifySku(String(url)); } catch (_) {}
    return origOpen.apply(this, arguments);
  };
})();
