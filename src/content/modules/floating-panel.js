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
  const INCOGNITO_NOTICE_OPENED_EVENT = "dtk:incognito-notice-opened";
  const INCOGNITO_NOTICE_CLOSED_EVENT = "dtk:incognito-notice-closed";
  const DRAG_THRESHOLD = 4;
  const MIN_PANEL_WIDTH = 240;
  const MIN_PANEL_HEIGHT = 260;
  const MAX_PANEL_WIDTH = 520;
  const MAX_PANEL_HEIGHT = 720;

  class FloatingPanel {
    constructor() {
      this.root = null;
      this.toggleBtn = null;
      this.iconNode = null;
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
      this.incognitoCountdownNode = null;
      this.incognitoCountdownTimer = null;
      this.totalNode = null;
      this.selectedNode = null;
      this.deletableNode = null;
      this.selectedDeletableNode = null;
      this.missingIdNode = null;
      this.missingElementNode = null;
      this.statusNode = null;
      this.opacityInput = null;
      this.opacityValueNode = null;
      this.themeColorInput = null;
      this.highContrastToggle = null;
      this.resizer = null;
      this.panelOpen = false;
      this.dragState = null;
      this.resizeState = null;
      this.lastState = null;
      this.hoverCloseTimer = null;
      this.onboardingShown = false;
      this.onboardingTimer = null;
      this.onboardingNoticeOpenHandler = null;
      this.onboardingNoticeCloseHandler = null;
      this.onboardingPausedForNotice = false;
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
      sessionManager.scheduleDeleteStatsRefresh?.({ force: true });
      this.showOnboardingIfNeeded();
    }

    render() {
      const root = document.createElement("div");
      root.className = "dtk-floating-root";
      root.innerHTML = `
        <button type="button" class="dtk-floating-toggle" aria-label="豆包工具箱，拖动移动，悬停或点击展开">
          <svg class="dtk-floating-icon" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="dtk-hair-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#5C3A2C"/>
                <stop offset="1" stop-color="#3A2218"/>
              </linearGradient>
              <radialGradient id="dtk-cheek-grad" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stop-color="#FF8A96" stop-opacity="0.85"/>
                <stop offset="1" stop-color="#FF8A96" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="dtk-face-shade" cx="0.5" cy="0.5" r="0.6">
                <stop offset="0.6" stop-color="#FFE2C4" stop-opacity="0"/>
                <stop offset="1" stop-color="#E8B98F" stop-opacity="0.55"/>
              </radialGradient>
            </defs>
            <circle cx="36" cy="34" r="14" fill="url(#dtk-hair-grad)"/>
            <circle cx="92" cy="34" r="14" fill="url(#dtk-hair-grad)"/>
            <circle cx="36" cy="22" r="5" fill="#FFA8C4"/>
            <circle cx="92" cy="22" r="5" fill="#FFA8C4"/>
            <ellipse cx="64" cy="74" rx="42" ry="38" fill="#FFE2C4"/>
            <ellipse cx="64" cy="74" rx="42" ry="38" fill="url(#dtk-face-shade)"/>
            <ellipse cx="22" cy="74" rx="6" ry="9" fill="#FFD4B0"/>
            <ellipse cx="106" cy="74" rx="6" ry="9" fill="#FFD4B0"/>
            <path d="M22 60 Q24 38 64 36 Q104 38 106 60 Q96 50 84 52 Q74 44 64 44 Q54 44 44 52 Q32 50 22 60 Z" fill="url(#dtk-hair-grad)"/>
            <path d="M22 60 Q18 80 26 96 Q22 80 28 64 Z" fill="url(#dtk-hair-grad)"/>
            <path d="M106 60 Q110 80 102 96 Q106 80 100 64 Z" fill="url(#dtk-hair-grad)"/>
            <ellipse cx="40" cy="84" rx="10" ry="6" fill="url(#dtk-cheek-grad)"/>
            <ellipse cx="88" cy="84" rx="10" ry="6" fill="url(#dtk-cheek-grad)"/>
            <ellipse cx="48" cy="74" rx="5.2" ry="7.4" fill="#2A1A12"/>
            <ellipse cx="80" cy="74" rx="5.2" ry="7.4" fill="#2A1A12"/>
            <circle cx="50" cy="71" r="2" fill="#ffffff"/>
            <circle cx="82" cy="71" r="2" fill="#ffffff"/>
            <path d="M58 92 Q64 98 70 92" stroke="#C84848" stroke-width="2.4" stroke-linecap="round" fill="none"/>
            <circle cx="64" cy="95.5" r="1.2" fill="#FF8A96"/>
          </svg>
          <span class="dtk-floating-count" aria-live="polite">0</span>
        </button>
        <section class="dtk-floating-panel" role="dialog" aria-label="豆包工具箱控制面板">
          <header class="dtk-floating-header">
            <strong>豆包工具箱</strong>
            <div class="dtk-floating-header-actions">
              <button type="button" data-action="collapse" class="dtk-icon-btn" title="折叠面板" aria-label="折叠面板" data-icon="collapse"></button>
            </div>
          </header>
          <div class="dtk-floating-metrics" aria-live="polite">
            <span>总数：<b class="dtk-metric-total">0</b></span>
            <span>已选：<b class="dtk-metric-selected">0</b></span>
            <span>可删：<b class="dtk-metric-deletable">0</b></span>
            <span>已选可删：<b class="dtk-metric-selected-deletable">0</b></span>
            <span>已归档：<b class="dtk-metric-archived">0</b></span>
            <span>缺 ID：<b class="dtk-metric-missing-id">0</b></span>
            <span>缺元素：<b class="dtk-metric-missing-element">0</b></span>
            <span class="dtk-floating-status">就绪</span>
          </div>
          <div class="dtk-floating-actions">
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">无痕模式</div>
              <label class="dtk-toggle-row">
                <input type="checkbox" data-action="incognito-toggle" aria-label="自动定时清理" />
                <span>自动定时清理</span>
                <span class="dtk-incognito-countdown" hidden></span>
              </label>
              <label class="dtk-interval-row">
                <span>间隔</span>
                <input type="number" data-action="incognito-interval" min="1" max="1440" step="1" aria-label="无痕模式清理间隔分钟数" />
                <span>分钟</span>
              </label>
              <label class="dtk-toggle-row">
                <input type="checkbox" data-action="incognito-skip-active" aria-label="跳过当前打开的对话" />
                <span>跳过当前对话</span>
              </label>
              <span class="dtk-incognito-status">无痕模式未开启</span>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">选择</div>
              <div class="dtk-action-grid">
                <button type="button" data-action="toggle-mode" class="dtk-mini-btn dtk-mini-btn-primary" title="Ctrl+M" data-icon="multi">开启多选</button>
                <button type="button" data-action="select-all" class="dtk-mini-btn dtk-mini-btn-ghost" title="Ctrl+A" data-icon="check">全选</button>
                <button type="button" data-action="clear" class="dtk-mini-btn dtk-mini-btn-ghost" data-icon="clear">清空选择</button>
              </div>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">删除</div>
              <div class="dtk-action-grid">
                <button type="button" data-action="delete-selected" class="dtk-mini-btn dtk-mini-btn-danger" title="Ctrl+D" data-icon="trash">删除已选</button>
                <button type="button" data-action="delete-all" class="dtk-mini-btn dtk-mini-btn-danger-high" title="Ctrl+Shift+D" data-icon="warning">全部删除</button>
              </div>
              <span class="dtk-delete-all-risk">高风险：首次使用需启用</span>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">主题</div>
              <label class="dtk-color-row">
                <span>主题色</span>
                <input type="color" data-action="theme-color" aria-label="自定义主题色" />
              </label>
              <label class="dtk-range-row">
                <span>透明度</span>
                <input type="range" data-action="opacity" min="35" max="100" step="5" aria-label="面板透明度" />
                <span class="dtk-opacity-value">96%</span>
              </label>
              <label class="dtk-toggle-row">
                <input type="checkbox" data-action="high-contrast" aria-label="高对比度模式" />
                <span>高对比度</span>
              </label>
            </div>
          </div>
          <div class="dtk-panel-resize" role="separator" aria-label="拖拽调整面板大小"></div>
        </section>
        <div class="dtk-onboarding-tip" role="status">
          <span class="dtk-onboarding-tip-icon" aria-hidden="true"></span>
          <span>拖动图标可移动位置</span>
          <span class="dtk-onboarding-tip-arrow" aria-hidden="true"></span>
        </div>
      `;
      document.body.appendChild(root);
      this.root = root;
      this.toggleBtn = root.querySelector(".dtk-floating-toggle");
      this.iconNode = root.querySelector(".dtk-floating-icon");
      this.panel = root.querySelector(".dtk-floating-panel");
      this.countNode = root.querySelector(".dtk-floating-count");
      this.modeBtn = root.querySelector("[data-action='toggle-mode']");
      this.selectAllBtn = root.querySelector("[data-action='select-all']");
      this.clearBtn = root.querySelector("[data-action='clear']");
      this.deleteSelectedBtn = root.querySelector("[data-action='delete-selected']");
      this.deleteAllBtn = root.querySelector("[data-action='delete-all']");
      this.incognitoToggle = root.querySelector("[data-action='incognito-toggle']");
      this.incognitoSkipActiveToggle = root.querySelector("[data-action='incognito-skip-active']");
      this.incognitoIntervalInput = root.querySelector("[data-action='incognito-interval']");
      this.incognitoStatusNode = root.querySelector(".dtk-incognito-status");
      this.incognitoCountdownNode = root.querySelector(".dtk-incognito-countdown");
      this.totalNode = root.querySelector(".dtk-metric-total");
      this.selectedNode = root.querySelector(".dtk-metric-selected");
      this.deletableNode = root.querySelector(".dtk-metric-deletable");
      this.selectedDeletableNode = root.querySelector(".dtk-metric-selected-deletable");
      this.archivedNode = root.querySelector(".dtk-metric-archived");
      this.missingIdNode = root.querySelector(".dtk-metric-missing-id");
      this.missingElementNode = root.querySelector(".dtk-metric-missing-element");
      this.statusNode = root.querySelector(".dtk-floating-status");
      this.opacityInput = root.querySelector("[data-action='opacity']");
      this.opacityValueNode = root.querySelector(".dtk-opacity-value");
      this.themeColorInput = root.querySelector("[data-action='theme-color']");
      this.highContrastToggle = root.querySelector("[data-action='high-contrast']");
      this.resizer = root.querySelector(".dtk-panel-resize");
      this.updatePanelPlacement();
    }

    getDefaultPosition() {
      const x = Math.max(12, window.innerWidth - 80);
      const y = 20;
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
      const opacity = this.readNumber(OPACITY_KEY, 96, 35, 100);
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
      const opacity = Math.min(Math.max(Number(value) || 96, 35), 100) / 100;
      document.documentElement.style.setProperty("--dtk-panel-opacity", String(opacity));
      document.documentElement.style.setProperty("--dtk-panel-opacity-percent", `${Math.round(opacity * 100)}%`);
      if (this.opacityValueNode) {
        this.opacityValueNode.textContent = `${Math.round(opacity * 100)}%`;
      }
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

    isMultiSelectActive() {
      return Boolean(this.lastState?.multiSelectMode || sessionManager.getState?.().multiSelectMode);
    }

    clearHoverCloseTimer() {
      if (!this.hoverCloseTimer) {
        return;
      }
      window.clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }

    scheduleHoverClose() {
      this.clearHoverCloseTimer();
      if (!this.canHoverOpen() || this.dragState || this.resizeState || this.isMultiSelectActive()) {
        return;
      }
      this.hoverCloseTimer = window.setTimeout(() => {
        this.hoverCloseTimer = null;
        if (this.panelOpen && !this.dragState && !this.resizeState && !this.isMultiSelectActive()) {
          this.setPanelOpen(false);
        }
      }, 220);
    }

    setPanelOpen(open, options = {}) {
      this.panelOpen = Boolean(open);
      this.updatePanelPlacement();
      this.root.classList.toggle("open", this.panelOpen);
      this.toggleBtn.setAttribute("aria-expanded", String(this.panelOpen));
      if (this.panelOpen) {
        sessionManager.scheduleDeleteStatsRefresh?.({ force: true });
      }
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
      this.root.addEventListener("pointerenter", () => this.clearHoverCloseTimer());
      this.root.addEventListener("pointerleave", () => this.scheduleHoverClose());
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

      this.selectAllBtn.addEventListener("click", () => {
        const state = sessionManager.getState();
        const allSelected = (state.totalSessions || 0) > 0 && (state.selectedCount || 0) >= (state.totalSessions || 0);
        if (allSelected) {
          sessionManager.clearSelection();
        } else {
          sessionManager.selectAll();
        }
      });
      this.clearBtn.addEventListener("click", () => sessionManager.clearSelection());
      this.deleteSelectedBtn.addEventListener("click", async () => sessionManager.deleteSessions("selected"));
      this.deleteAllBtn.addEventListener("click", async () => sessionManager.deleteSessions("all"));

      this.incognitoToggle.addEventListener("change", async () => {
        const result = await sessionManager.setIncognitoMode(this.incognitoToggle.checked);
        if (!result?.ok) {
          this.incognitoToggle.checked = sessionManager.getState().incognitoModeEnabled;
        }
      });

      this.incognitoSkipActiveToggle.addEventListener("change", () => {
        sessionManager.setIncognitoSkipActive(this.incognitoSkipActiveToggle.checked);
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
        if (this.panelOpen && !this.root.contains(event.target) && !this.isMultiSelectActive()) {
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
        const allSelected =
          (this.lastState.totalSessions || 0) > 0 && (this.lastState.selectedCount || 0) >= (this.lastState.totalSessions || 0);
        if (allSelected) {
          sessionManager.clearSelection();
        } else {
          sessionManager.selectAll();
        }
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
      if (this.onboardingShown || !this.root) {
        return;
      }
      this.onboardingShown = true;
      this.root.classList.add("show-onboarding");
      this.onboardingNoticeOpenHandler = () => this.pauseOnboardingForNotice();
      this.onboardingNoticeCloseHandler = () => this.resumeOnboardingAfterNotice();
      window.addEventListener(INCOGNITO_NOTICE_OPENED_EVENT, this.onboardingNoticeOpenHandler, { once: true });
      window.addEventListener(INCOGNITO_NOTICE_CLOSED_EVENT, this.onboardingNoticeCloseHandler, { once: true });
      this.startOnboardingTimer();
    }

    startOnboardingTimer() {
      if (!this.root) {
        return;
      }
      if (this.onboardingTimer) {
        window.clearTimeout(this.onboardingTimer);
      }
      this.root.classList.add("count-onboarding");
      this.onboardingTimer = window.setTimeout(() => {
        this.onboardingTimer = null;
        this.root?.classList.remove("show-onboarding", "count-onboarding");
        this.cleanupOnboardingNoticeListeners();
      }, 5200);
    }

    pauseOnboardingForNotice() {
      if (!this.root?.classList.contains("show-onboarding")) {
        return;
      }
      this.onboardingPausedForNotice = true;
      if (this.onboardingTimer) {
        window.clearTimeout(this.onboardingTimer);
        this.onboardingTimer = null;
      }
      this.root.classList.remove("count-onboarding");
    }

    resumeOnboardingAfterNotice() {
      if (this.onboardingPausedForNotice) {
        this.onboardingPausedForNotice = false;
        this.startOnboardingTimer();
        return;
      }
      this.cleanupOnboardingNoticeListeners();
    }

    cleanupOnboardingNoticeListeners() {
      if (this.onboardingNoticeOpenHandler) {
        window.removeEventListener(INCOGNITO_NOTICE_OPENED_EVENT, this.onboardingNoticeOpenHandler);
        this.onboardingNoticeOpenHandler = null;
      }
      if (this.onboardingNoticeCloseHandler) {
        window.removeEventListener(INCOGNITO_NOTICE_CLOSED_EVENT, this.onboardingNoticeCloseHandler);
        this.onboardingNoticeCloseHandler = null;
      }
    }

    update(state) {
      if (!state) {
        return;
      }
      if (!this.root || !this.panel || !this.toggleBtn || !this.iconNode) {
        return;
      }
      this.lastState = state;
      if (state.multiSelectMode) {
        this.clearHoverCloseTimer();
      }
      this.countNode.textContent = String(state.selectedCount || 0);
      this.totalNode.textContent = String(state.totalSessions || 0);
      this.selectedNode.textContent = String(state.selectedCount || 0);
      const stats = state.deleteStats || {};
      this.deletableNode.textContent = String(stats.deletable ?? state.totalSessions ?? 0);
      this.selectedDeletableNode.textContent = String(stats.selectedDeletable ?? state.selectedCount ?? 0);
      this.archivedNode.textContent = String(stats.archivedCount ?? state.archivedCount ?? 0);
      this.missingIdNode.textContent = String(stats.missingConversationId ?? 0);
      this.missingElementNode.textContent = String(stats.missingElement ?? 0);
      this.modeBtn.textContent = state.multiSelectMode ? "关闭多选" : "开启多选";
      const allSelected = (state.totalSessions || 0) > 0 && (state.selectedCount || 0) >= (state.totalSessions || 0);
      this.selectAllBtn.textContent = allSelected ? "取消全选" : "全选";
      this.selectAllBtn.setAttribute("aria-pressed", String(allSelected));
      this.statusNode.textContent = state.isDeleting ? "删除中..." : stats.loading ? "统计中..." : "已统计";

      this.root.classList.toggle("selecting", Boolean(state.multiSelectMode) && !state.isDeleting);
      this.root.classList.toggle("deleting", Boolean(state.isDeleting));
      if (state.isDeleting) {
        this.countNode.textContent = "";
      } else if (state.multiSelectMode) {
        this.countNode.textContent = String(state.selectedCount || 0);
      } else {
        this.countNode.textContent = "";
      }

      const riskNode = this.panel.querySelector(".dtk-delete-all-risk");
      if (riskNode) {
        riskNode.textContent = state.deleteAllUnlocked ? "高风险：删除前仍需确认" : "高风险：首次使用需启用";
      }

      this.incognitoToggle.checked = Boolean(state.incognitoModeEnabled);
      this.incognitoSkipActiveToggle.checked = state.incognitoSkipActive !== false;
      this.incognitoIntervalInput.value = String(state.incognitoIntervalMinutes || 10);
      this.incognitoStatusNode.textContent = this.formatIncognitoStatus(state);
      this.syncCountdownTimer(state);

      const disabled = Boolean(state.isDeleting);
      for (const button of this.panel.querySelectorAll("button")) {
        button.disabled = disabled;
      }
      const collapseButton = this.root.querySelector("[data-action='collapse']");
      if (collapseButton) {
        collapseButton.disabled = false;
      }
      this.deleteSelectedBtn.disabled = disabled || (state.selectedCount || 0) === 0;
      this.incognitoToggle.disabled = disabled;
      this.incognitoSkipActiveToggle.disabled = disabled;
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
      const remainingMs = nextRunAt - Date.now();
      if (remainingMs <= 60000) {
        return "已开启，即将清理";
      }
      const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
      return `已开启，约 ${remainingMinutes} 分钟后清理`;
    }

    syncCountdownTimer(state) {
      if (!state.incognitoModeEnabled || !state.incognitoNextRunAt) {
        this.stopCountdownTimer();
        return;
      }
      this.lastIncognitoNextRunAt = Number(state.incognitoNextRunAt);
      if (this.incognitoCountdownTimer) {
        clearInterval(this.incognitoCountdownTimer);
      }
      this.incognitoCountdownTimer = setInterval(() => this.updateCountdown(), 1000);
      this.updateCountdown();
    }

    stopCountdownTimer() {
      if (this.incognitoCountdownTimer) {
        clearInterval(this.incognitoCountdownTimer);
        this.incognitoCountdownTimer = null;
      }
      this.lastIncognitoNextRunAt = 0;
      if (this.incognitoCountdownNode) {
        this.incognitoCountdownNode.hidden = true;
        this.incognitoCountdownNode.textContent = "";
        this.incognitoCountdownNode.classList.remove("dtk-countdown-urgent");
      }
    }

    updateCountdown() {
      const el = this.incognitoCountdownNode;
      if (!el) return;
      const nextRunAt = this.lastIncognitoNextRunAt || 0;
      if (!nextRunAt) {
        el.hidden = true;
        el.textContent = "";
        el.classList.remove("dtk-countdown-urgent");
        return;
      }
      const remainingSeconds = Math.max(0, Math.ceil((nextRunAt - Date.now()) / 1000));
      if (remainingSeconds <= 60 && remainingSeconds > 0) {
        el.hidden = false;
        el.textContent = `${remainingSeconds}s`;
        el.classList.toggle("dtk-countdown-urgent", remainingSeconds <= 10);
      } else if (remainingSeconds <= 0) {
        el.hidden = false;
        el.textContent = "0s";
        el.classList.add("dtk-countdown-urgent");
      } else {
        el.hidden = true;
        el.textContent = "";
        el.classList.remove("dtk-countdown-urgent");
      }
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.floatingPanel = new FloatingPanel();
  logger?.debug("Floating panel module loaded.");
})(window);
