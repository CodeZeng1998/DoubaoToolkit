(function initProgress(global) {
  "use strict";

  class ProgressOverlay {
    constructor() {
      this.root = null;
      this.titleNode = null;
      this.detailNode = null;
      this.barNode = null;
    }

    ensure() {
      if (this.root && document.body.contains(this.root)) {
        return;
      }
      this.root = document.createElement("div");
      this.root.className = "dtk-progress-overlay";
      this.root.innerHTML = `
        <div class="dtk-progress-panel">
          <div class="dtk-progress-title"></div>
          <div class="dtk-progress-bar">
            <div class="dtk-progress-bar-fill"></div>
          </div>
          <div class="dtk-progress-detail"></div>
        </div>
      `;
      document.body.appendChild(this.root);
      this.titleNode = this.root.querySelector(".dtk-progress-title");
      this.detailNode = this.root.querySelector(".dtk-progress-detail");
      this.barNode = this.root.querySelector(".dtk-progress-bar-fill");
    }

    show(title) {
      this.ensure();
      this.titleNode.textContent = title ?? "处理中";
      this.detailNode.textContent = "0 / 0";
      this.barNode.style.width = "0%";
      this.root.classList.add("visible");
    }

    update(done, total, failed = 0) {
      this.ensure();
      const safeTotal = Math.max(total, 1);
      const percent = Math.max(0, Math.min(100, Math.round((done / safeTotal) * 100)));
      this.barNode.style.width = `${percent}%`;
      this.detailNode.textContent = `进度：${done} / ${total} | 失败：${failed}`;
    }

    hide() {
      if (!this.root) {
        return;
      }
      this.root.classList.remove("visible");
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.progress = new ProgressOverlay();
})(window);
