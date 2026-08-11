'use strict';

/**
 * MutationObserver guard — the feed observer ignores mutations caused by our
 * own UI (#li-ac-panel, #li-ac-styles, #li-ac-badge) to avoid re-scan churn,
 * but still scans when real feed content changes.
 */

const { makePost, sendMessage } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('MutationObserver (own-mutation guard)', () => {
  beforeEach(() => {
    const closeBtn = document.getElementById('li-ac-panel-close');
    if (closeBtn) closeBtn.click();
    const foundClose = document.getElementById('li-ac-found-close');
    if (foundClose) foundClose.click();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.startFeedObserver(); // cleanup() disconnects it between tests
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('mutations inside the panel do not trigger a re-scan', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    // Flush any stale observer-scheduled scans (from makePost) so the panel is stable.
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    const list = found.querySelector('#li-ac-panel-list');
    expect(list).not.toBeNull();

    // Put a sentinel in the found-panel list; a re-scan would overwrite it.
    list.innerHTML = 'SENTINEL';
    found.appendChild(document.createElement('div'));

    await jest.advanceTimersByTimeAsync(400);
    expect(list.textContent).toBe('SENTINEL'); // guard skipped the re-scan
  });

  test('real feed mutations (new post added) trigger a scan', async () => {
    jest.useFakeTimers();
    makePost('no email here');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-found-panel').textContent).toContain('No email matches');

    // A new post arriving in the feed is an external mutation.
    makePost('new engineer email new@example.com');
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    expect(found.textContent).toContain('new@example.com');
  });
});
