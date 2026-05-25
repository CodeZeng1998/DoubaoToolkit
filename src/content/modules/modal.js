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
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "dtk-modal-title");
        dialog.setAttribute("aria-describedby", "dtk-modal-message");
        dialog.innerHTML = `
          <div id="dtk-modal-title" class="dtk-modal-title"></div>
          <div id="dtk-modal-message" class="dtk-modal-message"></div>
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
        const cancelButton = dialog.querySelector("[data-role='cancel']");
        const confirmButton = dialog.querySelector("[data-role='confirm']");

        if (danger) {
          confirmButton.disabled = true;
          confirmButton.classList.add("dtk-btn-arming");
          window.setTimeout(() => {
            if (!document.body.contains(confirmButton)) {
              return;
            }
            confirmButton.disabled = false;
            confirmButton.classList.remove("dtk-btn-arming");
            confirmButton.classList.add("dtk-btn-armed");
          }, 520);
        }

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
        overlay.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            finish(false);
          }
        });
        cancelButton.addEventListener("click", () => finish(false));
        confirmButton.addEventListener("click", () => finish(true));
        window.setTimeout(() => cancelButton.focus(), 0);
      });
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.modal = new ConfirmModal();
})(window);
