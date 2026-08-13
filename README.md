# 🕵️ Job Radar for LinkedIn

<p align="center">
  <img src="assets/logo.png" alt="Job Radar for LinkedIn logo" width="200" />
</p>

<p align="center">
  <img src="assets/chatgpt-logo.png" alt="Job Radar for LinkedIn" width="800" />
</p>

Find hiring posts, email addresses, and keyword matches on your LinkedIn feed — plus a connection assistant that sends requests one-by-one with a safe, configurable delay.

> ✅ **Available on the Chrome Web Store** — [Install Job Radar for LinkedIn](https://chromewebstore.google.com/detail/job-radar-for-linkedin/fohdibajaklenoedegbhabemcogdcfke)

> ⚠️ **Use responsibly.** Automating connection requests can violate LinkedIn's Terms of Service and may risk account restrictions. Keep delays reasonable, respect rate limits, and use this tool at your own risk.

---

## ✨ Features

- **Auto-connect** — scan a search page, highlight Connect buttons, and send requests one-by-one with a random, configurable delay (default 1.5–3 s). Skips 3rd-degree connections and intern listings automatically.
- **Keyword radar** — posts matching your include keywords light up and land in the Found panel. Matching reads only the post body, not profile headlines.
- **Email radar** — posts containing email addresses are listed under Email matches.
- **Hidden posts** — exclude keywords collapse unwanted posts and show you *why* each one was hidden, with per-post Show/Hide.
- **Focus mode** — collapse every post that isn't a keyword or email match.
- **Clear seen** — track what you've viewed and clear read rows; a green marker stays on those posts until Reset.
- **Right-click any post → "Add post to Include/Exclude keywords"** to build filters from real posts.

---

## 🚀 Install

**Recommended:** install from the [Chrome Web Store](https://chromewebstore.google.com/detail/job-radar-for-linkedin/fohdibajaklenoedegbhabemcogdcfke) — you'll get automatic updates. Store-version zips are also attached to each [GitHub release](https://github.com/syntaxhacker/linkedin-auto-connector/releases).

To run from source (developers):

1. Clone this repo
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the folder containing `manifest.json`
4. Go to a LinkedIn search-results page → click the extension icon → **🔍 Search** → **▶ Start**

---

## 📖 Usage

| Control | What it does |
|---|---|
| 🔍 **Search** | Scans the current page, highlights Connect buttons |
| ▶ **Start** | Sends requests sequentially with the configured delay |
| ⏹ **Stop** | Stops after the current step |
| ↺ **Reset** | Clears counters, highlights, panels, and auto-scroll state |
| **Delay (ms)** | Random range between requests (min ≥ 500, min ≤ max) |

### Feed panel

- **Include keywords** — comma/Enter separated; `react+senior` means *all* parts must match
- **Exclude keywords** — matching posts collapse to a dim snippet (hover to expand) and appear in the **Hidden posts** list with the reason
- **Hide non-matching posts** — collapses everything that isn't a keyword or email match
- **Auto-scroll feed** — toggle; optional auto-stop after N minutes

---

## 📄 License

MIT — do whatever, but don't blame us if LinkedIn is unhappy. Use at your own risk.
