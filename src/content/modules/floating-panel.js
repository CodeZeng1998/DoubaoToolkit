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
        <button type="button" class="dtk-floating-toggle" aria-label="Doubao Toolkit">
          <span class="dtk-floating-dot">D</span>
          <span class="dtk-floating-count">0</span>
        </button>
        <section class="dtk-floating-panel">
          <header class="dtk-floating-header">
            <strong>Doubao Toolkit</strong>
            <span class="dtk-floating-status">Ready</span>
          </header>
          <div class="dtk-floating-metrics">
            <span>Total: <b class="dtk-metric-total">0</b></span>
            <span>Selected: <b class="dtk-metric-selected">0</b></span>
          </div>
          <div class="dtk-floating-actions">
            <button type="button" data-action="toggle-mode" class="dtk-mini-btn dtk-mini-btn-primary">Enable Multi-Select</button>
            <button type="button" data-action="select-all" class="dtk-mini-btn dtk-mini-btn-ghost">Select All</button>
            <button type="button" data-action="clear" class="dtk-mini-btn dtk-mini-btn-ghost">Clear</button>
            <button type="button" data-action="delete-selected" class="dtk-mini-btn dtk-mini-btn-danger">Delete Selected</button>
            <button type="button" data-action="delete-all" class="dtk-mini-btn dtk-mini-btn-danger-outline">Delete All</button>
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
      this.totalNode = root.querySelector(".dtk-metric-total");
      this.selectedNode = root.querySelector(".dtk-metric-selected");
      this.statusNode = root.querySelector(".dtk-floating-status");
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
      return clamped;
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
          this.root.classList.toggle("open", this.panelOpen);
        }
      });

      window.addEventListener("resize", () => {
        const rect = this.root.getBoundingClientRect();
        const applied = this.applyPosition(rect.left, rect.top);
        this.savePosition(applied);
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
      this.modeBtn.textContent = state.multiSelectMode ? "Disable Multi-Select" : "Enable Multi-Select";
      this.statusNode.textContent = state.isDeleting ? "Deleting..." : "Ready";

      const disabled = Boolean(state.isDeleting);
      for (const button of this.panel.querySelectorAll("button")) {
        button.disabled = disabled;
      }
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.floatingPanel = new FloatingPanel();
  logger?.debug("Floating panel module loaded.");
})(window);
