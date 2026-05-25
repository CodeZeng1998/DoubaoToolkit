(function initFloatingPanel(global) {
  "use strict";

  const toolkit = global.DoubaoToolkit || {};
  const sessionManager = toolkit.sessionManager;
  const logger = toolkit.logger;

  const POSITION_KEY = "dtk_floating_position_v1";
  const DRAG_THRESHOLD = 4;

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
      this.panelOpen = false;
      this.dragState = null;
    }

    init() {
      if (this.root && document.body.contains(this.root)) {
        return;
      }
      this.render();
      this.applySavedPosition();
      this.bind();
      this.update(sessionManager.getState());
    }

    render() {
      const root = document.createElement("div");
      root.className = "dtk-floating-root";
      root.innerHTML = `
        <button type="button" class="dtk-floating-toggle" aria-label="豆包工具箱">
          <span class="dtk-floating-dot">工具</span>
          <span class="dtk-floating-count">0</span>
        </button>
        <section class="dtk-floating-panel">
          <header class="dtk-floating-header">
            <strong>豆包工具箱</strong>
            <span class="dtk-floating-status">就绪</span>
          </header>
          <div class="dtk-floating-metrics">
            <span>总数：<b class="dtk-metric-total">0</b></span>
            <span>已选：<b class="dtk-metric-selected">0</b></span>
          </div>
          <div class="dtk-floating-actions">
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">选择</div>
              <div class="dtk-action-grid">
                <button type="button" data-action="toggle-mode" class="dtk-mini-btn dtk-mini-btn-primary">开启多选</button>
                <button type="button" data-action="select-all" class="dtk-mini-btn dtk-mini-btn-ghost">全选</button>
                <button type="button" data-action="clear" class="dtk-mini-btn dtk-mini-btn-ghost">清空选择</button>
              </div>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">删除</div>
              <div class="dtk-action-grid">
                <button type="button" data-action="delete-selected" class="dtk-mini-btn dtk-mini-btn-danger">删除已选</button>
                <button type="button" data-action="delete-all" class="dtk-mini-btn dtk-mini-btn-danger-high">全部删除</button>
              </div>
              <span class="dtk-delete-all-risk">高风险：首次使用需启用</span>
            </div>
            <div class="dtk-action-group">
              <div class="dtk-action-group-title">无痕模式</div>
              <label class="dtk-toggle-row">
                <input type="checkbox" data-action="incognito-toggle" />
                <span>自动定时清理</span>
              </label>
              <label class="dtk-interval-row">
                <span>间隔</span>
                <input type="number" data-action="incognito-interval" min="1" max="1440" step="1" />
                <span>分钟</span>
              </label>
              <span class="dtk-incognito-status">无痕模式未开启</span>
            </div>
          </div>
        </section>
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
      this.updatePanelPlacement();
    }

    getDefaultPosition() {
      const x = Math.max(12, window.innerWidth - 80);
      const y = Math.max(12, window.innerHeight - 180);
      return { x, y };
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

    savePosition(position) {
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch (_error) {
        logger?.debug("savePosition failed.");
      }
    }

    readSavedPosition() {
      try {
        const raw = localStorage.getItem(POSITION_KEY);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.x !== "number" || typeof parsed.y !== "number") {
          return null;
        }
        return parsed;
      } catch (_error) {
        return null;
      }
    }

    applyPosition(x, y) {
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
      const margin = 12;
      const gap = 10;
      const toggleRect = this.toggleBtn.getBoundingClientRect();
      const panelWidth = Math.min(280, Math.max(220, window.innerWidth - margin * 2));
      const panelHeight = Math.min(this.panel.scrollHeight || 260, Math.max(220, window.innerHeight - margin * 2));
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
      const saved = this.readSavedPosition();
      const initial = saved || this.getDefaultPosition();
      const applied = this.applyPosition(initial.x, initial.y);
      if (!saved) {
        this.savePosition(applied);
      }
    }

    beginDrag(event) {
      const rect = this.root.getBoundingClientRect();
      this.dragState = {
        startX: event.clientX,
        startY: event.clientY,
        originLeft: rect.left,
        originTop: rect.top,
        moved: false
      };
      this.root.classList.add("dragging");
      event.preventDefault();
    }

    onDragging(event) {
      if (!this.dragState) {
        return;
      }
      const dx = event.clientX - this.dragState.startX;
      const dy = event.clientY - this.dragState.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        this.dragState.moved = true;
      }
      const nextX = this.dragState.originLeft + dx;
      const nextY = this.dragState.originTop + dy;
      this.applyPosition(nextX, nextY);
    }

    endDrag() {
      if (!this.dragState) {
        return false;
      }
      const moved = this.dragState.moved;
      this.dragState = null;
      this.root.classList.remove("dragging");
      const rect = this.root.getBoundingClientRect();
      this.savePosition({ x: rect.left, y: rect.top });
      return moved;
    }

    bindDrag() {
      this.toggleBtn.addEventListener("pointerdown", (event) => {
        this.beginDrag(event);
      });

      window.addEventListener("pointermove", (event) => {
        this.onDragging(event);
      });

      window.addEventListener("pointerup", () => {
        const moved = this.endDrag();
        if (!moved && this.dragState === null) {
          this.panelOpen = !this.panelOpen;
          this.updatePanelPlacement();
          this.root.classList.toggle("open", this.panelOpen);
        }
      });

      window.addEventListener("resize", () => {
        const rect = this.root.getBoundingClientRect();
        const applied = this.applyPosition(rect.left, rect.top);
        this.savePosition(applied);
        this.updatePanelPlacement();
      });
    }

    bind() {
      this.bindDrag();

      this.modeBtn.addEventListener("click", () => {
        const state = sessionManager.getState();
        sessionManager.setMultiSelectMode(!state.multiSelectMode);
      });

      this.selectAllBtn.addEventListener("click", () => {
        sessionManager.selectAll();
      });

      this.clearBtn.addEventListener("click", () => {
        sessionManager.clearSelection();
      });

      this.deleteSelectedBtn.addEventListener("click", async () => {
        await sessionManager.deleteSessions("selected");
      });

      this.deleteAllBtn.addEventListener("click", async () => {
        await sessionManager.deleteSessions("all");
      });

      this.incognitoToggle.addEventListener("change", async () => {
        const result = await sessionManager.setIncognitoMode(this.incognitoToggle.checked);
        if (!result?.ok) {
          this.incognitoToggle.checked = sessionManager.getState().incognitoModeEnabled;
        }
      });

      this.incognitoIntervalInput.addEventListener("change", () => {
        sessionManager.setIncognitoInterval(this.incognitoIntervalInput.value);
      });

      window.addEventListener("dtk:state-changed", (event) => {
        this.update(event.detail);
      });

      document.addEventListener("click", (event) => {
        if (!this.panelOpen) {
          return;
        }
        if (!this.root.contains(event.target)) {
          this.panelOpen = false;
          this.root.classList.remove("open");
        }
      });
    }

    update(state) {
      if (!state) {
        return;
      }
      this.countNode.textContent = String(state.selectedCount || 0);
      this.totalNode.textContent = String(state.totalSessions || 0);
      this.selectedNode.textContent = String(state.selectedCount || 0);
      this.modeBtn.textContent = state.multiSelectMode ? "关闭多选" : "开启多选";
      this.statusNode.textContent = state.isDeleting ? "删除中..." : "就绪";

      this.root.classList.toggle("selecting", Boolean(state.multiSelectMode) && !state.isDeleting);
      this.root.classList.toggle("deleting", Boolean(state.isDeleting));
      if (state.isDeleting) {
        this.root.querySelector(".dtk-floating-dot").textContent = "删";
        this.countNode.textContent = "";
      } else if (state.multiSelectMode) {
        this.root.querySelector(".dtk-floating-dot").textContent = "选";
        this.countNode.textContent = String(state.selectedCount || 0);
      } else {
        this.root.querySelector(".dtk-floating-dot").textContent = "工具";
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
      this.deleteSelectedBtn.disabled = disabled || (state.selectedCount || 0) === 0;
      this.incognitoToggle.disabled = disabled;
      this.incognitoIntervalInput.disabled = disabled;
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
