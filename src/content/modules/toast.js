(function initToast(global) {
  "use strict";

  const logger = global.DoubaoToolkit?.logger;

  class ToastManager {
    constructor() {
      this.container = null;
      this.detailOverlay = null;
    }

    ensureContainer() {
      if (this.container && document.body.contains(this.container)) {
        return;
      }
      this.container = document.createElement("div");
      this.container.className = "dtk-toast-container";
      document.body.appendChild(this.container);
    }

    show(message, type = "info", durationMs = 2200, options = {}) {
      try {
        this.ensureContainer();
        const toast = document.createElement("div");
        toast.className = `dtk-toast dtk-toast-${type}`;
        toast.setAttribute("role", type === "error" ? "alert" : "status");
        toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

        const textNode = document.createElement("span");
        textNode.className = "dtk-toast-text";
        textNode.textContent = message;
        toast.appendChild(textNode);

        if (options.details || typeof options.onClick === "function") {
          toast.classList.add("dtk-toast-clickable");
          toast.tabIndex = 0;
          toast.setAttribute("role", "button");
          toast.setAttribute("aria-label", `${message}，查看详情`);
          const hint = document.createElement("span");
          hint.className = "dtk-toast-detail-hint";
          hint.textContent = "查看详情";
          toast.appendChild(hint);
          const open = () => {
            if (typeof options.onClick === "function") {
              options.onClick();
              return;
            }
            this.showDetails({
              title: options.title || "通知详情",
              message,
              details: options.details,
              exportLogs: Boolean(options.exportLogs)
            });
          };
          toast.addEventListener("click", open);
          toast.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          });
        }

        this.container.appendChild(toast);

        window.setTimeout(() => {
          toast.classList.add("leaving");
          window.setTimeout(() => toast.remove(), 180);
        }, durationMs);
      } catch (error) {
        logger?.error("Toast render failed:", error);
      }
    }

    showDetails({ title, message, details, exportLogs }) {
      this.detailOverlay?.remove();
      const overlay = document.createElement("div");
      overlay.className = "dtk-toast-detail-overlay";
      overlay.innerHTML = `
        <div class="dtk-toast-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="dtk-toast-detail-title">
          <div id="dtk-toast-detail-title" class="dtk-toast-detail-title"></div>
          <div class="dtk-toast-detail-message"></div>
          <pre class="dtk-toast-detail-body"></pre>
          <div class="dtk-toast-detail-actions">
            <button type="button" class="dtk-btn dtk-btn-ghost" data-role="export">导出日志</button>
            <button type="button" class="dtk-btn dtk-btn-primary" data-role="close">关闭</button>
          </div>
        </div>
      `;
      overlay.querySelector(".dtk-toast-detail-title").textContent = title;
      overlay.querySelector(".dtk-toast-detail-message").textContent = message;
      overlay.querySelector(".dtk-toast-detail-body").textContent = String(details || "暂无详情。");
      const exportBtn = overlay.querySelector("[data-role='export']");
      exportBtn.hidden = !exportLogs;
      exportBtn.addEventListener("click", () => this.exportLogs());
      const close = () => {
        overlay.remove();
        if (this.detailOverlay === overlay) {
          this.detailOverlay = null;
        }
      };
      overlay.querySelector("[data-role='close']").addEventListener("click", close);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          close();
        }
      });
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          close();
        }
      });
      document.body.appendChild(overlay);
      this.detailOverlay = overlay;
      overlay.querySelector("[data-role='close']").focus();
    }

    exportLogs() {
      const text = logger?.exportText?.() || "暂无日志。";
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `doubao-toolkit-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.toast = new ToastManager();
})(window);
