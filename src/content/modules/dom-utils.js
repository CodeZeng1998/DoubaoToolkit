(function initDomUtils(global) {
  "use strict";

  const logger = global.DoubaoToolkit?.logger;

  function isVisible(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function textMatchesKeyword(element, keywords) {
    const text = normalizeText(element?.textContent || "");
    return keywords.some((keyword) => text.includes(normalizeText(keyword)));
  }

  function queryAllVisible(root, selector) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll(selector)).filter((node) => isVisible(node));
  }

  function findFirstVisible(root, selectors) {
    for (const selector of selectors) {
      const node = queryAllVisible(root, selector)[0];
      if (node) {
        return node;
      }
    }
    return null;
  }

  function safeClosest(element, selector) {
    if (!element || typeof element.closest !== "function") {
      return null;
    }
    try {
      return element.closest(selector);
    } catch (error) {
      logger?.debug("safeClosest selector error:", selector, error);
      return null;
    }
  }

  function isInToolkitUI(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return false;
    }
    return Boolean(
      element.closest(
        ".dtk-floating-root, .dtk-toast-container, .dtk-modal-overlay, .dtk-progress-overlay, .dtk-page-badge"
      )
    );
  }

  function hashString(input) {
    let hash = 0;
    const text = String(input ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash << 5) - hash + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function dispatchMouseSequence(element, eventInit = {}) {
    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const eventName of events) {
      const event = new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        ...eventInit
      });
      element.dispatchEvent(event);
    }
  }

  function simulateHover(element) {
    if (!element) {
      return;
    }
    const events = ["pointerenter", "mouseenter", "pointerover", "mouseover", "mousemove"];
    for (const eventName of events) {
      const event = new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      element.dispatchEvent(event);
    }
  }

  function getElementCenter(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return { x: 0, y: 0 };
    }
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  function calcDistance(pointA, pointB) {
    const dx = pointA.x - pointB.x;
    const dy = pointA.y - pointB.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isClickable(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return false;
    }
    if (!isVisible(element)) {
      return false;
    }
    const tag = element.tagName.toLowerCase();
    const role = normalizeText(element.getAttribute("role") || "");
    const tabIndex = Number(element.getAttribute("tabindex"));
    return (
      ["button", "a", "li"].includes(tag) ||
      role.includes("button") ||
      role.includes("menuitem") ||
      Number.isFinite(tabIndex)
    );
  }

  function simulateClick(element, eventInit = {}) {
    if (!element) {
      throw new Error("simulateClick received empty element.");
    }
    element.focus?.();
    dispatchMouseSequence(element, eventInit);
  }

  function simulateContextMenu(element, eventInit = {}) {
    if (!element) {
      throw new Error("simulateContextMenu received empty element.");
    }
    const center = getElementCenter(element);
    const contextEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: center.x,
      clientY: center.y,
      ...eventInit
    });
    element.dispatchEvent(contextEvent);
  }

  function simulateKey(element, key) {
    if (!element) {
      return;
    }
    element.focus?.();
    const options = {
      key,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.domUtils = {
    isVisible,
    normalizeText,
    textMatchesKeyword,
    queryAllVisible,
    findFirstVisible,
    safeClosest,
    isInToolkitUI,
    hashString,
    simulateHover,
    getElementCenter,
    calcDistance,
    isClickable,
    simulateClick,
    simulateContextMenu,
    simulateKey
  };
})(window);
