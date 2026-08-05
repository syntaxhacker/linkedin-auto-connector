'use strict';

/**
 * Init behavior when autoScroll is false (the default in production):
 * content.js pins the page to the top during the startup window — resetting any
 * scroll the browser/LinkedIn restores — via a capture-phase scroll listener
 * plus a polling interval. Unlike a fixed timeout, the guard:
 *   - releases the moment the user scrolls deliberately (wheel/touch/scroll key)
 *   - releases once the feed stops growing for ~6s
 *   - keeps pinning as long as content keeps loading
 */

function reinitWithAutoScrollFalse() {
  global.chrome.storage.sync.get.mockImplementationOnce((_defaults, callback) => {
    callback({
      autoExpand: true,
      scanEmails: true,
      includeKeywords: [],
      excludeKeywords: [],
      autoScroll: false
    });
  });
  let LI;
  jest.isolateModules(() => {
    require('../content.js');
  });
  LI = globalThis.__LI_AC_TEST__;
  return LI;
}

describe('initialization with autoScroll=false (scroll-restoration guard)', () => {
  afterEach(() => {
    document.documentElement.scrollTop = 0;
    window.removeEventListener('scroll', () => {}, true);
    jest.useRealTimers();
  });

  test('pins scroll to top on load and on any restored scroll', () => {
    jest.useFakeTimers();
    const LI = reinitWithAutoScrollFalse();

    document.documentElement.scrollTop = 300;
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(document.documentElement.scrollTop).toBe(0);

    // Polling keeps it pinned while content is still loading.
    document.documentElement.scrollTop = 200;
    jest.advanceTimersByTime(1000);
    expect(document.documentElement.scrollTop).toBe(0);

    LI.cleanup();
  });

  test('releases immediately when the user scrolls with the wheel', () => {
    jest.useFakeTimers();
    const LI = reinitWithAutoScrollFalse();

    document.documentElement.scrollTop = 500;
    window.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: true }));
    document.documentElement.scrollTop = 400; // user's scroll is no longer overridden
    jest.advanceTimersByTime(1000);
    expect(document.documentElement.scrollTop).toBe(400);

    LI.cleanup();
  });

  test('releases immediately on a scroll key (PageDown)', () => {
    jest.useFakeTimers();
    const LI = reinitWithAutoScrollFalse();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
    document.documentElement.scrollTop = 800;
    jest.advanceTimersByTime(1000);
    expect(document.documentElement.scrollTop).toBe(800);

    LI.cleanup();
  });

  test('non-scroll keys do not release the guard', () => {
    jest.useFakeTimers();
    const LI = reinitWithAutoScrollFalse();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    document.documentElement.scrollTop = 500;
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    jest.advanceTimersByTime(500);
    expect(document.documentElement.scrollTop).toBe(0);

    LI.cleanup();
  });

  test('releases once the feed stops growing for ~6s', () => {
    jest.useFakeTimers();
    const LI = reinitWithAutoScrollFalse();

    // Feed keeps growing for the first 5s (pinned stays enforced).
    const main = document.createElement('main');
    document.body.appendChild(main);
    let feedHeight = 1000;
    Object.defineProperty(main, 'scrollHeight', { get: () => feedHeight, configurable: true });
    Object.defineProperty(main, 'clientHeight', { value: 500, configurable: true });
    for (let i = 0; i < 10; i++) {
      feedHeight += 100;
      jest.advanceTimersByTime(500);
      document.documentElement.scrollTop = 300;
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
      jest.advanceTimersByTime(0);
    }
    expect(document.documentElement.scrollTop).toBe(0);

    // After ~6.5s of stable height the guard releases.
    jest.advanceTimersByTime(7000);
    document.documentElement.scrollTop = 300;
    jest.advanceTimersByTime(2000);
    expect(document.documentElement.scrollTop).toBe(300);

    LI.cleanup();
  });
});

describe('getScroller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ autoScroll: true });
  });

  afterEach(() => {
    global.__LI.setCfg({ autoScroll: false });
    global.__LI.cleanup();
  });

  test('prefers the container with the largest scrollable delta (LinkedIn <main>)', () => {
    // Simulate LinkedIn: <main> is the real scroller, documentElement is not.
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });

    const main = document.createElement('main');
    Object.defineProperty(main, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(main, 'clientHeight', { value: 800, configurable: true });
    document.body.appendChild(main);

    expect(global.__LI.getScroller()).toBe(main);
  });

  test('falls back to documentElement when nothing is a real scroller', () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
    expect(global.__LI.getScroller()).toBe(document.documentElement);
  });
});
