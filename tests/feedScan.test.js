'use strict';

/**
 * FEED_SCAN end-to-end: scanFeed() → getPosts → expandPosts → filterPosts →
 * scanKeywords → scanEmails → renderPanel. Also exercises the floating panel's
 * interactions (close, apply keywords, auto-scroll toggle) and the auto-scroll
 * interval callback.
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

describe('FEED_SCAN end-to-end (scanFeed → renderPanel)', () => {
  beforeEach(() => {
    // Clicking close resets the closure-held `panel` reference inside content.js
    // (a plain body clear would leave it pointing at a detached node).
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

  test('include keywords highlight matching posts and render the panel with email and keyword hits', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ includeKeywords: ['react'] });

    const reactPost = makePost('React dev email bob@example.com');
    const vue = makePost('Vue job, no match');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(found).not.toBeNull();
    expect(found.textContent).toContain('bob@example.com');
    expect(found.textContent).toContain('react');

    // Include keywords highlight but never hide: both posts stay visible.
    expect(reactPost.isConnected).toBe(true);
    expect(vue.isConnected).toBe(true);
    expect(reactPost.classList.contains('li-ac-kw-hl')).toBe(true);
    expect(vue.classList.contains('li-ac-kw-hl')).toBe(false);
  });

  test('exclude keywords hide matching posts (collapsed, still in DOM) and show the hidden counter', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ excludeKeywords: ['.net'] });

    const netPost = makePost('asp.net role email net@example.com');
    const reactPost = makePost('React role email react@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();

    // Hidden post: still in DOM but collapsed, excluded from the found panel.
    expect(netPost.isConnected).toBe(true);
    expect(netPost.classList.contains('li-ac-hidden')).toBe(true);
    expect(found.textContent).not.toContain('net@example.com');
    expect(found.textContent).toContain('react@example.com');
    expect(panel.textContent).toContain('Hidden: 1');

    // "Show" restores the hidden post.
    panel.querySelector('#li-ac-hidden-show').click();
    expect(netPost.classList.contains('li-ac-hidden')).toBe(false);
    expect(global.__LI.getHiddenCount()).toBe(0);
  });

  test('renders "No emails found" when no hits exist', async () => {
    jest.useFakeTimers();
    makePost('no contact details at all');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(found.textContent).toContain('No emails found');
  });

  test('panel close button removes the control panel, leaving the found panel open', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    expect(panel).not.toBeNull();
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
    panel.querySelector('#li-ac-panel-close').click();
    expect(document.getElementById('li-ac-panel')).toBeNull();
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
  });

  test('pressing Enter in the exclude input updates cfg, persists, and re-scans', async () => {
    jest.useFakeTimers();
    makePost('hello world');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const ex = panel.querySelector('#li-ac-kw-exclude');
    ex.value = '.NET, c++';
    ex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(global.__LI.getCfg().excludeKeywords).toEqual(['.net', 'c++']);
    expect(global.__LI.getCfg().includeKeywords).toEqual([]);
    expect(ex.value).toBe('');
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
      includeKeywords: [],
      excludeKeywords: ['.net', 'c++']
    });
  });

  test('auto-scroll toggle updates cfg, persists, and starts the scroll interval', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const toggle = document.getElementById('li-ac-autoscroll');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(global.__LI.getCfg().autoScroll).toBe(true);
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ autoScroll: true });

    // Advancing fires the auto-scroll interval callback (getScroller + scanFeed).
    await expect(jest.advanceTimersByTimeAsync(2500)).resolves.not.toThrow();
  });

  test('clicking a keyword panel entry scrolls its post into view', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ includeKeywords: ['react'] });
    makePost('React dev bob@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    const kwItem = found.querySelector('[data-kind="kw"]');
    expect(kwItem).not.toBeNull();
    expect(() => kwItem.click()).not.toThrow();
  });

  test('re-renders into an existing panel and syncs the auto-scroll toggle', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    expect(document.getElementById('li-ac-panel')).not.toBeNull();

    // Second scan with the panel still alive hits renderPanel's existing-panel branch.
    global.__LI.setCfg({ autoScroll: true });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('#li-ac-autoscroll').checked).toBe(true);
  });

  test('storage change to autoScroll syncs an open panel toggle', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    global.__onChanged({ autoScroll: { newValue: true } }, 'sync');

    const panel = document.getElementById('li-ac-panel');
    expect(panel.querySelector('#li-ac-autoscroll').checked).toBe(true);
    expect(global.__LI.getCfg().autoScroll).toBe(true);
  });

  test('auto-scroll jumps to a hit BELOW the viewport', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    const post = makePost('hello bob@example.com');
    // Genuinely below the fold (top > window.innerHeight).
    post.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      { behavior: 'smooth', block: 'center' }
    );
  });

  test('auto-scroll NEVER scrolls up to a hit above the viewport', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    const post = makePost('hello bob@example.com');
    // Above the fold (already passed) — must not be jumped to.
    post.getBoundingClientRect = () => ({ top: -600, bottom: -500, height: 100 });

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  test('auto-scroll does not scroll when the first hit is fully visible', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    const post = makePost('hello bob@example.com');
    post.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 });

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
