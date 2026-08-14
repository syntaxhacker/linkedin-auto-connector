'use strict';

/**
 * URL gate (user requirement):
 *   - the extension only WORKS on https://www.linkedin.com/search/* and
 *     https://www.linkedin.com/feed/* (for now);
 *   - on any other page BOTH floating panels are shown BLURRED (backdrop-filter
 *     overlay) with a centered info message instead of scanning;
 *   - message handlers respond gracefully on non-matching pages.
 *
 * jest.setup.js runs every suite at the testEnvironmentOptions URL
 * https://www.linkedin.com/search/, so the default test URL is a MATCHING page.
 * Tests that need a non-matching page temporarily override window.location
 * (delete + assign, restore via Object.defineProperty — the jsdom-safe pattern).
 */

const { makePost, sendMessage, resetState, closePanels } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

const NOTICE = 'Works only on LinkedIn Search & Feed pages';

// jsdom-safe location override: returns the previous location for restore.
function setLocation(url) {
  const orig = window.location;
  delete window.location;
  window.location = new URL(url);
  return orig;
}
function restoreLocation(orig) {
  Object.defineProperty(window, 'location', { value: orig, configurable: true });
}

describe('isAllowedUrl', () => {
  test('true for LinkedIn search pages', () => {
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/search'))).toBe(true);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/search/'))).toBe(true);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/search/results/people/'))).toBe(true);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/search/results/content/?keywords=react'))).toBe(true);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/feed'))).toBe(true);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/feed/'))).toBe(true);
  });

  test('true for company people pages (Invite to connect, Pattern B)', () => {
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/company/singleinterface/people/'))).toBe(true);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/company/acme/people'))).toBe(true);
  });

  test('false for company pages that are NOT the people directory', () => {
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/company/singleinterface/'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/company/singleinterface/people/extra/'))).toBe(false);
  });

  test('false for every other LinkedIn page and non-LinkedIn hosts', () => {
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/in/johndoe'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/jobs/'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/messaging/'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('https://www.linkedin.com/feed2/'))).toBe(false); // not a feed path
    expect(global.__LI.isAllowedUrl(new URL('https://example.com/search/'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('http://localhost/'))).toBe(false);
    expect(global.__LI.isAllowedUrl(new URL('https://evil-linkedin.com/search/'))).toBe(false); // host suffix must be real
  });
});

