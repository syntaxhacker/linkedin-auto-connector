# Job Radar for LinkedIn — Agent Instructions

Chrome MV3 extension that auto-sends connection requests and scans the LinkedIn
feed for keyword/email matches. Content script is an IIFE exposed to tests via
`globalThis.__LI_AC_TEST__`.

## Fast dev loop (the way we actually work)

1. **Edit** `content.js` / `popup.*` / `background.js`.
2. **Reload the extension** so the content script changes take effect (page
   reload alone is NOT enough — the extension bundle is cached):
   - `chrome://extensions/` → find **Job Radar for LinkedIn**
     (id `dfmpiljchoecpknpedpbkkjpjmmmfabn`) → click **Reload**.
   - The Reload button is the "Reload" `<button>` in that card's row. In the
     devtools snapshot it appears as `uid=…_56` inside the LinkedIn card block.
3. **Reload the LinkedIn page** (`https://www.linkedin.com/feed/`) so the fresh
   content script re-injects.
4. **Verify live with chrome-devtools MCP** (`evaluate_script`), not screenshots:
   - Panels: `#li-ac-panel`, `#li-ac-found-panel`, and children
     `#li-ac-kw-list`, `#li-ac-panel-list`, `#li-ac-hidden-list`,
     `#li-ac-clear-seen`, `#li-ac-ultra-hide`.
   - Feed classes we inject: `.li-ac-hidden` / `.li-ac-hidden-card` (exclude),
     `.li-ac-ultra` / `.li-ac-ultra-card` (focus mode), `.li-ac-viewed`
     (cleared-seen marker), `.li-ac-kw-hl` (keyword outline).
   - The content script runs in an **isolated world** — `__LI_AC_TEST__` is
     NOT reachable from `evaluate_script` in the page world. Verify behavior
     via DOM state, not test-surface calls.
5. **Run tests** before committing:
   ```bash
   npm test            # full suite (jest)
   npx jest tests/xxx.test.js            # one file
   npx jest tests/xxx.test.js -t "name"  # one test
   ```

## Publish to the Chrome Web Store (after pushing)

The extension is live on the Chrome Web Store (item id
`fohdibajaklenoedegbhabemcogdcfke`, dev console under `jrohit072@gmail.com`).
**Any pushed change that ships a user-facing feature or bug fix must also be
uploaded to the store dashboard and published**, otherwise store users never
get the update.

When the user says **"publish to the store"** (or "upload/store/release this"),
run this whole flow automatically with the **chrome-devtools MCP** — no manual
dashboard work needed. Steps:

1. Verify tests pass (`npm test`) and live behavior works (see "Fast dev loop").
2. Bump the version in `manifest.json` (e.g. 1.4.0 → 1.4.1) if it wasn't
   already bumped for this release; commit + push it.
3. Package the unpacked extension **into a zip** (Web Store rejects `node_modules`,
   `.git`, screenshots, etc.):
   ```bash
   zip -r job-radar-linkedin.zip manifest.json content.js background.js palette.js popup.html popup.js icons/ *_LICENSE 2>/dev/null || true
   ```
   - Confirm the zip contains only store-required files and matches the repo's
     tracked sources (no `tools/`, `.pi/`, `tests/`, `.git/`).
4. **Upload via devtools MCP** (the dev console is usually already open in a
   tab at `https://chrome.google.com/webstore/devconsole/.../edit/package`):
   - `select_page` the dev console tab → snapshot → click **Upload new package**
     → `upload_file` with `job-radar-linkedin.zip` → wait for the progress
     dialog to clear → snapshot to confirm the **Draft** version bumped.
   - If the dev console isn't open, `new_page` it (item
     `fohdibajaklenoedegbhabemcogdcfke`) — Chrome keeps you logged in.
5. **Submit for review** via devtools MCP: click **Store listing** in the left
   nav, then **Submit for review**; in the dialog keep **"Publish automatically
   after it has passed review"** checked and confirm. Wait for the
   "Your extension was submitted for review" dialog and dismiss it.
6. Update the store **listing** (`STORE_LISTING.md` is the single source of
   truth — description, screenshots, Homepage/Support URLs) whenever the feature
   set changes; the dev console mirrors it. Note: **listing fields are locked
   while an item is pending review** — fill URL/support changes either before
   submitting or after review passes, or they have to wait for the next release.
