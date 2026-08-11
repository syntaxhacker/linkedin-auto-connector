'use strict';

/**
 * Message handler tests — drive messages through the chrome.runtime.onMessage
 * listener captured by the jest setup mock.
 */

const { buildPatternACard, sendMessage, resetState } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('chrome.runtime.onMessage handler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState(); // zero counters/queue/badge between tests
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    global.__LI.cleanup();
  });

  test('PING responds { alive: true }', () => {
    const { response } = sendMessage({ type: 'PING' });
    expect(response).toEqual({ alive: true });
  });

  test('STOP responds { ok: true }', () => {
    const { response } = sendMessage({ type: 'STOP' });
    expect(response).toEqual({ ok: true });
  });

  test('STATUS reports current counters', () => {
    buildPatternACard({ name: 'Jane Doe', degreeText: '3rd+ connection' });
    global.__LI.scanButtons(); // skipped +1

    const { response } = sendMessage({ type: 'STATUS' });
    expect(response.connected).toBe(0);
    expect(response.skipped).toBe(1);
    expect(response.running).toBe(false);
    expect(response.total).toBe(0);
  });

  test('RESET responds { ok: true }, resets counters, and persists autoScroll false', () => {
    buildPatternACard({ name: 'Jane Doe', degreeText: '3rd+ connection' });
    global.__LI.scanButtons();
    expect(global.__LI.getCounts().skipped).toBe(1);

    const { response } = sendMessage({ type: 'RESET' });
    expect(response).toEqual({ ok: true });
    expect(global.__LI.getCounts()).toEqual({ connected: 0, skipped: 0, failed: 0 });
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ autoScroll: false, ultraHide: false });
    expect(global.__LI.getCfg().autoScroll).toBe(false);
    expect(global.__LI.getCfg().ultraHide).toBe(false);
  });

  test('RESET restores hidden posts (clears .li-ac-hidden)', () => {
    const { makePost } = require('./helpers');
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const post = makePost('a .net post to hide');
    global.__LI.filterPosts(global.__LI.getPosts());
    expect(global.__LI.getHiddenCount()).toBe(1);

    sendMessage({ type: 'RESET' });

    expect(global.__LI.getHiddenCount()).toBe(0);
    expect(post.classList.contains('li-ac-hidden')).toBe(false);
    expect(document.body.contains(post)).toBe(true);
  });

  test('RESET clears the connect queue', () => {
    buildPatternACard({ name: 'John Doe' });
    expect(global.__LI.scanButtons()).toBe(1);

    sendMessage({ type: 'RESET' });

    const { response: status } = sendMessage({ type: 'STATUS' });
    expect(status.total).toBe(0);

    document.body.innerHTML = ''; // nothing left on the page to re-scan
    const { response: start } = sendMessage({ type: 'START' });
    expect(start).toEqual({ ok: false }); // queue really was cleared
  });

  test('FEED_SCAN responds { ok: true }', () => {
    const { response } = sendMessage({ type: 'FEED_SCAN' });
    expect(response).toEqual({ ok: true });
  });

  test('SCAN returns count and highlights buttons when connectable buttons exist', () => {
    const { connect } = buildPatternACard({ name: 'John Doe', vanity: 'johndoe' });

    const { response } = sendMessage({ type: 'SCAN' });

    expect(response).toEqual({ count: 1 });
    expect(document.getElementById('li-ac-badge')).not.toBeNull();
    expect(connect.classList.contains('li-ac-hl')).toBe(true);
    expect(connect.title).toBe('LI Auto: John Doe');
  });

  test('SCAN returns { count: 0 } when no connectable buttons exist', () => {
    const { response } = sendMessage({ type: 'SCAN' });
    expect(response).toEqual({ count: 0 });
  });

  test('START returns { ok: false } when nothing is queued', () => {
    const { response } = sendMessage({ type: 'START' });
    expect(response).toEqual({ ok: false });
  });
});
