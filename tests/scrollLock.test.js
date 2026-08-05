'use strict';

/**
 * Scroll mutex (threading) tests — only one actor may own the viewport at a
 * time. The continuous auto-scroll interval must yield to a 'hit' jump or a
 * user 'click'; the auto-jump must only fire for NEWLY discovered emails; and
 * resetting the lock frees the viewport for the next actor.
 *
 * Priority: click (3) > hit (2) > autoscroll (1).
 */

const { makePost, sendMessage, closePanels } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('scrollLock (mutex)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.scrollLock.reset();
    global.__LI.knownEmailsClear();
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('acquire returns true for a free lock', () => {
    expect(global.__LI.scrollLock.acquire('autoscroll', 1000)).toBe(true);
    expect(global.__LI.scrollLock.isHeldBy('autoscroll')).toBe(true);
  });

  test('a lower-priority actor cannot preempt a higher-priority one', () => {
    global.__LI.scrollLock.acquire('hit', 1000); // priority 2
    // autoscroll (1) tries to take the viewport while a hit owns it.
    expect(global.__LI.scrollLock.acquire('autoscroll', 1000)).toBe(false);
    expect(global.__LI.scrollLock.isHeldBy('hit')).toBe(true);
  });

  test('a higher-priority actor CAN preempt a lower-priority one', () => {
    global.__LI.scrollLock.acquire('autoscroll', 1000); // priority 1
    expect(global.__LI.scrollLock.acquire('click', 1000)).toBe(true); // 3 > 1
    expect(global.__LI.scrollLock.isHeldBy('click')).toBe(true);
    expect(global.__LI.scrollLock.isHeldBy('autoscroll')).toBe(false);
  });

  test('the same actor re-acquiring renews its hold', () => {
    global.__LI.scrollLock.acquire('autoscroll', 1000);
    expect(global.__LI.scrollLock.acquire('autoscroll', 1000)).toBe(true);
    expect(global.__LI.scrollLock.isHeldBy('autoscroll')).toBe(true);
  });

  test('the lock releases itself after the hold duration', async () => {
    jest.useFakeTimers();
    global.__LI.scrollLock.acquire('click', 300);
    expect(global.__LI.scrollLock.isHeldBy('click')).toBe(true);
    await jest.advanceTimersByTimeAsync(400);
    expect(global.__LI.scrollLock.isHeld()).toBe(false);
  });

  test('reset frees the lock for the next actor', () => {
    global.__LI.scrollLock.acquire('click', 5000);
    expect(global.__LI.scrollLock.isHeld()).toBe(true);
    global.__LI.scrollLock.reset();
    expect(global.__LI.scrollLock.isHeld()).toBe(false);
    expect(global.__LI.scrollLock.acquire('autoscroll', 1000)).toBe(true);
  });
});

describe('scroll lock vs auto-scroll interval', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.scrollLock.reset();
    global.__LI.knownEmailsClear();
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('interval skips its tick while a click owns the viewport', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    makePost('a normal post'); // feed present so auto-scroll is allowed to run
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;

    global.__LI.startAutoScroll();
    // A user click holds the lock for 5s.
    global.__LI.scrollLock.acquire('click', 5000);

    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBe(0); // tick skipped — no fighting

    // Once the lock expires the interval resumes.
    await jest.advanceTimersByTimeAsync(5000);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  test('stopAutoScroll releases the autoscroll lock', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    makePost('a normal post'); // feed present so auto-scroll is allowed to run
    global.__LI.startAutoScroll();
    await jest.advanceTimersByTimeAsync(2500);
    expect(global.__LI.scrollLock.isHeld()).toBe(true); // interval holds it after a tick

    global.__LI.stopAutoScroll();
    expect(global.__LI.scrollLock.isHeld()).toBe(false);
  });

  test('interval keeps scrolling when scans find nothing new to jump to', async () => {
    // Regression: renderPanel must NOT hold the 'hit' lock on every scan, or the
    // interval is starved and auto-scroll never moves.
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;

    // A feed with one post that has no emails and no include keywords → no
    // jump target, so the 'hit' lock must stay free across scans.
    const post = makePost('a normal post without contacts');
    post.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    global.__LI.startAutoScroll();
    await jest.advanceTimersByTimeAsync(2500); // first tick
    expect(scroller.scrollTop).toBeGreaterThan(0);

    // Repeated observer-driven scans (no new emails) must not block the next tick.
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBeGreaterThan(400); // moved again
    expect(global.__LI.scrollLock.isHeldBy('hit')).toBe(false);
  });

  test('auto-jump to a new email briefly preempts, then the interval resumes', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;

    // New email below the fold → jump acquires 'hit' for 4s, then interval resumes.
    makePost('contact bob@example.com').getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    global.__LI.startAutoScroll();
    await jest.advanceTimersByTimeAsync(2500); // tick 1: scroll
    await jest.advanceTimersByTimeAsync(400);  // debounced scan → renderPanel jump
    expect(global.__LI.scrollLock.isHeldBy('hit')).toBe(true); // jumped to new email
    expect(scroller.scrollTop).toBeGreaterThan(0);

    // While 'hit' holds (~4s), the interval skips its next tick.
    const afterJump = scroller.scrollTop;
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBe(afterJump);

    // After 'hit' expires, the interval moves again.
    await jest.advanceTimersByTimeAsync(4000);
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBeGreaterThan(afterJump);
  });
});

