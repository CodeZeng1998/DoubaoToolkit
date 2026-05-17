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
      case "DTK_DELETE_ALL":
        return async () => {
          const result = await sessionManager.deleteSessions("all");
          return {
            ok: true,
            result,
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
        sendResponse({ ok: false, error: "Invalid message." });
        return false;
      }
      if (message.type === "DTK_PING") {
        sendResponse({ ok: true, message: "pong", state: sessionManager.getState() });
        return false;
      }

      const handler = commandMap(message.type);
      if (!handler) {
        sendResponse({ ok: false, error: `Unknown command: ${message.type}` });
        return false;
      }

      handler(message.payload)
        .then((data) => sendResponse(data))
        .catch((error) => {
          logger.error("Message command failed:", message.type, error);
          sendResponse({ ok: false, error: error?.message ?? "Unknown error." });
        });
      return true;
    });
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.uiController = {
    bindMessageHandlers
  };
})(window);
