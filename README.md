# Doubao Toolkit (Chrome Extension)

Doubao Toolkit is a Manifest V3 Chrome extension to improve chat session management on Doubao web pages.

## Features

- Batch delete sessions
- One-click delete all sessions
- Multi-select sessions
- Delete confirmation modal
- Deletion progress overlay
- Toast notifications
- Dark mode support
- Dynamic DOM observer for SPA pages
- Duplicate injection protection
- Async retry for fragile UI operations
- Error logging in browser console
- User-like click simulation for better compatibility

## Tech Stack

- Manifest V3
- Native JavaScript (no React/Vue)
- Modular content-script architecture

## Project Structure

```text
DoubaoToolkit/
|-- manifest.json
|-- README.md
|-- assets/
|   |-- icons/
|   |   |-- icon16.png
|   |   |-- icon32.png
|   |   |-- icon48.png
|   |   |-- icon128.png
|   |   `-- README.md
`-- src/
    |-- background/
    |   `-- service-worker.js
    |-- content/
    |   |-- content.css
    |   |-- main.js
    |   `-- modules/
    |       |-- config.js
    |       |-- logger.js
    |       |-- retry.js
    |       |-- dom-utils.js
    |       |-- toast.js
    |       |-- modal.js
    |       |-- progress.js
    |       |-- chat-selectors.js
    |       |-- session-manager.js
    |       `-- ui-controller.js
    `-- popup/
        |-- popup.html
        |-- popup.css
        `-- popup.js
```

## How It Works

1. Content script auto-runs only on `doubao.com` pages.
2. A session manager scans possible conversation items via configurable selectors.
3. `MutationObserver` + route listeners keep session list updated in SPA navigation.
4. Popup sends commands to content script:
   - toggle multi-select
   - select all / clear
   - delete selected
   - delete all
5. Delete flow:
   - show confirm modal
   - process each session with simulated clicks
   - retry if needed
   - update progress overlay
   - show toast and summary

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project root folder: `DoubaoToolkit`.
5. Open Doubao web page and click extension icon.

## Usage

1. Open Doubao website (`doubao.com`).
2. Click extension popup.
3. Enable multi-select mode.
4. Select sessions and click **Delete Selected**, or click **Delete All**.
5. Confirm in modal and wait for progress completion.

## Notes on Selector Compatibility

Doubao UI can change over time. The extension includes heuristic selectors in:

- `src/content/modules/config.js`
- `src/content/modules/chat-selectors.js`

If Doubao updates DOM structure, adjust these selector arrays first.

## Logging and Debug

- Browser console prefix: `[Doubao Toolkit]`
- Debug logs are enabled by default.
- You can disable debug logs by setting `debug: false` in `config.js`.

## Safety

- All delete actions require explicit confirmation.
- Dangerous actions are highlighted in red.
- No remote code loading.
- No external framework dependency.

## Next Extension Points

- Undo queue (if product supports recycle bin API)
- Session search and filter
- Custom delete strategies per UI variant
- i18n for popup and in-page messages
