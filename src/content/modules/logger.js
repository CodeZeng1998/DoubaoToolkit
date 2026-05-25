(function initLogger(global) {
  "use strict";

  const config = global.DoubaoToolkit?.config;
  const prefix = `[${config?.appName ?? "Doubao Toolkit"}]`;
  const records = [];
  const MAX_RECORDS = 300;

  function normalizeArg(arg) {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}`;
    }
    if (typeof arg === "string") {
      return arg;
    }
    try {
      return JSON.stringify(arg);
    } catch (_error) {
      return String(arg);
    }
  }

  function log(level, ...args) {
    if (level === "debug" && !config?.debug) {
      return;
    }
    records.push({
      time: new Date().toISOString(),
      level,
      message: args.map(normalizeArg).join(" ")
    });
    if (records.length > MAX_RECORDS) {
      records.shift();
    }
    const fn = console[level] || console.log;
    fn(prefix, ...args);
  }

  function exportText() {
    return records.map((item) => `[${item.time}] ${item.level.toUpperCase()} ${item.message}`).join("\n");
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.logger = {
    debug: (...args) => log("debug", ...args),
    info: (...args) => log("info", ...args),
    warn: (...args) => log("warn", ...args),
    error: (...args) => log("error", ...args),
    exportText,
    getRecords: () => records.slice()
  };
})(window);