describe('URL gate rendering + handlers', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    // Make sure we never leak a gated location into the next test.
    if (!window.location.href.startsWith('https://www.linkedin.com/search/')) {
      Object.defineProperty(window, 'location', { value: new URL('https://www.linkedin.com/search/'), configurable: true });
    }
    global.__LI.cleanup();
  });

  test('matched URL renders normal panels without a gate overlay', async () => {
    jest.useFakeTimers();
    makePost('React dev email bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(found).not.toBeNull();
    expect(panel.querySelector('.li-ac-gate-overlay')).toBeNull();
    expect(found.querySelector('.li-ac-gate-overlay')).toBeNull();
    // Hits are rendered normally.
    expect(document.getElementById('li-ac-panel-list').textContent).toContain('bob@example.com');
  });

  test('non-matching URL: BOTH panels show the blurred centered notice', async () => {
    jest.useFakeTimers();
    const orig = setLocation('https://www.linkedin.com/jobs/');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(found).not.toBeNull();
    [panel, found].forEach(p => {
      const ov = p.querySelector('.li-ac-gate-overlay');
      expect(ov).not.toBeNull();
      expect(ov.textContent).toContain(NOTICE);
      expect(ov.textContent).toContain('linkedin.com/search');
      // Centered overlay: flex + full-area positioning.
      expect(ov.style.display).toBe('flex');
      expect(ov.style.position).toBe('absolute');
      expect(ov.style.background).toMatch(/rgba/);
      // (backdrop-filter blur is added in production cssText; jsdom drops
      // the property so it cannot be asserted here — visible in Chrome.)
    });
    // No scanning happened: lists empty, no highlighted/hidden posts.
    expect(document.getElementById('li-ac-panel-list').textContent).toContain('No email matches');

    restoreLocation(orig);
  });

  test('non-matching URL: message handlers respond gracefully', async () => {
    jest.useFakeTimers();
    const orig = setLocation('https://www.linkedin.com/in/someone');

    const scan = sendMessage({ type: 'SCAN' });
    expect(scan.response).toEqual({ count: 0 });

    const start = sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    expect(start.response).toEqual({ ok: false });

    const ping = sendMessage({ type: 'PING' });
    expect(ping.response).toEqual({ alive: true });

    const ctx = sendMessage({ type: 'ADD_KEYWORD_CONTEXT', kind: 'include' });
    expect(ctx.response).toEqual({ ok: true, added: 0 });

    restoreLocation(orig);
  });

  test('minimize still works while gated (no close button, collapses to bubble)', async () => {
    jest.useFakeTimers();
    const orig = setLocation('https://www.linkedin.com/jobs/');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    expect(found).not.toBeNull();
    expect(found.querySelector('#li-ac-found-close')).toBeNull();
    found.querySelector('#li-ac-found-min').click();
    expect(found.style.display).toBe('none'); // panel hidden -> bubble shown
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
    expect(document.getElementById('li-ac-panel')).not.toBeNull();

    restoreLocation(orig);
  });

  test('gate overlay is repositioned after a collapsed re-render so minimize stays clickable', async () => {
    jest.useFakeTimers();
    // A prior test may have left panels minimized (both flags stay in sync);
    // reset so our panel-min click actually collapses.
    global.__LI.setPanelMinimized(false);
    global.__LI.setFoundPanelMinimized(false);
    const orig = setLocation('https://www.linkedin.com/in/patelshivali/');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.li-ac-gate-overlay')).not.toBeNull();

    // Collapse both panels; while display:none the header offsetHeight is 0.
    panel.querySelector('#li-ac-panel-min').click();
    expect(panel.style.display).toBe('none');

    // A gate re-render (URL monitor / refreshUrlGate) recreates/repositions the
    // overlay. Regression: the overlay top must be recomputed to the header
    // height on this pass, not left at 0px from a collapsed measurement.
    global.__LI.refreshUrlGate();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const ovWhileCollapsed = panel.querySelector('.li-ac-gate-overlay');
    expect(ovWhileCollapsed).not.toBeNull();

    // Expand back: the overlay must now sit BELOW the header (top == header
    // height), so the minimize button is not covered.
    document.getElementById('li-ac-bubble').click();
    await jest.advanceTimersByTimeAsync(400);

    const ov = panel.querySelector('.li-ac-gate-overlay');
    expect(ov).not.toBeNull();
    // Overlay top is recomputed on every pass to track the header (not frozen
    // at the 0px it measured while collapsed). jsdom has no layout, so compare
    // to the current header offsetHeight value rather than a fixed px number.
    expect(ov.style.top).toBe(panel.firstElementChild.offsetHeight + 'px');
    // The overlay must never swallow clicks: pointer-events:none so the header
    // minimize button stays reachable even if the overlay is momentarily over it.
    expect(ov.style.pointerEvents).toBe('none');

    restoreLocation(orig);
  });

  test('refreshUrlGate toggles: gated -> blurred notice, back to matching -> normal', async () => {
    jest.useFakeTimers();
    makePost('React role alice@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel').querySelector('.li-ac-gate-overlay')).toBeNull();

    // Navigate (SPA-style) to a non-matching page and re-evaluate the gate.
    const orig = setLocation('https://www.linkedin.com/jobs/');
    global.__LI.refreshUrlGate();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel').querySelector('.li-ac-gate-overlay')).not.toBeNull();
    expect(document.getElementById('li-ac-found-panel').querySelector('.li-ac-gate-overlay')).not.toBeNull();

    // Navigate back to a matching page: notice is removed, scanning resumes.
    restoreLocation(orig);
    global.__LI.refreshUrlGate();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel').querySelector('.li-ac-gate-overlay')).toBeNull();
    expect(document.getElementById('li-ac-found-panel').querySelector('.li-ac-gate-overlay')).toBeNull();
  });
});

