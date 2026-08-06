# 🔗 LinkedIn Auto-Connector

A **Chrome (Manifest V3) extension** that auto-sends LinkedIn connection requests with live visual feedback, plus a **feed scanner** that finds email addresses and keyword-matching posts on your LinkedIn home feed.

> ⚠️ **Use responsibly.** Automating connection requests can violate LinkedIn's Terms of Service and may risk account restrictions. Keep delays reasonable, respect rate limits, and use this tool at your own risk.

---

## ✨ Features

### 🤝 Auto-Connect
- **Scan** a search-results page and highlight every "Connect" button (blue glow)
- **Start** sends requests one-by-one with a random, configurable delay (default 1.5–3 s)
- **Skips 3rd-degree connections and Intern listings** automatically
- Live status badge on the page: connected / skipped counts + per-person log
- Visual **state colors** on the buttons you're automating:
  - 🟦 blue = found & highlighted
  - 🟨 amber = currently sending
  - 🟩 green = connected
  - 🟥 red = failed / no dialog

### 📬 Feed Email & Keyword Scanner
- Scans your LinkedIn feed for **email addresses** and posts matching your **include keywords**
- Floating **Found panel** with two lists (🔑 keywords / 📧 emails), each with:
  - click-to-jump (smooth-scrolls to the post and flashes it)
  - **✓ seen chip** — green badge + green row tint once you've viewed a hit
  - newest-first sort, ↑/↓ keyboard navigation, relative "time ago" labels
- **Hide posts** matching your **exclude keywords** (collapsed snippet, amber stripe; hover to peek)
- **Auto-scroll** the feed with an optional time limit (0 = unlimited)
- **Right-click any post → "Add post to Include/Exclude keywords"** (top 3 most frequent words are extracted)

### 🎨 Accessibility-first UX
- High-contrast dark UI with **semantic colors** (green = success, amber = in-progress/skip, red = danger/stop, blue = info)
- All colored buttons use dark text to meet WCAG contrast ratios (7.6–12.6:1)
- Focus rings, disabled-button states, delay-input validation, tooltips, pulsing status dot

---

## 🚀 Install (load unpacked)

1. Download / clone this repo (or unzip the release archive)
2. Open `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked** → select the folder containing `manifest.json`
5. Go to a LinkedIn search-results page → click the extension icon → **🔍 Search** → **▶ Start**

> The extension runs on `*://*.linkedin.com/*` and needs `storage` (settings), `activeTab` (scan), and `contextMenus` (right-click keyword add) permissions.

---

## 📖 Usage

| Control | What it does |
|---|---|
| 🔍 **Search** | Scans the current page, highlights Connect buttons (blue) |
| ▶ **Start** | Sends requests sequentially with the configured delay |
| ⏹ **Stop** | Stops after the current step |
| ↺ **Reset** | Clears counters, highlights, panels, and auto-scroll state |
| **Delay (ms)** | Random range between requests (min ≥ 500, min ≤ max) |

### Feed panel
- **Auto-scroll to new posts** — toggle; optional stop-after (minutes)
- **Include keywords** — comma/Enter separated; `react+senior` means *all* parts must match; matching posts get an **amber outline**
- **Exclude keywords** — matching posts collapse to a dim snippet with an amber stripe (hover to expand)
- **Show** — reveals all hidden posts

---

## 🧪 Development

```bash
npm install        # install jest
npx jest           # run all tests (255 tests / 23 suites)
```

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest (content script, popup, background) |
| `palette.js` | **Single source of truth** for colors (semantic tokens) |
| `content.js` | Feed scanner, connect flow, floating badge + panels |
| `popup.html` / `popup.js` | Toolbar popup: controls, counters, status, delay |
| `background.js` | Right-click context menu wiring |
| `tests/` | Jest suite covering scanning, filtering, connect flow, popup |

### Design notes
- Colors live in **one place** (`palette.js`) — `content.js` reads it directly, `popup.html` mirrors it via CSS variables (kept in sync)
- Tests use an in-memory `chrome.*` mock (`jest.setup.js`); the content script exposes a `__LI_AC_TEST__` surface for tests only

---

## 📦 Package for sharing

```bash
zip -r ../linkedin-auto-connector.zip . -x "node_modules/*" "coverage/*" ".git/*"
```

(Or just use the release archive from GitHub.)

---

## 🔒 Permissions

- `storage` — persist settings (delays, keywords, auto-scroll)
- `activeTab` — scan the current page for Connect buttons
- `contextMenus` — "Add post to Include/Exclude keywords" right-click menu

---

## 📄 License

MIT — do whatever, but don't blame us if LinkedIn is unhappy. Use at your own risk.
