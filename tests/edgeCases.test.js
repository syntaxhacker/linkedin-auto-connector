'use strict';

/**
 * Regression tests for the edge-case fixes:
 *   H1  — double START is coalesced (no concurrent processNext chains)
 *   H2  — STOP aborts an in-flight send
 *   H3  — storage key removal / non-array values don't crash the scanner
 *   M2  — Show button sticky reveal (revealAll)
 *   L3  — escHtml escapes HTML in keywords/emails
 *   M7  — feed marker matching is case-insensitive + locale fallbacks
 *   tags — apply → input cleared → closable tags; tag removal re-scans
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

describe('H1/H2: connect-flow concurrency and stop-abort', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('H1: a second START while running is coalesced (no double chain)', async () => {
    jest.useFakeTimers();
    const { buildPatternACard } = require('./helpers');
    buildPatternACard({ name: 'John Doe' });

    const first = sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    expect(first.response).toEqual({ ok: true });

    const second = sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    expect(second.response).toEqual({ ok: true }); // coalesced, not rejected

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(2000);
    // Exactly one connect happened despite two STARTs.
    expect(global.__LI.getCounts().connected).toBe(0); // no dialog → skipped
    expect(global.__LI.getCounts().skipped).toBe(1);
  });

  test('H2: STOP during the dialog wait aborts before sending', async () => {
    jest.useFakeTimers();
    const { buildPatternACard } = require('./helpers');
    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.addEventListener('click', e => e.preventDefault());

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send without note';
    dialog.appendChild(sendBtn);
    document.body.appendChild(dialog);

    sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    await jest.advanceTimersByTimeAsync(500); // mid sleep(1000)
    sendMessage({ type: 'STOP' });
    await jest.advanceTimersByTimeAsync(3000);

    expect(global.__LI.getCounts().connected).toBe(0); // send was aborted
    expect(global.__LI.getCounts().skipped).toBe(0);   // never finished
  });

  test('H2: STOP during the direct-connect wait aborts', async () => {
    jest.useFakeTimers();
    const { buildPatternACard } = require('./helpers');
    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.addEventListener('click', e => e.preventDefault());

    sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    await jest.advanceTimersByTimeAsync(1000); // sleep(1000) done, no dialog
    await jest.advanceTimersByTimeAsync(200);  // mid sleep(500)
    connect.textContent = 'Pending';
    sendMessage({ type: 'STOP' });
    await jest.advanceTimersByTimeAsync(2000);

    expect(global.__LI.getCounts().connected).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });
});

describe('H3: storage corruption handling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    global.__LI.cleanup();
  });

  test('removing a keyword key from storage does not crash the scanner', () => {
    // Simulates chrome.storage removal: {oldValue} with no newValue.
    expect(() => {
      global.__onChanged({ excludeKeywords: { oldValue: ['.net'] } }, 'sync');
    }).not.toThrow();
    expect(global.__LI.getCfg().excludeKeywords).toEqual([]);
  });

  test('a non-array keyword value from storage is coerced back to an array', () => {
    global.__onChanged({ excludeKeywords: { newValue: '.net' } }, 'sync');
    expect(global.__LI.getCfg().excludeKeywords).toEqual([]);
    makePost('an .net post'); // filterPosts must not throw on .length
    expect(() => global.__LI.filterPosts(global.__LI.getPosts())).not.toThrow();
  });
});

describe('M2: Show button sticky reveal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
  });

  afterEach(() => {
    global.__LI.cleanup();
  });

  test('Show sets revealAll so filterPosts stops hiding until keywords change', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    makePost('we use .NET here');

    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(1);
    expect(global.__LI.getHiddenCount()).toBe(1);

    // Simulate the Show button: reveal + sticky override.
    global.__LI.setCfg({ revealAll: true });
    global.__LI.restoreHidden();
    expect(global.__LI.getHiddenCount()).toBe(0);

    // filterPosts now skips hiding entirely.
    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(0);
    expect(global.__LI.getHiddenCount()).toBe(0);

    // Keyword change clears the override and re-applies filtering.
    global.__LI.setCfg({ revealAll: false });
    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(1);
  });
});

describe('L3: escHtml', () => {
  test('escapes HTML metacharacters', () => {
    expect(global.__LI.escHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
    expect(global.__LI.escHtml('a&b"c\'d')).toBe('a&amp;b&quot;c&#39;d');
  });
});

describe('M7: feed marker fallbacks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('matches "Feed post" case-insensitively', () => {
    makePost('x', { h2Text: 'FEED POST' });
    expect(global.__LI.getPosts()).toHaveLength(1);
  });

  test('matches locale/alt markers "Feed" and "Home"', () => {
    makePost('x', { h2Text: 'Feed' });
    makePost('y', { h2Text: 'Home' });
    expect(global.__LI.getPosts()).toHaveLength(2);
  });

  test('still ignores unrelated headings', () => {
    makePost('x', { h2Text: 'Feed posts' });
    makePost('y', { h2Text: 'Profile' });
    expect(global.__LI.getPosts()).toHaveLength(0);
  });
});

describe('keyword tags (closable chips)', () => {
  let panel;

  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  async function openPanel() {
    jest.useFakeTimers();
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400); // flush observer scans
    panel = document.getElementById('li-ac-panel');
    return panel;
  }

  test('apply clears the input and renders closable tags', async () => {
    await openPanel();
    const inc = panel.querySelector('#li-ac-kw-include');
    const exc = panel.querySelector('#li-ac-kw-exclude');

    inc.value = 'react, python';
    exc.value = '.net';
    exc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(inc.value).toBe('');
    expect(exc.value).toBe('');
    const incTags = panel.querySelectorAll('#li-ac-tags-include [data-kw-remove]');
    const excTags = panel.querySelectorAll('#li-ac-tags-exclude [data-kw-remove]');
    expect(incTags).toHaveLength(2);
    expect(excTags).toHaveLength(1);
    expect(panel.querySelector('#li-ac-tags-include').textContent).toContain('react');
    expect(panel.querySelector('#li-ac-tags-include').textContent).toContain('python');
    expect(panel.querySelector('#li-ac-tags-exclude').textContent).toContain('.net');
    expect(global.__LI.getCfg().includeKeywords).toEqual(['react', 'python']);
    expect(global.__LI.getCfg().excludeKeywords).toEqual(['.net']);
  });

  test('applying keywords a SECOND time merges, does not wipe existing ones', async () => {
    // Regression: inputs are cleared after the first apply, so a second apply
    // used to REPLACE cfg with the now-empty inputs — wiping every keyword.
    await openPanel();
    const inc = panel.querySelector('#li-ac-kw-include');
    const exc = panel.querySelector('#li-ac-kw-exclude');

    // First apply: seed some keywords.
    inc.value = 'react, python';
    exc.value = '.net';
    exc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    // Second apply: inputs are empty, user adds one more.
    inc.value = 'typescript';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(global.__LI.getCfg().includeKeywords).toEqual(['react', 'python', 'typescript']);
    expect(global.__LI.getCfg().excludeKeywords).toEqual(['.net']);

    // Tags reflect the merged set.
    const incTags = panel.querySelectorAll('#li-ac-tags-include [data-kw-remove]');
    expect(incTags).toHaveLength(3);
    const excTags = panel.querySelectorAll('#li-ac-tags-exclude [data-kw-remove]');
    expect(excTags).toHaveLength(1);
  });

  test('apply merges without duplicating keywords typed twice', async () => {
    await openPanel();
    const inc = panel.querySelector('#li-ac-kw-include');

    inc.value = 'react';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    inc.value = 'react'; // same keyword re-added
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(global.__LI.getCfg().includeKeywords).toEqual(['react']);
    const incTags = panel.querySelectorAll('#li-ac-tags-include [data-kw-remove]');
    expect(incTags).toHaveLength(1);
  });

  test('closing an exclude tag removes it, restores hidden posts, and persists', async () => {
    await openPanel();
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const netPost = makePost('an .net post');
    global.__LI.filterPosts(global.__LI.getPosts());
    expect(global.__LI.getHiddenCount()).toBe(1);

    // Re-render tags then click the × on the .net tag.
    global.__LI.renderTags(panel);
    const x = panel.querySelector('#li-ac-tags-exclude [data-kw-remove]');
    x.click();

    expect(global.__LI.getCfg().excludeKeywords).toEqual([]);
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ excludeKeywords: [] });
    expect(global.__LI.getHiddenCount()).toBe(0);
    expect(netPost.classList.contains('li-ac-hidden')).toBe(false);
  });

  test('closing an include tag removes it without hiding anything', async () => {
    await openPanel();
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });
    global.__LI.renderTags(panel);

    const x = panel.querySelector('#li-ac-tags-include [data-kw-remove]');
    x.click();

    expect(global.__LI.getCfg().includeKeywords).toEqual(['python']);
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ includeKeywords: ['python'] });
  });
});

describe('panel dismissal sticks (close survives re-scans)', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('closing the panel keeps it closed across background re-scans', async () => {
    jest.useFakeTimers();
    global.__LI.startFeedObserver(); // cleanup() disconnects it between tests
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel')).not.toBeNull();

    // Close it.
    closePanels();
    expect(document.getElementById('li-ac-panel')).toBeNull();

    // Simulate a background feed mutation → observer re-scan → renderPanel.
    makePost('another post with carol@example.com');
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel')).toBeNull(); // still closed
  });

  test('FEED_SCAN re-enables the dismissed panel', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    closePanels();
    expect(document.getElementById('li-ac-panel')).toBeNull();

    sendMessage({ type: 'FEED_SCAN' }); // explicit scan re-opens it
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel')).not.toBeNull();
  });
});

describe('L2: email regex hardening', () => {
  test('never includes leading/trailing/double dots in the extracted email', () => {
    const post = makePost('a: .alice@domain.com b: bob.@domain.com c: carol..bob@domain.com d: dan@domain.com');
    const hits = global.__LI.scanEmails([post]);
    const emails = hits[0].emails;
    expect(emails).toContain('dan@domain.com');
    // No extracted address may carry an invalid dot form.
    for (const e of emails) {
      const local = e.split('@')[0];
      expect(local.startsWith('.')).toBe(false);
      expect(local.endsWith('.')).toBe(false);
      expect(local.includes('..')).toBe(false);
    }
  });

  test('still accepts dotted local parts like first.last@domain.com', () => {
    const post = makePost('reach first.last@domain.com');
    const hits = global.__LI.scanEmails([post]);
    expect(hits[0].emails).toEqual(['first.last@domain.com']);
  });
});

describe('include-only keyword removal does not touch hidden posts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    global.__LI.cleanup();
  });

  test('removing an include keyword leaves hidden posts alone', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['.net'] });
    makePost('a .net post');
    global.__LI.filterPosts(global.__LI.getPosts());
    expect(global.__LI.getHiddenCount()).toBe(1);

    global.__LI.removeKeyword('react', 'include');
    expect(global.__LI.getCfg().includeKeywords).toEqual([]);
    expect(global.__LI.getHiddenCount()).toBe(1); // still hidden
    expect(global.__LI.getCfg().excludeKeywords).toEqual(['.net']);
  });
});

describe('clicking a panel result disables auto-scroll', () => {
  let panel;

  beforeEach(() => {
    closePanels();
    global.__LI.stopAutoScroll(); // ensure no interval leaks from a prior test
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS, autoScroll: true });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  async function openPanelWithAutoScroll() {
    jest.useFakeTimers();
    sendMessage({ type: 'RESET' }); // nulls any stale closure panel + clears dismiss
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    panel = document.getElementById('li-ac-panel');
    return panel;
  }
  test('clicking a keyword/email result turns auto-scroll OFF (uncheck + persist)', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    global.__LI.startAutoScroll();

    // Build panels via the rendered list so the row click handler runs.
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();

    const row = found.querySelector('[data-kind="em"][data-key]');
    expect(row).not.toBeNull();
    row.click();

    expect(global.__LI.getCfg().autoScroll).toBe(false);
    expect(panel.querySelector('#li-ac-autoscroll').checked).toBe(false);
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ autoScroll: false });

    // Interval is stopped: advancing time must not scroll.
    const scroller = global.__LI.getScroller();
    const before = scroller.scrollTop;
    await jest.advanceTimersByTimeAsync(5000);
    expect(scroller.scrollTop).toBe(before);
  });
});
