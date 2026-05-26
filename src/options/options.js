const DOUBAO_URL_PATTERNS = ["*://*.doubao.com/*", "*://doubao.com/*"];

const fields = {
  apiFallbackToUi: document.getElementById("apiFallbackToUi"),
  debugLogs: document.getElementById("debugLogs"),
  deleteStepDelayMs: document.getElementById("deleteStepDelayMs"),
  maxRetryAttempts: document.getElementById("maxRetryAttempts"),
  incognitoModeEnabled: document.getElementById("incognitoModeEnabled"),
  incognitoIntervalMinutes: document.getElementById("incognitoIntervalMinutes")
};

const saveStatus = document.getElementById("saveStatus");
const incognitoSummary = document.getElementById("incognitoSummary");
const historyList = document.getElementById("historyList");
const historyDetail = document.getElementById("historyDetail");
const historySearchInput = document.getElementById("historySearchInput");
const historyStatusFilter = document.getElementById("historyStatusFilter");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const exportHistoryBtn = document.getElementById("exportHistoryBtn");
const exportDiagnosticsBtn = document.getElementById("exportDiagnosticsBtn");
const openDoubaoPageBtn = document.getElementById("openDoubaoPageBtn");
const runHealthCheckBtn = document.getElementById("runHealthCheckBtn");
const exportHealthReportBtn = document.getElementById("exportHealthReportBtn");
const diagnosticsPreview = document.getElementById("diagnosticsPreview");
const exportSettingsBtn = document.getElementById("exportSettingsBtn");
const importSettingsBtn = document.getElementById("importSettingsBtn");
const resetSettingsBtn = document.getElementById("resetSettingsBtn");
const importSettingsFile = document.getElementById("importSettingsFile");
const overviewHistoryCount = document.getElementById("overviewHistoryCount");
const overviewHistoryMeta = document.getElementById("overviewHistoryMeta");
const overviewFailedCount = document.getElementById("overviewFailedCount");
const overviewStorageBytes = document.getElementById("overviewStorageBytes");
const overviewStorageMeta = document.getElementById("overviewStorageMeta");
const overviewDoubaoTabs = document.getElementById("overviewDoubaoTabs");
const overviewDoubaoMeta = document.getElementById("overviewDoubaoMeta");

let saveTimer = null;
let historyCache = [];
let lastHealthReport = null;

function setStatus(text, isError = false) {
  saveStatus.textContent = text;
  saveStatus.style.color = isError ? "var(--o-danger)" : "";
}

