importScripts("../common/storage.js");

const ALARM_NAME = "dtk_incognito_cleanup";
const DOUBAO_URL_PATTERNS = ["*://*.doubao.com/*", "*://doubao.com/*"];

chrome.runtime.onInstalled.addListener(() => {
  runBackgroundTask("sync incognito alarm on install", syncIncognitoAlarm);
  console.log("[Doubao Toolkit] Service worker installed.");
});

chrome.runtime.onStartup.addListener(() => {
  runBackgroundTask("sync incognito alarm on startup", syncIncognitoAlarm);
  runBackgroundTask("update badge on startup", updateActionBadge);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runBackgroundTask("run incognito cleanup", runIncognitoCleanup);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes[DoubaoToolkitStorage.SETTINGS_KEY] || changes[DoubaoToolkitStorage.TASK_HISTORY_KEY])
  ) {
    runBackgroundTask("update badge after storage change", updateActionBadge);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "DTK_SW_PING") {
    sendResponse({
      ok: true,
      from: "service-worker",
      tabId: sender.tab?.id ?? null
    });
    return false;
  }

  if (message.type === "DTK_SW_SYNC_INCOGNITO") {
    syncIncognitoAlarm()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "同步无痕模式失败。" }));
    return true;
  }

  if (message.type === "DTK_SW_GET_HISTORY") {
    DoubaoToolkitStorage.getTaskHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "读取任务历史失败。" }));
    return true;
  }

  if (message.type === "DTK_SW_CLEAR_HISTORY") {
    DoubaoToolkitStorage.clearTaskHistory()
      .then(async (history) => {
        await updateActionBadge();
        sendResponse({ ok: true, history });
      })
      .catch((error) => sendResponse({ ok: false, error: error?.message || "清空任务历史失败。" }));
    return true;
  }

  if (message.type === "DTK_SW_REFRESH_BADGE") {
    updateActionBadge()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "刷新扩展徽标失败。" }));
    return true;
  }

  return false;
});

function runBackgroundTask(label, task) {
  try {
    const result = task?.();
    if (result?.catch) {
      result.catch((error) => {
        console.warn(`[Doubao Toolkit] ${label} failed.`, error);
      });
    }
    return result;
  } catch (error) {
    console.warn(`[Doubao Toolkit] ${label} failed.`, error);
    return null;
  }
}

async function syncIncognitoAlarm() {
  const settings = await DoubaoToolkitStorage.getSettings();
  await chrome.alarms.clear(ALARM_NAME);

  if (!settings.incognitoModeEnabled) {
    const next = await DoubaoToolkitStorage.saveSettings({ incognitoNextRunAt: null });
    await updateActionBadge(next);
    return next;
  }

  const intervalMinutes = clampInterval(settings.incognitoIntervalMinutes);
  const nextRunAt = Date.now() + intervalMinutes * 60 * 1000;
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes
  });
  const next = await DoubaoToolkitStorage.saveSettings({
    incognitoIntervalMinutes: intervalMinutes,
    incognitoNextRunAt
  });
  await updateActionBadge(next);
  return next;
}

async function runIncognitoCleanup() {
  const startedAt = new Date().toISOString();
  const settings = await DoubaoToolkitStorage.getSettings();
  if (!settings.incognitoModeEnabled) {
    await syncIncognitoAlarm();
    return;
  }

  const tab = await findDoubaoTab();
  if (!tab?.id) {
    const result = {
      ok: false,
      reason: "no_doubao_tab",
      message: "未找到打开的豆包页面，自动清理未执行。"
    };
    await DoubaoToolkitStorage.addTaskHistory({
      source: "incognito",
      mode: "all",
      ok: false,
      done: 0,
      failed: 0,
      total: 0,
      summary: result.message,
      result
    });
    await updateActionBadge();
    await DoubaoToolkitStorage.saveSettings({
      incognitoLastRunAt: startedAt,
      incognitoLastResult: result
    });
    await syncIncognitoAlarm();
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "DTK_RUN_INCOGNITO_CLEANUP"
    });
    const result = response?.result || {
      ok: false,
      reason: "unknown",
      message: "自动清理没有返回结果。"
    };
    await DoubaoToolkitStorage.saveSettings({
      incognitoLastRunAt: startedAt,
      incognitoLastResult: result
    });
  } catch (error) {
    const result = {
      ok: false,
      reason: "content_unavailable",
      message: error?.message || "豆包页面脚本不可用。"
    };
    await DoubaoToolkitStorage.addTaskHistory({
      source: "incognito",
      mode: "all",
      ok: false,
      done: 0,
      failed: 0,
      total: 0,
      summary: result.message,
      result
    });
    await DoubaoToolkitStorage.saveSettings({
      incognitoLastRunAt: startedAt,
      incognitoLastResult: result
    });
  } finally {
    await syncIncognitoAlarm();
    await updateActionBadge();
  }
}

async function updateActionBadge(settingsSnapshot = null) {
  if (!chrome.action?.setBadgeText) {
    return null;
  }
  try {
    const [settings, stats] = await Promise.all([
      settingsSnapshot ? Promise.resolve(settingsSnapshot) : DoubaoToolkitStorage.getSettings(),
      DoubaoToolkitStorage.getStorageStats()
    ]);
    if (stats.failedTaskCount > 0) {
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setBadgeBackgroundColor({ color: "#d94848" });
      await chrome.action.setTitle({
        title: `豆包工具箱：${stats.failedTaskCount} 条异常任务，点击查看`
      });
      return { badge: "failed", failedTaskCount: stats.failedTaskCount };
    }
    if (settings.incognitoModeEnabled) {
      await chrome.action.setBadgeText({ text: "隐" });
      await chrome.action.setBadgeBackgroundColor({ color: "#1f6fff" });
      await chrome.action.setTitle({ title: "豆包工具箱：无痕模式已开启" });
      return { badge: "incognito", failedTaskCount: 0 };
    }
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "豆包工具箱" });
    return { badge: "normal", failedTaskCount: 0 };
  } catch (error) {
    console.warn("[Doubao Toolkit] Update action badge failed.", error);
    return null;
  }
}

async function findDoubaoTab() {
  for (const url of DOUBAO_URL_PATTERNS) {
    const tabs = await chrome.tabs.query({ url });
    const active = tabs.find((tab) => tab.active);
    if (active) {
      return active;
    }
    if (tabs[0]) {
      return tabs[0];
    }
  }
  return null;
}

function clampInterval(value) {
  const minutes = Math.round(Number(value) || 10);
  return Math.min(Math.max(minutes, 1), 1440);
}
