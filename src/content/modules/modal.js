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
      const requiredText = String(options.requiredText || "");
      const messageLines = Array.isArray(options.messageLines) ? options.messageLines.filter(Boolean) : [];
      const messageItems = Array.isArray(options.messageItems) ? options.messageItems.filter(Boolean) : [];
      const requiredTextLabel = options.requiredTextLabel || "";
      const inputPlaceholder = options.inputPlaceholder || "";
      const fillButtonText = options.fillButtonText || "";
      const fillMode = options.fillMode || "inline";
      const showInputHint = options.showInputHint !== false;
      const modalSize = options.size || "";

      if (this.pendingResolver) {
        this.pendingResolver(false);
      }
      this.clear();

      return new Promise((resolve) => {
        this.pendingResolver = resolve;
        const overlay = document.createElement("div");
        overlay.className = "dtk-modal-overlay";

        const dialog = document.createElement("div");
        dialog.className = `dtk-modal ${danger ? "dtk-modal-danger" : ""} ${modalSize === "large" ? "dtk-modal-large" : ""}`;
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "dtk-modal-title");
        dialog.setAttribute("aria-describedby", "dtk-modal-message");
        dialog.innerHTML = `
          <div id="dtk-modal-title" class="dtk-modal-title"></div>
          <div id="dtk-modal-message" class="dtk-modal-message"></div>
          <div class="dtk-modal-input-row" hidden>
            <span class="dtk-modal-input-label"></span>
            <input type="text" autocomplete="off" />
            <button type="button" class="dtk-modal-fill-button" hidden></button>
            <span class="dtk-modal-input-hint" role="status" aria-live="polite"></span>
          </div>
          <div class="dtk-modal-actions">
            <button type="button" class="dtk-btn dtk-btn-ghost" data-role="cancel"></button>
            <button type="button" class="dtk-btn ${danger ? "dtk-btn-danger" : "dtk-btn-primary"}" data-role="confirm"></button>
          </div>
        `;

        dialog.querySelector(".dtk-modal-title").textContent = title;
        const messageNode = dialog.querySelector(".dtk-modal-message");
        const lines = messageLines.length > 0 ? messageLines : [message];
        const fragment = document.createDocumentFragment();
        for (const line of lines) {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          fragment.appendChild(paragraph);
        }
        if (messageItems.length > 0) {
          const list = document.createElement("ul");
          list.className = "dtk-modal-message-list";
          for (const item of messageItems) {
            const listItem = document.createElement("li");
            listItem.textContent = item;
            list.appendChild(listItem);
          }
          fragment.appendChild(list);
        }
        messageNode.replaceChildren(fragment);
        dialog.querySelector("[data-role='cancel']").textContent = cancelText;
        dialog.querySelector("[data-role='confirm']").textContent = confirmText;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        this.currentNode = overlay;
        const cancelButton = dialog.querySelector("[data-role='cancel']");
        const confirmButton = dialog.querySelector("[data-role='confirm']");
        const inputRow = dialog.querySelector(".dtk-modal-input-row");
        const inputLabel = inputRow.querySelector(".dtk-modal-input-label");
        const input = inputRow.querySelector("input");
        const fillButton = inputRow.querySelector(".dtk-modal-fill-button");
        const inputHint = inputRow.querySelector(".dtk-modal-input-hint");
        let armed = !danger;

        const updateConfirmState = () => {
          const textMatches = !requiredText || input.value.trim() === requiredText;
          confirmButton.disabled = !armed || !textMatches;
          if (requiredText) {
            const value = input.value.trim();
            inputRow.classList.toggle("dtk-modal-input-error", Boolean(value) && !textMatches);
            inputRow.classList.toggle("dtk-modal-input-ok", textMatches);
            if (showInputHint) {
              inputHint.textContent = !value
                ? `需要输入“${requiredText}”后才能继续。`
                : textMatches
                  ? "已匹配，可以继续。"
                  : `输入内容不匹配，请输入“${requiredText}”。`;
            }
          }
        };

        if (requiredText) {
          inputRow.hidden = false;
          const fillValue = () => {
            input.value = requiredText;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
          };
          if (fillMode === "button") {
            inputLabel.textContent = requiredTextLabel || `请输入 “${requiredText}” 以继续`;
            fillButton.hidden = false;
            fillButton.textContent = fillButtonText || `一键填入“${requiredText}”`;
            fillButton.setAttribute("aria-label", `填入 ${requiredText}`);
            fillButton.addEventListener("click", fillValue);
          } else {
            const prefix = document.createTextNode("请输入 ");
            const suffix = document.createTextNode(" 以继续");
            const fillToken = document.createElement("button");
            fillToken.type = "button";
            fillToken.className = "dtk-modal-fill-token";
            fillToken.textContent = requiredText;
            fillToken.setAttribute("aria-label", `填入 ${requiredText}`);
            fillToken.addEventListener("click", fillValue);
            inputLabel.replaceChildren(prefix, fillToken, suffix);
          }
          input.placeholder = inputPlaceholder;
          input.setAttribute("aria-label", requiredTextLabel || `请输入 ${requiredText} 以继续`);
          input.addEventListener("input", updateConfirmState);
          inputHint.hidden = !showInputHint;
          updateConfirmState();
        }

        if (danger) {
          confirmButton.disabled = true;
          confirmButton.classList.add("dtk-btn-arming");
          window.setTimeout(() => {
            if (!document.body.contains(confirmButton)) {
              return;
            }
            armed = true;
            confirmButton.disabled = false;
            confirmButton.classList.remove("dtk-btn-arming");
            confirmButton.classList.add("dtk-btn-armed");
            updateConfirmState();
          }, 520);
        } else {
          updateConfirmState();
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
        window.setTimeout(() => (requiredText ? input : cancelButton).focus(), 0);
      });
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.modal = new ConfirmModal();
})(window);
