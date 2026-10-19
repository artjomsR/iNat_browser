"use strict";

// Map-only diagnostics. Observe navigation without changing link behavior.
(() => {
  const standalone = navigator.standalone === true ||
    !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  const key = "inat.navigation.v1";
  const session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function read(){
    try {
      const entries = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(entries) ? entries.slice(-80) : [];
    } catch (_) { return []; }
  }
  function record(event, details = {}){
    try {
      const entries = read();
      entries.push({time: new Date().toISOString(), session, page: location.pathname,
        standalone, event, ...details});
      localStorage.setItem(key, JSON.stringify(entries.slice(-80)));
    } catch (_) { /* Diagnostics must never prevent navigation. */ }
  }
  function destination(href){
    try {
      const url = new URL(href, location.href);
      // Keep observation IDs, but omit usernames, coordinates, filters and hashes.
      return url.origin + (/^\/observations\/\d+\/?$/.test(url.pathname)
        ? url.pathname : "/" + url.pathname.split("/")[1]);
    } catch (_) { return "invalid-url"; }
  }
  window.inatNavigation = {standalone, record, destination};
  window.__navlog = read;
  window.__clearNavlog = () => { try { localStorage.removeItem(key); } catch (_) {} };

  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]");
    if(!a || e.defaultPrevented || a.hasAttribute("download")) return;
    if(e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    record("link", {destination: destination(a.href), trusted: e.isTrusted,
      target: a.target || "_self"});
  }, true);
  window.addEventListener("pageshow", e => record("pageshow", {
    persisted: e.persisted,
    navigationType: performance.getEntriesByType("navigation")[0]?.type || "unknown"
  }));
  window.addEventListener("pagehide", e => record("pagehide", {persisted: e.persisted}));
  window.addEventListener("popstate", () => record("popstate"));
  document.addEventListener("visibilitychange", () => record("visibility", {
    state: document.visibilityState
  }));
  record("load");
})();
