"use strict";

/**
 * Panel minimize (collapse) feature:
 *  - each floating panel (control #li-ac-panel, found #li-ac-found-panel) gets a
 *    –/+ button in its header; clicking it collapses BOTH panels into a single
 *    messenger-style floating bubble (#li-ac-bubble) so they never block
 *    LinkedIn's own messaging dock;
 *  - clicking the bubble expands both panels;
 *  - state persists via chrome.storage.sync (panelMinimized + foundPanelMinimized,
 *    written in sync), is honored when loaded at init, applied from
 *    storage.onChanged, and survives renderPanel re-renders (re-scans) and
 *    panel recreation.
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

describe('panel minimize (combined floating bubble)', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.setPanelMinimized(false);
    global.__LI.setFoundPanelMinimized(false);
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.setPanelMinimized(false);
    global.__LI.setFoundPanelMinimized(false);
    global.__LI.cleanup();
  });

  async function openPanels() {
    jest.useFakeTimers();
    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('minimize collapses BOTH panels into the floating bubble', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    const btn = panel.querySelector('#li-ac-panel-min');
    expect(panel).not.toBeNull();
    expect(found).not.toBeNull();
    expect(btn.textContent).toBe('–'); // expanded by default
    expect(document.getElementById('li-ac-bubble').style.display).toBe('none');

    btn.click();
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(global.__LI.getFoundPanelMinimized()).toBe(true);
    // Both panels hidden; the bubble is shown instead.
    expect(panel.style.display).toBe('none');
    expect(found.style.display).toBe('none');
    const bubble = document.getElementById('li-ac-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble.style.display).toBe('flex');
    expect(bubble.style.width).toBe('56px'); // messenger-style circular bubble
    expect(bubble.style.height).toBe('56px');
    expect(btn.textContent).toBe('+');
  });

  test('clicking the bubble expands both panels again', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    panel.querySelector('#li-ac-panel-min').click();
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');

    document.getElementById('li-ac-bubble').click();
    expect(global.__LI.getPanelMinimized()).toBe(false);
    expect(global.__LI.getFoundPanelMinimized()).toBe(false);
    expect(panel.style.display).toBe('');
    expect(found.style.display).toBe('flex');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('none');
    expect(panel.querySelector('#li-ac-panel-min').textContent).toBe('–');
  });

  test('minimizing either panel collapses both (single combined bubble)', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    found.querySelector('#li-ac-found-min').click(); // minimize from the found panel
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(global.__LI.getFoundPanelMinimized()).toBe(true);
    expect(panel.style.display).toBe('none');
    expect(found.style.display).toBe('none');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');
  });

  test('minimize state survives a renderPanel re-render (re-scan)', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    panel.querySelector('#li-ac-panel-min').click();

    // Re-scan re-renders panel contents; the same connected panels stay put.
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    expect(document.getElementById('li-ac-panel')).toBe(panel);
    expect(panel.style.display).toBe('none');
    expect(document.getElementById('li-ac-found-panel').style.display).toBe('none');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');

    // Header listeners are NOT double-wired: a single bubble click expands.
    document.getElementById('li-ac-bubble').click();
    expect(global.__LI.getPanelMinimized()).toBe(false);
    expect(panel.style.display).toBe('');
  });

  test('minimize state persists via chrome.storage.sync with the right keys', async () => {
    await openPanels();
    global.chrome.storage.sync.set.mockClear();

    document.getElementById('li-ac-panel-min').click();
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ panelMinimized: true, foundPanelMinimized: true });

    global.chrome.storage.sync.set.mockClear();
    document.getElementById('li-ac-bubble').click(); // expand again
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ panelMinimized: false, foundPanelMinimized: false });
  });

  test('storage.onChanged applies persisted minimize changes to open panels', async () => {
    await openPanels();
    global.__onChanged({ panelMinimized: { newValue: true }, foundPanelMinimized: { newValue: true } }, 'sync');
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(global.__LI.getFoundPanelMinimized()).toBe(true);
    expect(document.getElementById('li-ac-panel').style.display).toBe('none');
    expect(document.getElementById('li-ac-found-panel').style.display).toBe('none');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');

    // And back to expanded.
    global.__onChanged({ panelMinimized: { newValue: false }, foundPanelMinimized: { newValue: false } }, 'sync');
    expect(document.getElementById('li-ac-panel').style.display).toBe('');
    expect(document.getElementById('li-ac-found-panel').style.display).toBe('flex');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('none');
  });

  test('minimize state is honored when a panel is recreated (no close button)', async () => {
    await openPanels();
    document.getElementById('li-ac-panel-min').click(); // minimized
    expect(document.getElementById('li-ac-panel-close')).toBeNull();

    // Panels have no close button; remove the DOM node directly to simulate a
    // LinkedIn-side detach. A re-scan recreates the panel.
    document.getElementById('li-ac-panel').remove();
    expect(document.getElementById('li-ac-panel')).toBeNull();

    sendMessage({ type: 'FEED_SCAN' }); // detached node -> panel recreated
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const recreated = document.getElementById('li-ac-panel');
    expect(recreated).not.toBeNull();
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(recreated.style.display).toBe('none');
    expect(recreated.querySelector('#li-ac-panel-min').textContent).toBe('+');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');
  });

  test('minimize buttons use the BW monochrome accent style', async () => {
    await openPanels();
    const panelBtn = document.getElementById('li-ac-panel-min');
    const foundBtn = document.getElementById('li-ac-found-min');
    expect(panelBtn.style.background).toBe('rgb(255, 255, 255)');
    expect(panelBtn.style.color).toBe('rgb(0, 0, 0)');
    expect(foundBtn.style.background).toBe('rgb(255, 255, 255)');
    expect(foundBtn.style.color).toBe('rgb(0, 0, 0)');
  });

  test('minimized panels have no close button — the bubble is the restore point', async () => {
    await openPanels();
    document.getElementById('li-ac-panel-min').click();

    // No close buttons exist; panels stay in the DOM (just hidden) and the
    // bubble is the single restore point.
    expect(document.getElementById('li-ac-panel-close')).toBeNull();
    expect(document.getElementById('li-ac-found-close')).toBeNull();
    expect(document.getElementById('li-ac-panel')).not.toBeNull();
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
    expect(document.getElementById('li-ac-bubble')).not.toBeNull();
  });

  test('minimized panels stay in the DOM so time-ago refresh keeps updating labels', async () => {
    await openPanels();
    const found = document.getElementById('li-ac-found-panel');
    const row = found.querySelector('[data-kind="em"][data-key]');
    const ago = row.querySelector('[data-ago]');
    const before = ago.textContent;

    document.getElementById('li-ac-found-min').click();
    expect(found.style.display).toBe('none');

    // Advance past the 10s refresh interval; the hidden label still updates
    // because the minimized panel remains in the DOM.
    await jest.advanceTimersByTimeAsync(11000);
    const after = ago.textContent;
    expect(after).toMatch(/\d+s ago|\d+min ago|\d+h ago/);
    expect(after).not.toBe(before);
  });

  test('expanding the found panel restores its flex body, not a block/empty display', async () => {
    await openPanels();
    const found = document.getElementById('li-ac-found-panel');
    const body = found.querySelector('#li-ac-found-body');

    // The found body is a flex column wrapper (it lays out the keyword + email
    // lists). Expanding must restore display:flex; setting '' reverts to block
    // and collapses the wrapper to 0 height in the auto-height panel (regression).
    expect(body.style.display).toBe('flex');
    expect(body.style.flexDirection).toBe('column');
  });

  test('found body keeps content-driven flex so its lists scroll internally', async () => {
    await openPanels();
    const found = document.getElementById('li-ac-found-panel');
    const body = found.querySelector('#li-ac-found-body');

    // The wrapper must size to content (flex-basis:auto). flex-basis:0 in an
    // auto-height parent (panel only sets max-height) collapses it to 0 and
    // pushes the email section below the viewport when the keyword list is long.
    expect(body.style.flex).toMatch(/auto/);
    expect(body.style.minHeight).toBe('0');

    // Keyword/email lists keep internal scroll. A list with hits gets an 18vh
    // min-height so it scrolls internally; an empty list collapses to 0.
    const kwList = found.querySelector('#li-ac-kw-list');
    const emList = found.querySelector('#li-ac-panel-list');
    expect(kwList.style.overflowY).toBe('auto');
    expect(emList.style.overflowY).toBe('auto');
    expect(kwList.style.minHeight).toBe('0'); // no include keywords → empty
    expect(emList.style.minHeight).toMatch(/vh/); // email hit present
  });

  test('minimized state is honored when loaded from storage at init', async () => {
    jest.useFakeTimers();
    global.chrome.storage.sync.get.mockImplementationOnce((_defaults, callback) => {
      callback({
        autoExpand: true,
        scanEmails: true,
        includeKeywords: [],
        excludeKeywords: [],
        autoScroll: false,
        debug: true,
        kwSectionCollapsed: false,
        autoScrollDurationMin: 0,
        panelMinimized: true,
        foundPanelMinimized: true
      });
    });
    let LI;
    jest.isolateModules(() => {
      require('../content.js');
    });
    LI = globalThis.__LI_AC_TEST__;
    expect(LI.getPanelMinimized()).toBe(true);
    expect(LI.getFoundPanelMinimized()).toBe(true);

    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('none');
    expect(panel.querySelector('#li-ac-panel-min').textContent).toBe('+');
    expect(found.style.display).toBe('none');
    expect(found.querySelector('#li-ac-found-min').textContent).toBe('+');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');

    // Bubble click expands back.
    document.getElementById('li-ac-bubble').click();
    expect(panel.style.display).toBe('');
    expect(LI.getPanelMinimized()).toBe(false);

    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ panelMinimized: false, foundPanelMinimized: false });
    LI.cleanup();
  });

  test('bubble is a 56px circle (messenger-style), not a wide strip', async () => {
    await openPanels();
    document.getElementById('li-ac-panel-min').click();
    const bubble = document.getElementById('li-ac-bubble');
    expect(bubble.style.width).toBe('56px');
    expect(bubble.style.height).toBe('56px');
    expect(bubble.style.borderRadius).toBe('50%');
    expect(bubble.style.position).toBe('fixed');
  });

  test('chat monitor collapses to the bubble while LinkedIn chat is open, then restores', async () => {
    jest.useFakeTimers();
    // A prior test may have re-required content.js (jest.isolateModules), which
    // replaces globalThis.__LI_AC_TEST__ but not the setup-captured global.__LI.
    // Use the current instance so sendMessage + asserts stay consistent.
    const LI = globalThis.__LI_AC_TEST__;
    LI.setPanelMinimized(false);
    LI.setFoundPanelMinimized(false);
    LI.stopChatMonitor();

    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    // LinkedIn chat dock opens (rising edge) -> panels collapse to the bubble.
    const dock = document.createElement('div');
    dock.className = 'msg-overlay-conversation-bubble';
    document.body.appendChild(dock);
    LI.startChatMonitor();
    await jest.advanceTimersByTimeAsync(2000);
    expect(LI.isCollapsed()).toBe(true);
    expect(LI.getPanel()).not.toBeNull();
    expect(LI.getPanel().style.display).toBe('none');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('flex');
    // Transient — persistence flags are untouched.
    expect(LI.getPanelMinimized()).toBe(false);
    expect(global.chrome.storage.sync.set).not.toHaveBeenCalledWith({ panelMinimized: true, foundPanelMinimized: true });

    // Chat closes (falling edge) -> prior expanded state restored.
    dock.remove();
    await jest.advanceTimersByTimeAsync(2000);
    expect(LI.isCollapsed()).toBe(false);
    expect(LI.getPanel().style.display).toBe('');
    expect(document.getElementById('li-ac-bubble').style.display).toBe('none');
    LI.stopChatMonitor();
  });

  test('chat monitor is stopped by cleanup (no leaked interval)', async () => {
    await openPanels();
    global.__LI.startChatMonitor();
    global.__LI.cleanup();
    expect(global.__LI.getPanelMinimized()).toBe(false);
  });
});
