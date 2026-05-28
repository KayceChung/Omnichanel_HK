(function () {
  const orig = window.fetch;
  window.fetch = function (...args) {
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      const skuMatch = url.match(/[?&]sku_id=(\d+)/);
      if (skuMatch) {
        const actMatch = url.match(/[?&]activity_id=(\d+)/);
        window.postMessage({
          type:        'KLOOK_SKU_DETECTED',
          sku_id:      skuMatch[1],
          activity_id: actMatch ? actMatch[1] : null,
        }, '*');
      }
    } catch (_) {}
    return orig.apply(this, args);
  };
})();
