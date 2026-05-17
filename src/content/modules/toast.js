(function initToast(global) {
  "use strict";

  const logger = global.DoubaoToolkit?.logger;

  class ToastManager {
    constructor() {
      this.container = null;
    }

    ensureContainer() {
      if (this.container && document.body.contains(this.container)) {
        return;
      }
      this.container = document.createElement("div");
      this.container.className = "dtk-toast-container";
      document.body.appendChild(this.container);
    }

    show(message, type = "info", durationMs = 2200) {
      try {
        this.ensureContainer();
        const toast = document.createElement("div");
        toast.className = `dtk-toast dtk-toast-${type}`;
        toast.textContent = message;
        this.container.appendChild(toast);

        window.setTimeout(() => {
          toast.classList.add("leaving");
          window.setTimeout(() => toast.remove(), 180);
        }, durationMs);
      } catch (error) {
        logger?.error("Toast render failed:", error);
      }
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.toast = new ToastManager();
})(window);