function clamp(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

async function loadSettings() {
  const settings = await DoubaoToolkitStorage.getSettings();
  fields.apiFallbackToUi.checked = Boolean(settings.apiFallbackToUi);
  fields.debugLogs.checked = Boolean(settings.debugLogs);
  fields.deleteStepDelayMs.value = String(clamp(settings.deleteStepDelayMs, 80, 2000, 300));
  fields.maxRetryAttempts.value = String(clamp(settings.maxRetryAttempts, 1, 10, 5));
  fields.incognitoModeEnabled.checked = Boolean(settings.incognitoModeEnabled);
  fields.incognitoIntervalMinutes.value = String(clamp(settings.incognitoIntervalMinutes, 1, 1440, 10));
  renderIncognitoSummary(settings);
}

function collectSettings() {
  const incognitoIntervalMinutes = clamp(fields.incognitoIntervalMinutes.value, 1, 1440, 10);
  const incognitoModeEnabled = fields.incognitoModeEnabled.checked;
  return {
    apiFallbackToUi: fields.apiFallbackToUi.checked,
    debugLogs: fields.debugLogs.checked,
    deleteStepDelayMs: clamp(fields.deleteStepDelayMs.value, 80, 2000, 300),
    maxRetryAttempts: clamp(fields.maxRetryAttempts.value, 1, 10, 5),
    incognitoModeEnabled,
    incognitoIntervalMinutes,
    incognitoNextRunAt: incognitoModeEnabled ? Date.now() + incognitoIntervalMinutes * 60 * 1000 : null
  };
}

function sanitizeImportedSettings(value) {
  const input = value?.settings && typeof value.settings === "object" ? value.settings : value;
  if (!input || typeof input !== "object") {
    throw new Error("设置文件格式无效。");
  }
  return {
    apiFallbackToUi: input.apiFallbackToUi !== false,
    debugLogs: input.debugLogs !== false,
    deleteStepDelayMs: clamp(input.deleteStepDelayMs, 80, 2000, 300),
    maxRetryAttempts: clamp(input.maxRetryAttempts, 1, 10, 5),
    incognitoModeEnabled: Boolean(input.incognitoModeEnabled),
    incognitoIntervalMinutes: clamp(input.incognitoIntervalMinutes, 1, 1440, 10),
    incognitoNextRunAt: Boolean(input.incognitoModeEnabled)
      ? Date.now() + clamp(input.incognitoIntervalMinutes, 1, 1440, 10) * 60 * 1000
      : null
  };
}

function renderIncognitoSummary(settings) {
  if (!settings.incognitoModeEnabled) {
    incognitoSummary.textContent = "未开启";
    return;
  }
  const nextRunAt = Number(settings.incognitoNextRunAt || 0);
  if (!nextRunAt) {
    incognitoSummary.textContent = `每 ${settings.incognitoIntervalMinutes || 10} 分钟清理`;
    return;
  }
  const minutes = Math.max(1, Math.ceil((nextRunAt - Date.now()) / 60000));
  incognitoSummary.textContent = `约 ${minutes} 分钟后清理`;
}

async function saveSettingsNow() {
  try {
    const settings = await DoubaoToolkitStorage.saveSettings(collectSettings());
    await syncBackgroundAlarm();
    await notifyDoubaoTabs();
    renderIncognitoSummary(settings);
    await refreshOverview();
    setStatus(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
  } catch (error) {
    setStatus(error?.message || "保存失败", true);
  }
}

async function saveImportedSettings(settings) {
  const saved = await DoubaoToolkitStorage.saveSettings(settings);
  await syncBackgroundAlarm();
  await notifyDoubaoTabs();
  await loadSettings();
  await refreshOverview();
  renderIncognitoSummary(saved);
  setStatus("设置已导入并同步");
}

async function resetSettingsToDefaults() {
  const confirmed = window.confirm("确定恢复默认设置吗？这会关闭无痕模式并重置删除策略与性能参数。");
  if (!confirmed) {
    return;
  }
  try {
    const settings = await DoubaoToolkitStorage.resetSettings();
    await syncBackgroundAlarm();
    await notifyDoubaoTabs();
    await loadSettings();
    await refreshOverview();
    renderIncognitoSummary(settings);
    setStatus("已恢复默认设置并同步");
  } catch (error) {
    setStatus(error?.message || "恢复默认设置失败", true);
  }
}

function scheduleSave() {
  setStatus("正在保存...");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveSettingsNow, 260);
}

async function syncBackgroundAlarm() {
  try {
    await chrome.runtime.sendMessage({ type: "DTK_SW_SYNC_INCOGNITO" });
  } catch (_error) {
    // Content pages still read saved settings; alarm sync will retry on startup.
  }
}

async function notifyDoubaoTabs() {
  const tabMap = new Map();
  for (const url of DOUBAO_URL_PATTERNS) {
    const tabs = await chrome.tabs.query({ url });
    for (const tab of tabs) {
      if (tab?.id) {
        tabMap.set(tab.id, tab);
      }
    }
  }
  await Promise.all(
    Array.from(tabMap.keys()).map(async (tabId) => {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "DTK_RELOAD_SETTINGS" });
      } catch (_error) {
        // Ignore tabs without an injected content script.
      }
    })
  );
}

async function loadHistory() {
  const history = await DoubaoToolkitStorage.getTaskHistory();
  historyCache = history;
  renderHistory();
  await refreshOverview(history);
  return history;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
}

