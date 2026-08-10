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
    expect(document.getElementById('li-ac-panel-list').textContent).toContain('No emails found');

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

  test('panels close normally even while gated (✕ still reachable)', async () => {
    jest.useFakeTimers();
    const orig = setLocation('https://www.linkedin.com/jobs/');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    found.querySelector('#li-ac-found-close').click();
    expect(document.getElementById('li-ac-found-panel')).toBeNull();
    expect(document.getElementById('li-ac-panel')).not.toBeNull();

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
