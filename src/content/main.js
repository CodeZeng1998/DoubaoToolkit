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
  const modal = toolkit.modal;
  const sessionManager = toolkit.sessionManager;
  const uiController = toolkit.uiController;
  const floatingPanel = toolkit.floatingPanel;

  function isDoubaoPage() {
    return /(^|\.)doubao\.com$/i.test(location.hostname);
  }

  function createPageBadge() {
    if (!document.body) {
      return;
    }
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

  function showIncognitoModeNoticeIfNeeded() {
    if (!sessionManager?.getState) {
      return;
    }

    let noticeShown = false;
    let fallbackTimer = null;

    const cleanup = () => {
      window.removeEventListener("dtk:state-changed", handleStateChanged);
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const showNotice = (state) => {
      if (noticeShown || !state?.incognitoModeEnabled) {
        return;
      }
      noticeShown = true;
      cleanup();

      const minutes = Number(state.incognitoIntervalMinutes || 10);
      const message = `当前豆包页面处于无痕模式，工具会按设定间隔自动清理历史对话。当前清理间隔约为 ${minutes} 分钟。`;
      try {
        if (!modal?.confirm) {
          toast?.show?.("无痕模式已开启，工具会按设定间隔自动清理历史对话。", "warning", 5200);
          return;
        }

        void modal.confirm({
          title: "无痕模式已开启",
          message,
          confirmText: "我知道了",
          cancelText: "关闭提醒"
        });
      } catch (error) {
        logger?.warn?.("Show incognito notice failed:", error);
        toast?.show?.("无痕模式已开启，工具会按设定间隔自动清理历史对话。", "warning", 5200);
      }
    };

    function handleStateChanged(event) {
      showNotice(event.detail);
    }

    window.addEventListener("dtk:state-changed", handleStateChanged);
    fallbackTimer = window.setTimeout(() => showNotice(sessionManager?.getState?.()), 1200);
  }

  function safeRun(label, task) {
    try {
      task?.();
    } catch (error) {
      logger?.warn?.(`${label} failed:`, error);
      console.warn(`[Doubao Toolkit] ${label} failed:`, error);
    }
  }

  function bootstrap() {
    if (!isDoubaoPage()) {
      logger?.warn?.("Non-doubao page detected, skip bootstrap.");
      return;
    }

    safeRun("Session manager init", () => sessionManager?.init?.());
    safeRun("Message handlers bind", () => uiController?.bindMessageHandlers?.());
    safeRun("Floating panel init", () => floatingPanel?.init?.());
    safeRun("Page badge init", createPageBadge);
    safeRun("Incognito notice init", showIncognitoModeNoticeIfNeeded);
    toast?.show?.("豆包工具箱正在运行。", "success", 1400);
    logger?.info?.("Bootstrap complete.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(window);