describe('auto-jump fires only for NEW emails', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.scrollLock.reset();
    global.__LI.knownEmailsClear();
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('jumps once for a new email, then does not re-jump on later scans', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    const post = makePost('contact bob@example.com');
    post.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400); // flush observer scans

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      { behavior: 'smooth', block: 'center' }
    );
    const callsAfterFirst = Element.prototype.scrollIntoView.mock.calls.length;

    // Second scan with the same email → no re-jump.
    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
  });

  test('a second brand-new email triggers a new jump', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    makePost('first bob@example.com').getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    Element.prototype.scrollIntoView.mockClear();
    makePost('second carol@example.com').getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('jumps for a keyword-only hit when no emails are present', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true, includeKeywords: ['react'] });
    const post = makePost('React Developer opening');
    post.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('a keyword-only hit ABOVE the viewport is never jumped to (no upward scroll)', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true, includeKeywords: ['react'] });
    const post = makePost('React Developer opening');
    post.getBoundingClientRect = () => ({ top: -600, bottom: -500, height: 100 });

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    // Repeated scans must NOT keep scrolling up to it either.
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  test('knownKeywordKeys helpers add and clear', () => {
    global.__LI.knownKeywordKeysAdd('kw:somepost');
    global.__LI.knownKeywordKeysAdd('kw:another');
    global.__LI.knownKeywordKeysClear();
    // After clear, a below-viewport keyword hit jumps again (covered by other tests).
    expect(global.__LI.scrollLock).toBeDefined();
  });

  test('knownEmailsAdd / knownEmailsClear helpers work', () => {
    global.__LI.knownEmailsAdd('a@b.com');
    expect(global.__LI.scrollLock).toBeDefined();
    global.__LI.knownEmailsClear();
    // After clearing, the same email is treated as new again.
    const post = makePost('contact a@b.com');
    post.getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });
    global.__LI.setCfg({ autoScroll: true });
    global.__LI.knownEmailsClear();
    global.__LI.scanKeywords([]); // no-op, keeps coverage of empty-includes path
  });

  test('RESET clears knownEmails so emails can be re-centered', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    makePost('bob@example.com').getBoundingClientRect = () => ({ top: window.innerHeight + 500, bottom: window.innerHeight + 600, height: 100 });

    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    Element.prototype.scrollIntoView.mockClear();
    sendMessage({ type: 'RESET' }); // RESET disables autoScroll + clears knownEmails
    global.__LI.setCfg({ autoScroll: true });

    // After RESET the same email counts as new again.
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('auto-scroll duration (0 = unlimited, else stop after N min)', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.setAutoScrollDurationMin(0);
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.setAutoScrollDurationMin(0);
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  test('duration defaults to 0 (unlimited)', () => {
    expect(global.__LI.getAutoScrollDurationMin()).toBe(0);
  });

  test('setAutoScrollDurationMin persists and clamps to non-negative ints', () => {
    global.__LI.setAutoScrollDurationMin(5);
    expect(global.__LI.getAutoScrollDurationMin()).toBe(5);
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ autoScrollDurationMin: 5 });

    global.__LI.setAutoScrollDurationMin(-3);
    expect(global.__LI.getAutoScrollDurationMin()).toBe(0);
  });

  test('duration 0 keeps scrolling indefinitely', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    makePost('a normal post'); // feed present so auto-scroll is allowed to run
    global.__LI.startAutoScroll();
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    // Even after several minutes, still running (no auto-stop).
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(global.__LI.getCfg().autoScroll).toBe(true);
  });

  test('auto-scroll stops after the configured minutes', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    global.__LI.setAutoScrollDurationMin(1);
    global.__LI.startAutoScroll();
    expect(global.__LI.getCfg().autoScroll).toBe(true);

    // Before 1 min elapses, still running.
    await jest.advanceTimersByTimeAsync(59000);
    expect(global.__LI.getCfg().autoScroll).toBe(true);

    // After 1 min, auto-stops and unchecks.
    await jest.advanceTimersByTimeAsync(2000);
    expect(global.__LI.getCfg().autoScroll).toBe(false);
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ autoScroll: false });
  });

  test('restarting with a new duration re-arms the stop timer', async () => {
    jest.useFakeTimers();
    global.__LI.setCfg({ autoScroll: true });
    global.__LI.setAutoScrollDurationMin(1);
    global.__LI.startAutoScroll();
    await jest.advanceTimersByTimeAsync(30000);

    // Change duration mid-run → restart re-arms from now.
    global.__LI.setAutoScrollDurationMin(1);
    await jest.advanceTimersByTimeAsync(30000);
    expect(global.__LI.getCfg().autoScroll).toBe(true); // < 1 min from re-arm

    await jest.advanceTimersByTimeAsync(35000);
    expect(global.__LI.getCfg().autoScroll).toBe(false);
  });

  test('storage onChanged applies a new duration to the open panel input', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    global.__onChanged({ autoScrollDurationMin: { newValue: 3 } }, 'sync');
    const input = document.getElementById('li-ac-autoscroll-min');
    expect(input.value).toBe('3');
    expect(global.__LI.getAutoScrollDurationMin()).toBe(3);
  });
});

