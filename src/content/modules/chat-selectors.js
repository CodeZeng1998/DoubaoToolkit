(function initChatSelectors(global) {
  "use strict";

  const config = global.DoubaoToolkit?.config;
  const domUtils = global.DoubaoToolkit?.domUtils;
  const logger = global.DoubaoToolkit?.logger;
  const SESSION_CACHE_TTL_MS = 300;
  const MOBILE_SESSION_HINTS = [
    "手机版",
    "手机端",
    "移动端",
    "来自手机",
    "来自移动端",
    "来自豆包app",
    "豆包app",
    "doubao app",
    "mobile",
    "mobile app"
  ];
  let cachedSessions = null;
  let cachedAt = 0;

  function getRouterConversations() {
    const cells =
      global._ROUTER_DATA?.loaderData?.chat_layout?.chat_layout?.trimmedChainRecentConvCells ||
      global._ROUTER_DATA?.loaderData?.chat_layout?.trimmedChainRecentConvCells ||
      [];
    const list = [];
    for (const cell of cells) {
      const conv = cell?.conversation;
      const id = String(conv?.conversation_id || "");
      if (!/^\d+$/.test(id)) {
        continue;
      }
      if (isMobileConversationData(conv)) {
        continue;
      }
      list.push({
        id,
        title: String(conv?.name || "").trim()
      });
    }
    return list;
  }

  function hasMobileSessionHint(value) {
    const text = domUtils.normalizeText(value || "");
    if (!text) {
      return false;
    }
    return MOBILE_SESSION_HINTS.some((hint) => text.includes(domUtils.normalizeText(hint)));
  }

  function isMobileConversationData(conversation) {
    if (!conversation || typeof conversation !== "object") {
      return false;
    }
    const textFields = [
      conversation.platform,
      conversation.source,
      conversation.source_type,
      conversation.client_type,
      conversation.device_type,
      conversation.create_platform,
      conversation.conversation_type,
      conversation.tag,
      conversation.label,
      conversation.name
    ];
    if (textFields.some(hasMobileSessionHint)) {
      return true;
    }
    try {
      return hasMobileSessionHint(JSON.stringify(conversation).slice(0, 2000));
    } catch (_error) {
      return false;
    }
  }

  function getOwnText(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ");
  }

  function isMobileSessionNode(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const markerSelectors = [
      "[aria-label*='手机版']",
      "[aria-label*='手机端']",
      "[aria-label*='移动端']",
      "[title*='手机版']",
      "[title*='手机端']",
      "[title*='移动端']",
      "[data-testid*='mobile' i]"
    ];
    if (markerSelectors.some((selector) => element.matches?.(selector) || element.querySelector?.(selector))) {
      return true;
    }
    const compactTexts = [
      getOwnText(element),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid")
    ];
    if (compactTexts.some(hasMobileSessionHint)) {
      return true;
    }
    const badgeText = Array.from(element.querySelectorAll("[class*='tag' i],[class*='badge' i],[class*='label' i],span"))
      .slice(0, 24)
      .map((node) => getOwnText(node) || node.getAttribute("aria-label") || node.getAttribute("title") || "")
      .join(" ");
    return hasMobileSessionHint(badgeText);
  }

  function findAnchorByConversationId(conversationId) {
    const selectors = [
      `a#conversation_${conversationId}`,
      `a[href$='/chat/${conversationId}']`,
      `a[href*='/chat/${conversationId}?']`,
      `a[href*='/chat/${conversationId}/']`,
      `a[href*='doubao.com/chat/${conversationId}']`
    ];
    for (const selector of selectors) {
      const anchor = document.querySelector(selector);
      if (anchor && domUtils.isVisible(anchor) && !domUtils.isInToolkitUI(anchor)) {
        return anchor;
      }
    }
    return null;
  }

  function findElementByConversationId(conversationId) {
    const selectors = [
      `[id='thread_${conversationId}']`,
      `[id$='_${conversationId}']`,
      `[data-conversation-id='${conversationId}']`,
      `[data-thread-id='${conversationId}']`,
      `[data-id='${conversationId}']`
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && domUtils.isVisible(element) && !domUtils.isInToolkitUI(element)) {
        return element;
      }
    }
    return null;
  }

  function extractConversationIdFromValue(value) {
    const text = String(value || "");
    const patterns = [
      /\/chat\/(\d+)/,
      /(?:^|[_-])thread[_-](\d+)(?:$|[_-])/,
      /(?:conversation|conversation_id|conv|chat|thread)[_-]?id["'=:\s_-]+(\d+)/i,
      /(?:conversation|conv|chat|thread)[_-](\d+)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
    if (/^\d{6,}$/.test(text.trim())) {
      return text.trim();
    }
    return "";
  }

  function extractConversationIdFromElement(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }
    const directValues = [
      element.id,
      element.getAttribute("href"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-id"),
      element.getAttribute("data-conversation-id"),
      element.getAttribute("data-thread-id"),
      element.getAttribute("data-key"),
      element.getAttribute("aria-label")
    ];
    for (const value of directValues) {
      const id = extractConversationIdFromValue(value);
      if (id) {
        return id;
      }
    }
    const anchor = element.matches("a[href*='/chat/']")
      ? element
      : element.querySelector("a[href*='/chat/'],a[href*='conversation']");
    return extractConversationIdFromValue(anchor?.getAttribute("href") || "");
  }

  function looksLikeSessionContainer(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const testId = domUtils.normalizeText(element.getAttribute("data-testid") || "");
    const id = domUtils.normalizeText(element.id || "");
    const className = domUtils.normalizeText(element.className || "");
    const role = domUtils.normalizeText(element.getAttribute("role") || "");
    return (
      testId.includes("chat_list_thread") ||
      testId.includes("conversation") ||
      testId.includes("history") ||
      id.startsWith("thread_") ||
      id.includes("conversation") ||
      className.includes("conversation") ||
      className.includes("history") ||
      className.includes("session") ||
      role === "listitem"
    );
  }

  function getLikelySessionContainer(anchor) {
    if (!anchor) {
      return null;
    }
    let current = anchor;
    while (current && current !== document.body) {
      if (!(current instanceof HTMLElement)) {
        current = current.parentElement;
        continue;
      }
      if (domUtils.isInToolkitUI(current)) {
        current = current.parentElement;
        continue;
      }
      if (looksLikeSessionContainer(current) && domUtils.isVisible(current)) {
        return current;
      }
      const hasControl = Boolean(current.querySelector("button,[role='button']"));
      const text = domUtils.normalizeText(current.innerText || "");
      const rect = current.getBoundingClientRect();
      const notHuge = rect.height > 16 && rect.height < 180;
      if (hasControl && text.length > 0 && notHuge) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  function getSessionsFromRouterData() {
    const sessions = [];
    for (const item of getRouterConversations()) {
      const anchor = findAnchorByConversationId(item.id);
      const directElement = findElementByConversationId(item.id);
      const container = getLikelySessionContainer(anchor || directElement);
      if (!container || !domUtils.isVisible(container)) {
        continue;
      }
      if (isMobileSessionNode(container)) {
        continue;
      }
      sessions.push({
        id: `conv-${item.id}`,
        conversationId: item.id,
        title: item.title || domUtils.normalizeText(container.innerText || "").slice(0, 80),
        element: container,
        anchor
      });
    }
    return sessions;
  }

  function getSessionsFromDomFallback() {
    const list = [];
    const seen = new Set();

    function pushSession(sourceNode) {
      if (!(sourceNode instanceof HTMLElement) || !domUtils.isVisible(sourceNode) || domUtils.isInToolkitUI(sourceNode)) {
        return;
      }
      const id = extractConversationIdFromElement(sourceNode);
      if (!id) {
        return;
      }
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      const anchor =
        sourceNode.matches("a[href*='/chat/']") ? sourceNode : sourceNode.querySelector("a[href*='/chat/']");
      const container = getLikelySessionContainer(anchor || sourceNode);
      if (!container) {
        return;
      }
      if (isMobileSessionNode(container)) {
        return;
      }
      list.push({
        id: `conv-${id}`,
        conversationId: id,
        title: domUtils.normalizeText(container.innerText || "").slice(0, 80),
        element: container,
        anchor: anchor || findAnchorByConversationId(id)
      });
    }

    for (const anchor of document.querySelectorAll("a[href*='/chat/']")) {
      pushSession(anchor);
    }

    const selectors = config?.selectors?.sessionItemCandidates ?? [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        pushSession(node);
      }
    }

    return list;
  }

  function getSessionItems(options = {}) {
    const now = Date.now();
    if (!options.force && cachedSessions && now - cachedAt < SESSION_CACHE_TTL_MS) {
      return cachedSessions.filter((session) => session?.element && document.body.contains(session.element));
    }

    const fromRouter = getSessionsFromRouterData();
    const fallback = getSessionsFromDomFallback();
    const merged = [];
    const seen = new Set();
    for (const session of [...fromRouter, ...fallback]) {
      if (!session?.conversationId || seen.has(session.conversationId)) {
        continue;
      }
      seen.add(session.conversationId);
      merged.push(session);
    }
    logger?.debug("Session candidates:", {
      router: fromRouter.length,
      dom: fallback.length,
      merged: merged.length
    });
    cachedSessions = merged;
    cachedAt = now;
    return merged;
  }

  function invalidateSessionCache() {
    cachedSessions = null;
    cachedAt = 0;
  }

  function getCandidateButtons(sessionItemNode) {
    const selectors = config?.selectors?.menuButtonCandidates ?? [];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of sessionItemNode.querySelectorAll(selector)) {
        if (!domUtils.isVisible(node) || domUtils.isInToolkitUI(node)) {
          continue;
        }
        candidates.push(node);
      }
    }
    for (const node of sessionItemNode.querySelectorAll("button,[role='button']")) {
      if (!domUtils.isVisible(node) || domUtils.isInToolkitUI(node)) {
        continue;
      }
      if (node.classList?.contains("dtk-session-checkbox")) {
        continue;
      }
      candidates.push(node);
    }
    return Array.from(new Set(candidates));
  }

  function rankButton(node, anchorPoint) {
    const text = domUtils.normalizeText(node.textContent || node.getAttribute("aria-label") || node.title || "");
    const rect = node.getBoundingClientRect();
    const point = domUtils.getElementCenter(node);
    const distance = domUtils.calcDistance(point, anchorPoint);
    const looksLikeMenu =
      text.includes("more") || text.includes("\u66f4\u591a") || text.includes("\u83dc\u5355") || text.includes("\u9009\u9879");
    const tinyIconBtn = rect.width <= 44 && rect.height <= 44;
    const rightBias = -rect.left * 0.12;
    return distance + rightBias + (looksLikeMenu ? -260 : 0) + (tinyIconBtn ? -120 : 0);
  }

  function findDeleteMenuButton(sessionItemNode) {
    const anchorPoint = domUtils.getElementCenter(sessionItemNode);
    const candidates = getCandidateButtons(sessionItemNode);
    if (candidates.length === 0) {
      return null;
    }
    return candidates.sort((a, b) => rankButton(a, anchorPoint) - rankButton(b, anchorPoint))[0] || null;
  }

  function collectContainers(selectors) {
    const containers = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!domUtils.isVisible(node) || domUtils.isInToolkitUI(node)) {
          continue;
        }
        containers.push(node);
      }
    }
    return Array.from(new Set(containers));
  }

  function collectClickable(root) {
    const nodes = [];
    for (const node of root.querySelectorAll("button,[role='button'],[role='menuitem'],li,a,div,span")) {
      if (!domUtils.isClickable(node) || domUtils.isInToolkitUI(node)) {
        continue;
      }
      nodes.push(node);
    }
    return nodes;
  }

  function hasDeleteHint(node) {
    const hint = domUtils.normalizeText(
      node.getAttribute("data-key") ||
        node.getAttribute("data-testid") ||
        node.getAttribute("aria-label") ||
        node.className ||
        ""
    );
    return hint.includes("delete") || hint.includes("\u5220\u9664") || hint.includes("remove");
  }

  function findActionNodeByKeywords(keywords, preferredRoots = [], referencePoint = null, allowKeyHint = false) {
    const roots = preferredRoots.length > 0 ? preferredRoots : [document.body];
    const candidates = [];

    for (const root of roots) {
      for (const node of collectClickable(root)) {
        const matchesText = domUtils.textMatchesKeyword(node, keywords);
        const matchesHint = allowKeyHint ? hasDeleteHint(node) : false;
        if (!matchesText && !matchesHint) {
          continue;
        }
        const text = domUtils.normalizeText(node.textContent || "");
        if (text.length > 30) {
          continue;
        }
        candidates.push(node);
      }
    }

    const unique = Array.from(new Set(candidates));
    if (unique.length === 0) {
      return null;
    }

    if (!referencePoint) {
      return unique[unique.length - 1];
    }

    return (
      unique
        .map((node) => ({
          node,
          score: domUtils.calcDistance(domUtils.getElementCenter(node), referencePoint)
        }))
        .sort((a, b) => a.score - b.score)[0]?.node || null
    );
  }

  function listDeleteActionCandidates(referenceNode = null) {
    const referencePoint = referenceNode ? domUtils.getElementCenter(referenceNode) : null;
    const menuContainers = collectContainers(config?.selectors?.menuContainerCandidates ?? []);
    const roots = menuContainers.length > 0 ? menuContainers : [document.body];
    const rows = [];
    for (const root of roots) {
      for (const node of collectClickable(root)) {
        const text = (node.textContent || "").trim();
        if (!text && !hasDeleteHint(node)) {
          continue;
        }
        const matches = domUtils.textMatchesKeyword(node, config.keyword.delete) || hasDeleteHint(node);
        if (!matches) {
          continue;
        }
        const point = domUtils.getElementCenter(node);
        rows.push({
          text: text.slice(0, 20),
          hint: (node.getAttribute("data-key") || node.getAttribute("data-testid") || "").slice(0, 40),
          distance: referencePoint ? Math.round(domUtils.calcDistance(point, referencePoint)) : -1
        });
      }
    }
    return rows.slice(0, 10);
  }

  function findDeleteActionNode(referenceNode = null) {
    const referencePoint = referenceNode ? domUtils.getElementCenter(referenceNode) : null;
    const menuContainers = collectContainers(config?.selectors?.menuContainerCandidates ?? []);
    const fromMenu = findActionNodeByKeywords(config.keyword.delete, menuContainers, referencePoint, true);
    if (fromMenu) {
      return fromMenu;
    }
    return findActionNodeByKeywords(config.keyword.delete, [document.body], referencePoint, true);
  }

  function findConfirmDeleteNode() {
    const dialogContainers = collectContainers(config?.selectors?.dialogContainerCandidates ?? []);
    const fromDialog = findActionNodeByKeywords(config.keyword.confirm, dialogContainers, null, false);
    if (fromDialog) {
      return fromDialog;
    }
    return findActionNodeByKeywords(config.keyword.confirm, [document.body], null, false);
  }

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.chatSelectors = {
    getSessionItems,
    invalidateSessionCache,
    findDeleteMenuButton,
    findDeleteActionNode,
    findConfirmDeleteNode,
    listDeleteActionCandidates
  };
})(window);
