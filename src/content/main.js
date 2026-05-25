(function initMain(global) {
  "use strict";

  const namespace = "__DOUBAO_TOOLKIT_INJECTED__";
  if (global[namespace]) {
    return;
  }
  global[namespace] = true;

  const toolkit = global.DoubaoToolkit || {};
  const config = toolkit.config;
  const logger = toolkit.logger;
  const toast = toolkit.toast;
  const sessionManager = toolkit.sessionManager;
  const uiController = toolkit.uiController;
  const floatingPanel = toolkit.floatingPanel;

  function isDoubaoPage() {
    return /(^|\.)doubao\.com$/i.test(location.hostname);
  }

  function createPageBadge() {
    const existing = document.querySelector(".dtk-page-badge");
    if (existing) {
      return;
    }
    const badge = document.createElement("div");
    badge.className = "dtk-page-badge";
    badge.textContent = "豆包工具箱已就绪";
    document.body.appendChild(badge);
    window.setTimeout(() => badge.classList.add("hidden"), 1800);
  }

  function bootstrap() {
    if (!isDoubaoPage()) {
      logger.warn("Non-doubao page detected, skip bootstrap.");
      return;
    }

    sessionManager.init();
    uiController.bindMessageHandlers();
    floatingPanel?.init?.();
    createPageBadge();
    toast.show("豆包工具箱正在运行。", "success", 1400);
    logger.info("Bootstrap complete.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(window);