async function countDoubaoTabs() {
  const tabMap = new Map();
  for (const url of DOUBAO_URL_PATTERNS) {
    const tabs = await chrome.tabs.query({ url });
    for (const tab of tabs) {
      if (tab?.id) {
        tabMap.set(tab.id, tab);
      }
    }
  }
  return {
    total: tabMap.size,
    active: Array.from(tabMap.values()).filter((tab) => tab.active).length
  };
}

async function refreshOverview(historySnapshot = null) {
  try {
    const [stats, tabStats] = await Promise.all([
      DoubaoToolkitStorage.getStorageStats(),
      countDoubaoTabs()
    ]);
    const history = historySnapshot || (await DoubaoToolkitStorage.getTaskHistory());
    const lastTaskAt = stats.lastTaskAt || history[0]?.createdAt || null;
    overviewHistoryCount.textContent = String(stats.historyCount || history.length || 0);
    overviewHistoryMeta.textContent = lastTaskAt
      ? `最近 ${new Date(lastTaskAt).toLocaleString("zh-CN", { hour12: false })}`
      : "暂无记录";
    overviewFailedCount.textContent = String(stats.failedTaskCount || 0);
    overviewStorageBytes.textContent = formatBytes(stats.totalBytes);
    overviewStorageMeta.textContent = `历史 ${formatBytes(stats.historyBytes)} / 设置 ${formatBytes(stats.settingsBytes)}`;
    overviewDoubaoTabs.textContent = String(tabStats.total);
    overviewDoubaoMeta.textContent = tabStats.total > 0 ? `${tabStats.active} 个当前激活` : "未打开豆包页面";
  } catch (error) {
    overviewHistoryMeta.textContent = error?.message || "概览加载失败";
    overviewDoubaoMeta.textContent = "检测失败";
  }
}

function getHistorySourceLabel(task) {
  return task.source === "incognito" ? "自动清理" : task.source === "retry" ? "失败重试" : "手动删除";
}

function getFilteredHistory() {
  const keyword = String(historySearchInput?.value || "").trim().toLowerCase();
  const status = historyStatusFilter?.value || "all";
  return historyCache.filter((task) => {
    const failed = task?.ok === false || Number(task?.failed || 0) > 0;
    if (status === "success" && failed) {
      return false;
    }
    if (status === "failed" && !failed) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const haystack = [
      getHistorySourceLabel(task),
      task.summary,
      task.mode,
      task.url,
      ...Object.keys(task.failureSummary || {}),
      ...(task.failureDetails || []).flatMap((item) => [item.title, item.label, item.message, item.suggestion])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

function renderHistory() {
  const history = getFilteredHistory();
  historyList.innerHTML = "";
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = historyCache.length ? "没有符合筛选条件的任务记录。" : "暂无任务记录。";
    historyList.appendChild(empty);
    historyDetail.textContent = "选择一条任务查看详情。";
    return;
  }

  for (const task of history) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.tabIndex = 0;

    const source = document.createElement("strong");
    source.textContent = getHistorySourceLabel(task);

    const detail = document.createElement("span");
    detail.textContent = task.summary || `完成 ${task.done || 0}，失败 ${task.failed || 0}`;

    const meta = document.createElement("small");
    meta.className = task.ok ? "history-ok" : "history-failed";
    const time = task.createdAt ? new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false }) : "";
    meta.textContent = `${task.ok ? "成功" : "异常"}${time ? ` · ${time}` : ""}`;

    item.append(source, detail, meta);
    const showDetail = () => {
      historyDetail.textContent = JSON.stringify(task, null, 2);
    };
    item.addEventListener("click", showDetail);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showDetail();
      }
    });
    historyList.appendChild(item);
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

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportSettings() {
  try {
    const settings = await DoubaoToolkitStorage.getSettings();
    downloadJson(`doubao-toolkit-settings-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, {
      exportedAt: new Date().toISOString(),
      app: "Doubao Toolkit",
      settings
    });
    setStatus("设置已导出");
  } catch (error) {
    setStatus(error?.message || "导出设置失败", true);
  }
}

async function exportHistory() {
  try {
    const [history, stats] = await Promise.all([
      DoubaoToolkitStorage.getTaskHistory(),
      DoubaoToolkitStorage.getStorageStats()
    ]);
    downloadJson(`doubao-toolkit-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, {
      exportedAt: new Date().toISOString(),
      app: "Doubao Toolkit",
      stats,
      history
    });
    setStatus("任务历史已导出");
  } catch (error) {
    setStatus(error?.message || "导出任务历史失败", true);
  }
}