7. If a change touches privacy/data handling, update `PRIVACY.md` and re-submit
   the privacy section in the store.
8. **Create a GitHub release** for the new version (if the user asks or it's a
   new version):
   ```bash
   git tag -a v<version> -m "Release v<version> — <summary>"
   git push origin v<version>
   gh release create v<version> job-radar-linkedin.zip --title "Job Radar for LinkedIn v<version>" --notes "<changelog>"
   ```
   The zip asset doubles as the load-unpacked release archive.

## Architecture / single sources of truth

- **Colors**: `palette.js` (`LI_PALETTE`) — content.js reads it; popup.html
  mirrors it as CSS vars. Keep in sync manually.
- **Config**: `cfg` from `chrome.storage.sync`, defaulted in
  `chrome.storage.sync.get(...)` (content.js:1505) and at `let cfg = {...}`
  (content.js:39). Keys: `autoExpand, scanEmails, includeKeywords,
  excludeKeywords, autoScroll, ultraHide, debug, kwSectionCollapsed,
  autoScrollDurationMin, panelMinimized, foundPanelMinimized`.
- **Hidden state**: `.li-ac-hidden` class on the post element (single source).
  Card wrapper gets `.li-ac-hidden-card` so the comment thread collapses too.
- **Focus/Ultra mode**: `.li-ac-ultra` (+ `-card`) on non-matching posts only;
  never listed in the Hidden section. `applyUltraHide(kwFiltered, emHits)` in
  `scanFeed`.
- **"Clear seen"**: `dismissedKeys` (Set of `kind:key`) — `clearSeen()` adds
  viewed hits; `sortedHits()` filters them out; cleared posts get `.li-ac-viewed`
  (inset green bar) via `applyViewedBorders()`. RESET clears everything.
- **Post body matching**: `postBodyText(el)` reads only the card's direct `<p>`
  children — profile headlines / "likes this" / reactions / buttons are ignored.
  Used by `scanKeywords`, `scanEmails`, `filterPosts`, `hiddenReason`,
  `extractKeywordsFromPost`, and row snippets. No fallback; widgets with no
  `<p>` never match.

## User flows (mapped to code)

- **Keyword/Email scan** → `scanFeed()` (debounced 400ms) →
  `getPosts → expandPosts → filterPosts → scanKeywords → scanEmails →
  renderPanel(emHits, kwFiltered)` then `applyUltraHide` + `applyViewedBorders`.
  A post matching both keyword and email appears only under Emails.
- **Found panel lists**: `sortedHits(kind)` is the single render source —
  it filters `dismissedKeys` and applies newest-first sort (`sortNewest`).
- **Hide (exclude)** → `filterPosts` adds `.li-ac-hidden` + reason
  (`data-hidden-reason`). Hidden posts appear in the Found panel's Hidden list
  with per-post **Show/Hide** (`revealHiddenPost` / `rehidePost`); row text
  click scrolls to the post.
- **Focus mode** → collapses all non-matching posts.
- **Clear seen** → removes viewed rows; green marker stays on those feed posts
  until RESET.
- **URL gate** → extension only works on `/search` and `/feed`; elsewhere both
  panels show a blurred notice (`applyGateOverlays`).
- **Panel position**: Found panel hugs `right:16px` when the control panel is
  closed (`positionFoundPanel()`).

## Common pitfalls (learned)

- Sorting button active state = blue `#60a5fa` / label `⇅ Newest`; inactive =
  white / `Feed order`. Don't make both states the same color.
- Empty list sections collapse to `min-height:0`; populated ones use `18vh`.
- Auto-scroll only targets **fresh** (unseen) emails/keywords via
  `knownEmails` / `knownKeywordKeys` — cleared/viewed rows are already known,
  so they don't get re-centered.
- Fixtures in tests must put a whitespace text node between the `h2` marker and
  the body `<p>` (else `"Feed postReact…"` breaks word-boundary matching).
- Tests run in jsdom with a `chrome.*` mock; `jest.setup.js` captures the
  `onMessage` / `onChanged` listeners so tests can drive them.
- Always reload the extension + page before live-verifying; stale bundles make
  the DOM show old behavior.
