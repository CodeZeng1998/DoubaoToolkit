const state = {
  tabId: null,
  contentReady: false,
  snapshot: {
    totalSessions: 0,
    selectedCount: 0,
    multiSelectMode: false,
    isDeleting: false,
    deleteAllUnlocked: false,
    incognitoModeEnabled: false,
    incognitoIntervalMinutes: 10,
    incognitoNextRunAt: null
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
    throw new Error("没有可用的当前标签页。");
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
  $("modeLabel").textContent = state.snapshot.multiSelectMode ? "开启" : "关闭";
  $("toggleModeBtn").textContent = state.snapshot.multiSelectMode ? "关闭多选" : "开启多选";
  $("deleteAllRisk").textContent = state.snapshot.deleteAllUnlocked ? "高风险：删除前仍需确认" : "高风险：首次使用需启用";
  $("incognitoToggle").checked = Boolean(state.snapshot.incognitoModeEnabled);
  $("incognitoInterval").value = String(state.snapshot.incognitoIntervalMinutes || 10);
  $("incognitoStatus").textContent = formatIncognitoStatus();

  const disabled = !state.contentReady || state.snapshot.isDeleting;
  for (const button of document.querySelectorAll(".btn")) {
    button.disabled = disabled;
  }
  $("deleteSelectedBtn").disabled = disabled || (state.snapshot.selectedCount || 0) === 0;
  $("incognitoToggle").disabled = disabled;
  $("incognitoInterval").disabled = disabled;
}

function formatIncognitoStatus() {
  if (!state.snapshot.incognitoModeEnabled) {
    return "未开启";
  }
  const nextRunAt = Number(state.snapshot.incognitoNextRunAt || 0);
  if (!nextRunAt) {
    return `每 ${state.snapshot.incognitoIntervalMinutes || 10} 分钟清理`;
  }
  const remainingMinutes = Math.max(1, Math.ceil((nextRunAt - Date.now()) / 60000));
  return `约 ${remainingMinutes} 分钟后清理`;
}

async function refreshState() {
  try {
    const response = await sendToContent("DTK_GET_STATE");
    if (response?.ok) {
      applyState(response.state);
      setMessage("");
    } else {
      setMessage(response?.error || "无法读取状态。", true);
    }
  } catch (error) {
    setMessage(error.message || "页面脚本不可用。", true);
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
    setMessage("正在删除已选对话...");
    try {
      const response = await sendToContent("DTK_DELETE_SELECTED");
      if (!response?.ok) {
        setMessage(response?.error || "删除已选失败。", true);
      } else {
        const result = response.result || {};
        setMessage(formatDeleteResult(result));
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $("deleteAllBtn").addEventListener("click", async () => {
    setMessage("正在处理全部删除...");
    try {
      const response = await sendToContent("DTK_DELETE_ALL");
      if (!response?.ok) {
        setMessage(response?.error || "全部删除失败。", true);
      } else {
        const result = response.result || {};
        if (result.reason === "delete_all_locked") {
          setMessage("已取消启用全部删除。");
        } else {
          setMessage(formatDeleteResult(result));
        }
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $("incognitoToggle").addEventListener("change", async () => {
    try {
      const response = await sendToContent("DTK_SET_INCOGNITO_MODE", { enabled: $("incognitoToggle").checked });
      if (response?.ok) {
        applyState(response.state);
        if (response.result?.reason === "cancelled") {
          setMessage("已取消开启无痕模式。");
        } else {
          setMessage(response.state?.incognitoModeEnabled ? "已开启无痕模式。" : "已关闭无痕模式。");
        }
      }
    } catch (error) {
      $("incognitoToggle").checked = Boolean(state.snapshot.incognitoModeEnabled);
      setMessage(error.message, true);
    }
  });

  $("incognitoInterval").addEventListener("change", async () => {
    try {
      const minutes = Number($("incognitoInterval").value);
      const response = await sendToContent("DTK_SET_INCOGNITO_INTERVAL", { minutes });
      if (response?.ok) {
        applyState(response.state);
        setMessage(`无痕模式间隔已设为 ${response.result?.intervalMinutes ?? state.snapshot.incognitoIntervalMinutes} 分钟。`);
      }
    } catch (error) {
      $("incognitoInterval").value = String(state.snapshot.incognitoIntervalMinutes || 10);
      setMessage(error.message, true);
    }
  });
}

function formatDeleteResult(result) {
  if (!result || result.reason === "cancelled") {
    return "已取消删除。";
  }
  if (result.reason === "delete_all_locked") {
    return "已取消启用全部删除。";
  }
  return `完成：${result.done ?? 0}，失败：${result.failed ?? 0}`;
}

async function bootstrap() {
  bindActions();
  applyState({});

  const tab = await getActiveTab();
  if (!tab?.id) {
    setMessage("没有可用的当前标签页。", true);
    return;
  }
  state.tabId = tab.id;

  try {
    const ping = await sendToContent("DTK_PING");
    state.contentReady = Boolean(ping?.ok);
    if (!state.contentReady) {
      setMessage("请先打开豆包页面。", true);
    }
  } catch (_error) {
    state.contentReady = false;
    setMessage("请先打开豆包页面。", true);
  }

  applyState({});
  if (state.contentReady) {
    await refreshState();
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);
