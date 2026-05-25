(function initModal(global) {
  "use strict";

  class ConfirmModal {
    constructor() {
      this.currentNode = null;
      this.pendingResolver = null;
    }

    clear() {
      this.currentNode?.remove();
      this.currentNode = null;
      this.pendingResolver = null;
    }

    confirm(options = {}) {
      const title = options.title ?? "确认";
      const message = options.message ?? "确定继续吗？";
      const danger = Boolean(options.danger);
      const confirmText = options.confirmText ?? "确认";
      const cancelText = options.cancelText ?? "取消";

      if (this.pendingResolver) {
        this.pendingResolver(false);
      }
      this.clear();

      return new Promise((resolve) => {
        this.pendingResolver = resolve;
        const overlay = document.createElement("div");
        overlay.className = "dtk-modal-overlay";

        const dialog = document.createElement("div");
        dialog.className = `dtk-modal ${danger ? "dtk-modal-danger" : ""}`;
        dialog.innerHTML = `
          <div class="dtk-modal-title"></div>
          <div class="dtk-modal-message"></div>
          <div class="dtk-modal-actions">
            <button type="button" class="dtk-btn dtk-btn-ghost" data-role="cancel"></button>
            <button type="button" class="dtk-btn ${danger ? "dtk-btn-danger" : "dtk-btn-primary"}" data-role="confirm"></button>
          </div>
        `;

        dialog.querySelector(".dtk-modal-title").textContent = title;
        dialog.querySelector(".dtk-modal-message").textContent = message;
        dialog.querySelector("[data-role='cancel']").textContent = cancelText;
        dialog.querySelector("[data-role='confirm']").textContent = confirmText;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        this.currentNode = overlay;

        const finish = (result) => {
          if (!this.pendingResolver) {
            return;
          }
          const pending = this.pendingResolver;
          this.clear();
          pending(result);
        };

        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) {
            finish(false);
          }
        });
        dialog.querySelector("[data-role='cancel']").addEventListener("click", () => finish(false));
        dialog.querySelector("[data-role='confirm']").addEventListener("click", () => finish(true));
      });
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.modal = new ConfirmModal();
})(window);
