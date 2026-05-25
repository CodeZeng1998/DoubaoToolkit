(function initProgress(global) {
  "use strict";

  class ProgressOverlay {
    constructor() {
      this.root = null;
      this.titleNode = null;
      this.detailNode = null;
      this.barNode = null;
      this.metaNode = null;
      this.startedAt = 0;
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
          <div class="dtk-progress-meta" aria-live="polite"></div>
        </div>
      `;
      document.body.appendChild(this.root);
      this.titleNode = this.root.querySelector(".dtk-progress-title");
      this.detailNode = this.root.querySelector(".dtk-progress-detail");
      this.barNode = this.root.querySelector(".dtk-progress-bar-fill");
      this.metaNode = this.root.querySelector(".dtk-progress-meta");
    }

    show(title) {
      this.ensure();
      this.startedAt = Date.now();
      this.titleNode.textContent = title ?? "处理中";
      this.detailNode.textContent = "0 / 0";
      this.metaNode.textContent = "正在估算剩余时间...";
      this.barNode.style.width = "0%";
      this.root.classList.add("visible");
    }

    update(done, total, failed = 0) {
      this.ensure();
      const safeTotal = Math.max(total, 1);
      const percent = Math.max(0, Math.min(100, Math.round((done / safeTotal) * 100)));
      this.barNode.style.width = `${percent}%`;
      this.detailNode.textContent = `进度：${done} / ${total} | 失败：${failed}`;
      this.metaNode.textContent = this.formatEta(done, safeTotal);
    }

    formatEta(done, total) {
      if (!this.startedAt || done <= 0) {
        return "正在估算剩余时间...";
      }
      const elapsedMs = Math.max(Date.now() - this.startedAt, 1);
      const remaining = Math.max(total - done, 0);
      const etaMs = Math.round((elapsedMs / done) * remaining);
      if (etaMs <= 0) {
        return "即将完成";
      }
      const seconds = Math.ceil(etaMs / 1000);
      if (seconds < 60) {
        return `预计剩余 ${seconds} 秒`;
      }
      const minutes = Math.ceil(seconds / 60);
      return `预计剩余约 ${minutes} 分钟`;
    }

    hide() {
      if (!this.root) {
        return;
      }
      this.root.classList.remove("visible");
      this.startedAt = 0;
    }
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.progress = new ProgressOverlay();
})(window);