function importSettingsFromFile(file) {
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      await saveImportedSettings(sanitizeImportedSettings(parsed));
    } catch (error) {
      setStatus(error?.message || "导入设置失败", true);
    } finally {
      importSettingsFile.value = "";
    }
  });
  reader.addEventListener("error", () => {
    setStatus("读取设置文件失败", true);
    importSettingsFile.value = "";
  });
  reader.readAsText(file, "utf-8");
}

async function exportDiagnostics() {
  setStatus("正在生成诊断报告...");
  diagnosticsPreview.textContent = "正在读取当前豆包页面状态...";
  try {
    const tab = await findDoubaoTab();
    if (!tab?.id) {
      throw new Error("未找到打开的豆包页面。");
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "DTK_GET_DIAGNOSTICS" });
    if (!response?.ok) {
      throw new Error(response?.error || "诊断命令执行失败。");
    }
    const payload = {
      extension: "Doubao Toolkit",
      tab: {
        id: tab.id,
        url: tab.url,
        title: tab.title
      },
      diagnostics: response.diagnostics
    };
    diagnosticsPreview.textContent = JSON.stringify(payload, null, 2);
    downloadJson(`doubao-toolkit-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, payload);
    await refreshOverview();
    setStatus("诊断报告已导出");
  } catch (error) {
    diagnosticsPreview.textContent = error?.message || "诊断报告生成失败。";
    setStatus(error?.message || "诊断报告生成失败", true);
  }
}

async function openDoubaoPage() {
  try {
    const tab = await findDoubaoTab();
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      setStatus("已切换到豆包页面");
      await refreshOverview();
      return;
    }
    await chrome.tabs.create({ url: "https://www.doubao.com/" });
    setStatus("已打开豆包页面");
    window.setTimeout(refreshOverview, 800);
  } catch (error) {
    setStatus(error?.message || "打开豆包页面失败", true);
  }
}

function buildHealthReport({ tab, diagnostics, stats, tabStats }) {
  const checks = [];
  const state = diagnostics?.state || {};
  const sessionProbe = diagnostics?.sessionProbe || {};
  const api = diagnostics?.api || {};

  checks.push({
    name: "豆包页面",
    ok: Boolean(tab?.id),
    detail: tab?.id ? `已连接：${tab.title || tab.url || `Tab ${tab.id}`}` : "未找到已打开的豆包页面"
  });
  checks.push({
    name: "内容脚本",
    ok: Boolean(diagnostics?.generatedAt),
    detail: diagnostics?.generatedAt ? `诊断时间：${diagnostics.generatedAt}` : "无法读取页面诊断"
  });
  checks.push({
    name: "会话识别",
    ok: Number(sessionProbe.total || 0) > 0,
    detail: `识别到 ${sessionProbe.total || 0} 个对话`
  });
  checks.push({
    name: "删除 API",
    ok: Boolean(api?.hasCachedDeleteUrl || state?.settings?.apiFallbackToUi),
    detail: api?.hasCachedDeleteUrl ? "已缓存删除接口" : "未缓存接口，将使用 UI 回退"
  });
  checks.push({
    name: "任务历史",
    ok: Number(stats.historyCount || 0) < Number(stats.maxTaskHistory || 20),
    detail: `${stats.historyCount || 0}/${stats.maxTaskHistory || 20} 条，失败 ${stats.failedTaskCount || 0} 条`
  });
  checks.push({
    name: "后台清理",
    ok: !state.incognitoModeEnabled || tabStats.total > 0,
    detail: state.incognitoModeEnabled
      ? `无痕模式已开启，${state.incognitoNextRunAt ? "已有下次运行时间" : "等待后台同步"}`
      : "无痕模式未开启"
  });

  const okCount = checks.filter((item) => item.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    summary: `${okCount}/${checks.length} 项正常`,
    checks,
    tab: tab
      ? {
          id: tab.id,
          title: tab.title,
          url: tab.url
        }
      : null,
    tabStats,
    stats,
    diagnostics
  };
}

function renderHealthReport(report) {
  diagnosticsPreview.textContent = [
    `健康检查：${report.summary}`,
    "",
    ...report.checks.map((item) => `${item.ok ? "OK" : "WARN"} ${item.name}：${item.detail}`),
    "",
    "完整诊断：",
    JSON.stringify(report, null, 2)
  ].join("\n");
}

async function runHealthCheck() {
  setStatus("正在运行健康检查...");
  diagnosticsPreview.textContent = "正在检查豆包页面、内容脚本、会话识别和本地存储...";
  try {
    const [tab, stats, tabStats] = await Promise.all([
      findDoubaoTab(),
      DoubaoToolkitStorage.getStorageStats(),
      countDoubaoTabs()
    ]);
    if (!tab?.id) {
      const report = buildHealthReport({ tab: null, diagnostics: null, stats, tabStats });
      renderHealthReport(report);
      lastHealthReport = report;
      setStatus("健康检查完成：未找到豆包页面", true);
      await refreshOverview();
      return report;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "DTK_GET_DIAGNOSTICS" });
    if (!response?.ok) {
      throw new Error(response?.error || "诊断命令执行失败。");
    }
    const report = buildHealthReport({ tab, diagnostics: response.diagnostics, stats, tabStats });
    renderHealthReport(report);
    lastHealthReport = report;
    setStatus(`健康检查完成：${report.summary}`, report.checks.some((item) => !item.ok));
    await refreshOverview();
    return report;
  } catch (error) {
    diagnosticsPreview.textContent = error?.message || "健康检查失败。";
    setStatus(error?.message || "健康检查失败", true);
    return null;
  }
}

async function exportHealthReport() {
  try {
    const report = lastHealthReport || (await runHealthCheck());
    if (!report) {
      return;
    }
    downloadJson(`doubao-toolkit-health-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, {
      exportedAt: new Date().toISOString(),
      app: "Doubao Toolkit",
      report
    });
    setStatus("健康报告已导出");
  } catch (error) {
    setStatus(error?.message || "导出健康报告失败", true);
  }
}

