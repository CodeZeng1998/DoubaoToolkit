(function initSessionManager(global) {
  "use strict";

  const toolkit = global.DoubaoToolkit || {};
  const config = toolkit.config;
  const logger = toolkit.logger;
  const retry = toolkit.retry;
  const domUtils = toolkit.domUtils;
  const toast = toolkit.toast;
  const modal = toolkit.modal;
  const progress = toolkit.progress;
  const chatSelectors = toolkit.chatSelectors;
  const apiClient = toolkit.apiClient;
  const DELETE_ALL_UNLOCK_KEY = "dtk_delete_all_unlocked_v1";
  const INCOGNITO_ENABLED_KEY = "dtk_incognito_enabled_v1";
  const INCOGNITO_INTERVAL_KEY = "dtk_incognito_interval_minutes_v1";
  const DEFAULT_INCOGNITO_INTERVAL_MINUTES = 10;
  const MIN_INCOGNITO_INTERVAL_MINUTES = 1;
  const MAX_INCOGNITO_INTERVAL_MINUTES = 1440;

  const FAILURE_LABELS = {
    api_failed: "接口失败",
    missing_conversation_id: "未找到对话 ID",
    node_changed: "页面节点已变化",
    auth_expired: "权限/登录失效",
    ui_fallback_failed: "UI 回退失败",
    unknown: "未知失败"
  };

  class SessionManager {
    constructor() {
      this.multiSelectMode = false;
      this.selectedIds = new Set();
      this.sessionMap = new Map();
      this.isDeleting = false;
      this.observer = null;
      this.refreshTimer = null;
      this.lastKnownUrl = location.href;
      this.deleteAllUnlocked = this.readDeleteAllUnlocked();
      this.incognitoModeEnabled = this.readBooleanSetting(INCOGNITO_ENABLED_KEY, false);
      this.incognitoIntervalMinutes = this.readNumberSetting(
        INCOGNITO_INTERVAL_KEY,
        DEFAULT_INCOGNITO_INTERVAL_MINUTES,
        MIN_INCOGNITO_INTERVAL_MINUTES,
        MAX_INCOGNITO_INTERVAL_MINUTES
      );
      this.incognitoTimer = null;
      this.incognitoNextRunAt = null;
    }

    init() {
      this.refreshSessions();
      this.startDomObserver();
      this.startSpaObserver();
      this.syncIncognitoTimer();
      logger.info("Session manager initialized.");
    }

    refreshSessions() {
      const sessions = chatSelectors.getSessionItems();
      this.sessionMap.clear();
      for (const session of sessions) {
        this.sessionMap.set(session.id, session);
      }

      for (const id of Array.from(this.selectedIds)) {
        if (!this.sessionMap.has(id)) {
          this.selectedIds.delete(id);
        }
      }

      if (this.multiSelectMode) {
        this.renderSelectionControls();
      }
      this.emitState();
    }

    scheduleRefresh() {
      if (this.refreshTimer) {
        window.clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = window.setTimeout(() => {
        this.refreshSessions();
      }, config.timing.sessionRefreshDebounceMs);
    }

    startDomObserver() {
      if (this.observer) {
        return;
      }
      this.observer = new MutationObserver(() => {
        this.scheduleRefresh();
      });
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
    }

    startSpaObserver() {
      const originalPush = history.pushState;
      const originalReplace = history.replaceState;
      const onRouteUpdate = () => {
        if (this.lastKnownUrl !== location.href) {
          this.lastKnownUrl = location.href;
          logger.debug("Route changed:", location.href);
          this.scheduleRefresh();
        }
      };

      history.pushState = (...args) => {
        const result = originalPush.apply(history, args);
        onRouteUpdate();
        return result;
      };
      history.replaceState = (...args) => {
        const result = originalReplace.apply(history, args);
        onRouteUpdate();
        return result;
      };
      window.addEventListener("popstate", onRouteUpdate);
      window.setInterval(onRouteUpdate, 1200);
    }

    setMultiSelectMode(enabled) {
      this.multiSelectMode = Boolean(enabled);
      document.documentElement.classList.toggle("dtk-multi-select-enabled", this.multiSelectMode);
      if (!this.multiSelectMode) {
        this.selectedIds.clear();
      }
      this.renderSelectionControls();
      this.emitState();
      toast.show(this.multiSelectMode ? "已开启多选。" : "已关闭多选。", "info");
    }

    toggleSessionSelection(sessionId) {
      if (!this.multiSelectMode) {
        return;
      }
      if (this.selectedIds.has(sessionId)) {
        this.selectedIds.delete(sessionId);
      } else {
        this.selectedIds.add(sessionId);
      }
      this.renderSelectionControls();
      this.emitState();
    }

    selectAll() {
      if (!this.multiSelectMode) {
        this.setMultiSelectMode(true);
      }
      for (const sessionId of this.sessionMap.keys()) {
        this.selectedIds.add(sessionId);
      }
      this.renderSelectionControls();
      this.emitState();
      toast.show(`已选择 ${this.selectedIds.size} 个对话。`, "success");
    }

    clearSelection(silent = false) {
      this.selectedIds.clear();
      this.renderSelectionControls();
      this.emitState();
      if (!silent) {
        toast.show("已清空选择。", "info");
      }
    }

    renderSelectionControls() {
      for (const session of this.sessionMap.values()) {
        const item = session.element;
        if (!(item instanceof HTMLElement)) {
          continue;
        }
        item.classList.toggle("dtk-session-selected", this.selectedIds.has(session.id));
        let checkbox = item.querySelector(".dtk-session-checkbox");

        if (!this.multiSelectMode) {
          if (checkbox) {
            checkbox.remove();
          }
          continue;
        }

        if (!checkbox) {
          checkbox = document.createElement("button");
          checkbox.type = "button";
          checkbox.className = "dtk-session-checkbox";
          checkbox.title = "选择对话";
          checkbox.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleSessionSelection(session.id);
          });
          item.insertBefore(checkbox, item.firstChild);
        }
        checkbox.setAttribute("aria-checked", String(this.selectedIds.has(session.id)));
      }
    }

    getDeleteTargets(mode) {
      if (mode === "all") {
        return Array.from(this.sessionMap.values());
      }
      return Array.from(this.selectedIds)
        .map((id) => this.sessionMap.get(id))
        .filter(Boolean);
    }

    readBooleanSetting(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        if (value === null) {
          return fallback;
        }
        return value === "true";
      } catch (_error) {
        return fallback;
      }
    }

    readNumberSetting(key, fallback, min, max) {
      try {
        const value = Number(localStorage.getItem(key));
        if (!Number.isFinite(value)) {
          return fallback;
        }
        return Math.min(Math.max(Math.round(value), min), max);
      } catch (_error) {
        return fallback;
      }
    }

    writeSetting(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch (_error) {
        logger?.debug("writeSetting failed:", key);
      }
    }

    readDeleteAllUnlocked() {
      try {
        return localStorage.getItem(DELETE_ALL_UNLOCK_KEY) === "true";
      } catch (_error) {
        return false;
      }
    }

    saveDeleteAllUnlocked(value) {
      this.deleteAllUnlocked = Boolean(value);
      try {
        localStorage.setItem(DELETE_ALL_UNLOCK_KEY, String(this.deleteAllUnlocked));
      } catch (_error) {
        logger?.debug("saveDeleteAllUnlocked failed.");
      }
      this.emitState();
    }

    async ensureDeleteAllUnlocked() {
      if (this.deleteAllUnlocked) {
        return true;
      }
      const confirmed = await modal.confirm({
        title: "启用高风险操作",
        message: "“全部删除”默认处于安全模式。启用后，本浏览器将允许使用一键删除全部对话；每次删除前仍会显示删除预览并要求再次确认。",
        confirmText: "启用并继续",
        cancelText: "取消",
        danger: true
      });
      if (!confirmed) {
        return false;
      }
      this.saveDeleteAllUnlocked(true);
      toast.show("已启用全部删除。删除前仍需再次确认。", "warning", 3000);
      return true;
    }

    async confirmIncognitoEnable() {
      return modal.confirm({
        title: "启用无痕模式",
        message: `无痕模式会在豆包页面打开期间，每 ${this.incognitoIntervalMinutes} 分钟自动删除全部历史对话。此操作无法撤销，且自动执行时不会再次弹出删除确认。`,
        confirmText: "启用无痕模式",
        cancelText: "取消",
        danger: true
      });
    }

    async setIncognitoMode(enabled) {
      const nextEnabled = Boolean(enabled);
      if (nextEnabled && !this.incognitoModeEnabled) {
        const confirmed = await this.confirmIncognitoEnable();
        if (!confirmed) {
          return {
            ok: false,
            reason: "cancelled"
          };
        }
        this.saveDeleteAllUnlocked(true);
      }

      this.incognitoModeEnabled = nextEnabled;
      this.writeSetting(INCOGNITO_ENABLED_KEY, this.incognitoModeEnabled);
      this.syncIncognitoTimer();
      this.emitState();
      toast.show(this.incognitoModeEnabled ? "已开启无痕模式。" : "已关闭无痕模式。", "info", 2600);
      return {
        ok: true
      };
    }

    setIncognitoInterval(minutes) {
      const value = Math.min(
        Math.max(Math.round(Number(minutes) || DEFAULT_INCOGNITO_INTERVAL_MINUTES), MIN_INCOGNITO_INTERVAL_MINUTES),
        MAX_INCOGNITO_INTERVAL_MINUTES
      );
      this.incognitoIntervalMinutes = value;
      this.writeSetting(INCOGNITO_INTERVAL_KEY, value);
      this.syncIncognitoTimer();
      this.emitState();
      toast.show(`无痕模式间隔已设为 ${value} 分钟。`, "info", 2400);
      return {
        ok: true,
        intervalMinutes: value
      };
    }

    syncIncognitoTimer() {
      if (this.incognitoTimer) {
        window.clearTimeout(this.incognitoTimer);
        this.incognitoTimer = null;
      }
      this.incognitoNextRunAt = null;
      if (!this.incognitoModeEnabled) {
        this.emitState();
        return;
      }
      const delayMs = this.incognitoIntervalMinutes * 60 * 1000;
      this.incognitoNextRunAt = Date.now() + delayMs;
      this.incognitoTimer = window.setTimeout(() => {
        this.runIncognitoCleanup();
      }, delayMs);
      this.emitState();
    }

    async runIncognitoCleanup() {
      this.incognitoTimer = null;
      if (!this.incognitoModeEnabled) {
        this.incognitoNextRunAt = null;
        this.emitState();
        return;
      }

      if (this.isDeleting) {
        logger.warn("Incognito cleanup skipped because delete task is running.");
        this.syncIncognitoTimer();
        return;
      }

      toast.show("无痕模式开始自动清理历史对话。", "warning", 2600);
      await this.deleteSessions("all", {
        skipConfirm: true,
        skipUnlock: true,
        silentEmpty: true,
        source: "incognito"
      });
      this.syncIncognitoTimer();
    }

    formatPreviewTitle(target, index) {
      const title = String(target?.title || "").trim();
      if (title) {
        return title.length > 36 ? `${title.slice(0, 36)}...` : title;
      }
      return `未命名对话 ${index + 1}`;
    }

    buildDeletePreviewMessage(mode, targets) {
      const count = targets.length;
      const actionText = mode === "all" ? "将删除全部" : "将删除已选";
      const previewLimit = 5;
      const previewTitles = targets.slice(0, previewLimit).map((target, index) => this.formatPreviewTitle(target, index));
      const previewText = previewTitles.length > 0 ? previewTitles.join("、") : "暂无可预览标题";
      const moreText = count > previewLimit ? ` 等 ${count} 个对话` : "";
      return `${actionText} ${count} 个对话，包含：${previewText}${moreText}。此操作无法撤销。`;
    }

    createFailureError(category, message, cause = null) {
      const error = new Error(message);
      error.failureCategory = category;
      if (cause) {
        error.cause = cause;
      }
      return error;
    }

    getFailureCategory(error) {
      return error?.failureCategory || error?.cause?.failureCategory || "unknown";
    }

    addFailureSummary(summary, error) {
      const category = this.getFailureCategory(error);
      summary[category] = (summary[category] || 0) + 1;
      return category;
    }

    formatFailureSummary(summary) {
      const parts = Object.entries(summary)
        .filter(([, count]) => count > 0)
        .map(([category, count]) => `${FAILURE_LABELS[category] || FAILURE_LABELS.unknown} ${count}`);
      return parts.join("、");
    }

    async confirmDelete(mode, targets) {
      const label = mode === "all" ? "确定删除全部对话？" : `确定删除已选的 ${targets.length} 个对话？`;
      return modal.confirm({
        title: "危险操作",
        message: `${label} ${this.buildDeletePreviewMessage(mode, targets)}`,
        confirmText: "删除",
        cancelText: "取消",
        danger: true
      });
    }

    resolveTargetForSelected(id, fallbackTitle) {
      const exact = this.sessionMap.get(id);
      if (exact) {
        return exact;
      }
      if (!fallbackTitle) {
        return null;
      }
      for (const item of this.sessionMap.values()) {
        if (item.title === fallbackTitle) {
          return item;
        }
      }
      return null;
    }

    async deleteSessions(mode, options = {}) {
      if (this.isDeleting) {
        toast.show("已有删除任务正在执行。", "warning");
        return {
          ok: false,
          reason: "busy"
        };
      }

      this.refreshSessions();
      const targets = this.getDeleteTargets(mode);
      if (targets.length === 0) {
        if (!options.silentEmpty) {
          toast.show("没有可删除的对话。", "warning");
        }
        return {
          ok: false,
          reason: "empty"
        };
      }

      if (mode === "all" && !options.skipUnlock && !(await this.ensureDeleteAllUnlocked())) {
        return {
          ok: false,
          reason: "delete_all_locked"
        };
      }

      if (!options.skipConfirm) {
        const confirmed = await this.confirmDelete(mode, targets);
        if (!confirmed) {
          return {
            ok: false,
            reason: "cancelled"
          };
        }
      }

      this.isDeleting = true;
      this.emitState();
      progress.show(options.source === "incognito" ? "无痕模式正在自动清理..." : mode === "all" ? "正在删除全部对话..." : "正在删除已选对话...");

      let done = 0;
      let failed = 0;
      const failureSummary = {};
      const total = targets.length;

      if (mode === "all") {
        const failedIds = new Set();
        let totalEstimate = total;
        while (true) {
          this.refreshSessions();
          const current = Array.from(this.sessionMap.values()).find((item) => !failedIds.has(item.id));
          if (!current) {
            progress.update(done, Math.max(done, totalEstimate), failed);
            break;
          }
          totalEstimate = Math.max(totalEstimate, done + this.sessionMap.size);
          try {
            await this.deleteSingleSession(current);
          } catch (error) {
            failed += 1;
            failedIds.add(current.id);
            this.addFailureSummary(failureSummary, error);
            logger.error("Delete all failed on session:", current.title, error);
          } finally {
            done += 1;
            progress.update(done, Math.max(done, totalEstimate), failed);
          }
        }
      } else {
        const selectedQueue = targets.map((item) => ({
          id: item.id,
          title: item.title,
          conversationId: item.conversationId
        }));
        for (const queueItem of selectedQueue) {
          this.refreshSessions();
          const current = this.resolveTargetForSelected(queueItem.id, queueItem.title) || queueItem;
          if (!current) {
            failed += 1;
            done += 1;
            this.addFailureSummary(
              failureSummary,
              this.createFailureError("node_changed", "Selected target no longer exists.")
            );
            progress.update(done, total, failed);
            logger.warn("Selected target no longer exists:", queueItem.id);
            continue;
          }
          try {
            await this.deleteSingleSession(current);
          } catch (error) {
            failed += 1;
            this.addFailureSummary(failureSummary, error);
            logger.error("Delete selected failed on session:", current.title, error);
          } finally {
            done += 1;
            progress.update(done, total, failed);
          }
        }
      }

      this.isDeleting = false;
      this.emitState();
      progress.hide();
      this.scheduleRefresh();
      this.clearSelection(true);

      if (failed === 0) {
        toast.show(options.source === "incognito" ? `无痕模式已清理 ${done} 个对话。` : `已删除 ${done} 个对话。`, "success");
      } else {
        const reasonText = this.formatFailureSummary(failureSummary);
        const prefix = options.source === "incognito" ? "无痕模式自动清理" : "已删除";
        toast.show(`${prefix} ${done - failed}/${done} 个对话，失败 ${failed} 个。${reasonText ? `原因：${reasonText}。` : ""}`, "error", 5200);
      }

      return {
        ok: failed === 0,
        done,
        failed,
        total,
        failureSummary
      };
    }

    async waitForDeleteAction(referenceNode, timeoutMs = config.timing.menuOpenTimeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const node = chatSelectors.findDeleteActionNode(referenceNode);
        if (node) {
          return node;
        }
        await retry.sleep(config.timing.waitForNodePollMs);
      }
      return null;
    }

    getMenuTriggerNodes(target) {
      const nodes = [];
      const sessionNode = target?.element;
      if (target?.anchor instanceof HTMLElement) {
        nodes.push(target.anchor);
      }
      if (sessionNode instanceof HTMLElement) {
        nodes.push(sessionNode);
        const anchorInNode = sessionNode.querySelector("a[href*='/chat/']");
        if (anchorInNode instanceof HTMLElement) {
          nodes.push(anchorInNode);
        }
        const buttonInNode = sessionNode.querySelector("button,[role='button']");
        if (
          buttonInNode instanceof HTMLElement &&
          !buttonInNode.classList?.contains("dtk-session-checkbox") &&
          !domUtils.isInToolkitUI(buttonInNode)
        ) {
          nodes.push(buttonInNode);
        }
      }

      const unique = Array.from(new Set(nodes));
      return unique.filter((node) => node instanceof HTMLElement && document.body.contains(node) && domUtils.isVisible(node));
    }

    async openDeleteMenuForSession(target) {
      const sessionNode = target?.element;
      if (!(sessionNode instanceof HTMLElement)) {
        return false;
      }

      const triggerNodes = this.getMenuTriggerNodes(target);
      logger.debug("Menu trigger candidates:", triggerNodes.length);
      if (triggerNodes.length === 0) {
        logger.warn("No menu trigger candidates for session:", target?.title || "(unknown)");
      }
      for (const triggerNode of triggerNodes) {
        domUtils.scrollIntoViewIfNeeded(triggerNode);
        domUtils.simulateHover(triggerNode);

        const menuButton = chatSelectors.findDeleteMenuButton(sessionNode);
        if (menuButton) {
          logger.debug(
            "Menu button candidate:",
            menuButton.getAttribute("aria-label") || menuButton.title || menuButton.className || menuButton.tagName
          );
          domUtils.simulateHover(menuButton);
          domUtils.simulateClick(menuButton);
          await retry.sleep(config.timing.afterClickMs);
          if (await this.waitForDeleteAction(sessionNode)) {
            return true;
          }
        }

        // Avoid clicking direct chat anchors first because it can navigate away instead of opening menu.
        const isChatAnchor =
          triggerNode.tagName.toLowerCase() === "a" && (triggerNode.getAttribute("href") || "").includes("/chat/");
        if (!isChatAnchor) {
          domUtils.simulateClick(triggerNode);
          await retry.sleep(config.timing.afterClickMs);
          if (await this.waitForDeleteAction(sessionNode)) {
            return true;
          }
        }

        const rect = triggerNode.getBoundingClientRect();
        domUtils.simulateContextMenu(triggerNode, {
          clientX: rect.right - 8,
          clientY: rect.top + Math.max(8, rect.height / 2)
        });
        await retry.sleep(config.timing.afterClickMs);
        if (await this.waitForDeleteAction(sessionNode)) {
          return true;
        }

        domUtils.simulateSecondaryClick(triggerNode, {
          clientX: rect.right - 8,
          clientY: rect.top + Math.max(8, rect.height / 2)
        });
        await retry.sleep(config.timing.afterClickMs);
        if (await this.waitForDeleteAction(sessionNode)) {
          return true;
        }
      }

      return false;
    }

    async clickDeleteAction(referenceNode, withFallback = false) {
      const deleteAction = chatSelectors.findDeleteActionNode(referenceNode);
      if (!deleteAction) {
        logger.debug("Delete action candidates:", chatSelectors.listDeleteActionCandidates(referenceNode));
        if (!withFallback) {
          return this.clickDeleteActionByKeyboard(referenceNode);
        }
        throw new Error("Unable to locate delete action.");
      }
      logger.debug("Delete action text:", (deleteAction.textContent || "").trim());
      domUtils.simulateHover(deleteAction);
      domUtils.simulateClick(deleteAction);
      await retry.sleep(config.timing.afterClickMs);
    }

    getKeyboardDeleteTargets(referenceNode) {
      if (!(referenceNode instanceof HTMLElement)) {
        return [];
      }
      const candidates = [];
      const selectors = ["a[href*='/chat/']", "button", "[role='button']", "[tabindex]", "[role='listitem']"];
      for (const selector of selectors) {
        for (const node of referenceNode.querySelectorAll(selector)) {
          if (!(node instanceof HTMLElement) || !domUtils.isVisible(node) || domUtils.isInToolkitUI(node)) {
            continue;
          }
          candidates.push(node);
        }
      }
      candidates.push(referenceNode);
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        candidates.push(active);
      }
      return Array.from(new Set(candidates));
    }

    async clickDeleteActionByKeyboard(referenceNode) {
      if (!referenceNode) {
        throw new Error("Unable to locate delete action.");
      }
      const targets = this.getKeyboardDeleteTargets(referenceNode);
      logger.debug("Keyboard delete candidates:", targets.length);
      if (targets.length === 0) {
        logger.warn("No keyboard delete candidates found.");
      }
      for (const target of targets) {
        domUtils.scrollIntoViewIfNeeded(target);
        domUtils.simulateHover(target);
        domUtils.simulateClick(target);
        await retry.sleep(120);
        domUtils.simulateKey(target, "ContextMenu");
        domUtils.simulateKey(target, "F10", { shiftKey: true });
        await retry.sleep(Math.max(120, Math.floor(config.timing.afterClickMs / 2)));
        const actionViaMenu = chatSelectors.findDeleteActionNode(referenceNode);
        if (actionViaMenu) {
          domUtils.simulateHover(actionViaMenu);
          domUtils.simulateClick(actionViaMenu);
          await retry.sleep(config.timing.afterClickMs);
          return;
        }
        domUtils.simulateKey(target, "Delete");
        domUtils.simulateKey(target, "Backspace");
        await retry.sleep(Math.max(120, Math.floor(config.timing.afterClickMs / 2)));
        if (chatSelectors.findConfirmDeleteNode()) {
          return;
        }
      }

      if (document.body) {
        domUtils.simulateKey(document.body, "Delete");
        domUtils.simulateKey(document.body, "Backspace");
      }
      await retry.sleep(config.timing.afterClickMs);
      // In some variants, Delete opens dialog directly.
    }

    async clickConfirmDelete() {
      const confirmButton = chatSelectors.findConfirmDeleteNode();
      if (!confirmButton) {
        return false;
      }
      domUtils.simulateHover(confirmButton);
      domUtils.simulateClick(confirmButton);
      await retry.sleep(config.timing.deleteStepDelayMs);
      return true;
    }

    isSessionPresent(target) {
      this.refreshSessions();
      const liveTarget = this.resolveTargetForSelected(target?.id, target?.title);
      return Boolean(liveTarget && liveTarget.element && document.body.contains(liveTarget.element));
    }

    async waitForSessionRemoved(target, timeoutMs = config.timing.deleteResultTimeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!this.isSessionPresent(target)) {
          return true;
        }
        await retry.sleep(config.timing.waitForNodePollMs);
      }
      return !this.isSessionPresent(target);
    }

    forgetDeletedSession(target) {
      if (!target) {
        return;
      }
      if (target.id) {
        this.selectedIds.delete(target.id);
        this.sessionMap.delete(target.id);
      }
      if (target.element instanceof HTMLElement && document.body.contains(target.element)) {
        target.element.remove();
      }
      this.emitState();
    }

    async deleteSingleSessionViaApi(target) {
      if (!apiClient?.deleteConversation) {
        throw this.createFailureError("api_failed", "Delete API client is unavailable.");
      }
      if (!target?.conversationId) {
        throw this.createFailureError("missing_conversation_id", "Session has no conversation id.");
      }
      await apiClient.deleteConversation(target.conversationId);
      this.forgetDeletedSession(target);
      await retry.sleep(config.timing.deleteStepDelayMs);
    }

    async deleteSingleSessionViaUi(target, attempt) {
      const sessionNode = target?.element;
      if (!sessionNode || !document.body.contains(sessionNode)) {
        throw this.createFailureError("node_changed", `Session node missing at attempt ${attempt}.`);
      }
      const menuOpened = await this.openDeleteMenuForSession(target);
      if (menuOpened) {
        await this.clickDeleteAction(sessionNode, attempt > 1);
      } else {
        logger.warn(
          "Menu open failed; trying keyboard delete fallback.",
          target.title,
          "triggers:",
          this.getMenuTriggerNodes(target).length
        );
        await this.clickDeleteActionByKeyboard(sessionNode);
      }
      const clickedConfirm = await this.clickConfirmDelete();
      if (!clickedConfirm) {
        await retry.sleep(config.timing.deleteStepDelayMs);
      }
      const removed = await this.waitForSessionRemoved(target);
      if (!removed) {
        throw this.createFailureError("ui_fallback_failed", "Session still exists after delete action.");
      }
    }

    async deleteSingleSession(target) {
      const operation = async (attempt) => {
        this.refreshSessions();
        const liveTarget = this.resolveTargetForSelected(target?.id, target?.title) || target;
        logger.debug("Delete attempt", attempt, "for", liveTarget?.title || liveTarget?.conversationId);

        try {
          await this.deleteSingleSessionViaApi(liveTarget);
          return;
        } catch (apiError) {
          logger.warn("Delete API failed; falling back to UI delete.", apiError);
          if (!config?.api?.fallbackToUi) {
            throw apiError;
          }
        }

        try {
          await this.deleteSingleSessionViaUi(liveTarget, attempt);
        } catch (uiError) {
          if (uiError?.failureCategory) {
            throw uiError;
          }
          throw this.createFailureError("ui_fallback_failed", uiError?.message || "UI fallback failed.", uiError);
        }
      };

      await retry.retryAsync(operation, {
        maxAttempts: config.retry.maxAttempts,
        intervalMs: config.retry.intervalMs
      });
    }

    getState() {
      return {
        multiSelectMode: this.multiSelectMode,
        selectedCount: this.selectedIds.size,
        totalSessions: this.sessionMap.size,
        isDeleting: this.isDeleting,
        deleteAllUnlocked: this.deleteAllUnlocked,
        incognitoModeEnabled: this.incognitoModeEnabled,
        incognitoIntervalMinutes: this.incognitoIntervalMinutes,
        incognitoNextRunAt: this.incognitoNextRunAt,
        url: location.href
      };
    }

    emitState() {
      const detail = this.getState();
      window.dispatchEvent(new CustomEvent("dtk:state-changed", { detail }));
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.sessionManager = new SessionManager();
})(window);
