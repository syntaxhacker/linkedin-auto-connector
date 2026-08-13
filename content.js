(function () {
  // M8: only act in the top frame. The manifest loads this in all frames
  // (all_frames: true), and without this guard every iframe would process
  // popup messages (duplicate connects / port-closed warnings).
  if (typeof window !== 'undefined' && window.top && window !== window.top) return;

  let connected = 0, skipped = 0, failed = 0;
  let connectQueue = [];
  let isRunning = false;
  let delayMin = 1500, delayMax = 3000;

  // === Teardown handles (LEAK #1/#2/#4/#6/#7) ===
  // Module-scoped refs captured at attach/init time so teardownPage() and
  // teardownListeners() can remove them exactly once. Declared up here (before
  // any assignment site) to avoid TDZ across the init block.
  let winListeners = { onScroll: null, onUserScroll: null, onKeyScroll: null, resetTimer: null, released: false };
  let releaseFn = null;
  let onMessageListener = null;
  let onChangedListener = null;
  let contextmenuListener = null;
  let teardownBound = false;

  // === Palette (single source: palette.js, loaded before this file) ===
  const C = LI_PALETTE;

  // === Black & white theme for the floating UI (badge + panel) ===
  // High-contrast monochrome with slightly larger type for readability.
  const BW = {
    bg: '#000000',
    fg: '#ffffff',
    border: '#555555',
    muted: '#bbbbbb',
    accentBg: '#ffffff',
    accentFg: '#000000',
    hl: '#e8e8e8'
  };

  // === Feed scanner config ===
  let cfg = { autoExpand: true, scanEmails: true, includeKeywords: [], excludeKeywords: [], autoScroll: false, ultraHide: false, debug: true };

  // === Debug logging (gated by cfg.debug) ===
  function dbg() {
    if (cfg.debug && typeof console !== 'undefined' && console.log) {
      const args = Array.prototype.slice.call(arguments);
      args.unshift('[Job Radar]');
      console.log.apply(console, args);
    }
  }

  // === HTML-escape for rendering user/feed text into the panel (L3) ===
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // === Safe config field access (H3) ===
  function strArray(v) { return Array.isArray(v) ? v : []; }

  // === URL gate (user requirement): the extension only works on LinkedIn
  // Search and Feed pages FOR NOW. Everywhere else the floating panels show a
  // blurred notice instead of scanning. Accepts an optional location-like
  // object (tests inject new URL(...)) and defaults to window.location.
  function isAllowedUrl(loc) {
    const l = loc || (typeof window !== 'undefined' ? window.location : null);
    if (!l) return false;
    const host = String(l.hostname || '').toLowerCase();
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return false;
    const path = String(l.pathname || '');
    return path === '/search' || path.startsWith('/search/') ||
           path === '/feed' || path.startsWith('/feed/') ||
           // Company people pages list "Invite ... to connect" buttons (Pattern B).
           /^\/company\/[^/]+\/people\/?$/.test(path);
  }

  // Semi-transparent + backdrop-blur overlay with a centered notice, added to
  // BOTH panels whenever the current URL is not a Search/Feed page. Idempotent
  // per panel; removing it re-enables the normal panel content.
  function applyGateOverlays() {
    const gated = !isAllowedUrl();
    const ids = ['li-ac-panel', 'li-ac-found-panel'];
    ids.forEach(id => {
      const p = document.getElementById(id);
      if (!p) return;
      const existing = p.querySelector('.li-ac-gate-overlay');
      if (!gated) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return; // already showing
      const header = p.firstElementChild;
      const top = header && header.offsetHeight ? header.offsetHeight + 'px' : '0px';
      const ov = document.createElement('div');
      ov.className = 'li-ac-gate-overlay';
      ov.style.cssText = 'position:absolute;left:0;right:0;bottom:0;top:' + top + ';z-index:6;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);color:#fff;font:14px/1.5 sans-serif;';
      ov.innerHTML = '<div><div style="font-size:30px;margin-bottom:8px;">⚠️</div>' +
        '<div style="font-weight:700;margin-bottom:4px;">Works only on LinkedIn Search &amp; Feed pages</div>' +
        '<div style="color:#ddd;font-size:12px;">Open <b>linkedin.com/search</b> or<br><b>linkedin.com/feed</b> to use this extension.</div></div>';
      p.appendChild(ov);
    });
  }

  // Render (or keep) both panels in gated/blurred state — no scanning.
  function renderGatedPanels() {
    dbg('url gate: not a Search/Feed page — showing blurred notice panels');
    stopAutoScroll();
    stopTimeRefresh();
    renderPanel([], []); // renderPanel applies the gate overlays for both panels
  }

  // Re-evaluate the gate (SPA navigation via history.pushState/popstate or the
  // 2s monitor). Gated -> notice panels; allowed -> normal scan/rendering.
  function refreshUrlGate() {
    if (!isAllowedUrl()) {
      renderGatedPanels();
    } else {
      injectStyles();
      scanFeed();
      if (cfg.autoScroll) startAutoScroll(); // restart auto-scroll when returning to Search/Feed
    }
  }

  let lastGateAllowed = null;
  let gateCheckInterval = null;
  function startUrlGateMonitor() {
    stopUrlGateMonitor();
    lastGateAllowed = isAllowedUrl();
    window.addEventListener('popstate', refreshUrlGate);
    gateCheckInterval = setInterval(() => {
      const allowed = isAllowedUrl();
      if (allowed !== lastGateAllowed) {
        lastGateAllowed = allowed;
        refreshUrlGate();
      }
    }, 2000);
  }
  function stopUrlGateMonitor() {
    if (gateCheckInterval) { clearInterval(gateCheckInterval); gateCheckInterval = null; }
    window.removeEventListener('popstate', refreshUrlGate);
  }

  // === Hidden-post single source: the .li-ac-hidden class on the element ===
  const HIDDEN_CLS = 'li-ac-hidden';
  const HL_CLS = 'li-ac-kw-hl';
  // Collapses the whole feed card (post + its comment section). LinkedIn
  // renders the comment thread as a SIBLING of the post inside the card
  // wrapper, so collapsing only the post element would leave the comments
  // visible. The card gets its own class so hidden-count/hidden-state stay
  // keyed on the post element (.li-ac-hidden) alone.
  const HIDDEN_CARD_CLS = 'li-ac-hidden-card';
  // Ultra Hide mode: collapses every post that is NOT an include-keyword match
  // or an email match, exactly like exclude-hidden posts — but under its own
  // class so those posts stay out of the Hidden list (which tracks only
  // exclude-keyword posts). Same card-collapse trick for the comment thread.
  const ULTRA_CLS = 'li-ac-ultra';
  const ULTRA_CARD_CLS = 'li-ac-ultra-card';
  // Persistent green left-edge marker on feed posts that were removed from the
  // found lists via "Clear seen" — so users understand why they're no longer
  // listed. Uses an inset box-shadow (no layout shift, won't clash with the
  // keyword amber outline).
  const VIEWED_CLS = 'li-ac-viewed';

  function getHiddenPosts() {
    return Array.prototype.slice.call(document.querySelectorAll('.' + HIDDEN_CLS));
  }
  function getHiddenCount() { return getHiddenPosts().length; }
  function restoreHidden() {
    const hidden = getHiddenPosts();
    hidden.forEach(el => el.classList.remove(HIDDEN_CLS));
    // Reveal the wrapped cards too (comment sections).
    Array.prototype.slice.call(document.querySelectorAll('.' + HIDDEN_CARD_CLS)).forEach(el => el.classList.remove(HIDDEN_CARD_CLS));
    revealedHiddenKeys.clear();
    if (hidden.length) dbg('restoreHidden: revealed', hidden.length, 'post(s)');
    return hidden.length;
  }

  // Per-post hide/unhide from the Found panel's Hidden list. A post hidden by an
  // exclude keyword gets .li-ac-hidden (+ its card .li-ac-hidden-card). Clicking
  // "Show" in the Hidden list reveals that one post and remembers its key so the
  // next filterPosts pass doesn't immediately re-hide it; "Hide" reverses it.
  const revealedHiddenKeys = new Set();
  // Why was this post hidden? Stored on the element when filterPosts hides it
  // so the Hidden list can show the matching exclude keyword. Recomputes on the
  // fly for revealed-but-still-excluded rows.
  function hiddenReason(el) {
    const stored = el && el.getAttribute('data-hidden-reason');
    if (stored) return stored;
    if (!el) return '';
    const t = postBodyText(el).toLowerCase();
    return (strArray(cfg.excludeKeywords).find(k => kwMatch(t, k))) || '';
  }
  function revealHiddenPost(el) {
    const key = postKey(el);
    el.classList.remove(HIDDEN_CLS);
    const card = el.closest('[role="listitem"]');
    if (card && card !== el) card.classList.remove(HIDDEN_CARD_CLS);
    revealedHiddenKeys.add(key);
    dbg('revealed hidden post:', key.slice(0, 40));
  }
  function rehidePost(el) {
    const key = postKey(el);
    el.classList.add(HIDDEN_CLS);
    el.setAttribute('data-hidden-reason', hiddenReason(el));
    const card = el.closest('[role="listitem"]');
    if (card && card !== el) card.classList.add(HIDDEN_CARD_CLS);
    revealedHiddenKeys.delete(key);
    dbg('re-hid post:', key.slice(0, 40));
  }

  // Ultra Hide mode: collapse every post except include-keyword matches and
  // email matches (and posts the user manually revealed). Applies to the whole
  // feed each scan, so newly-loaded posts are handled too. Off → strips classes.
  function applyUltraHide(kwHits, emHits) {
    const posts = getPosts();
    if (!cfg.ultraHide) {
      posts.forEach(p => {
        p.classList.remove(ULTRA_CLS);
        const card = p.closest('[role="listitem"]');
        if (card && card !== p) card.classList.remove(ULTRA_CARD_CLS);
      });
      return;
    }
    const hitKeys = new Set();
    (kwHits || []).concat(emHits || []).forEach(h => hitKeys.add(h.key));
    posts.forEach(p => {
      const key = postKey(p);
      const keep = hitKeys.has(key) || revealedHiddenKeys.has(key);
      const card = p.closest('[role="listitem"]');
      if (keep) {
        p.classList.remove(ULTRA_CLS);
        if (card && card !== p) card.classList.remove(ULTRA_CARD_CLS);
      } else {
        p.classList.add(ULTRA_CLS);
        if (card && card !== p) card.classList.add(ULTRA_CARD_CLS);
      }
    });
  }

  // === Inject styles once (hover-to-expand hidden posts + keyword highlight) ===
  function injectStyles() {
    if (document.getElementById('li-ac-styles')) return;
    const style = document.createElement('style');
    style.id = 'li-ac-styles';
    style.textContent =
      '.' + HIDDEN_CLS + ' { max-height: 2.5em; overflow: hidden; opacity: .35; border-left: 4px solid ' + C.warn + '; padding-left: 8px; transition: max-height .25s ease, opacity .25s ease; }' +
      '.' + HIDDEN_CLS + ':hover { max-height: 4000px; opacity: 1; }' +
      '.' + HIDDEN_CARD_CLS + ' { max-height: 2.5em; overflow: hidden; opacity: .35; border-left: 4px solid ' + C.warn + '; padding-left: 8px; transition: max-height .25s ease, opacity .25s ease; }' +
      '.' + HIDDEN_CARD_CLS + ':hover { max-height: 4000px; opacity: 1; }' +
      '.' + ULTRA_CLS + ' { max-height: 2.5em; overflow: hidden; opacity: .35; border-left: 4px solid ' + C.warn + '; padding-left: 8px; transition: max-height .25s ease, opacity .25s ease; }' +
      '.' + ULTRA_CLS + ':hover { max-height: 4000px; opacity: 1; }' +
      '.' + ULTRA_CARD_CLS + ' { max-height: 2.5em; overflow: hidden; opacity: .35; border-left: 4px solid ' + C.warn + '; padding-left: 8px; transition: max-height .25s ease, opacity .25s ease; }' +
      '.' + ULTRA_CARD_CLS + ':hover { max-height: 4000px; opacity: 1; }' +
      '.' + VIEWED_CLS + ' { box-shadow: inset 3px 0 0 ' + C.ok + '; }' +
      '.' + HL_CLS + ' { outline: 3px solid ' + C.warn + '; outline-offset: 2px; box-shadow: 0 0 12px rgba(251,191,36,.5); transition: all 0.3s; }';
    document.head.appendChild(style);
  }

  // === Badge UI ===
  function createBadge() {
    let b = document.getElementById('li-ac-badge');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'li-ac-badge';
    b.style.cssText = 'position:fixed;top:60px;right:16px;z-index:999999;background:' + BW.bg + ';color:' + BW.fg + ';padding:10px 14px;border-radius:8px;font:14px/1.5 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.5);min-width:190px;border:1px solid ' + BW.border + ';';
    b.innerHTML = '<div id="li-ac-badge-title" style="font-weight:700;font-size:15px">Job Radar</div>' +
      '<div id="li-ac-status" style="color:' + BW.muted + ';margin-top:2px;display:none">⏳ Running...</div>' +
      '<div id="li-ac-count" style="margin-top:6px;font-size:13px">Connected: <b>0</b> | Skipped: <b>0</b></div>' +
      '<div id="li-ac-log" style="margin-top:6px;font-size:12px;color:' + BW.muted + '"></div>';
    document.body.appendChild(b);
    return b;
  }
  function removeBadge() { const b = document.getElementById('li-ac-badge'); if (b) b.remove(); }
  function updateBadge() {
    const c = document.getElementById('li-ac-count');
    const s = document.getElementById('li-ac-status');
    const t = document.getElementById('li-ac-badge-title');
    if (t) t.textContent = isRunning ? 'Connecting…' : 'Job Radar';
    if (c) c.innerHTML = 'Connected: <b style="color:' + C.okText + '">' + connected + '</b> | Skipped: <b style="color:' + C.warn + '">' + skipped + '</b>';
    if (s) { s.style.display = isRunning ? 'block' : 'none'; s.textContent = isRunning ? '⏳ Running...' : ''; s.style.color = C.warn; }
  }
  function log(msg) { const el = document.getElementById('li-ac-log'); if (el) el.textContent = msg; }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function randomDelay() { return Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin; }

  // === Scan for Connect/Invite buttons ===
  function scanButtons() {
    document.querySelectorAll('.li-ac-hl').forEach(el => { el.style.outline = ''; el.style.boxShadow = ''; el.classList.remove('li-ac-hl'); });
    connectQueue = [];

    // Pattern A: <a> tags with search-custom-invite href (profile search results)
    const anchors = document.querySelectorAll('a[href*="search-custom-invite"]');
    for (const link of anchors) {
      if (!link.offsetParent) continue;
      if ((link.textContent || '').trim().toLowerCase() !== 'connect') continue;
      const card = link.closest('[role="listitem"], li, [data-urn]');
      if (!card) continue;
      if (/3rd/i.test(card.textContent)) {
        let skipName = 'Unknown';
        const pLink = card.querySelector('a[href*="/in/"]');
        if (pLink) skipName = pLink.textContent.trim().replace(/Verified|Premium|Open to Work/gi, '').trim();
        skipped++; log('⏭ 3rd+ degree: ' + skipName); continue;
      }
      let name = 'Unknown';
      const pLink = card.querySelector('a[href*="/in/"]');
      if (pLink) name = pLink.textContent.trim().replace(/Verified|Premium|Open to Work/gi, '').trim();
      let vanity = '';
      const m = link.href.match(/vanityName=([^&]+)/);
      if (m) vanity = m[1];
      connectQueue.push({ el: link, name, vanity, type: 'a' });
    }

    // Pattern B: <button> elements with aria-label "Invite ... to connect" (company people pages)
    const buttons = document.querySelectorAll('button[aria-label*="Invite"][aria-label*="to connect"]');
    for (const btn of buttons) {
      if (!btn.offsetParent) continue;
      const label = btn.getAttribute('aria-label') || '';
      if (!/^Invite\s+.+\s+to\s+connect$/i.test(label.trim())) continue;
      let name = label.replace(/^Invite\s+/i, '').replace(/\s+to\s+connect\s*$/i, '').trim();
      // Bound the skip checks to this button's card when one exists (never read
      // page-wide text — a stray "3rd"/"Intern" elsewhere must not matter).
      // Fall back to the original bounded 4-level ancestor walk without a card.
      const card = btn.closest('[role="listitem"], li, [data-urn]');
      let isThirdDegree = false, hasIntern = false;
      if (card) {
        isThirdDegree = /3rd/i.test(card.textContent || '');
        hasIntern = /\bintern\b/i.test(card.textContent || '');
      } else {
        // No card: walk up to 4 ancestor levels (LinkedIn nests these shallowly).
        let el = btn.parentElement, i;
        for (i = 0; i < 4 && el; i++) {
          const txt = (el.textContent || '');
          if (/3rd/i.test(txt)) { isThirdDegree = true; break; }
          if (/\bintern\b/i.test(txt)) { hasIntern = true; break; }
          el = el.parentElement;
        }
      }
      if (isThirdDegree) { skipped++; log('⏭ 3rd+ degree: ' + name); continue; }
      if (hasIntern) { skipped++; log('⏭ Intern filter: ' + name); continue; }
      connectQueue.push({ el: btn, name, vanity: '', type: 'button' });
    }
    return connectQueue.length;
  }

  // === Highlight all found buttons ===
  function highlightAll() {
    for (const item of connectQueue) {
      item.el.classList.add('li-ac-hl');
      item.el.style.outline = '3px solid ' + C.infoOnWhite;
      item.el.style.outlineOffset = '2px';
      item.el.style.boxShadow = '0 0 12px rgba(37,99,235,.35)';
      item.el.style.transition = 'all 0.3s';
      item.el.title = 'Job Radar: ' + item.name;
    }
  }

  // === Process one connect action ===
  async function processNext() {
    if (connectQueue.length === 0 || !isRunning) { finish(); return; }
    const item = connectQueue.shift();
    if (!item) { finish(); return; }

    log('Connecting: ' + item.name);
    item.el.style.outline = '3px solid ' + C.warn;
    item.el.style.boxShadow = '0 0 12px rgba(251,191,36,.35)';
    item.el.click();

    // LinkedIn opens the "Add a note?" dialog asynchronously — it can take a
    // couple of seconds. Poll for it instead of giving up after one fixed wait
    // (a premature miss silently skipped connectable people).
    let dialog = null;
    for (let tries = 0; tries < 10 && isRunning; tries++) {
      await sleep(300);
      dialog = item.el.closest('[role="dialog"]') || document.querySelector('[role="dialog"]');
      if (dialog) break;
    }
    if (!isRunning) return; // H2: STOP during the wait aborts before any send

    if (dialog) {
      const btns = dialog.querySelectorAll('button');
      let sent = false;
      for (const b of btns) {
        if (b.textContent.includes('without') || b.textContent.includes('Send without')) {
          b.style.outline = '3px solid ' + C.ok;
          b.style.boxShadow = '0 0 16px rgba(34,197,94,.4)';
          b.click();
          connected++;
          sent = true;
          log('✅ Connected: ' + item.name);
          item.el.style.outline = '3px solid ' + C.ok;
          item.el.style.boxShadow = 'none';
          break;
        }
      }
      if (!sent) {
        skipped++;
        log('⏭ Skipped (no send btn): ' + item.name);
        const dismiss = dialog.querySelector('button[aria-label="Dismiss"]');
        if (dismiss) dismiss.click();
        item.el.style.outline = '3px solid ' + C.warn;
      }
    } else {
      // Direct connect or failed
      await sleep(500);
      if (!isRunning) return; // H2
      const txt = (item.el.textContent || '').trim().toLowerCase();
      if (txt === 'pending') { connected++; log('✅ Connected (direct): ' + item.name); item.el.style.outline = '3px solid ' + C.ok; }
      else { skipped++; log('⏭ No dialog: ' + item.name); item.el.style.outline = '3px solid ' + C.danger; }
    }
    updateBadge();
    await sleep(randomDelay());
    if (isRunning) processNext();
  }

  function finish() {
    isRunning = false;
    updateBadge();
    log('🏁 Done. Connected: ' + connected + ', Skipped: ' + skipped);
  }

  // === Feed scanner ===
  // L2: local part must not start/end with a dot or contain double dots.
  const EMAIL_RE = /[A-Za-z0-9]+(?:[._%+-][A-Za-z0-9]+)*@(?:[A-Za-z0-9-]+\.)+[a-z]{2,}(?![a-z0-9])/g;

  // M7: the exact heading text differs by locale/DOM drift; match any of these.
  const FEED_MARKERS = ['feed post', 'feed', 'home'];

  function getPosts() {
    return Array.from(document.querySelectorAll('h2'))
      .filter(h => FEED_MARKERS.includes((h.textContent || '').trim().toLowerCase()))
      .map(h => h.parentElement)
      .filter(p => p && !p.classList.contains(HIDDEN_CLS));
  }

  // Split a keyword on '+' into AND parts only when every '+' is a separator
  // between word-like segments ("react+senior+python" → all three). A '+' that
  // is not followed by a word (e.g. "c++") stays a single token.
  function kwParts(kw) {
    const s = String(kw || '').trim();
    if (!s) return [];
    if (/^[a-z0-9][a-z0-9 ._-]*(\+[a-z0-9][a-z0-9 ._-]*)+$/i.test(s)) {
      return s.toLowerCase().split('+').map(p => p.trim());
    }
    return [s.toLowerCase()];
  }
  function kwMatch(text, kw) {
    // Defensive: an empty keyword must not match every post (''.includes('') is true).
    // Popup input is pre-filtered with .filter(Boolean), so this path is unreachable
    // in production; it exists to keep the matching contract well-defined.
    if (!kw) return false;
    // AND-grouping: "react+senior" matches only if ALL parts appear.
    const parts = kwParts(kw);
    if (!parts.length) return false;
    const t = String(text).toLowerCase();
    return parts.every(p => {
      // Plain alphanumeric words match on word boundaries — so "qa" matches
      // "qa manager" but NOT "Qaid", and "opt" matches "OPT" but NOT "optical".
      // Keywords carrying punctuation (".net", "c++", "node.js", "h-1b") or
      // spaces (multi-word phrases) keep literal substring matching so
      // "ASP.NET" and "C++" still match exactly.
      if (/^[a-z0-9]+$/i.test(p)) {
        return new RegExp('(^|[^a-z0-9])' + esc(p) + '([^a-z0-9]|$)', 'i').test(text);
      }
      return t.includes(p);
    });
  }
  function esc(kw) { return kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function wordMatch(text, kw) {
    // AND-grouping: "react+senior" matches only if EVERY part appears as a word.
    const parts = kwParts(kw);
    if (!parts.length) return false;
    return parts.every(p => new RegExp('(^|[^a-z0-9])' + esc(p) + '([^a-z0-9]|$)', 'i').test(text));
  }

  function expandPosts(posts) {
    if (!cfg.autoExpand) return 0;
    let clicked = 0;
    posts.forEach(p => {
      // Only expand posts that are in or near the viewport. Expanding off-screen
      // posts grows the feed and can trigger endless "new content" mutations,
      // which starve auto-scroll and cause infinite scrolling.
      let inView = true;
      try {
        const r = p.getBoundingClientRect();
        inView = r.bottom >= -300 && r.top <= window.innerHeight + 300;
      } catch (e) {}
      if (!inView) return;
      Array.from(p.querySelectorAll('button')).forEach(b => {
        if (/…\s*more|\.\.\.\s*more|see more$/i.test((b.textContent || '').trim())) {
          try {
            // Synthetic click: triggers the handler without scrolling the button into view
            b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            clicked++;
          } catch (e) {}
        }
      });
    });
    return clicked;
  }

  function filterPosts(posts) {
    let hidden = 0;
    const excludes = strArray(cfg.excludeKeywords);
    posts.forEach(p => {
      if (p.classList.contains(HIDDEN_CLS)) return; // already hidden — no double work
      if (revealedHiddenKeys.has(postKey(p))) return; // user explicitly revealed it
      const t = postBodyText(p).toLowerCase();
      // Exclude: substring match (".net" must catch "ASP.NET", ".NET Core", etc.)
      const matched = excludes.find(k => kwMatch(t, k));
      // Include keywords never hide posts — they only highlight (scanKeywords).
      if (matched !== undefined) {
        p.classList.add(HIDDEN_CLS);
        p.setAttribute('data-hidden-reason', matched);
        // LinkedIn renders the comment thread as a sibling of the post inside
        // the card wrapper — collapse the whole card so comments hide too.
        const card = p.closest('[role="listitem"]');
        if (card && card !== p) card.classList.add(HIDDEN_CARD_CLS);
        hidden++;
        dbg('hidden post (excluded by "' + matched + '"):', t.slice(0, 60));
      }
    });
    if (hidden) dbg('filterPosts: hid', hidden, 'post(s),', getHiddenCount(), 'total hidden');
    return hidden;
  }

  function scanEmails(posts) {
    const hits = [];
    posts.forEach(p => {
      const raw = postBodyText(p);
      const found = [];
      let m;
      EMAIL_RE.lastIndex = 0;
      while ((m = EMAIL_RE.exec(raw)) !== null) found.push(m[0]);
      if (found.length) {
        const key = postKey(p);
        ensureMeta('em', key);
        hits.push({ el: p, emails: [...new Set(found)], key });
      }
    });
    return hits;
  }

  function clearKeywordHighlights() {
    Array.prototype.forEach.call(document.querySelectorAll('.' + HL_CLS), el => el.classList.remove(HL_CLS));
  }

  // Green left-edge marker on feed posts that were removed from the found
  // lists via "Clear seen". Re-applied every scan (LinkedIn re-renders posts),
  // so cleared posts stay visibly marked until RESET.
  function applyViewedBorders(posts) {
    posts.forEach(p => {
      const key = postKey(p);
      if (dismissedKeys.has('kw:' + key) || dismissedKeys.has('em:' + key)) {
        p.classList.add(VIEWED_CLS);
      } else {
        p.classList.remove(VIEWED_CLS);
      }
    });
  }

  function scanKeywords(posts) {
    const hits = [];
    const includes = strArray(cfg.includeKeywords);
    if (!includes.length) return hits;
    posts.forEach(p => {
      const t = postBodyText(p).toLowerCase();
      const matched = includes.filter(k => wordMatch(t, k));
      if (matched.length) {
        const key = postKey(p);
        ensureMeta('kw', key);
        p.classList.add(HL_CLS);
        hits.push({ el: p, keywords: matched, key });
        dbg('keyword hit (' + matched.join(', ') + '):', t.slice(0, 60));
      }
    });
    return hits;
  }

  // === Right-click → add post keywords to include/exclude ===
  // Small stopword list so we extract meaningful tokens, not filler.
  const STOPWORDS = new Set('a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,is,are,was,were,be,been,being,have,has,had,do,does,did,will,would,can,could,should,may,might,must,this,that,these,those,it,its,as,so,than,too,very,just,not,no,yes,also,only,into,out,over,under,up,down,all,any,both,each,few,more,most,other,some,such,about,after,before,between,our,their,your,my,we,us,them,they,he,she,him,her,i,you,what,which,who,whom,when,where,why,how,get,got,make,made,like,look,need,want,work,works,working,join,team,role,post,feed,please,share,click,open,read,check,see,use,using,build,building,developer,engineer,hiring,looking,great,new,good'.split(','));
  function extractKeywordsFromPost(el) {
    const raw = postBodyText(el).toLowerCase();
    const tokens = raw.match(/[a-z][a-z0-9+#.-]{2,}/g) || [];
    const counts = new Map();
    tokens.forEach(t => {
      if (STOPWORDS.has(t)) return;
      counts.set(t, (counts.get(t) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(e => e[0]);
  }

  let rightClickedPost = null;
  // Capture which post the user right-clicked so the background context menu
  // ("Add to Include"/"Add to Exclude") knows which keywords to add.
  function captureRightClick(e) {
    rightClickedPost = null;
    if (!e || !e.target) return;
    const posts = getPosts();
    for (const p of posts) {
      if (p.contains && p.contains(e.target)) { rightClickedPost = p; break; }
    }
  }
  if (typeof document !== 'undefined') {
    contextmenuListener = captureRightClick;
    document.addEventListener('contextmenu', captureRightClick, true);
  }

  function addRightClickedTo(kind) {
    if (!rightClickedPost) return 0;
    const kws = extractKeywordsFromPost(rightClickedPost);
    if (!kws.length) return 0;
    const key = kind === 'exclude' ? 'excludeKeywords' : 'includeKeywords';
    cfg[key] = Array.from(new Set(kws.concat(strArray(cfg[key])))); // newest-first (context-add)
    chrome.storage.sync.set({ [key]: cfg[key] });
    dbg('context-add to ' + key + ':', kws.join(', '));
    restoreHidden();
    scanFeed();
    return kws.length;
  }

  // === Closable keyword tags (panel UI) ===
  function tagHtml(kw) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:' + BW.hl + ';color:' + BW.accentFg + ';border:1px solid ' + BW.border + ';border-radius:4px;padding:4px 9px;font-size:13px;">' +
      escHtml(kw) +
      '<button type="button" data-kw-remove="' + escHtml(kw) + '" title="Remove ' + escHtml(kw) + '" style="background:none;border:none;color:' + BW.accentFg + ';cursor:pointer;font-size:15px;line-height:1;padding:0 2px;">×</button>' +
    '</span>';
  }

  function renderTags(panelEl) {
    if (!panelEl) return;
    const inc = panelEl.querySelector('#li-ac-tags-include');
    const exc = panelEl.querySelector('#li-ac-tags-exclude');
    if (inc) inc.innerHTML = strArray(cfg.includeKeywords).map(tagHtml).join('');
    if (exc) exc.innerHTML = strArray(cfg.excludeKeywords).map(tagHtml).join('');
  }

  function removeKeyword(kw, kind) {
    const key = kind === 'exclude' ? 'excludeKeywords' : 'includeKeywords';
    const next = strArray(cfg[key]).filter(k => k !== kw);
    cfg[key] = next;
    chrome.storage.sync.set({ [key]: next });
    dbg('removed keyword "' + kw + '" from ' + key + '; re-scanning');
    if (kind === 'exclude') restoreHidden(); // posts no longer matching come back
    scanFeed();
  }

  let panel = null;
  let foundPanel = null;
  let panelData = [];
  let kwPanelData = [];
  // Emails we've already auto-jumped to — used so the auto-scroll jump only
  // fires for NEWLY discovered emails instead of re-centering on every scan.
  const knownEmails = new Set();
  // Keyword-only hits we've already jumped to (same purpose as knownEmails,
  // for the keyword list — prevents re-centering on the same first keyword
  // post every scan, which caused upward scrolls).
  const knownKeywordKeys = new Set();

  // === Hit metadata: first-seen time + viewed flag (session-only) ===
  // Keyed by `${kind}:${postKey}` so the state survives LinkedIn's re-renders
  // (DOM nodes change, the normalized post text does not).
  const hitMeta = new Map();

  function postKey(el) {
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  // The post's own body text: only the direct <p> children of the post card.
  // The card also contains the author's profile headline, "likes this" rows,
  // reaction counts, and action buttons — reading those would match keywords
  // found only in the author's profile. No <p> (widgets, commentary-less shared
  // cards) → '' so they never match.
  function postBodyText(el) {
    if (!el) return '';
    return Array.from(el.children)
      .filter(c => c.tagName === 'P')
      .map(c => c.textContent || '')
      .join('\n');
  }

  function timeAgo(ms) {
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'min ago';
    const h = Math.floor(m / 60);
    return h + 'h ago';
  }

  // Bounded to HIT_META_CAP entries (evict oldest by insertion order) so a long
  // feed-scroll session can't grow the map without limit (LEAK #5).
  const HIT_META_CAP = 400;
  function ensureMeta(kind, key) {
    const k = kind + ':' + key;
    if (hitMeta.has(k)) return hitMeta.get(k);
    const meta = { firstSeen: Date.now(), viewed: false };
    hitMeta.set(k, meta);
    if (hitMeta.size > HIT_META_CAP) {
      // Map preserves insertion order; drop the oldest entry.
      const oldest = hitMeta.keys().next().value;
      hitMeta.delete(oldest);
    }
    return meta;
  }

  function markViewed(kind, key) {
    const meta = ensureMeta(kind, key);
    meta.viewed = true;
    return meta;
  }

  function resetHitMeta() { hitMeta.clear(); dismissedKeys.clear(); }

  // "Clear seen": every viewed hit is removed from the found lists (and gets a
  // green border in the feed) so users see why it's no longer listed. Tracks
  // `kind:key` entries that survive re-scans; RESET restores them.
  const dismissedKeys = new Set();
  function clearSeen() {
    hitMeta.forEach((meta, k) => { if (meta.viewed) dismissedKeys.add(k); });
    renderPanel(panelData, kwPanelData);
    applyViewedBorders(getPosts());
    return dismissedKeys.size;
  }

  // Sort toggle state for the found lists (newest-discovered first by default).
  const sortNewest = { kw: true, em: true };
  function sortedHits(kind) {
    const arr = kind === 'kw' ? kwPanelData : panelData;
    const visible = arr.filter(h => !dismissedKeys.has(kind + ':' + h.key));
    if (!sortNewest[kind]) return visible;
    return visible.slice().sort((a, b) => {
      const ma = hitMeta.get(kind + ':' + a.key) || { firstSeen: 0 };
      const mb = hitMeta.get(kind + ':' + b.key) || { firstSeen: 0 };
      return mb.firstSeen - ma.firstSeen;
    });
  }

  // Hide a Found-panel section's sort button bar when its hit list is empty;
  // show it again when hits exist. Driven from the render path (renderPanel
  // re-renders every scan). toggleSort already guards missing elements.
  function setSectionBarVisible(kind, hasHits) {
    const bar = document.getElementById(kind === 'kw' ? 'li-ac-kw-sortbar' : 'li-ac-em-sortbar');
    if (bar) bar.style.display = hasHits ? 'flex' : 'none';
  }
  function toggleSort(kind) {
    sortNewest[kind] = !sortNewest[kind];
    const btn = document.getElementById(kind === 'kw' ? 'li-ac-kw-sort' : 'li-ac-em-sort');
    if (btn) applySortButtonStyle(btn, sortNewest[kind]);
    scanFeed();
  }
  // Active (newest-first, the default) = blue background with dark text;
  // inactive (feed order) = neutral white. Keeps the toggle state visible.
  function applySortButtonStyle(btn, active) {
    if (!btn) return;
    if (active) {
      btn.style.background = C.info;       // blue = newest-first is ON
      btn.style.color = '#000000';
      btn.textContent = '⇅ Newest';
      btn.title = 'Newest first (click for feed order)';
    } else {
      btn.style.background = BW.fg;        // white = feed order
      btn.style.color = '#000000';
      btn.textContent = 'Feed order';
      btn.title = 'Feed order (click for newest first)';
    }
  }
  // Reflect the current sort state on the Newest button whenever the panel is
  // (re)rendered.
  function applySortButtons(foundPanelEl) {
    if (!foundPanelEl) return;
    const setBtn = (id, kind) => {
      const btn = foundPanelEl.querySelector(id);
      if (btn) applySortButtonStyle(btn, sortNewest[kind]);
    };
    setBtn('#li-ac-kw-sort', 'kw');
    setBtn('#li-ac-em-sort', 'em');
  }
  function wirePanel(root) {
    root.addEventListener('click', e => {
      const hideBtn = e.target.closest('[data-hidden-toggle]');
      if (hideBtn) {
        const action = hideBtn.getAttribute('data-hidden-toggle');
        const row = hideBtn.closest('[data-hidden-key]');
        const key = row ? row.getAttribute('data-hidden-key') : hideBtn.getAttribute('data-hidden-key');
        const el = [...getHiddenPosts(), ...getPosts()].find(p => postKey(p) === key);
        if (el) {
          if (action === 'show') revealHiddenPost(el);
          else rehidePost(el);
          // Show/Hide only toggles visibility — no need to re-filter or re-scan
          // the feed. Re-render the panels with the already-scanned data, and
          // keep Ultra Hide state consistent (revealed posts stay expanded).
          renderPanel(panelData, kwPanelData);
          applyUltraHide(kwPanelData, panelData);
        }
        return;
      }
      // Clicking anywhere else on a hidden-post row scrolls to that post in the
      // feed (same behavior as keyword/email rows).
      const hiddenRow = e.target.closest('[data-hidden-key]');
      if (hiddenRow) {
        const key = hiddenRow.getAttribute('data-hidden-key');
        const el = [...getHiddenPosts(), ...getPosts()].find(p => postKey(p) === key);
        if (el && el.isConnected) {
          disableAutoScroll();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const oldOutline = el.style.outline;
          const oldShadow = el.style.boxShadow;
          el.style.outline = '3px solid ' + C.dustyDenim;
          el.style.boxShadow = '0 0 20px ' + C.dustyDenim + 'aa';
          setTimeout(() => { el.style.outline = oldOutline; el.style.boxShadow = oldShadow; }, 2000);
        }
        return;
      }
      const removeBtn = e.target.closest('[data-kw-remove]');
      if (removeBtn) {
        const kw = removeBtn.getAttribute('data-kw-remove');
        const kind = removeBtn.closest('#li-ac-tags-exclude') ? 'exclude' : 'include';
        removeKeyword(kw, kind);
        if (panel) renderTags(panel);
        return;
      }
      const li = e.target.closest('[data-idx]');
      if (!li) return;
      const target = li.getAttribute('data-kind');
      const key = li.getAttribute('data-key');
      const arr = target === 'kw' ? kwPanelData : panelData;
      let hit = key ? arr.find(h => h.key === key) : null;
      if (!hit) {
        const idx = parseInt(li.getAttribute('data-idx'), 10);
        hit = arr[idx];
      }
      if (!hit || !hit.el) return;
      let el = hit.el;
      if (!el.isConnected) {
        const live = getPosts().find(p => postKey(p) === hit.key);
        if (live) el = live;
      }
      markViewed(target, hit.key);
      const badge = li.querySelector('[data-viewed]');
      if (!badge) {
        const head = li.firstElementChild;
        if (head) head.insertAdjacentHTML('beforeend', '<span data-viewed style="display:inline-block;margin-left:5px;color:' + C.okText + ';background:' + C.seenChipBg + ';border:1px solid ' + C.seenBorder + ';border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">✓ seen</span>');
      }
      li.style.background = C.seenRowTint;
      li.style.borderLeft = '3px solid ' + C.seenBorder;
      disableAutoScroll();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const oldOutline = el.style.outline;
      const oldShadow = el.style.boxShadow;
      el.style.outline = '3px solid ' + C.dustyDenim;
      el.style.boxShadow = '0 0 20px ' + C.dustyDenim + 'aa';
      setTimeout(() => { el.style.outline = oldOutline; el.style.boxShadow = oldShadow; }, 2000);
    });
  }

  // Collapse state for the include/exclude keyword inputs section.
  let kwSectionCollapsed = false;
  function getKwSectionCollapsed() { return kwSectionCollapsed; }
  function applyKwSection(panelEl) {
    const section = panelEl && panelEl.querySelector('#li-ac-kw-section');
    const btn = panelEl && panelEl.querySelector('#li-ac-kw-collapse');
    if (section) section.style.display = kwSectionCollapsed ? 'none' : '';
    if (btn) btn.textContent = kwSectionCollapsed ? '▲' : '▼';
  }
  function setKwSectionCollapsed(v) {
    kwSectionCollapsed = !!v;
    chrome.storage.sync.set({ kwSectionCollapsed });
    if (panel) applyKwSection(panel);
    return kwSectionCollapsed;
  }
  function toggleKwSection() { return setKwSectionCollapsed(!kwSectionCollapsed); }

  // Collapse state for each floating panel: minimizing hides the panel BODY
  // (everything under the header) while keeping the header visible so the
  // panel can be expanded again. Independent per panel; persisted like
  // kwSectionCollapsed and re-applied on every renderPanel pass.
  let panelMinimized = false;
  let foundPanelMinimized = false;
  function getPanelMinimized() { return panelMinimized; }
  function getFoundPanelMinimized() { return foundPanelMinimized; }
  function applyPanelMinimized(panelEl) {
    if (!panelEl) return;
    const body = panelEl.querySelector('#li-ac-panel-body');
    const btn = panelEl.querySelector('#li-ac-panel-min');
    if (body) body.style.display = panelMinimized ? 'none' : '';
    if (btn) btn.textContent = panelMinimized ? '+' : '\u2013';
  }
  function applyFoundPanelMinimized(panelEl) {
    if (!panelEl) return;
    const body = panelEl.querySelector('#li-ac-found-body');
    const btn = panelEl.querySelector('#li-ac-found-min');
    if (body) body.style.display = foundPanelMinimized ? 'none' : 'flex';
    if (btn) btn.textContent = foundPanelMinimized ? '+' : '\u2013';
  }
  function setPanelMinimized(v) {
    panelMinimized = !!v;
    chrome.storage.sync.set({ panelMinimized });
    if (panel) applyPanelMinimized(panel);
    return panelMinimized;
  }
  function setFoundPanelMinimized(v) {
    foundPanelMinimized = !!v;
    chrome.storage.sync.set({ foundPanelMinimized });
    if (foundPanel) applyFoundPanelMinimized(foundPanel);
    return foundPanelMinimized;
  }
  function togglePanelMinimize() { return setPanelMinimized(!panelMinimized); }
  function toggleFoundPanelMinimize() { return setFoundPanelMinimized(!foundPanelMinimized); }

  // Build one panel row for a keyword/email hit: headline, snippet, time-ago,
  // and a ✓ badge once viewed.
  function hitRowHtml(hit, i, kind) {
    const meta = hitMeta.get(kind + ':' + hit.key) || { firstSeen: Date.now(), viewed: false };
    const badge = meta.viewed
      ? '<span data-viewed style="display:inline-block;margin-left:5px;color:' + C.okText + ';background:' + C.seenChipBg + ';border:1px solid ' + C.seenBorder + ';border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">✓ seen</span>'
      : '';
    const dim = meta.viewed ? ';opacity:.5' : '';
    const rowStyle = 'padding:8px 9px;cursor:pointer;border-bottom:1px solid ' + BW.border + ';border-radius:4px;border-left:3px solid ' + (meta.viewed ? C.seenBorder : 'transparent') + ';' + (meta.viewed ? 'background:' + C.seenRowTint + ';' : '');
    const headline = kind === 'kw' ? hit.keywords.map(escHtml).join(', ') : hit.emails.map(escHtml).join('<br>');
    return '<div data-idx="' + i + '" data-kind="' + kind + '" data-key="' + escHtml(hit.key) + '" style="' + rowStyle + '">' +
      '<div style="color:' + BW.fg + ';font-size:14px;word-break:break-all;">' + headline + badge + '</div>' +
      '<div style="color:' + BW.muted + ';font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + dim + '">' + escHtml((postBodyText(hit.el) || '').replace(/\s+/g, ' ').trim().slice(0, 70)) + '</div>' +
      '<div data-ago style="color:' + BW.muted + ';opacity:.8;font-size:11px;">' + timeAgo(meta.firstSeen) + '</div>' +
    '</div>';
  }

  // Build one row for a hidden post in the Found panel's Hidden list: snippet,
  // the exclude keyword that hid it, and a Show/Hide toggle.
  function hiddenRowHtml(el, i, revealed) {
    const key = postKey(el);
    const snippet = escHtml((postBodyText(el) || '').replace(/\s+/g, ' ').trim().slice(0, 70));
    const reason = escHtml(hiddenReason(el));
    const btn = revealed
      ? '<button data-hidden-toggle="hide" title="Hide this post again" style="flex:none;padding:2px 8px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">Hide</button>'
      : '<button data-hidden-toggle="show" title="Show this post" style="flex:none;padding:2px 8px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">Show</button>';
    return '<div data-hidden-idx="' + i + '" data-hidden-key="' + escHtml(key) + '" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid ' + BW.border + ';">' +
      '<div style="flex:1 1 auto;min-width:0;">' +
        '<div style="color:' + BW.muted + ';font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + snippet + '</div>' +
        '<div style="color:' + C.warn + ';font-size:10px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Hidden: ' + reason + '</div>' +
      '</div>' +
      btn +
    '</div>';
  }

  // Found panel sits left of the control panel; when the control panel is
  // closed it hugs the right edge instead of leaving a gap.
  function positionFoundPanel() {
    if (!foundPanel) return;
    // The control panel never closes (minimize only), so the found panel is
    // always offset to its left.
    foundPanel.style.right = '348px';
  }
  function renderPanel(hits, kwHits) {
    panelData = hits;
    kwPanelData = kwHits || [];

    // === Control panel (right): header, auto-scroll, hidden count, keywords ===
    if (!panel || !panel.isConnected) {
      panel = document.createElement('div');
      panel.id = 'li-ac-panel';
      panel.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999999;width:320px;max-height:78vh;overflow:auto;background:' + BW.bg + ';color:' + BW.fg + ';border:1px solid ' + BW.border + ';border-radius:8px;font:15px/1.55 sans-serif;box-shadow:0 2px 14px rgba(0,0,0,.6);';
      panel.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid ' + BW.border + ';font-weight:700;font-size:16px;border-radius:8px 8px 0 0;"><span>🔗 Job Radar</span><button id="li-ac-panel-min" title="Minimize/expand panel" style="flex:none;width:26px;height:26px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:15px;line-height:1;font-weight:700;cursor:pointer;">–</button></div>' +
        '<div id="li-ac-panel-body">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid ' + BW.border + ';font-size:14px;">' +
          '<input type="checkbox" id="li-ac-autoscroll" style="accent-color:' + BW.fg + ';width:16px;height:16px;"' + (cfg.autoScroll ? ' checked' : '') + '>' +
          '<label for="li-ac-autoscroll" style="cursor:pointer;">Auto-scroll feed</label>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid ' + BW.border + ';font-size:14px;">' +
          '<input type="checkbox" id="li-ac-ultra-hide" style="accent-color:' + BW.fg + ';width:16px;height:16px;"' + (cfg.ultraHide ? ' checked' : '') + '>' +
          '<label for="li-ac-ultra-hide" style="cursor:pointer;">Hide non-matching posts</label>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid ' + BW.border + ';font-size:13px;">' +
          '<label for="li-ac-autoscroll-min" style="color:' + BW.muted + ';">Auto-stop after (min)</label>' +
          '<input type="number" id="li-ac-autoscroll-min" min="0" step="1" value="' + autoScrollDurationMin + '" style="width:64px;padding:4px 6px;border:1px solid ' + BW.border + ';border-radius:4px;background:' + BW.bg + ';color:' + BW.fg + ';font-size:13px;text-align:center;">' +
          '<span style="color:' + BW.muted + ';font-size:11px;">0 = never</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:' + BW.fg + ';padding:8px 12px;border-bottom:1px solid ' + BW.border + ';">' +
          '<span>⌨ Keywords</span>' +
          '<button id="li-ac-kw-collapse" title="Collapse/expand keyword inputs" style="flex:none;width:26px;height:24px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;">▼</button>' +
        '</div>' +
        '<div id="li-ac-kw-section" style="padding:8px 12px;border-bottom:1px solid ' + BW.border + ';">' +
          '<div style="font-size:13px;color:' + BW.muted + ';margin-bottom:5px;">Include keywords</div>' +
          '<input id="li-ac-kw-include" style="width:100%;padding:7px 8px;border:1px solid ' + BW.border + ';border-radius:4px;background:' + BW.bg + ';color:' + BW.fg + ';font-size:14px;margin-bottom:5px;" placeholder="react+senior, python · press Enter to add">' +
          '<div id="li-ac-tags-include" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;"></div>' +
          '<div style="font-size:13px;color:' + BW.muted + ';margin-bottom:5px;">Exclude keywords</div>' +
          '<input id="li-ac-kw-exclude" style="width:100%;padding:7px 8px;border:1px solid ' + BW.border + ';border-radius:4px;background:' + BW.bg + ';color:' + BW.fg + ';font-size:14px;margin-bottom:5px;" placeholder=".net, java, php · press Enter to add">' +
          '<div id="li-ac-tags-exclude" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;"></div>' +
        '</div>' +
        '</div>';
      document.body.appendChild(panel);
      const toggle = panel.querySelector('#li-ac-autoscroll');
      toggle.addEventListener('change', () => {
        cfg.autoScroll = toggle.checked;
        chrome.storage.sync.set({ autoScroll: cfg.autoScroll });
        if (cfg.autoScroll) startAutoScroll(); else stopAutoScroll();
      });
      const ultraToggle = panel.querySelector('#li-ac-ultra-hide');
      ultraToggle.addEventListener('change', () => {
        cfg.ultraHide = ultraToggle.checked;
        chrome.storage.sync.set({ ultraHide: cfg.ultraHide });
        scanFeed();
      });
      const durInput = panel.querySelector('#li-ac-autoscroll-min');
      durInput.addEventListener('change', () => {
        setAutoScrollDurationMin(parseInt(durInput.value, 10));
        durInput.value = autoScrollDurationMin;
        dbg('auto-scroll duration set to', autoScrollDurationMin, 'min');
      });
      durInput.addEventListener('blur', () => {
        // Normalize a stale/invalid value back to the clamped setting.
        setAutoScrollDurationMin(parseInt(durInput.value, 10));
        durInput.value = autoScrollDurationMin;
      });
      const kwIn = panel.querySelector('#li-ac-kw-include');
      const kwEx = panel.querySelector('#li-ac-kw-exclude');
      const split = v => v.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      const merge = (cur, add) => Array.from(new Set(split(add).concat(strArray(cur)))); // newest-first
      function commitKwInputs() {
        cfg.includeKeywords = merge(cfg.includeKeywords, kwIn.value);
        cfg.excludeKeywords = merge(cfg.excludeKeywords, kwEx.value);
        kwIn.value = '';
        kwEx.value = '';
        chrome.storage.sync.set({ includeKeywords: cfg.includeKeywords, excludeKeywords: cfg.excludeKeywords });
        renderTags(panel);
        restoreHidden();
        scanFeed();
      }
      kwIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitKwInputs(); } });
      kwEx.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitKwInputs(); } });
      panel.querySelector('#li-ac-kw-collapse').addEventListener('click', () => toggleKwSection());
      panel.querySelector('#li-ac-panel-min').addEventListener('click', () => togglePanelMinimize());
      applyKwSection(panel);
      applyPanelMinimized(panel);
    }

    // === Found panel (immediately left of the control panel) ===
    if (!foundPanel || !foundPanel.isConnected) {
      foundPanel = document.createElement('div');
      foundPanel.id = 'li-ac-found-panel';
      foundPanel.style.cssText = 'position:fixed;bottom:16px;right:348px;z-index:999999;width:320px;max-height:90vh;display:flex;flex-direction:column;background:' + BW.bg + ';color:' + BW.fg + ';border:1px solid ' + BW.border + ';border-radius:8px;font:15px/1.55 sans-serif;box-shadow:0 2px 14px rgba(0,0,0,.6);';      foundPanel.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid ' + BW.border + ';font-weight:700;font-size:16px;border-radius:8px 8px 0 0;"><span>🔎 Found</span><span style="display:flex;align-items:center;gap:6px;"><button id="li-ac-clear-seen" title="Remove viewed rows from the lists" style="flex:none;padding:3px 8px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;">Clear seen</button><button id="li-ac-found-min" title="Minimize/expand panel" style="flex:none;width:26px;height:26px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:15px;line-height:1;font-weight:700;cursor:pointer;">–</button></span></div>' +
        '<div id="li-ac-found-body" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:' + BW.fg + ';padding:8px 12px;border-bottom:1px solid ' + BW.border + ';">' +
          '<span>🔑 Keyword matches</span>' +
          '<span id="li-ac-kw-sortbar" style="display:flex;gap:4px;">' +
            '<button id="li-ac-kw-sort" title="Sort newest first" style="flex:none;padding:0 7px;height:24px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;">⇅ Newest</button>' +
          '</span>' +
        '</div>' +
        '<div id="li-ac-kw-list" style="flex:1 1 0;min-height:18vh;overflow-y:auto;padding:5px 8px;border-bottom:1px solid ' + BW.border + ';"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:' + BW.fg + ';padding:8px 12px;border-bottom:1px solid ' + BW.border + ';">' +
          '<span>📧 Email matches</span>' +
          '<span id="li-ac-em-sortbar" style="display:flex;gap:4px;">' +
            '<button id="li-ac-em-sort" title="Sort newest first" style="flex:none;padding:0 7px;height:24px;background:' + BW.accentBg + ';color:' + BW.accentFg + ';border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;">⇅ Newest</button>' +
          '</span>' +
        '</div>' +
        '<div id="li-ac-panel-list" style="flex:1 1 0;min-height:18vh;overflow-y:auto;padding:6px 8px;"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:' + BW.fg + ';padding:8px 12px;border-bottom:1px solid ' + BW.border + ';">' +
          '<span>🙈 Hidden posts</span>' +
          '<span id="li-ac-hidden-count" style="color:' + BW.muted + ';font-size:12px;">0</span>' +
        '</div>' +
        '<div id="li-ac-hidden-list" style="flex:1 1 0;min-height:18vh;max-height:35vh;overflow-y:auto;padding:6px 8px;border-bottom:1px solid ' + BW.border + ';"></div>' +
        '</div>';
    document.body.appendChild(foundPanel);
    foundPanel.querySelector('#li-ac-found-min').addEventListener('click', () => toggleFoundPanelMinimize());
    foundPanel.querySelector('#li-ac-clear-seen').addEventListener('click', () => clearSeen());
    applyFoundPanelMinimized(foundPanel);
    positionFoundPanel();
  }

  startTimeRefresh();

  // === Wiring (idempotent) ===
  // Each panel is wired ONCE, marked by __liAcWired on the element. This is
  // robust to: partial close (one panel closed, other open), re-scans while a
  // panel stays open, recreation after LinkedIn detaches the DOM, and
  // cross-test body.innerHTML resets. A panel that is connected but not yet
  // wired gets wired now; a wired panel is never double-wired.
  if (panel && panel.isConnected && !panel.__liAcWired) {
    panel.__liAcWired = true;
    wirePanel(panel);
  }
  if (foundPanel && foundPanel.isConnected && !foundPanel.__liAcWired) {
    foundPanel.__liAcWired = true;
    wirePanel(foundPanel);
    const kwSortBtn = foundPanel.querySelector('#li-ac-kw-sort');
    const emSortBtn = foundPanel.querySelector('#li-ac-em-sort');
    if (kwSortBtn) kwSortBtn.addEventListener('click', () => toggleSort('kw'));
    if (emSortBtn) emSortBtn.addEventListener('click', () => toggleSort('em'));
    applySortButtons(foundPanel);
  }

    // Re-render contents into whichever panels exist.
    if (panel) {
      const toggle = panel.querySelector('#li-ac-autoscroll');
      if (toggle) toggle.checked = !!cfg.autoScroll;
      const ultraToggle = panel.querySelector('#li-ac-ultra-hide');
      if (ultraToggle) ultraToggle.checked = !!cfg.ultraHide;
      renderTags(panel);
      applyKwSection(panel);
      applyPanelMinimized(panel);
    }
    if (foundPanel) {
      const kwList = foundPanel.querySelector('#li-ac-kw-list');
      const kwSorted = sortedHits('kw');
      // Hide the section's sort/↑/↓ bar when its hit list is empty.
      setSectionBarVisible('kw', kwSorted.length > 0);
      if (!kwSorted.length) {
        kwList.innerHTML = '<div style="color:' + BW.muted + ';padding:6px 8px;font-size:13px;">No keyword matches</div>';
        kwList.style.minHeight = '0';
      } else {
        kwList.innerHTML = kwSorted.map((hit, i) => hitRowHtml(hit, i, 'kw')).join('');
        kwList.style.minHeight = '18vh';
      }
      const list = foundPanel.querySelector('#li-ac-panel-list');
      const emSorted = sortedHits('em');
      // Hide the section's sort/↑/↓ bar when its hit list is empty.
      setSectionBarVisible('em', emSorted.length > 0);
      if (!emSorted.length) {
        list.innerHTML = '<div style="color:' + BW.muted + ';padding:8px;font-size:13px;">No email matches</div>';
        list.style.minHeight = '0';
      } else {
        list.innerHTML = emSorted.map((hit, i) => hitRowHtml(hit, i, 'em')).join('');
        list.style.minHeight = '18vh';
      }

      // Hidden list: one unified list in feed order — exclude-hidden posts
      // (Show to reveal) plus posts the user explicitly revealed (Hide).
      // Rows keep their position when toggled; only the button flips.
      const hiddenList = foundPanel.querySelector('#li-ac-hidden-list');
      const hiddenCountEl = foundPanel.querySelector('#li-ac-hidden-count');
      if (hiddenList) {
        const hiddenKeys = new Set(getHiddenPosts().map(postKey));
        const rows = [];
        // All feed posts in DOM order (hidden ones included — getPosts()
        // filters .li-ac-hidden out, so query the h2 markers directly).
        Array.prototype.slice.call(document.querySelectorAll('h2'))
          .filter(h => FEED_MARKERS.includes((h.textContent || '').trim().toLowerCase()))
          .map(h => h.parentElement)
          .filter(Boolean)
          .forEach(p => {
            const key = postKey(p);
            if (hiddenKeys.has(key) || revealedHiddenKeys.has(key)) {
              rows.push(hiddenRowHtml(p, rows.length, revealedHiddenKeys.has(key)));
            }
          });
        hiddenList.innerHTML = rows.length
          ? rows.join('')
          : '<div style="color:' + BW.muted + ';padding:6px 8px;font-size:12px;">No hidden posts</div>';
        hiddenList.style.minHeight = rows.length ? '18vh' : '0';
        if (hiddenCountEl) hiddenCountEl.textContent = rows.length;
      }
      applyFoundPanelMinimized(foundPanel);
      applySortButtons(foundPanel);
    }
    positionFoundPanel();

    // Auto-scroll: when enabled, jump to a NEWLY discovered email/keyword post.
    // IMPORTANT: only acquire the 'hit' lock when there is actually something
    // to jump to. Acquiring it on every scan (even with nothing new) would hold
    // the viewport lock permanently and starve the continuous auto-scroll
    // interval (MutationObserver re-scans run constantly on LinkedIn).
    // Also: auto-scroll only ever advances DOWN — we never scroll up to a hit
    // that's already above the viewport (that's what caused the "scrolls
    // upward" jumps).
    if (cfg.autoScroll) {
      // Find the first hit that carries at least one email we haven't centered on.
      let jumpTarget = null;
      let freshEmails = [];
      for (let i = 0; i < hits.length; i++) {
        const un = hits[i].emails.filter(e => !knownEmails.has(e));
        if (un.length) { jumpTarget = hits[i].el; freshEmails = un; break; }
      }
      let keywordTarget = null;
      if (!jumpTarget && !hits.length && kwPanelData.length) {
        // Keyword-only hit (no emails): center once per keyword post.
        const unseen = kwPanelData.find(h => !knownKeywordKeys.has(h.key));
        if (unseen) { keywordTarget = unseen.el; }
      }
      const target = jumpTarget || keywordTarget;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        // Only scroll if the target is BELOW the current viewport bottom —
        // never scroll up to re-center something already above. The lock is
        // acquired ONLY when we actually jump, so phantom targets (whose keys
        // change on re-render) can't hold the lock and starve the interval.
        const belowViewport = r.top > window.innerHeight;
        if (belowViewport && scrollLock.acquire('hit', SCROLL_LOCK_MS.hit)) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        freshEmails.forEach(e => knownEmails.add(e));
        if (keywordTarget) knownKeywordKeys.add(kwPanelData.find(h => h.el === keywordTarget).key);
        if (freshEmails.length) dbg('auto-jumped to', freshEmails.join(', '));
      }
    }

    // URL gate: blur both panels with a centered notice on non-Search/Feed pages.
    applyGateOverlays();
  }

  let scanTimer = null;
  function scanFeed() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (!isAllowedUrl()) { renderGatedPanels(); return; } // URL gate
      let posts = getPosts();
      if (!posts.length) { dbg('scanFeed: no posts'); return; }
      clearKeywordHighlights();
      expandPosts(posts);
      posts = getPosts(); // re-grab after expansion
      filterPosts(posts);
      posts = getPosts(); // re-grab after filtering (hidden posts excluded)
      const kwHits = scanKeywords(posts);
      const emHits = cfg.scanEmails ? scanEmails(posts) : [];
      // A post that matches keywords AND yields an email is shown only under
      // Emails found — never duplicated under Keywords found.
      const emKeys = new Set(emHits.map(h => h.key));
      const kwFiltered = kwHits.filter(h => !emKeys.has(h.key));
      renderPanel(emHits, kwFiltered);
      // Ultra Hide: collapse every post except keyword/email matches.
      applyUltraHide(kwFiltered, emHits);
      // Green marker on posts removed via "Clear seen" (survives re-renders).
      applyViewedBorders(posts);
    }, 400);
  }

  // === Auto-scroll: keep scrolling the feed down while enabled ===
  let autoScrollTimer = null;
  function getScroller() {
    // LinkedIn scrolls <main>, but document-level scrollers can also report
    // overflow. Pick whichever candidate has the largest scrollable delta so we
    // always scroll the real container.
    const candidates = [document.querySelector('main'), document.scrollingElement, document.documentElement, document.body];
    let best = null, bestDelta = 0;
    for (const el of candidates) {
      if (!el) continue;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta > bestDelta) { bestDelta = delta; best = el; }
    }
    if (best && bestDelta > 50) return best;
    return document.scrollingElement || document.documentElement;
  }

  // === Scroll mutex (threading): only ONE actor moves the viewport at a time ===
  // Actors: 'autoscroll' (continuous interval, lowest priority),
  //         'hit'       (auto-jump to a newly found email/keyword),
  //         'click'     (user clicked a panel entry, highest priority).
  // A lower-priority actor cannot preempt a higher-priority one; the interval
  // simply skips its tick while a hit/click holds the lock. The lock also has a
  // hold duration so smooth scrollIntoView completes before anyone else moves.
  const SCROLL_LOCK_MS = { autoscroll: 2500, hit: 4000, click: 5000 };
  const scrollLock = {
    owner: null,
    heldUntil: 0,
    timer: null,
    acquire(owner, holdMs) {
      const now = Date.now();
      if (this.owner && this.owner !== owner && now < this.heldUntil) {
        // Only allow a higher-priority owner to preempt a lower one.
        if (this.priority(this.owner) >= this.priority(owner)) return false;
      }
      this.owner = owner;
      this.heldUntil = now + holdMs;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (this.owner === owner) { this.owner = null; this.heldUntil = 0; } }, holdMs);
      return true;
    },
    release(owner) {
      if (this.owner !== owner) return;
      this.owner = null;
      this.heldUntil = 0;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    },
    isHeldBy(owner) { return this.owner === owner; },
    isHeld() { return !!this.owner && Date.now() < this.heldUntil; },
    priority(o) { return o === 'click' ? 3 : o === 'hit' ? 2 : 1; },
    reset() { this.owner = null; this.heldUntil = 0; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  };

  // === Auto-scroll: keep scrolling the feed down while enabled ===
  // Optional auto-stop after N minutes (0 = unlimited). Persisted separately so
  // a fresh run re-applies it without clobbering the on/off toggle.
  let autoScrollDurationMin = 0;
  let autoScrollStopTimer = null;

  function getAutoScrollDurationMin() { return autoScrollDurationMin; }
  function setAutoScrollDurationMin(v) {
    autoScrollDurationMin = Math.max(0, Math.floor(Number(v) || 0));
    chrome.storage.sync.set({ autoScrollDurationMin });
    if (cfg.autoScroll) startAutoScroll(); // restart to re-arm the stop timer
    return autoScrollDurationMin;
  }

  function startAutoScroll() {
    stopAutoScroll();
    if (autoScrollDurationMin > 0) {
      // Auto-stop after the configured duration.
      autoScrollStopTimer = setTimeout(() => {
        dbg('auto-scroll reached ' + autoScrollDurationMin + ' min; stopping');
        stopAutoScroll();
        cfg.autoScroll = false;
        chrome.storage.sync.set({ autoScroll: false });
        if (panel) {
          const toggle = panel.querySelector('#li-ac-autoscroll');
          if (toggle) toggle.checked = false;
        }
      }, autoScrollDurationMin * 60000);
    }
    autoScrollTimer = setInterval(() => {
      // Only scroll when a real feed is present. This script also runs on
      // profile/messaging/etc. pages, where scrolling is unwanted.
      if (!getPosts().length) { dbg('auto-scroll: no feed on this page; skipping'); return; }
      // Skip the tick while a hit/click owns the viewport (no fighting).
      if (!scrollLock.acquire('autoscroll', SCROLL_LOCK_MS.autoscroll)) return;
      const scroller = getScroller();
      scroller.scrollTop += window.innerHeight * 0.8;
      scanFeed();
    }, 2500);
  }
  function stopAutoScroll() {
    if (autoScrollTimer) { clearInterval(autoScrollTimer); autoScrollTimer = null; }
    if (autoScrollStopTimer) { clearTimeout(autoScrollStopTimer); autoScrollStopTimer = null; }
    scrollLock.release('autoscroll');
  }

  // Turn auto-scroll OFF permanently (used when the user clicks a panel result
  // to inspect it — otherwise the interval would resume and scroll away after
  // the click lock expires). Persists the change and syncs the panel toggle.
  function disableAutoScroll() {
    cfg.autoScroll = false;
    stopAutoScroll();
    scrollLock.reset();
    chrome.storage.sync.set({ autoScroll: false });
    if (panel) {
      const toggle = panel.querySelector('#li-ac-autoscroll');
      if (toggle) toggle.checked = false;
    }
    dbg('auto-scroll disabled by panel click');
  }

  // === Panel time-ago refresh (updates "Xs ago" labels in place) ===
  let timeRefreshTimer = null;
  function startTimeRefresh() {
    stopTimeRefresh();
    timeRefreshTimer = setInterval(() => {
      const panelEl = document.getElementById('li-ac-panel');
      const foundEl = document.getElementById('li-ac-found-panel');
      if (!panelEl && !foundEl) { stopTimeRefresh(); return; }
      const roots = [panelEl, foundEl].filter(Boolean);
      roots.forEach(root => {
        root.querySelectorAll('[data-key]').forEach(row => {
          const kind = row.getAttribute('data-kind');
          const key = row.getAttribute('data-key');
          const meta = hitMeta.get(kind + ':' + key);
          if (!meta) return;
          let t = row.querySelector('[data-ago]');
          if (!t) return;
          t.textContent = timeAgo(meta.firstSeen);
        });
      });
    }, 10000);
  }
  function stopTimeRefresh() {
    if (timeRefreshTimer) { clearInterval(timeRefreshTimer); timeRefreshTimer = null; }
  }

  // MutationObserver for feed changes
  let feedObserver = null;
  function startFeedObserver() {
    if (feedObserver) feedObserver.disconnect();
    feedObserver = new MutationObserver(mutations => {
      // Ignore mutations caused by our own UI (panel/style/badge) to avoid churn.
      const own = mutations.every(m => {
        // Removals/additions of our own top-level nodes (panel close, style,
        // badge) target document.body — catch them by node id too (M1).
        const nodes = [];
        if (m.addedNodes && m.addedNodes.length) nodes.push.apply(nodes, m.addedNodes);
        if (m.removedNodes && m.removedNodes.length) nodes.push.apply(nodes, m.removedNodes);
        for (const n of nodes) {
          if (n && n.nodeType === 1 && n.id && /^li-ac-/.test(n.id)) return true;
        }
        const t = m.target;
        const node = t && t.nodeType === 3 ? t.parentElement : t;
        if (!node || node.nodeType !== 1) return false;
        return !!(node.closest && node.closest('#li-ac-panel, #li-ac-found-panel, #li-ac-styles, #li-ac-badge'));
      });
      if (own) return;
      scanFeed();
    });
    feedObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // === Message handler ===
  onMessageListener = (msg, sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ alive: true }); return true; }
    if (msg.type === 'SCAN') {
      if (!isAllowedUrl()) { sendResponse({ count: 0 }); return true; } // URL gate
      const count = scanButtons();
      if (count > 0) {
        createBadge();
        highlightAll();
        document.getElementById('li-ac-count').innerHTML = 'Found: <b>' + count + '</b> buttons highlighted';
        sendResponse({ count });
      } else {
        log('No Connect buttons found on this page.');
        sendResponse({ count: 0 });
      }
      return true;
    }
    if (msg.type === 'START') {
      if (!isAllowedUrl()) { sendResponse({ ok: false }); return true; } // URL gate
      if (isRunning) { sendResponse({ ok: true }); return true; } // H1: coalesce repeat STARTs
      if (Number.isFinite(msg.delayMin)) delayMin = Math.max(0, msg.delayMin); // M6 clamp
      if (Number.isFinite(msg.delayMax)) delayMax = Math.max(delayMin, msg.delayMax); // M6
      if (connectQueue.length === 0) scanButtons();
      if (connectQueue.length === 0) { log('Nothing to connect. Click Search first.'); sendResponse({ ok: false }); return true; }
      isRunning = true;
      createBadge();
      updateBadge();
      processNext();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'STOP') {
      isRunning = false;
      stopAutoScroll();
      updateBadge();
      sendResponse({ ok: true });
    }
    if (msg.type === 'STATUS') {
      sendResponse({ connected, skipped, running: isRunning, total: connectQueue.length });
    }
    if (msg.type === 'RESET') {
      connected = 0; skipped = 0; isRunning = false;
      stopAutoScroll();
      stopTimeRefresh();
      cfg.autoScroll = false;
      cfg.ultraHide = false;
      scrollLock.reset(); // free the viewport lock
      knownEmails.clear(); // forget jumped-to emails so they can be re-centered
      knownKeywordKeys.clear();
      resetHitMeta(); // forget viewed/firstSeen
      if (scanTimer) clearTimeout(scanTimer); // L4: don't let a pending scan re-hide
      teardownPage(); // LEAK #1/#2: stop the scroll-pin interval + remove its window listeners
      chrome.storage.sync.set({ autoScroll: false, ultraHide: false });
      removeBadge();
      if (panel) { panel.remove(); panel = null; } // full reset clears the panel UI
      if (foundPanel) { foundPanel.remove(); foundPanel = null; }
      document.querySelectorAll('.li-ac-hl').forEach(el => { el.style.outline = ''; el.style.boxShadow = ''; el.classList.remove('li-ac-hl'); });
      clearKeywordHighlights();
      restoreHidden();
      // Clear Ultra Hide collapse classes too.
      document.querySelectorAll('.' + ULTRA_CLS).forEach(el => el.classList.remove(ULTRA_CLS));
      document.querySelectorAll('.' + ULTRA_CARD_CLS).forEach(el => el.classList.remove(ULTRA_CARD_CLS));
      // Clear "Clear seen" feed markers (resetHitMeta already cleared the keys).
      document.querySelectorAll('.' + VIEWED_CLS).forEach(el => el.classList.remove(VIEWED_CLS));
      connectQueue = [];
      sendResponse({ ok: true });
    }
    if (msg.type === 'FEED_SCAN') {
      scanFeed();
      sendResponse({ ok: true });
    }
    if (msg.type === 'ADD_KEYWORD_CONTEXT') {
      // Sent by the background script when the user picks the context-menu item.
      const added = isAllowedUrl() ? addRightClickedTo(msg.kind === 'exclude' ? 'exclude' : 'include') : 0; // URL gate
      sendResponse({ ok: true, added });
      return true;
    }
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessageListener);

  // === Teardown (LEAK #1/#2/#4/#6/#7) ===
  // teardownPage(): session timers + window listeners. Called from RESET (RESET
  // fully disables the run but must NOT remove chrome/document listeners, which
  // the extension needs for the rest of the session) and from beforeunload.
  // teardownListeners(): chrome.* / document listeners — removed only on unload.
  function teardownPage() {
    if (releaseFn) releaseFn(); // clears resetTimer + removes the 5 window listeners
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    stopAutoScroll();
    stopTimeRefresh();
    scrollLock.reset();
    if (feedObserver) { feedObserver.disconnect(); }
  }
  function teardownListeners() {
    if (onMessageListener && chrome.runtime && chrome.runtime.onMessage && typeof chrome.runtime.onMessage.removeListener === 'function') {
      chrome.runtime.onMessage.removeListener(onMessageListener);
    }
    if (onChangedListener && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.removeListener === 'function') {
      chrome.storage.onChanged.removeListener(onChangedListener);
    }
    if (contextmenuListener) document.removeEventListener('contextmenu', contextmenuListener, true);
    stopUrlGateMonitor();
    window.removeEventListener('beforeunload', onUnload);
    window.removeEventListener('pagehide', onUnload);
  }
  function onUnload() {
    teardownPage();
    teardownListeners();
  }
  // Register the unload teardown exactly once per instance (page lifecycle only;
  // never on RESET so the extension keeps handling messages after a reset).
  if (typeof window !== 'undefined' && !teardownBound) {
    teardownBound = true;
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
  }

  // === Load config + init ===
  chrome.storage.sync.get(
    { autoExpand: true, scanEmails: true, includeKeywords: [], excludeKeywords: [], autoScroll: false, ultraHide: false, debug: true, kwSectionCollapsed: false, autoScrollDurationMin: 0, panelMinimized: false, foundPanelMinimized: false },
    opts => {
      cfg = opts;
      kwSectionCollapsed = !!opts.kwSectionCollapsed;
      panelMinimized = !!opts.panelMinimized;
      foundPanelMinimized = !!opts.foundPanelMinimized;
      autoScrollDurationMin = Math.max(0, Math.floor(Number(opts.autoScrollDurationMin) || 0));
      // Don't let the browser/LinkedIn restore a previous scroll position on load;
      // start at top unless auto-scroll is explicitly enabled. Unlike a fixed
      // timeout, this keeps pinning while the feed is still growing, and releases
      // the moment the user scrolls deliberately.
      try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
      if (!cfg.autoScroll && isAllowedUrl()) {
        // Scroll-pin: pin the viewport to the top while the feed loads, then
        // release on deliberate user scroll or once the feed stabilizes.
        // Handles are stored on the module-scoped winListeners object + releaseFn
        // so teardownPage() (RESET + beforeunload) can remove them (LEAK #1/#2).
        winListeners.released = false;
        releaseFn = function releasePin() {
          if (winListeners.released) return;
          winListeners.released = true;
          if (winListeners.resetTimer) { clearInterval(winListeners.resetTimer); winListeners.resetTimer = null; }
          const us = winListeners.onUserScroll;
          if (us) {
            window.removeEventListener('wheel', us, true);
            window.removeEventListener('touchstart', us, true);
            window.removeEventListener('pointerdown', us, true);
          }
          if (winListeners.onKeyScroll) window.removeEventListener('keydown', winListeners.onKeyScroll, true);
          if (winListeners.onScroll) window.removeEventListener('scroll', winListeners.onScroll, true);
        };
        const els = () => [document.querySelector('main'), document.scrollingElement, document.documentElement, document.body];
        const resetAll = () => {
          if (cfg.autoScroll) { releaseFn(); return; } // M3: toggling auto-scroll on hands over control
          els().forEach(el => { if (el && el.scrollTop !== 0) el.scrollTop = 0; });
        };
        resetAll();
        // Any deliberate user scroll (wheel, touch, click, scroll keys) hands control back.
        winListeners.onUserScroll = () => releaseFn();
        winListeners.onKeyScroll = e => {
          if (e.target && e.target.matches && e.target.matches('input, textarea')) return; // M3: typing in panel inputs
          if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) releaseFn();
        };
        winListeners.onScroll = () => { if (!winListeners.released) resetAll(); };
        window.addEventListener('scroll', winListeners.onScroll, true);
        window.addEventListener('wheel', winListeners.onUserScroll, true);
        window.addEventListener('touchstart', winListeners.onUserScroll, true);
        window.addEventListener('pointerdown', winListeners.onUserScroll, true);
        window.addEventListener('keydown', winListeners.onKeyScroll, true);
        let lastHeight = 0, stableTicks = 0;
        winListeners.resetTimer = setInterval(() => {
          resetAll();
          // Release once the feed stops growing for ~6s (content finished loading).
          const h = (document.querySelector('main') || document.documentElement).scrollHeight || 0;
          if (h === lastHeight) {
            if (++stableTicks > 12) releaseFn(); // ~6s stable
          } else { stableTicks = 0; lastHeight = h; }
          if (winListeners.released) {
            if (winListeners.resetTimer) { clearInterval(winListeners.resetTimer); winListeners.resetTimer = null; }
          }
        }, 500);
      }
      startFeedObserver();
      injectStyles();
      if (isAllowedUrl()) {
        scanFeed();
        if (cfg.autoScroll) startAutoScroll();
      } else {
        renderGatedPanels(); // URL gate: show blurred notice panels immediately
      }
      startUrlGateMonitor(); // SPA nav: re-evaluate on popstate + every 2s
    }
  );

  onChangedListener = (changes, area) => {
    if (area !== 'sync') return;
    ['autoExpand', 'scanEmails', 'includeKeywords', 'excludeKeywords', 'autoScroll', 'debug', 'kwSectionCollapsed', 'autoScrollDurationMin'].forEach(k => {
      // H3: a removed key reports {oldValue} with no newValue — don't write
      // undefined, which would crash .length/.forEach callers later.
      if (changes[k] && changes[k].newValue !== undefined) cfg[k] = changes[k].newValue;
    });
    if (changes.kwSectionCollapsed) {
      kwSectionCollapsed = !!changes.kwSectionCollapsed.newValue;
      if (panel) applyKwSection(panel);
    }
    if (changes.panelMinimized) {
      panelMinimized = !!changes.panelMinimized.newValue;
      if (panel) applyPanelMinimized(panel);
    }
    if (changes.foundPanelMinimized) {
      foundPanelMinimized = !!changes.foundPanelMinimized.newValue;
      if (foundPanel) applyFoundPanelMinimized(foundPanel);
    }
    if (changes.autoScrollDurationMin) {
      autoScrollDurationMin = Math.max(0, Math.floor(Number(changes.autoScrollDurationMin.newValue) || 0));
      if (panel) {
        const durInput = panel.querySelector('#li-ac-autoscroll-min');
        if (durInput) durInput.value = autoScrollDurationMin;
      }
    }
    // H3: guarantee array shapes even if storage held a non-array / was cleared.
    cfg.includeKeywords = strArray(cfg.includeKeywords);
    cfg.excludeKeywords = strArray(cfg.excludeKeywords);
    if (changes.autoScroll) {
      if (panel) {
        const toggle = panel.querySelector('#li-ac-autoscroll');
        if (toggle) toggle.checked = !!cfg.autoScroll;
      }
      if (cfg.autoScroll) startAutoScroll(); else stopAutoScroll();
    }
    if (changes.ultraHide) {
      if (panel) {
        const ultraToggle = panel.querySelector('#li-ac-ultra-hide');
        if (ultraToggle) ultraToggle.checked = !!cfg.ultraHide;
      }
    }
    if (changes.includeKeywords || changes.excludeKeywords) {
      restoreHidden(); // posts no longer matching come back, then re-filter
    }
    // L4: only re-scan when a field that affects scanning actually changed,
    // otherwise an unrelated storage write (e.g. debug) needlessly re-scans.
    const scanKeys = ['autoScroll', 'ultraHide', 'includeKeywords', 'excludeKeywords', 'autoExpand', 'scanEmails'];
    if (scanKeys.some(k => changes[k])) scanFeed();
  };
  chrome.storage.onChanged.addListener(onChangedListener);

  // === Test-only surface ===
  // Content scripts run in an isolated world, so attaching this to globalThis
  // never leaks into the page and has zero effect on production behavior.
  const testSurface = {
    kwMatch, kwParts, esc, wordMatch, EMAIL_RE,
    getPosts, filterPosts, scanEmails, scanKeywords, expandPosts, scanButtons,
    restoreHidden, getHiddenCount, getHiddenPosts, clearKeywordHighlights, injectStyles,
    revealHiddenPost, rehidePost, getRevealedHiddenKeys: () => revealedHiddenKeys,
    applyUltraHide,
    startFeedObserver, getScroller, renderTags, removeKeyword, escHtml,
    extractKeywordsFromPost, addRightClickedTo, captureRightClick,
    startAutoScroll, stopAutoScroll, disableAutoScroll, scrollLock,
    getAutoScrollDurationMin, setAutoScrollDurationMin,
    knownEmailsAdd: e => knownEmails.add(e),
    knownEmailsClear: () => knownEmails.clear(),
    knownKeywordKeysAdd: k => knownKeywordKeys.add(k),
    knownKeywordKeysClear: () => knownKeywordKeys.clear(),
    isAllowedUrl, refreshUrlGate, applyGateOverlays,
    startUrlGateMonitor, stopUrlGateMonitor, stopTimeRefresh, startTimeRefresh,
    timeAgo, postKey, markViewed, resetHitMeta, clearSeen, applyViewedBorders,
    postBodyText,
    sortedHits, sortNewest, setSectionBarVisible, getKwSectionCollapsed, setKwSectionCollapsed, toggleKwSection,
    getPanelMinimized, setPanelMinimized, togglePanelMinimize,
    getFoundPanelMinimized, setFoundPanelMinimized, toggleFoundPanelMinimize,
    hitMeta: () => hitMeta,
    getPanel: () => document.getElementById('li-ac-panel'),
    getFoundPanel: () => document.getElementById('li-ac-found-panel'),
    getCfg: () => cfg,
    setCfg: o => { cfg = Object.assign({}, cfg, o); },
    getCounts: () => ({ connected, skipped, failed }),
    // teardownPage() is a superset of the previous manual cleanup (stops
    // auto-scroll/time-refresh, resets scrollLock, clears scanTimer, disconnects
    // the feed observer) and additionally tears down the scroll-pin interval +
    // its window listeners so tests stop leaking OpenHandles / timer handles.
    cleanup: () => { teardownPage(); }
  };
  if (typeof globalThis !== 'undefined') {
    globalThis.__LI_AC_TEST__ = testSurface;
  } else if (typeof self !== 'undefined') {
    self.__LI_AC_TEST__ = testSurface;
  }
})();
