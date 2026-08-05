'use strict';
const { makePost, sendMessage, closePanels } = require('./helpers');
const DEFAULTS = { autoExpand: true, scanEmails: true, includeKeywords: ['react'], excludeKeywords: [], autoScroll: true, debug: false };
describe('2nd click after rows renumber (stale data-idx)', () => {
  let panel;
  beforeEach(() => {
    closePanels();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });
  afterEach(() => { jest.useRealTimers(); global.__LI.stopAutoScroll(); global.__LI.cleanup(); });

  async function open() {
    jest.useFakeTimers();
    makePost('React role one bob@example.com');
    makePost('React role two carol@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    panel = document.getElementById('li-ac-found-panel');
  }

  test('clicking a row still scrolls the LIVE post when the stored element is detached', async () => {
    await open();
    global.__LI.startAutoScroll();
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;

    const rows = Array.from(panel.querySelectorAll('[data-kind="em"][data-key]'));
    const second = rows[1];
    const secondKey = second.getAttribute('data-key');

    // Real DOM post that the panel row points to (will be detached).
    const origPost = global.__LI.getPosts().find(p => global.__LI.postKey(p) === secondKey);
    expect(origPost).toBeTruthy();

    // Detach the original post and add a fresh node with identical text.
    origPost.remove();
    const freshPost = makePost('React role two carol@example.com');
    freshPost.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    // Spy: record WHICH element scrollIntoView is invoked on.
    const targets = [];
    const origSiv = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (opts) { targets.push(this); };

    second.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await jest.advanceTimersByTimeAsync(50);

    expect(targets.length).toBe(1);
    // The FIX scrolls the LIVE (fresh) post, not the detached origPost.
    expect(targets[0]).toBe(freshPost);
    expect(targets[0].isConnected).toBe(true);
    Element.prototype.scrollIntoView = origSiv;
  });
});

describe('legacy row without data-key (index fallback)', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });
  afterEach(() => { jest.useRealTimers(); global.__LI.stopAutoScroll(); global.__LI.cleanup(); });

  test('a row missing data-key still resolves via the current index', async () => {
    jest.useFakeTimers();
    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const panel = document.getElementById('li-ac-found-panel');
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;
    const live = global.__LI.getPosts()[0];
    live.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    // Simulate a legacy row without data-key.
    const row = panel.querySelector('[data-kind="em"]');
    row.removeAttribute('data-key');

    Element.prototype.scrollIntoView.mockClear();
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await jest.advanceTimersByTimeAsync(50);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(global.__LI.getCfg().autoScroll).toBe(false);
  });
});