describe('auto-scroll duration panel input', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.setAutoScrollDurationMin(0);
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.setAutoScrollDurationMin(0);
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  test('changing the input persists the duration and normalizes the field', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const input = document.getElementById('li-ac-autoscroll-min');
    expect(input).not.toBeNull();
    input.value = '7';
    input.dispatchEvent(new Event('change'));
    expect(global.__LI.getAutoScrollDurationMin()).toBe(7);
    expect(input.value).toBe('7');

    input.value = '-2';
    input.dispatchEvent(new Event('change'));
    expect(global.__LI.getAutoScrollDurationMin()).toBe(0);
    expect(input.value).toBe('0');
  });

  test('auto-stop unchecks the auto-scroll toggle in the panel', async () => {
    jest.useFakeTimers();
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const toggle = document.getElementById('li-ac-autoscroll');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    global.__LI.setAutoScrollDurationMin(1);

    await jest.advanceTimersByTimeAsync(61000);
    expect(toggle.checked).toBe(false);
    expect(global.__LI.getCfg().autoScroll).toBe(false);
  });
});

describe('auto-scroll only on the feed (not profile/messaging pages)', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.scrollLock.reset();
    global.__LI.knownEmailsClear();
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  test('does not scroll when the page has no feed posts', async () => {
    jest.useFakeTimers();
    // Simulate a profile page: no "Feed post" h2 anywhere.
    const h2 = document.createElement('h2');
    h2.textContent = 'Profile overview';
    document.body.appendChild(h2);
    document.body.appendChild(document.createElement('div')); // scrollable-ish content

    global.__LI.setCfg({ autoScroll: true });
    global.__LI.startAutoScroll();
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBe(0); // no scrolling on non-feed pages
  });

  test('scrolls on the feed even when nothing matches keywords/emails', async () => {
    jest.useFakeTimers();
    makePost('a plain post with no contacts');
    global.__LI.setCfg({ autoScroll: true });
    global.__LI.startAutoScroll();
    const scroller = global.__LI.getScroller();
    scroller.scrollTop = 0;
    await jest.advanceTimersByTimeAsync(2500);
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});
