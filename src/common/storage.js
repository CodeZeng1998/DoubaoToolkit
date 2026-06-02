(function initDoubaoToolkitStorage(global) {
  "use strict";

  const SETTINGS_KEY = "dtk_settings_v1";
  const TASK_HISTORY_KEY = "dtk_task_history_v1";
  const MAX_TASK_HISTORY = 20;

  const DEFAULT_SETTINGS = {
    autoReloadAfterDeleteAll: true,
    debugLogs: true,
    apiFallbackToUi: true,
    deleteStepDelayMs: 300,
    maxRetryAttempts: 5,
    incognitoModeEnabled: false,
    incognitoIntervalMinutes: 10,
    incognitoSkipActive: true,
    incognitoNextRunAt: null,
    incognitoLastRunAt: null,
    incognitoLastResult: null,
    popupTheme: "light"
  };

  function hasChromeStorage() {
    return Boolean(global.chrome?.storage?.local);
  }

  function storageGet(keys) {
    if (hasChromeStorage()) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message || "读取扩展存储失败。"));
            return;
          }
          resolve(result || {});
        });
      });
    }
    const result = {};
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      try {
        const raw = global.localStorage?.getItem(key);
        result[key] = raw ? JSON.parse(raw) : undefined;
      } catch (_error) {
        result[key] = undefined;
      }
    }
    return Promise.resolve(result);
  }

  function storageSet(value) {
    if (hasChromeStorage()) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(value, () => {
          const error = chrome.runtime?.lastError;
          if (error) {
            reject(new Error(error.message || "写入扩展存储失败。"));
            return;
          }
          resolve();
        });
      });
    }
    for (const [key, item] of Object.entries(value || {})) {
      try {
        global.localStorage?.setItem(key, JSON.stringify(item));
      } catch (_error) {
        // Ignore storage failures; callers still keep in-memory defaults.
      }
    }
    return Promise.resolve();
  }

  async function getSettings() {
    const result = await storageGet([SETTINGS_KEY]);
    return {
      ...DEFAULT_SETTINGS,
      ...(result[SETTINGS_KEY] || {})
    };
  }

  async function saveSettings(patch) {
    const next = {
      ...(await getSettings()),
      ...(patch || {})
    };
    await storageSet({ [SETTINGS_KEY]: next });
    return next;
  }

  async function resetSettings() {
    const next = { ...DEFAULT_SETTINGS };
    await storageSet({ [SETTINGS_KEY]: next });
    return next;
  }

  async function getTaskHistory() {
    const result = await storageGet([TASK_HISTORY_KEY]);
    return Array.isArray(result[TASK_HISTORY_KEY]) ? result[TASK_HISTORY_KEY] : [];
  }

  async function addTaskHistory(task) {
    const history = await getTaskHistory();
    const next = [
      {
        id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toISOString(),
        ...task
      },
      ...history
    ].slice(0, MAX_TASK_HISTORY);
    await storageSet({ [TASK_HISTORY_KEY]: next });
    return next;
  }

  async function clearTaskHistory() {
    await storageSet({ [TASK_HISTORY_KEY]: [] });
    return [];
  }

  function estimateBytes(value) {
    const text = JSON.stringify(value ?? null);
    try {
      return new Blob([text]).size;
    } catch (_error) {
      return text.length;
    }
  }

  async function getStorageStats() {
    const settings = await getSettings();
    const history = await getTaskHistory();
    const failedTaskCount = history.filter((task) => task?.ok === false || Number(task?.failed || 0) > 0).length;
    const successTaskCount = history.filter((task) => task?.ok !== false && Number(task?.failed || 0) === 0).length;
    const settingsBytes = estimateBytes(settings);
    const historyBytes = estimateBytes(history);
    return {
      settingsBytes,
      historyBytes,
      totalBytes: settingsBytes + historyBytes,
      historyCount: history.length,
      maxTaskHistory: MAX_TASK_HISTORY,
      failedTaskCount,
      successTaskCount,
      lastTaskAt: history[0]?.createdAt || null
    };
  }

  global.DoubaoToolkitStorage = {
    SETTINGS_KEY,
    TASK_HISTORY_KEY,
    DEFAULT_SETTINGS,
    MAX_TASK_HISTORY,
    getSettings,
    saveSettings,
    resetSettings,
    getTaskHistory,
    addTaskHistory,
    clearTaskHistory,
    getStorageStats
  };
})(globalThis);
