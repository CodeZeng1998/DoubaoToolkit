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

  class SessionManager {
    constructor() {
      this.multiSelectMode = false;
      this.selectedIds = new Set();
      this.sessionMap = new Map();
      this.isDeleting = false;
      this.observer = null;
      this.refreshTimer = null;
      this.lastKnownUrl = location.href;
    }

    init() {
      this.refreshSessions();
      this.startDomObserver();
      this.startSpaObserver();
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
      toast.show(this.multiSelectMode ? "Multi-select enabled." : "Multi-select disabled.", "info");
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
      toast.show(`Selected ${this.selectedIds.size} sessions.`, "success");
    }

    clearSelection(silent = false) {
      this.selectedIds.clear();
      this.renderSelectionControls();
      this.emitState();
      if (!silent) {
        toast.show("Selection cleared.", "info");
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
          checkbox.title = "Select session";
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

    async confirmDelete(mode, targets) {
      const label = mode === "all" ? "Delete all sessions?" : `Delete ${targets.length} selected sessions?`;
      return modal.confirm({
        title: "Dangerous Operation",
        message: `${label} This cannot be undone.`,
        confirmText: "Delete",
        cancelText: "Cancel",
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

    async deleteSessions(mode) {
      if (this.isDeleting) {
        toast.show("A delete task is already running.", "warning");
        return {
          ok: false,
          reason: "busy"
        };
      }

      this.refreshSessions();
      const targets = this.getDeleteTargets(mode);
      if (targets.length === 0) {
        toast.show("No sessions to delete.", "warning");
        return {
          ok: false,
          reason: "empty"
        };
      }

      const confirmed = await this.confirmDelete(mode, targets);
      if (!confirmed) {
        return {
          ok: false,
          reason: "cancelled"
        };
      }

      this.isDeleting = true;
      this.emitState();
      progress.show(mode === "all" ? "Deleting all sessions..." : "Deleting selected sessions...");

      let done = 0;
      let failed = 0;
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
            progress.update(done, total, failed);
            logger.warn("Selected target no longer exists:", queueItem.id);
            continue;
          }
          try {
            await this.deleteSingleSession(current);
          } catch (error) {
            failed += 1;
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
        toast.show(`Deleted ${done} session(s).`, "success");
      } else {
        toast.show(`Deleted ${done - failed}/${done}. Failed: ${failed}.`, "error", 3600);
      }

      return {
        ok: failed === 0,
        done,
        failed,
        total
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
        throw new Error("Delete API client is unavailable.");
      }
      if (!target?.conversationId) {
        throw new Error("Session has no conversation id.");
      }
      await apiClient.deleteConversation(target.conversationId);
      this.forgetDeletedSession(target);
      await retry.sleep(config.timing.deleteStepDelayMs);
    }

    async deleteSingleSessionViaUi(target, attempt) {
      const sessionNode = target?.element;
      if (!sessionNode || !document.body.contains(sessionNode)) {
        throw new Error(`Session node missing at attempt ${attempt}.`);
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
        throw new Error("Session still exists after delete action.");
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

        await this.deleteSingleSessionViaUi(liveTarget, attempt);
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
