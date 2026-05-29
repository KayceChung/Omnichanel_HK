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

  // Try to extract sku_id → title pairs from a packages API response
  function extractSkuNames(data) {
    try {
      // Klook may nest results under various keys — try them all
      const list =
        data?.result?.packages ??
        data?.result?.package_list ??
        data?.result?.sku_list ??
        data?.result?.skus ??
        data?.data?.packages ??
        data?.packages ??
        [];
      if (!Array.isArray(list)) return;
      list.forEach(item => {
        const id    = item.sku_id    ?? item.package_id ?? item.id;
        const title = item.title     ?? item.name       ?? item.package_name ?? item.sku_name;
        if (id && title) {
          window.postMessage({ type: 'KLOOK_SKU_NAMED', sku_id: String(id), title }, '*');
        }
      });
    } catch (_) {}
  }

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const urlStr = String(url);

    notifySku(urlStr);

    const promise = origFetch.apply(this, args);

    // Intercept packages API response to get SKU names
    if (urlStr.includes('get_activity_packages_info_v2')) {
      return promise.then(response => {
        response.clone().json()
          .then(data => extractSkuNames(data))
          .catch(() => {});
        return response;
      });
    }

    return promise;
  };

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._klookUrl = String(url);
    notifySku(this._klookUrl);
    return origOpen.apply(this, arguments);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._klookUrl?.includes('get_activity_packages_info_v2')) {
      this.addEventListener('load', () => {
        try { extractSkuNames(JSON.parse(this.responseText)); } catch (_) {}
      });
    }
    return origSend.apply(this, args);
  };
})();
