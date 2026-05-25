(function initRetry(global) {
  "use strict";

  const config = global.DoubaoToolkit?.config;

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function retryAsync(handler, options = {}) {
    const maxAttempts = options.maxAttempts ?? config?.retry?.maxAttempts ?? 3;
    const intervalMs = options.intervalMs ?? config?.retry?.intervalMs ?? 300;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await handler(attempt);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          global.DoubaoToolkit?.toast?.show?.(`操作失败，正在重试 ${attempt + 1}/${maxAttempts}...`, "warning", 1400, {
            title: "重试详情",
            details: error?.message || "未知错误"
          });
          await sleep(intervalMs);
        }
      }
    }

    throw lastError ?? new Error("Unknown retry failure.");
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.retry = {
    sleep,
    retryAsync
  };
})(window);
