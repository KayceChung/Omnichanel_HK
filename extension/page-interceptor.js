(function () {

  // ── Notify SKU detected in a request URL ──────────────────────────────────
  function notifySku(url) {
    try {
      const m = url.match(/[?&]sku_id=(\d+)/);
      if (!m) return;
      const a = url.match(/[?&]activity_id=(\d+)/);
      window.postMessage({ type: 'KLOOK_SKU_DETECTED', sku_id: m[1], activity_id: a?.[1] ?? null }, '*');
    } catch (_) {}
  }

  // ── Extract SKU name mapping from a packages API response ─────────────────
  function extractSkuNames(data) {
    try {
      const list =
        data?.result?.packages     ??
        data?.result?.package_list ??
        data?.result?.sku_list     ??
        data?.result?.skus         ??
        data?.data?.packages       ??
        data?.packages             ?? [];
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

  // ── Recursively scan any API response for arrays that look like activity lists
  function detectActivities(data) {
    try {
      const found = [];

      function scan(obj, depth) {
        if (depth > 6 || !obj) return;
        if (Array.isArray(obj)) {
          if (obj.length === 0) return;
          const sample = obj[0];
          // Check if elements have an activity_id field (various naming)
          const idVal =
            sample?.activity_id   ??
            sample?.activityId    ??
            sample?.act_id        ??
            sample?.actId;
          if (idVal !== undefined && /^\d+$/.test(String(idVal))) {
            obj.forEach(item => {
              const aid = String(
                item.activity_id ?? item.activityId ?? item.act_id ?? item.actId ?? ''
              );
              if (!/^\d+$/.test(aid) || aid.length < 4) return;
              const name =
                item.title         ??
                item.name          ??
                item.activity_name ??
                item.act_title     ??
                item.activityTitle ??
                item.internal_name ??
                null;
              found.push({ activity_id: aid, name: name ? String(name) : null });
            });
          } else {
            // recurse into each element
            obj.forEach(el => scan(el, depth + 1));
          }
        } else if (obj && typeof obj === 'object') {
          Object.values(obj).forEach(v => scan(v, depth + 1));
        }
      }

      scan(data, 0);

      if (found.length > 0) {
        // deduplicate
        const unique = Object.values(
          Object.fromEntries(found.map(a => [a.activity_id, a]))
        );
        window.postMessage({ type: 'KLOOK_ACTIVITIES_FOUND', activities: unique }, '*');
      }
    } catch (_) {}
  }

  // ── Intercept fetch ───────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const urlStr = String(url);

    notifySku(urlStr);

    const promise = origFetch.apply(this, args);

    // Inspect ALL merchant API responses
    if (urlStr.includes('productadminbffsrv') || urlStr.includes('merchant.klook.com')) {
      return promise.then(response => {
        response.clone().json().then(data => {
          detectActivities(data);
          if (urlStr.includes('get_activity_packages_info_v2')) extractSkuNames(data);
        }).catch(() => {});
        return response;
      });
    }

    return promise;
  };

  // ── Intercept XMLHttpRequest ──────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._klookUrl = String(url);
    notifySku(this._klookUrl);
    return origOpen.apply(this, arguments);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const url = this._klookUrl || '';
    if (url.includes('productadminbffsrv') || url.includes('merchant.klook.com')) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          detectActivities(data);
          if (url.includes('get_activity_packages_info_v2')) extractSkuNames(data);
        } catch (_) {}
      });
    }
    return origSend.apply(this, args);
  };

})();
