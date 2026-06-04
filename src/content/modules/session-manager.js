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
  const storage = global.DoubaoToolkitStorage;
  const DELETE_ALL_UNLOCK_KEY = "dtk_delete_all_unlocked_v1";
  const INCOGNITO_ENABLED_KEY = "dtk_incognito_enabled_v1";
  const INCOGNITO_INTERVAL_KEY = "dtk_incognito_interval_minutes_v1";
  const ARCHIVED_IDS_KEY = "dtk_archived_conversation_ids_v1";
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

  const FAILURE_SUGGESTIONS = {
    api_failed: "检查网络连接，刷新豆包页面后重试；若仍失败，工具会自动尝试 UI 删除回退。",
    missing_conversation_id: "当前对话节点缺少可识别 ID，可刷新页面或改用页面内菜单删除。",
    node_changed: "对话列表在删除过程中被刷新或重排，请等待页面稳定后重试。",
    auth_expired: "登录状态可能已失效，请重新登录豆包后再执行删除。",
    ui_fallback_failed: "页面菜单或确认按钮可能发生变化，请更新选择后重试。",
    unknown: "查看导出的日志以定位具体失败位置。"
  };

  class SessionManager {
    constructor() {
      this.multiSelectMode = false;
      this.selectedIds = new Set();
      this.sessionMap = new Map();
      this.isDeleting = false;
      this.observer = null;
      this.refreshTimer = null;
      this.selectionRenderTimer = null;
      this.selectionRenderToken = 0;
      this.selectionOverlay = null;
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
      this.incognitoSkipActive = true;
      this.archivedConversationIds = this.readArchivedIds();
      this.deleteCancelRequested = false;
      this.deleteStats = {
        loading: true,
        updatedAt: 0,
        total: 0,
        selected: 0,
        selectable: 0,
        deletable: 0,
        archivedCount: 0,
        selectedDeletable: 0,
        missingConversationId: 0,
        missingElement: 0,
        apiClientReady: false,
        apiFallbackToUi: Boolean(config?.api?.fallbackToUi)
      };
      this.deleteStatsTimer = null;
      this.settings = {
        ...(storage?.DEFAULT_SETTINGS || {}),
        autoReloadAfterDeleteAll: true,
        apiFallbackToUi: true,
        debugLogs: true,
        deleteStepDelayMs: config.timing.deleteStepDelayMs,
        maxRetryAttempts: config.retry.maxAttempts
      };
      this.lastFailureDetails = [];
    }

    init() {
      this.loadSettings().then(() => this.syncIncognitoTimer());
      this.refreshSessions();
      this.scheduleDeleteStatsRefresh({ force: true });
      this.startDomObserver();
      this.startSpaObserver();
      logger.info("Session manager initialized.");
    }

    async loadSettings() {
      if (!storage?.getSettings) {
        return;
      }
      try {
        const settings = await storage.getSettings();
        this.applySettings(settings);
        this.emitState();
      } catch (error) {
        logger?.warn("Load settings failed:", error);
      }
    }

    async saveSettings(patch) {
      const next = {
        ...this.settings,
        ...(patch || {})
      };
      this.applySettings(next);
      if (storage?.saveSettings) {
        try {
          await storage.saveSettings(next);
        } catch (error) {
          logger?.warn("Save settings failed:", error);
        }
      }
      this.syncIncognitoTimer();
      this.emitState();
      return this.settings;
    }

    async reloadSettings() {
      await this.loadSettings();
      this.syncIncognitoTimer();
      return this.settings;
    }

    applySettings(settings) {
      this.settings = {
        ...this.settings,
        ...(settings || {})
      };
      config.debug = Boolean(this.settings.debugLogs);
      config.api.fallbackToUi = Boolean(this.settings.apiFallbackToUi);
      config.timing.deleteStepDelayMs = this.clampNumber(this.settings.deleteStepDelayMs, 80, 2000, 300);
      config.retry.maxAttempts = this.clampNumber(this.settings.maxRetryAttempts, 1, 10, 5);
      this.incognitoModeEnabled = Boolean(this.settings.incognitoModeEnabled);
      this.incognitoIntervalMinutes = this.clampNumber(
        this.settings.incognitoIntervalMinutes,
        MIN_INCOGNITO_INTERVAL_MINUTES,
        MAX_INCOGNITO_INTERVAL_MINUTES,
        DEFAULT_INCOGNITO_INTERVAL_MINUTES
      );
      this.incognitoNextRunAt = Number(this.settings.incognitoNextRunAt || 0) || null;
      this.incognitoSkipActive = this.settings.incognitoSkipActive !== false;
    }

    readArchivedIds() {
      try {
        const raw = localStorage.getItem(ARCHIVED_IDS_KEY);
        if (!raw) {
          return new Set();
        }
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []);
      } catch (_error) {
        return new Set();
      }
    }

    persistArchivedIds() {
      try {
        localStorage.setItem(ARCHIVED_IDS_KEY, JSON.stringify(Array.from(this.archivedConversationIds)));
      } catch (_error) {
        logger?.debug("persistArchivedIds failed.");
      }
    }

    isConversationArchived(conversationId) {
      const id = String(conversationId || "").trim();
      return Boolean(id) && this.archivedConversationIds.has(id);
    }

    toggleSessionArchive(conversationId) {
      const id = String(conversationId || "").trim();
      if (!id) {
        toast.show("此对话缺少 ID，无法归档。", "warning", 2400);
        return { ok: false, reason: "missing_id" };
      }
      const archived = this.archivedConversationIds.has(id);
      if (archived) {
        this.archivedConversationIds.delete(id);
        toast.show("已取消归档，该对话恢复可删除。", "info", 2200);
      } else {
        this.archivedConversationIds.add(id);
        toast.show("已归档，该对话将不会被删除。", "success", 2200);
      }
      this.persistArchivedIds();
      this.renderSelectionControls();
      this.scheduleDeleteStatsRefresh({ force: true });
      this.emitState();
      return { ok: true, archived: !archived };
    }

    clearArchivedConversations() {
      const cleared = this.archivedConversationIds.size;
      if (cleared === 0) {
        toast.show("当前没有归档保护的对话。", "info", 2200);
        return { ok: true, cleared: 0 };
      }
      this.archivedConversationIds.clear();
      this.persistArchivedIds();
      this.renderSelectionControls();
      this.scheduleDeleteStatsRefresh({ force: true });
      this.emitState();
      toast.show(`已清空 ${cleared} 个归档保护。`, "success", 2400);
      return { ok: true, cleared };
    }

    findSessionIdByConversationId(conversationId) {
      const id = String(conversationId || "").trim();
      if (!id) {
        return null;
      }
      for (const session of this.sessionMap.values()) {
        if (String(session.conversationId) === id) {
          return session.id;
        }
      }
      return null;
    }

    getActiveConversationId() {
      const match = location.pathname.match(/\/chat\/(\d+)/);
      return match ? match[1] : null;
    }

    async setIncognitoSkipActive(enabled) {
      const next = Boolean(enabled);
      this.incognitoSkipActive = next;
      await this.saveSettings({ incognitoSkipActive: next });
      this.emitState();
      toast.show(next ? "无痕模式将跳过当前打开的对话。" : "无痕模式不再跳过当前对话。", "info", 2400);
      return { ok: true };
    }

    clampNumber(value, min, max, fallback) {
      const number = Math.round(Number(value));
      if (!Number.isFinite(number)) {
        return fallback;
      }
      return Math.min(Math.max(number, min), max);
    }

    refreshSessions(options = {}) {
      if (options.force) {
        chatSelectors.invalidateSessionCache?.();
      }
      const sessions = chatSelectors.getSessionItems({ force: Boolean(options.force) });
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
      if (!options.skipStats) {
        this.scheduleDeleteStatsRefresh();
      }
    }

    scheduleRefresh() {
      if (this.refreshTimer) {
        window.clearTimeout(this.refreshTimer);
      }
      this.refreshTimer = window.setTimeout(() => {
        this.refreshSessions({ force: true });
      }, config.timing.sessionRefreshDebounceMs);
    }

    schedulePageReloadAfterDeleteTask(options = {}) {
      if (options.source === "incognito") {
        return;
      }
      window.setTimeout(() => {
        location.reload();
      }, 900);
    }

    requestCancelDelete() {
      if (!this.isDeleting) {
        return {
          ok: false,
          reason: "idle"
        };
      }
      this.deleteCancelRequested = true;
      toast.show("正在取消删除，当前对话处理完成后停止。", "warning", 2600);
      return {
        ok: true
      };
    }

    shouldRefreshForMutation(mutation) {
      const isToolkitNode = (node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        return Boolean(
          domUtils.isInToolkitUI?.(node) ||
            node.closest?.(
              ".dtk-floating-root,.dtk-floating-tooltip,.dtk-toast-container,.dtk-toast-detail-overlay,.dtk-modal-overlay,.dtk-progress-overlay"
            )
        );
      };

      if (isToolkitNode(mutation.target)) {
        return false;
      }

      if (mutation.type === "attributes") {
        return ["href", "aria-label", "title", "data-testid", "data-conversation-id"].includes(mutation.attributeName);
      }

      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return changedNodes.some((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return Boolean(node.textContent?.trim());
        }
        return node instanceof HTMLElement && !isToolkitNode(node);
      });
    }

    startDomObserver() {
      if (this.observer) {
        return;
      }
      this.observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => this.shouldRefreshForMutation(mutation))) {
          this.scheduleRefresh();
        }
      });
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "aria-label", "title", "data-testid", "data-conversation-id"]
      });
      window.addEventListener("scroll", () => {
        if (this.multiSelectMode) {
          this.scheduleSelectionRender();
        }
      }, true);
      window.addEventListener("resize", () => {
        if (this.multiSelectMode) {
          this.scheduleSelectionRender();
        }
      });
    }

    async syncBackgroundIncognitoAlarm() {
      try {
        const response = await chrome.runtime?.sendMessage?.({ type: "DTK_SW_SYNC_INCOGNITO" });
        if (response?.settings) {
          this.applySettings(response.settings);
          this.emitState();
        }
      } catch (error) {
        logger?.debug("Sync background incognito alarm failed:", error);
      }
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
        this.clearSelectionOverlay();
      }
      this.renderSelectionControls();
      this.emitState();
      this.scheduleDeleteStatsRefresh();
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
      this.scheduleDeleteStatsRefresh();
    }

    selectAll() {
      if (!this.multiSelectMode) {
        this.setMultiSelectMode(true);
      }
      this.selectedIds.clear();
      for (const sessionId of this.sessionMap.keys()) {
        this.selectedIds.add(sessionId);
      }
      this.renderSelectionControls();
      this.emitState();
      this.scheduleDeleteStatsRefresh();
      toast.show(`已选择 ${this.selectedIds.size} 个对话。`, "success");
    }

    clearSelection(silent = false) {
      this.selectedIds.clear();
      this.renderSelectionControls();
      this.emitState();
      this.scheduleDeleteStatsRefresh();
      if (!silent) {
        toast.show("已清空选择。", "info");
      }
    }

    setSelectedArchiveState(archived) {
      if (!this.multiSelectMode) {
        this.setMultiSelectMode(true);
      }
      const targets = Array.from(this.selectedIds)
        .map((id) => this.sessionMap.get(id))
        .filter((session) => session?.conversationId);
      if (!targets.length) {
        toast.show("请先选择要处理的对话。", "warning", 2400);
        return { ok: false, reason: "empty_selection", updated: 0 };
      }

      let updated = 0;
      for (const session of targets) {
        const id = String(session.conversationId || "").trim();
        if (!id) {
          continue;
        }
        const alreadyArchived = this.archivedConversationIds.has(id);
        if (archived && !alreadyArchived) {
          this.archivedConversationIds.add(id);
          updated += 1;
        } else if (!archived && alreadyArchived) {
          this.archivedConversationIds.delete(id);
          updated += 1;
        }
      }

      this.persistArchivedIds();
      this.renderSelectionControls();
      this.scheduleDeleteStatsRefresh({ force: true });
      this.emitState();
      toast.show(
        archived ? `已归档 ${updated} 个选中对话。` : `已取消归档 ${updated} 个选中对话。`,
        updated > 0 ? "success" : "info",
        2400
      );
      return {
        ok: true,
        archived: Boolean(archived),
        updated,
        selected: targets.length
      };
    }

    scheduleSelectionRender() {
      if (this.selectionRenderTimer) {
        window.clearTimeout(this.selectionRenderTimer);
      }
      this.selectionRenderTimer = window.setTimeout(() => {
        this.selectionRenderTimer = null;
        this.renderSelectionControls();
      }, 40);
    }

    renderSelectionControls() {
      const token = ++this.selectionRenderToken;
      const sessions = Array.from(this.sessionMap.values());
      if (!this.multiSelectMode) {
        this.clearSelectionOverlay();
        this.syncArchivedSessionClasses(sessions);
        return;
      }
      const overlay = this.ensureSelectionOverlay();
      const viewportHeight = window.innerHeight || 800;
      const sortedSessions = sessions.sort((a, b) => {
        const aRect = a?.element instanceof HTMLElement ? a.element.getBoundingClientRect() : { top: 999999 };
        const bRect = b?.element instanceof HTMLElement ? b.element.getBoundingClientRect() : { top: 999999 };
        const aVisible = aRect.bottom >= -120 && aRect.top <= viewportHeight + 120;
        const bVisible = bRect.bottom >= -120 && bRect.top <= viewportHeight + 120;
        if (aVisible !== bVisible) {
          return aVisible ? -1 : 1;
        }
        return aRect.top - bRect.top;
      });

      if (this.selectionRenderTimer) {
        window.clearTimeout(this.selectionRenderTimer);
        this.selectionRenderTimer = null;
      }

      const renderBatch = (startIndex) => {
        if (token !== this.selectionRenderToken) {
          return;
        }
        const batch = sortedSessions.slice(startIndex, startIndex + 50);
        for (const session of batch) {
          this.renderSelectionControl(session, overlay);
        }
        if (startIndex + batch.length < sortedSessions.length) {
          this.selectionRenderTimer = window.setTimeout(() => renderBatch(startIndex + batch.length), 16);
        }
      };

      renderBatch(0);
    }

    ensureSelectionOverlay() {
      if (this.selectionOverlay && document.body.contains(this.selectionOverlay)) {
        return this.selectionOverlay;
      }
      for (const node of document.querySelectorAll(".dtk-session-checkbox")) {
        if (!node.closest(".dtk-selection-overlay")) {
          node.remove();
        }
      }
      const overlay = document.createElement("div");
      overlay.className = "dtk-selection-overlay";
      document.body.appendChild(overlay);
      this.selectionOverlay = overlay;
      return overlay;
    }

    clearSelectionOverlay() {
      this.selectionOverlay?.remove();
      this.selectionOverlay = null;
      for (const item of this.sessionMap.values()) {
        item?.element?.classList?.remove("dtk-session-selected", "dtk-session-selectable", "dtk-session-archived");
      }
    }

    syncArchivedSessionClasses(sessions = Array.from(this.sessionMap.values())) {
      for (const session of sessions) {
        session?.element?.classList?.toggle(
          "dtk-session-archived",
          this.multiSelectMode && this.isConversationArchived(session?.conversationId)
        );
      }
    }

    getSelectionAnchorElement(session) {
      const item = session?.element;
      const conversationId = String(session?.conversationId || "").trim();
      const exactAnchor = conversationId ? document.getElementById(`conversation_${conversationId}`) : null;
      if (exactAnchor instanceof HTMLElement && exactAnchor.matches("a[href*='/chat/']") && domUtils.isVisible(exactAnchor)) {
        return exactAnchor;
      }
      if (item instanceof HTMLElement) {
        const selector = conversationId
          ? `a#conversation_${conversationId},a[href="/chat/${conversationId}"],a[href^="/chat/${conversationId}?"]`
          : "a[href*='/chat/']";
        const innerAnchor = item.querySelector(selector);
        if (innerAnchor instanceof HTMLElement && domUtils.isVisible(innerAnchor)) {
          return innerAnchor;
        }
      }
      const anchor = session?.anchor;
      if (anchor instanceof HTMLElement && document.body.contains(anchor) && domUtils.isVisible(anchor)) {
        return anchor;
      }
      return item;
    }

    getSelectionAnchorRect(session) {
      const item = session?.element;
      const anchor = this.getSelectionAnchorElement(session);
      if (!(anchor instanceof HTMLElement)) {
        return null;
      }
      const anchorRect = anchor.getBoundingClientRect();
      if (anchorRect.width <= 0 || anchorRect.height <= 0) {
        return null;
      }
      if (anchor.id === `conversation_${session?.conversationId || ""}`) {
        return anchorRect;
      }
      const itemRect = item instanceof HTMLElement ? item.getBoundingClientRect() : anchorRect;
      const useAnchorRect =
        itemRect.height <= 0 ||
        itemRect.height > Math.max(140, anchorRect.height * 2.5) ||
        Math.abs(anchorRect.top - itemRect.top) > Math.max(24, anchorRect.height);
      if (!useAnchorRect) {
        return itemRect;
      }
      // 使用 anchor 的位置，但确保 left 值合理（不使用 Math.min 避免选择异常小的值）
      const finalLeft = Number.isFinite(itemRect.left) && itemRect.left >= 0 ? Math.min(itemRect.left, anchorRect.left) : anchorRect.left;
      return {
        left: finalLeft,
        right: Math.max(itemRect.right || anchorRect.right, anchorRect.right),
        top: anchorRect.top,
        bottom: anchorRect.bottom,
        width: Math.max(itemRect.width || 0, anchorRect.width),
        height: anchorRect.height
      };
    }

    renderSelectionControl(session, overlay = this.ensureSelectionOverlay()) {
        const item = session.element;
        if (!(item instanceof HTMLElement)) {
          return;
        }
        const archived = this.isConversationArchived(session.conversationId);
        item.classList.toggle("dtk-session-selected", this.selectedIds.has(session.id));
        item.classList.toggle("dtk-session-selectable", this.multiSelectMode);
        item.classList.toggle("dtk-session-archived", archived);
        let checkbox = overlay.querySelector(`[data-session-id="${CSS.escape(session.id)}"]`);
        let archiveBtn = overlay.querySelector(`[data-archive-session-id="${CSS.escape(session.id)}"]`);

        if (!this.multiSelectMode) {
          item.classList.remove("dtk-session-selectable");
          if (checkbox) {
            checkbox.remove();
          }
          if (archiveBtn) {
            archiveBtn.remove();
          }
          return;
        }

        if (!checkbox) {
          checkbox = document.createElement("button");
          checkbox.type = "button";
          checkbox.className = "dtk-session-checkbox";
          checkbox.title = "选择对话";
          checkbox.setAttribute("role", "checkbox");
          checkbox.setAttribute("aria-label", `选择对话：${session.title || "未命名对话"}`);
          checkbox.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleSessionSelection(session.id);
          });
          checkbox.dataset.sessionId = session.id;
          overlay.appendChild(checkbox);
        }

        if (!archiveBtn) {
          archiveBtn = document.createElement("button");
          archiveBtn.type = "button";
          archiveBtn.className = "dtk-session-archive";
          archiveBtn.setAttribute("role", "switch");
          archiveBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleSessionArchive(session.conversationId);
          });
          archiveBtn.dataset.archiveSessionId = session.id;
          overlay.appendChild(archiveBtn);
        }
        archiveBtn.title = archived ? "已归档：取消归档后才可被删除" : "归档此对话，保护它不被删除";
        archiveBtn.setAttribute(
          "aria-label",
          `${archived ? "取消归档" : "归档"}：${session.title || "未命名对话"}`
        );
        archiveBtn.setAttribute("aria-checked", String(archived));
        archiveBtn.classList.toggle("dtk-session-archive-on", archived);
        if (!session.conversationId) {
          archiveBtn.disabled = true;
          archiveBtn.title = "缺少对话 ID，无法归档";
        } else {
          archiveBtn.disabled = false;
        }
        checkbox.disabled = false;
        checkbox.title = archived ? "选择归档对话（删除时会自动提示移除）" : "选择对话";

        const rect = this.getSelectionAnchorRect(session);
        if (!rect) {
          checkbox.hidden = true;
          archiveBtn.hidden = true;
          return;
        }

        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
          checkbox.hidden = true;
          archiveBtn.hidden = true;
          return;
        }

        const viewportHeight = window.innerHeight || 800;
        const viewportWidth = window.innerWidth || 1920;

        const visible = rect.bottom >= 0 && rect.top <= viewportHeight && rect.width > 0 && rect.height > 0;
        if (!visible) {
          checkbox.hidden = true;
          archiveBtn.hidden = true;
          return;
        }

        const checkboxLeft = rect.left + 8;
        const checkboxTop = rect.top + rect.height / 2;

        if (checkboxLeft < -10 || checkboxTop < -10 || checkboxLeft > viewportWidth + 10 || checkboxTop > viewportHeight + 10) {
          checkbox.hidden = true;
          archiveBtn.hidden = true;
          return;
        }

        checkbox.hidden = false;
        checkbox.style.left = `${checkboxLeft}px`;
        checkbox.style.top = `${checkboxTop}px`;
        checkbox.setAttribute("aria-checked", String(this.selectedIds.has(session.id)));

        const archiveLeft = Math.min(viewportWidth - 14, rect.right - 14);
        archiveBtn.hidden = false;
        archiveBtn.style.left = `${archiveLeft}px`;
        archiveBtn.style.top = `${checkboxTop}px`;
    }

    getDeleteTargets(mode, options = {}) {
      let targets;
      if (mode === "all") {
        targets = Array.from(this.sessionMap.values());
      } else {
        targets = Array.from(this.selectedIds)
          .map((id) => this.sessionMap.get(id))
          .filter(Boolean);
      }
      targets = targets.filter((t) => !this.isConversationArchived(t.conversationId));
      if (options.source === "incognito" && this.incognitoSkipActive) {
        const activeId = this.getActiveConversationId();
        if (activeId) {
          targets = targets.filter((t) => String(t.conversationId) !== activeId);
        }
      }
      return targets;
    }

    getSelectedArchivedSessions() {
      return Array.from(this.selectedIds)
        .map((id) => this.sessionMap.get(id))
        .filter((session) => session && this.isConversationArchived(session.conversationId));
    }

    removeSelectedArchivedSessions() {
      let removed = 0;
      for (const session of this.getSelectedArchivedSessions()) {
        if (session?.id && this.selectedIds.delete(session.id)) {
          removed += 1;
        }
      }
      if (removed > 0) {
        this.renderSelectionControls();
        this.scheduleDeleteStatsRefresh({ force: true });
        this.emitState();
      }
      return removed;
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
      await this.saveSettings({
        incognitoModeEnabled: this.incognitoModeEnabled,
        incognitoIntervalMinutes: this.incognitoIntervalMinutes,
        incognitoNextRunAt: this.incognitoModeEnabled ? Date.now() + this.incognitoIntervalMinutes * 60 * 1000 : null
      });
      this.emitState();
      toast.show(this.incognitoModeEnabled ? "已开启无痕模式。" : "已关闭无痕模式。", "info", 2600);
      return {
        ok: true
      };
    }

    async setIncognitoInterval(minutes) {
      const value = Math.min(
        Math.max(Math.round(Number(minutes) || DEFAULT_INCOGNITO_INTERVAL_MINUTES), MIN_INCOGNITO_INTERVAL_MINUTES),
        MAX_INCOGNITO_INTERVAL_MINUTES
      );
      this.incognitoIntervalMinutes = value;
      this.writeSetting(INCOGNITO_INTERVAL_KEY, value);
      await this.saveSettings({
        incognitoIntervalMinutes: value,
        incognitoNextRunAt: this.incognitoModeEnabled ? Date.now() + value * 60 * 1000 : null
      });
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
      if (!this.incognitoModeEnabled) {
        this.incognitoNextRunAt = null;
        this.emitState();
        this.syncBackgroundIncognitoAlarm();
        return;
      }
      const stored = Number(this.settings.incognitoNextRunAt || this.incognitoNextRunAt || 0);
      if (stored > Date.now()) {
        this.incognitoNextRunAt = stored;
      } else {
        this.incognitoNextRunAt = Date.now() + this.incognitoIntervalMinutes * 60 * 1000;
      }
      this.emitState();
      this.syncBackgroundIncognitoAlarm();
    }

    async runIncognitoCleanup() {
      this.incognitoTimer = null;
      if (!this.incognitoModeEnabled) {
        this.incognitoNextRunAt = null;
        this.emitState();
        return {
          ok: false,
          reason: "disabled"
        };
      }

      if (this.isDeleting) {
        logger.warn("Incognito cleanup skipped because delete task is running.");
        this.syncIncognitoTimer();
        return {
          ok: false,
          reason: "busy"
        };
      }

      toast.show("无痕模式开始自动清理历史对话。", "warning", 2600);
      const result = await this.deleteSessions("all", {
        skipConfirm: true,
        skipUnlock: true,
        silentEmpty: true,
        source: "incognito"
      });
      this.syncIncognitoTimer();
      return result;
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

    createFailureDetail(error, target) {
      const category = this.getFailureCategory(error);
      return {
        category,
        label: FAILURE_LABELS[category] || FAILURE_LABELS.unknown,
        id: target?.id || "",
        conversationId: target?.conversationId || "",
        title: target?.title || target?.id || "未命名对话",
        message: error?.message || "未知错误",
        suggestion: FAILURE_SUGGESTIONS[category] || FAILURE_SUGGESTIONS.unknown
      };
    }

    async recordDeleteTask(mode, result, options = {}) {
      if (!storage?.addTaskHistory || result?.reason === "delete_all_locked") {
        return;
      }
      const failed = Number(result?.failed || 0);
      const done = Number(result?.done || 0);
      const total = Number(result?.total || done || 0);
      const summary =
        result?.reason === "cancelled"
          ? `已取消，处理 ${done}/${total} 个对话，失败 ${failed} 个`
          : failed > 0
          ? `${done - failed}/${done} 个对话删除成功，失败 ${failed} 个`
          : `已删除 ${done} 个对话`;
      try {
        await storage.addTaskHistory({
          source: options.source || "manual",
          mode,
          ok: result?.ok !== false && failed === 0,
          done,
          failed,
          total,
          summary,
          failureSummary: result?.failureSummary || {},
          failureDetails: result?.failureDetails || [],
          url: location.href
        });
      } catch (error) {
        logger?.warn("Record delete task failed:", error);
      }
    }

    resolveTargetForFailure(detail) {
      if (detail?.conversationId) {
        for (const item of this.sessionMap.values()) {
          if (String(item.conversationId) === String(detail.conversationId)) {
            return item;
          }
        }
      }
      return this.resolveTargetForSelected(detail?.id, detail?.title);
    }

    async retryFailedSessions() {
      if (!this.lastFailureDetails.length) {
        toast.show("没有可重试的失败对话。", "warning");
        return {
          ok: false,
          reason: "empty"
        };
      }
      const previous = this.lastFailureDetails.slice();
      this.refreshSessions();
      const targets = previous.map((detail) => this.resolveTargetForFailure(detail)).filter(Boolean);
      if (!targets.length) {
        toast.show("未找到可重试的失败对话，请刷新页面后再试。", "warning");
        return {
          ok: false,
          reason: "empty"
        };
      }
      const targetIds = new Set(targets.map((item) => item.id));
      this.selectedIds = targetIds;
      this.renderSelectionControls();
      this.emitState();
      return this.deleteSessions("selected", {
        source: "retry",
        skipConfirm: true
      });
    }

    buildDiagnostics() {
      this.refreshSessions();
      const sessions = Array.from(this.sessionMap.values());
      const menuProbe = sessions.slice(0, 5).map((session) => ({
        title: this.formatPreviewTitle(session, 0),
        conversationId: session.conversationId,
        menuTriggerCount: this.getMenuTriggerNodes(session).length
      }));
      return {
        generatedAt: new Date().toISOString(),
        url: location.href,
        userAgent: navigator.userAgent,
        state: this.getState(),
        sessionProbe: {
          total: sessions.length,
          sample: sessions.slice(0, 8).map((session) => ({
            title: this.formatPreviewTitle(session, 0),
            conversationId: session.conversationId,
            hasElement: Boolean(session.element),
            hasAnchor: Boolean(session.anchor)
          })),
          menuProbe
        },
        api: apiClient?.getDiagnostics?.() || null,
        logs: logger?.getRecords?.().slice(-80) || []
      };
    }

    formatFailureDetails(details, summary) {
      const reasonText = this.formatFailureSummary(summary) || "未知失败";
      const suggestions = Array.from(new Set(details.map((item) => `- ${item.label}：${item.suggestion}`))).join("\n");
      const items = details
        .slice(0, 30)
        .map((item, index) => `${index + 1}. ${item.title}\n   原因：${item.label} - ${item.message}`)
        .join("\n");
      const moreText = details.length > 30 ? `\n...还有 ${details.length - 30} 条失败记录，请导出日志查看。` : "";
      return `失败概览：${reasonText}\n\n解决建议：\n${suggestions || "- 暂无建议"}\n\n失败明细：\n${items || "暂无明细"}${moreText}`;
    }

    async confirmDelete(mode, targets) {
      if (mode === "all") {
        const productName = String(config?.appName || "豆包").replace(/工具箱$/, "") || "豆包";
        const previewLimit = 5;
        const previewItems = targets.slice(0, previewLimit).map((target, index) => this.formatPreviewTitle(target, index));
        if (targets.length > previewLimit) {
          previewItems.push(`等 ${targets.length} 个对话`);
        }
        return modal.confirm({
          title: "危险操作",
          messageLines: [`全部检测到的 ${productName} 对话将被删除。`],
          messageItems: previewItems,
          confirmText: "删除",
          cancelText: "取消",
          danger: true,
          requiredText: "删除全部",
          requiredTextLabel: "🔐 请输入 “删除全部” 以确认删除",
          inputPlaceholder: "输入 删除全部",
          fillMode: "button",
          fillButtonText: "一键填入“删除全部”",
          showInputHint: false,
          size: "large"
        });
      }

      const label = `确定删除已选的 ${targets.length} 个对话？`;
      return modal.confirm({
        title: "危险操作",
        message: `${label} ${this.buildDeletePreviewMessage(mode, targets)}`,
        confirmText: "删除",
        cancelText: "取消",
        danger: true,
        requiredText: ""
      });
    }

    async confirmRemoveArchivedSelection(archivedSessions, deletableCount) {
      const count = archivedSessions.length;
      const previewLimit = 5;
      const previewItems = archivedSessions
        .slice(0, previewLimit)
        .map((target, index) => this.formatPreviewTitle(target, index));
      if (count > previewLimit) {
        previewItems.push(`等 ${count} 个归档对话`);
      }
      const messageLines = [
        `当前勾选中包含 ${count} 个归档对话，这些对话受保护，不能删除。`,
        deletableCount > 0
          ? `是否移除这些归档对话的勾选，并继续删除剩余 ${deletableCount} 个可删除对话？`
          : "是否移除这些归档对话的勾选？"
      ];
      return modal.confirm({
        title: "存在不可删除的归档对话",
        messageLines,
        messageItems: previewItems,
        confirmText: deletableCount > 0 ? "移除并继续" : "移除勾选",
        cancelText: "取消",
        danger: deletableCount > 0,
        requiredText: "",
        size: "large"
      });
    }

    scheduleDeleteStatsRefresh(options = {}) {
      if (this.deleteStatsTimer) {
        window.clearTimeout(this.deleteStatsTimer);
      }
      this.deleteStats = {
        ...(this.deleteStats || {}),
        loading: true
      };
      this.emitState();
      const delay = options.force ? 80 : 260;
      this.deleteStatsTimer = window.setTimeout(() => {
        this.deleteStatsTimer = null;
        this.refreshDeleteStats({ force: Boolean(options.force) });
      }, delay);
    }

    refreshDeleteStats(options = {}) {
      this.refreshSessions({ force: Boolean(options.force), skipStats: true });
      const allTargets = this.getDeleteTargets("all");
      const selectedTargets = this.getDeleteTargets("selected");
      const allSessions = Array.from(this.sessionMap.values());
      const selectedSessions = Array.from(this.selectedIds)
        .map((id) => this.sessionMap.get(id))
        .filter(Boolean);
      const missingId = allSessions.filter((target) => !target?.conversationId).length;
      const missingElement = allSessions.filter((target) => !(target?.element instanceof HTMLElement)).length;
      const archivedCount = allSessions.filter((t) => this.isConversationArchived(t.conversationId)).length;
      this.deleteStats = {
        updatedAt: Date.now(),
        total: allSessions.length,
        selected: selectedSessions.length,
        selectable: allTargets.length,
        deletable: allTargets.filter((target) => target?.conversationId).length,
        selectedDeletable: selectedTargets.filter((target) => target?.conversationId).length,
        missingConversationId: missingId,
        missingElement,
        archivedCount,
        apiClientReady: Boolean(apiClient?.deleteConversation),
        apiFallbackToUi: Boolean(config?.api?.fallbackToUi),
        loading: false
      };
      this.emitState();
      return this.deleteStats;
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
      const targets = this.getDeleteTargets(mode, options);
      const selectedArchivedSessions = mode === "selected" ? this.getSelectedArchivedSessions() : [];
      if (selectedArchivedSessions.length > 0 && !options.skipArchivedSelectionPrompt) {
        const shouldRemove = await this.confirmRemoveArchivedSelection(selectedArchivedSessions, targets.length);
        if (!shouldRemove) {
          return {
            ok: false,
            reason: "archived_selection_cancelled",
            archivedSelected: selectedArchivedSessions.length,
            total: targets.length + selectedArchivedSessions.length
          };
        }
        const removed = this.removeSelectedArchivedSessions();
        toast.show(`已移除 ${removed} 个归档对话的勾选。`, "info", 2600);
        if (targets.length === 0) {
          return {
            ok: false,
            reason: "archived_selection_removed",
            archivedSelected: selectedArchivedSessions.length,
            removed,
            total: selectedArchivedSessions.length
          };
        }
      }
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
      this.deleteCancelRequested = false;
      this.emitState();
      progress.show(options.source === "incognito" ? "无痕模式正在自动清理..." : mode === "all" ? "正在删除全部对话..." : "正在删除已选对话...", {
        onCancel: () => this.requestCancelDelete()
      });

      let done = 0;
      let failed = 0;
      let cancelled = false;
      const failureSummary = {};
      const failureDetails = [];
      const total = targets.length;

      if (mode === "all") {
        const failedIds = new Set();
        let totalEstimate = total;
        const skipActiveId =
          options.source === "incognito" && this.incognitoSkipActive ? this.getActiveConversationId() : null;
        while (true) {
          if (this.deleteCancelRequested) {
            cancelled = true;
            break;
          }
          this.refreshSessions();
          const current = Array.from(this.sessionMap.values()).find((item) => {
            if (failedIds.has(item.id)) return false;
            if (this.isConversationArchived(item.conversationId)) return false;
            if (skipActiveId && String(item.conversationId) === skipActiveId) return false;
            return true;
          });
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
            failureDetails.push(this.createFailureDetail(error, current));
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
          if (this.deleteCancelRequested) {
            cancelled = true;
            break;
          }
          this.refreshSessions();
          const current = this.resolveTargetForSelected(queueItem.id, queueItem.title) || queueItem;
          if (!current) {
            failed += 1;
            done += 1;
            const error = this.createFailureError("node_changed", "Selected target no longer exists.");
            this.addFailureSummary(failureSummary, error);
            failureDetails.push(this.createFailureDetail(error, queueItem));
            progress.update(done, total, failed);
            logger.warn("Selected target no longer exists:", queueItem.id);
            continue;
          }
          try {
            await this.deleteSingleSession(current);
          } catch (error) {
            failed += 1;
            this.addFailureSummary(failureSummary, error);
            failureDetails.push(this.createFailureDetail(error, current));
            logger.error("Delete selected failed on session:", current.title, error);
          } finally {
            done += 1;
            progress.update(done, total, failed);
          }
        }
      }

      this.isDeleting = false;
      this.deleteCancelRequested = false;
      this.emitState();
      progress.hide();
      this.scheduleRefresh();
      this.clearSelection(true);
      this.lastFailureDetails = failureDetails.slice();

      const result = {
        ok: failed === 0 && !cancelled,
        reason: cancelled ? "cancelled" : undefined,
        done,
        failed,
        total,
        failureSummary,
        failureDetails
      };
      await this.recordDeleteTask(mode, result, options);

      if (cancelled) {
        toast.show(`已取消删除。本次已处理 ${done}/${total} 个对话，失败 ${failed} 个。`, failed > 0 ? "warning" : "info", 4200);
      } else if (failed === 0) {
        toast.show(options.source === "incognito" ? `无痕模式已清理 ${done} 个对话。` : `已删除 ${done} 个对话。`, "success");
      } else {
        const reasonText = this.formatFailureSummary(failureSummary);
        const prefix = options.source === "incognito" ? "无痕模式自动清理" : "已删除";
        toast.show(`${prefix} ${done - failed}/${done} 个对话，失败 ${failed} 个。${reasonText ? `原因：${reasonText}。` : ""}`, "error", 7000, {
          title: "删除失败详情",
          details: this.formatFailureDetails(failureDetails, failureSummary),
          exportLogs: true
        });
      }

      if (!cancelled && done > 0) {
        this.schedulePageReloadAfterDeleteTask(options);
      }

      return result;
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
        incognitoSkipActive: this.incognitoSkipActive,
        archivedCount: this.archivedConversationIds.size,
        settings: this.settings,
        hasFailedRetryTargets: this.lastFailureDetails.length > 0,
        deleteStats: this.deleteStats,
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
