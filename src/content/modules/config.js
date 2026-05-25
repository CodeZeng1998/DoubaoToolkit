(function initConfig(global) {
  "use strict";

  const CONFIG = {
    appName: "豆包工具箱",
    namespace: "doubao-toolkit",
    debug: true,
    retry: {
      maxAttempts: 5,
      intervalMs: 350
    },
    timing: {
      sessionRefreshDebounceMs: 180,
      afterClickMs: 260,
      deleteStepDelayMs: 300,
      menuOpenTimeoutMs: 1200,
      waitForNodePollMs: 80,
      deleteResultTimeoutMs: 2600,
      apiRequestTimeoutMs: 8000
    },
    api: {
      deleteEndpoint: "/samantha/thread/delete",
      fallbackToUi: true,
      deleteQueryDefaults: {
        version_code: "20800",
        language: "zh",
        device_platform: "web",
        aid: "497858",
        real_aid: "497858",
        pc_version: "2.13.2",
        pkg_type: "release_version",
        "use-olympus-account": "1",
        region: "CN",
        sys_region: "CN",
        samantha_web: "1"
      }
    },
    selectors: {
      sessionListRoots: [
        "aside",
        "[data-testid*='history']",
        "[data-testid*='conversation']",
        "[class*='history']",
        "[class*='conversation']",
        "[class*='sidebar']"
      ],
      sessionItemCandidates: [
        "[data-testid='chat_list_thread_item']",
        "[data-testid*='chat_list_thread']",
        "[data-testid*='conversation-item']",
        "[data-testid*='history-item']",
        "[id^='thread_']",
        "[id*='conversation']",
        "[role='listitem']",
        "a[href*='conversation']",
        "a[href*='chat']",
        "[class*='conversation-item']",
        "[class*='history-item']",
        "[class*='session-item']",
        "li"
      ],
      menuButtonCandidates: [
        "button[aria-label*='more' i]",
        "[aria-label*='more' i]",
        "button[aria-label*='\\u66f4\\u591a']",
        "[aria-label*='\\u66f4\\u591a']",
        "button[title*='more' i]",
        "[title*='more' i]",
        "button[title*='\\u66f4\\u591a']",
        "[title*='\\u66f4\\u591a']",
        "button[class*='more']",
        "[class*='more']",
        "button[class*='menu']",
        "[class*='menu']",
        "[data-testid*='more']",
        "[data-testid*='menu']",
        "[role='button'][aria-haspopup='menu']"
      ],
      deleteActionCandidates: [
        "[role='menuitem']",
        "button",
        "[role='button']",
        "li"
      ],
      confirmDeleteCandidates: [
        "button[data-testid*='confirm']",
        "button[class*='danger']",
        "button[class*='confirm']",
        "button"
      ],
      menuContainerCandidates: [
        "[role='menu']",
        "[class*='menu']",
        "[class*='dropdown']",
        "[class*='popover']",
        "[data-state='open']",
        "[data-headlessui-state='open']"
      ],
      dialogContainerCandidates: [
        "[role='dialog']",
        "[aria-modal='true']",
        "[class*='modal']",
        "[class*='dialog']"
      ]
    },
    keyword: {
      delete: ["delete", "remove", "\u5220\u9664", "\u6e05\u9664", "\u79fb\u9664"],
      confirm: ["confirm", "ok", "yes", "\u786e\u5b9a", "\u786e\u8ba4", "\u5220\u9664"],
      cancel: ["cancel", "\u53d6\u6d88"],
      createNewChat: ["new chat", "\u65b0\u5efa", "\u65b0\u5bf9\u8bdd", "\u521b\u5efa"]
    }
  };

  global.DoubaoToolkit = global.DoubaoToolkit || {};
  global.DoubaoToolkit.config = CONFIG;
})(window);
