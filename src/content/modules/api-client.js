(function initApiClient(global) {
  "use strict";

  const toolkit = global.DoubaoToolkit || {};
  const config = toolkit.config;
  const logger = toolkit.logger;

  const SECURITY_PARAM_NAMES = ["device_id", "web_id", "tea_uuid", "msToken", "a_bogus"];
  const RESOURCE_PARAM_HINTS = ["/samantha/", "/alice/", "/api/"];
  const DELETE_URL_CACHE_TTL_MS = 30000;
  let cachedDeleteUrl = null;
  let cachedDeleteUrlAt = 0;
  let cachedDeleteUrlLocation = "";

  function addParams(target, source, overwrite = false) {
    if (!source) {
      return;
    }
    for (const [key, value] of source.entries()) {
      if (!value) {
        continue;
      }
      if (overwrite || !target.has(key)) {
        target.set(key, value);
      }
    }
  }

  function getParamsFromUrl(value) {
    try {
      return new URL(value, location.origin).searchParams;
    } catch (_error) {
      return null;
    }
  }

  function readCookieMap() {
    const result = new Map();
    for (const part of document.cookie.split(";")) {
      const index = part.indexOf("=");
      if (index <= 0) {
        continue;
      }
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) {
        try {
          result.set(key, decodeURIComponent(value));
        } catch (_error) {
          result.set(key, value);
        }
      }
    }
    return result;
  }

  function readStorageValue(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch (_error) {
      return "";
    }
  }

  function readRuntimeIdentityParams() {
    const params = new URLSearchParams();
    const cookies = readCookieMap();
    for (const key of SECURITY_PARAM_NAMES) {
      const value = readStorageValue(key) || cookies.get(key) || "";
      if (value) {
        params.set(key, value);
      }
    }
    const webId = cookies.get("web_id") || cookies.get("tea_uuid") || cookies.get("s_v_web_id") || readStorageValue("web_id");
    if (webId) {
      if (!params.has("web_id")) {
        params.set("web_id", webId);
      }
      if (!params.has("tea_uuid")) {
        params.set("tea_uuid", webId);
      }
    }
    return params;
  }

  function readRelevantResourceParams() {
    const params = new URLSearchParams();
    const entries = performance.getEntriesByType?.("resource") || [];
    for (const entry of entries) {
      const url = String(entry?.name || "");
      if (!url || !RESOURCE_PARAM_HINTS.some((hint) => url.includes(hint))) {
        continue;
      }
      const source = getParamsFromUrl(url);
      if (!source) {
        continue;
      }
      for (const key of SECURITY_PARAM_NAMES) {
        const value = source.get(key);
        if (value && !params.has(key)) {
          params.set(key, value);
        }
      }
      addParams(params, source, false);
    }
    return params;
  }

  function buildDeleteUrl() {
    const now = Date.now();
    if (
      cachedDeleteUrl &&
      cachedDeleteUrlLocation === location.href &&
      now - cachedDeleteUrlAt < DELETE_URL_CACHE_TTL_MS
    ) {
      return new URL(cachedDeleteUrl);
    }

    const endpoint = config?.api?.deleteEndpoint || "/samantha/thread/delete";
    const url = new URL(endpoint, location.origin);
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(config?.api?.deleteQueryDefaults || {})) {
      params.set(key, String(value));
    }

    addParams(params, getParamsFromUrl(location.href), true);
    addParams(params, readRelevantResourceParams(), true);
    addParams(params, readRuntimeIdentityParams(), false);

    url.search = params.toString();
    cachedDeleteUrl = url.toString();
    cachedDeleteUrlAt = now;
    cachedDeleteUrlLocation = location.href;
    return url;
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (_error) {
      return text;
    }
  }

  function createApiError(category, message, details = {}) {
    const error = new Error(message);
    error.failureCategory = category;
    Object.assign(error, details);
    return error;
  }

  function isAuthFailureText(value) {
    const text = String(value || "").toLowerCase();
    return (
      text.includes("login") ||
      text.includes("auth") ||
      text.includes("unauthorized") ||
      text.includes("forbidden") ||
      text.includes("登录") ||
      text.includes("权限") ||
      text.includes("未授权")
    );
  }

  function assertBusinessSuccess(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const code = payload.code ?? payload.status_code ?? payload.status;
    if (code === undefined || code === null || code === 0 || code === "0") {
      return;
    }
    const message = payload.message || payload.msg || payload.status_msg || "Delete request was rejected.";
    const category = isAuthFailureText(message) ? "auth_expired" : "api_failed";
    throw createApiError(category, `${message} (${code})`, { businessCode: code, payload });
  }

  async function deleteConversation(conversationId) {
    const id = String(conversationId || "").trim();
    if (!/^\d+$/.test(id)) {
      throw createApiError("missing_conversation_id", "Missing valid conversation id.");
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, config?.timing?.apiRequestTimeoutMs || 8000);

    try {
      const response = await fetch(buildDeleteUrl(), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          conversation_id: id
        })
      });

      const payload = await parseResponse(response);
      if (!response.ok) {
        const category = response.status === 401 || response.status === 403 ? "auth_expired" : "api_failed";
        throw createApiError(category, `HTTP ${response.status}`, { httpStatus: response.status, payload });
      }
      assertBusinessSuccess(payload);
      logger?.debug("Delete API succeeded for conversation:", id);
      return payload;
    } catch (error) {
      if (error?.failureCategory) {
        throw error;
      }
      const isTimeout = error?.name === "AbortError";
      throw createApiError("api_failed", isTimeout ? "Delete request timed out." : error?.message || "Delete request failed.", {
        cause: error
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.apiClient = {
    deleteConversation,
    getDiagnostics: () => ({
      deleteEndpoint: config?.api?.deleteEndpoint || "/samantha/thread/delete",
      cacheAgeMs: cachedDeleteUrlAt ? Date.now() - cachedDeleteUrlAt : null,
      hasCachedDeleteUrl: Boolean(cachedDeleteUrl)
    })
  };
})(window);
