(function initChatSelectors(global) {
  "use strict";

  const config = global.DoubaoToolkit?.config;
  const domUtils = global.DoubaoToolkit?.domUtils;
  const logger = global.DoubaoToolkit?.logger;

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
      list.push({
        id,
        title: String(conv?.name || "").trim()
      });
    }
    return list;
  }

  function findAnchorByConversationId(conversationId) {
    const selectors = [
      `a[href$='/chat/${conversationId}']`,
      `a[href*='/chat/${conversationId}?']`,
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
      if (!anchor) {
        continue;
      }
      const container = getLikelySessionContainer(anchor);
      if (!container || !domUtils.isVisible(container)) {
        continue;
      }
      sessions.push({
        id: `conv-${item.id}`,
        conversationId: item.id,
        title: item.title || domUtils.normalizeText(container.innerText || "").slice(0, 80),
        element: container
      });
    }
    return sessions;
  }

  function getSessionsFromDomFallback() {
    const list = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll("a[href*='/chat/']")) {
      if (!domUtils.isVisible(anchor) || domUtils.isInToolkitUI(anchor)) {
        continue;
      }
      const href = anchor.getAttribute("href") || "";
      const match = href.match(/\/chat\/(\d+)/);
      if (!match) {
        continue;
      }
      const id = match[1];
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const container = getLikelySessionContainer(anchor);
      if (!container) {
        continue;
      }
      list.push({
        id: `conv-${id}`,
        conversationId: id,
        title: domUtils.normalizeText(container.innerText || "").slice(0, 80),
        element: container
      });
    }
    return list;
  }

  function getSessionItems() {
    const fromRouter = getSessionsFromRouterData();
    if (fromRouter.length > 0) {
      logger?.debug("Session candidates(from router):", fromRouter.length);
      return fromRouter;
    }
    const fallback = getSessionsFromDomFallback();
    logger?.debug("Session candidates(from DOM fallback):", fallback.length);
    return fallback;
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
    findDeleteMenuButton,
    findDeleteActionNode,
    findConfirmDeleteNode,
    listDeleteActionCandidates
  };
})(window);
