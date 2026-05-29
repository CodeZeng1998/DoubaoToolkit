const state = {
  tabId: null,
  contentReady: false,
  countdownTimer: null,
  snapshot: {
    totalSessions: 0,
    selectedCount: 0,
    multiSelectMode: false,
    isDeleting: false,
    deleteAllUnlocked: false,
    incognitoModeEnabled: false,
    incognitoIntervalMinutes: 10,
    incognitoNextRunAt: null,
    hasFailedRetryTargets: false,
    deleteStats: {
      loading: true,
      total: 0,
      selected: 0,
      deletable: 0,
      selectedDeletable: 0,
      missingConversationId: 0,
      missingElement: 0
    }
  },
  latestTask: null
};

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const node = $(id);
  if (node) {
    node.textContent = value ?? "";
  }
}

function setDisabled(id, disabled) {
  const node = $(id);
  if (node) {
    node.disabled = Boolean(disabled);
  }
}

function setMessage(text, isError = false) {
  const node = $("message");
  if (!node) {
    return;
  }
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
  const stats = state.snapshot.deleteStats || {};
  setText("totalSessions", String(state.snapshot.totalSessions ?? 0));
  setText("selectedSessions", String(state.snapshot.selectedCount ?? 0));
  setText("deletableSessions", String(stats.deletable ?? state.snapshot.totalSessions ?? 0));
  setText("selectedDeletableSessions", String(stats.selectedDeletable ?? state.snapshot.selectedCount ?? 0));
  setText("missingIdSessions", String(stats.missingConversationId ?? 0));
  setText("missingElementSessions", String(stats.missingElement ?? 0));
  setText("modeLabel", state.snapshot.multiSelectMode ? "开启" : "关闭");
  setText("toggleModeBtn", state.snapshot.multiSelectMode ? "关闭多选" : "开启多选");
  const allSelected =
    (state.snapshot.totalSessions || 0) > 0 && (state.snapshot.selectedCount || 0) >= (state.snapshot.totalSessions || 0);
  setText("selectAllBtn", allSelected ? "取消全选" : "全选");
  $("selectAllBtn")?.setAttribute("aria-pressed", String(allSelected));
  setText("deleteAllRisk", state.snapshot.deleteAllUnlocked ? "高风险：删除前仍需确认" : "高风险：首次使用需启用");
  const incognitoToggle = $("incognitoToggle");
  if (incognitoToggle) {
    incognitoToggle.checked = Boolean(state.snapshot.incognitoModeEnabled);
  }
  const incognitoInterval = $("incognitoInterval");
  if (incognitoInterval) {
    incognitoInterval.value = String(state.snapshot.incognitoIntervalMinutes || 10);
  }
  setText("incognitoStatus", formatIncognitoStatus());

  if (state.snapshot.incognitoModeEnabled && state.snapshot.incognitoNextRunAt) {
    startCountdownTimer();
  } else {
    stopCountdownTimer();
  }

  const disabled = !state.contentReady || state.snapshot.isDeleting;
  for (const button of document.querySelectorAll(".btn")) {
    button.disabled = disabled;
  }
  setDisabled("deleteSelectedBtn", disabled || (state.snapshot.selectedCount || 0) === 0);
  setDisabled("cancelDeleteBtn", !state.contentReady || !state.snapshot.isDeleting);
  setDisabled("incognitoToggle", disabled);
  setDisabled("incognitoInterval", disabled);
  setDisabled("retryFailedBtn", disabled || !state.snapshot.hasFailedRetryTargets);
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

function startCountdownTimer() {
  stopCountdownTimer();
  state.countdownTimer = setInterval(updateCountdown, 1000);
  updateCountdown();
}

function stopCountdownTimer() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  const el = $("incognitoCountdown");
  if (!el) {
    return;
  }
  el.hidden = true;
  el.textContent = "";
  el.classList.remove("countdown-urgent");
}

