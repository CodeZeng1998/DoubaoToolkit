(function initLogger(global) {
  "use strict";

  const config = global.DoubaoToolkit?.config;
  const prefix = `[${config?.appName ?? "Doubao Toolkit"}]`;

  function log(level, ...args) {
    if (level === "debug" && !config?.debug) {
      return;
    }
    const fn = console[level] || console.log;
    fn(prefix, ...args);
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.logger = {
    debug: (...args) => log("debug", ...args),
    info: (...args) => log("info", ...args),
    warn: (...args) => log("warn", ...args),
    error: (...args) => log("error", ...args)
  };
})(window);