function bindEvents() {
  for (const field of Object.values(fields)) {
    field.addEventListener("change", scheduleSave);
    if (field.type === "number") {
      field.addEventListener("input", scheduleSave);
    }
  }

  clearHistoryBtn.addEventListener("click", async () => {
    if (!window.confirm("确定清空任务历史吗？这不会影响当前设置。")) {
      return;
    }
    await DoubaoToolkitStorage.clearTaskHistory();
    await loadHistory();
    setStatus("任务历史已清空");
  });

  exportDiagnosticsBtn.addEventListener("click", exportDiagnostics);
  openDoubaoPageBtn.addEventListener("click", openDoubaoPage);
  runHealthCheckBtn.addEventListener("click", runHealthCheck);
  exportHealthReportBtn.addEventListener("click", exportHealthReport);
  exportHistoryBtn.addEventListener("click", exportHistory);
  exportSettingsBtn.addEventListener("click", exportSettings);
  importSettingsBtn.addEventListener("click", () => importSettingsFile.click());
  resetSettingsBtn.addEventListener("click", resetSettingsToDefaults);
  importSettingsFile.addEventListener("change", () => importSettingsFromFile(importSettingsFile.files?.[0]));
  historySearchInput.addEventListener("input", renderHistory);
  historyStatusFilter.addEventListener("change", renderHistory);
}

async function bootstrap() {
  bindEvents();
  await loadSettings();
  await loadHistory();
  await refreshOverview();
  setStatus("已加载");
}

document.addEventListener("DOMContentLoaded", bootstrap);