function updateCountdown() {
  const el = $("incognitoCountdown");
  if (!el) {
    return;
  }
  if (!state.snapshot.incognitoModeEnabled) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("countdown-urgent");
    stopCountdownTimer();
    return;
  }
  const nextRunAt = Number(state.snapshot.incognitoNextRunAt || 0);
  if (!nextRunAt) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("countdown-urgent");
    return;
  }
  const remainingSeconds = Math.max(0, Math.ceil((nextRunAt - Date.now()) / 1000));
  if (remainingSeconds <= 60 && remainingSeconds > 0) {
    el.hidden = false;
    el.textContent = `${remainingSeconds}s`;
    el.classList.toggle("countdown-urgent", remainingSeconds <= 10);
  } else if (remainingSeconds <= 0) {
    el.hidden = false;
    el.textContent = "0s";
    el.classList.add("countdown-urgent");
    setTimeout(() => refreshState(), 2000);
  } else {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("countdown-urgent");
  }
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

async function refreshDeleteStats() {
  try {
    const response = await sendToContent("DTK_REFRESH_DELETE_STATS");
    if (response?.ok) {
      applyState(response.state);
    }
  } catch (error) {
    setMessage(error.message || "无法统计对话信息。", true);
  }
}

async function refreshHistory() {
  try {
    const history = await DoubaoToolkitStorage.getTaskHistory();
    state.latestTask = history[0] || null;
    renderLatestTask();
  } catch (_error) {
    state.latestTask = null;
    renderLatestTask();
  }
}

function renderLatestTask() {
  const node = $("latestTask");
  const task = state.latestTask;
  if (!task) {
    node.textContent = "暂无任务记录";
    return;
  }
  const time = task.createdAt ? new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false }) : "";
  const source = task.source === "incognito" ? "自动清理" : task.source === "retry" ? "失败重试" : "手动删除";
  node.textContent = `${source}：${task.summary || "任务完成"}${time ? ` · ${time}` : ""}`;
}

function bindActions() {
  const bind = (id, eventName, handler) => {
    const node = $(id);
    if (!node) {
      console.warn(`[Doubao Toolkit] Popup control missing: ${id}`);
      return null;
    }
    node.addEventListener(eventName, handler);
    return node;
  };

  bind("toggleModeBtn", "click", async () => {
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

  bind("selectAllBtn", "click", async () => {
    try {
      const allSelected =
        (state.snapshot.totalSessions || 0) > 0 && (state.snapshot.selectedCount || 0) >= (state.snapshot.totalSessions || 0);
      const response = await sendToContent(allSelected ? "DTK_CLEAR_SELECTION" : "DTK_SELECT_ALL");
      if (response?.ok) {
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  bind("clearSelectionBtn", "click", async () => {
    try {
      const response = await sendToContent("DTK_CLEAR_SELECTION");
      if (response?.ok) {
        applyState(response.state);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  bind("deleteSelectedBtn", "click", async () => {
    setMessage("正在删除已选对话...");
    try {
      const response = await sendToContent("DTK_DELETE_SELECTED");
      if (!response?.ok) {
        setMessage(response?.error || "删除已选失败。", true);
      } else {
        const result = response.result || {};
        setMessage(formatDeleteResult(result));
        applyState(response.state);
        await refreshHistory();
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  bind("deleteAllBtn", "click", async () => {
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
        await refreshHistory();
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  bind("cancelDeleteBtn", "click", async () => {
    setMessage("正在请求取消删除...");
    try {
      const response = await sendToContent("DTK_CANCEL_DELETE");
      if (response?.ok && response.result?.ok) {
        applyState(response.state);
        setMessage("已请求取消，当前对话处理完成后停止。");
      } else {
        setMessage("当前没有正在执行的删除任务。");
        if (response?.state) {
          applyState(response.state);
        }
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  bind("incognitoToggle", "change", async () => {
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

  bind("incognitoInterval", "change", async () => {
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

  bind("retryFailedBtn", "click", async () => {
    setMessage("正在重试失败项...");
    try {
      const response = await sendToContent("DTK_RETRY_FAILED_DELETES");
      if (response?.ok) {
        applyState(response.state);
        setMessage(formatDeleteResult(response.result));
        await refreshHistory();
      } else {
        setMessage(response?.error || "重试失败项失败。", true);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  bind("openOptionsBtn", "click", () => {
    chrome.runtime.openOptionsPage();
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
    await refreshDeleteStats();
    await refreshState();
  }
  await refreshHistory();
}

document.addEventListener("DOMContentLoaded", bootstrap);
