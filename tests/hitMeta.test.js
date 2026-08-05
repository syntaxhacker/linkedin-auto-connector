'use strict';

/**
 * Hit metadata: relative "time ago" labels and the "✓ seen" viewed badge on
 * keyword/email panel rows. Session-only state keyed by kind:postKey.
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

describe('timeAgo', () => {
  test('formats seconds, minutes, and hours', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000000000000);
    try {
      expect(global.__LI.timeAgo(1000000000000)).toBe('0s ago');
      expect(global.__LI.timeAgo(1000000000000 - 5000)).toBe('5s ago');
      expect(global.__LI.timeAgo(1000000000000 - 65000)).toBe('1min ago');
      expect(global.__LI.timeAgo(1000000000000 - 185000)).toBe('3min ago');
      expect(global.__LI.timeAgo(1000000000000 - 3600000)).toBe('1h ago');
      expect(global.__LI.timeAgo(1000000000000 - 54000000)).toBe('15h ago');
    } finally {
      Date.now.mockRestore();
    }
  });
});

describe('postKey', () => {
  test('normalizes whitespace and trims', () => {
    const el = document.createElement('div');
    el.textContent = '  Hello    world\n  Foo  ';
    expect(global.__LI.postKey(el)).toBe('Hello world Foo');
  });

  test('handles empty text', () => {
    expect(global.__LI.postKey(null)).toBe('');
    expect(global.__LI.postKey(document.createElement('div'))).toBe('');
  });
});

describe('hit metadata (firstSeen + viewed)', () => {
  beforeEach(() => {
    closePanels(); // reset closure-held panel references
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.resetHitMeta();
    global.__LI.knownEmailsClear();
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
    await jest.advanceTimersByTimeAsync(400);
    return document.getElementById('li-ac-found-panel');
  }

  test('rows show a time-ago label', async () => {
    const panel = await openPanel();
    const rows = panel.querySelectorAll('[data-key]');
    expect(rows.length).toBeGreaterThan(0);
    expect(panel.textContent).toMatch(/\d+s ago|\d+min ago|\d+h ago/);
  });

  test('firstSeen is stamped once and does not reset across scans', async () => {
    const panel = await openPanel();
    const row = panel.querySelector('[data-kind="em"][data-key]');
    expect(row).not.toBeNull();

    // Advance time, re-scan: the "ago" label should grow, not reset to 0s.
    jest.advanceTimersByTime(65000);
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const panel2 = document.getElementById('li-ac-found-panel');
    expect(panel2.textContent).toMatch(/1min ago/);
  });

  test('clicking a row marks it viewed and shows the ✓ badge', async () => {
    const panel = await openPanel();
    const row = panel.querySelector('[data-kind="em"][data-key]');
    expect(panel.querySelector('[data-viewed]')).toBeNull();

    row.click();

    expect(row.querySelector('[data-viewed]')).not.toBeNull();
    expect(row.textContent).toContain('✓ seen');

    // Survives a re-scan.
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const panel2 = document.getElementById('li-ac-found-panel');
    expect(panel2.querySelector('[data-viewed]')).not.toBeNull();
  });

  test('markViewed / resetHitMeta work directly', () => {
    const meta = global.__LI.markViewed('em', 'some-key');
    expect(meta.viewed).toBe(true);
    expect(global.__LI.hitMeta().has('em:some-key')).toBe(true);

    global.__LI.resetHitMeta();
    expect(global.__LI.hitMeta().size).toBe(0);
  });

  test('RESET clears viewed state', async () => {
    const panel = await openPanel();
    panel.querySelector('[data-kind="em"][data-key]').click();
    expect(panel.querySelector('[data-viewed]')).not.toBeNull();

    sendMessage({ type: 'RESET' });
    expect(global.__LI.hitMeta().size).toBe(0);
  });
});
