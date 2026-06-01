(function initUiController(global) {
  "use strict";

  const toolkit = global.DoubaoToolkit || {};
  const sessionManager = toolkit.sessionManager;
  const logger = toolkit.logger;

  function commandMap(type) {
    switch (type) {
      case "DTK_GET_STATE":
        return async () => ({
          ok: true,
          state: sessionManager.getState()
        });
      case "DTK_TOGGLE_MULTI_SELECT":
        return async (payload) => {
          sessionManager.setMultiSelectMode(Boolean(payload?.enabled));
          return {
            ok: true,
            state: sessionManager.getState()
          };
        };
      case "DTK_SELECT_ALL":
        return async () => {
          sessionManager.selectAll();
          return {
            ok: true,
            state: sessionManager.getState()
          };
        };
      case "DTK_CLEAR_SELECTION":
        return async () => {
          sessionManager.clearSelection();
          return {
            ok: true,
            state: sessionManager.getState()
          };
        };
      case "DTK_DELETE_SELECTED":
        return async () => {
          const result = await sessionManager.deleteSessions("selected");
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_REFRESH_DELETE_STATS":
        return async () => {
          const result = sessionManager.refreshDeleteStats({ force: true });
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_DELETE_ALL":
        return async () => {
          const result = await sessionManager.deleteSessions("all");
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_SET_INCOGNITO_MODE":
        return async (payload) => {
          const result = await sessionManager.setIncognitoMode(Boolean(payload?.enabled));
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_SET_INCOGNITO_INTERVAL":
        return async (payload) => {
          const result = await sessionManager.setIncognitoInterval(payload?.minutes);
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_SET_INCOGNITO_SKIP_ACTIVE":
        return async (payload) => {
          const result = await sessionManager.setIncognitoSkipActive(Boolean(payload?.enabled));
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_CLEAR_ARCHIVED_CONVERSATIONS":
        return async () => {
          const result = sessionManager.clearArchivedConversations();
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_ARCHIVE_SELECTED":
        return async () => {
          const result = sessionManager.setSelectedArchiveState(true);
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_UNARCHIVE_SELECTED":
        return async () => {
          const result = sessionManager.setSelectedArchiveState(false);
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_RUN_INCOGNITO_CLEANUP":
        return async () => {
          const result = await sessionManager.runIncognitoCleanup();
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_RETRY_FAILED_DELETES":
        return async () => {
          const result = await sessionManager.retryFailedSessions();
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_CANCEL_DELETE":
        return async () => {
          const result = sessionManager.requestCancelDelete();
          return {
            ok: true,
            result,
            state: sessionManager.getState()
          };
        };
      case "DTK_GET_DIAGNOSTICS":
        return async () => ({
          ok: true,
          diagnostics: sessionManager.buildDiagnostics(),
          state: sessionManager.getState()
        });
      case "DTK_RELOAD_SETTINGS":
        return async () => {
          const settings = await sessionManager.reloadSettings();
          return {
            ok: true,
            settings,
            state: sessionManager.getState()
          };
        };
      default:
        return null;
    }
  }

  function bindMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        sendResponse({ ok: false, error: "无效消息。" });
        return false;
      }
      if (message.type === "DTK_PING") {
        sendResponse({ ok: true, message: "pong", state: sessionManager.getState() });
        return false;
      }

      const handler = commandMap(message.type);
      if (!handler) {
        sendResponse({ ok: false, error: `未知命令：${message.type}` });
        return false;
      }

      handler(message.payload)
        .then((data) => sendResponse(data))
        .catch((error) => {
          logger.error("Message command failed:", message.type, error);
          sendResponse({ ok: false, error: error?.message ?? "未知错误。" });
        });
      return true;
    });
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.uiController = {
    bindMessageHandlers
  };
})(window);
