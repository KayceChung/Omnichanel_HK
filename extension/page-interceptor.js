(function () {

  // ── Capture device_uuid from outgoing request headers ─────────────────────
  function captureRequestMeta(urlStr, options) {
    try {
      const hdrs = options?.headers || {};
      const get  = (k) => (typeof hdrs.get === 'function' ? hdrs.get(k) : hdrs[k]) || null;
      const uuid = get('device_uuid') || get('Device-Uuid');
      if (uuid) window.postMessage({ type: 'KLOOK_DEVICE_UUID', uuid }, '*');
    } catch (_) {}
    notifySku(urlStr);
  }

  // ── Notify SKU detected in a request URL ──────────────────────────────────
  function notifySku(url) {
    try {
      const m = url.match(/[?&]sku_id=(\d+)/);
      if (!m) return;
      const a = url.match(/[?&]activity_id=(\d+)/);
      window.postMessage({ type: 'KLOOK_SKU_DETECTED', sku_id: m[1], activity_id: a?.[1] ?? null }, '*');
    } catch (_) {}
  }

  // ── Recursively collect all objects with sku_id field at any depth ──────────
  // Mirrors findAllSkus in background.js — targets the SKU level (not package level)
  function collectSkus(obj, depth) {
    const out = [];
    if (depth > 8 || !obj) return out;
    if (Array.isArray(obj)) {
      obj.forEach(item => out.push(...collectSkus(item, depth + 1)));
      return out;
    }
    if (typeof obj === 'object') {
      const rawId = obj.sku_id ?? obj.skuId;
      if (rawId !== undefined && /^\d+$/.test(String(rawId))) {
        const title = obj.title ?? obj.name ?? obj.sku_name ?? obj.skuName ?? obj.package_name ?? null;
        out.push({ sku_id: String(rawId), title: title ? String(title) : null });
      }
      Object.values(obj).forEach(v => { if (v && typeof v === 'object') out.push(...collectSkus(v, depth + 1)); });
    }
    return out;
  }

  // ── Broadcast SKU names to background (passive capture) ───────────────────
  function extractSkuNames(data) {
    try {
      const skus = collectSkus(data, 0);
      // Deduplicate
      const seen = new Set();
      skus.forEach(({ sku_id, title }) => {
        if (seen.has(sku_id) || !title) return;
        seen.add(sku_id);
        window.postMessage({ type: 'KLOOK_SKU_NAMED', sku_id, title }, '*');
      });
    } catch (_) {}
  }

  // ── Send full SKU list so background auto-syncs calendars ─────────────────
  function extractPackagesFull(urlStr, data) {
    try {
      const actM        = urlStr.match(/activity_id=(\d+)/);
      const activity_id = actM?.[1] || null;

      const rawSkus = collectSkus(data, 0);
      // Deduplicate
      const skuMap = {};
      rawSkus.forEach(s => { if (!skuMap[s.sku_id]) skuMap[s.sku_id] = s; });
      const packages = Object.values(skuMap).filter(p => p.sku_id);

      if (packages.length > 0) {
        window.postMessage({ type: 'KLOOK_PACKAGES_FULL', activity_id, packages }, '*');
      }
    } catch (_) {}
  }

  // ── Send full calendar data so background can import directly ─────────────
  function extractCalendarFull(urlStr, data) {
    try {
      const skuM        = urlStr.match(/[?&]sku_id=(\d+)/);
      const actM        = urlStr.match(/[?&]activity_id=(\d+)/);
      const sku_id      = skuM?.[1] || null;
      const activity_id = actM?.[1] || null;
      if (!sku_id) return;

      const calendar = data?.result?.calendar;
      if (!Array.isArray(calendar) || calendar.length === 0) return;

      window.postMessage({ type: 'KLOOK_CALENDAR_FULL', sku_id, activity_id, calendar }, '*');
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
          const idVal =
            sample?.activity_id ?? sample?.activityId ??
            sample?.act_id      ?? sample?.actId;
          if (idVal !== undefined && /^\d+$/.test(String(idVal))) {
            obj.forEach(item => {
              const aid = String(
                item.activity_id ?? item.activityId ?? item.act_id ?? item.actId ?? ''
              );
              if (!/^\d+$/.test(aid) || aid.length < 4) return;
              const name =
                item.title         ?? item.name          ??
                item.activity_name ?? item.act_title     ??
                item.activityTitle ?? item.internal_name ?? null;
              found.push({ activity_id: aid, name: name ? String(name) : null });
            });
          } else {
            obj.forEach(el => scan(el, depth + 1));
          }
        } else if (obj && typeof obj === 'object') {
          Object.values(obj).forEach(v => scan(v, depth + 1));
        }
      }

      scan(data, 0);

      if (found.length > 0) {
        const unique = Object.values(Object.fromEntries(found.map(a => [a.activity_id, a])));
        window.postMessage({ type: 'KLOOK_ACTIVITIES_FOUND', activities: unique }, '*');
      }
    } catch (_) {}
  }

  // ── Intercept fetch ───────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url    = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const urlStr = String(url);
    const opts   = args[1] || {};

    captureRequestMeta(urlStr, opts);

    const promise = origFetch.apply(this, args);

    if (urlStr.includes('productadminbffsrv') || urlStr.includes('merchant.klook.com')) {
      return promise.then(response => {
        response.clone().json().then(data => {
          detectActivities(data);
          if (urlStr.includes('get_activity_packages_info_v2')) {
            extractSkuNames(data);
            extractPackagesFull(urlStr, data);
          }
          if (urlStr.includes('get_calendar_by_sku_id')) {
            extractCalendarFull(urlStr, data);
          }
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
          if (url.includes('get_activity_packages_info_v2')) {
            extractSkuNames(data);
            extractPackagesFull(url, data);
          }
          if (url.includes('get_calendar_by_sku_id')) {
            extractCalendarFull(url, data);
          }
        } catch (_) {}
      });
    }
    return origSend.apply(this, args);
  };

})();
