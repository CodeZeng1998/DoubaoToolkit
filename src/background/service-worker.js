chrome.runtime.onInstalled.addListener(() => {
  console.log("[Doubao Toolkit] Service worker installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "DTK_SW_PING") {
    sendResponse({
      ok: true,
      from: "service-worker",
      tabId: sender.tab?.id ?? null
    });
  }
});
