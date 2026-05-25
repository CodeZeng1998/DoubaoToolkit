(function initFloatingPanel(global) {
  "use strict";

  const toolkit = global.DoubaoToolkit || {};
  const sessionManager = toolkit.sessionManager;
  const logger = toolkit.logger;

  const POSITION_KEY = "dtk_floating_position_v1";
  const SIZE_KEY = "dtk_floating_size_v1";
  const OPACITY_KEY = "dtk_floating_opacity_v1";
  const THEME_COLOR_KEY = "dtk_theme_color_v1";
  const HIGH_CONTRAST_KEY = "dtk_high_contrast_v1";
  const ONBOARDING_KEY = "dtk_onboarding_seen_v1";
  const DRAG_THRESHOLD = 4;
  const MIN_PANEL_WIDTH = 240;
  const MIN_PANEL_HEIGHT = 260;
  const MAX_PANEL_WIDTH = 520;
  const MAX_PANEL_HEIGHT = 720;

  class FloatingPanel {
    constructor() {
      this.root = null;
      this.toggleBtn = null;
      this.panel = null;
      this.countNode = null;
      this.modeBtn = null;
      this.selectAllBtn = null;
      this.clearBtn = null;
      this.deleteSelectedBtn = null;
      this.deleteAllBtn = null;
      this.incognitoToggle = null;
      this.incognitoIntervalInput = null;
      this.incognitoStatusNode = null;
      this.totalNode = null;
      this.selectedNode = null;
      this.statusNode = null;
      this.opacityInput = null;
      this.themeColorInput = null;
      this.highContrastToggle = null;
      this.resizer = null;
      this.panelOpen = false;
      this.dragState = null;
      this.resizeState = null;
      this.lastState = null;
    }

    init() {
      if (this.root && document.body.contains(this.root)) {
        return;
      }
      this.render();
      this.applyPreferences();
      this.applySavedPosition();
      this.applySavedSize();
      this.bind();
      this.updateResponsiveMode();
      this.update(sessionManager.getState());
      this.showOnboardingIfNeeded();
    }

    render() {
      const root = document.createElement("div");
      root.className = "dtk-floating-root";
      root.innerHTML = `
        <button type="button" class="dtk-floating-toggle" aria-label="豆包工具箱，拖动移动，悬停或点击展开">
          <span class="dtk-floating-dot">工具</span>
          <span class="dtk-floating-count" aria-live="polite">0</span>
        </button>
        <section class="dtk-floating-panel" role="dialog" aria-label="豆包工具箱控制面板">
          <header class="dtk-floating-header">
            <strong>豆包工具箱</strong>
            <div class="dtk-floating-header-actions">
              <button type="button" data-action="collapse" class="dtk-icon-btn" title="折叠面板" aria-label="折叠面板">×</button>
            </div>
          </header>
          <div class="dtk-floating-metrics" aria-live="polite">
            <span>总数：<b class="dtk-metric-total">0</b></span>
            <span>已选：<b class="dtk-metric-selected">0</b></span>
            <span class="dtk-floating-status">就绪</span>
          </div>
          <div class="dtk-floating-actions">
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">选择</div>
              <div class="dtk-action-grid">
                <button type="button" data-action="toggle-mode" class="dtk-mini-btn dtk-mini-btn-primary" title="Ctrl+M">开启多选</button>
                <button type="button" data-action="select-all" class="dtk-mini-btn dtk-mini-btn-ghost" title="Ctrl+A">全选</button>
                <button type="button" data-action="clear" class="dtk-mini-btn dtk-mini-btn-ghost">清空选择</button>
              </div>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">删除</div>
              <div class="dtk-action-grid">
                <button type="button" data-action="delete-selected" class="dtk-mini-btn dtk-mini-btn-danger" title="Ctrl+D">删除已选</button>
                <button type="button" data-action="delete-all" class="dtk-mini-btn dtk-mini-btn-danger-high" title="Ctrl+Shift+D">全部删除</button>
              </div>
              <span class="dtk-delete-all-risk">高风险：首次使用需启用</span>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">无痕模式</div>
              <label class="dtk-toggle-row">
                <input type="checkbox" data-action="incognito-toggle" aria-label="自动定时清理" />
                <span>自动定时清理</span>
              </label>
              <label class="dtk-interval-row">
                <span>间隔</span>
                <input type="number" data-action="incognito-interval" min="1" max="1440" step="1" aria-label="无痕模式清理间隔分钟数" />
                <span>分钟</span>
              </label>
              <span class="dtk-incognito-status">无痕模式未开启</span>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">主题</div>
              <label class="dtk-color-row">
                <span>主题色</span>
                <input type="color" data-action="theme-color" aria-label="自定义主题色" />
              </label>
              <label class="dtk-range-row">
                <span>透明度</span>
                <input type="range" data-action="opacity" min="72" max="100" step="2" aria-label="面板透明度" />
              </label>
              <label class="dtk-toggle-row">
                <input type="checkbox" data-action="high-contrast" aria-label="高对比度模式" />
                <span>高对比度</span>
              </label>
            </div>
          </div>
          <div class="dtk-panel-resize" role="separator" aria-label="拖拽调整面板大小"></div>
        </section>
        <div class="dtk-onboarding-tip" role="status">拖动按钮移动面板，Ctrl+D 删除已选对话。</div>
      `;
      document.body.appendChild(root);
      this.root = root;
      this.toggleBtn = root.querySelector(".dtk-floating-toggle");
      this.panel = root.querySelector(".dtk-floating-panel");
      this.countNode = root.querySelector(".dtk-floating-count");
      this.modeBtn = root.querySelector("[data-action='toggle-mode']");
      this.selectAllBtn = root.querySelector("[data-action='select-all']");
      this.clearBtn = root.querySelector("[data-action='clear']");
      this.deleteSelectedBtn = root.querySelector("[data-action='delete-selected']");
      this.deleteAllBtn = root.querySelector("[data-action='delete-all']");
      this.incognitoToggle = root.querySelector("[data-action='incognito-toggle']");
      this.incognitoIntervalInput = root.querySelector("[data-action='incognito-interval']");
      this.incognitoStatusNode = root.querySelector(".dtk-incognito-status");
      this.totalNode = root.querySelector(".dtk-metric-total");
      this.selectedNode = root.querySelector(".dtk-metric-selected");
      this.statusNode = root.querySelector(".dtk-floating-status");
      this.opacityInput = root.querySelector("[data-action='opacity']");
      this.themeColorInput = root.querySelector("[data-action='theme-color']");
      this.highContrastToggle = root.querySelector("[data-action='high-contrast']");
      this.resizer = root.querySelector(".dtk-panel-resize");
      this.updatePanelPlacement();
    }

    getDefaultPosition() {
      const x = Math.max(12, window.innerWidth - 80);
      const y = Math.max(12, window.innerHeight - 180);
      return { x, y };
    }

    isDrawerMode() {
      return window.matchMedia("(max-width: 640px), (pointer: coarse) and (max-width: 820px)").matches;
    }

    clampPosition(x, y) {
      const rect = this.toggleBtn.getBoundingClientRect();
      const maxX = Math.max(12, window.innerWidth - rect.width - 12);
      const maxY = Math.max(12, window.innerHeight - rect.height - 12);
      return {
        x: Math.min(Math.max(12, x), maxX),
        y: Math.min(Math.max(12, y), maxY)
      };
    }

    saveJson(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_error) {
        logger?.debug("saveJson failed:", key);
      }
    }

    readJson(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_error) {
        return null;
      }
    }

    applyPosition(x, y) {
      if (this.isDrawerMode()) {
        this.root.style.left = "auto";
        this.root.style.top = "auto";
        this.root.style.right = "16px";
        this.root.style.bottom = "18px";
        return this.getDefaultPosition();
      }
      const clamped = this.clampPosition(x, y);
      this.root.style.left = `${clamped.x}px`;
      this.root.style.top = `${clamped.y}px`;
      this.root.style.right = "auto";
      this.root.style.bottom = "auto";
      this.updatePanelPlacement();
      return clamped;
    }

    updatePanelPlacement() {
      if (!this.root || !this.toggleBtn || !this.panel) {
        return;
      }
      if (this.isDrawerMode()) {
        this.root.classList.remove("align-left", "align-right", "open-up");
        this.root.classList.add("open-down", "drawer-mode");
        return;
      }
      this.root.classList.remove("drawer-mode");
      const margin = 12;
      const gap = 10;
      const toggleRect = this.toggleBtn.getBoundingClientRect();
      const panelWidth = Math.min(this.panel.offsetWidth || 300, window.innerWidth - margin * 2);
      const panelHeight = Math.min(this.panel.scrollHeight || 300, window.innerHeight - margin * 2);
      const shouldOpenLeft = toggleRect.left + panelWidth > window.innerWidth - margin;
      const shouldOpenUp =
        toggleRect.bottom + gap + panelHeight > window.innerHeight - margin &&
        toggleRect.top - gap - panelHeight >= margin;

      this.root.classList.toggle("align-right", shouldOpenLeft);
      this.root.classList.toggle("align-left", !shouldOpenLeft);
      this.root.classList.toggle("open-up", shouldOpenUp);
      this.root.classList.toggle("open-down", !shouldOpenUp);
    }

    applySavedPosition() {
      const saved = this.readJson(POSITION_KEY);
      const initial =
        saved && typeof saved.x === "number" && typeof saved.y === "number" ? saved : this.getDefaultPosition();
      const applied = this.applyPosition(initial.x, initial.y);
      if (!saved) {
        this.saveJson(POSITION_KEY, applied);
      }
    }

    applySavedSize() {
      const saved = this.readJson(SIZE_KEY);
      if (!saved || typeof saved.width !== "number" || typeof saved.height !== "number") {
        return;
      }
      this.applyPanelSize(saved.width, saved.height, false);
    }

    applyPanelSize(width, height, persist = true) {
      const safeWidth = Math.min(Math.max(Math.round(width), MIN_PANEL_WIDTH), Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
      const safeHeight = Math.min(Math.max(Math.round(height), MIN_PANEL_HEIGHT), Math.min(MAX_PANEL_HEIGHT, window.innerHeight - 24));
      this.panel.style.setProperty("--dtk-panel-width", `${safeWidth}px`);
      this.panel.style.setProperty("--dtk-panel-height", `${safeHeight}px`);
      if (persist) {
        this.saveJson(SIZE_KEY, { width: safeWidth, height: safeHeight });
      }
      this.updatePanelPlacement();
    }

    applyPreferences() {
      const opacity = this.readNumber(OPACITY_KEY, 96, 72, 100);
      const color = this.readString(THEME_COLOR_KEY, "#1f6fff");
      const highContrast = this.readString(HIGH_CONTRAST_KEY, "false") === "true";
      this.opacityInput.value = String(opacity);
      this.themeColorInput.value = color;
      this.highContrastToggle.checked = highContrast;
      this.applyOpacity(opacity);
      this.applyThemeColor(color);
      this.applyHighContrast(highContrast);
    }

    readString(key, fallback) {
      try {
        return localStorage.getItem(key) || fallback;
      } catch (_error) {
        return fallback;
      }
    }

    readNumber(key, fallback, min, max) {
      const value = Number(this.readString(key, String(fallback)));
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return Math.min(Math.max(Math.round(value), min), max);
    }

    writeString(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch (_error) {
        logger?.debug("writeString failed:", key);
      }
    }

    applyOpacity(value) {
      const opacity = Math.min(Math.max(Number(value) || 96, 72), 100) / 100;
      document.documentElement.style.setProperty("--dtk-panel-opacity", String(opacity));
      document.documentElement.style.setProperty("--dtk-panel-opacity-percent", `${Math.round(opacity * 100)}%`);
      this.writeString(OPACITY_KEY, Math.round(opacity * 100));
    }

    applyThemeColor(value) {
      const color = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#1f6fff";
      document.documentElement.style.setProperty("--dtk-primary", color);
      this.writeString(THEME_COLOR_KEY, color);
    }

    applyHighContrast(enabled) {
      document.documentElement.classList.toggle("dtk-high-contrast", Boolean(enabled));
      this.writeString(HIGH_CONTRAST_KEY, Boolean(enabled));
    }

    canHoverOpen() {
      return !this.isDrawerMode() && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    }

    setPanelOpen(open, options = {}) {
      this.panelOpen = Boolean(open);
      this.updatePanelPlacement();
      this.root.classList.toggle("open", this.panelOpen);
      this.toggleBtn.setAttribute("aria-expanded", String(this.panelOpen));
      if (this.panelOpen && options.focus !== false) {
        window.setTimeout(() => this.modeBtn.focus(), 0);
      }
    }

    beginDrag(event) {
      if (this.isDrawerMode()) {
        return;
      }
      const rect = this.root.getBoundingClientRect();
      this.dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false
      };
      this.toggleBtn.setPointerCapture?.(event.pointerId);
      this.root.classList.add("dragging");
      event.preventDefault();
    }

    onDragging(event) {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return;
      }
      const dx = event.clientX - this.dragState.startX;
      const dy = event.clientY - this.dragState.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        this.dragState.moved = true;
      }
      this.applyPosition(this.dragState.originLeft + dx, this.dragState.originTop + dy);
    }

    endDrag(event) {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return null;
      }
      const moved = this.dragState.moved;
      this.toggleBtn.releasePointerCapture?.(event.pointerId);
      this.dragState = null;
      this.root.classList.remove("dragging");
      const rect = this.root.getBoundingClientRect();
      this.saveJson(POSITION_KEY, { x: rect.left, y: rect.top });
      return moved;
    }

    beginResize(event) {
      if (this.isDrawerMode()) {
        return;
      }
      const rect = this.panel.getBoundingClientRect();
      this.resizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width,
        height: rect.height
      };
      this.resizer.setPointerCapture?.(event.pointerId);
      this.root.classList.add("resizing");
      event.preventDefault();
    }

    onResizing(event) {
      if (!this.resizeState || event.pointerId !== this.resizeState.pointerId) {
        return;
      }
      const dx = event.clientX - this.resizeState.startX;
      const dy = event.clientY - this.resizeState.startY;
      this.applyPanelSize(this.resizeState.width + dx, this.resizeState.height + dy);
    }

    endResize(event) {
      if (!this.resizeState || event.pointerId !== this.resizeState.pointerId) {
        return;
      }
      this.resizer.releasePointerCapture?.(event.pointerId);
      this.resizeState = null;
      this.root.classList.remove("resizing");
    }

    bind() {
      this.toggleBtn.addEventListener("pointerenter", () => {
        if (!this.panelOpen && !this.dragState && this.canHoverOpen()) {
          this.setPanelOpen(true, { focus: false });
        }
      });
      this.toggleBtn.addEventListener("pointerdown", (event) => this.beginDrag(event));
      this.toggleBtn.addEventListener("pointermove", (event) => this.onDragging(event));
      this.toggleBtn.addEventListener("pointerup", (event) => {
        const moved = this.endDrag(event);
        if (moved === false || (moved === null && this.isDrawerMode())) {
          this.setPanelOpen(!this.panelOpen);
        }
      });
      this.toggleBtn.addEventListener("click", (event) => event.preventDefault());

      this.resizer.addEventListener("pointerdown", (event) => this.beginResize(event));
      this.resizer.addEventListener("pointermove", (event) => this.onResizing(event));
      this.resizer.addEventListener("pointerup", (event) => this.endResize(event));

      this.root.querySelector("[data-action='collapse']").addEventListener("click", () => this.setPanelOpen(false));

      this.modeBtn.addEventListener("click", () => {
        const state = sessionManager.getState();
        sessionManager.setMultiSelectMode(!state.multiSelectMode);
      });

      this.selectAllBtn.addEventListener("click", () => sessionManager.selectAll());
      this.clearBtn.addEventListener("click", () => sessionManager.clearSelection());
      this.deleteSelectedBtn.addEventListener("click", async () => sessionManager.deleteSessions("selected"));
      this.deleteAllBtn.addEventListener("click", async () => sessionManager.deleteSessions("all"));

      this.incognitoToggle.addEventListener("change", async () => {
        const result = await sessionManager.setIncognitoMode(this.incognitoToggle.checked);
        if (!result?.ok) {
          this.incognitoToggle.checked = sessionManager.getState().incognitoModeEnabled;
        }
      });

      this.incognitoIntervalInput.addEventListener("change", () => {
        sessionManager.setIncognitoInterval(this.incognitoIntervalInput.value);
      });

      this.opacityInput.addEventListener("input", () => this.applyOpacity(this.opacityInput.value));
      this.themeColorInput.addEventListener("input", () => this.applyThemeColor(this.themeColorInput.value));
      this.highContrastToggle.addEventListener("change", () => this.applyHighContrast(this.highContrastToggle.checked));

      window.addEventListener("dtk:state-changed", (event) => this.update(event.detail));
      window.addEventListener("resize", () => this.updateResponsiveMode());
      document.addEventListener("click", (event) => {
        if (this.panelOpen && !this.root.contains(event.target)) {
          this.setPanelOpen(false);
        }
      });
      document.addEventListener("keydown", (event) => this.handleKeyboard(event));
    }

    handleKeyboard(event) {
      if (this.isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "Escape" && this.panelOpen) {
        this.setPanelOpen(false);
        return;
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "d" && event.shiftKey) {
        event.preventDefault();
        sessionManager.deleteSessions("all");
      } else if (key === "d") {
        event.preventDefault();
        sessionManager.deleteSessions("selected");
      } else if (key === "m") {
        event.preventDefault();
        const state = sessionManager.getState();
        sessionManager.setMultiSelectMode(!state.multiSelectMode);
      } else if (key === "a" && this.lastState?.multiSelectMode) {
        event.preventDefault();
        sessionManager.selectAll();
      }
    }

    isTypingTarget(target) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    }

    updateResponsiveMode() {
      const rect = this.root?.getBoundingClientRect();
      this.root?.classList.toggle("drawer-mode", this.isDrawerMode());
      if (rect) {
        const applied = this.applyPosition(rect.left, rect.top);
        if (!this.isDrawerMode()) {
          this.saveJson(POSITION_KEY, applied);
        }
      }
      this.updatePanelPlacement();
    }

    showOnboardingIfNeeded() {
      if (this.readString(ONBOARDING_KEY, "false") === "true") {
        return;
      }
      this.root.classList.add("show-onboarding");
      this.writeString(ONBOARDING_KEY, "true");
      window.setTimeout(() => this.root?.classList.remove("show-onboarding"), 5200);
    }

    update(state) {
      if (!state) {
        return;
      }
      this.lastState = state;
      this.countNode.textContent = String(state.selectedCount || 0);
      this.totalNode.textContent = String(state.totalSessions || 0);
      this.selectedNode.textContent = String(state.selectedCount || 0);
      this.modeBtn.textContent = state.multiSelectMode ? "关闭多选" : "开启多选";
      this.statusNode.textContent = state.isDeleting ? "删除中..." : "就绪";

      this.root.classList.toggle("selecting", Boolean(state.multiSelectMode) && !state.isDeleting);
      this.root.classList.toggle("deleting", Boolean(state.isDeleting));
      const dot = this.root.querySelector(".dtk-floating-dot");
      if (state.isDeleting) {
        dot.textContent = "删";
        this.countNode.textContent = "";
      } else if (state.multiSelectMode) {
        dot.textContent = "选";
        this.countNode.textContent = String(state.selectedCount || 0);
      } else {
        dot.textContent = "工具";
        this.countNode.textContent = "";
      }

      const riskNode = this.panel.querySelector(".dtk-delete-all-risk");
      if (riskNode) {
        riskNode.textContent = state.deleteAllUnlocked ? "高风险：删除前仍需确认" : "高风险：首次使用需启用";
      }

      this.incognitoToggle.checked = Boolean(state.incognitoModeEnabled);
      this.incognitoIntervalInput.value = String(state.incognitoIntervalMinutes || 10);
      this.incognitoStatusNode.textContent = this.formatIncognitoStatus(state);

      const disabled = Boolean(state.isDeleting);
      for (const button of this.panel.querySelectorAll("button")) {
        button.disabled = disabled;
      }
      this.root.querySelector("[data-action='collapse']").disabled = false;
      this.deleteSelectedBtn.disabled = disabled || (state.selectedCount || 0) === 0;
      this.incognitoToggle.disabled = disabled;
      this.incognitoIntervalInput.disabled = disabled;
      this.opacityInput.disabled = disabled;
      this.themeColorInput.disabled = disabled;
      this.highContrastToggle.disabled = disabled;
      this.updatePanelPlacement();
    }

    formatIncognitoStatus(state) {
      if (!state.incognitoModeEnabled) {
        return "无痕模式未开启";
      }
      const nextRunAt = Number(state.incognitoNextRunAt || 0);
      if (!nextRunAt) {
        return `已开启，每 ${state.incognitoIntervalMinutes || 10} 分钟清理`;
      }
      const remainingMinutes = Math.max(1, Math.ceil((nextRunAt - Date.now()) / 60000));
      return `已开启，约 ${remainingMinutes} 分钟后清理`;
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.floatingPanel = new FloatingPanel();
  logger?.debug("Floating panel module loaded.");
})(window);