describe('URL gate lifecycle: auto-scroll, time refresh, gate monitor', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    // Make sure we never leak a gated location into the next test.
    if (!window.location.href.startsWith('https://www.linkedin.com/search/')) {
      Object.defineProperty(window, 'location', { value: new URL('https://www.linkedin.com/search/'), configurable: true });
    }
    global.__LI.cleanup();
  });

  test('auto-scroll restarts when returning to an allowed URL after being gated', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ ...DEFAULTS, autoScroll: true });
    makePost('a normal post'); // feed present so the auto-scroll interval can tick

    // Gate the page: refreshUrlGate -> renderGatedPanels must stop auto-scroll.
    const orig = setLocation('https://www.linkedin.com/jobs/');
    global.__LI.refreshUrlGate();
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBe(0); // stopped while gated

    // Back to Search/Feed: refreshUrlGate must restart auto-scroll (cfg on).
    restoreLocation(orig);
    global.__LI.refreshUrlGate();
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBeGreaterThan(0); // interval is scrolling again
  });

  test('renderGatedPanels stops the time-refresh interval (no time-ago updates while gated)', async () => {
    jest.useFakeTimers();
    // Scan on an allowed page: a hit row renders with a live "Xs ago" label
    // (renderPanel arms the 10s time-refresh interval).
    makePost('contact bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const row = document.querySelector('[data-ago]');
    expect(row).not.toBeNull();
    const before = row.textContent;
    await jest.advanceTimersByTimeAsync(10000);
    expect(document.querySelector('[data-ago]').textContent).not.toBe(before); // interval is live

    // Gate the page: the notice render must not keep refreshing time labels.
    const orig = setLocation('https://www.linkedin.com/jobs/');
    global.__LI.refreshUrlGate();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.querySelectorAll('[data-ago]').length).toBe(0); // gated render wiped the rows
    expect(document.getElementById('li-ac-panel').querySelector('.li-ac-gate-overlay')).not.toBeNull();

    // Well past a tick while gated: no time-ago rows resurrect, no errors.
    await jest.advanceTimersByTimeAsync(30000);
    expect(document.querySelectorAll('[data-ago]').length).toBe(0);

    restoreLocation(orig);
  });

  test('stopTimeRefresh freezes time-ago labels until startTimeRefresh is called again', async () => {
    jest.useFakeTimers();
    makePost('contact bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const row = document.querySelector('[data-ago]');
    expect(row).not.toBeNull();

    global.__LI.stopTimeRefresh();
    const frozen = row.textContent;
    await jest.advanceTimersByTimeAsync(30000);
    expect(row.textContent).toBe(frozen); // interval cancelled -> label frozen

    global.__LI.startTimeRefresh();
    await jest.advanceTimersByTimeAsync(10000);
    expect(row.textContent).not.toBe(frozen); // restarted -> ticks again
  });

  test('URL gate monitor keeps running when panels are detached (no close button)', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ ...DEFAULTS, autoScroll: true });
    makePost('a normal post'); // feed present so a live monitor would restart auto-scroll
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    // Monitor live: its 2s tick notices the SPA navigation to a gated page.
    global.__LI.startUrlGateMonitor();
    const orig = setLocation('https://www.linkedin.com/jobs/');
    await jest.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.li-ac-gate-overlay')).not.toBeNull();

    // Detach both panels (there is no close button). The monitor must keep
    // running — the close handlers that used to stop it are gone.
    closePanels();
    await jest.advanceTimersByTimeAsync(2000);

    // Return to Search/Feed: with the monitor still live, refreshUrlGate runs
    // and auto-scroll restarts (scrolls down — the opposite of "stopped").
    restoreLocation(orig);
    await jest.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.li-ac-gate-overlay')).toBeNull();
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;
    await jest.advanceTimersByTimeAsync(5000);
    expect(scroller.scrollTop).toBeGreaterThan(0); // auto-scroll restarted on return
  });

  test('startUrlGateMonitor/stopUrlGateMonitor are idempotent', async () => {
    jest.useFakeTimers();
    expect(typeof global.__LI.startUrlGateMonitor).toBe('function');
    expect(typeof global.__LI.stopUrlGateMonitor).toBe('function');

    // Not started yet: stopping is a safe no-op.
    expect(() => global.__LI.stopUrlGateMonitor()).not.toThrow();

    // Starting twice must not throw or double-arm; the monitor still fires once.
    global.__LI.startUrlGateMonitor();
    global.__LI.startUrlGateMonitor();
    const orig = setLocation('https://www.linkedin.com/jobs/');
    await jest.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.li-ac-gate-overlay')).not.toBeNull();
    restoreLocation(orig);

    // Stopping twice is also a safe no-op.
    expect(() => global.__LI.stopUrlGateMonitor()).not.toThrow();
    expect(() => global.__LI.stopUrlGateMonitor()).not.toThrow();
  });
});
