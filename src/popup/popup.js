const state = {
  tabId: null,
  contentReady: false,
  snapshot: {
    totalSessions: 0,
    selectedCount: 0,
    multiSelectMode: false,
    isDeleting: false
  }
};

const $ = (id) => document.getElementById(id);

function setMessage(text, isError = false) {
  const node = $("message");
  node.textContent = text || "";
  node.style.color = isError ? "#e24c4c" : "";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function sendToContent(type, payload) {
  if (!state.tabId) {
    throw new Error("No active tab.");
  }
  return chrome.tabs.sendMessage(state.tabId, { type, payload });
}

function applyState(snapshot) {
  state.snapshot = {
    ...state.snapshot,
    ...snapshot
  };
  $("totalSessions").textContent = String(state.snapshot.totalSessions ?? 0);
  $("selectedSessions").textContent = String(state.snapshot.selectedCount ?? 0);
  $("modeLabel").textContent = state.snapshot.multiSelectMode ? "ON" : "OFF";
  $("toggleModeBtn").textContent = state.snapshot.multiSelectMode ? "Disable Multi-Select" : "Enable Multi-Select";

  const disabled = !state.contentReady || state.snapshot.isDeleting;
  for (const button of document.querySelectorAll(".btn")) {
    button.disabled = disabled;
  }
}

async function refreshState() {
  try {
    const response = await sendToContent("DTK_GET_STATE");
    if (response?.ok) {
      applyState(response.state);
      setMessage("");
    } else {
      setMessage(response?.error || "Cannot read state.", true);
    }
  } catch (error) {
    setMessage(error.message || "Content script is unavailable.", true);
    state.contentReady = false;
    applyState({});
  }
}

function bindActions() {
  $("toggleModeBtn").addEventListener("click", async () => {
    try {
      const enabled = !state.snapshot.multiSelectMode;
      const response = await sendToContent("DTK_TOGGLE_MULTI_SELECT", { enabled });
      if (response?.ok) {
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $("selectAllBtn").addEventListener("click", async () => {
    try {
      const response = await sendToContent("DTK_SELECT_ALL");
      if (response?.ok) {
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $("clearSelectionBtn").addEventListener("click", async () => {
    try {
      const response = await sendToContent("DTK_CLEAR_SELECTION");
      if (response?.ok) {
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $("deleteSelectedBtn").addEventListener("click", async () => {
    setMessage("Deleting selected sessions...");
    try {
      const response = await sendToContent("DTK_DELETE_SELECTED");
      if (!response?.ok) {
        setMessage(response?.error || "Delete selected failed.", true);
      } else {
        const result = response.result || {};
        setMessage(`Done: ${result.done ?? 0}, failed: ${result.failed ?? 0}`);
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $("deleteAllBtn").addEventListener("click", async () => {
    setMessage("Deleting all sessions...");
    try {
      const response = await sendToContent("DTK_DELETE_ALL");
      if (!response?.ok) {
        setMessage(response?.error || "Delete all failed.", true);
      } else {
        const result = response.result || {};
        setMessage(`Done: ${result.done ?? 0}, failed: ${result.failed ?? 0}`);
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

async function bootstrap() {
  bindActions();
  applyState({});

  const tab = await getActiveTab();
  if (!tab?.id) {
    setMessage("No active tab.", true);
    return;
  }
  state.tabId = tab.id;

  try {
    const ping = await sendToContent("DTK_PING");
    state.contentReady = Boolean(ping?.ok);
    if (!state.contentReady) {
      setMessage("Open a Doubao page first.", true);
    }
  } catch (_error) {
    state.contentReady = false;
    setMessage("Open a Doubao page first.", true);
  }

  applyState({});
  if (state.contentReady) {
    await refreshState();
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
